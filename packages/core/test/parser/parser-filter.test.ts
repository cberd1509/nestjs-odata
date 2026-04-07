import { describe, it, expect } from 'vitest'
import type {
  BinaryExprNode,
  FilterNode,
  FunctionCallNode,
  LambdaExprNode,
  LiteralNode,
  PropertyAccessNode,
  UnaryExprNode,
} from '../../src/parser/ast.js'
import { ODataParseError } from '../../src/parser/errors.js'
import { parseFilter } from '../../src/parser/index.js'

// ---------------------------------------------------------------------------
// Helper assertions
// ---------------------------------------------------------------------------

function assertBinaryExpr(node: FilterNode, operator: string): asserts node is BinaryExprNode {
  expect(node.kind).toBe('BinaryExpr')
  expect((node as BinaryExprNode).operator).toBe(operator)
}

function assertPropertyAccess(
  node: FilterNode,
  path: string[],
): asserts node is PropertyAccessNode {
  expect(node.kind).toBe('PropertyAccess')
  expect((node as PropertyAccessNode).path).toEqual(path)
}

function assertLiteral(
  node: FilterNode,
  literalKind: string,
  value: unknown,
): asserts node is LiteralNode {
  expect(node.kind).toBe('Literal')
  const lit = node as LiteralNode
  expect(lit.literalKind).toBe(literalKind)
  if (value !== undefined) {
    expect(lit.value).toBe(value)
  }
}

function assertFunctionCall(
  node: FilterNode,
  name: string,
  argCount: number,
): asserts node is FunctionCallNode {
  expect(node.kind).toBe('FunctionCall')
  const fn = node as FunctionCallNode
  expect(fn.name).toBe(name)
  expect(fn.args).toHaveLength(argCount)
}

function assertLambdaExpr(
  node: FilterNode,
  operator: string,
  collection: string,
  variable: string | null,
): asserts node is LambdaExprNode {
  expect(node.kind).toBe('LambdaExpr')
  const lambda = node as LambdaExprNode
  expect(lambda.operator).toBe(operator)
  expect(lambda.collection).toBe(collection)
  expect(lambda.variable).toBe(variable)
}

// ---------------------------------------------------------------------------
// Comparison operators
// ---------------------------------------------------------------------------

describe('$filter — comparison operators', () => {
  it('parses Price gt 5 into BinaryExpr(PropertyAccess([Price]), gt, Literal(5))', () => {
    const node = parseFilter('Price gt 5')
    assertBinaryExpr(node, 'gt')
    const bin = node
    assertPropertyAccess(bin.left, ['Price'])
    assertLiteral(bin.right, 'number', 5)
  })

  it('parses Price ge 5', () => {
    const node = parseFilter('Price ge 5')
    assertBinaryExpr(node, 'ge')
  })

  it('parses Price lt 100', () => {
    const node = parseFilter('Price lt 100')
    assertBinaryExpr(node, 'lt')
  })

  it('parses Price le 100', () => {
    const node = parseFilter('Price le 100')
    assertBinaryExpr(node, 'le')
  })

  it('parses Active eq true', () => {
    const node = parseFilter('Active eq true')
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertLiteral(bin.right, 'boolean', true)
  })

  it('parses Active ne false', () => {
    const node = parseFilter('Active ne false')
    assertBinaryExpr(node, 'ne')
    const bin = node
    assertLiteral(bin.right, 'boolean', false)
  })

  it('parses Name eq null', () => {
    const node = parseFilter('Name eq null')
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertLiteral(bin.right, 'null', null)
  })

  it("parses Name eq 'Alice'", () => {
    const node = parseFilter("Name eq 'Alice'")
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertLiteral(bin.right, 'string', 'Alice')
  })

  it("handles OData string escaping: LastName eq 'O''Brien' -> value is O'Brien", () => {
    const node = parseFilter("LastName eq 'O''Brien'")
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertLiteral(bin.right, 'string', "O'Brien")
  })

  it('parses Price eq 3.14 as decimal', () => {
    const node = parseFilter('Price eq 3.14')
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertLiteral(bin.right, 'number', 3.14)
  })
})

// ---------------------------------------------------------------------------
// Literal types
// ---------------------------------------------------------------------------

describe('$filter — literal types', () => {
  it("parses string literal: 'hello'", () => {
    const node = parseFilter("Name eq 'hello'")
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('string')
    expect(lit.value).toBe('hello')
  })

  it('parses integer literal: 42', () => {
    const node = parseFilter('Count eq 42')
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('number')
    expect(lit.value).toBe(42)
  })

  it('parses decimal literal: 3.14', () => {
    const node = parseFilter('Price eq 3.14')
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('number')
    expect(lit.value).toBeCloseTo(3.14)
  })

  it('parses boolean true', () => {
    const node = parseFilter('Active eq true')
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('boolean')
    expect(lit.value).toBe(true)
  })

  it('parses boolean false', () => {
    const node = parseFilter('Active eq false')
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('boolean')
    expect(lit.value).toBe(false)
  })

  it('parses null literal', () => {
    const node = parseFilter('Name eq null')
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('null')
    expect(lit.value).toBeNull()
  })

  it('parses GUID literal', () => {
    const node = parseFilter('Id eq 12345678-1234-1234-1234-123456789abc')
    const bin = node as BinaryExprNode
    const lit = bin.right as LiteralNode
    expect(lit.literalKind).toBe('guid')
    expect(lit.value).toBe('12345678-1234-1234-1234-123456789abc')
  })
})

