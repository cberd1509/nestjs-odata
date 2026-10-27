/**
 * OData v4 $batch endpoint controller.
 *
 * Accepts POST /$batch with a multipart/mixed body containing multiple OData operations.
 * Each operation is dispatched, in process, through the application's own HTTP stack
 * (`dispatchBatchOperation`): it reaches its route with the same middleware, guards,
 * interceptors, pipes and exception filters as the standalone request (OData-Protocol 4.01
 * §11.7: operations are "evaluated according to the same semantics used when the request
 * appears outside the context of a batch request").
 *
 * Changesets run atomically in one transaction (a TypeORM QueryRunner, or the application's
 * `changesetRunner`). Its entity manager travels with each operation of the changeset as the
 * `changeset` of its batch part (`getODataChangesetManager()`), which `TypeOrmAutoHandler`,
 * row-level scopes and write handlers use.
 *
 * Security:
 *   T-05-01: Boundary validation delegated to parseBatchBody (throws 400).
 *   T-05-02: MAX_BATCH_OPERATIONS limit enforced by parseBatchBody; no nesting or re-entrancy.
 *   T-05-03: Operation URLs are resolved with the WHATWG URL parser, confined to the service
 *            root and only routed, never evaluated.
 *   T-05-05: Error responses use OData error format, no stack traces.
 *   #67:     Operations cannot bypass route guards: they run through the route.
 */

