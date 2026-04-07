import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { ODataQuery, ODataQueryResult } from '../query/odata-query.types.js'

/**
 * IQueryTranslator — adapter seam interface for ORM-specific query translation.
 *
 * Implementations live in adapter packages (e.g., @nestjs-odata/typeorm).
 * The two-method design (translate + execute) separates AST-to-query translation
 * from query execution, enabling independent unit testing of each step.
 *
 * Generic parameter TQuery is the ORM-specific query type (e.g., TypeORM SelectQueryBuilder).
 */
export interface IQueryTranslator<TQuery = unknown> {
  /** Translate a typed OData query AST into an ORM-specific query object */
  translate(query: ODataQuery, entityType: EdmEntityType): TQuery
  /** Execute the translated query and return structured results */
  execute(translatedQuery: TQuery, includeCount: boolean): Promise<ODataQueryResult>
}

/** NestJS injection token for IQueryTranslator */
export const QUERY_TRANSLATOR = Symbol('QUERY_TRANSLATOR')
