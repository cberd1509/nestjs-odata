import type { EntityManager, EntityMetadata } from 'typeorm'
import { ODataValidationError } from '@nestjs-odata/core'
import { scopeInCondition } from '../scope/typeorm-scope.service.js'
import type { ScopedSubquery } from '../scope/scope.types.js'

/**
 * Looks up the row-level scope of an entity set reached from `$filter`, by its navigation path
 * from the filtered entity, with segments joined by `/` (`items` for `items/any(...)`,
 * `category` and `category/group` for `category/group/name`).
 */
export type FilterScopeLookup = (navigationPath: string) => ScopedSubquery | undefined

/** The entity a property path in `$filter` starts at. */
export interface PathBinding {
  /** TypeORM metadata of that entity. */
  readonly metadata: EntityMetadata
  /** Render one of its columns, by database name, as SQL (alias included). */
  readonly column: (databaseName: string) => string
  /** Navigation path from the filtered entity set to this entity, for scope lookups. */
  readonly scopePath: readonly string[]
}

let aliasSequence = 0

/** Escape a table path (`schema.table` or `table`) for the driver of `manager`. */
export function escapeTablePath(manager: EntityManager, metadata: EntityMetadata): string {
  const escape = (name: string) => manager.connection.driver.escape(name)
  return metadata.tablePath.split('.').map(escape).join('.')
}

/**
 * Render a property path through single-valued navigation properties (`category/group/name`,
 * P2 §5.1.1.15) as a correlated scalar subquery:
 *
 *   (SELECT n1.name FROM category n0 INNER JOIN group n1 ON ... AND <scope of group>
 *    WHERE n0.id = <outer>.categoryId AND <scope of category>)
 *
 * It is NULL when a related entity is missing or outside its row-level scope, like a LEFT
 * JOIN, but composes anywhere an expression can go (`or`, `not`, functions, lambda predicates,
 * nested `$expand` filters). Every identifier comes from the TypeORM metadata; the path is only
 * used to look them up, never interpolated.
 */
export function renderNavigationPath(
  manager: EntityManager,
  binding: PathBinding,
  path: readonly string[],
  scope: FilterScopeLookup | undefined,
): { sql: string; params: Record<string, unknown> } {
  const escape = (name: string) => manager.connection.driver.escape(name)
  const relations = []
  let metadata = binding.metadata
  for (const segment of path.slice(0, -1)) {
    const relation = metadata.findRelationWithPropertyPath(segment)
    if (!relation || !(relation.isManyToOne || relation.isOneToOne)) {
      throw new ODataValidationError(
        `'${segment}' is not a single-valued navigation property of '${metadata.name}'`,
        metadata.name,
        segment,
      )
    }
    relations.push(relation)
    metadata = relation.inverseEntityMetadata
  }
  const property = path[path.length - 1]
  const column = metadata.findColumnWithPropertyPath(property)
  if (!column || relations.length === 0) {
    throw new ODataValidationError(
      `Property '${property}' not found on entity '${metadata.name}'`,
      metadata.name,
      property,
    )
  }

  const id = ++aliasSequence
  const aliases = relations.map((_, i) => `odata_nav${id}_${i}`)
  const params: Record<string, unknown> = {}
  const scopeCondition = (index: number): string | undefined => {
    const navigationPath = [...binding.scopePath, ...path.slice(0, index + 1)].join('/')
    const scoped = scope?.(navigationPath)
    if (!scoped) return undefined
    Object.assign(params, scoped.params)
    return scopeInCondition(scoped, (c) => `${aliases[index]}.${escape(c.databaseName)}`)
  }

  const [first] = relations
  const qb = manager
    .createQueryBuilder(first.inverseEntityMetadata.target, aliases[0])
    .select(`${aliases[aliases.length - 1]}.${escape(column.databaseName)}`)
  for (let i = 1; i < relations.length; i++) {
    qb.innerJoin(`${aliases[i - 1]}.${relations[i].propertyPath}`, aliases[i], scopeCondition(i))
  }

  // Correlate the first related entity with the entity the path starts at.
  const correlation = first.isOwning
    ? first.joinColumns.map(
        (jc) =>
          `${aliases[0]}.${escape(jc.referencedColumn!.databaseName)} = ${binding.column(jc.databaseName)}`,
      )
    : first.inverseRelation!.joinColumns.map(
        (jc) =>
          `${aliases[0]}.${escape(jc.databaseName)} = ${binding.column(jc.referencedColumn!.databaseName)}`,
      )
  qb.where(correlation.join(' AND '))
  const firstScope = scopeCondition(0)
  if (firstScope) qb.andWhere(firstScope)

  return { sql: `(${qb.getQuery()})`, params }
}