// ---------------------------------------------------------------------------
// Logical operators and precedence
// ---------------------------------------------------------------------------

describe('$filter — logical operators', () => {
  it('parses "not Active" into UnaryExpr(not, PropertyAccess([Active]))', () => {
    const node = parseFilter('not Active')
    expect(node.kind).toBe('UnaryExpr')
    const unary = node as UnaryExprNode
    expect(unary.operator).toBe('not')
    assertPropertyAccess(unary.operand, ['Active'])
  })

  it('parses "Price gt 5 and Active eq true" with and at the top', () => {
    const node = parseFilter('Price gt 5 and Active eq true')
    assertBinaryExpr(node, 'and')
    const bin = node
    assertBinaryExpr(bin.left, 'gt')
    assertBinaryExpr(bin.right, 'eq')
  })

  it('parses "Price gt 5 or Active eq true"', () => {
    const node = parseFilter('Price gt 5 or Active eq true')
    assertBinaryExpr(node, 'or')
  })

  it('precedence: "a or b and c" -> or(a, and(b, c)) — and binds tighter than or', () => {
    const node = parseFilter('Active or Price gt 5 and Name eq null')
    assertBinaryExpr(node, 'or')
    const bin = node
    // right side should be and
    assertBinaryExpr(bin.right, 'and')
  })

  it('precedence: "a and b eq c" -> and(a, eq(b,c)) — comparison binds tighter than and', () => {
    const node = parseFilter('Active and Price eq 5')
    assertBinaryExpr(node, 'and')
    const bin = node
    assertBinaryExpr(bin.right, 'eq')
  })
})

// ---------------------------------------------------------------------------
// Arithmetic operators and precedence
// ---------------------------------------------------------------------------

describe('$filter — arithmetic operators', () => {
  it('parses "Price add 10 gt 50" -> gt(add(Price, 10), 50)', () => {
    const node = parseFilter('Price add 10 gt 50')
    assertBinaryExpr(node, 'gt')
    const bin = node
    assertBinaryExpr(bin.left, 'add')
    const addNode = bin.left
    assertPropertyAccess(addNode.left, ['Price'])
    assertLiteral(addNode.right, 'number', 10)
    assertLiteral(bin.right, 'number', 50)
  })

  it('parses "Price sub 5 lt 20"', () => {
    const node = parseFilter('Price sub 5 lt 20')
    assertBinaryExpr(node, 'lt')
    const bin = node
    assertBinaryExpr(bin.left, 'sub')
  })

  it('parses "Qty mul 2 gt 10"', () => {
    const node = parseFilter('Qty mul 2 gt 10')
    assertBinaryExpr(node, 'gt')
    const bin = node
    assertBinaryExpr(bin.left, 'mul')
  })

  it('precedence: "a mul b add c" -> add(mul(a,b), c) — mul binds tighter than add', () => {
    const node = parseFilter('Price mul 2 add 5 gt 10')
    assertBinaryExpr(node, 'gt')
    const bin = node
    assertBinaryExpr(bin.left, 'add')
    const addNode = bin.left
    assertBinaryExpr(addNode.left, 'mul')
  })

  it('parses "Qty mod 3 eq 0"', () => {
    const node = parseFilter('Qty mod 3 eq 0')
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertBinaryExpr(bin.left, 'mod')
  })
})

// ---------------------------------------------------------------------------
// Parenthesized expressions
// ---------------------------------------------------------------------------

describe('$filter — parenthesized expressions', () => {
  it('parses "(Price gt 5)" — parens are stripped, same as Price gt 5', () => {
    const node = parseFilter('(Price gt 5)')
    assertBinaryExpr(node, 'gt')
  })

  it('parens override precedence: "(a or b) and c" -> and(or(a,b), c)', () => {
    const node = parseFilter('(Active or Deleted) and Price gt 5')
    assertBinaryExpr(node, 'and')
    const bin = node
    assertBinaryExpr(bin.left, 'or')
  })
})

// ---------------------------------------------------------------------------
// Property access (navigation)
// ---------------------------------------------------------------------------

describe('$filter — property access', () => {
  it('parses single-segment property: Name', () => {
    const node = parseFilter("Name eq 'foo'")
    const bin = node as BinaryExprNode
    assertPropertyAccess(bin.left, ['Name'])
  })

  it("parses multi-segment navigation: Category/Name eq 'Electronics'", () => {
    const node = parseFilter("Category/Name eq 'Electronics'")
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertPropertyAccess(bin.left, ['Category', 'Name'])
  })
})