import {
  BadRequestException,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Optional,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import type { IncomingMessage } from 'http'
import { DataSource, type EntityManager } from 'typeorm'
import {
  BatchOperationTimeoutError,
  batchErrorContext,
  batchOperationHeaders,
  buildODataErrorResponse,
  dispatchBatchOperation,
  EdmRegistry,
  extractBoundary,
  getODataBatchPart,
  getODataRequestContext,
  headerValue,
  inheritedBatchHeaders,
  ODataExceptionFilter,
  ODATA_MODULE_OPTIONS,
  parseBatchBody,
  parseBatchUrl,
  parseQuery,
  resolveBatchOperationUrl,
  resolveNavigationTarget,
  splitKeyPredicate,
  type BatchChangesetResponse,
  type BatchRequestPart,
  type BatchResponseItem,
  type BatchResponsePart,
  type EdmEntityType,
  type ExpandNode,
  type ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import { buildBatchResponse } from './batch-response-builder.js'
import { ODATA_BATCH_OPTIONS, type ODataBatchOptions } from './batch-options.js'
import { ODATA_CHANGESET_RUNNER } from '../write/changeset-runner.js'
import type { ODataChangesetRunner } from '../write/write.types.js'

/**
 * Minimal interface for the subset of Express Request used by BatchController.
 * Avoids a direct dependency on @types/express in the typeorm adapter package.
 */
export interface BatchRequest extends IncomingMessage {
  body?: unknown
  rawBody?: Buffer | string
  originalUrl?: string
  headers: Record<string, string | string[] | undefined>
}

/**
 * Minimal interface for the subset of Express Response used by BatchController.
 */
export interface BatchResponse {
  status(code: number): this
  set(field: string, value: string): this
  send(body: string | Buffer): this
  json(body: unknown): this
}

/**
 * Internal error used to signal a failed changeset operation so the transaction is rolled
 * back. The failing operation's response is recorded by the caller.
 */
class ChangesetOperationError extends Error {
  constructor() {
    super('Changeset operation failed')
    this.name = 'ChangesetOperationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Default of `batch.operationTimeout`: how long one operation may take, in milliseconds. */
export const DEFAULT_BATCH_OPERATION_TIMEOUT = 30_000

/** What every operation of one `$batch` request shares, computed once per request. */
interface BatchScope {
  readonly request: BatchRequest
  /** The `$batch` URL: relative operation URLs resolve against it. */
  readonly base: URL
  /** Path segments of the service root (the `$batch` URL's path without `$batch`). */
  readonly serviceSegments: readonly string[]
  /** Headers of the `$batch` request that its operations inherit. */
  readonly inheritedHeaders: Readonly<Record<string, string>>
}

/**
 * The message of Nest's own "no route" answer (`404 { message: 'Cannot GET /x', ... }`), or
 * `undefined` for any other response: only then is no route behind the response.
 */
function noRouteMessage(statusCode: number, body: Buffer | undefined): string | undefined {
  if (statusCode !== 404 || !body) return undefined
  try {
    const parsed = JSON.parse(body.toString('utf-8')) as { message?: unknown; error?: unknown }
    const message = parsed.message
    return typeof message === 'string' &&
      /^Cannot [A-Z]+ /.test(message) &&
      typeof parsed.error !== 'object'
      ? message
      : undefined
  } catch {
    return undefined
  }
}

/** `$<Content-ID>` as a whole value, or as the first segment of a URL (`$1/Items`). */
function resolveReference(value: string, contentIdMap: ReadonlyMap<string, string>): string {
  if (!value.startsWith('$')) return value
  const end = value.search(/[/?]/)
  const id = value.slice(1, end === -1 ? undefined : end)
  const target = contentIdMap.get(id)
  return target === undefined ? value : target + (end === -1 ? '' : value.slice(end))
}

/**
 * Every string value of a JSON value that is a whole `$<Content-ID>` reference, resolved. Returns
 * `value` itself (same reference) when nothing was replaced.
 */
function resolveJsonReferences(value: unknown, contentIdMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return resolveReference(value, contentIdMap)
  if (!value || typeof value !== 'object') return value
  let changed = false
  const resolve = (v: unknown): unknown => {
    const r = resolveJsonReferences(v, contentIdMap)
    if (r !== v) changed = true
    return r
  }
  const result = Array.isArray(value)
    ? value.map(resolve)
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]))
  return changed ? result : value
}

/** Path segments of a URL path, percent-decoded. */
function pathSegments(path: string): string[] {
  return path
    .split('/')
    .filter((s) => s !== '')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
}

/**
 * BatchController handles POST /$batch requests.
 *
 * Registered once per application (by `ODataBatchModule`, imported by every
 * `ODataTypeOrmModule.forFeature()`); its path prefix is the service root.
 */
@Controller()
@UseFilters(ODataExceptionFilter)
export class BatchController {
  /** The `batch.entitySets` allow-list, if any. */
  private readonly allowedEntitySets: ReadonlySet<string> | undefined

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly dataSource: DataSource,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Inject(EdmRegistry) private readonly edmRegistry: EdmRegistry,
    @Optional()
    @Inject(ODATA_CHANGESET_RUNNER)
    private readonly changesetRunner?: ODataChangesetRunner,
    @Optional()
    @Inject(ODATA_BATCH_OPTIONS)
    private readonly batchOptions?: ODataBatchOptions,
  ) {
    const entitySets = batchOptions?.entitySets
    this.allowedEntitySets = entitySets ? new Set(entitySets) : undefined
  }

  /**
   * Run a changeset's operations atomically: through the app's `changesetRunner` when one is
   * registered, else in a TypeORM QueryRunner transaction. `work` throws to roll back.
   */
  private async runChangeset<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (this.changesetRunner) {
      const request = getODataRequestContext()
      return this.changesetRunner(work, {
        executionContext: request?.executionContext,
        request: request?.request,
      })
    }
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    try {
      const result = await work(queryRunner.manager)
      await queryRunner.commitTransaction()
      return result
    } catch (err) {
      await queryRunner.rollbackTransaction()
      throw err
    } finally {
      await queryRunner.release()
    }
  }

  /**
   * POST {serviceRoot}/$batch
   *
   * Reads raw body (must be pre-configured with body-parser for text/plain or rawBody),
   * parses multipart/mixed, dispatches sub-requests, builds multipart response. Errors of the
   * `$batch` request itself are thrown and answered by `ODataExceptionFilter`.
   */
  @Post('$batch')
  async handleBatch(@Req() req: BatchRequest, @Res() res: BatchResponse): Promise<void> {
    if (this.batchOptions?.enabled === false) {
      throw new NotFoundException('The $batch endpoint is disabled')
    }
    // Re-entrancy: a $batch reached from inside a batch operation (however its URL is spelled)
    // would multiply the operation limit.
    if (getODataBatchPart(req)) {
      throw new BadRequestException('A $batch request cannot contain a $batch request')
    }

    let rawBody: string
    try {
      rawBody = await this.extractRawBody(req)
    } catch (err) {
      throw new BadRequestException(String(err))
    }

    let boundary: string
    try {
      boundary = extractBoundary(headerValue(req.headers['content-type']) ?? '')
    } catch {
      throw new BadRequestException(
        'Missing or invalid boundary in Content-Type for $batch request',
      )
    }

    let parsed
    try {
      parsed = parseBatchBody(rawBody, boundary)
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Malformed batch body')
    }

    const base = parseBatchUrl(req.originalUrl ?? req.url ?? `${this.options.serviceRoot}/$batch`)
    const scope: BatchScope = {
      request: req,
      base,
      serviceSegments: pathSegments(base.pathname).slice(0, -1),
      inheritedHeaders: inheritedBatchHeaders(req.headers),
    }

    const responseParts: BatchResponseItem[] = []
    for (const part of parsed.parts) {
      if (part.kind === 'request') {
        responseParts.push(await this.runOperation(part, scope))
      } else if (part.kind === 'changeset') {
        responseParts.push(await this.executeChangeset(part.parts, scope))
      }
    }

    const { contentType: responseContentType, body } = buildBatchResponse(responseParts)

    res.status(HttpStatus.OK).set('Content-Type', responseContentType).send(body)
  }

  /**
   * Extract the raw body string from the request.
   *
   * Tries multiple strategies in order:
   *   1. req.body as string (if a text/plain body parser ran first)
   *   2. req.rawBody Buffer (NestJS rawBody: true option)
   *   3. Read directly from the Node.js request stream (multipart/mixed fallback)
   *      This works because $batch sends multipart/mixed which no standard body
   *      parser processes, leaving the stream unconsumed.
   */
  private extractRawBody(req: BatchRequest): Promise<string> | string {
    // When body is already a string (text/plain body parser)
    if (typeof req.body === 'string' && req.body.length > 0) {
      return req.body
    }
    // When rawBody is available (NestJS rawBody: true)
    const rawBodyProp = req.rawBody
    if (rawBodyProp !== undefined) {
      return typeof rawBodyProp === 'string' ? rawBodyProp : rawBodyProp.toString('utf-8')
    }
    // Fall back: read from the Node.js IncomingMessage stream.
    // multipart/mixed is not handled by standard body parsers, so the stream is unconsumed.
    const MAX_BATCH_BODY_BYTES = 10 * 1024 * 1024 // 10 MB
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      req.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_BATCH_BODY_BYTES) {
          req.destroy()
          return reject(new Error('Batch request body exceeds maximum size'))
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  /**
   * Execute the operations of a changeset in one transaction, in order. When one fails
   * (status >= 400), the transaction is rolled back, the remaining operations do not run, and
   * the changeset is answered with that operation's error response alone, as a single
   * `application/http` part carrying its Content-ID (OData-Protocol 4.01 §11.7.7.5). Otherwise
   * the responses form a nested multipart/mixed part.
   *
   * Per WRITE-03 / T-10-08: contentIdMap is local to each changeset call — never leaks across changesets.
   */
  private async executeChangeset(
    parts: readonly BatchRequestPart[],
    scope: BatchScope,
  ): Promise<BatchResponseItem> {
    // The failing operation's response, recorded outside the thrown error: a changesetRunner
    // may wrap or replace the error it sees, and the client must still get the part's status.
    let failure: BatchResponsePart | undefined
    try {
      const results = await this.runChangeset(async (manager) => {
        const contentIdMap = new Map<string, string>()
        const responses: BatchResponsePart[] = []
        for (const part of parts) {
          // Resolve any $N references in URL and body before dispatching (WRITE-03)
          const resolvedPart = this.resolveContentIdReferences(part, contentIdMap)
          const result = await this.runOperation(resolvedPart, scope, manager)
          if (result.statusCode >= 400) {
            failure = result
            throw new ChangesetOperationError()
          }
          responses.push(result)

          // Record the created entity's URL for $N references: a 201, or a 204 under
          // Prefer: return=minimal, both carry Location.
          const location = headerValue(result.headers['location'])
          const created = result.statusCode === 201 || result.statusCode === 204
          if (created && location && part.contentId !== undefined) {
            contentIdMap.set(part.contentId, location)
          }
        }
        return responses
      })
      return { kind: 'changeset', parts: results } satisfies BatchChangesetResponse
    } catch (err) {
      // The failing operation's own error response, as sent by its route (§11.7.7.5: "a single
      // response ... that applies to all requests in the change set").
      return failure ?? this.buildErrorResponse(err)
    }
  }

  /**
   * Resolve Content-ID references (`$N`) in a BatchRequestPart's URL and body.
   *
   * Per WRITE-03 / OData-Protocol §11.7.7.2: `$N` stands for the URL of the entity created by
   * the request with Content-ID `N` in the same changeset. Only whole references are replaced,
   * with exact IDs (`$1` never matches inside `$10`): the URL when it is `$N` or starts with
   * `$N/`, and JSON string values (e.g. `@odata.bind`) that are `$N` or start with `$N/`.
   * Text such as `"costs $1"` is left alone.
   *
   * Per immutability rules: never mutates the readonly BatchRequestPart — returns a new object.
   * Per T-10-07: substitution uses only URLs already in contentIdMap (populated by our own
   * responses) — no code evaluation, no cross-changeset leak.
   */
  private resolveContentIdReferences(
    part: BatchRequestPart,
    contentIdMap: ReadonlyMap<string, string>,
  ): BatchRequestPart {
    if (contentIdMap.size === 0) return part // fast path: nothing to resolve

    const url = resolveReference(part.url, contentIdMap)
    let body = part.body
    if (body?.includes('"$')) {
      try {
        const parsed: unknown = JSON.parse(body)
        const resolved = resolveJsonReferences(parsed, contentIdMap)
        if (resolved !== parsed) body = JSON.stringify(resolved)
      } catch {
        // Not JSON: no references to resolve.
      }
    }

    if (url === part.url && body === part.body) return part

    return { ...part, url, ...(body !== part.body ? { body } : {}) }
  }

  /**
   * Run one operation through its route, in process, and turn the result into a batch
   * response part. The operation inherits the `$batch` request's headers (credentials,
   * `Accept-Language`, custom headers), except body, batch-level and conditional ones; its own
   * headers win. While it runs, `getODataBatchPart()` describes it (with the changeset's
   * entity manager as `changeset` inside a changeset).
   */
  private async runOperation(
    part: BatchRequestPart,
    scope: BatchScope,
    changesetManager?: EntityManager,
  ): Promise<BatchResponsePart> {
    let url: URL
    try {
      url = resolveBatchOperationUrl(part.url, scope.base)
    } catch {
      return this.errorPart(400, `Cannot parse the operation URL: ${part.url}`, part)
    }
    const segments = pathSegments(url.pathname)
    // Only resources of this service: never other application routes (`../admin`,
    // `http://host/auth/login`), which would bypass path-based controls in front of the app.
    const { serviceSegments } = scope
    if (
      segments.length < serviceSegments.length ||
      !serviceSegments.every((s, i) => segments[i] === s)
    ) {
      return this.errorPart(400, `The operation URL is outside the service: ${part.url}`, part)
    }
    // Express routing is case-insensitive: `$BATCH` reaches this controller too.
    if (segments.at(-1)?.toLowerCase() === '$batch') {
      return this.errorPart(400, 'A $batch request cannot contain a $batch request', part)
    }
    if (
      this.allowedEntitySets &&
      !this.isAllowed(segments.slice(serviceSegments.length), url.searchParams)
    ) {
      return this.errorPart(403, `Operation not allowed in $batch: ${part.url}`, part)
    }

    try {
      const response = await dispatchBatchOperation(
        this.adapterHost.httpAdapter,
        {
          method: part.method,
          url: `${url.pathname}${url.search}`,
          headers: batchOperationHeaders(
            scope.inheritedHeaders,
            part.headers,
            part.body !== undefined && part.body !== '',
          ),
          body: part.body,
          remoteAddress: scope.request.socket?.remoteAddress,
          timeoutMs: this.batchOptions?.operationTimeout ?? DEFAULT_BATCH_OPERATION_TIMEOUT,
        },
        {
          method: part.method,
          url: part.url,
          contentId: part.contentId,
          inChangeset: changesetManager !== undefined,
          batchRequest: scope.request,
          changeset: changesetManager,
        },
      )
      // No route answered (Nest's own 404): answer it as an OData error. Any other response,
      // errors included, is the route's own and passes through unchanged.
      const noRoute = noRouteMessage(response.statusCode, response.body)
      if (noRoute !== undefined) return this.errorPart(404, noRoute, part)
      return {
        contentId: part.contentId,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
      }
    } catch (err) {
      if (err instanceof BatchOperationTimeoutError) {
        return this.errorPart(504, err.message, part)
      }
      return this.buildErrorResponse(err, part)
    }
  }

  /** The entity set and entity type a navigation property of `type` leads to, if any. */
  private navTarget(
    type: EdmEntityType,
    name: string,
  ): { entitySet: string; entityType: EdmEntityType } | undefined {
    const target = resolveNavigationTarget(this.edmRegistry, type, name)
    if (!target?.entitySet || !target.entityType) return undefined
    return { entitySet: target.entitySet.name, entityType: target.entityType }
  }

  /**
   * True when every entity set the operation reaches is in the `entitySets` allow-list: the
   * entity set of the resource path (`Products(1)`), the targets of navigation segments
   * (`Products(1)/Supplier`) and of `$expand` (nested too, whatever the case of the option
   * name, parsed like the route parses it). `path` is relative to the service root. Unknown
   * resources (`$metadata`, a segment the EDM does not know) are refused.
   */
  private isAllowed(path: readonly string[], query: URLSearchParams): boolean {
    const allowed = this.allowedEntitySets
    const first = splitKeyPredicate(path[0] ?? '').name
    if (!first || !allowed?.has(first)) return false
    const entitySet = this.edmRegistry.getEntitySet(first)
    let type = entitySet ? this.edmRegistry.getEntityType(entitySet.entityTypeName) : undefined
    if (!type) return false
    for (const raw of path.slice(1)) {
      const segment = splitKeyPredicate(raw).name
      if (segment.startsWith('$')) continue // $count, $value, $ref
      const target = this.navTarget(type, segment)
      if (target) {
        if (!allowed.has(target.entitySet)) return false
        type = target.entityType
      } else if (!type.properties.some((p) => p.name === segment)) {
        return false
      }
    }
    // Every $expand option, whatever its case (`$EXPAND`) or how often it is repeated.
    for (const [name, value] of query) {
      if (name.toLowerCase() !== '$expand') continue
      let expand: ExpandNode | undefined
      try {
        expand = parseQuery(`$expand=${value}`).expand
      } catch {
        continue // the route refuses an invalid $expand itself (400)
      }
      if (!this.expandAllowed(type, expand)) return false
    }
    return true
  }

  /** True when every `$expand` target (nested ones too) is an allow-listed entity set. */
  private expandAllowed(type: EdmEntityType, expand: ExpandNode | undefined): boolean {
    for (const item of expand?.items ?? []) {
      let current = type
      for (const name of item.navigationProperty.split('/')) {
        const target = this.navTarget(current, name)
        if (!target || !this.allowedEntitySets?.has(target.entitySet)) return false
        current = target.entityType
      }
      if (!this.expandAllowed(current, item.expand)) return false
    }
    return true
  }

  /**
   * Build an OData error response part from an exception, through the application's
   * `errorMapper` (ODataModule.forRoot() option) and then the default mapping. Without
   * `origin`, the error belongs to a changeset as a whole. Never exposes stack traces (T-05-05).
   */
  private buildErrorResponse(err: unknown, origin?: BatchRequestPart): BatchResponsePart {
    const { status, body, language } = buildODataErrorResponse(
      err,
      this.options.errorMapper,
      {
        request: getODataRequestContext()?.request,
        batch: origin ? batchErrorContext(origin) : { changeset: true },
      },
      this.options.errorLanguage,
    )
    return {
      contentId: origin?.contentId,
      statusCode: status,
      headers: { 'content-language': language },
      body: JSON.stringify(body),
    }
  }

  /** An error part raised by the library itself (`HttpException(message, status)`). */
  private errorPart(status: number, message: string, origin: BatchRequestPart): BatchResponsePart {
    return this.buildErrorResponse(new HttpException(message, status), origin)
  }
}
