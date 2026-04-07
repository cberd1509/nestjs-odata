import type { SelectQueryBuilder, ObjectLiteral } from 'typeorm'

/**
 * TypeOrmPaginationVisitor — applies OData $top/$skip pagination to a TypeORM
 * SelectQueryBuilder via take() and skip().
 */
export class TypeOrmPaginationVisitor {
  constructor(private readonly qb: SelectQueryBuilder<ObjectLiteral>) {}

  /**
   * Apply pagination to the QueryBuilder.
   *
   * - top=0 is valid (returns empty result set) — applies take(0)
   * - undefined values are skipped (no call made)
   */
  paginate(top: number | undefined, skip: number | undefined): void {
    if (top !== undefined) {
      this.qb.take(top)
    }
    if (skip !== undefined) {
      this.qb.skip(skip)
    }
  }
}
