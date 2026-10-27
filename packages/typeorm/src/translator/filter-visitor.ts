import {
  Brackets,
  type EntityManager,
  type SelectQueryBuilder,
  type ObjectLiteral,
  type Repository,
} from 'typeorm'
import type { SqlDialect } from './sql-dialect.js'
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
import type { RelationMetadata } from 'typeorm'
import { ODataNotImplementedError } from '@nestjs-odata/core'
import { scopeInCondition } from '../scope/typeorm-scope.service.js'
import {
  escapeTablePath,
  renderNavigationPath,
  type FilterScopeLookup,
  type PathBinding,
} from './navigation-path.js'

/**
 * Looks up the row-level scope of an entity set reached from `$filter` (the collection a lambda
 * `any`/`all` ranges over, or a single-valued navigation in a property path), by its
 * navigation path from the filtered entity with segments joined by `/` (`items`,
 * `category/group`). See `TypeOrmScopeService.prepare()`.
 */
export type LambdaScopeLookup = FilterScopeLookup

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
    private readonly dialect: SqlDialect = 'ansi',
    private readonly repo?: Repository<ObjectLiteral>,
    private readonly lambdaScope?: LambdaScopeLookup,
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
      // `(left) OR (right)`: each side is visited into its own bracket (its conditions are
      // AND-ed inside it), and the two brackets are OR-ed.
      const visitSide = (side: FilterNode) =>
        new Brackets((qb) => {
          const visitor = new TypeOrmFilterVisitor(
            qb as SelectQueryBuilder<ObjectLiteral>,
            this.alias,
            this.entityType,
            this.maxFilterDepth,
            this.dialect,
            this.repo,
            this.lambdaScope,
          )
          visitor.paramCount = this.paramCount
          visitor.currentDepth = depthAtEntry
          acceptVisitor(side, visitor)
          this.paramCount = visitor.paramCount
        })
      this.qb.andWhere(
        new Brackets((qb) => {
          qb.where(visitSide(left))
          qb.orWhere(visitSide(right))
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
      const root = this.rootBinding()
      const innerVisitor = new InnerFilterExprBuilder(
        this.alias,
        this.entityType,
        this.paramCount,
        this.dialect,
        null,
        undefined,
        { context: this.pathContext(), inner: root, outer: root },
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

  visitLambdaExpr(node: LambdaExprNode): void {
    if (!this.repo) return // no metadata available — skip (test isolation fallback)

    const relation = this.repo.metadata.relations.find(
      (r) => r.propertyName.toLowerCase() === node.collection.toLowerCase(),
    )
    if (!relation) return // unknown relation — skip silently

    if (node.operator === 'all' && !node.predicate) {
      // vacuous truth — add no condition
      return
    }

    this.paramCount++ // reserve one count for alias suffix to prevent collision
    const subAlias = `${node.variable ?? 'sub'}_lambda_${this.paramCount}`

    if (relation.isManyToMany) {
      this.visitManyToManyLambda(node, relation, subAlias)
      return
    }

    const targetTable = relation.inverseEntityMetadata.tableName
    // For OneToMany: FK lives on related side — use inverseRelation.joinColumns
    const fkCol =
      relation.inverseRelation?.joinColumns[0]?.databaseName ??
      relation.joinColumns[0]?.databaseName ??
      'id'
    const pkCol = this.repo.metadata.primaryColumns[0]?.databaseName ?? 'id'

    // Row-level scope of the target entity set: only rows inside it count for any/all.
    const escapeColumn = (name: string): string => this.repo!.manager.dataSource.driver.escape(name)
    const scoped = this.lambdaScope?.(relation.propertyName)
    const scope = scoped
      ? {
          sql: ` AND ${scopeInCondition(scoped, (c) => `${subAlias}.${escapeColumn(c.databaseName)}`)}`,
          params: scoped.params,
        }
      : { sql: '', params: {} }

    const source = `"${targetTable}" ${subAlias}`
    const correlate = `${subAlias}.${fkCol} = ${this.alias}.${pkCol}${scope.sql}`
    const range = { source, correlate, params: scope.params }
    if (node.operator === 'any') {
      this.buildAnyClause(node, subAlias, relation, range)
    } else {
      this.buildAllClause(node, subAlias, relation, range)
    }
  }

  /**
   * Lambda over a many-to-many navigation: the subquery ranges over the junction table joined
   * to the target, correlated with the outer entity through the junction's columns. The
   * target's row-level scope applies as for one-to-many lambdas.
   */
  private visitManyToManyLambda(
    node: LambdaExprNode,
    relation: RelationMetadata,
    subAlias: string,
  ): void {
    const manager = this.repo!.manager
    const escape = (name: string): string => manager.connection.driver.escape(name)
    const owning = relation.isOwning ? relation : relation.inverseRelation
    const junction = relation.junctionEntityMetadata ?? owning?.junctionEntityMetadata
    if (!owning || !junction) {
      throw new ODataNotImplementedError(
        `Lambda expressions on '${relation.propertyPath}' (a many-to-many relation without a ` +
          'junction table) are not supported',
      )
    }
    // Junction columns referencing this entity, and the ones referencing the target.
    const ownerColumns = relation.isOwning ? owning.joinColumns : owning.inverseJoinColumns
    const targetColumns = relation.isOwning ? owning.inverseJoinColumns : owning.joinColumns
    const junctionAlias = `${subAlias}_j`
    const target = relation.inverseEntityMetadata
    const on = targetColumns
      .map(
        (c) =>
          `${subAlias}.${escape(c.referencedColumn!.databaseName)} = ${junctionAlias}.${escape(c.databaseName)}`,
      )
      .join(' AND ')
    const source =
      `${escapeTablePath(manager, junction)} ${junctionAlias} ` +
      `INNER JOIN ${escapeTablePath(manager, target)} ${subAlias} ON ${on}`

    const scoped = this.lambdaScope?.(relation.propertyName)
    const correlation = ownerColumns.map(
      (c) =>
        `${junctionAlias}.${escape(c.databaseName)} = ${escape(this.alias)}.${escape(c.referencedColumn!.databaseName)}`,
    )
    if (scoped) {
      correlation.push(scopeInCondition(scoped, (c) => `${subAlias}.${escape(c.databaseName)}`))
    }
    const range = { source, correlate: correlation.join(' AND '), params: scoped?.params ?? {} }
    if (node.operator === 'any') {
      this.buildAnyClause(node, subAlias, relation, range)
    } else {
      this.buildAllClause(node, subAlias, relation, range)
    }
  }

  private buildAnyClause(
    node: LambdaExprNode,
    subAlias: string,
    relation: RelationMetadata,
    range: LambdaRange,
  ): void {
    const { source, correlate } = range

    if (!node.predicate) {
      // any() — check collection is non-empty
      this.qb.andWhere(`EXISTS (SELECT 1 FROM ${source} WHERE ${correlate})`, range.params)
      return
    }

    const result = this.lambdaPredicate(node, subAlias, relation)
    this.qb.andWhere(`EXISTS (SELECT 1 FROM ${source} WHERE ${correlate} AND ${result.expr})`, {
      ...range.params,
      ...result.params,
    })
  }

  private buildAllClause(
    node: LambdaExprNode,
    subAlias: string,
    relation: RelationMetadata,
    range: LambdaRange,
  ): void {
    // node.predicate is guaranteed non-null here (vacuous truth handled above)
    const result = this.lambdaPredicate(node, subAlias, relation)

    // all() ranges over the rows inside the scope only.
    const { source, correlate } = range
    this.qb.andWhere(
      `NOT EXISTS (SELECT 1 FROM ${source} WHERE ${correlate} AND NOT (${result.expr}))`,
      { ...range.params, ...result.params },
    )
  }

  /** Render a lambda predicate; paths after the range variable resolve on the target. */
  private lambdaPredicate(
    node: LambdaExprNode,
    subAlias: string,
    relation: RelationMetadata,
  ): { expr: string; params: Record<string, unknown> } {
    const escape = (name: string): string => this.repo!.manager.connection.driver.escape(name)
    const inner: PathBinding = {
      metadata: relation.inverseEntityMetadata,
      column: (db) => `${subAlias}.${escape(db)}`,
      scopePath: [relation.propertyName],
    }
    const builder = new InnerFilterExprBuilder(
      subAlias,
      this.entityType,
      this.paramCount,
      this.dialect,
      node.variable,
      this.alias,
      { context: this.pathContext(), inner, outer: this.rootBinding() },
    )
    const result = builder.build(node.predicate!)
    this.paramCount = result.finalCount
    return result
  }

  /** The entity this visitor filters, as the start of navigation paths. */
  private rootBinding(): PathBinding | undefined {
    if (!this.repo) return undefined
    const escape = (name: string): string => this.repo!.manager.connection.driver.escape(name)
    return {
      metadata: this.repo.metadata,
      column: (db) => `${escape(this.alias)}.${escape(db)}`,
      scopePath: [],
    }
  }

  private pathContext(): PathContext | undefined {
    return this.repo ? { manager: this.repo.manager, scope: this.lambdaScope } : undefined
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
      if (node.path.length > 1) {
        const rendered = renderPath(this.pathContext(), this.rootBinding(), node.path)
        Object.assign(this.pendingParams, rendered.params)
        return rendered.sql
      }
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
    this.pendingParams = {}
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
    const params = { ...this.pendingParams, [paramName]: pattern }
    this.pendingParams = {}
    this.qb.andWhere(`${prop} LIKE :${paramName}`, params)
  }

  /**
   * Escape LIKE special characters to prevent wildcard injection (T-03-05).
   * % -> \%, _ -> \_
   */
  private escapeLike(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
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
    private readonly dialect: SqlDialect = 'ansi',
    /** Lambda range variable (`t` in `any(t: t/title eq 'x')`); `t/title` maps to `alias.title`. */
    private readonly lambdaVariable: string | null = null,
    /**
     * Alias of the entity the lambda is evaluated on. Inside a lambda, a path without the range
     * variable (`ownerId` in `any(t: t/done eq true and ownerId eq 5)`) refers to that entity.
     */
    private readonly outerAlias?: string,
    /** Where navigation paths start, for the range variable (`inner`) and the outer entity. */
    private readonly paths?: {
      readonly context: PathContext | undefined
      readonly inner: PathBinding | undefined
      readonly outer: PathBinding | undefined
    },
  ) {
    this.paramCount = startCount
  }

  build(node: FilterNode): { expr: string; params: Record<string, unknown>; finalCount: number } {
    const expr = this.buildExpr(node)
    return { expr, params: this.params, finalCount: this.paramCount }
  }

  private buildExpr(node: FilterNode): string {
    if (node.kind === 'BinaryExpr' && (node.operator === 'and' || node.operator === 'or')) {
      const op = node.operator === 'and' ? 'AND' : 'OR'
      return `(${this.buildExpr(node.left)} ${op} ${this.buildExpr(node.right)})`
    }
    if (node.kind === 'UnaryExpr' && node.operator === 'not') {
      return `NOT (${this.buildExpr(node.operand)})`
    }
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
        const escaped = rawValue.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
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
      let alias = this.alias
      let segments = node.path
      let binding = this.paths?.inner
      if (this.lambdaVariable) {
        if (node.path.length > 1 && node.path[0] === this.lambdaVariable) {
          segments = node.path.slice(1)
        } else {
          alias = this.outerAlias ?? this.alias
          binding = this.paths?.outer
        }
      }
      if (segments.length > 1) {
        const rendered = renderPath(this.paths?.context, binding, segments)
        Object.assign(this.params, rendered.params)
        return rendered.sql
      }
      return `${alias}.${segments[0]}`
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

/** What rendering navigation paths needs besides the binding. */
interface PathContext {
  readonly manager: EntityManager
  readonly scope: FilterScopeLookup | undefined
}

/** The rows a lambda ranges over: `FROM <source> WHERE <correlate>`, with the scope params. */
interface LambdaRange {
  readonly source: string
  readonly correlate: string
  readonly params: Readonly<Record<string, unknown>>
}

/** Render a navigation path, or fail when the visitor has no TypeORM metadata to resolve it. */
function renderPath(
  context: PathContext | undefined,
  binding: PathBinding | undefined,
  path: readonly string[],
): { sql: string; params: Record<string, unknown> } {
  if (!context || !binding) {
    throw new ODataNotImplementedError(
      `Navigation paths ('${path.join('/')}') are not supported in this filter`,
    )
  }
  return renderNavigationPath(context.manager, binding, path, context.scope)
}
