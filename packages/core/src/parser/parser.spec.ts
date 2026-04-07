/**
 * Tests for $expand parsing in parseQuery.
 * These tests cover ExpandNode/ExpandItem AST types and nested query options.
 */

import { describe, it, expect } from 'vitest'
import type { ExpandNode, ExpandItem, BinaryExprNode, PropertyAccessNode } from './ast.js'
import { parseQuery } from './index.js'

describe('$expand parsing', () => {
  it("parseQuery('$expand=Customer') returns expand with one item", () => {
    const result = parseQuery('$expand=Customer')
    expect(result.expand).toBeDefined()
    const expand = result.expand as ExpandNode
    expect(expand.items).toHaveLength(1)
    expect(expand.items[0].navigationProperty).toBe('Customer')
  })

  it("parseQuery('$expand=Customer,Items') returns expand with two items", () => {
    const result = parseQuery('$expand=Customer,Items')
    const expand = result.expand as ExpandNode
    expect(expand.items).toHaveLength(2)
    expect(expand.items[0].navigationProperty).toBe('Customer')
    expect(expand.items[1].navigationProperty).toBe('Items')
  })

  it("parseQuery('$expand=Items($filter=Amount gt 100)') returns expand item with nested filter", () => {
    const result = parseQuery('$expand=Items($filter=Amount gt 100)')
    const expand = result.expand as ExpandNode
    expect(expand.items).toHaveLength(1)
    const item: ExpandItem = expand.items[0]
    expect(item.navigationProperty).toBe('Items')
    expect(item.filter).toBeDefined()
    expect(item.filter!.kind).toBe('BinaryExpr')
    const bin = item.filter as BinaryExprNode
    expect(bin.operator).toBe('gt')
    expect((bin.left as PropertyAccessNode).path).toEqual(['Amount'])
  })

  it("parseQuery('$expand=Items($top=5;$skip=0;$orderby=Amount desc;$select=Id,Amount)') returns all nested options", () => {
    const result = parseQuery(
      '$expand=Items($top=5;$skip=0;$orderby=Amount desc;$select=Id,Amount)',
    )
    const expand = result.expand as ExpandNode
    const item: ExpandItem = expand.items[0]
    expect(item.navigationProperty).toBe('Items')
    expect(item.top).toBe(5)
    expect(item.skip).toBe(0)
    expect(item.orderBy).toHaveLength(1)
    expect(item.orderBy![0].direction).toBe('desc')
    expect(item.select).toBeDefined()
    expect(item.select!.items).toHaveLength(2)
  })

  it("parseQuery('$expand=Items($expand=Product)') returns recursive nested expand", () => {
    const result = parseQuery('$expand=Items($expand=Product)')
    const expand = result.expand as ExpandNode
    const item: ExpandItem = expand.items[0]
    expect(item.navigationProperty).toBe('Items')
    expect(item.expand).toBeDefined()
    expect(item.expand!.items).toHaveLength(1)
    expect(item.expand!.items[0].navigationProperty).toBe('Product')
  })

  it("parseQuery('$expand=Items($expand=Product($expand=Supplier))') returns 3-level nested expand", () => {
    const result = parseQuery('$expand=Items($expand=Product($expand=Supplier))')
    const expand = result.expand as ExpandNode
    const level1 = expand.items[0]
    expect(level1.navigationProperty).toBe('Items')
    const level2 = level1.expand!.items[0]
    expect(level2.navigationProperty).toBe('Product')
    const level3 = level2.expand!.items[0]
    expect(level3.navigationProperty).toBe('Supplier')
  })

  it("parseQuery('$filter=Active eq true&$expand=Customer') returns both filter and expand", () => {
    const result = parseQuery('$filter=Active eq true&$expand=Customer')
    expect(result.filter).toBeDefined()
    expect(result.expand).toBeDefined()
    const expand = result.expand as ExpandNode
    expect(expand.items[0].navigationProperty).toBe('Customer')
  })

  it("parseQuery('$expand=') returns expand with empty items array (no crash)", () => {
    expect(() => parseQuery('$expand=')).not.toThrow()
    const result = parseQuery('$expand=')
    // Should either be undefined or have empty items
    if (result.expand !== undefined) {
      expect(result.expand.items).toHaveLength(0)
    }
  })
})
