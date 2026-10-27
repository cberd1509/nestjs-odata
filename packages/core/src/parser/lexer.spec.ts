import { describe, expect, it } from 'vitest'
import { tokenize } from './lexer.js'
import { parseFilter } from './parser.js'

describe('tokenize(): signed numeric literals (ABNF: [ SIGN ] 1*DIGIT)', () => {
  it('lexes a minus sign followed by digits as a negative integer or decimal', () => {
    expect(tokenize('Price eq -5')[2]).toMatchObject({ kind: 'INT_LITERAL', value: -5 })
    expect(tokenize('Price gt -5.25')[2]).toMatchObject({ kind: 'DECIMAL_LITERAL', value: -5.25 })
  })

  it('parses negative literals in comparisons, arithmetic and function arguments', () => {
    expect(parseFilter('Price eq -5')).toMatchObject({
      kind: 'BinaryExpr',
      operator: 'eq',
      right: { kind: 'Literal', literalKind: 'number', value: -5 },
    })
    expect(parseFilter('Price sub -1 eq 2')).toMatchObject({
      left: { operator: 'sub', right: { kind: 'Literal', value: -1 } },
    })
    expect(parseFilter('substring(Name, 1) eq -1.5')).toMatchObject({
      right: { kind: 'Literal', value: -1.5 },
    })
  })

  it('still rejects a dash that does not start a number', () => {
    expect(() => tokenize('Price eq -x')).toThrow(/Unexpected character '-'/)
    expect(() => tokenize('Price eq - 5')).toThrow(/Unexpected character '-'/)
  })
})

describe('tokenize(): GUID literals starting with a digit', () => {
  const guid = '01234567-89ab-cdef-0123-456789abcdef'

  it('lexes the GUID when more input follows it', () => {
    expect(tokenize(`Id eq ${guid} and Qty eq 1`)[2]).toMatchObject({
      kind: 'GUID_LITERAL',
      value: guid,
    })
    expect(parseFilter(`(Id eq ${guid})`)).toMatchObject({
      right: { kind: 'Literal', literalKind: 'guid', value: guid },
    })
  })

  it('lexes the GUID at the end of the input', () => {
    expect(tokenize(`Id eq ${guid}`)[2]).toMatchObject({ kind: 'GUID_LITERAL', value: guid })
  })
})
