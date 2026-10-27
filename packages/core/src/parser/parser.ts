/**
 * OData v4 recursive descent parser with Pratt/precedence-climbing for binary operators.
 *
 * Architecture:
 *   tokenize(input) -> Token[] -> Parser -> FilterNode AST
 *
 * Precedence table (lowest to highest binding power):
 *   1 — or       (left-associative)
 *   2 — and      (left-associative)
 *   3 — not      (prefix, handled in parsePrimary)
 *   4 — eq, ne, lt, le, gt, ge, has, in  (non-associative, treated as left)
 *   5 — add, sub (left-associative)
 *   6 — mul, div, divby, mod (left-associative)
 *   7 — neg unary minus (prefix, handled in parsePrimary)
 *
 * Security: Max nesting depth of 50 prevents stack overflow from deeply nested
 * parenthesized expressions per threat model T-01-09.
 */

import type {
  BinaryExprNode,
  BinaryOperator,
  ExpandItem,
  ExpandNode,
  FilterNode,
  FunctionCallNode,
  LambdaExprNode,
  LiteralNode,
  OrderByItem,
  PropertyAccessNode,
  QueryOptions,
  SelectItem,
  SelectNode,
  UnaryExprNode,
} from './ast.js'
import { ODataNotImplementedError, ODataParseError } from './errors.js'
import { tokenize, Token, TokenKind } from './lexer.js'
import { parseSearch } from './search-parser.js'

/** Maximum nesting depth for parenthesized expressions (DoS protection, T-01-09) */
const MAX_NESTING_DEPTH = 50

/**
 * Operator precedence levels.
 * Higher number = binds tighter.
 */
const PRECEDENCE: Partial<Record<TokenKind, number>> = {
  [TokenKind.OR]: 1,
  [TokenKind.AND]: 2,
  [TokenKind.EQ]: 4,
  [TokenKind.NE]: 4,
  [TokenKind.LT]: 4,
  [TokenKind.LE]: 4,
  [TokenKind.GT]: 4,
  [TokenKind.GE]: 4,
  [TokenKind.HAS]: 4,
  [TokenKind.IN]: 4,
  [TokenKind.ADD]: 5,
  [TokenKind.SUB]: 5,
  [TokenKind.MUL]: 6,
  [TokenKind.DIV]: 6,
  [TokenKind.DIVBY]: 6,
  [TokenKind.MOD]: 6,
}

/** Map from TokenKind to BinaryOperator string */
const BINARY_OP_MAP: Partial<Record<TokenKind, BinaryOperator>> = {
  [TokenKind.EQ]: 'eq',
  [TokenKind.NE]: 'ne',
  [TokenKind.LT]: 'lt',
  [TokenKind.LE]: 'le',
  [TokenKind.GT]: 'gt',
  [TokenKind.GE]: 'ge',
  [TokenKind.HAS]: 'has',
  [TokenKind.IN]: 'in',
  [TokenKind.AND]: 'and',
  [TokenKind.OR]: 'or',
  [TokenKind.ADD]: 'add',
  [TokenKind.SUB]: 'sub',
  [TokenKind.MUL]: 'mul',
  [TokenKind.DIV]: 'div',
  [TokenKind.DIVBY]: 'divby',
  [TokenKind.MOD]: 'mod',
}

/**
 * Known OData v4 built-in functions that the parser validates.
 * Prevents arbitrary function names from being silently accepted.
 */
const KNOWN_FUNCTIONS = new Set([
  'startswith',
  'endswith',
  'contains',
  'indexof',
  'substring',
  'length',
  'tolower',
  'toupper',
  'trim',
  'concat',
  'matchesPattern',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'fractionalseconds',
  'totaloffsetminutes',
  'date',
  'time',
  'now',
  'mindatetime',
  'maxdatetime',
  'totalseconds',
  'round',
  'floor',
  'ceiling',
  'cast',
  'isof',
  'geo.distance',
  'geo.intersects',
  'geo.length',
])

