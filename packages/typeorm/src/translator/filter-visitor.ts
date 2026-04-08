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

/** Map of OData arithmetic operators to SQL operators */
const ARITH_OPS: Record<string, string> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  divby: '/',
  mod: '%',
}

/** SQLite strftime format strings for date/time functions */
const DATE_STRFTIME: Record<string, string> = {
  year: '%Y',
  month: '%m',
  day: '%d',
  hour: '%H',
  minute: '%M',
  second: '%S',
}

/** ANSI/Postgres EXTRACT field names for date/time functions */
const DATE_EXTRACT: Record<string, string> = {
  year: 'YEAR',
  month: 'MONTH',
  day: 'DAY',
  hour: 'HOUR',
  minute: 'MINUTE',
  second: 'SECOND',
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
  /** Accumulated params from resolveExpression (e.g. arithmetic operands) to merge into andWhere */
  private pendingParams: Record<string, unknown> = {}

  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly alias: string,
    private readonly entityType: EdmEntityType,
    private readonly maxFilterDepth: number = 10,
    private readonly dialect: 'sqlite' | 'postgres' | 'ansi' = 'ansi',
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
            this.dialect,
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
            this.dialect,
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
      this.pendingParams = {}
      const leftExpr = this.resolveExpression(left)
      const paramName = this.nextParam()
      const literalValue = this.extractLiteralValue(right)
      const allParams = { ...this.pendingParams, [paramName]: literalValue }
      this.pendingParams = {}
      this.qb.andWhere(`${leftExpr} ${sqlOp} :${paramName}`, allParams)
      this.currentDepth--
      return
    }

    // Unsupported operator — skip (arithmetic ops would need different handling)
    this.currentDepth--
  }

  visitUnaryExpr(node: UnaryExprNode): void {
    if (node.operator === 'not') {
      const innerVisitor = new InnerFilterExprBuilder(
        this.alias,
        this.entityType,
        this.paramCount,
        this.dialect,
      )
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
    if (node.kind === 'BinaryExpr') {
      const sqlArith = ARITH_OPS[node.operator]
      if (sqlArith) {
        const left = this.resolveExpression(node.left)
        const right = this.resolveArithOperand(node.right)
        return `(${left} ${sqlArith} ${right})`
      }
    }
    if (node.kind === 'FunctionCall') {
      const fnName = node.name.toLowerCase()
      const dateResult = this.resolveDateFunction(fnName, node)
      if (dateResult !== null) return dateResult
      const strResult = this.resolveStringFunction(fnName, node)
      if (strResult !== null) return strResult
      const sqlFn = SCALAR_FUNCTIONS[fnName]
      if (sqlFn && node.args.length >= 1) {
        const inner = this.resolveExpression(node.args[0])
        return `${sqlFn}(${inner})`
      }
    }
    if (node.kind === 'Literal') {
      const paramName = this.nextParam()
      this.pendingParams[paramName] = node.value
      return `:${paramName}`
    }
    return ''
  }

  /** Resolve date/time function to dialect-correct SQL. Returns null if not a date function. */
  private resolveDateFunction(
    fnName: string,
    node: FilterNode & { kind: 'FunctionCall' },
  ): string | null {
    const strftimeFmt = DATE_STRFTIME[fnName]
    const extractField = DATE_EXTRACT[fnName]
    if (!strftimeFmt || !extractField) return null
    const inner = this.resolveExpression(node.args[0])
    if (this.dialect === 'sqlite') {
      return `CAST(strftime('${strftimeFmt}', ${inner}) AS INTEGER)`
    }
    return `EXTRACT(${extractField} FROM ${inner})`
  }

  /** Bind an arithmetic operand: Literal nodes become named params; others recurse. */
  private resolveArithOperand(node: FilterNode): string {
    if (node.kind === 'Literal') {
      const paramName = this.nextParam()
      this.pendingParams[paramName] = node.value
      return `:${paramName}`
    }
    return this.resolveExpression(node)
  }

  /** Resolve indexof/substring/concat to parameterized SQL. Returns null if not a string fn. */
  private resolveStringFunction(
    fnName: string,
    node: FilterNode & { kind: 'FunctionCall' },
  ): string | null {
    if (fnName === 'indexof' && node.args.length >= 2) {
      const str = this.resolveExpression(node.args[0])
      const subParam = this.nextParam()
      this.pendingParams[subParam] = (node.args[1] as LiteralNode).value
      const sqlFn = this.dialect === 'sqlite' ? 'INSTR' : 'STRPOS'
      return `${sqlFn}(${str}, :${subParam}) - 1`
    }
    if (fnName === 'substring' && node.args.length >= 2) {
      const str = this.resolveExpression(node.args[0])
      const startParam = this.nextParam()
      this.pendingParams[startParam] = ((node.args[1] as LiteralNode).value as number) + 1
      if (node.args.length >= 3) {
        const lenParam = this.nextParam()
        this.pendingParams[lenParam] = (node.args[2] as LiteralNode).value
        return `SUBSTR(${str}, :${startParam}, :${lenParam})`
      }
      return `SUBSTR(${str}, :${startParam})`
    }
    if (fnName === 'concat' && node.args.length >= 2) {
      const left = this.resolveExpression(node.args[0])
      const right = this.resolveExpression(node.args[1])
      return `${left} || ${right}`
    }
    return null
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
    private readonly dialect: 'sqlite' | 'postgres' | 'ansi' = 'ansi',
  ) {
    this.paramCount = startCount
  }

  build(node: FilterNode): { expr: string; params: Record<string, unknown>; finalCount: number } {
    const expr = this.buildExpr(node)
    return { expr, params: this.params, finalCount: this.paramCount }
  }

  private buildExpr(node: FilterNode): string {
    if (node.kind === 'BinaryExpr') {
      const sqlArith = ARITH_OPS[node.operator]
      if (sqlArith) {
        const left = this.buildExpr(node.left)
        const right = this.resolveArithOperand(node.right)
        return `(${left} ${sqlArith} ${right})`
      }
      const sqlOp = COMPARISON_OPS[node.operator]
      if (sqlOp) {
        const left = this.buildExpr(node.left)
        const right = this.buildExpr(node.right)
        return `${left} ${sqlOp} ${right}`
      }
    }
    if (node.kind === 'FunctionCall') {
      const name = node.name.toLowerCase()
      if (name === 'contains' || name === 'startswith' || name === 'endswith') {
        const prop = this.buildExpr(node.args[0])
        const rawValue = String(node.args[1]?.kind === 'Literal' ? node.args[1].value : '')
        const escaped = rawValue.replace(/%/g, '\\%').replace(/_/g, '\\_')
        let pattern: string
        if (name === 'contains') {
          pattern = `%${escaped}%`
        } else if (name === 'startswith') {
          pattern = `${escaped}%`
        } else {
          pattern = `%${escaped}`
        }
        this.paramCount++
        const paramName = `p${this.paramCount}`
        this.params[paramName] = pattern
        return `${prop} LIKE :${paramName}`
      }
      const dateResult = this.resolveDateFunction(name, node)
      if (dateResult !== null) return dateResult
      const strResult = this.resolveStringFunction(name, node)
      if (strResult !== null) return strResult
      const sqlFn = SCALAR_FUNCTIONS[name]
      if (sqlFn && node.args.length >= 1) {
        const inner = this.buildExpr(node.args[0])
        return `${sqlFn}(${inner})`
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

  /** Resolve date/time function to dialect-correct SQL. Returns null if not a date function. */
  private resolveDateFunction(
    fnName: string,
    node: FilterNode & { kind: 'FunctionCall' },
  ): string | null {
    const strftimeFmt = DATE_STRFTIME[fnName]
    const extractField = DATE_EXTRACT[fnName]
    if (!strftimeFmt || !extractField) return null
    const inner = this.buildExpr(node.args[0])
    if (this.dialect === 'sqlite') {
      return `CAST(strftime('${strftimeFmt}', ${inner}) AS INTEGER)`
    }
    return `EXTRACT(${extractField} FROM ${inner})`
  }

  /** Resolve indexof/substring/concat to parameterized SQL. Returns null if not a string fn. */
  private resolveStringFunction(
    fnName: string,
    node: FilterNode & { kind: 'FunctionCall' },
  ): string | null {
    if (fnName === 'indexof' && node.args.length >= 2) {
      const str = this.buildExpr(node.args[0])
      this.paramCount++
      const subParam = `p${this.paramCount}`
      this.params[subParam] = (node.args[1] as LiteralNode).value
      const sqlFn = this.dialect === 'sqlite' ? 'INSTR' : 'STRPOS'
      return `${sqlFn}(${str}, :${subParam}) - 1`
    }
    if (fnName === 'substring' && node.args.length >= 2) {
      const str = this.buildExpr(node.args[0])
      this.paramCount++
      const startParam = `p${this.paramCount}`
      this.params[startParam] = ((node.args[1] as LiteralNode).value as number) + 1
      if (node.args.length >= 3) {
        this.paramCount++
        const lenParam = `p${this.paramCount}`
        this.params[lenParam] = (node.args[2] as LiteralNode).value
        return `SUBSTR(${str}, :${startParam}, :${lenParam})`
      }
      return `SUBSTR(${str}, :${startParam})`
    }
    if (fnName === 'concat' && node.args.length >= 2) {
      const left = this.buildExpr(node.args[0])
      const right = this.buildExpr(node.args[1])
      return `${left} || ${right}`
    }
    return null
  }

  /** Bind an arithmetic operand: Literal nodes become named params; others recurse via buildExpr. */
  private resolveArithOperand(node: FilterNode): string {
    if (node.kind === 'Literal') {
      this.paramCount++
      const paramName = `p${this.paramCount}`
      this.params[paramName] = node.value
      return `:${paramName}`
    }
    return this.buildExpr(node)
  }
}
