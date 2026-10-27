import type { ObjectLiteral } from 'typeorm'

/**
 * Apply post-JOIN pagination to expanded collections.
 *
 * TypeORM hydrates relations as JavaScript arrays. After getMany(), this function slices each
 * expanded collection by the $top/$skip of its expand item. The map is keyed by expand path
 * (`items`, `store/items`, `labels/items`), so two expand items ending in the same navigation
 * property keep their own options; collections are followed at every level of the path.
 *
 * Only expansions the translator could not page in SQL are listed (see `TypeOrmExpandVisitor`):
 * many-to-many navigations, composite keys and drivers without window functions. The result
 * set is already bounded by maxTop and maxExpandDepth before slicing occurs (T-05-10 accept).
 *
 * Mutates items in-place — the hydrated array is replaced with the sliced version.
 */
export function applyExpandPagination(
  items: ObjectLiteral[],
  paginationMap: ReadonlyMap<string, { readonly skip?: number; readonly top?: number }>,
): void {
  for (const [path, { skip = 0, top }] of paginationMap.entries()) {
    const segments = path.split('/')
    const navProp = segments[segments.length - 1]
    for (const item of entitiesAt(items, segments.slice(0, -1))) {
      const related = item[navProp]
      if (Array.isArray(related)) {
        item[navProp] = related.slice(skip, top !== undefined ? skip + top : undefined)
      }
    }
  }
}

/** The entities at `path` below `items`, following single values and collections. */
export function entitiesAt(
  items: readonly ObjectLiteral[],
  path: readonly string[],
): ObjectLiteral[] {
  let current = [...items]
  for (const segment of path) {
    const next: ObjectLiteral[] = []
    for (const entity of current) {
      const value: unknown = entity[segment]
      if (Array.isArray(value)) next.push(...(value as ObjectLiteral[]))
      else if (value !== null && typeof value === 'object') next.push(value as ObjectLiteral)
    }
    current = next
  }
  return current
}
