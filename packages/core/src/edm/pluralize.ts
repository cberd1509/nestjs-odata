import pluralize from 'pluralize'

/**
 * Pluralize an entity class name to produce an EntitySet name.
 * Uses the `pluralize` library which handles irregular forms (Person → People,
 * Category → Categories, Index → Indices, etc.).
 *
 * @param name - Entity class name in PascalCase (e.g., 'Product', 'OrderItem')
 * @returns Pluralized entity set name (e.g., 'Products', 'OrderItems')
 */
export function pluralizeEntityName(name: string): string {
  return pluralize(name)
}
