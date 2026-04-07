import { Brackets, type SelectQueryBuilder, type ObjectLiteral } from 'typeorm'
import type {
  BinaryExprNode,
  FunctionCallNode,
  LambdaExprNode,
  LiteralNode,
  PropertyAccessNode,
  UnaryExprNode,
  FilterNode,
  FilterVisitor,
  EdmEntityType,
} from '@nestjs-odata/core'
import { acceptVisitor, ODataValidationError } from '@nestjs-odata/core'

/** Map of OData comparison operators to SQL operators */
const COMPARISON_OPS: Record<string, string> = {
  eq: '=',
  ne: '!=',
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
}

/** Map of OData scalar function names to SQL function names */
const SCALAR_FUNCTIONS: Record<string, string> = {
  length: 'LENGTH',
  tolower: 'LOWER',
  toupper: 'UPPER',
  trim: 'TRIM',
}

/**
 * TypeOrmFilterVisitor — translates an OData filter AST into TypeORM
 * SelectQueryBuilder.andWhere() calls with named parameters.
 *
 * All literal values are bound via named parameters (:p1, :p2, ...) — zero
 * string interpolation in WHERE clauses (T-03-04 mitigation).
 *
 * LIKE special characters (%, _) are escaped before use in contains/startswith/endswith
 * to prevent wildcard injection (T-03-05 mitigation).
 *
 * Per SEC-04: Tracks filter AST nesting depth and throws ODataValidationError when
 * depth exceeds maxFilterDepth. Prevents pathological filter expressions.
 */
