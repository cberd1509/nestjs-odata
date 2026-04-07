import { describe, it, expect } from 'vitest'
import type {
  BinaryExprNode,
  OrderByItem,
  PropertyAccessNode,
  SelectNode,
} from '../../src/parser/ast.js'
import { ODataParseError } from '../../src/parser/errors.js'
import { parseQuery } from '../../src/parser/index.js'

// ---------------------------------------------------------------------------
// $filter via parseQuery
// ---------------------------------------------------------------------------

describe('parseQuery — $filter', () => {
  it('parses $filter=Price gt 5 into { filter: BinaryExpr }', () => {
    const result = parseQuery('$filter=Price gt 5')
    expect(result.filter).toBeDefined()
    expect(result.filter!.kind).toBe('BinaryExpr')
    const bin = result.filter as BinaryExprNode
    expect(bin.operator).toBe('gt')
    expect(bin.left.kind).toBe('PropertyAccess')
    expect((bin.left as PropertyAccessNode).path).toEqual(['Price'])
  })

  it('parses combined query with $filter', () => {
    const result = parseQuery('$filter=Price gt 5&$top=10&$skip=0')
    expect(result.filter).toBeDefined()
    expect(result.top).toBe(10)
    expect(result.skip).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// $orderby
// ---------------------------------------------------------------------------

describe('parseQuery — $orderby', () => {
  it('parses $orderby=Name asc -> single item with direction asc', () => {
    const result = parseQuery('$orderby=Name asc')
    expect(result.orderBy).toBeDefined()
    expect(result.orderBy!).toHaveLength(1)
    const item: OrderByItem = result.orderBy![0]
    expect(item.expression.kind).toBe('PropertyAccess')
    expect((item.expression as PropertyAccessNode).path).toEqual(['Name'])
    expect(item.direction).toBe('asc')
  })

  it('parses $orderby=Name asc,Price desc -> two items', () => {
    const result = parseQuery('$orderby=Name asc,Price desc')
    expect(result.orderBy!).toHaveLength(2)
    expect(result.orderBy![0].direction).toBe('asc')
    expect(result.orderBy![1].direction).toBe('desc')
    expect((result.orderBy![1].expression as PropertyAccessNode).path).toEqual(['Price'])
  })

  it('parses $orderby=Name (no direction) -> defaults to asc', () => {
    const result = parseQuery('$orderby=Name')
    expect(result.orderBy!).toHaveLength(1)
    expect(result.orderBy![0].direction).toBe('asc')
  })

  it('parses multi-field orderby: $orderby=Category/Name asc,Price desc', () => {
    const result = parseQuery('$orderby=Category/Name asc,Price desc')
    expect(result.orderBy!).toHaveLength(2)
    expect((result.orderBy![0].expression as PropertyAccessNode).path).toEqual(['Category', 'Name'])
  })
})

// ---------------------------------------------------------------------------
// $select
// ---------------------------------------------------------------------------

describe('parseQuery — $select', () => {
  it('parses $select=Name,Price -> two SelectItems', () => {
    const result = parseQuery('$select=Name,Price')
    expect(result.select).toBeDefined()
    const sel: SelectNode = result.select!
    expect(sel.items).toHaveLength(2)
    expect(sel.items![0].path).toEqual(['Name'])
    expect(sel.items![1].path).toEqual(['Price'])
  })

  it('parses $select=* -> SelectAll { all: true }', () => {
    const result = parseQuery('$select=*')
    expect(result.select).toBeDefined()
    expect(result.select!.all).toBe(true)
  })

  it('parses $select=Category/Name -> nested path', () => {
    const result = parseQuery('$select=Category/Name')
    expect(result.select!.items![0].path).toEqual(['Category', 'Name'])
  })

  it('parses $select=Name -> single item', () => {
    const result = parseQuery('$select=Name')
    expect(result.select!.items).toHaveLength(1)
    expect(result.select!.items![0].path).toEqual(['Name'])
  })
})

// ---------------------------------------------------------------------------
// $top and $skip
// ---------------------------------------------------------------------------

describe('parseQuery — $top and $skip', () => {
  it('parses $top=10 -> { top: 10 }', () => {
    const result = parseQuery('$top=10')
    expect(result.top).toBe(10)
  })

  it('parses $skip=20 -> { skip: 20 }', () => {
    const result = parseQuery('$skip=20')
    expect(result.skip).toBe(20)
  })

  it('parses $top=0 -> { top: 0 } (zero is valid)', () => {
    const result = parseQuery('$top=0')
    expect(result.top).toBe(0)
  })

  it('parses $skip=0 -> { skip: 0 } (zero is valid)', () => {
    const result = parseQuery('$skip=0')
    expect(result.skip).toBe(0)
  })

  it('throws ODataParseError for $top=-1 (negative not allowed)', () => {
    expect(() => parseQuery('$top=-1')).toThrow(ODataParseError)
  })

  it('throws ODataParseError for $skip=-5 (negative not allowed)', () => {
    expect(() => parseQuery('$skip=-5')).toThrow(ODataParseError)
  })

  it('throws ODataParseError for $top=abc (non-integer)', () => {
    expect(() => parseQuery('$top=abc')).toThrow(ODataParseError)
  })
})

// ---------------------------------------------------------------------------
// Combined query options
// ---------------------------------------------------------------------------

describe('parseQuery — combined query options', () => {
  it('parses $filter=Price gt 5&$orderby=Name&$top=10&$skip=0 — all fields populated', () => {
    const result = parseQuery('$filter=Price gt 5&$orderby=Name&$top=10&$skip=0')
    expect(result.filter).toBeDefined()
    expect(result.orderBy).toBeDefined()
    expect(result.top).toBe(10)
    expect(result.skip).toBe(0)
  })

  it('handles empty query string — returns empty QueryOptions', () => {
    const result = parseQuery('')
    expect(result.filter).toBeUndefined()
    expect(result.orderBy).toBeUndefined()
    expect(result.select).toBeUndefined()
    expect(result.top).toBeUndefined()
    expect(result.skip).toBeUndefined()
  })

  it('ignores unknown query options without throwing', () => {
    // Unknown options like $expand are not parsed in this spike
    expect(() => parseQuery('$top=5')).not.toThrow()
  })

  it('parses query string with leading ? (from HTTP request URL)', () => {
    const result = parseQuery('?$top=5&$skip=10')
    expect(result.top).toBe(5)
    expect(result.skip).toBe(10)
  })
})
