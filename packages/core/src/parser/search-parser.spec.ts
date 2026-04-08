/**
 * Unit tests for parseSearch() function.
 * TDD: these tests were written before the implementation.
 */
import { describe, it, expect } from 'vitest'
import { parseSearch } from './search-parser.js'
import { ODataParseError } from './errors.js'
import type { SearchBinaryNode } from './ast.js'

describe('parseSearch()', () => {
  describe('single terms', () => {
    it('parses a single bare word', () => {
      const result = parseSearch('laptop')
      expect(result).toEqual({ kind: 'SearchTerm', value: 'laptop' })
    })

    it('parses a quoted phrase as a single term', () => {
      const result = parseSearch('"premium laptop"')
      expect(result).toEqual({ kind: 'SearchTerm', value: 'premium laptop' })
    })

    it('trims whitespace around a single term', () => {
      const result = parseSearch('  laptop  ')
      expect(result).toEqual({ kind: 'SearchTerm', value: 'laptop' })
    })
  })

  describe('NOT prefix', () => {
    it('parses NOT before a bare term', () => {
      const result = parseSearch('NOT laptop')
      expect(result).toEqual({ kind: 'SearchTerm', value: 'laptop', negated: true })
    })

    it('parses NOT before a quoted phrase', () => {
      const result = parseSearch('NOT "premium laptop"')
      expect(result).toEqual({ kind: 'SearchTerm', value: 'premium laptop', negated: true })
    })
  })

  describe('OR operator', () => {
    it('parses explicit OR between two terms', () => {
      const result = parseSearch('laptop OR tablet') as SearchBinaryNode
      expect(result.kind).toBe('SearchBinary')
      expect(result.operator).toBe('OR')
      expect(result.left).toEqual({ kind: 'SearchTerm', value: 'laptop' })
      expect(result.right).toEqual({ kind: 'SearchTerm', value: 'tablet' })
    })
  })

  describe('AND operator', () => {
    it('parses explicit AND between two terms', () => {
      const result = parseSearch('laptop AND tablet') as SearchBinaryNode
      expect(result.kind).toBe('SearchBinary')
      expect(result.operator).toBe('AND')
      expect(result.left).toEqual({ kind: 'SearchTerm', value: 'laptop' })
      expect(result.right).toEqual({ kind: 'SearchTerm', value: 'tablet' })
    })

    it('implicit AND between adjacent terms (no operator)', () => {
      const result = parseSearch('laptop tablet') as SearchBinaryNode
      expect(result.kind).toBe('SearchBinary')
      expect(result.operator).toBe('AND')
      expect(result.left).toEqual({ kind: 'SearchTerm', value: 'laptop' })
      expect(result.right).toEqual({ kind: 'SearchTerm', value: 'tablet' })
    })
  })

  describe('complex expressions', () => {
    it('parses NOT term OR term', () => {
      const result = parseSearch('NOT "premium laptop" OR tablet') as SearchBinaryNode
      expect(result.kind).toBe('SearchBinary')
      expect(result.operator).toBe('OR')
      expect(result.left).toEqual({ kind: 'SearchTerm', value: 'premium laptop', negated: true })
      expect(result.right).toEqual({ kind: 'SearchTerm', value: 'tablet' })
    })

    it('parses three terms with AND (left-associative)', () => {
      const result = parseSearch('a AND b AND c') as SearchBinaryNode
      expect(result.kind).toBe('SearchBinary')
      expect(result.operator).toBe('AND')
      // Left associative: (a AND b) AND c
      const left = result.left as SearchBinaryNode
      expect(left.kind).toBe('SearchBinary')
      expect(left.left).toEqual({ kind: 'SearchTerm', value: 'a' })
      expect(left.right).toEqual({ kind: 'SearchTerm', value: 'b' })
      expect(result.right).toEqual({ kind: 'SearchTerm', value: 'c' })
    })
  })

  describe('error handling', () => {
    it('throws ODataParseError for empty string', () => {
      expect(() => parseSearch('')).toThrow(ODataParseError)
    })

    it('throws ODataParseError for whitespace-only input', () => {
      expect(() => parseSearch('   ')).toThrow(ODataParseError)
    })

    it('throws ODataParseError for deeply nested AND/OR (DoS protection)', () => {
      // Build 21 terms joined by AND — should exceed MAX_SEARCH_DEPTH=20
      const deepExpr = Array.from({ length: 21 }, (_, i) => `term${i}`).join(' AND ')
      expect(() => parseSearch(deepExpr)).toThrow(ODataParseError)
    })
  })
})