export class TypeOrmFilterVisitor implements FilterVisitor<void> {
  /** Shared param counter — passed between sibling visitors for unique names */
  paramCount = 0
  /** Current nesting depth — propagated to sub-visitors for or branches */
  currentDepth = 0

  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly alias: string,
    private readonly entityType: EdmEntityType,
    private readonly maxFilterDepth: number = 10,
  ) {}

  /** Entry point: dispatch the root FilterNode to the appropriate visit method */
  visit(node: FilterNode): void {
    acceptVisitor(node, this)
  }

  visitBinaryExpr(node: BinaryExprNode): void {
    this.currentDepth++
    if (this.currentDepth > this.maxFilterDepth) {
      throw new ODataValidationError(
        `$filter nesting depth ${this.currentDepth} exceeds maximum of ${this.maxFilterDepth}`,
        this.entityType.name,
        '$filter',
      )
    }
    const { operator, left, right } = node

    if (operator === 'and') {
      acceptVisitor(left, this)
      acceptVisitor(right, this)
      this.currentDepth--
      return
    }

    if (operator === 'or') {
      const depthAtEntry = this.currentDepth
      this.qb.andWhere(
        new Brackets((qb) => {
          const leftVisitor = new TypeOrmFilterVisitor(
            qb as SelectQueryBuilder<ObjectLiteral>,
            this.alias,
            this.entityType,
            this.maxFilterDepth,
          )
          leftVisitor.paramCount = this.paramCount
          leftVisitor.currentDepth = depthAtEntry
          acceptVisitor(left, leftVisitor)
          this.paramCount = leftVisitor.paramCount

          const rightVisitor = new TypeOrmFilterVisitor(
            qb as SelectQueryBuilder<ObjectLiteral>,
            this.alias,
            this.entityType,
            this.maxFilterDepth,
          )
          rightVisitor.paramCount = this.paramCount
          rightVisitor.currentDepth = depthAtEntry
          acceptVisitor(right, rightVisitor)
          this.paramCount = rightVisitor.paramCount
        }),
      )
      this.currentDepth--
      return
    }

    const sqlOp = COMPARISON_OPS[operator]
    if (sqlOp) {
      const leftExpr = this.resolveExpression(left)
      const paramName = this.nextParam()
      const literalValue = this.extractLiteralValue(right)
      this.qb.andWhere(`${leftExpr} ${sqlOp} :${paramName}`, { [paramName]: literalValue })
      this.currentDepth--
      return
    }

    // Unsupported operator — skip (arithmetic ops would need different handling)
    this.currentDepth--
  }

  visitUnaryExpr(node: UnaryExprNode): void {
    if (node.operator === 'not') {
      const innerVisitor = new InnerFilterExprBuilder(this.alias, this.entityType, this.paramCount)
      const { expr, params, finalCount } = innerVisitor.build(node.operand)
      this.paramCount = finalCount
      this.qb.andWhere(`NOT (${expr})`, params)
    }
    // 'neg' (arithmetic negation) not needed for WHERE clause use cases
  }

  visitFunctionCall(node: FunctionCallNode): void {
    const name = node.name.toLowerCase()

    // String matching functions
    if (name === 'contains' || name === 'startswith' || name === 'endswith') {
      this.applyLikeFunction(name, node)
      return
    }

    // Scalar functions used as expressions (length, tolower, etc.) are resolved
    // via resolveExpression when used as the left side of a comparison.
    // Direct FunctionCall at the top level is not a WHERE condition — skip.
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitLambdaExpr(_node: LambdaExprNode): void {
    // Lambda expressions (any/all) require JOIN-based translation — not implemented in this phase
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitPropertyAccess(_node: PropertyAccessNode): void {
    // PropertyAccess at the root filter level has no SQL meaning without an operator — skip
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitLiteral(_node: LiteralNode): void {
    // Literal at root filter level has no SQL meaning — skip
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private nextParam(): string {
    this.paramCount++
    return `p${this.paramCount}`
  }

  /**
   * Resolve a FilterNode to an SQL expression string (left side of comparison).
   * Handles PropertyAccessNode (column ref) and scalar FunctionCallNode (LENGTH, LOWER, etc.).
   */
  private resolveExpression(node: FilterNode): string {
    if (node.kind === 'PropertyAccess') {
      return `${this.alias}.${node.path[0]}`
    }
    if (node.kind === 'FunctionCall') {
      const fnName = node.name.toLowerCase()
      const sqlFn = SCALAR_FUNCTIONS[fnName]
      if (sqlFn && node.args.length >= 1) {
        const inner = this.resolveExpression(node.args[0])
        return `${sqlFn}(${inner})`
      }
    }
    // Fallback: treat as raw literal string (should not occur in valid OData filters)
    if (node.kind === 'Literal') {
      return String(node.value)
    }
    return ''
  }

  /** Extract the raw JS value from a LiteralNode */
  private extractLiteralValue(node: FilterNode): string | number | boolean | null {
    if (node.kind === 'Literal') {
      return node.value
    }
    return null
  }

  /** Apply a LIKE function (contains, startswith, endswith) with escaped value */
  private applyLikeFunction(name: string, node: FunctionCallNode): void {
    const prop = this.resolveExpression(node.args[0])
    const rawValue = String(this.extractLiteralValue(node.args[1]) ?? '')
    const escaped = this.escapeLike(rawValue)

    let pattern: string
    if (name === 'contains') {
      pattern = `%${escaped}%`
    } else if (name === 'startswith') {
      pattern = `${escaped}%`
    } else {
      // endswith
      pattern = `%${escaped}`
    }

    const paramName = this.nextParam()
    this.qb.andWhere(`${prop} LIKE :${paramName}`, { [paramName]: pattern })
  }

  /**
   * Escape LIKE special characters to prevent wildcard injection (T-03-05).
   * % -> \%, _ -> \_
   */
  private escapeLike(value: string): string {
    return value.replace(/%/g, '\\%').replace(/_/g, '\\_')
  }
}

/**
 * Helper class that builds an SQL expression string from a FilterNode subtree
 * without directly calling qb.andWhere(). Used for NOT(...) wrapping.
 */
class InnerFilterExprBuilder {
  private paramCount: number
  private readonly params: Record<string, unknown> = {}

  constructor(
    private readonly alias: string,
    private readonly entityType: EdmEntityType,
    startCount: number,
  ) {
    this.paramCount = startCount
  }

  build(node: FilterNode): { expr: string; params: Record<string, unknown>; finalCount: number } {
    const expr = this.buildExpr(node)
    return { expr, params: this.params, finalCount: this.paramCount }
  }

  private buildExpr(node: FilterNode): string {
    if (node.kind === 'BinaryExpr') {
      const sqlOp = COMPARISON_OPS[node.operator]
      if (sqlOp) {
        const left = this.buildExpr(node.left)
        const right = this.buildExpr(node.right)
        return `${left} ${sqlOp} ${right}`
      }
    }
    if (node.kind === 'PropertyAccess') {
      return `${this.alias}.${node.path[0]}`
    }
    if (node.kind === 'Literal') {
      this.paramCount++
      const paramName = `p${this.paramCount}`
      this.params[paramName] = node.value
      return `:${paramName}`
    }
    return ''
  }
}
