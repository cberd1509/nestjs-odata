/**
 * Unit tests for parseApply() function.
 * TDD: these tests were written before the implementation.
 */
import { describe, it, expect } from 'vitest'
import { parseApply } from './apply-parser.js'
import { ODataParseError } from './errors.js'

describe('parseApply()', () => {
  describe('aggregate() step', () => {
    it('parses aggregate with sum method', () => {
      const result = parseApply('aggregate(Total with sum as GrandTotal)')
      expect(result).toEqual({
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Total', method: 'sum', alias: 'GrandTotal' }],
          },
        ],
      })
    })

    it('parses aggregate with $count special property', () => {
      const result = parseApply('aggregate($count as OrderCount)')
      expect(result).toEqual({
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: '$count', method: 'count', alias: 'OrderCount' }],
          },
        ],
      })
    })

    it('parses aggregate with avg method', () => {
      const result = parseApply('aggregate(Price with avg as AvgPrice)')
      expect(result.steps[0]).toMatchObject({
        kind: 'ApplyAggregate',
        expressions: [{ property: 'Price', method: 'avg', alias: 'AvgPrice' }],
      })
    })

    it('parses aggregate with min method', () => {
      const result = parseApply('aggregate(Price with min as MinPrice)')
      expect(result.steps[0]).toMatchObject({
        kind: 'ApplyAggregate',
        expressions: [{ property: 'Price', method: 'min', alias: 'MinPrice' }],
      })
    })

    it('parses aggregate with max method', () => {
      const result = parseApply('aggregate(Price with max as MaxPrice)')
      expect(result.steps[0]).toMatchObject({
        kind: 'ApplyAggregate',
        expressions: [{ property: 'Price', method: 'max', alias: 'MaxPrice' }],
      })
    })

    it('parses multiple aggregate expressions in one step', () => {
      const result = parseApply('aggregate(Price with avg as AvgPrice,Price with min as MinPrice)')
      expect(result.steps).toHaveLength(1)
      const step = result.steps[0]
      expect(step.kind).toBe('ApplyAggregate')
      if (step.kind === 'ApplyAggregate') {
        expect(step.expressions).toHaveLength(2)
        expect(step.expressions[0]).toEqual({ property: 'Price', method: 'avg', alias: 'AvgPrice' })
        expect(step.expressions[1]).toEqual({ property: 'Price', method: 'min', alias: 'MinPrice' })
      }
    })
  })

  describe('groupby() step', () => {
    it('parses groupby with single property and aggregate', () => {
      const result = parseApply('groupby((CustomerId),aggregate($count as OrderCount))')
      expect(result).toEqual({
        steps: [
          {
            kind: 'ApplyGroupBy',
            properties: ['CustomerId'],
            aggregate: [{ property: '$count', method: 'count', alias: 'OrderCount' }],
          },
        ],
      })
    })

    it('parses groupby with multiple properties', () => {
      const result = parseApply(
        'groupby((CustomerId,Status),aggregate(Total with sum as GrandTotal))',
      )
      const step = result.steps[0]
      expect(step.kind).toBe('ApplyGroupBy')
      if (step.kind === 'ApplyGroupBy') {
        expect(step.properties).toEqual(['CustomerId', 'Status'])
        expect(step.aggregate).toHaveLength(1)
      }
    })

    it('parses groupby without aggregate', () => {
      const result = parseApply('groupby((CustomerId))')
      const step = result.steps[0]
      expect(step.kind).toBe('ApplyGroupBy')
      if (step.kind === 'ApplyGroupBy') {
        expect(step.properties).toEqual(['CustomerId'])
        expect(step.aggregate).toBeUndefined()
      }
    })
  })

  describe('filter() step', () => {
    it('parses filter step that produces ApplyFilterStep with a parsed FilterNode', () => {
      const result = parseApply("filter(Status eq 'open')")
      expect(result.steps).toHaveLength(1)
      const step = result.steps[0]
      expect(step.kind).toBe('ApplyFilter')
      if (step.kind === 'ApplyFilter') {
        expect(step.filter).toBeDefined()
        expect(step.filter.kind).toBe('BinaryExpr')
      }
    })
  })

  describe('multi-step pipelines', () => {
    it('parses filter/groupby 2-step pipeline', () => {
      const result = parseApply(
        "filter(Status eq 'open')/groupby((CustomerId),aggregate($count as Total))",
      )
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0].kind).toBe('ApplyFilter')
      expect(result.steps[1].kind).toBe('ApplyGroupBy')
    })
  })

  describe('security validations', () => {
    it('throws ODataParseError for invalid alias (SQL injection attempt)', () => {
      expect(() => parseApply('aggregate(Total with sum as "Total; DROP TABLE")')).toThrow(
        ODataParseError,
      )
    })

    it('throws ODataParseError for alias containing semicolons', () => {
      expect(() => parseApply('aggregate(Total with sum as Bad;Alias)')).toThrow(ODataParseError)
    })

    it('throws ODataParseError for alias containing spaces', () => {
      expect(() => parseApply('aggregate(Total with sum as Bad Alias)')).toThrow(ODataParseError)
    })

    it('throws ODataParseError for post-groupby filter (HAVING not supported)', () => {
      expect(() =>
        parseApply('groupby((CustomerId),aggregate($count as Total))/filter(Total gt 5)'),
      ).toThrow(ODataParseError)
    })

    it('throws ODataParseError for filter after aggregate step', () => {
      expect(() =>
        parseApply('aggregate(Total with sum as GrandTotal)/filter(GrandTotal gt 100)'),
      ).toThrow(ODataParseError)
    })
  })

  describe('error handling', () => {
    it('throws ODataParseError for empty string', () => {
      expect(() => parseApply('')).toThrow(ODataParseError)
    })

    it('throws ODataParseError for unrecognized transformation step', () => {
      expect(() => parseApply('unknown(foo)')).toThrow(ODataParseError)
    })
  })
})
