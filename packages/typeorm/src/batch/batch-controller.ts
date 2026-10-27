/**
 * OData v4 $batch endpoint controller.
 *
 * Accepts POST /$batch with a multipart/mixed body containing multiple
 * OData operations. Dispatches each sub-request to the appropriate CRUD
 * handler. Wraps changesets in TypeORM QueryRunner transactions for
 * atomicity (D-02, BATCH-02).
 *
 * Security:
 *   T-05-01: Boundary validation delegated to parseBatchBody (throws 400).
 *   T-05-02: MAX_BATCH_OPERATIONS limit enforced by parseBatchBody.
 *   T-05-03: Sub-request URLs parsed via regex — never passed to shell/eval.
 *   T-05-05: Error responses use OData error format, no stack traces.
 */

import {
  Controller,
  HttpException,
  Post,
  Req,
  Res,
  Inject,
  HttpStatus,
  Optional,
  NotFoundException,
  UseFilters,
} from '@nestjs/common'
import type { IncomingMessage } from 'http'
import { DataSource, type EntityManager, type ObjectLiteral } from 'typeorm'

/**
 * Minimal interface for the subset of Express Request used by BatchController.
 * Avoids a direct dependency on @types/express in the typeorm adapter package.
 */
export interface BatchRequest extends IncomingMessage {
  body?: unknown
  rawBody?: Buffer | string
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
import {
  buildODataErrorResponse,
  EdmRegistry,
  ODataExceptionFilter,
  odataErrorBody,
  ETAG_PROVIDER,
  getODataRequestContext,
  ODATA_MODULE_OPTIONS,
  parseODataKey,
  parseBatchBody,
  extractBoundary,
  type ODataModuleResolvedOptions,
  type BatchResponsePart,
  type BatchRequestPart,
  type EdmEntityType,
  type IETagProvider,
} from '@nestjs-odata/core'
import { buildBatchResponse } from './batch-response-builder.js'
import { TYPEORM_ODATA_ENTITIES } from '../odata-typeorm.module.js'
import type { EntityClass } from '@nestjs-odata/core'
import { TypeOrmScopeService, applyScopeToQuery } from '../scope/typeorm-scope.service.js'
import { bodyKeyMismatch, withoutKeyProperties } from '../utils/body-key.js'
import { entityLocation } from '../utils/entity-key.js'
import { ODataWriteRegistry } from '../write/write-registry.js'
import { ODATA_CHANGESET_RUNNER } from '../write/changeset-runner.js'
import type { ODataChangesetRunner, ODataWriteHandlers } from '../write/write.types.js'
import { etagMatches, hasEntityETag, resolveEntityETag } from '../write/etag.js'
import {
  assertHandlerEntity,
  buildWriteContext,
  createHandlerFor,
  writeNotAllowed,
  WriteNotAllowedException,
} from '../write/handlers.js'

/**
 * Internal error used to signal a failed changeset operation so the
 * QueryRunner transaction can be rolled back.
 * Carries the status code and serialized body from the failed operation.
 */
class ChangesetOperationError extends Error {
  constructor() {
    super('Changeset operation failed')
    this.name = 'ChangesetOperationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** HTTP methods a write handler serves. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/** Where a batch error came from, for the error mapper's context (part, or changeset). */
type ErrorOrigin = Pick<BatchRequestPart, 'contentId'> &
  Partial<Pick<BatchRequestPart, 'method' | 'url'>>

/**
 * Parse entity set name and optional key from a sub-request URL.
 *
 * Strategy:
 *   1. Strip query string first.
 *   2. Try to match last segment with key: /EntitySet(key) at path end.
 *   3. Fall back to matching last path segment (no key).
 *
 * Per T-05-03: URL parsing is regex-based, never used for shell/eval.
 *
 * Returns null if the URL cannot be parsed.
 */
function parseEntityUrl(url: string): { entitySetName: string; key?: string } | null {
  // Strip query string
  const pathOnly = url.split('?')[0]

  // Match segment with key: /EntitySetName(key) at end of path
  const withKeyMatch = /\/([A-Za-z][A-Za-z0-9_]*)\(([^)]*)\)$/.exec(pathOnly)
  if (withKeyMatch) {
    return { entitySetName: withKeyMatch[1] ?? '', key: withKeyMatch[2] }
  }

  // Match last path segment without key
  const withoutKeyMatch = /\/([A-Za-z][A-Za-z0-9_]*)$/.exec(pathOnly)
  if (withoutKeyMatch) {
    return { entitySetName: withoutKeyMatch[1] ?? '', key: undefined }
  }

  return null
}

/**
 * BatchController handles POST /$batch requests.
 *
 * The service root prefix is set dynamically when registering this controller
 * in ODataTypeOrmModule.forFeature().
 */
@Controller()
@UseFilters(ODataExceptionFilter)
export class BatchController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Inject(TYPEORM_ODATA_ENTITIES) private readonly entityClasses: EntityClass[],
    @Optional()
    @Inject(TypeOrmScopeService)
    private readonly scopes?: TypeOrmScopeService,
    @Optional()
    @Inject(ODataWriteRegistry)
    private readonly writes?: ODataWriteRegistry,
    @Optional()
    @Inject(ODATA_CHANGESET_RUNNER)
    private readonly changesetRunner?: ODataChangesetRunner,
    @Optional()
    @Inject(ETAG_PROVIDER)
    private readonly etagProvider?: IETagProvider,
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
    // Kept as an explicit QueryRunner (the pre-existing changeset mechanism).
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
   * A response part carrying an entity: the body gets `@odata.etag` and the part an `ETag`
   * header when the entity set has an ETag (same rules as the HTTP routes).
   */
  private entityPart(
    contentId: string | undefined,
    statusCode: number,
    entitySetName: string,
    entity: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): BatchResponsePart {
    const etag = resolveEntityETag(entitySetName, entity, this.writes, this.etagProvider)
    return {
      contentId,
      statusCode,
      headers: etag ? { ...headers, etag } : headers,
      body: JSON.stringify(etag ? { '@odata.etag': etag, ...entity } : entity),
    }
  }