/** Lambda operators (matched case-insensitively) */
const LAMBDA_OPS = new Set(['any', 'all'])

/** `$`-identifiers of the expression grammar that the parser recognizes but does not implement. */
const DOLLAR_SEGMENTS = new Set(['$it', '$root', '$this', '$count'])

// ---------------------------------------------------------------------------
// Parser class
// ---------------------------------------------------------------------------

class Parser {
  private readonly tokens: Token[]
  private pos: number = 0
  private nestingDepth: number = 0

  constructor(
    tokens: Token[],
    /**
     * Whether `$it` may be used. Inside `$expand` options `$it` refers to the entity of the
     * resource path, not the expanded one (P2 §5.1.1.14.4); that is not implemented.
     */
    private readonly allowIt: boolean = true,
  ) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: TokenKind.EOF, value: null, position: -1 }
  }

  private advance(): Token {
    const tok = this.tokens[this.pos]
    if (tok === undefined) {
      return { kind: TokenKind.EOF, value: null, position: -1 }
    }
    this.pos++
    return tok
  }

  private expect(kind: TokenKind): Token {
    const tok = this.peek()
    if (tok.kind !== kind) {
      throw new ODataParseError(
        `Expected ${kind} but got ${tok.kind} ('${String(tok.value)}') at position ${tok.position}`,
        tok.position,
        tok,
      )
    }
    return this.advance()
  }

  private isBinaryOperator(token: Token): boolean {
    return token.kind in PRECEDENCE
  }

  private getPrecedence(token: Token): number {
    return PRECEDENCE[token.kind] ?? 0
  }

  /**
   * Parse a filter expression using Pratt/precedence-climbing.
   * @param minPrecedence - Minimum binding power for the current operator level
   */
  parseExpression(minPrecedence: number = 0): FilterNode {
    let left = this.parsePrimary()

    while (this.isBinaryOperator(this.peek()) && this.getPrecedence(this.peek()) > minPrecedence) {
      const opToken = this.advance()
      const prec = this.getPrecedence(opToken)
      // All supported binary operators are left-associative → next min = same prec
      // (right-assoc would use prec - 1)
      const right = this.parseExpression(prec)
      const operator = BINARY_OP_MAP[opToken.kind]
      if (operator === undefined) {
        throw new ODataParseError(
          `Unknown binary operator token: ${opToken.kind}`,
          opToken.position,
          opToken,
        )
      }
      const node: BinaryExprNode = { kind: 'BinaryExpr', operator, left, right }
      left = node
    }

    return left
  }

  /**
   * Parse a primary expression (literals, identifiers, function calls, lambdas, parens, unary).
   */
  parsePrimary(): FilterNode {
    const token = this.peek()

    // Parenthesized expression
    if (token.kind === TokenKind.OPEN_PAREN) {
      this.advance()
      this.nestingDepth++
      if (this.nestingDepth > MAX_NESTING_DEPTH) {
        throw new ODataParseError(
          `Maximum nesting depth of ${MAX_NESTING_DEPTH} exceeded`,
          token.position,
          token,
        )
      }
      const expr = this.parseExpression(0)
      this.nestingDepth--
      this.expect(TokenKind.CLOSE_PAREN)
      return expr
    }

    // NOT prefix
    if (token.kind === TokenKind.NOT) {
      this.advance()
      // NOT precedence = 3, parse at level 3 so it captures comparisons
      const operand = this.parseExpression(3)
      const node: UnaryExprNode = { kind: 'UnaryExpr', operator: 'not', operand }
      return node
    }

    // Unary minus (neg)
    if (token.kind === TokenKind.SUB) {
      this.advance()
      const operand = this.parsePrimary()
      // If the operand is a literal number, negate it inline
      if (operand.kind === 'Literal' && operand.literalKind === 'number') {
        const lit: LiteralNode = {
          kind: 'Literal',
          literalKind: operand.literalKind,
          value: -(operand.value as number),
        }
        return lit
      }
      const node: UnaryExprNode = { kind: 'UnaryExpr', operator: 'neg', operand }
      return node
    }

    // Literals
    if (
      token.kind === TokenKind.STRING_LITERAL ||
      token.kind === TokenKind.INT_LITERAL ||
      token.kind === TokenKind.DECIMAL_LITERAL
    ) {
      this.advance()
      const kind = token.kind === TokenKind.STRING_LITERAL ? 'string' : 'number'
      const lit: LiteralNode = { kind: 'Literal', literalKind: kind, value: token.value }
      return lit
    }
    if (token.kind === TokenKind.BOOL_LITERAL) {
      this.advance()
      const lit: LiteralNode = { kind: 'Literal', literalKind: 'boolean', value: token.value }
      return lit
    }
    if (token.kind === TokenKind.NULL_LITERAL) {
      this.advance()
      const lit: LiteralNode = { kind: 'Literal', literalKind: 'null', value: null }
      return lit
    }
    if (token.kind === TokenKind.GUID_LITERAL) {
      this.advance()
      const lit: LiteralNode = {
        kind: 'Literal',
        literalKind: 'guid',
        value: token.value,
      }
      return lit
    }
    if (token.kind === TokenKind.DATETIME_LITERAL) {
      this.advance()
      const lit: LiteralNode = {
        kind: 'Literal',
        literalKind: 'dateTimeOffset',
        value: token.value,
      }
      return lit
    }

    // Identifier — could be property, function call, or lambda
    if (token.kind === TokenKind.IDENTIFIER) {
      return this.parseIdentifierExpression()
    }

    throw new ODataParseError(
      `Unexpected token ${token.kind} ('${String(token.value)}') at position ${token.position}`,
      token.position,
      token,
    )
  }

  /**
   * Parse an identifier-started expression:
   *  1. identifier(   → function call
   *  2. identifier/identifier(  → lambda (any/all)
   *  3. identifier/identifier/.../identifier  → property access
   *  4. identifier  → single-segment property access
   */
  private parseIdentifierExpression(): FilterNode {
    const firstToken = this.advance() // consume first identifier
    const firstName = firstToken.value as string

    if (firstName.startsWith('$')) {
      return this.parseDollarPrefixedExpression(firstToken)
    }

    // Check for function call: identifier(
    if (this.peek().kind === TokenKind.OPEN_PAREN) {
      return this.parseFunctionCall(firstName, firstToken.position)
    }

    // Check for slash — could be navigation property or lambda
    if (this.peek().kind === TokenKind.SLASH) {
      this.advance() // consume /
      const nextToken = this.peek()

      if (nextToken.kind !== TokenKind.IDENTIFIER) {
        throw new ODataParseError(
          `Expected identifier after '/' but got ${nextToken.kind} at position ${nextToken.position}`,
          nextToken.position,
          nextToken,
        )
      }

      const secondName = nextToken.value as string

      // Peek ahead: if next after identifier is '(' and it's a lambda op → lambda.
      // 4.01 services MUST accept lambda operator names case-insensitively (P2 §5.1.1.13).
      const lambdaOp = secondName.toLowerCase()
      if (LAMBDA_OPS.has(lambdaOp)) {
        // Check if this is lambda: secondName(
        const savedPos = this.pos
        this.advance() // consume secondName
        if (this.peek().kind === TokenKind.OPEN_PAREN) {
          return this.parseLambdaExpr(firstName, lambdaOp, firstToken.position)
        }
        // Not lambda — restore and treat as navigation
        this.pos = savedPos
      }

      // Navigation property path: collect all /identifier segments
      this.advance() // consume secondName
      const path = [firstName, secondName]

      while (this.peek().kind === TokenKind.SLASH) {
        this.advance() // consume /
        const segToken = this.peek()
        if (segToken.kind !== TokenKind.IDENTIFIER) {
          throw new ODataParseError(
            `Expected identifier after '/' but got ${segToken.kind} at position ${segToken.position}`,
            segToken.position,
            segToken,
          )
        }
        path.push(segToken.value as string)
        this.advance()
      }

      // `$`-segments after a property (`items/$count`, `tags/$this`) are not supported.
      const dollarSegment = path.find((segment) => segment.startsWith('$'))
      if (dollarSegment !== undefined) {
        if (DOLLAR_SEGMENTS.has(dollarSegment)) {
          throw new ODataNotImplementedError(
            `'${path.join('/')}' is not supported in $filter and $orderby expressions`,
          )
        }
        throw new ODataParseError(
          `Unexpected path segment '${dollarSegment}' at position ${firstToken.position}`,
          firstToken.position,
        )
      }

      const node: PropertyAccessNode = { kind: 'PropertyAccess', path }
      return node
    }

    // Plain single-segment property access
    const node: PropertyAccessNode = { kind: 'PropertyAccess', path: [firstName] }
    return node
  }

  /**
   * Parse an expression starting with a `$`-identifier (already consumed).
   *
   * `$it/<path>` refers to the entity of the resource path (P2 §5.1.1.14.4). In `$filter`,
   * `$orderby` and `$apply` that is the entity being filtered (also inside a lambda predicate,
   * where unprefixed paths already bind to it), so `$it/<path>` is the same as `<path>` and the
   * prefix is dropped. Inside `$expand` options (`allowIt: false`) it would be the parent of the
   * expanded entities, which is not implemented (501), like `$root`, a bare `$it` and the other
   * `$`-segments.
   */
  private parseDollarPrefixedExpression(token: Token): FilterNode {
    const name = token.value as string
    if (name === '$it' && !this.allowIt) {
      throw new ODataNotImplementedError(
        "'$it' inside $expand options (referring to the entity of the resource path) is not supported",
      )
    }
    if (name === '$it' && this.peek().kind === TokenKind.SLASH) {
      this.advance() // consume /
      const next = this.peek()
      if (next.kind !== TokenKind.IDENTIFIER || (next.value as string).startsWith('$')) {
        throw new ODataParseError(
          `Expected a property name after '$it/' at position ${next.position}`,
          next.position,
          next,
        )
      }
      return this.parseIdentifierExpression()
    }
    if (DOLLAR_SEGMENTS.has(name)) {
      throw new ODataNotImplementedError(
        `'${name}' is not supported in $filter and $orderby expressions${name === '$it' ? ' without a property path' : ''}`,
      )
    }
    throw new ODataParseError(
      `Unexpected identifier '${name}' at position ${token.position}`,
      token.position,
      token,
    )
  }

  /**
   * Parse a function call: name(arg1, arg2, ...)
   * Validates against the known built-in function list.
   */
  private parseFunctionCall(name: string, position: number): FilterNode {
    if (!KNOWN_FUNCTIONS.has(name)) {
      throw new ODataParseError(
        `Unknown function '${name}' at position ${position}. ` +
          `Known functions: ${Array.from(KNOWN_FUNCTIONS).join(', ')}`,
        position,
      )
    }

    this.expect(TokenKind.OPEN_PAREN)
    const args: FilterNode[] = []

    if (this.peek().kind !== TokenKind.CLOSE_PAREN) {
      args.push(this.parseExpression(0))
      while (this.peek().kind === TokenKind.COMMA) {
        this.advance() // consume comma
        args.push(this.parseExpression(0))
      }
    }

    this.expect(TokenKind.CLOSE_PAREN)
    const node: FunctionCallNode = { kind: 'FunctionCall', name, args }
    return node
  }

  /**
   * Parse a lambda expression: collection/operator(variable:predicate)
   * e.g., Tags/any(t:t/Name eq 'electronics')
   * e.g., Tags/any() — no-predicate variant
   */
  private parseLambdaExpr(collection: string, operator: string, position: number): FilterNode {
    if (!LAMBDA_OPS.has(operator)) {
      throw new ODataParseError(
        `Unknown lambda operator '${operator}' at position ${position}`,
        position,
      )
    }

    this.expect(TokenKind.OPEN_PAREN)

    // Check for no-predicate variant: collection/any()
    if (this.peek().kind === TokenKind.CLOSE_PAREN) {
      this.advance()
      const node: LambdaExprNode = {
        kind: 'LambdaExpr',
        operator: operator as 'any' | 'all',
        collection,
        variable: null,
        predicate: null,
      }
      return node
    }

    // Expect: variable:predicate
    const varToken = this.expect(TokenKind.IDENTIFIER)
    const variable = varToken.value as string
    this.expect(TokenKind.COLON)
    const predicate = this.parseExpression(0)
    this.expect(TokenKind.CLOSE_PAREN)

    const node: LambdaExprNode = {
      kind: 'LambdaExpr',
      operator: operator as 'any' | 'all',
      collection,
      variable,
      predicate,
    }
    return node
  }

  /**
   * Ensure we have consumed all tokens (no trailing garbage).
   */
  expectEOF(): void {
    const tok = this.peek()
    if (tok.kind !== TokenKind.EOF) {
      throw new ODataParseError(
        `Unexpected token ${tok.kind} ('${String(tok.value)}') at position ${tok.position} — expected end of expression`,
        tok.position,
        tok,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a standalone OData $filter expression string into a FilterNode AST.
 *
 * @param input - Raw filter expression (e.g., "Price gt 5 and Active eq true")
 * @returns Root FilterNode of the parsed expression
 * @throws ODataParseError on syntax errors
 */
export function parseFilter(input: string, options: { allowIt?: boolean } = {}): FilterNode {
  if (!input.trim()) {
    throw new ODataParseError('Filter expression must not be empty', 0)
  }
  const tokens = tokenize(input)
  const parser = new Parser(tokens, options.allowIt ?? true)
  const node = parser.parseExpression(0)
  parser.expectEOF()
  return node
}

/**
 * Parse an OData query string into a QueryOptions object.
 * Handles $filter, $orderby, $select, $top, $skip.
 * Unknown query options are silently ignored.
 *
 * @param queryString - Raw query string, with or without leading '?'
 * @returns Parsed QueryOptions (fields are optional — only present when found in query)
 * @throws ODataParseError on syntax errors
 */
export function parseQuery(queryString: string): QueryOptions {
  // Strip leading '?' if present
  const qs = queryString.startsWith('?') ? queryString.slice(1) : queryString

  if (!qs.trim()) return {}

  const parts = qs.split('&')
  let filter: FilterNode | undefined
  let orderBy: OrderByItem[] | undefined
  let select: SelectNode | undefined
  let top: number | undefined
  let skip: number | undefined
  let expand: ExpandNode | undefined

  for (const part of parts) {
    const lpart = part.toLowerCase()

    if (lpart.startsWith('$filter=')) {
      const val = part.slice('$filter='.length)
      filter = parseFilter(val)
    } else if (lpart.startsWith('$orderby=')) {
      const val = part.slice('$orderby='.length)
      orderBy = parseOrderBy(val)
    } else if (lpart.startsWith('$select=')) {
      const val = part.slice('$select='.length)
      select = parseSelect(val)
    } else if (lpart.startsWith('$top=')) {
      const val = part.slice('$top='.length)
      top = parseNonNegativeInt(val, '$top', 0)
    } else if (lpart.startsWith('$skip=')) {
      const val = part.slice('$skip='.length)
      skip = parseNonNegativeInt(val, '$skip', 0)
    } else if (lpart.startsWith('$expand=')) {
      const val = part.slice('$expand='.length)
      expand = parseExpand(val)
    }
    // Unknown options are silently ignored
  }

  return { filter, orderBy, select, top, skip, expand }
}

/**
 * Parse the value of a $orderby query option.
 * Format: expr [asc|desc] (, expr [asc|desc])*
 */
function parseOrderBy(value: string, allowIt = true): OrderByItem[] {
  if (!value.trim()) return []

  const items = value.split(',')
  return items.map((item) => {
    const trimmed = item.trim()
    // Check for trailing 'asc' or 'desc' keyword
    let exprStr = trimmed
    let direction: 'asc' | 'desc' = 'asc'

    // The direction keyword is at the end, separated by whitespace.
    // Use atomic-style match: find last space, check suffix — avoids \s+ backtracking (ReDoS).
    const lower = trimmed.toLowerCase()
    if (/ desc$/i.test(lower)) {
      direction = 'desc'
      exprStr = trimmed.slice(0, -5).trimEnd()
    } else if (/ asc$/i.test(lower)) {
      direction = 'asc'
      exprStr = trimmed.slice(0, -4).trimEnd()
    }

    const tokens = tokenize(exprStr)
    const parser = new Parser(tokens, allowIt)
    const expression = parser.parseExpression(0)
    parser.expectEOF()

    return { expression, direction }
  })
}

/**
 * Parse the value of a $select query option.
 * Format: * | path (, path)*  where path is a slash-separated property name list
 */
function parseSelect(value: string): SelectNode {
  if (value.trim() === '*') {
    return { all: true }
  }

  const paths = value.split(',')
  const items: SelectItem[] = paths.map((p) => {
    const path = p.trim().split('/').filter(Boolean)
    return { path }
  })

  return { items }
}

/**
 * Split a string on `separator` at parenthesis depth 0, outside string literals. Used for the
 * items of `$expand` (`,`) and the nested options of an expand item (`;`), so
 * `Items($expand=Product($select=Name;$top=1);$top=2)` keeps its nested options together.
 */
function splitTopLevel(value: string, separator: ',' | ';'): string[] {
  const segments: string[] = []
  let depth = 0
  let start = 0
  let inString = false

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === "'") {
      // A doubled quote inside a literal is an escaped quote: toggling twice keeps the state.
      inString = !inString
    } else if (inString) {
      continue
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
    } else if (ch === separator && depth === 0) {
      segments.push(value.slice(start, i))
      start = i + 1
    }
  }

  segments.push(value.slice(start))
  return segments
}

/** Nested options allowed after `nav/$count` (ABNF `expandCountOption`). */
const EXPAND_COUNT_OPTIONS = new Set(['$filter', '$search'])

/** Nested `$expand` options that are valid OData but not implemented (answered with 501). */
const UNSUPPORTED_EXPAND_OPTIONS = new Set(['$compute', '$apply'])

/**
 * Parse the value of a $expand query option into an ExpandNode.
 * Handles simple (Customer), multi (Customer,Items), nested options (Items($filter=...)),
 * recursive nested expand (Items($expand=Product)) and `Items/$count`.
 *
 * Nested options (P2 §5.1.3): `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`,
 * `$search`, `$levels` and `$expand`, separated by semicolons. Valid options that are not
 * implemented (`$compute`, `$apply`, `/$ref`) are answered with 501 instead of being ignored;
 * unknown ones are a 400.
 *
 * Per D-07: Full nested $expand support.
 * Per D-08: Nested query options use semicolons as separators.
 */
function parseExpand(value: string): ExpandNode {
  const trimmed = value.trim()
  if (!trimmed) {
    return { items: [] }
  }

  const segments = splitTopLevel(trimmed, ',')
  const items: ExpandItem[] = segments
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      const parenIdx = seg.indexOf('(')
      const path = (parenIdx === -1 ? seg : seg.slice(0, parenIdx)).trim()
      const { navigationProperty, countOnly } = parseExpandPath(path)

      if (parenIdx === -1) {
        return countOnly ? { navigationProperty, countOnly } : { navigationProperty }
      }

      // Has nested options: NavProp(options)
      if (!seg.endsWith(')')) {
        throw new ODataParseError(`Unbalanced parentheses in $expand item '${seg}'`, 0)
      }
      const innerContent = seg.slice(parenIdx + 1, seg.length - 1)
      return {
        navigationProperty,
        ...(countOnly && { countOnly }),
        ...parseExpandOptions(innerContent, navigationProperty, countOnly),
      } satisfies ExpandItem
    })

  return { items }
}

