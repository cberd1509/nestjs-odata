import type { EdmEntityType } from '../edm/edm-entity-type.js'

/**
 * IQueryTranslator — adapter seam interface for ORM-specific query translation.
 * Translates parsed OData query AST nodes into ORM-specific query objects.
 * Full signature will be refined in Phase 3 once the query builder is complete.
 * Implementations live in adapter packages (e.g., @nestjs-odata/typeorm).
 */
export interface IQueryTranslator {
  translate(query: unknown, entityType: EdmEntityType): unknown
}

/** NestJS injection token for IQueryTranslator */
export const QUERY_TRANSLATOR = Symbol('QUERY_TRANSLATOR')
