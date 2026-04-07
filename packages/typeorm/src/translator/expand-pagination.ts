import type { ObjectLiteral } from 'typeorm'

/**
 * Apply post-JOIN pagination to expanded collections.
 *
 * TypeORM hydrates relations as JavaScript arrays. After getMany(),
 * this function slices each expanded collection by the per-expand-item
 * $top/$skip values recorded during ExpandVisitor traversal.
 *
 * Per D-13: In-memory slicing is the v1 approach. Acceptable for
 * single-level expand pagination. Total result set is already bounded
 * by maxTop and maxExpandDepth before slicing occurs (T-05-10 accept).
 *
 * Mutates items in-place — the hydrated array is replaced with the sliced
 * version. This avoids allocating a new top-level array.
 */
export function applyExpandPagination(
  items: ObjectLiteral[],
  paginationMap: ReadonlyMap<string, { readonly skip?: number; readonly top?: number }>,
): void {
  for (const [navProp, { skip = 0, top }] of paginationMap.entries()) {
    for (const item of items) {
      const related = item[navProp]
      if (Array.isArray(related)) {
        item[navProp] = related.slice(skip, top !== undefined ? skip + top : undefined)
      }
    }
  }
}
