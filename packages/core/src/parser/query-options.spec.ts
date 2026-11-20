/**
 * Tests for how query option values reach the parser: parseQueryOptions takes decoded values and
 * never decodes them again; parseQuery takes a raw query string, splits it on `&` between
 * parameters only and decodes each name and value once.
 */
import { describe, it, expect } from 'vitest'
import { parseQuery, parseQueryOptions } from './index.js'
import { ODataParseError } from './errors.js'
import type { FilterNode } from './ast.js'

/** The string value of the literal on the right of `$filter=<prop> <op> '<literal>'`. */
function rightLiteral(filter: FilterNode | undefined): unknown {
  if (filter?.kind !== 'BinaryExpr') throw new Error(`not a binary expression: ${filter?.kind}`)
  if (filter.right.kind !== 'Literal') throw new Error(`not a literal: ${filter.right.kind}`)
  return filter.right.value
}

/** The string argument of `$filter=contains(<prop>,'<literal>')`. */
function containsArg(filter: FilterNode | undefined): unknown {
  if (filter?.kind !== 'FunctionCall') throw new Error(`not a function call: ${filter?.kind}`)
  const arg = filter.args[1]
  if (arg?.kind !== 'Literal') throw new Error('second argument is not a literal')
  return arg.value
}

describe('parseQueryOptions (decoded values)', () => {
  it.each([
    ['&', "Name eq 'A & B'", 'A & B'],
    ['%', "Name eq '100% cotton'", '100% cotton'],
    ['+', "Name eq 'C+ grade'", 'C+ grade'],
    ['an encoded-looking %20', "Name eq 'a%20b'", 'a%20b'],
    ['an encoded-looking %26', "Name eq 'a%26b'", 'a%26b'],
    ["'' (escaped quote)", "Name eq 'O''Brien'", "O'Brien"],
  ])('$filter keeps %s inside a literal as given', (_label, filter, expected) => {
    expect(rightLiteral(parseQueryOptions({ $filter: filter }).filter)).toBe(expected)
  })

  it('$filter: a function argument holding & and %', () => {
    const { filter } = parseQueryOptions({ $filter: "contains(Name,'A & 50%')" })
    expect(containsArg(filter)).toBe('A & 50%')
  })

  it('$orderby: literals with &, %, + and commas do not split items', () => {
    const { orderBy } = parseQueryOptions({
      $orderby: "Name eq 'A & B, 100% C+' desc,concat(Name,'x, y') asc,Price",
    })
    expect(orderBy).toHaveLength(3)
    expect(orderBy?.[0]?.direction).toBe('desc')
    expect(rightLiteral(orderBy?.[0]?.expression)).toBe('A & B, 100% C+')
    expect(orderBy?.[1]?.direction).toBe('asc')
    expect(orderBy?.[2]?.expression).toMatchObject({ kind: 'PropertyAccess', path: ['Price'] })
  })

  it('$select: values are used as given (spaces around items are trimmed)', () => {
    const { select } = parseQueryOptions({ $select: 'Name, Price' })
    expect(select?.items?.map((i) => i.path)).toEqual([['Name'], ['Price']])
  })

  it("nested $expand options keep & and % inside literals: x($filter=a eq 'b & c')", () => {
    const { expand } = parseQueryOptions({
      $expand: "Items($filter=Note eq 'b & c; 100%';$orderby=Note eq 'x, y' desc;$top=2)",
    })
    const [item] = expand?.items ?? []
    expect(item?.navigationProperty).toBe('Items')
    expect(rightLiteral(item?.filter)).toBe('b & c; 100%')
    expect(item?.orderBy).toHaveLength(1)
    expect(item?.top).toBe(2)
  })

  it('$top and $skip parse as before; option names are case-insensitive', () => {
    expect(parseQueryOptions({ $TOP: '5', $Skip: '10' })).toMatchObject({ top: 5, skip: 10 })
  })

  it('ignores unknown options, also repeated or non-string ones', () => {
    expect(
      parseQueryOptions({ foo: ['a', 'b'], bar: { nested: 'x' }, $top: '1', $filter: undefined }),
    ).toMatchObject({ top: 1, filter: undefined })
  })

  it('ignores a system query option whose value is not a string', () => {
    expect(parseQueryOptions({ $filter: { x: 'y' } }).filter).toBeUndefined()
  })

  it('refuses a repeated system query option', () => {
    expect(() => parseQueryOptions({ $top: ['1', '2'] })).toThrow(ODataParseError)
    expect(() => parseQueryOptions({ $top: ['1', '2'] })).toThrow(/more than once/)
  })
})

describe('parseQuery (raw query string)', () => {
  it('splits on & only between parameters: %26 stays inside the value', () => {
    const { filter, top } = parseQuery("$filter=Name%20eq%20'A%20%26%20B'&$top=3")
    expect(rightLiteral(filter)).toBe('A & B')
    expect(top).toBe(3)
  })

  it('decodes each value once: %25 is a literal %, %2B a literal +, + a space', () => {
    expect(rightLiteral(parseQuery("$filter=Name eq '100%25'").filter)).toBe('100%')
    expect(rightLiteral(parseQuery("$filter=Name eq 'C%2B'").filter)).toBe('C+')
    expect(rightLiteral(parseQuery("$filter=Name+eq+'a+b'").filter)).toBe('a b')
    expect(rightLiteral(parseQuery("$filter=Name eq '%2526'").filter)).toBe('%26')
  })

  it("decodes %27 quotes and keeps OData's '' escape", () => {
    expect(rightLiteral(parseQuery('$filter=Name%20eq%20%27O%27%27Brien%27').filter)).toBe(
      "O'Brien",
    )
  })

  it('decodes option names (%24filter) and nested $expand options', () => {
    const { expand } = parseQuery(
      "%24expand=Items(%24filter%3DNote%20eq%20'b%20%26%20c'%3B%24select%3DNote)",
    )
    const [item] = expand?.items ?? []
    expect(rightLiteral(item?.filter)).toBe('b & c')
    expect(item?.select?.items?.map((i) => i.path)).toEqual([['Note']])
  })

  it('accepts a leading ?, empty parameters and parameters without a value', () => {
    expect(parseQuery('?&$top=1&&flag')).toMatchObject({ top: 1 })
    expect(parseQuery('')).toEqual({})
  })

  it('refuses malformed percent-encoding with an ODataParseError', () => {
    expect(() => parseQuery("$filter=Name eq '100%'")).toThrow(ODataParseError)
    expect(() => parseQuery("$filter=Name eq '100%'")).toThrow(/percent-encoding/)
  })

  it('refuses a repeated system query option', () => {
    expect(() => parseQuery('$top=1&$top=2&$top=3')).toThrow(/more than once/)
  })

  it('unchanged for unencoded queries', () => {
    const result = parseQuery('$filter=Active eq true&$expand=Customer&$orderby=Name desc')
    expect(result.filter).toMatchObject({ kind: 'BinaryExpr', operator: 'eq' })
    expect(result.expand?.items[0]?.navigationProperty).toBe('Customer')
    expect(result.orderBy?.[0]?.direction).toBe('desc')
  })
})
