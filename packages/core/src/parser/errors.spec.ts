import { describe, it, expect } from 'vitest'
import { ODataParseError } from './errors.js'

describe('ODataParseError', () => {
  it('Test 1: accepts optional queryContext string', () => {
    const err = new ODataParseError('Unexpected token', 5, null, '...Price gtt 5...')

    expect(err.queryContext).toBe('...Price gtt 5...')
  })

  it('Test 2: queryContext is undefined when not provided', () => {
    const err = new ODataParseError('Unexpected token', 5)

    expect(err.queryContext).toBeUndefined()
  })

  it('Test 3: withContext static method creates error with context snippet', () => {
    const queryString = 'Price gtt 5 and Active eq true'
    const err = ODataParseError.withContext('Unexpected token', 6, queryString)

    expect(err).toBeInstanceOf(ODataParseError)
    expect(err.position).toBe(6)
    expect(err.queryContext).toBeDefined()
    expect(err.message).toContain('at position 6')
    expect(err.message).toContain('gtt')
  })

  it('Test 4: withContext extracts ~20 chars before and after error position', () => {
    const queryString = 'abcdefghijklmnopqrstuvwxyz_ERROR_abcdefghijklmnopqrstuvwxyz'
    const errorPos = 26 // position of _ERROR_
    const err = ODataParseError.withContext('Bad token', errorPos, queryString)

    expect(err.queryContext).toBeDefined()
    // Context should contain chars around position 26
    expect(err.queryContext!.length).toBeLessThanOrEqual(50) // roughly 20+20+some
  })

  it('Test 5: withContext handles error at start of query string', () => {
    const queryString = 'BAD_TOKEN and Active eq true'
    const err = ODataParseError.withContext('Unexpected', 0, queryString)

    expect(err.queryContext).toBeDefined()
    expect(err.queryContext).toContain('BAD_TOKEN')
  })

  it('Test 6: withContext handles error at end of query string', () => {
    const queryString = 'Price gt'
    const err = ODataParseError.withContext('Unexpected end', 8, queryString)

    expect(err.queryContext).toBeDefined()
    expect(err.queryContext).toContain('Price gt')
  })

  it('Test 7: withContext passes token through', () => {
    const token = { kind: 'IDENTIFIER', value: 'gtt', position: 6 }
    const err = ODataParseError.withContext('Unexpected', 6, 'Price gtt 5', token)

    expect(err.token).toBe(token)
  })

  it('Test 8: no "did you mean" text in any error message (D-11)', () => {
    const err = ODataParseError.withContext('Unexpected token', 6, 'Price gtt 5')

    expect(err.message.toLowerCase()).not.toContain('did you mean')
    expect(err.message.toLowerCase()).not.toContain('suggest')
    expect(err.message.toLowerCase()).not.toContain('similar')
  })
})
