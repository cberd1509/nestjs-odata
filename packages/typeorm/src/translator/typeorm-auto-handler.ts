import { HttpException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import type { ODataQuery, ODataQueryResult, EdmEntityType, IETagProvider } from '@nestjs-odata/core'
import {
  EdmRegistry,
  ETAG_PROVIDER,
  ODATA_MODULE_OPTIONS,
  parseODataKey,
  type ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import type { Repository, ObjectLiteral } from 'typeorm'
import { TypeOrmQueryTranslator } from './typeorm-query-translator.js'

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
  ) {}

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
    const maxTop = this.options.maxTop ?? 1000
    const effectiveTop = Math.min(query.top ?? maxTop, maxTop)

    // Build the query with top+1 for next page detection (Pitfall 2)
    const fetchQuery: ODataQuery = {
      ...query,
      top: effectiveTop + 1,
    }

    const translateResult = this.translator.translate(fetchQuery, entityType)

    const includeCount = query.count === true
    const rawResult = await this.translator.execute(translateResult, includeCount)

    const items = rawResult.items
    const hasMore = items.length > effectiveTop

    const slicedItems = hasMore ? items.slice(0, effectiveTop) : items

    let nextLink: string | undefined
    if (hasMore) {
      const currentSkip = query.skip ?? 0
      nextLink = this.buildNextLink(requestUrl, currentSkip + effectiveTop, effectiveTop)
    }

    return {
      items: slicedItems,
      count: rawResult.count,
      nextLink,
      select: query.select,
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

    // Strip everything except filter and entitySetName (Pitfall 3 — T-03-12)
    const countQuery: ODataQuery = {
      entitySetName: query.entitySetName,
      filter: query.filter,
    }

    const { qb } = this.translator.translate(countQuery, entityType)
    return qb.getCount()
  }

  /**
   * Build an OData nextLink URL with updated $skip and $top parameters.
   *
   * @param requestUrl - The current request URL (may contain existing query params)
   * @param newSkip - The new $skip value for the next page
   * @param top - The page size ($top value)
   */
  buildNextLink(requestUrl: string, newSkip: number, top: number): string {
    // Parse the URL to extract existing query params
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
    const where = parseODataKey(keyStr, entityType.keyProperties)
    const entity = await this.repo.findOne({ where })
    if (!entity) {
      throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
    }

    // ETag support: check If-None-Match for cache validation
    if (this.etagProvider) {
      const etagColumn = this.etagProvider.getETagColumn(entitySetName)
      if (etagColumn) {
        const currentEtag = this.etagProvider.computeETag(
          entity as Record<string, unknown>,
          etagColumn,
        )
        // Attach ETag to entity for interceptor to pick up
        const entityWithEtag = { ...(entity as Record<string, unknown>), __etag: currentEtag }

        // If-None-Match: return 304 signal when ETag matches (resource not modified)
        if (
          ifNoneMatchHeader &&
          this.etagProvider.validateIfMatch(
            ifNoneMatchHeader,
            entity as Record<string, unknown>,
            etagColumn,
          )
        ) {
          return { __notModified: true, etag: currentEtag }
        }

        return entityWithEtag
      }
    }

    return entity
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
    const created = this.repo.create(body as ObjectLiteral)
    const saved = await this.repo.save(created)

    // Build key string for Location URL
    const keyParts = entityType.keyProperties.map((kp) => {
      const val = (saved as Record<string, unknown>)[kp]
      return entityType.keyProperties.length === 1 ? String(val) : `${kp}=${String(val)}`
    })
    const keyStr = keyParts.join(',')
    const locationUrl = `${this.options.serviceRoot}/${entitySetName}(${keyStr})`

    return { entity: saved, locationUrl }
  }

  /**
   * Handle OData PATCH — partial update (merge-patch semantics).
   *
   * Per D-01: send only changed fields, server merges with existing entity.
   * Per Pitfall 4: checks preload result for undefined (entity not found case).
   * Per T-04-08: parseODataKey returns typed values for safe parameterized queries.
   * Per T-09-04: If-Match header enforces optimistic concurrency — 412 on stale ETag.
   */
  async handleUpdate(
    keyStr: string,
    body: Record<string, unknown>,
    entitySetName: string,
    ifMatchHeader?: string,
  ): Promise<unknown> {
    const entityType = this.resolveEntityType(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)

    // ETag If-Match validation before update
    if (this.etagProvider && ifMatchHeader) {
      const etagColumn = this.etagProvider.getETagColumn(entitySetName)
      if (etagColumn) {
        const current = await this.repo.findOne({ where })
        if (!current) {
          throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
        }
        if (
          !this.etagProvider.validateIfMatch(
            ifMatchHeader,
            current as Record<string, unknown>,
            etagColumn,
          )
        ) {
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
      }
    }

    const merged = { ...where, ...body }
    const preloaded = await this.repo.preload(merged as ObjectLiteral)
    if (!preloaded) {
      throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
    }
    return this.repo.save(preloaded)
  }

  /**
   * Handle OData DELETE — remove entity.
   *
   * Per D-04: returns 204 No Content (void return value).
   * Per T-04-08: parseODataKey returns typed values for safe parameterized queries.
   * Per T-09-04: If-Match header enforces optimistic concurrency — 412 on stale ETag.
   */
  async handleDelete(keyStr: string, entitySetName: string, ifMatchHeader?: string): Promise<void> {
    const entityType = this.resolveEntityType(entitySetName)
    const where = parseODataKey(keyStr, entityType.keyProperties)

    // ETag If-Match validation before delete
    if (this.etagProvider && ifMatchHeader) {
      const etagColumn = this.etagProvider.getETagColumn(entitySetName)
      if (etagColumn) {
        const current = await this.repo.findOne({ where })
        if (!current) {
          throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
        }
        if (
          !this.etagProvider.validateIfMatch(
            ifMatchHeader,
            current as Record<string, unknown>,
            etagColumn,
          )
        ) {
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
      }
    }

    const result = await this.repo.delete(where)
    if (result.affected === 0) {
      throw new NotFoundException(`Entity '${entitySetName}' with key '${keyStr}' not found`)
    }
  }
}
