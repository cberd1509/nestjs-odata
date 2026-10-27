/**
 * Error paths and less common forms of the $search and $apply parsers.
 */
import { describe, it, expect } from 'vitest'
import { parseApply } from './apply-parser.js'
import { parseSearch } from './search-parser.js'
import { ODataParseError } from './errors.js'

describe('parseSearch() edge cases', () => {
  it('rejects NOT at the end of the expression', () => {
    expect(() => parseSearch('blue NOT')).toThrow('NOT operator must be followed by a search term')
  })

  it('takes an unterminated phrase up to the end of the input', () => {
    expect(parseSearch('"blue car')).toEqual({ kind: 'SearchTerm', value: 'blue car' })
  })

  it('negates a quoted phrase after NOT', () => {
    expect(parseSearch('NOT "blue car"')).toEqual({
      kind: 'SearchTerm',
      value: 'blue car',
      negated: true,
    })
  })

  it('negates an unterminated quoted phrase after NOT', () => {
    expect(parseSearch('NOT "blue')).toEqual({ kind: 'SearchTerm', value: 'blue', negated: true })
  })

  it('rejects a dangling binary operator', () => {
    expect(() => parseSearch('blue OR')).toThrow(ODataParseError)
    expect(() => parseSearch('AND blue')).toThrow(/at least one search term/)
  })

  it('rejects an expression with too many implicit ANDs', () => {
    const terms = Array.from({ length: 21 }, (_, i) => `t${i}`).join(' ')
    expect(() => parseSearch(terms)).toThrow(/exceeds maximum depth of 20/)
  })

  it('accepts an expression just under the operator limit', () => {
    const terms = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' ')
    expect(parseSearch(terms)).toMatchObject({ kind: 'SearchBinary', operator: 'AND' })
  })
})

describe('parseApply() edge cases', () => {
  it('ignores a trailing "/" after the last step', () => {
    expect(parseApply('filter(Price gt 1)/').steps).toHaveLength(1)
  })

  it('rejects an unknown aggregate method', () => {
    expect(() => parseApply('aggregate(Price with median as M)')).toThrow(
      /Unknown aggregate method 'median'/,
    )
  })

  it('rejects an alias that is not a simple identifier', () => {
    expect(() => parseApply('aggregate(Price with sum as 1x)')).toThrow(/Invalid aggregate alias/)
    expect(() => parseApply('aggregate($count as a;b)')).toThrow(/Invalid aggregate alias/)
  })

  it('keeps commas inside parentheses together when splitting aggregate expressions', () => {
    expect(() => parseApply('aggregate(sum(a, b) as x)')).toThrow(
      "Invalid aggregate expression 'sum(a, b) as x'",
    )
  })

  it('ignores a trailing comma in the aggregate list', () => {
    const result = parseApply('aggregate(Price with sum as Total,)')
    expect(result.steps[0]).toEqual({
      kind: 'ApplyAggregate',
      expressions: [{ property: 'Price', method: 'sum', alias: 'Total' }],
    })
  })

  it("rejects groupby() whose argument does not start with '('", () => {
    expect(() => parseApply('groupby(Category)')).toThrow(
      "Invalid groupby() syntax: expected '(' to start property list, got 'C'",
    )
  })

  it('rejects an unclosed groupby() property list', () => {
    expect(() => parseApply('groupby((Category,Brand)')).toThrow(
      'Unclosed parenthesis in groupby() property list',
    )
  })

  it('finds the end of a property list that itself contains parentheses', () => {
    const result = parseApply('groupby(((a),b))')
    expect(result.steps[0]).toEqual({
      kind: 'ApplyGroupBy',
      properties: ['(a)', 'b'],
      aggregate: undefined,
    })
  })

  it('rejects content after the property list other than aggregate()', () => {
    expect(() => parseApply('groupby((Category),filter(x))')).toThrow(
      /Unexpected content after groupby\(\) property list/,
    )
  })

  it('names a step without parentheses in the unrecognized-step error', () => {
    expect(() => parseApply('identity')).toThrow(
      "Unrecognized $apply transformation step 'identity'",
    )
    expect(() => parseApply('compute(a as b)')).toThrow(
      "Unrecognized $apply transformation step 'compute'",
    )
  })

  it('rejects an empty pipeline', () => {
    expect(() => parseApply('  ')).toThrow(/at least one transformation step/)
  })
})
