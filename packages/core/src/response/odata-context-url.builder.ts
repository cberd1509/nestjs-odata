import type { SelectNode } from '../parser/ast.js'

/**
 * Builds the OData v4 @odata.context URL per spec section 10.
 *
 * Format: {serviceRoot}/$metadata#{entitySetName}[(field1,field2,...)]
 * Single-entity format: {serviceRoot}/$metadata#{entitySetName}/$entity
 *
 * Per D-07: when $select has specific items (not all, not undefined),
 * a select projection suffix is appended.
 * Per D-05: when isSingleEntity is true, /$entity suffix is appended.
 *
 * @param serviceRoot - The OData service root path (e.g. '/odata')
 * @param entitySetName - The name of the entity set (e.g. 'Products')
 * @param select - Optional SelectNode from the parsed query
 * @param isSingleEntity - When true, appends /$entity suffix for single-entity responses
 */
export function buildContextUrl(
  serviceRoot: string,
  entitySetName: string,
  select?: SelectNode,
  isSingleEntity?: boolean,
): string {
  // Normalize: strip trailing slash from serviceRoot
  const root = serviceRoot.endsWith('/') ? serviceRoot.slice(0, -1) : serviceRoot
  const base = `${root}/$metadata#${entitySetName}`

  // Per D-05: single-entity responses use /$entity suffix
  if (isSingleEntity) {
    return `${base}/$entity`
  }

  // Per D-07: if select has specific items (not all, not undefined), append (Field1,Field2)
  if (select?.items?.length) {
    const fields = select.items.map((item) => item.path.join('/')).join(',')
    return `${base}(${fields})`
  }

  return base
}
