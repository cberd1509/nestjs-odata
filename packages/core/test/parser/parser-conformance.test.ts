/**
 * OData 4.01 query-language conformance of the parser:
 *   - #68: case-insensitive lambda operators, `$it` path prefix
 *   - #69: nested `$expand` options `$count`, `$search`, `$levels`, `nav/$count`; unsupported
 *          options answer 501 instead of being ignored
 *   - #74: nested `$expand` options containing `;` inside parentheses
 */
import { describe, it, expect } from 'vitest'
import type { BinaryExprNode, LambdaExprNode, PropertyAccessNode } from '../../src/parser/ast.js'
import { ODataNotImplementedError, ODataParseError } from '../../src/parser/errors.js'
import { parseFilter, parseQuery } from '../../src/parser/index.js'

describe('lambda operators are case-insensitive (P2 §5.1.1.13)', () => {
  it.each(['ANY', 'Any', 'aNy'])('parses items/%s(...) as any', (op) => {
    const node = parseFilter(`items/${op}(d:d/quantity gt 100)`) as LambdaExprNode
    expect(node.kind).toBe('LambdaExpr')
    expect(node.operator).toBe('any')
    expect(node.collection).toBe('items')
  })

  it('parses items/ALL(...) as all', () => {
    const node = parseFilter('items/ALL(d:d/quantity gt 100)') as LambdaExprNode
    expect(node.operator).toBe('all')
  })

  it('still treats a property named like an operator, without parentheses, as a path', () => {
    const node = parseFilter('category/Any eq 1') as BinaryExprNode
    expect((node.left as PropertyAccessNode).path).toEqual(['category', 'Any'])
  })
})

describe('$it (P2 §5.1.1.14.4)', () => {
  it('binds $it/prop to the current resource (the prefix is dropped)', () => {
    const node = parseFilter('$it/totalAmount gt 5') as BinaryExprNode
    expect((node.left as PropertyAccessNode).path).toEqual(['totalAmount'])
  })

  it('accepts $it inside a lambda predicate, bound to the outer entity', () => {
    const node = parseFilter('items/any(d:d/quantity gt $it/totalAmount)') as LambdaExprNode
    const pred = node.predicate as BinaryExprNode
    expect((pred.left as PropertyAccessNode).path).toEqual(['d', 'quantity'])
    expect((pred.right as PropertyAccessNode).path).toEqual(['totalAmount'])
  })

  it('accepts a navigation path and a lambda after $it', () => {
    const nav = parseFilter("$it/category/name eq 'x'") as BinaryExprNode
    expect((nav.left as PropertyAccessNode).path).toEqual(['category', 'name'])
    const lambda = parseFilter('$it/items/any(d:d/quantity gt 1)') as LambdaExprNode
    expect(lambda.kind).toBe('LambdaExpr')
    expect(lambda.collection).toBe('items')
  })

  it('answers 501 for $root and a bare $it', () => {
    expect(() => parseFilter("$root/Products(1)/name eq 'x'")).toThrow(ODataNotImplementedError)
    expect(() => parseFilter('$it eq 1')).toThrow(ODataNotImplementedError)
  })

  it('answers 501 for $it inside $expand options (it would mean the resource-path entity)', () => {
    expect(() => parseQuery('$expand=items($filter=$it/totalAmount gt 1)')).toThrow(
      ODataNotImplementedError,
    )
  })

  it('rejects an unknown $-identifier with a parse error', () => {
    expect(() => parseFilter('$foo eq 1')).toThrow(ODataParseError)
  })
})

describe('nested $expand options (P2 §5.1.3)', () => {
  it('parses $count=true', () => {
    const { expand } = parseQuery('$expand=items($count=true)')
    expect(expand?.items[0]).toMatchObject({ navigationProperty: 'items', count: true })
  })

  it('parses $count=false as no count', () => {
    const { expand } = parseQuery('$expand=items($count=false)')
    expect(expand?.items[0].count).toBeUndefined()
  })

  it('rejects an invalid $count value', () => {
    expect(() => parseQuery('$expand=items($count=yes)')).toThrow(ODataParseError)
  })

  it('parses nested $search', () => {
    const { expand } = parseQuery('$expand=items($search=blue)')
    expect(expand?.items[0].search).toEqual({ kind: 'SearchTerm', value: 'blue' })
  })

  it('parses $levels as a number or max', () => {
    expect(parseQuery('$expand=manager($levels=3)').expand?.items[0].levels).toBe(3)
    expect(parseQuery('$expand=manager($levels=max)').expand?.items[0].levels).toBe('max')
    expect(() => parseQuery('$expand=manager($levels=0)')).toThrow(ODataParseError)
  })

  it('parses nav/$count with optional $filter and $search', () => {
    const plain = parseQuery('$expand=items/$count').expand?.items[0]
    expect(plain).toMatchObject({ navigationProperty: 'items', countOnly: true })
    const filtered = parseQuery('$expand=items/$count($filter=quantity gt 1)').expand?.items[0]
    expect(filtered?.countOnly).toBe(true)
    expect(filtered?.filter?.kind).toBe('BinaryExpr')
  })

  it('rejects options other than $filter/$search after nav/$count', () => {
    expect(() => parseQuery('$expand=items/$count($top=1)')).toThrow(ODataParseError)
  })

  it('answers 501 for nested options it does not implement', () => {
    expect(() => parseQuery('$expand=items($compute=quantity mul 2 as q)')).toThrow(
      ODataNotImplementedError,
    )
    expect(() => parseQuery('$expand=items/$ref')).toThrow(ODataNotImplementedError)
  })

  it('rejects an unknown nested system query option with 400', () => {
    expect(() => parseQuery('$expand=items($foo=1)')).toThrow(ODataParseError)
  })

  it('keeps the options of a nested $expand together (semicolons inside parentheses)', () => {
    const { expand } = parseQuery(
      '$expand=items($expand=product($select=name;$top=1);$top=2;$orderby=quantity desc)',
    )
    const items = expand!.items[0]
    expect(items.top).toBe(2)
    expect(items.orderBy?.[0].direction).toBe('desc')
    const product = items.expand!.items[0]
    expect(product.navigationProperty).toBe('product')
    expect(product.select?.items).toEqual([{ path: ['name'] }])
    expect(product.top).toBe(1)
  })

  it('does not split on a semicolon inside a string literal', () => {
    const { expand } = parseQuery("$expand=items($filter=name eq 'a;b';$top=1)")
    const filter = expand!.items[0].filter as BinaryExprNode
    expect(filter.right).toMatchObject({ value: 'a;b' })
    expect(expand!.items[0].top).toBe(1)
  })
})
