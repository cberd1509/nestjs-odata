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
    if (select.all || !select.items?.length) {
      return
    }

    const columns = select.items.map((item) => `${this.alias}.${item.path[0]}`)

    // Always include key properties — ensures entity identity is always available
    for (const key of this.entityType.keyProperties) {
      columns.push(`${this.alias}.${key}`)
    }

    // Deduplicate while preserving order
    const seen = new Set<string>()
    const deduplicated = columns.filter((col) => {
      if (seen.has(col)) return false
      seen.add(col)
      return true
    })

    this.qb.select(deduplicated)
  }
}
