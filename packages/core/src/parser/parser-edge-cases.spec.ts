/**
 * Edge cases and error paths of the $filter / query-option parser: malformed paths,
 * `$`-segments, nesting limits, trailing input and the less common $expand option forms.
 */
import { describe, it, expect } from 'vitest'
import type { BinaryExprNode, FunctionCallNode, FilterNode } from './ast.js'
import { ODataNotImplementedError, ODataParseError } from './errors.js'
import { parseFilter, parseQuery } from './parser.js'
import { tokenize } from './lexer.js'
import { acceptVisitor, type FilterVisitor } from './visitor.js'

describe('parseFilter() error paths', () => {
  it('rejects an empty or whitespace-only expression', () => {
    expect(() => parseFilter('   ')).toThrow(ODataParseError)
  })

  it('enforces the maximum parenthesis nesting depth', () => {
    const deep = `${'('.repeat(51)}Price${')'.repeat(51)} eq 1`
    expect(() => parseFilter(deep)).toThrow(/Maximum nesting depth of 50 exceeded/)
  })

  it('accepts nesting right at the limit', () => {
    const atLimit = `${'('.repeat(50)}Price eq 1${')'.repeat(50)}`
    expect(parseFilter(atLimit)).toMatchObject({ kind: 'BinaryExpr', operator: 'eq' })
  })

  it('rejects a non-identifier after the first "/" of a path', () => {
    expect(() => parseFilter('Address/1 eq 2')).toThrow(/Expected identifier after '\/'/)
  })

  it('rejects a non-identifier after a later "/" of a path', () => {
    expect(() => parseFilter("Customer/Address/'x' eq 2")).toThrow(
      /Expected identifier after '\/' but got STRING_LITERAL/,
    )
  })

  it('answers known $-segments after a property (Items/$count) with 501', () => {
    expect(() => parseFilter('Items/$count gt 1')).toThrow(ODataNotImplementedError)
    expect(() => parseFilter('Customer/Tags/$this eq 1')).toThrow(
      "'Customer/Tags/$this' is not supported in $filter and $orderby expressions",
    )
  })

  it('rejects unknown $-segments after a property with 400', () => {
    let error: unknown
    try {
      parseFilter('Items/$foo eq 1')
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ODataParseError)
    expect((error as Error).message).toMatch(/Unexpected path segment '\$foo'/)
  })

  it("rejects '$it/' followed by something other than a property name", () => {
    expect(() => parseFilter('$it/1 eq 1')).toThrow(/Expected a property name after '\$it\/'/)
    expect(() => parseFilter('$it/$it eq 1')).toThrow(/Expected a property name after '\$it\/'/)
  })

  it('rejects trailing tokens after a complete expression', () => {
    expect(() => parseFilter('Price eq 1 Name')).toThrow(/expected end of expression/)
  })

  it('rejects a lambda with a missing ":" separator', () => {
    expect(() => parseFilter('Tags/any(t t/Name eq 1)')).toThrow(/Expected COLON/)
  })

  it('parses a function call without arguments', () => {
    const node = parseFilter('Created lt now()') as BinaryExprNode
    expect(node.right).toEqual({ kind: 'FunctionCall', name: 'now', args: [] })
  })

  it('treats "any" without parentheses as a navigation segment, not a lambda', () => {
    expect(parseFilter('Tags/any eq 1')).toEqual({
      kind: 'BinaryExpr',
      operator: 'eq',
      left: { kind: 'PropertyAccess', path: ['Tags', 'any'] },
      right: { kind: 'Literal', literalKind: 'number', value: 1 },
    })
  })
})

describe('tokenize() edge cases', () => {
  it('tokenizes a GUID that starts with a hex letter', () => {
    const tokens = tokenize('Id eq abcdef12-1234-1234-1234-123456789abc')
    expect(tokens[2]).toMatchObject({
      kind: 'GUID_LITERAL',
      value: 'abcdef12-1234-1234-1234-123456789abc',
    })
  })

  it('stops an identifier at a dash that is not part of a GUID', () => {
    expect(() => tokenize('abc-def')).toThrow(/Unexpected character '-' at position 3/)
  })

  it("rejects a lone '$' that is not followed by a letter", () => {
    expect(() => tokenize('Price eq $')).toThrow(/Unexpected character '\$'/)
  })

  it('tokenizes null as a null literal', () => {
    expect(tokenize('null')[0]).toMatchObject({ kind: 'NULL_LITERAL', value: null })
  })

  it('keeps an unterminated string literal as the remaining text', () => {
    expect(tokenize("'abc")[0]).toMatchObject({ kind: 'STRING_LITERAL', value: 'abc' })
  })

  it('treats a number followed by a dash but not a GUID as an integer', () => {
    // 36+ chars that do not form a GUID: the digits stay an int and the dash is rejected.
    expect(() => tokenize('12345678-zzzz-1234-1234-123456789abc')).toThrow(
      /Unexpected character '-'/,
    )
  })
})

