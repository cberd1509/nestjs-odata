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

import { Controller, Post, Req, Res, Inject, HttpStatus } from '@nestjs/common'
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
  EdmRegistry,
  ODATA_MODULE_OPTIONS,
  parseODataKey,
  parseBatchBody,
  extractBoundary,
  type ODataModuleResolvedOptions,
  type BatchResponsePart,
  type BatchRequestPart,
  type EdmEntityType,
} from '@nestjs-odata/core'
import { buildBatchResponse } from './batch-response-builder.js'
import { TYPEORM_ODATA_ENTITIES } from '../odata-typeorm.module.js'
import type { EntityClass } from '@nestjs-odata/core'

/**
 * Internal error used to signal a failed changeset operation so the
 * QueryRunner transaction can be rolled back.
 * Carries the status code and serialized body from the failed operation.
 */
class ChangesetOperationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Changeset operation failed with status ${statusCode}`)
    this.name = 'ChangesetOperationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Build an OData error response body (T-05-05).
 * Never exposes stack traces or internal server details.
 */
function buildODataError(code: string, message: string): string {
  return JSON.stringify({
    error: {
      code,
      message,
      details: [],
    },
  })
}

/**
 * Map HTTP status to OData error code string.
 */
function statusToCode(status: number): string {
  const codes: Record<number, string> = {
    400: 'BadRequest',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'NotFound',
    409: 'Conflict',
    500: 'InternalServerError',
  }
  return codes[status] ?? 'Error'
}

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
export class BatchController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Inject(TYPEORM_ODATA_ENTITIES) private readonly entityClasses: EntityClass[],
  ) {}

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
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: { code: 'BadRequest', message: String(err), details: [] } })
      return
    }

    const contentTypeHeader = req.headers['content-type']
    const contentType =
      (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ?? ''

    let boundary: string
    try {
      boundary = extractBoundary(contentType)
    } catch {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: {
          code: 'BadRequest',
          message: 'Missing or invalid boundary in Content-Type for $batch request',
          details: [],
        },
      })
      return
    }

    let parsed
    try {
      parsed = parseBatchBody(rawBody, boundary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Malformed batch body'
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: { code: 'BadRequest', message: msg, details: [] } })
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
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
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
      return await this.dispatchWithManager(part, this.dataSource.manager)
    } catch (err) {
      return this.buildErrorResponse(err, part.contentId)
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
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()

    // Per T-10-08: declared inside executeChangeset() so each changeset gets a fresh Map.
    const contentIdMap = new Map<string, string>()

    try {
      const results: BatchResponsePart[] = []

      for (const part of parts) {
        // Resolve any $N references in URL and body before dispatching (WRITE-03)
        const resolvedPart = this.resolveContentIdReferences(part, contentIdMap)
        const result = await this.dispatchWithManager(resolvedPart, queryRunner.manager)
        results.push(result)

        // Per D-02: if any changeset operation fails (status >= 400), roll back
        // the entire changeset — do not commit partial changes.
        if (result.statusCode >= 400) {
          throw new ChangesetOperationError(result.statusCode, result.body ?? 'Operation failed')
        }

        // Store location URL in contentIdMap after a successful 201 with Content-ID (WRITE-03)
        const location = result.headers['location']
        if (result.statusCode === 201 && location && part.contentId !== undefined) {
          contentIdMap.set(part.contentId, location)
        }
      }

      await queryRunner.commitTransaction()
      return results
    } catch (err) {
      await queryRunner.rollbackTransaction()

      // All changeset parts get the same error response (BATCH-02 atomicity)
      const errorResponse =
        err instanceof ChangesetOperationError
          ? {
              statusCode: err.statusCode,
              headers: {} as Record<string, string>,
              body: err.body,
            }
          : this.buildErrorResponse(err)
      return parts.map((p) => ({ ...errorResponse, contentId: p.contentId }))
    } finally {
      await queryRunner.release()
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
      // URL pattern: $N followed by /, ?, #, or end of string (standard URL segments)
      const urlPattern = new RegExp(`\\$${id}(?=[/?#]|$)`, 'g')
      url = url.replace(urlPattern, resolvedUrl)
      if (body) {
        // Body pattern: $N followed by a non-digit or end of string.
        // Handles JSON bodies where $1 appears inside quoted strings (e.g., "$1" -> resolved URL).
        const bodyPattern = new RegExp(`\\$${id}(?=\\D|$)`, 'g')
        body = body.replace(bodyPattern, resolvedUrl)
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
  ): Promise<BatchResponsePart> {
    const parsed = parseEntityUrl(part.url)
    if (!parsed) {
      return {
        contentId: part.contentId,
        statusCode: 400,
        headers: {},
        body: buildODataError('BadRequest', `Cannot parse entity URL: ${part.url}`),
      }
    }

    const { entitySetName, key } = parsed

    // Resolve entity type from registry
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) {
      return {
        contentId: part.contentId,
        statusCode: 404,
        headers: {},
        body: buildODataError('NotFound', `Entity set '${entitySetName}' not found`),
      }
    }

    const entityType = this.edmRegistry.getEntityType(entitySet.entityTypeName)
    if (!entityType) {
      return {
        contentId: part.contentId,
        statusCode: 404,
        headers: {},
        body: buildODataError('NotFound', `Entity type '${entitySet.entityTypeName}' not found`),
      }
    }

    // Resolve the TypeORM entity class for this entity set
    const entityClass = this.resolveEntityClass(entityType.name)
    if (!entityClass) {
      return {
        contentId: part.contentId,
        statusCode: 500,
        headers: {},
        body: buildODataError(
          'InternalServerError',
          `Entity class not found for '${entityType.name}'`,
        ),
      }
    }

    const method = part.method.toUpperCase()

    try {
      if (method === 'GET') {
        if (key !== undefined) {
          return await this.dispatchGetByKey(
            key,
            entitySetName,
            entityType.keyProperties,
            entityClass,
            manager,
            part.contentId,
          )
        }
        // Collection GET — not supported in batch (read-only outside changeset)
        return await this.dispatchGetCollection(entityClass, manager, part.contentId)
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
          return {
            contentId: part.contentId,
            statusCode: 400,
            headers: {},
            body: buildODataError('BadRequest', `PATCH requires a key: ${part.url}`),
          }
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
          return {
            contentId: part.contentId,
            statusCode: 400,
            headers: {},
            body: buildODataError('BadRequest', `PUT requires a key: ${part.url}`),
          }
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
          return {
            contentId: part.contentId,
            statusCode: 400,
            headers: {},
            body: buildODataError('BadRequest', `DELETE requires a key: ${part.url}`),
          }
        }
        return await this.dispatchDelete(
          key,
          entitySetName,
          entityType.keyProperties,
          entityClass,
          manager,
          part.contentId,
        )
      }

      return {
        contentId: part.contentId,
        statusCode: 405,
        headers: {},
        body: buildODataError('MethodNotAllowed', `Method '${method}' not supported in $batch`),
      }
    } catch (err) {
      return this.buildErrorResponse(err, part.contentId)
    }
  }

  /** GET /EntitySet(key) */
  private async dispatchGetByKey(
    keyStr: string,
    entitySetName: string,
    keyProperties: readonly string[],
    entityClass: EntityClass,
    manager: EntityManager,
    contentId?: string,
  ): Promise<BatchResponsePart> {
    const where = parseODataKey(keyStr, keyProperties)
    const entity = await manager.findOne(entityClass as new () => ObjectLiteral, { where })
    if (!entity) {
      return {
        contentId,
        statusCode: 404,
        headers: {},
        body: buildODataError(
          'NotFound',
          `Entity '${entitySetName}' with key '${keyStr}' not found`,
        ),
      }
    }
    return {
      contentId,
      statusCode: 200,
      headers: {},
      body: JSON.stringify(entity),
    }
  }

  /** GET /EntitySet (collection — basic support) */
  private async dispatchGetCollection(
    entityClass: EntityClass,
    manager: EntityManager,
    contentId?: string,
  ): Promise<BatchResponsePart> {
    const items = await manager.find(entityClass as new () => ObjectLiteral)
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
    const repo = manager.getRepository(entityClass as new () => ObjectLiteral)
    const created = repo.create(body as ObjectLiteral)
    const saved = (await repo.save(created)) as Record<string, unknown>

    // Build Location URL
    const keyParts = keyProperties.map((kp) => {
      const val = saved[kp]
      return keyProperties.length === 1 ? String(val) : `${kp}=${String(val)}`
    })
    const keyStr = keyParts.join(',')
    const locationUrl = `${this.options.serviceRoot}/${entitySetName}(${keyStr})`

    return {
      contentId: part.contentId,
      statusCode: 201,
      headers: { location: locationUrl },
      body: JSON.stringify(saved),
    }
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
    const existing = await manager.findOne(EntityCls, { where })
    if (!existing) {
      return {
        contentId: part.contentId,
        statusCode: 404,
        headers: {},
        body: buildODataError(
          'NotFound',
          `Entity '${entitySetName}' with key '${keyStr}' not found`,
        ),
      }
    }
    // Merge patch fields onto the existing entity, then save
    const merged = manager.merge(EntityCls, existing, body as ObjectLiteral)
    const saved = await manager.save(EntityCls, merged)
    return {
      contentId: part.contentId,
      statusCode: 200,
      headers: {},
      body: JSON.stringify(saved),
    }
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
    for (const kp of entityType.keyProperties) {
      const bodyKeyValue = body[kp]
      const urlKeyValue = where[kp]
      if (bodyKeyValue !== undefined && bodyKeyValue !== urlKeyValue) {
        return {
          contentId: part.contentId,
          statusCode: 400,
          headers: {},
          body: buildODataError('BadRequest', 'Key in body does not match URL key'),
        }
      }
    }

    const existing = await manager.findOne(EntityCls, { where })
    if (!existing) {
      return {
        contentId: part.contentId,
        statusCode: 404,
        headers: {},
        body: buildODataError(
          'NotFound',
          `Entity '${entitySetName}' with key '${keyStr}' not found`,
        ),
      }
    }

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

    return {
      contentId: part.contentId,
      statusCode: 200,
      headers: {},
      body: JSON.stringify(saved),
    }
  }

  /** DELETE /EntitySet(key) */
  private async dispatchDelete(
    keyStr: string,
    entitySetName: string,
    keyProperties: readonly string[],
    entityClass: EntityClass,
    manager: EntityManager,
    contentId?: string,
  ): Promise<BatchResponsePart> {
    const where = parseODataKey(keyStr, keyProperties)
    const result = await manager.delete(entityClass as new () => ObjectLiteral, where)
    if (result.affected === 0) {
      return {
        contentId,
        statusCode: 404,
        headers: {},
        body: buildODataError(
          'NotFound',
          `Entity '${entitySetName}' with key '${keyStr}' not found`,
        ),
      }
    }
    return {
      contentId,
      statusCode: 204,
      headers: {},
      body: undefined,
    }
  }

  /**
   * Build an OData error response part from an exception.
   * Never exposes stack traces (T-05-05).
   */
  private buildErrorResponse(err: unknown, contentId?: string): BatchResponsePart {
    if (err instanceof Error) {
      // Check for NestJS NotFoundException
      if (
        err.constructor.name === 'NotFoundException' ||
        (err as { status?: number }).status === 404
      ) {
        return {
          contentId,
          statusCode: 404,
          headers: {},
          body: buildODataError('NotFound', err.message),
        }
      }
      // Check for bad request / validation errors
      if (
        err.constructor.name === 'ODataValidationError' ||
        err.constructor.name === 'ODataParseError' ||
        (err as { status?: number }).status === 400
      ) {
        return {
          contentId,
          statusCode: 400,
          headers: {},
          body: buildODataError('BadRequest', err.message),
        }
      }
    }

    const status = (err as { status?: number })?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        contentId,
        statusCode: status,
        headers: {},
        body: buildODataError(statusToCode(status), (err as Error).message ?? 'Request error'),
      }
    }

    return {
      contentId,
      statusCode: 500,
      headers: {},
      body: buildODataError('InternalServerError', 'An unexpected error occurred.'),
    }
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
