/**
 * Core OData query type definitions.
 * These types form the contract between the ODataQueryPipe and IQueryTranslator.
 *
 * ODataQuery extends the parser's QueryOptions with:
 *   - count (boolean): from $count=true query param (parser doesn't handle this yet)
 *   - entitySetName (string): for context URL construction and field validation
 */

import type { FilterNode, SelectNode, OrderByItem, ExpandNode } from '../parser/ast.js'

/**
 * Per-entity security option overrides.
 * When set via EdmRegistry, these take precedence over global ODataModuleOptions values.
 *
 * Per D-07: allows individual entity sets to have tighter (or looser) limits than the
 * global defaults without modifying the global config.
 */
export interface ODataEntitySecurityOptions {
  readonly maxTop?: number
  readonly maxExpandDepth?: number
  readonly maxFilterDepth?: number
}

/**
 * Typed OData query object produced by ODataQueryPipe.
 * All optional fields are only present when the corresponding query option
 * was supplied in the request.
 *
 * Per D-14: entitySetName is required for context URL and validation.
 */
export interface ODataQuery {
  readonly filter?: FilterNode
  readonly select?: SelectNode
  readonly orderBy?: OrderByItem[]
  readonly top?: number
  readonly skip?: number
  /** True when $count=true was present in the query string */
  readonly count?: boolean
  /** Name of the entity set — required for context URL construction and field validation */
  readonly entitySetName: string
  /** Parsed $expand value — navigation properties to expand */
  readonly expand?: ExpandNode
}

/**
 * Result of executing a translated OData query.
 * Used by IQueryTranslator.execute() to return structured data to the controller.
 *
 * select is included so the controller can build the correct @odata.context URL.
 */
export interface ODataQueryResult<T = unknown> {
  readonly items: T[]
  readonly count?: number
  readonly nextLink?: string
  readonly select?: SelectNode
}