describe('parseQuery() less common forms', () => {
  it('returns an empty object for an empty query string', () => {
    expect(parseQuery('?')).toEqual({})
  })

  it('defaults $orderby direction to asc when none is given', () => {
    const result = parseQuery('$orderby=Name')
    expect(result.orderBy).toEqual([
      { expression: { kind: 'PropertyAccess', path: ['Name'] }, direction: 'asc' },
    ])
  })

  it('returns an empty list for a blank $orderby', () => {
    expect(parseQuery('$orderby= ').orderBy).toEqual([])
  })

  it('parses $select=* as all properties', () => {
    expect(parseQuery('$select=*').select).toEqual({ all: true })
  })

  it('parses $select paths', () => {
    expect(parseQuery('$select=Name,Address/City').select).toEqual({
      items: [{ path: ['Name'] }, { path: ['Address', 'City'] }],
    })
  })

  it('rejects a negative or non-integer $top / $skip', () => {
    expect(() => parseQuery('$top=-1')).toThrow(/\$top must be a non-negative integer/)
    expect(() => parseQuery('$skip=1.5')).toThrow(/\$skip must be a non-negative integer/)
  })

  it('returns an empty expand for a blank $expand', () => {
    expect(parseQuery('$expand=').expand).toEqual({ items: [] })
  })

  it("answers $expand with '/$ref' with 501", () => {
    expect(() => parseQuery('$expand=Items/$ref')).toThrow(ODataNotImplementedError)
  })

  it('rejects an expand item with unbalanced parentheses', () => {
    expect(() => parseQuery('$expand=Items($top=1')).toThrow(/Unbalanced parentheses/)
  })

  it('ignores empty nested options between semicolons', () => {
    const item = parseQuery('$expand=Items(;$top=1;)').expand?.items[0]
    expect(item).toEqual({ navigationProperty: 'Items', top: 1 })
  })

  it('requires a true/false value for a nested $count', () => {
    expect(() => parseQuery('$expand=Items($count)')).toThrow(
      "$count must be true or false, got ''",
    )
    expect(() => parseQuery('$expand=Items($count=yes)')).toThrow(/got 'yes'/)
  })

  it('leaves count unset for a nested $count=false', () => {
    expect(parseQuery('$expand=Items($count=false)').expand?.items[0]).toEqual({
      navigationProperty: 'Items',
    })
  })

  it('rejects options other than $filter/$search inside Items/$count(...)', () => {
    expect(() => parseQuery('$expand=Items/$count($top=1)')).toThrow(
      /Only \$filter and \$search are allowed/,
    )
  })

  it('rejects $levels below 1', () => {
    expect(() => parseQuery('$expand=Children($levels=0)')).toThrow(
      /\$levels must be a positive integer or max/,
    )
  })

  it('answers parameter aliases in nested options with 501', () => {
    expect(() => parseQuery('$expand=Items(@p=1)')).toThrow(ODataNotImplementedError)
  })

  it('keeps a quoted separator inside a nested filter literal', () => {
    const item = parseQuery("$expand=Items($filter=Name eq 'a;b,c)')").expand?.items[0]
    const filter = item?.filter as BinaryExprNode
    expect(filter.right).toEqual({ kind: 'Literal', literalKind: 'string', value: 'a;b,c)' })
  })
})

describe('acceptVisitor()', () => {
  const visitor: FilterVisitor<string> = {
    visitBinaryExpr: (node) =>
      `(${acceptVisitor(node.left, visitor)} ${node.operator} ${acceptVisitor(node.right, visitor)})`,
    visitUnaryExpr: (node) => `${node.operator}(${acceptVisitor(node.operand, visitor)})`,
    visitFunctionCall: (node: FunctionCallNode) =>
      `${node.name}[${node.args.map((a) => acceptVisitor(a, visitor)).join(',')}]`,
    visitLambdaExpr: (node) =>
      `${node.collection}/${node.operator}(${node.predicate ? acceptVisitor(node.predicate, visitor) : ''})`,
    visitPropertyAccess: (node) => node.path.join('.'),
    visitLiteral: (node) => JSON.stringify(node.value),
  }

  it('dispatches every node kind to the matching visit method', () => {
    const ast: FilterNode = parseFilter(
      "not (Price gt 5) and contains(Name,'x') or Tags/any(t:t/Name eq 'y')",
    )
    expect(acceptVisitor(ast, visitor)).toBe(
      '((not((Price gt 5)) and contains[Name,"x"]) or Tags/any((t.Name eq "y")))',
    )
  })
})
