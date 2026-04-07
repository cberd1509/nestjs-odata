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
import { ODataParseError } from './errors.js'
import { tokenize, Token, TokenKind } from './lexer.js'

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

/** Lambda operators */
const LAMBDA_OPS = new Set(['any', 'all'])

// ---------------------------------------------------------------------------
// Parser class
// ---------------------------------------------------------------------------

class Parser {
  private readonly tokens: Token[]
  private pos: number = 0
  private nestingDepth: number = 0

  constructor(tokens: Token[]) {
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

      // Peek ahead: if next after identifier is '(' and it's a lambda op → lambda
      if (LAMBDA_OPS.has(secondName)) {
        // Check if this is lambda: secondName(
        const savedPos = this.pos
        this.advance() // consume secondName
        if (this.peek().kind === TokenKind.OPEN_PAREN) {
          return this.parseLambdaExpr(firstName, secondName, firstToken.position)
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

      const node: PropertyAccessNode = { kind: 'PropertyAccess', path }
      return node
    }

    // Plain single-segment property access
    const node: PropertyAccessNode = { kind: 'PropertyAccess', path: [firstName] }
    return node
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
export function parseFilter(input: string): FilterNode {
  if (!input.trim()) {
    throw new ODataParseError('Filter expression must not be empty', 0)
  }
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
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
    }
    // Unknown options are silently ignored
  }

  return { filter, orderBy, select, top, skip }
}

/**
 * Parse the value of a $orderby query option.
 * Format: expr [asc|desc] (, expr [asc|desc])*
 */
function parseOrderBy(value: string): OrderByItem[] {
  if (!value.trim()) return []

  const items = value.split(',')
  return items.map((item) => {
    const trimmed = item.trim()
    // Check for trailing 'asc' or 'desc' keyword
    let exprStr = trimmed
    let direction: 'asc' | 'desc' = 'asc'

    // The direction keyword is at the end, separated by whitespace
    const descMatch = /\s+(desc)$/i.exec(trimmed)
    const ascMatch = /\s+(asc)$/i.exec(trimmed)

    if (descMatch) {
      direction = 'desc'
      exprStr = trimmed.slice(0, trimmed.length - descMatch[0].length).trim()
    } else if (ascMatch) {
      direction = 'asc'
      exprStr = trimmed.slice(0, trimmed.length - ascMatch[0].length).trim()
    }

    const tokens = tokenize(exprStr)
    const parser = new Parser(tokens)
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
