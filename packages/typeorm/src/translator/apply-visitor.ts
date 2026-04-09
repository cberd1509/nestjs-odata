import type { SelectQueryBuilder, ObjectLiteral, Repository } from 'typeorm'
import type {
  EdmEntityType,
  ApplyNode,
  ApplyStep,
  AggregateExpression,
  FilterNode,
} from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'

/**
 * TypeOrmApplyVisitor — translates an OData $apply pipeline AST into
 * TypeORM SelectQueryBuilder GROUP BY / aggregate SQL.
 *
 * Handles three step types in pipeline order:
 * - ApplyFilter: delegates to TypeOrmFilterVisitor (adds WHERE clause)
 * - ApplyGroupBy: adds GROUP BY columns + aggregate SELECT expressions
 * - ApplyAggregate: adds aggregate SELECT expressions (no GROUP BY)
 *
 * Security: aggregate property names validated against AggregateExpression.method
 * enum (constrained by parser); aliases validated by parser regex before SQL use.
 * No user input is directly interpolated into SQL — property/alias names come
 * from the validated AST (T-11-05 mitigation).
 *
 * Returns projected column names (for @odata.context URL construction).
 */
export class TypeOrmApplyVisitor {
  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly alias: string,
    private readonly entityType: EdmEntityType,
    private readonly maxFilterDepth: number = 10,
    private readonly dialect: 'sqlite' | 'postgres' | 'ansi' = 'ansi',
    private readonly repo: Repository<ObjectLiteral>,
  ) {}

  /**
   * Process all steps in an $apply pipeline in order.
   * Returns all projected column names for @odata.context construction.
   */
  apply(applyNode: ApplyNode): string[] {
    const projectedColumns: string[] = []

    for (const step of applyNode.steps) {
      const stepColumns = this.applyStep(step)
      projectedColumns.push(...stepColumns)
    }

    return projectedColumns
  }

  // ── Private step handlers ───────────────────────────────────────────────────

  private applyStep(step: ApplyStep): string[] {
    switch (step.kind) {
      case 'ApplyFilter':
        return this.applyFilterStep(step.filter)
      case 'ApplyGroupBy':
        return this.applyGroupByStep(step.properties, step.aggregate)
      case 'ApplyAggregate':
        return this.applyAggregateStep(step.expressions)
    }
  }

  /**
   * ApplyFilter step — delegates to TypeOrmFilterVisitor.
   * Adds WHERE clause to the query. Returns no projected columns.
   */
  private applyFilterStep(filter: FilterNode): string[] {
    const visitor = new TypeOrmFilterVisitor(
      this.qb,
      this.alias,
      this.entityType,
      this.maxFilterDepth,
      this.dialect,
      this.repo,
    )
    visitor.visit(filter)
    return []
  }

  /**
   * ApplyGroupBy step — adds GROUP BY columns and optional aggregate expressions.
   * Clears existing SELECT first (replaces entity.* with explicit projections).
   */
  private applyGroupByStep(
    properties: string[],
    aggregate: readonly AggregateExpression[] | undefined,
  ): string[] {
    const projectedColumns: string[] = []

    // Clear entity.* default select
    this.qb.select([])

    // Add GROUP BY columns
    for (const prop of properties) {
      if (!this.entityType.properties.some((p) => p.name === prop)) {
        throw new Error(
          `Property '${prop}' does not exist on entity type '${this.entityType.name}'`,
        )
      }
      this.qb.addSelect(`${this.alias}.${prop}`, prop)
      this.qb.addGroupBy(`${this.alias}.${prop}`)
      projectedColumns.push(prop)
    }

    // Add aggregate expressions
    if (aggregate) {
      for (const expr of aggregate) {
        const sqlExpr = this.buildAggregateSql(expr)
        this.qb.addSelect(sqlExpr, expr.alias)
        projectedColumns.push(expr.alias)
      }
    }

    return projectedColumns
  }

  /**
   * ApplyAggregate step (no GROUP BY) — adds aggregate SELECT expressions.
   * Clears existing SELECT first (replaces entity.* with explicit projections).
   */
  private applyAggregateStep(expressions: readonly AggregateExpression[]): string[] {
    const projectedColumns: string[] = []

    // Clear entity.* default select
    this.qb.select([])

    for (const expr of expressions) {
      const sqlExpr = this.buildAggregateSql(expr)
      this.qb.addSelect(sqlExpr, expr.alias)
      projectedColumns.push(expr.alias)
    }

    return projectedColumns
  }

  /**
   * Build the SQL aggregate function expression for a single AggregateExpression.
   *
   * Method mapping:
   * - count with $count property => COUNT(*)
   * - count with field => COUNT(alias.field)
   * - sum => SUM(alias.field)
   * - avg => AVG(alias.field)
   * - min => MIN(alias.field)
   * - max => MAX(alias.field)
   * - countdistinct => COUNT(DISTINCT alias.field)
   */
  private buildAggregateSql(expr: AggregateExpression): string {
    const { property, method } = expr

    // Validate property name against EDM entity type before interpolating into SQL.
    // $count is the virtual OData count token — not a real property.
    if (property !== '$count' && !this.entityType.properties.some((p) => p.name === property)) {
      throw new Error(
        `Property '${property}' does not exist on entity type '${this.entityType.name}'`,
      )
    }

    switch (method) {
      case 'count':
        return property === '$count' ? 'COUNT(*)' : `COUNT(${this.alias}.${property})`
      case 'sum':
        return `SUM(${this.alias}.${property})`
      case 'avg':
        return `AVG(${this.alias}.${property})`
      case 'min':
        return `MIN(${this.alias}.${property})`
      case 'max':
        return `MAX(${this.alias}.${property})`
      case 'countdistinct':
        return `COUNT(DISTINCT ${this.alias}.${property})`
    }
  }
}
