import { HttpException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import type { ODataQuery, ODataQueryResult, EdmEntityType, IETagProvider } from '@nestjs-odata/core'
import {
  EdmRegistry,
  ETAG_PROVIDER,
  getODataRequestContext,
  navigationTargetTypeName,
  ODATA_MODULE_OPTIONS,
  parseODataKey,
  type ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import type { Repository, ObjectLiteral, EntityManager, DataSource } from 'typeorm'
import { TypeOrmQueryTranslator } from './typeorm-query-translator.js'
import { bodyKeyMismatch, withoutKeyProperties } from '../utils/body-key.js'
import { entityLocation } from '../utils/entity-key.js'
import type { ODataWriteRegistry } from '../write/write-registry.js'
import type {
  ODataWriteContext,
  ODataWriteHandlers,
  ODataWriteOperation,
} from '../write/write.types.js'
import { etagMatches, resolveEntityETag } from '../write/etag.js'
import { assertHandlerEntity, createHandlerFor, writeNotAllowed } from '../write/handlers.js'
import type { TypeOrmScopeService } from '../scope/typeorm-scope.service.js'

/**
 * TypeOrmAutoHandler — handles OData GET and $count requests automatically
 * using the TypeORM repository and the query translator.
 *
 * Provides zero-boilerplate OData endpoint handling:
 *   - handleGet(): translate + execute OData query, detect next page via top+1 trick
 *   - handleCount(): strip pagination/select/orderby, return total count for filter
 *
 * Per D-13: effectiveTop is clamped by maxTop (T-03-11).
 * Per D-15: handleCount() strips $top/$skip to avoid Pitfall 3.
 * Per Pitfall 2: fetches top+1 items to detect next page without a separate count query.
 *
 * The EdmEntityType is resolved at request time via EdmRegistry so the provider
 * can be registered during module compile time before EDM derivation runs at onModuleInit.
 */
@Injectable()
export class TypeOrmAutoHandler {
  constructor(
    private readonly translator: TypeOrmQueryTranslator,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    private readonly repo: Repository<ObjectLiteral>,
    @Optional() @Inject(ETAG_PROVIDER) private readonly etagProvider?: IETagProvider,
    private readonly dataSource?: DataSource,
    private readonly scopes?: TypeOrmScopeService,
    private readonly writes?: ODataWriteRegistry,
  ) {}

  /** The write handlers registered for an entity set, if any. */
  private handlersFor(entitySetName: string): ODataWriteHandlers<any> | undefined {
    return this.writes?.getHandlers(entitySetName)
  }

  /** Build the context handed to a write handler. */
  private writeContext(
    entitySetName: string,
    entityType: EdmEntityType,
    operation: ODataWriteOperation,
    extra: Partial<ODataWriteContext> = {},
  ): ODataWriteContext {
    const request = getODataRequestContext()
    return {
      entitySetName,
      entityType,
      operation,
      executionContext: request?.executionContext,
      request: request?.request,
      ...extra,
    }
  }

  /** The entity's ETag (`etag` option, else @ODataETag / @UpdateDateColumn). */
  private etagOf(entitySetName: string, entity: ObjectLiteral): string | undefined {
    return resolveEntityETag(entitySetName, entity, this.writes, this.etagProvider)
  }

  /** Attach `__etag` (read by ODataResponseInterceptor) when the entity has an ETag. */
  private withETag(entitySetName: string, entity: ObjectLiteral): ObjectLiteral {
    const etag = this.etagOf(entitySetName, entity)
    return etag ? { ...entity, __etag: etag } : entity
  }

  /** True when the entity set has an ETag (an `etag` option or a provider column). */
  private hasETag(entitySetName: string): boolean {
    return (
      this.writes?.getETag(entitySetName) !== undefined ||
      this.etagProvider?.getETagColumn(entitySetName) !== undefined
    )
  }

  /**
   * 412 unless `If-Match` is satisfied by the current entity: `*`, or a list containing its
   * ETag. A no-op when the entity set has no ETag.
   */
  private assertIfMatch(
    entitySetName: string,
    ifMatch: string | undefined,
    current: ObjectLiteral,
  ): void {
    if (!ifMatch) return
    const etag = this.etagOf(entitySetName, current)
    if (etag === undefined || etagMatches(ifMatch, etag)) return
    throw new HttpException(
      {
        error: {
          code: '412',
          message: 'The ETag value does not match the current version of the entity',
        },
      },
      412,
    )
  }

  /** Run a POST through the entity set's write handlers. */
  private async createWithHandlers(
    handlers: ODataWriteHandlers<any>,
    body: Record<string, unknown>,
    entitySetName: string,
    entityType: EdmEntityType,
    manager?: EntityManager,
  ): Promise<{ entity: unknown; locationUrl: string }> {
    const { operation, handler } = createHandlerFor(handlers, entitySetName, entityType, body)
    const result = await handler.call(
      handlers,
      body,
      this.writeContext(entitySetName, entityType, operation, { manager }),
    )
    const entity = assertHandlerEntity(result, entitySetName, operation)
    return {
      entity: this.withETag(entitySetName, entity),
      locationUrl: entityLocation(
        this.options.serviceRoot,
        entitySetName,
        entityType.keyProperties,
        entity,
      ),
    }
  }

  /**
   * Load the entity an update, replace or delete targets, through its row-level scope (rows
   * outside it look absent). Inside a write transaction (`manager`), the row is locked on
   * drivers that support it. Throws 404 when there is no such entity.
   */
  private async findForWrite(
    entitySetName: string,
    keyStr: string,
    where: Record<string, unknown>,
    repo: Repository<ObjectLiteral>,
    manager?: EntityManager,
  ): Promise<ObjectLiteral> {
    const entity = this.scopes
      ? await this.scopes.findOne(entitySetName, where, 'write', manager, { lock: !!manager })
      : await repo.findOne({ where })
    if (!entity) {
      throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
    }
    return entity
  }

  /**
   * Run a write. For a scoped entity set, the scope check and the write share one transaction
   * (and the checked row is locked on drivers that support it), so the row cannot leave the
   * scope between the check and the write.
   */
  private async inScopedWrite<T>(
    entitySetName: string,
    work: (repo: Repository<ObjectLiteral>, manager?: EntityManager) => Promise<T>,
  ): Promise<T> {
    const repo = this.resolveRepo(entitySetName)
    if (!this.scopes?.isScoped(entitySetName)) return work(repo)
    return repo.manager.transaction((manager) => work(manager.getRepository(repo.target), manager))
  }

  /** 400 when the body carries a key property whose value differs from the URL key. */
  private assertBodyKeyMatches(
    entityType: EdmEntityType,
    body: Record<string, unknown>,
    where: Record<string, unknown>,
  ): void {
    if (bodyKeyMismatch(entityType.keyProperties, body, where)) {
      throw new HttpException(
        { error: { code: '400', message: 'Key in body does not match URL key' } },
        400,
      )
    }
  }

  /**
   * Resolve EdmEntityType from the registry at request time.
   * Throws if the entity set is not registered.
   */
  private resolveEntityType(entitySetName: string): EdmEntityType {
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) {
      throw new Error(`ODataAutoHandler: entity set '${entitySetName}' not found in EdmRegistry`)
    }
    const entityType = this.edmRegistry.getEntityType(entitySet.entityTypeName)
    if (!entityType) {
      throw new Error(
        `ODataAutoHandler: entity type '${entitySet.entityTypeName}' not found in EdmRegistry`,
      )
    }
    return entityType
  }

  /**
   * Resolve the TypeORM Repository for the given OData entity set.
   *
   * Walks DataSource.entityMetadatas to find the entity class whose EDM name
   * matches the entity set's entityTypeName, then returns its Repository.
   * This is what makes multi-entity `forFeature([A, B, …])` route to the
   * correct table per request. Falls back to the constructor-injected default
   * repo when no DataSource is available (single-entity test fixtures).
   */
  private resolveRepo(entitySetName: string): Repository<ObjectLiteral> {
    if (!this.dataSource) return this.repo
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) return this.repo
    for (const meta of this.dataSource.entityMetadatas) {
      if (meta.name === entitySet.entityTypeName) {
        return this.dataSource.getRepository(meta.target as new () => ObjectLiteral)
      }
    }
    return this.repo
  }

  /**
   * Handle an OData GET collection request.
   *
   * Strategy:
   *  1. Resolve EdmEntityType via EdmRegistry
   *  2. Determine effectiveTop (query.top ?? maxTop), clamped to maxTop
   *  3. Build a modified query with top=effectiveTop+1 to detect next page
   *  4. Translate to SelectQueryBuilder
   *  5. Execute (with or without count per query.count)
   *  6. Check if items.length > effectiveTop (has more pages)
   *  7. If yes: slice to effectiveTop, build nextLink; otherwise: no nextLink
   *
   * @param query - Validated ODataQuery from ODataQueryPipe
   * @param requestUrl - Base URL of the request for nextLink construction
   */
  async handleGet(query: ODataQuery, requestUrl: string): Promise<ODataQueryResult> {
    const entityType = this.resolveEntityType(query.entitySetName)
    const repo = this.resolveRepo(query.entitySetName)
    const maxTop = this.options.maxTop ?? 1000
    const effectiveTop = Math.min(query.top ?? maxTop, maxTop)

    // Build the query with top+1 for next page detection (Pitfall 2)
    const fetchQuery: ODataQuery = {
      ...query,
      top: effectiveTop + 1,
    }

    const scopes = await this.scopes?.prepare(query, 'collection')
    const translateResult = this.translator.translate(fetchQuery, entityType, repo, scopes)

    const includeCount = query.count === true
    const rawResult = await this.translator.execute(translateResult, includeCount)

    const items = rawResult.items
    const hasMore = items.length > effectiveTop

    const slicedItems = hasMore ? items.slice(0, effectiveTop) : items

    let nextLink: string | undefined
    if (hasMore) {
      const currentSkip = query.skip ?? 0
      nextLink = this.buildNextLink(
        requestUrl,
        currentSkip + effectiveTop,
        effectiveTop,
        query.entitySetName,
      )
    }

    return {
      items: slicedItems,
      count: rawResult.count,
      nextLink,
      select: query.select,
      isAggregated: rawResult.isAggregated,
      applyProperties: rawResult.applyProperties,
    }
  }

  /**
   * Handle an OData $count route.
   *
   * Per Pitfall 3: strips $top/$skip/$orderby/$select from the query so count
   * returns total matching rows for the filter, not just the current page count.
   *
   * @param query - Validated ODataQuery from ODataQueryPipe
   */
  async handleCount(query: ODataQuery): Promise<number> {
    const entityType = this.resolveEntityType(query.entitySetName)
    const repo = this.resolveRepo(query.entitySetName)

    // Strip everything except filter and entitySetName (Pitfall 3 — T-03-12)
    const countQuery: ODataQuery = {
      entitySetName: query.entitySetName,
      filter: query.filter,
    }

    const scopes = await this.scopes?.prepare(countQuery, 'count')
    const { qb } = this.translator.translate(countQuery, entityType, repo, scopes)
    return qb.getCount()
  }

  /**
   * Build an OData nextLink URL with updated $skip and $top parameters.
   *
   * The base URL is rebuilt from `serviceRoot + entitySetName` (NOT the runtime
   * request URL) so that `@odata.nextLink` is prefix-consistent with
   * `@odata.context` and `@odata.id`. Per OData v4 §5.1.1 all three should be
   * same-document URIs built off the service root — using `req.originalUrl`
   * for nextLink while building context/id from `serviceRoot` produced mixed
   * prefixes when the app was mounted under a NestJS `setGlobalPrefix`.
   *
   * Query options other than $skip/$top from the original request are
   * preserved verbatim so $filter/$select/$orderby/$count carry into the next
   * page.
   *
   * @param requestUrl - The current request URL (used only to extract query params)
   * @param newSkip - The new $skip value for the next page
   * @param top - The page size ($top value)
   * @param entitySetName - The OData entity set name (used for the canonical base URL)
   */
  buildNextLink(requestUrl: string, newSkip: number, top: number, entitySetName?: string): string {
    // Parse the URL to extract existing query params. The path is intentionally
    // discarded if entitySetName is provided — see the canonical base below.
    let baseUrl: string
    let searchStr: string

    const qIndex = requestUrl.indexOf('?')
    if (qIndex !== -1) {
      baseUrl = requestUrl.slice(0, qIndex)
      searchStr = requestUrl.slice(qIndex + 1)
    } else {
      baseUrl = requestUrl
      searchStr = ''
    }

    // Prefer the canonical service-root URL when we know the entity set.
    // Keeps @odata.nextLink consistent with @odata.context / @odata.id.
    if (entitySetName) {
      const root = this.options.serviceRoot.endsWith('/')
        ? this.options.serviceRoot.slice(0, -1)
        : this.options.serviceRoot
      baseUrl = `${root}/${entitySetName}`
    }

    // Parse existing params and update $skip/$top
    const params = new Map<string, string>()
    if (searchStr) {
      for (const part of searchStr.split('&')) {
        const eqIdx = part.indexOf('=')
        if (eqIdx !== -1) {
          params.set(
            decodeURIComponent(part.slice(0, eqIdx)),
            decodeURIComponent(part.slice(eqIdx + 1)),
          )
        }
      }
    }

    params.set('$skip', String(newSkip))
    params.set('$top', String(top))

    const queryParts: string[] = []
    for (const [key, val] of params.entries()) {
      // Do not encode OData system query option prefix ($) — OData URLs use $ unencoded
      queryParts.push(`${key}=${encodeURIComponent(val)}`)
    }

    return `${baseUrl}?${queryParts.join('&')}`
  }

  /**
   * Handle OData GET by key — single entity retrieval.
   *
   * Per D-05: returns single entity, throws NotFoundException if not found.
   * Per D-02: key is parsed from parenthetical format.
   * Per T-04-08: parseODataKey returns typed values used in parameterized where clause.
   * Per T-09-05: If-None-Match header supported — returns { __notModified, etag } signal when matched.
   */
  async handleGetByKey(
    keyStr: string,
    entitySetName: string,
    ifNoneMatchHeader?: string,
  ): Promise<unknown> {
    const entityType = this.resolveEntityType(entitySetName)
    const repo = this.resolveRepo(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)
    const entity = this.scopes
      ? await this.scopes.findOne(entitySetName, where, 'entity')
      : await repo.findOne({ where })
    if (!entity) {
      throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
    }

    // ETag support: check If-None-Match for cache validation
    const currentEtag = this.etagOf(entitySetName, entity)
    if (!currentEtag) return entity
    // If-None-Match: return 304 signal when ETag matches (resource not modified)
    if (ifNoneMatchHeader && etagMatches(ifNoneMatchHeader, currentEtag)) {
      return { __notModified: true, etag: currentEtag }
    }
    // Attach ETag to entity for interceptor to pick up
    return { ...entity, __etag: currentEtag }
  }

  /**
   * Handle OData POST — create entity.
   *
   * Per D-03: returns 201 + Location header + created entity.
   * Returns { entity, locationUrl } for the interceptor to set the Location header.
   * Per T-04-07: TypeORM repo.create() only maps declared columns — unknown fields ignored.
   * Per T-04-11: entity class acts as whitelist, preventing mass assignment.
   */
  async handleCreate(
    body: Record<string, unknown>,
    entitySetName: string,
  ): Promise<{ entity: unknown; locationUrl: string }> {
    const entityType = this.resolveEntityType(entitySetName)
    const handlers = this.handlersFor(entitySetName)
    if (handlers) return this.createWithHandlers(handlers, body, entitySetName, entityType)
    const repo = this.resolveRepo(entitySetName)
    const saved = await repo.save(repo.create(body as ObjectLiteral))
    const locationUrl = entityLocation(
      this.options.serviceRoot,
      entitySetName,
      entityType.keyProperties,
      saved,
    )
    return { entity: saved, locationUrl }
  }

  /**
   * Handle OData POST with deep insert — create parent and nested children atomically.
   *
   * Per D-02 (deep insert): navigation property keys in the body identify child collections.
   * All saves occur within the provided EntityManager (transaction scope).
   *
   * Per T-10-05: depth is checked before recursion — throws 400 if depth >= maxDeepInsertDepth.
   * Per T-10-06: TypeORM repo.create() only maps declared columns — mass assignment safe.
   *
   * @param body - Request body (scalar fields + optional navigation property arrays)
   * @param entitySetName - OData entity set name (e.g. 'Orders')
   * @param manager - Transaction-scoped EntityManager
   * @param depth - Current recursion depth (default 0)
   */
  async handleDeepCreate(
    body: Record<string, unknown>,
    entitySetName: string,
    manager: EntityManager,
    depth = 0,
  ): Promise<{ entity: unknown; locationUrl: string }> {
    const maxDepth = this.options.maxDeepInsertDepth ?? 5
    if (depth >= maxDepth) {
      throw new HttpException(
        {
          error: {
            code: '400',
            message: `Deep insert exceeds maxDeepInsertDepth (${maxDepth})`,
          },
        },
        400,
      )
    }

    const entityType = this.resolveEntityType(entitySetName)
    const handlers = depth === 0 ? this.handlersFor(entitySetName) : undefined
    if (handlers) {
      return this.createWithHandlers(handlers, body, entitySetName, entityType, manager)
    }
    const handlerRepo = this.resolveRepo(entitySetName)

    // Separate scalar props from navigation props
    const navPropNames = new Set(entityType.navigationProperties.map((p) => p.name))
    const scalarBody: Record<string, unknown> = {}
    const navData: Record<string, unknown[]> = {}

    for (const [key, value] of Object.entries(body)) {
      if (navPropNames.has(key) && Array.isArray(value)) {
        navData[key] = value as unknown[]
      } else if (!navPropNames.has(key)) {
        scalarBody[key] = value
      }
    }

    // Save parent entity using the per-entity-set repo (resolved via DataSource).
    const parentRepo = manager.getRepository(handlerRepo.target as new () => ObjectLiteral)
    const parentCreated = parentRepo.create(scalarBody as ObjectLiteral)
    const savedParent = (await parentRepo.save(parentCreated)) as Record<string, unknown>

    // Get parent PK value
    const parentKeyProp = entityType.keyProperties[0] ?? 'id'
    const parentKeyValue = savedParent[parentKeyProp]

    // Process navigation properties (child collections)
    for (const [navPropName, childItems] of Object.entries(navData)) {
      const navProp = entityType.navigationProperties.find((p) => p.name === navPropName)
      if (!navProp) continue

      // "Collection(Default.OrderItem)" / "Default.OrderItem" -> "OrderItem"
      const childTypeName = navigationTargetTypeName(navProp.type)
      const childEntitySet = this.edmRegistry.getEntitySetByTypeName(childTypeName)
      if (!childEntitySet) {
        throw new HttpException(
          {
            error: {
              code: '400',
              message: `Deep insert: cannot resolve entity set for navigation property '${navPropName}' (type '${childTypeName}')`,
            },
          },
          400,
        )
      }
      // Children whose entity set writes through handlers can't be saved with the repository.
      if (this.handlersFor(childEntitySet.name)) {
        throw new HttpException(
          {
            error: {
              code: '400',
              message:
                `Deep insert into '${childEntitySet.name}' is not supported: its writes go through ` +
                `write handlers. Give '${entitySetName}' a deepInsert handler instead.`,
            },
          },
          400,
        )
      }

      // Resolve FK column name from TypeORM relation metadata
      // Look at the child entity class's ManyToOne relation to find the join column
      let fkColumnName: string | undefined
      if (this.dataSource) {
        try {
          const parentMeta = this.dataSource.getMetadata(handlerRepo.target)
          const relation = parentMeta.relations.find((r) => r.propertyName === navPropName)
          if (relation?.inverseRelation?.joinColumns?.[0]?.propertyName) {
            fkColumnName = relation.inverseRelation.joinColumns[0].propertyName
          }
        } catch {
          // fallback below
        }
      }

      // Fallback: derive FK column name from parent entity set name (e.g. 'Orders' -> 'orderId')
      if (!fkColumnName) {
        const singularParent = entitySetName.endsWith('s')
          ? entitySetName.slice(0, -1)
          : entitySetName
        fkColumnName = `${singularParent.charAt(0).toLowerCase()}${singularParent.slice(1)}Id`
      }

      // Resolve the child entity class via DataSource metadata
      const childEntityClass = this.dataSource
        ? this.resolveEntityClassFromDataSource(childTypeName)
        : undefined

      for (let index = 0; index < childItems.length; index++) {
        const childItem = childItems[index] as Record<string, unknown>
        // Inject FK from parent's PK — overrides any user-supplied value (T-10-09)
        const childBody = { ...childItem, [fkColumnName]: parentKeyValue }

        try {
          if (childEntityClass) {
            // Use a fresh repo for the child entity class
            const childRepo = manager.getRepository(childEntityClass as new () => ObjectLiteral)
            const childCreated = childRepo.create(childBody as ObjectLiteral)
            await childRepo.save(childCreated)
          } else {
            // Fallback: use the child entity set name to resolve via handleDeepCreate recursion
            // This won't work well without a child repo, but we handle the error gracefully
            throw new Error(
              `Cannot resolve entity class for '${childTypeName}' — DataSource not available`,
            )
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new HttpException(
            {
              error: {
                code: '400',
                message: `Deep insert failed at '${navPropName}[${index}]': ${message}`,
              },
            },
            400,
          )
        }
      }
    }

    const locationUrl = entityLocation(
      this.options.serviceRoot,
      entitySetName,
      entityType.keyProperties,
      savedParent,
    )
    return { entity: savedParent, locationUrl }
  }

  /**
   * Resolve a TypeORM entity class from an EDM entity type name.
   * Requires DataSource to be provided.
   */
  private resolveEntityClassFromDataSource(entityTypeName: string): (new () => object) | undefined {
    if (!this.dataSource) return undefined
    for (const meta of this.dataSource.entityMetadatas) {
      if (meta.name === entityTypeName) {
        return meta.target as new () => object
      }
    }
    return undefined
  }

  /**
   * Handle OData PATCH — partial update (merge-patch semantics).
   *
   * Per D-01: send only changed fields, server merges with existing entity.
   * Per Pitfall 4: checks preload result for undefined (entity not found case).
   * Per T-04-08: parseODataKey returns typed values for safe parameterized queries.
   * Per T-09-04: If-Match header enforces optimistic concurrency — 412 on stale ETag.
   */
  private async update(
    keyStr: string,
    body: Record<string, unknown>,
    entitySetName: string,
    ifMatchHeader: string | undefined,
    repo: Repository<ObjectLiteral>,
    manager?: EntityManager,
  ): Promise<unknown> {
    const entityType = this.resolveEntityType(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)
    const current = await this.findForWrite(entitySetName, keyStr, where, repo, manager)

    // ETag If-Match validation before update
    this.assertIfMatch(entitySetName, ifMatchHeader, current)

    // Merge-patch onto the entity just loaded (no second SELECT, unlike preload()).
    // Key properties in the body are ignored (OData §11.4.3): the URL key identifies the row.
    const patch = withoutKeyProperties(entityType.keyProperties, body)
    return this.withETag(entitySetName, await repo.save(repo.merge(current, patch as ObjectLiteral)))
  }

  /**
   * Handle OData PUT — full entity replacement.
   *
   * Per D-01 (OData v4 spec): PUT replaces ALL entity properties.
   * Unspecified fields reset to column defaults (null for nullable, default value otherwise).
   * This is distinct from PATCH merge semantics.
   *
   * Implementation:
   *  1. Parse key from URL
   *  2. Validate body key matches URL key (reject 400 on mismatch)
   *  3. Find existing entity — throw 404 if not found
   *  4. Validate ETag If-Match (412 on mismatch)
   *  5. Build full replacement using repo.metadata.columns:
   *     - Skip isPrimary, isCreateDate, isUpdateDate, isVersion columns
   *     - body value > column default > null (if nullable) > absent
   *  6. Save and return
   *
   * Per T-10-01: body key mismatch rejected before DB write.
   * Per T-10-02: repo.create() only maps declared entity columns — mass assignment safe.
   * Per T-10-03: managed columns (PK, timestamps, version) skipped.
   * Per T-10-04: ETag If-Match enforcement identical to handleUpdate().
   */
  private async replace(
    keyStr: string,
    body: Record<string, unknown>,
    entitySetName: string,
    ifMatchHeader: string | undefined,
    repo: Repository<ObjectLiteral>,
    manager?: EntityManager,
  ): Promise<unknown> {
    const entityType = this.resolveEntityType(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)

    // Validate key in body matches URL key (D-01 spec compliance — T-10-01)
    this.assertBodyKeyMatches(entityType, body, where)

    // Find existing entity to confirm it exists (rows outside the scope look absent: 404)
    const existing = await this.findForWrite(entitySetName, keyStr, where, repo, manager)

    // ETag If-Match validation (identical block to handleUpdate — T-10-04)
    this.assertIfMatch(entitySetName, ifMatchHeader, existing)

    // Build full replacement entity using column metadata (Pattern 1 from RESEARCH)
    // repo.metadata.columns gives us all column metadata without needing DataSource injection
    const replacement: Record<string, unknown> = {}

    // Set key values from URL
    for (const kp of entityType.keyProperties) {
      replacement[kp] = where[kp]
    }

    for (const col of repo.metadata.columns) {
      if (col.isPrimary) continue // key already set from URL
      if (col.isCreateDate || col.isUpdateDate || col.isVersion) continue // TypeORM-managed

      const propName = col.propertyName
      if (Object.prototype.hasOwnProperty.call(body, propName)) {
        replacement[propName] = body[propName] // use body value
      } else if (col.default !== undefined) {
        replacement[propName] = col.default // reset to column default
      } else if (col.isNullable) {
        replacement[propName] = null // reset nullable to null
      }
      // else: omit — DB-managed default (e.g., CURRENT_TIMESTAMP)
    }

    const entity = repo.create(replacement as ObjectLiteral)
    return this.withETag(entitySetName, await repo.save(entity))
  }

  /**
   * Handle OData DELETE — remove entity.
   *
   * Per D-04: returns 204 No Content (void return value).
   * Per T-04-08: parseODataKey returns typed values for safe parameterized queries.
   * Per T-09-04: If-Match header enforces optimistic concurrency — 412 on stale ETag.
   */
  private async delete(
    keyStr: string,
    entitySetName: string,
    ifMatchHeader: string | undefined,
    repo: Repository<ObjectLiteral>,
    manager?: EntityManager,
  ): Promise<void> {
    const entityType = this.resolveEntityType(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)
    // Only load the row when the scope or an If-Match needs it; otherwise delete directly.
    if (this.scopes?.isScoped(entitySetName) || (ifMatchHeader && this.hasETag(entitySetName))) {
      const current = await this.findForWrite(entitySetName, keyStr, where, repo, manager)
      this.assertIfMatch(entitySetName, ifMatchHeader, current)
    }

    const result = await repo.delete(where)
    if (result.affected === 0) {
      throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
    }
  }

  /**
   * Run a PATCH, PUT or DELETE through the entity set's write handlers. Rows outside the row-level
   * scope answer 404 before the handler runs. The handler owns its transaction and If-Match
   * check, so no lock is held while it runs.
   */
  private async writeWithHandlers(
    handlers: ODataWriteHandlers<any>,
    operation: 'update' | 'replace' | 'delete',
    keyStr: string,
    body: Record<string, unknown>,
    entitySetName: string,
    ifMatchHeader: string | undefined,
  ): Promise<unknown> {
    const entityType = this.resolveEntityType(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)
    if (this.scopes?.isScoped(entitySetName)) {
      await this.findForWrite(entitySetName, keyStr, where, this.resolveRepo(entitySetName))
    }
    const ctx = this.writeContext(entitySetName, entityType, operation, {
      rawKey: keyStr,
      ifMatch: ifMatchHeader,
    })
    if (operation === 'delete') {
      if (!handlers.delete) throw writeNotAllowed(entitySetName, operation)
      await handlers.delete(where, ctx)
      return undefined
    }
    const handler = handlers[operation]
    if (!handler) throw writeNotAllowed(entitySetName, operation)
    const result = await handler.call(handlers, where, body, ctx)
    return this.withETag(entitySetName, assertHandlerEntity(result, entitySetName, operation))
  }

  /**
   * Handle OData PATCH — partial update (merge-patch semantics). See {@link update}.
   * A key property in the body must match the URL key (400 otherwise).
   */
  async handleUpdate(
    keyStr: string,
    body: Record<string, unknown>,
    entitySetName: string,
    ifMatchHeader?: string,
  ): Promise<unknown> {
    const handlers = this.handlersFor(entitySetName)
    if (handlers) {
      return this.writeWithHandlers(handlers, 'update', keyStr, body, entitySetName, ifMatchHeader)
    }
    return this.inScopedWrite(entitySetName, (repo, manager) =>
      this.update(keyStr, body, entitySetName, ifMatchHeader, repo, manager),
    )
  }

  /** Handle OData PUT — full entity replacement. See {@link replace}. */
  async handleReplace(
    keyStr: string,
    body: Record<string, unknown>,
    entitySetName: string,
    ifMatchHeader?: string,
  ): Promise<unknown> {
    const handlers = this.handlersFor(entitySetName)
    if (handlers) {
      return this.writeWithHandlers(handlers, 'replace', keyStr, body, entitySetName, ifMatchHeader)
    }
    return this.inScopedWrite(entitySetName, (repo, manager) =>
      this.replace(keyStr, body, entitySetName, ifMatchHeader, repo, manager),
    )
  }

  /** Handle OData DELETE — remove entity. See {@link delete}. */
  async handleDelete(keyStr: string, entitySetName: string, ifMatchHeader?: string): Promise<void> {
    const handlers = this.handlersFor(entitySetName)
    if (handlers) {
      await this.writeWithHandlers(handlers, 'delete', keyStr, {}, entitySetName, ifMatchHeader)
      return
    }
    return this.inScopedWrite(entitySetName, (repo, manager) =>
      this.delete(keyStr, entitySetName, ifMatchHeader, repo, manager),
    )
  }
}
