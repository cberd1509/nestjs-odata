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
 * `changesetRunner`). Its entity manager is propagated to the operations through
 * `getODataChangesetManager()`, which `TypeOrmAutoHandler`, row-level scopes and write
 * handlers use.
 *
 * Security:
 *   T-05-01: Boundary validation delegated to parseBatchBody (throws 400).
 *   T-05-02: MAX_BATCH_OPERATIONS limit enforced by parseBatchBody.
 *   T-05-03: Operation URLs are resolved with the WHATWG URL parser and only routed, never
 *            evaluated.
 *   T-05-05: Error responses use OData error format, no stack traces.
 *   #67:     Operations cannot bypass route guards: they run through the route.
 */

import {
  Controller,
  HttpException,
  HttpStatus,
  Inject,
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
  batchOperationHeaders,
  buildODataErrorResponse,
  dispatchBatchOperation,
  extractBoundary,
  getODataRequestContext,
  ODataExceptionFilter,
  odataErrorBody,
  ODATA_MODULE_OPTIONS,
  parseBatchBody,
  resolveBatchOperationUrl,
  runWithODataBatchPart,
  type BatchChangesetResponse,
  type BatchRequestPart,
  type BatchResponseItem,
  type BatchResponsePart,
  type ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import { buildBatchResponse } from './batch-response-builder.js'
import { runInODataChangeset } from './changeset-context.js'
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
  send(body: string): this
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

/** Where a batch error came from, for the error mapper's context (part, or changeset). */
type ErrorOrigin = Pick<BatchRequestPart, 'contentId'> &
  Partial<Pick<BatchRequestPart, 'method' | 'url'>>

/** Headers a failed changeset's single error response keeps from the failing operation. */
const ERROR_HEADERS = new Set(['content-type', 'content-language', 'allow', 'odata-version'])

/** True for an OData error body (`{ "error": { "code", "message" } }`). */
function isODataErrorBody(body: string | undefined): boolean {
  if (!body) return false
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    return typeof parsed.error?.code === 'string' && typeof parsed.error.message === 'string'
  } catch {
    return false
  }
}

