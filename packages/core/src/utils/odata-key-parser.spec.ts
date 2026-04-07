/**
 * Tests for parseODataKey — OData parenthetical key parsing utility.
 * Covers simple keys (numeric, string, boolean), composite keys, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { parseODataKey } from './odata-key-parser.js'

describe('parseODataKey', () => {
  it("parseODataKey('42', ['Id']) returns { Id: 42 }", () => {
    const result = parseODataKey('42', ['Id'])
    expect(result).toEqual({ Id: 42 })
  })

  it("parseODataKey(\"'hello'\", ['Name']) returns { Name: 'hello' }", () => {
    const result = parseODataKey("'hello'", ['Name'])
    expect(result).toEqual({ Name: 'hello' })
  })

  it("parseODataKey('OrderId=1,ItemId=3', ['OrderId', 'ItemId']) returns { OrderId: 1, ItemId: 3 }", () => {
    const result = parseODataKey('OrderId=1,ItemId=3', ['OrderId', 'ItemId'])
    expect(result).toEqual({ OrderId: 1, ItemId: 3 })
  })

  it("parseODataKey('true', ['Active']) returns { Active: true }", () => {
    const result = parseODataKey('true', ['Active'])
    expect(result).toEqual({ Active: true })
  })

  it("parseODataKey('3.14', ['Price']) returns { Price: 3.14 }", () => {
    const result = parseODataKey('3.14', ['Price'])
    expect(result).toEqual({ Price: 3.14 })
  })

  it("parseODataKey('abc123-def', ['Code']) returns { Code: 'abc123-def' } (unquoted non-numeric = string)", () => {
    const result = parseODataKey('abc123-def', ['Code'])
    expect(result).toEqual({ Code: 'abc123-def' })
  })

  it("parseODataKey('', ['Id']) throws Error", () => {
    expect(() => parseODataKey('', ['Id'])).toThrow('OData key cannot be empty')
  })

  it("parseODataKey('false', ['Flag']) returns { Flag: false }", () => {
    const result = parseODataKey('false', ['Flag'])
    expect(result).toEqual({ Flag: false })
  })
})