/** Split an expand path into the navigation property and the `/$count` suffix. */
function parseExpandPath(path: string): { navigationProperty: string; countOnly: boolean } {
  const segments = path.split('/')
  const last = segments[segments.length - 1]
  if (segments.length > 1 && last === '$count') {
    return { navigationProperty: segments.slice(0, -1).join('/'), countOnly: true }
  }
  if (segments.length > 1 && last === '$ref') {
    throw new ODataNotImplementedError(`$expand with '/$ref' ('${path}') is not supported`)
  }
  return { navigationProperty: path, countOnly: false }
}

/** Parse the semicolon-separated nested options of one expand item. */
function parseExpandOptions(
  content: string,
  navigationProperty: string,
  countOnly: boolean,
): Omit<ExpandItem, 'navigationProperty' | 'countOnly'> {
  const options: {
    -readonly [K in keyof Omit<ExpandItem, 'navigationProperty' | 'countOnly'>]: ExpandItem[K]
  } = {}

  for (const raw of splitTopLevel(content, ';')) {
    const option = raw.trim()
    if (!option) continue
    const eq = option.indexOf('=')
    const name = (eq === -1 ? option : option.slice(0, eq)).trim().toLowerCase()
    const val = eq === -1 ? '' : option.slice(eq + 1)

    if (countOnly && !EXPAND_COUNT_OPTIONS.has(name)) {
      throw new ODataParseError(
        `Only $filter and $search are allowed in '${navigationProperty}/$count(...)', got '${name}'`,
        0,
      )
    }
    if (UNSUPPORTED_EXPAND_OPTIONS.has(name)) {
      throw new ODataNotImplementedError(
        `The nested $expand option '${name}' is not supported (in '${navigationProperty}')`,
      )
    }

    switch (name) {
      case '$filter':
        options.filter = parseFilter(val, { allowIt: false })
        break
      case '$select':
        options.select = parseSelect(val)
        break
      case '$orderby':
        options.orderBy = parseOrderBy(val, false)
        break
      case '$top':
        options.top = parseNonNegativeInt(val, '$top', 0)
        break
      case '$skip':
        options.skip = parseNonNegativeInt(val, '$skip', 0)
        break
      case '$expand':
        options.expand = parseExpand(val)
        break
      case '$count': {
        const flag = val.trim().toLowerCase()
        if (flag !== 'true' && flag !== 'false') {
          throw new ODataParseError(`$count must be true or false, got '${val.trim()}'`, 0)
        }
        if (flag === 'true') options.count = true
        break
      }
      case '$search':
        options.search = parseSearch(val)
        break
      case '$levels':
        options.levels = parseLevels(val)
        break
      default:
        if (name.startsWith('@')) {
          throw new ODataNotImplementedError(
            `Parameter aliases ('${name}') are not supported in $expand options`,
          )
        }
        throw new ODataParseError(
          `Unknown $expand option '${name}' in '${navigationProperty}'. Allowed: $filter, ` +
            '$select, $orderby, $top, $skip, $count, $search, $levels, $expand',
          0,
        )
    }
  }

  return options
}

/** Parse `$levels`: a positive integer or `max`. */
function parseLevels(value: string): number | 'max' {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === 'max') return 'max'
  const levels = parseNonNegativeInt(trimmed, '$levels', 0)
  if (levels < 1) {
    throw new ODataParseError(`$levels must be a positive integer or max, got '${trimmed}'`, 0)
  }
  return levels
}

/**
 * Parse and validate a non-negative integer value for $top or $skip.
 * @throws ODataParseError if the value is not a valid non-negative integer
 */
function parseNonNegativeInt(value: string, paramName: string, position: number): number {
  const trimmed = value.trim()
  // Must be digits only (no decimals, no negative sign)
  if (!/^\d+$/.test(trimmed)) {
    throw new ODataParseError(
      `${paramName} must be a non-negative integer, got '${trimmed}'`,
      position,
    )
  }
  const n = parseInt(trimmed, 10)
  if (n < 0) {
    throw new ODataParseError(`${paramName} must be a non-negative integer, got ${n}`, position)
  }
  return n
}
