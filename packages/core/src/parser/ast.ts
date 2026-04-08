/**
 * OData v4 AST (Abstract Syntax Tree) node types.
 * All nodes use discriminated unions with a `kind` field as the discriminant.
 *
 * Per OData v4 Part 2 Section 5.1.1 — URL Conventions: $filter expressions.
 */

// ---------------------------------------------------------------------------
// Binary expression operators (comparison, logical, arithmetic)
// ---------------------------------------------------------------------------

/** Binary operator union — all OData v4 binary operators */
export type BinaryOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'has'
  | 'in'
  | 'and'
  | 'or'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'divby'
  | 'mod'

/** Unary operator union */
export type UnaryOperator = 'not' | 'neg'

/** Lambda operator — collection traversal */
export type LambdaOperator = 'any' | 'all'

/** Literal kind discriminant */
export type LiteralKind = 'string' | 'number' | 'boolean' | 'null' | 'guid' | 'dateTimeOffset'

// ---------------------------------------------------------------------------
// FilterNode — discriminated union of all filter expression node types
// ---------------------------------------------------------------------------

/** Binary expression: left op right (e.g., Price gt 5) */
export interface BinaryExprNode {
  readonly kind: 'BinaryExpr'
  readonly operator: BinaryOperator
  readonly left: FilterNode
  readonly right: FilterNode
}

/** Unary expression: op operand (e.g., not Active) */
export interface UnaryExprNode {
  readonly kind: 'UnaryExpr'
  readonly operator: UnaryOperator
  readonly operand: FilterNode
}

/** Function call: name(args...) (e.g., contains(Name,'widget')) */
export interface FunctionCallNode {
  readonly kind: 'FunctionCall'
  readonly name: string
  readonly args: FilterNode[]
}

/** Property access: path segments (e.g., Category/Name) */
export interface PropertyAccessNode {
  readonly kind: 'PropertyAccess'
  readonly path: string[]
}

/** Literal value: string, number, boolean, null, guid, dateTimeOffset */
export interface LiteralNode {
  readonly kind: 'Literal'
  readonly literalKind: LiteralKind
  readonly value: string | number | boolean | null
}

/**
 * Lambda expression: collection/lambda(variable:predicate)
 * e.g., Tags/any(t:t/Name eq 'electronics')
 * When predicate is null, represents Tags/any() (no predicate variant).
 */
export interface LambdaExprNode {
  readonly kind: 'LambdaExpr'
  readonly operator: LambdaOperator
  /** Collection property path (e.g., 'Tags') */
  readonly collection: string
  /** Lambda variable (e.g., 't'), null for zero-arg any() */
  readonly variable: string | null
  /** Lambda predicate expression, null for zero-arg any() */
  readonly predicate: FilterNode | null
}

/**
 * Union of all filter expression AST node types.
 * Use the `kind` discriminant for type narrowing.
 */
export type FilterNode =
  | BinaryExprNode
  | UnaryExprNode
  | FunctionCallNode
  | PropertyAccessNode
  | LiteralNode
  | LambdaExprNode

// ---------------------------------------------------------------------------
// OrderBy AST
// ---------------------------------------------------------------------------

/** Sort direction */
export type OrderByDirection = 'asc' | 'desc'

/** Single $orderby clause item */
export interface OrderByItem {
  readonly expression: FilterNode
  readonly direction: OrderByDirection
}

/** Parsed $orderby value */
export interface OrderByNode {
  readonly items: OrderByItem[]
}

// ---------------------------------------------------------------------------
// Select AST
// ---------------------------------------------------------------------------

/** Single $select path item (e.g., Name or Category/Name) */
export interface SelectItem {
  readonly path: string[]
}

/** Parsed $select value */
export interface SelectNode {
  /** Individual property paths — present when not SelectAll */
  readonly items?: SelectItem[]
  /** True when $select=* */
  readonly all?: boolean
}

// ---------------------------------------------------------------------------
// Expand AST
// ---------------------------------------------------------------------------

/** Single $expand item — one navigation property with optional nested query options */
export interface ExpandItem {
  readonly navigationProperty: string
  readonly filter?: FilterNode
  readonly select?: SelectNode
  readonly orderBy?: OrderByItem[]
  readonly top?: number
  readonly skip?: number
  readonly expand?: ExpandNode // recursive nested expand
}

/** Parsed $expand value — list of expand items */
export interface ExpandNode {
  readonly items: readonly ExpandItem[]
}

// ---------------------------------------------------------------------------
// QueryOptions — top-level parsed query aggregate
// ---------------------------------------------------------------------------

/**
 * Aggregate of parsed OData query option values.
 * Each field is optional — only present when the query string contains it.
 */
export interface QueryOptions {
  readonly filter?: FilterNode
  readonly orderBy?: OrderByItem[]
  readonly select?: SelectNode
  readonly top?: number
  readonly skip?: number
  readonly expand?: ExpandNode
}

// ---------------------------------------------------------------------------
// $search AST — OData v4 Part 2 Section 4.6
// ---------------------------------------------------------------------------

/** A single search term, optionally negated. Quoted phrases are stored as a single value. */
export interface SearchTermNode {
  readonly kind: 'SearchTerm'
  readonly value: string
  readonly negated?: boolean
}

/** Binary search expression combining two search nodes with AND or OR. */
export interface SearchBinaryNode {
  readonly kind: 'SearchBinary'
  readonly operator: 'AND' | 'OR'
  readonly left: SearchNode
  readonly right: SearchNode
}

/** Union of all $search expression node types. */
export type SearchNode = SearchTermNode | SearchBinaryNode

// ---------------------------------------------------------------------------
// $apply AST — OData v4 Extension for Data Aggregation (OASIS Part 2)
// ---------------------------------------------------------------------------

/**
 * A single aggregate method expression: `property with method as alias`
 * or `$count as alias` (property='$count', method='count').
 */
export interface AggregateExpression {
  readonly property: string
  readonly method: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countdistinct'
  readonly alias: string
}

/** filter() transformation step — applies a filter expression to the current set. */
export interface ApplyFilterStep {
  readonly kind: 'ApplyFilter'
  readonly filter: FilterNode
}

/**
 * groupby() transformation step — partitions by property list with optional
 * aggregate expressions inside.
 */
export interface ApplyGroupByStep {
  readonly kind: 'ApplyGroupBy'
  readonly properties: string[]
  readonly aggregate?: readonly AggregateExpression[]
}

/** aggregate() transformation step — computes aggregate values across the set. */
export interface ApplyAggregateStep {
  readonly kind: 'ApplyAggregate'
  readonly expressions: readonly AggregateExpression[]
}

/** Union of all $apply transformation step types. */
export type ApplyStep = ApplyFilterStep | ApplyGroupByStep | ApplyAggregateStep

/** Root $apply node — an ordered pipeline of transformation steps. */
export interface ApplyNode {
  readonly steps: readonly ApplyStep[]
}