/** The `message` of a non-OData JSON error body (e.g. Nest's default 404), if any. */
function plainErrorMessage(body: string | undefined): string | undefined {
  if (!body) return undefined
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message
    return typeof message === 'string' ? message : undefined
  } catch {
    return undefined
  }
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
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly dataSource: DataSource,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Optional()
    @Inject(ODATA_CHANGESET_RUNNER)
    private readonly changesetRunner?: ODataChangesetRunner,
    @Optional()
    @Inject(ODATA_BATCH_OPTIONS)
    private readonly batchOptions?: ODataBatchOptions,
  ) {}

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
   * parses multipart/mixed, dispatches sub-requests, builds multipart response.
   */
  @Post('$batch')
  async handleBatch(@Req() req: BatchRequest, @Res() res: BatchResponse): Promise<void> {
    if (this.batchOptions?.enabled === false) {
      this.sendError(res, HttpStatus.NOT_FOUND, 'NotFound', 'The $batch endpoint is disabled')
      return
    }

    let rawBody: string
    try {
      rawBody = await this.extractRawBody(req)
    } catch (err) {
      this.badRequest(res, String(err))
      return
    }

    const contentTypeHeader = req.headers['content-type']
    const contentType =
      (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ?? ''

    let boundary: string
    try {
      boundary = extractBoundary(contentType)
    } catch {
      this.badRequest(res, 'Missing or invalid boundary in Content-Type for $batch request')
      return
    }

    let parsed
    try {
      parsed = parseBatchBody(rawBody, boundary)
    } catch (err) {
      this.badRequest(res, err instanceof Error ? err.message : 'Malformed batch body')
      return
    }

    const responseParts: BatchResponseItem[] = []
    for (const part of parsed.parts) {
      if (part.kind === 'request') {
        responseParts.push(await this.runOperation(part, req, false))
      } else if (part.kind === 'changeset') {
        responseParts.push(await this.executeChangeset(part.parts, req))
      }
    }

    const { contentType: responseContentType, body } = buildBatchResponse(responseParts)

    res.status(HttpStatus.OK).set('Content-Type', responseContentType).send(body)
  }

  /** 400 for a malformed `$batch` request, with `Content-Language` (OData-Protocol §9.4). */
  private badRequest(res: BatchResponse, message: string): void {
    this.sendError(res, HttpStatus.BAD_REQUEST, 'BadRequest', message)
  }

  private sendError(res: BatchResponse, status: number, code: string, message: string): void {
    res
      .status(status)
      .set('Content-Language', this.options.errorLanguage ?? 'en')
      .json(odataErrorBody(code, message))
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
   * the changeset is answered with that operation's error alone, as a single `application/http`
   * part carrying its Content-ID (OData-Protocol 4.01 §11.7.7.5). Otherwise the responses form
   * a nested multipart/mixed part.
   *
   * Per WRITE-03 / T-10-08: contentIdMap is local to each changeset call — never leaks across changesets.
   */
  private async executeChangeset(
    parts: readonly BatchRequestPart[],
    batchRequest: BatchRequest,
  ): Promise<BatchResponseItem> {
    // The failing operation's response, recorded outside the thrown error: a changesetRunner
    // may wrap or replace the error it sees, and the client must still get the part's status.
    let failure: BatchResponsePart | undefined
    try {
      const results = await this.runChangeset((manager) =>
        runInODataChangeset(manager, async () => {
          const contentIdMap = new Map<string, string>()
          const responses: BatchResponsePart[] = []
          for (const part of parts) {
            // Resolve any $N references in URL and body before dispatching (WRITE-03)
            const resolvedPart = this.resolveContentIdReferences(part, contentIdMap)
            const result = await this.runOperation(resolvedPart, batchRequest, true)
            if (result.statusCode >= 400) {
              failure = result
              throw new ChangesetOperationError()
            }
            responses.push(result)

            // Record the created entity's URL for $N references: a 201, or a 204 under
            // Prefer: return=minimal, both carry Location.
            const location = result.headers['location']
            const created = result.statusCode === 201 || result.statusCode === 204
            if (created && location && part.contentId !== undefined) {
              contentIdMap.set(part.contentId, location)
            }
          }
          return responses
        }),
      )
      return { kind: 'changeset', parts: results } satisfies BatchChangesetResponse
    } catch (err) {
      if (failure) {
        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(failure.headers)) {
          if (ERROR_HEADERS.has(name)) headers[name] = value
        }
        return { ...failure, headers }
      }
      return this.buildErrorResponse(err)
    }
  }

  /**
   * Resolve Content-ID references ($N) in a BatchRequestPart's URL and body.
   *
   * Per WRITE-03: $N in a URL or body is substituted with the location URL recorded
   * for content ID N from a prior 201 response in the same changeset.
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

    let url = part.url
    let body = part.body

    for (const [id, resolvedUrl] of contentIdMap) {
      // Use plain string replacement to avoid RegExp injection via Content-ID values.
      const token = `$${id}`
      url = url.replaceAll(token, resolvedUrl)
      if (body) {
        body = body.replaceAll(token, resolvedUrl)
      }
    }

    if (url === part.url && body === part.body) return part

    return { ...part, url, ...(body !== part.body ? { body } : {}) }
  }

  /**
   * Run one operation through its route, in process, and turn the result into a batch
   * response part. The operation inherits the `$batch` request's headers (credentials,
   * `Accept-Language`, custom headers), except body, batch-level and conditional ones; its own
   * headers win. While it runs, `getODataBatchPart()` describes it.
   */
  private async runOperation(
    part: BatchRequestPart,
    batchRequest: BatchRequest,
    inChangeset: boolean,
  ): Promise<BatchResponsePart> {
    const batchUrl =
      batchRequest.originalUrl ?? batchRequest.url ?? `${this.options.serviceRoot}/$batch`
    let url: string
    try {
      url = resolveBatchOperationUrl(part.url, batchUrl)
    } catch {
      return this.errorPart(400, `Cannot parse the operation URL: ${part.url}`, part)
    }
    const segments = pathSegments(url.split('?')[0] ?? '')
    if (segments.at(-1) === '$batch') {
      return this.errorPart(400, 'A $batch request cannot contain a $batch request', part)
    }
    if (this.batchOptions?.entitySets && !this.isAllowed(segments)) {
      return this.errorPart(403, `Operation not allowed in $batch: ${part.url}`, part)
    }

    try {
      const response = await runWithODataBatchPart(
        {
          method: part.method,
          url: part.url,
          contentId: part.contentId,
          inChangeset,
          batchRequest,
        },
        () =>
          dispatchBatchOperation(this.adapterHost.httpAdapter, {
            method: part.method,
            url,
            headers: batchOperationHeaders(
              batchRequest.headers,
              part.headers,
              part.body !== undefined && part.body !== '',
            ),
            body: part.body,
            remoteAddress: batchRequest.socket?.remoteAddress,
          }),
      )
      if (response.statusCode >= 400 && !isODataErrorBody(response.body)) {
        // A response that did not come from an OData route (e.g. Nest's 404 for an unknown
        // route): answer it as an OData error.
        return this.errorPart(
          response.statusCode,
          plainErrorMessage(response.body) ?? `Operation failed: ${part.method} ${part.url}`,
          part,
        )
      }
      return {
        contentId: part.contentId,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
      }
    } catch (err) {
      return this.buildErrorResponse(err, part)
    }
  }

  /**
   * True when the operation targets an entity set of the `entitySets` allow-list: the path
   * segment after the service root, without its key (`Products(1)` → `Products`).
   */
  private isAllowed(segments: readonly string[]): boolean {
    const root = pathSegments(this.options.serviceRoot)
    for (let i = 0; i + root.length < segments.length; i++) {
      if (root.every((s, j) => segments[i + j] === s)) {
        const target = segments[i + root.length] ?? ''
        const entitySet = target.replace(/\(.*$/, '')
        return this.batchOptions?.entitySets?.includes(entitySet) ?? true
      }
    }
    return false
  }

  /**
   * Build an OData error response part from an exception, through the application's
   * `errorMapper` (ODataModule.forRoot() option) and then the default mapping. Without
   * `origin`, the error belongs to a changeset as a whole. Never exposes stack traces (T-05-05).
   */
  private buildErrorResponse(err: unknown, origin?: ErrorOrigin): BatchResponsePart {
    const { status, body, language } = buildODataErrorResponse(
      err,
      this.options.errorMapper,
      {
        request: getODataRequestContext()?.request,
        batch: origin
          ? { method: origin.method, url: origin.url, contentId: origin.contentId }
          : { changeset: true },
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
  private errorPart(status: number, message: string, origin: ErrorOrigin): BatchResponsePart {
    return this.buildErrorResponse(new HttpException(message, status), origin)
  }
}
