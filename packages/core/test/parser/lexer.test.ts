import { describe, it, expect } from 'vitest'
import { tokenize, TokenKind } from '../../src/parser/lexer.js'

describe('OData Lexer', () => {
  describe('identifiers', () => {
    it('tokenizes a plain identifier', () => {
      const tokens = tokenize('Price')
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[0].value).toBe('Price')
      expect(tokens[tokens.length - 1].kind).toBe(TokenKind.EOF)
    })

    it('tokenizes a multi-segment identifier', () => {
      const tokens = tokenize('Category')
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[0].value).toBe('Category')
    })
  })

  describe('numeric literals', () => {
    it('tokenizes an integer', () => {
      const tokens = tokenize('42')
      expect(tokens[0].kind).toBe(TokenKind.INT_LITERAL)
      expect(tokens[0].value).toBe(42)
    })

    it('tokenizes a decimal number', () => {
      const tokens = tokenize('3.14')
      expect(tokens[0].kind).toBe(TokenKind.DECIMAL_LITERAL)
      expect(tokens[0].value).toBeCloseTo(3.14)
    })

    it('tokenizes zero', () => {
      const tokens = tokenize('0')
      expect(tokens[0].kind).toBe(TokenKind.INT_LITERAL)
      expect(tokens[0].value).toBe(0)
    })
  })

  describe('string literals', () => {
    it('tokenizes a simple string literal', () => {
      const tokens = tokenize("'hello'")
      expect(tokens[0].kind).toBe(TokenKind.STRING_LITERAL)
      expect(tokens[0].value).toBe('hello')
    })

    it("handles OData string escaping: '' produces a single quote", () => {
      const tokens = tokenize("'O''Brien'")
      expect(tokens[0].kind).toBe(TokenKind.STRING_LITERAL)
      expect(tokens[0].value).toBe("O'Brien")
    })

    it('tokenizes an empty string', () => {
      const tokens = tokenize("''")
      expect(tokens[0].kind).toBe(TokenKind.STRING_LITERAL)
      expect(tokens[0].value).toBe('')
    })

    it('tokenizes a string with spaces', () => {
      const tokens = tokenize("'hello world'")
      expect(tokens[0].kind).toBe(TokenKind.STRING_LITERAL)
      expect(tokens[0].value).toBe('hello world')
    })
  })

  describe('boolean and null literals', () => {
    it('tokenizes true as BOOL_LITERAL', () => {
      const tokens = tokenize('true')
      expect(tokens[0].kind).toBe(TokenKind.BOOL_LITERAL)
      expect(tokens[0].value).toBe(true)
    })

    it('tokenizes false as BOOL_LITERAL', () => {
      const tokens = tokenize('false')
      expect(tokens[0].kind).toBe(TokenKind.BOOL_LITERAL)
      expect(tokens[0].value).toBe(false)
    })

    it('tokenizes null as NULL_LITERAL', () => {
      const tokens = tokenize('null')
      expect(tokens[0].kind).toBe(TokenKind.NULL_LITERAL)
      expect(tokens[0].value).toBeNull()
    })
  })

  describe('GUID literal', () => {
    it('tokenizes a GUID (8-4-4-4-12 hex pattern)', () => {
      const tokens = tokenize('12345678-1234-1234-1234-123456789abc')
      expect(tokens[0].kind).toBe(TokenKind.GUID_LITERAL)
      expect(tokens[0].value).toBe('12345678-1234-1234-1234-123456789abc')
    })
  })

  describe('keyword tokens', () => {
    it('tokenizes comparison operators: eq ne lt le gt ge', () => {
      const tokens = tokenize('eq ne lt le gt ge')
      expect(tokens[0].kind).toBe(TokenKind.EQ)
      expect(tokens[1].kind).toBe(TokenKind.NE)
      expect(tokens[2].kind).toBe(TokenKind.LT)
      expect(tokens[3].kind).toBe(TokenKind.LE)
      expect(tokens[4].kind).toBe(TokenKind.GT)
      expect(tokens[5].kind).toBe(TokenKind.GE)
    })

    it('tokenizes logical operators: and or not', () => {
      const tokens = tokenize('and or not')
      expect(tokens[0].kind).toBe(TokenKind.AND)
      expect(tokens[1].kind).toBe(TokenKind.OR)
      expect(tokens[2].kind).toBe(TokenKind.NOT)
    })

    it('tokenizes arithmetic operators: add sub mul div mod', () => {
      const tokens = tokenize('add sub mul div mod')
      expect(tokens[0].kind).toBe(TokenKind.ADD)
      expect(tokens[1].kind).toBe(TokenKind.SUB)
      expect(tokens[2].kind).toBe(TokenKind.MUL)
      expect(tokens[3].kind).toBe(TokenKind.DIV)
      expect(tokens[4].kind).toBe(TokenKind.MOD)
    })

    it('tokenizes has and in operators', () => {
      const tokens = tokenize('has in')
      expect(tokens[0].kind).toBe(TokenKind.HAS)
      expect(tokens[1].kind).toBe(TokenKind.IN)
    })

    it('tokenizes divby', () => {
      const tokens = tokenize('divby')
      expect(tokens[0].kind).toBe(TokenKind.DIVBY)
    })
  })

  describe('punctuation tokens', () => {
    it('tokenizes open paren', () => {
      const tokens = tokenize('(')
      expect(tokens[0].kind).toBe(TokenKind.OPEN_PAREN)
    })

    it('tokenizes close paren', () => {
      const tokens = tokenize(')')
      expect(tokens[0].kind).toBe(TokenKind.CLOSE_PAREN)
    })

    it('tokenizes comma', () => {
      const tokens = tokenize(',')
      expect(tokens[0].kind).toBe(TokenKind.COMMA)
    })

    it('tokenizes slash', () => {
      const tokens = tokenize('/')
      expect(tokens[0].kind).toBe(TokenKind.SLASH)
    })

    it('tokenizes colon', () => {
      const tokens = tokenize(':')
      expect(tokens[0].kind).toBe(TokenKind.COLON)
    })

    it('tokenizes star', () => {
      const tokens = tokenize('*')
      expect(tokens[0].kind).toBe(TokenKind.STAR)
    })
  })

  describe('compound expressions', () => {
    it('tokenizes "Price gt 5"', () => {
      const tokens = tokenize('Price gt 5')
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[0].value).toBe('Price')
      expect(tokens[1].kind).toBe(TokenKind.GT)
      expect(tokens[2].kind).toBe(TokenKind.INT_LITERAL)
      expect(tokens[2].value).toBe(5)
      expect(tokens[3].kind).toBe(TokenKind.EOF)
    })

    it('tokenizes "Name eq \'Alice\'"', () => {
      const tokens = tokenize("Name eq 'Alice'")
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[1].kind).toBe(TokenKind.EQ)
      expect(tokens[2].kind).toBe(TokenKind.STRING_LITERAL)
      expect(tokens[2].value).toBe('Alice')
    })

    it("tokenizes function call syntax: contains(Name,'widget')", () => {
      const tokens = tokenize("contains(Name,'widget')")
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[0].value).toBe('contains')
      expect(tokens[1].kind).toBe(TokenKind.OPEN_PAREN)
      expect(tokens[2].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[3].kind).toBe(TokenKind.COMMA)
      expect(tokens[4].kind).toBe(TokenKind.STRING_LITERAL)
      expect(tokens[5].kind).toBe(TokenKind.CLOSE_PAREN)
    })
  })

  describe('whitespace handling', () => {
    it('skips leading and trailing whitespace', () => {
      const tokens = tokenize('  Price  ')
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER)
      expect(tokens[1].kind).toBe(TokenKind.EOF)
    })

    it('skips whitespace between tokens', () => {
      const tokens = tokenize('a   eq   b')
      expect(tokens.filter((t) => t.kind !== TokenKind.EOF)).toHaveLength(3)
    })
  })

  describe('EOF token', () => {
    it('always appends EOF token', () => {
      const tokens = tokenize('')
      expect(tokens[tokens.length - 1].kind).toBe(TokenKind.EOF)
    })
  })

  describe('position tracking', () => {
    it('records token position', () => {
      const tokens = tokenize('Price gt 5')
      expect(typeof tokens[0].position).toBe('number')
      expect(tokens[0].position).toBe(0)
      expect(tokens[1].position).toBe(6) // 'Price ' = 6 chars
    })
  })
})
