/**
 * Tests for how query option values reach the parser: parseQueryOptions takes decoded values and
 * never decodes them again; parseQueryString takes a raw query string, splits it on `&` between
 * parameters only and decodes each name and value once; parseQuery keeps its 2.3.0 contract.
 */
import { describe, it, expect } from 'vitest'
import { parseQuery, parseQueryOptions, parseQueryString } from './index.js'
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

  it('ignores unknown parameters, also repeated or non-string ones, and undefined values', () => {
    expect(
      parseQueryOptions({ foo: ['a', 'b'], bar: { nested: 'x' }, $top: '1', $filter: undefined }),
    ).toMatchObject({ top: 1, filter: undefined })
  })

  it.each([
    ['an object ($filter[x]=... with an extended query parser)', { x: "Name eq 'a'" }],
    ['a number', 5],
    ['a boolean', true],
    ['null', null],
  ])('refuses a system query option whose value is %s', (_label, value) => {
    expect(() => parseQueryOptions({ $filter: value })).toThrow(ODataParseError)
    expect(() => parseQueryOptions({ $filter: value })).toThrow(/single text value/)
  })

  it('refuses a repeated system query option', () => {
    expect(() => parseQueryOptions({ $top: ['1', '2'] })).toThrow(ODataParseError)
    expect(() => parseQueryOptions({ $top: ['1', '2'] })).toThrow(/more than once/)
  })

  it.each([
    ['$top', '$TOP'],
    ['$filter', '$FILTER'],
    ['$search', '$Search'],
    ['$count', '$COUNT'],
  ])('refuses %s together with %s', (a, b) => {
    const value = a === '$top' ? '1' : a === '$count' ? 'true' : a === '$search' ? 'x' : 'Id eq 1'
    expect(() => parseQueryOptions({ [a]: value, [b]: value })).toThrow(/more than once/)
  })

  it('parses $count, $search and $apply in the same pass, values as given', () => {
    const result = parseQueryOptions({
      $COUNT: 'true',
      $search: '"A & 100% C+"',
      $apply: "filter(Name eq 'b & c')",
    })
    expect(result.count).toBe(true)
    expect(result.search).toEqual({ kind: 'SearchTerm', value: 'A & 100% C+' })
    expect(result.apply).toMatchObject({ steps: [{ kind: 'ApplyFilter' }] })
    expect(parseQueryOptions({ $count: 'false' }).count).toBe(false)
  })
})

describe('parseQueryString (raw, percent-encoded query string)', () => {
  it('parses $count, $search and $apply too', () => {
    const result = parseQueryString(
      '$count=true&$search=%22a%20%26%20b%22&$apply=filter(Id%20eq%201)',
    )
    expect(result.count).toBe(true)
    expect(result.search).toEqual({ kind: 'SearchTerm', value: 'a & b' })
    expect(result.apply).toBeDefined()
  })

  it('refuses $top=1&$TOP=2', () => {
    expect(() => parseQueryString('$top=1&$TOP=2')).toThrow(/more than once/)
  })

  it('splits on & only between parameters: %26 stays inside the value', () => {
    const { filter, top } = parseQueryString("$filter=Name%20eq%20'A%20%26%20B'&$top=3")
    expect(rightLiteral(filter)).toBe('A & B')
    expect(top).toBe(3)
  })

  it('decodes each value once: %25 is a literal %, %2B a literal +, + a space', () => {
    expect(rightLiteral(parseQueryString("$filter=Name eq '100%25'").filter)).toBe('100%')
    expect(rightLiteral(parseQueryString("$filter=Name eq 'C%2B'").filter)).toBe('C+')
    expect(rightLiteral(parseQueryString("$filter=Name+eq+'a+b'").filter)).toBe('a b')
    expect(rightLiteral(parseQueryString("$filter=Name eq '%2526'").filter)).toBe('%26')
  })

  it("decodes %27 quotes and keeps OData's '' escape", () => {
    expect(rightLiteral(parseQueryString('$filter=Name%20eq%20%27O%27%27Brien%27').filter)).toBe(
      "O'Brien",
    )
  })

  it('decodes option names (%24filter) and nested $expand options', () => {
    const { expand } = parseQueryString(
      "%24expand=Items(%24filter%3DNote%20eq%20'b%20%26%20c'%3B%24select%3DNote)",
    )
    const [item] = expand?.items ?? []
    expect(rightLiteral(item?.filter)).toBe('b & c')
    expect(item?.select?.items?.map((i) => i.path)).toEqual([['Note']])
  })

  it('accepts a leading ?, empty parameters and parameters without a value', () => {
    expect(parseQueryString('?&$top=1&&flag')).toMatchObject({ top: 1 })
    expect(parseQueryString('')).toEqual({})
  })

  it('refuses malformed percent-encoding with an ODataParseError', () => {
    expect(() => parseQueryString("$filter=Name eq '100%'")).toThrow(ODataParseError)
    expect(() => parseQueryString("$filter=Name eq '100%'")).toThrow(/percent-encoding/)
  })

  it('refuses a repeated system query option', () => {
    expect(() => parseQueryString('$top=1&$top=2&$top=3')).toThrow(/more than once/)
  })

  it('unchanged for unencoded queries', () => {
    const result = parseQueryString('$filter=Active eq true&$expand=Customer&$orderby=Name desc')
    expect(result.filter).toMatchObject({ kind: 'BinaryExpr', operator: 'eq' })
    expect(result.expand?.items[0]?.navigationProperty).toBe('Customer')
    expect(result.orderBy?.[0]?.direction).toBe('desc')
  })
})

describe('parseQuery (2.3.0 contract: values used as given, no decoding)', () => {
  it('does not decode: %, %25, + and %2B stay as written', () => {
    expect(rightLiteral(parseQuery("$filter=Name eq '100%'").filter)).toBe('100%')
    expect(rightLiteral(parseQuery("$filter=Name eq '100%25'").filter)).toBe('100%25')
    expect(rightLiteral(parseQuery("$filter=Name eq 'C+'").filter)).toBe('C+')
    expect(rightLiteral(parseQuery("$filter=Name eq 'C%2B'").filter)).toBe('C%2B')
  })

  it('splits on every &, ignores $count, $search, $apply and unknown options', () => {
    const result = parseQuery('?$top=2&$search=%&$apply=(&$count=x&flag&other=1')
    expect(result).toEqual({
      filter: undefined,
      orderBy: undefined,
      select: undefined,
      top: 2,
      skip: undefined,
      expand: undefined,
    })
  })

  it('names are case-insensitive and the last repeated option wins', () => {
    expect(parseQuery('$top=1&$TOP=2').top).toBe(2)
  })

  it('parses the options it always parsed', () => {
    const result = parseQuery(
      "$filter=Name eq 'x'&$select=Name&$orderby=Name desc&$skip=1&$expand=Items",
    )
    expect(rightLiteral(result.filter)).toBe('x')
    expect(result.select?.items?.map((i) => i.path)).toEqual([['Name']])
    expect(result.orderBy?.[0]?.direction).toBe('desc')
    expect(result.skip).toBe(1)
    expect(result.expand?.items[0]?.navigationProperty).toBe('Items')
  })
})
