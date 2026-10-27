import type { SelectQueryBuilder, ObjectLiteral } from 'typeorm'
import type { EdmEntityType, SelectNode } from '@nestjs-odata/core'

/**
 * TypeOrmSelectVisitor — translates an OData $select node into a TypeORM
 * SelectQueryBuilder.select() call.
 *
 * Key properties (primary keys) are always included in the projection even if
 * not in the $select list (T-03-06 mitigation — avoids identity column gaps).
 */
export class TypeOrmSelectVisitor {
  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly alias: string,
    private readonly entityType: EdmEntityType,
  ) {}

  /**
   * Apply the $select projection to the QueryBuilder.
   *
   * - If select.all is true or select.items is absent/empty, do nothing (return all columns).
   * - Otherwise, build a deduplicated column list and call qb.select().
   */
  apply(select: SelectNode): void {
    const columns = this.columns(select)
    if (columns.length > 0) this.qb.select(columns)
  }

  /**
   * The columns a `$select` projects, as `alias.property`: the requested properties plus the
   * key properties (entity identity is always available), deduplicated in order. Empty when
   * the selection is `*` or absent (all columns).
   */
  columns(select: SelectNode): string[] {
    if (select.all || !select.items?.length) return []
    const columns = [
      ...select.items.map((item) => `${this.alias}.${item.path[0]}`),
      ...this.entityType.keyProperties.map((key) => `${this.alias}.${key}`),
    ]
    return [...new Set(columns)]
  }
}