// ---------------------------------------------------------------------------
// String functions
// ---------------------------------------------------------------------------

describe('$filter — string functions', () => {
  it("parses contains(Name,'widget') -> FunctionCall('contains', [PropertyAccess, Literal])", () => {
    const node = parseFilter("contains(Name,'widget')")
    assertFunctionCall(node, 'contains', 2)
    const fn = node
    assertPropertyAccess(fn.args[0], ['Name'])
    assertLiteral(fn.args[1], 'string', 'widget')
  })

  it("parses startswith(Name,'A')", () => {
    const node = parseFilter("startswith(Name,'A')")
    assertFunctionCall(node, 'startswith', 2)
  })

  it("parses endswith(Name,'z')", () => {
    const node = parseFilter("endswith(Name,'z')")
    assertFunctionCall(node, 'endswith', 2)
  })

  it("parses tolower(Name) eq 'alice' -> BinaryExpr(FunctionCall, eq, Literal)", () => {
    const node = parseFilter("tolower(Name) eq 'alice'")
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertFunctionCall(bin.left, 'tolower', 1)
    assertLiteral(bin.right, 'string', 'alice')
  })

  it('parses toupper(Name)', () => {
    const node = parseFilter("toupper(Name) eq 'ALICE'")
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertFunctionCall(bin.left, 'toupper', 1)
  })

  it('parses length(Name) gt 5', () => {
    const node = parseFilter('length(Name) gt 5')
    assertBinaryExpr(node, 'gt')
    const bin = node
    assertFunctionCall(bin.left, 'length', 1)
  })

  it("parses indexof(Name,'A') gt 0", () => {
    const node = parseFilter("indexof(Name,'A') gt 0")
    assertBinaryExpr(node, 'gt')
    const bin = node
    assertFunctionCall(bin.left, 'indexof', 2)
  })

  it("parses concat(Name,' Inc') eq 'ACME Inc'", () => {
    const node = parseFilter("concat(Name,' Inc') eq 'ACME Inc'")
    assertBinaryExpr(node, 'eq')
    const bin = node
    assertFunctionCall(bin.left, 'concat', 2)
  })

  it('parses math functions: round, floor, ceiling', () => {
    expect(() => parseFilter('round(Price) eq 5')).not.toThrow()
    expect(() => parseFilter('floor(Price) eq 5')).not.toThrow()
    expect(() => parseFilter('ceiling(Price) eq 5')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Lambda expressions (collection traversal)
// ---------------------------------------------------------------------------

describe('$filter — lambda expressions', () => {
  it("parses Tags/any(t:t/Name eq 'electronics') -> LambdaExpr(any, Tags, t, BinaryExpr)", () => {
    const node = parseFilter("Tags/any(t:t/Name eq 'electronics')")
    assertLambdaExpr(node, 'any', 'Tags', 't')
    const lambda = node
    expect(lambda.predicate).not.toBeNull()
    assertBinaryExpr(lambda.predicate!, 'eq')
    // The predicate left side should be property access t/Name
    const pred = lambda.predicate
    assertPropertyAccess(pred.left, ['t', 'Name'])
    assertLiteral(pred.right, 'string', 'electronics')
  })

  it('parses Tags/all(t:t/Active eq true) -> LambdaExpr(all, Tags, t, BinaryExpr)', () => {
    const node = parseFilter('Tags/all(t:t/Active eq true)')
    assertLambdaExpr(node, 'all', 'Tags', 't')
    const lambda = node
    expect(lambda.predicate).not.toBeNull()
  })

  it('parses Tags/any() -> LambdaExpr(any, Tags, null, null) — no-predicate variant', () => {
    const node = parseFilter('Tags/any()')
    assertLambdaExpr(node, 'any', 'Tags', null)
    const lambda = node
    expect(lambda.predicate).toBeNull()
  })

  it('parses nested property lambda: Orders/any(o:o/Amount gt 100)', () => {
    const node = parseFilter('Orders/any(o:o/Amount gt 100)')
    assertLambdaExpr(node, 'any', 'Orders', 'o')
  })
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('$filter — error cases', () => {
  it('throws ODataParseError for missing right operand: Price gt', () => {
    expect(() => parseFilter('Price gt')).toThrow(ODataParseError)
  })

  it('throws ODataParseError for unknown function: foobar(x)', () => {
    expect(() => parseFilter('foobar(x)')).toThrow(ODataParseError)
  })

  it('throws ODataParseError for unclosed paren: (Price gt 5', () => {
    expect(() => parseFilter('(Price gt 5')).toThrow(ODataParseError)
  })

  it('throws ODataParseError for empty filter string', () => {
    expect(() => parseFilter('')).toThrow(ODataParseError)
  })

  it('ODataParseError has a position field', () => {
    try {
      parseFilter('Price gt')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ODataParseError)
      const parseError = err as ODataParseError
      expect(typeof parseError.position).toBe('number')
    }
  })
})