  /**
   * 412 when the part's `If-Match` does not match the entity's current ETag. Batch parts follow
   * the same rules as standalone requests (OData-Protocol 4.01 §11.7, §8.2.4).
   */
  private preconditionFailed(
    contentId: string | undefined,
    entitySetName: string,
    entity: ObjectLiteral,
    part: BatchRequestPart,
  ): BatchResponsePart | undefined {
    const ifMatch = part.headers['if-match']
    if (!ifMatch) return undefined
    const etag = resolveEntityETag(entitySetName, entity, this.writes, this.etagProvider)
    if (etag === undefined || etagMatches(ifMatch, etag)) return undefined
    return this.errorPart(412, 'The ETag value does not match the current version of the entity', {
      contentId,
      method: part.method,
      url: part.url,
    })
  }

  /**
   * Dispatch a POST/PATCH/PUT/DELETE batch part to the entity set's write handlers.
   * Rows outside the entity set's row-level scope answer 404 before the handler runs (without
   * a row lock outside a changeset, like the HTTP routes).
   * `ctx.manager` is set only inside a changeset (the changeset's transaction).
   */
  private async dispatchToHandlers(
    handlers: ODataWriteHandlers<any>,
    part: BatchRequestPart,
    entitySetName: string,
    entityType: EdmEntityType,
    entityClass: EntityClass,
    key: string | undefined,
    manager: EntityManager,
    changesetManager: EntityManager | undefined,
  ): Promise<BatchResponsePart> {
    const method = part.method.toUpperCase()
    const body = part.body ? (JSON.parse(part.body) as Record<string, unknown>) : {}
    const extra = {
      manager: changesetManager,
      batch: { contentId: part.contentId, inChangeset: changesetManager !== undefined },
      ifMatch: part.headers['if-match'],
    }

    if (method === 'POST') {
      const { operation, handler } = createHandlerFor(handlers, entitySetName, entityType, body)
      const ctx = buildWriteContext(entitySetName, entityType, operation, extra)
      const entity = assertHandlerEntity(
        await handler.call(handlers, body, ctx),
        entitySetName,
        operation,
      )
      return this.entityPart(part.contentId, 201, entitySetName, entity, {
        location: entityLocation(
          this.options.serviceRoot,
          entitySetName,
          entityType.keyProperties,
          entity,
        ),
      })
    }

    if (key === undefined) {
      return this.errorPart(400, `${method} requires a key: ${part.url}`, part)
    }
    const where = parseODataKey(key, entityType.keyProperties)
    if (
      this.scopes?.isScoped(entitySetName) &&
      !(await this.findScoped(entitySetName, entityClass, where, manager, 'write'))
    ) {
      return this.notFound(entitySetName, key, part)
    }

    const ctxFor = (operation: 'update' | 'replace' | 'delete') =>
      buildWriteContext(entitySetName, entityType, operation, { ...extra, rawKey: key })
    if (method === 'PATCH' || method === 'PUT') {
      const operation = method === 'PATCH' ? 'update' : 'replace'
      const handler = handlers[operation]
      if (!handler) throw writeNotAllowed(entitySetName, operation, handlers)
      const result = await handler.call(handlers, where, body, ctxFor(operation))
      const entity = assertHandlerEntity(result, entitySetName, operation)
      return this.entityPart(part.contentId, 200, entitySetName, entity)
    }

    if (!handlers.delete) throw writeNotAllowed(entitySetName, 'delete', handlers)
    await handlers.delete(where, ctxFor('delete'))
    return { contentId: part.contentId, statusCode: 204, headers: {}, body: undefined }
  }

