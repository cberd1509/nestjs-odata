import { Inject, Injectable } from '@nestjs/common'
import type { ODataQuery, ODataQueryResult, EdmEntityType } from '@nestjs-odata/core'
import {
  EdmRegistry,
  ODATA_MODULE_OPTIONS,
  type ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
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

    const qb = this.translator.translate(fetchQuery, entityType)

    const includeCount = query.count === true
    const rawResult = await this.translator.execute(qb, includeCount)

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

    const qb = this.translator.translate(countQuery, entityType)
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
}
