import type { SelectQueryBuilder, ObjectLiteral } from 'typeorm'
import type { OrderByItem } from '@nestjs-odata/core'

/**
 * TypeOrmOrderByVisitor — translates OData $orderby items into TypeORM
 * QueryBuilder.orderBy() / addOrderBy() calls.
 */
export class TypeOrmOrderByVisitor {
  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly alias: string,
  ) {}

  /**
   * Apply $orderby items to the QueryBuilder.
   * First item uses orderBy(), subsequent items use addOrderBy().
   */
  apply(items: OrderByItem[]): void {
    if (!items.length) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const propertyName = this.resolvePropertyName(item)
      const direction = item.direction.toUpperCase() as 'ASC' | 'DESC'
      const column = `${this.alias}.${propertyName}`

      if (i === 0) {
        this.qb.orderBy(column, direction)
      } else {
        this.qb.addOrderBy(column, direction)
      }
    }
  }

  private resolvePropertyName(item: OrderByItem): string {
    const expr = item.expression
    if (expr.kind === 'PropertyAccess') {
      return expr.path[0]
    }
    return ''
  }
}