  /**
   * Load an entity by key for a batch part, through the entity set's row-level scope when it
   * has one (so rows outside the scope look absent: 404).
   */
  private async findScoped(
    entitySetName: string,
    entityClass: EntityClass,
    where: Record<string, unknown>,
    manager: EntityManager,
    operation: 'entity' | 'write',
  ): Promise<ObjectLiteral | null> {
    if (!this.scopes) return manager.findOne(entityClass, { where })
    const found = await this.scopes.findOne(entitySetName, where, operation, manager, {
      lock: operation === 'write',
    })
    return found ?? null
  }

  /**
   * POST {serviceRoot}/$batch
   *
   * Reads raw body (must be pre-configured with body-parser for text/plain or rawBody),
   * parses multipart/mixed, dispatches sub-requests, builds multipart response.
   */
  @Post('$batch')
  async handleBatch(@Req() req: BatchRequest, @Res() res: BatchResponse): Promise<void> {
    let rawBody: string
    try {
      rawBody = await this.extractRawBody(req)
    } catch (err) {
      res.status(HttpStatus.BAD_REQUEST).json(odataErrorBody('BadRequest', String(err)))
      return
    }

    const contentTypeHeader = req.headers['content-type']
    const contentType =
      (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ?? ''

    let boundary: string
    try {
      boundary = extractBoundary(contentType)
    } catch {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json(
          odataErrorBody(
            'BadRequest',
            'Missing or invalid boundary in Content-Type for $batch request',
          ),
        )
      return
    }

    let parsed
    try {
      parsed = parseBatchBody(rawBody, boundary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Malformed batch body'
      res.status(HttpStatus.BAD_REQUEST).json(odataErrorBody('BadRequest', msg))
      return
    }

    const responseParts: BatchResponsePart[] = []

    for (const part of parsed.parts) {
      if (part.kind === 'request') {
        const responsePart = await this.dispatchIndividualRequest(part)
        responseParts.push(responsePart)
      } else if (part.kind === 'changeset') {
        const changesetParts = await this.executeChangeset(part.parts)
        responseParts.push(...changesetParts)
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
   * Dispatch a single individual request (outside a changeset).
   * Failures are caught and returned as per-operation error responses (BATCH-03).
   */
  private async dispatchIndividualRequest(part: BatchRequestPart): Promise<BatchResponsePart> {
    try {
      // A write outside a changeset still runs its scope check and the write in one
      // transaction, so the row cannot leave the scope in between.
      // Not for entity sets with write handlers: they own their transaction, and a row lock
      // held here while the handler writes on another connection would deadlock.
      const entitySetName = parseEntityUrl(part.url)?.entitySetName
      if (
        part.method.toUpperCase() !== 'GET' &&
        entitySetName &&
        this.scopes?.isScoped(entitySetName) &&
        !this.writes?.getHandlers(entitySetName)
      ) {
        return await this.dataSource.transaction((manager) =>
          this.dispatchWithManager(part, manager),
        )
      }
      return await this.dispatchWithManager(part, this.dataSource.manager)
    } catch (err) {
      return this.buildErrorResponse(err, part)
    }
  }

  /**
   * Execute all operations in a changeset within a single QueryRunner transaction.
   * If any operation fails, all are rolled back (BATCH-02).
   *
   * Per D-02: full changeset rollback on any failure.
   * Per WRITE-03 / T-10-08: contentIdMap is local to each changeset call — never leaks across changesets.
   */
  private async executeChangeset(parts: readonly BatchRequestPart[]): Promise<BatchResponsePart[]> {
    // The failing part's response, recorded outside the thrown error: a changesetRunner may
    // wrap or replace the error it sees, and the client must still get the part's own status.
    let failure: BatchResponsePart | undefined
    try {
      return await this.runChangeset(async (manager) => {
        // Per T-10-08: declared inside the changeset so each changeset gets a fresh Map.
        const contentIdMap = new Map<string, string>()
        const results: BatchResponsePart[] = []

        for (const part of parts) {
          // Resolve any $N references in URL and body before dispatching (WRITE-03)
          const resolvedPart = this.resolveContentIdReferences(part, contentIdMap)
          const result = await this.dispatchWithManager(resolvedPart, manager, true)
          results.push(result)

          // Per D-02: if any changeset operation fails (status >= 400), roll back
          // the entire changeset — do not commit partial changes.
          if (result.statusCode >= 400) {
            failure = result
            throw new ChangesetOperationError()
          }

          // Store location URL in contentIdMap after a successful 201 with Content-ID (WRITE-03)
          const location = result.headers['location']
          if (result.statusCode === 201 && location && part.contentId !== undefined) {
            contentIdMap.set(part.contentId, location)
          }
        }
        return results
      })
    } catch (err) {
      // All changeset parts get the same error response (BATCH-02 atomicity)
      const errorResponse = failure
        ? { statusCode: failure.statusCode, headers: {}, body: failure.body }
        : this.buildErrorResponse(err)
      return parts.map((p) => ({ ...errorResponse, contentId: p.contentId }))
    }
  }

  /**
   * Resolve Content-ID references ($N) in a BatchRequestPart's URL and body.
   *
   * Per WRITE-03: $N in a URL or body is substituted with the location URL recorded
   * for content ID N from a prior 201 response in the same changeset.
   *
   * Fast path: returns the original part unchanged when contentIdMap is empty or
   * no $N patterns match (avoids unnecessary object allocation).
   *
   * Per immutability rules: never mutates the readonly BatchRequestPart — returns a new object.
   * Per T-10-07: substitution uses only URLs already in contentIdMap (populated by our own
   * 201 responses) — no code evaluation, no cross-changeset leak.
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
      // OData spec restricts Content-ID to numeric-only strings, so "$N" is the exact token.
      const token = `$${id}`
      url = url.replaceAll(token, resolvedUrl)
      if (body) {
        body = body.replaceAll(token, resolvedUrl)
      }
    }

    // Return original if nothing changed (reference equality fast path)
    if (url === part.url && body === part.body) return part

    return { ...part, url, ...(body !== part.body ? { body } : {}) }
  }

  /**
   * Dispatch a parsed sub-request to the appropriate handler using the given EntityManager.
   * Uses the EntityManager so changesets can use a transaction-scoped manager.
   *
   * Per T-05-03: URL parsing is regex-based, entity operations go through TypeORM parameterized queries.
   */
  private async dispatchWithManager(
    part: BatchRequestPart,
    manager: EntityManager,
    inChangeset = false,
  ): Promise<BatchResponsePart> {
    const parsed = parseEntityUrl(part.url)
    if (!parsed) {
      return this.errorPart(400, `Cannot parse entity URL: ${part.url}`, part)
    }

    const { entitySetName, key } = parsed

    // Resolve entity type from registry
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) {
      return this.errorPart(404, `Entity set '${entitySetName}' not found`, part)
    }

    const entityType = this.edmRegistry.getEntityType(entitySet.entityTypeName)
    if (!entityType) {
      return this.errorPart(404, `Entity type '${entitySet.entityTypeName}' not found`, part)
    }

    // Resolve the TypeORM entity class for this entity set
    const entityClass = this.resolveEntityClass(entityType.name)
    if (!entityClass) {
      return this.errorPart(500, `Entity class not found for '${entityType.name}'`, part)
    }

    const method = part.method.toUpperCase()

    try {
      const handlers = WRITE_METHODS.has(method)
        ? this.writes?.getHandlers(entitySetName)
        : undefined
      if (handlers) {
        return await this.dispatchToHandlers(
          handlers,
          part,
          entitySetName,
          entityType,
          entityClass,
          key,
          manager,
          inChangeset ? manager : undefined,
        )
      }
      if (method === 'GET') {
        if (key !== undefined) {
          return await this.dispatchGetByKey(
            key,
            entitySetName,
            entityType.keyProperties,
            entityClass,
            manager,
            part,
          )
        }
        // Collection GET — not supported in batch (read-only outside changeset)
        return await this.dispatchGetCollection(entitySetName, entityClass, manager, part.contentId)
      } else if (method === 'POST') {
        return await this.dispatchCreate(
          part,
          entitySetName,
          entityType.keyProperties,
          entityClass,
          manager,
        )
      } else if (method === 'PATCH') {
        if (key === undefined) {
          return this.errorPart(400, `PATCH requires a key: ${part.url}`, part)
        }
        return await this.dispatchUpdate(
          key,
          part,
          entitySetName,
          entityType.keyProperties,
          entityClass,
          manager,
        )
      } else if (method === 'PUT') {
        if (key === undefined) {
          return this.errorPart(400, `PUT requires a key: ${part.url}`, part)
        }
        return await this.dispatchReplace(
          key,
          part,
          entitySetName,
          entityType,
          entityClass,
          manager,
        )
      } else if (method === 'DELETE') {
        if (key === undefined) {
          return this.errorPart(400, `DELETE requires a key: ${part.url}`, part)
        }
        return await this.dispatchDelete(
          key,
          part,
          entitySetName,
          entityType.keyProperties,
          entityClass,
          manager,
          part.contentId,
        )
      }

      return this.errorPart(405, `Method '${method}' not supported in $batch`, part)
    } catch (err) {
      return this.buildErrorResponse(err, part)
    }
  }

  /** GET /EntitySet(key) */
  private async dispatchGetByKey(
    keyStr: string,
    entitySetName: string,
    keyProperties: readonly string[],
    entityClass: EntityClass,
    manager: EntityManager,
    part: BatchRequestPart,
  ): Promise<BatchResponsePart> {
    const contentId = part.contentId
    const where = parseODataKey(keyStr, keyProperties)
    const entity = await this.findScoped(entitySetName, entityClass, where, manager, 'entity')
    if (!entity) return this.notFound(entitySetName, keyStr, part)
    return this.entityPart(contentId, 200, entitySetName, entity)
  }

  /** GET /EntitySet (collection — basic support) */
  private async dispatchGetCollection(
    entitySetName: string,
    entityClass: EntityClass,
    manager: EntityManager,
    contentId?: string,
  ): Promise<BatchResponsePart> {
    // Apply maxTop limit to prevent unbounded queries (T-05-06 / SEC-01).
    let items: ObjectLiteral[]
    if (this.scopes) {
      // Same result as manager.find() (eager relations, take), restricted to the scope.
      const qb = manager.createQueryBuilder(entityClass as new () => ObjectLiteral, 'entity')
      qb.setFindOptions({ take: this.options.maxTop, loadEagerRelations: true })
      applyScopeToQuery(
        qb,
        'entity',
        await this.scopes.subqueryFor(entitySetName, 'collection', [], manager),
      )
      items = await qb.getMany()
    } else {
      items = await manager.find(entityClass, {
        take: this.options.maxTop,
      })
    }
    return {
      contentId,
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ value: items }),
    }
  }

  /** POST /EntitySet */
  private async dispatchCreate(
    part: BatchRequestPart,
    entitySetName: string,
    keyProperties: readonly string[],
    entityClass: EntityClass,
    manager: EntityManager,
  ): Promise<BatchResponsePart> {
    const body = part.body ? (JSON.parse(part.body) as Record<string, unknown>) : {}
    const repo = manager.getRepository(entityClass)
    const created = repo.create(body as ObjectLiteral)
    const saved = (await repo.save(created)) as Record<string, unknown>
    return this.entityPart(part.contentId, 201, entitySetName, saved, {
      location: entityLocation(this.options.serviceRoot, entitySetName, keyProperties, saved),
    })
  }

  /** PATCH /EntitySet(key) */
  private async dispatchUpdate(
    keyStr: string,
    part: BatchRequestPart,
    entitySetName: string,
    keyProperties: readonly string[],
    entityClass: EntityClass,
    manager: EntityManager,
  ): Promise<BatchResponsePart> {
    const body = part.body ? (JSON.parse(part.body) as Record<string, unknown>) : {}
    const where = parseODataKey(keyStr, keyProperties)
    const EntityCls = entityClass as new () => ObjectLiteral
    const existing = await this.findScoped(entitySetName, entityClass, where, manager, 'write')
    if (!existing) return this.notFound(entitySetName, keyStr, part)
    const stale = this.preconditionFailed(part.contentId, entitySetName, existing, part)
    if (stale) return stale
    // Merge patch fields onto the existing entity, then save. Key properties in the body are
    // ignored (OData §11.4.3): the URL key identifies the row.
    const patch = withoutKeyProperties(keyProperties, body)
    const merged = manager.merge(EntityCls, existing, patch)
    const saved = await manager.save(EntityCls, merged)
    return this.entityPart(part.contentId, 200, entitySetName, saved)
  }

  /**
   * PUT /EntitySet(key) — full entity replacement.
   *
   * Per OData v4 spec (D-01): all entity properties replaced.
   * Unspecified fields reset to column defaults (null for nullable, default value otherwise).
   * Distinct from PATCH merge semantics used by dispatchUpdate().
   *
   * Uses repo.metadata.columns for column introspection — same pattern as handleReplace().
   */
  private async dispatchReplace(
    keyStr: string,
    part: BatchRequestPart,
    entitySetName: string,
    entityType: EdmEntityType,
    entityClass: EntityClass,
    manager: EntityManager,
  ): Promise<BatchResponsePart> {
    const body = part.body ? (JSON.parse(part.body) as Record<string, unknown>) : {}
    const where = parseODataKey(keyStr, entityType.keyProperties)
    const EntityCls = entityClass as new () => ObjectLiteral

    // Validate key in body matches URL key (T-10-01)
    if (bodyKeyMismatch(entityType.keyProperties, body, where)) {
      return this.errorPart(400, 'Key in body does not match URL key', part)
    }

    const existing = await this.findScoped(entitySetName, entityClass, where, manager, 'write')
    if (!existing) return this.notFound(entitySetName, keyStr, part)
    const stale = this.preconditionFailed(part.contentId, entitySetName, existing, part)
    if (stale) return stale

    // Build full replacement using column metadata — same logic as handleReplace()
    const meta = this.dataSource.getMetadata(entityClass)
    const replacement: Record<string, unknown> = {}

    // Set key values from URL
    for (const kp of entityType.keyProperties) {
      replacement[kp] = where[kp]
    }

    for (const col of meta.columns) {
      if (col.isPrimary) continue
      if (col.isCreateDate || col.isUpdateDate || col.isVersion) continue

      const propName = col.propertyName
      if (Object.prototype.hasOwnProperty.call(body, propName)) {
        replacement[propName] = body[propName]
      } else if (col.default !== undefined) {
        replacement[propName] = col.default
      } else if (col.isNullable) {
        replacement[propName] = null
      }
    }

    const repo = manager.getRepository(EntityCls)
    const entity = repo.create(replacement as ObjectLiteral)
    const saved = await manager.save(EntityCls, entity)
    return this.entityPart(part.contentId, 200, entitySetName, saved)
  }

  /** DELETE /EntitySet(key) */
  private async dispatchDelete(
    keyStr: string,
    part: BatchRequestPart,
    entitySetName: string,
    keyProperties: readonly string[],
    entityClass: EntityClass,
    manager: EntityManager,
    contentId?: string,
  ): Promise<BatchResponsePart> {
    const where = parseODataKey(keyStr, keyProperties)
    const notFound = () => this.notFound(entitySetName, keyStr, part)
    const ifMatch = part.headers['if-match']
    // Load the row only when the scope or an If-Match needs it.
    if (
      this.scopes?.isScoped(entitySetName) ||
      (ifMatch && hasEntityETag(entitySetName, this.writes, this.etagProvider))
    ) {
      const existing = await this.findScoped(entitySetName, entityClass, where, manager, 'write')
      if (!existing) return notFound()
      const stale = this.preconditionFailed(contentId, entitySetName, existing, part)
      if (stale) return stale
    }
    const result = await manager.delete(entityClass, where)
    if (result.affected === 0) return notFound()
    return {
      contentId,
      statusCode: 204,
      headers: {},
      body: undefined,
    }
  }

  /**
   * Build an OData error response part from an exception, through the application's
   * `errorMapper` (ODataModule.forRoot() option) and then the default mapping. The library's
   * own errors (404, a missing key, 412, …) go through here too, so the mapper sees every
   * failing part. Without `origin`, the error belongs to a changeset as a whole.
   * Never exposes stack traces (T-05-05).
   */
  private buildErrorResponse(err: unknown, origin?: ErrorOrigin): BatchResponsePart {
    const { status, body } = buildODataErrorResponse(err, this.options.errorMapper, {
      request: getODataRequestContext()?.request,
      batch: origin
        ? { method: origin.method, url: origin.url, contentId: origin.contentId }
        : { changeset: true },
    })
    // OData §9.2.2: a 405 lists the allowed methods.
    const notAllowed = err instanceof WriteNotAllowedException ? err : undefined
    return {
      contentId: origin?.contentId,
      statusCode: status,
      headers: notAllowed && status === 405 ? { allow: notAllowed.allow } : {},
      body: JSON.stringify(body),
    }
  }

  /** An error part raised by the library itself (`HttpException(message, status)`). */
  private errorPart(status: number, message: string, origin: ErrorOrigin): BatchResponsePart {
    return this.buildErrorResponse(new HttpException(message, status), origin)
  }

  /** 404 part for an entity that does not exist or is outside its row-level scope. */
  private notFound(entitySetName: string, keyStr: string, origin: ErrorOrigin): BatchResponsePart {
    return this.buildErrorResponse(
      new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`),
      origin,
    )
  }

  /**
   * Resolve a TypeORM entity class from an EDM entity type name.
   * Matches by checking DataSource metadata for each registered entity class.
   */
  private resolveEntityClass(entityTypeName: string): EntityClass | undefined {
    for (const cls of this.entityClasses) {
      try {
        const meta = this.dataSource.getMetadata(cls)
        if (meta.name === entityTypeName) {
          return cls
        }
      } catch {
        // Entity not found in this DataSource — skip
      }
    }
    return undefined
  }
}
