import type { SearchNode } from '../parser/ast.js'

/**
 * Injection token for ISearchProvider.
 * Use this token when registering or injecting the search provider via NestJS DI.
 */
export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER')

/**
 * Interface for translating a parsed $search expression into a SQL condition.
 *
 * Implementations are adapter-specific (e.g., TypeOrmSearchProvider).
 * Core uses this interface without importing any ORM code.
 *
 * Returns null if the search cannot be applied (e.g., no searchable fields defined).
 */
export interface ISearchProvider {
  /**
   * Build a SQL WHERE condition fragment from a parsed $search expression.
   *
   * @param searchNode - The parsed $search AST node
   * @param entitySetName - The entity set being queried
   * @param alias - The query builder alias for the entity table
   * @returns An object with the SQL condition string and named parameters,
   *          or null if search cannot be applied
   */
  buildSearchCondition(
    searchNode: SearchNode,
    entitySetName: string,
    alias: string,
  ): { condition: string; params: Record<string, unknown> } | null
}
