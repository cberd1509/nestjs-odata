/**
 * OData v4 parser public API.
 * Exports AST types, visitor interface, error types, and query parsing functions.
 */

export * from './ast.js'
export * from './visitor.js'
export * from './errors.js'

import type { FilterNode, QueryOptions } from './ast.js'

// parseQuery and parseFilter will be implemented in Task 2 (GREEN phase)
export function parseQuery(query: string): QueryOptions {
  void query
  throw new Error('Not implemented — TDD RED phase')
}

export function parseFilter(filter: string): FilterNode {
  void filter
  throw new Error('Not implemented — TDD RED phase')
}
