/**
 * OData v4 Lexer (tokenizer).
 * Converts an OData query expression string into a token stream.
 *
 * Character-by-character scanning with keyword disambiguation.
 * OData keyword recognition per Part 2 Section 5.1.1 ABNF grammar.
 */

import { ODataParseError } from './errors.js'

/** All token kinds produced by the OData lexer */
export enum TokenKind {
  // Literals
  STRING_LITERAL = 'STRING_LITERAL',
  INT_LITERAL = 'INT_LITERAL',
  DECIMAL_LITERAL = 'DECIMAL_LITERAL',
  BOOL_LITERAL = 'BOOL_LITERAL',
  NULL_LITERAL = 'NULL_LITERAL',
  GUID_LITERAL = 'GUID_LITERAL',
  DATETIME_LITERAL = 'DATETIME_LITERAL',

  // Identifiers
  IDENTIFIER = 'IDENTIFIER',

  // Punctuation
  OPEN_PAREN = 'OPEN_PAREN',
  CLOSE_PAREN = 'CLOSE_PAREN',
  COMMA = 'COMMA',
  SLASH = 'SLASH',
  COLON = 'COLON',
  STAR = 'STAR',

  // Logical operators
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Comparison operators
  EQ = 'EQ',
  NE = 'NE',
  LT = 'LT',
  LE = 'LE',
  GT = 'GT',
  GE = 'GE',
  HAS = 'HAS',
  IN = 'IN',

  // Arithmetic operators
  ADD = 'ADD',
  SUB = 'SUB',
  MUL = 'MUL',
  DIV = 'DIV',
  DIVBY = 'DIVBY',
  MOD = 'MOD',

  // End of input
  EOF = 'EOF',
}

/** Mapping of OData keyword strings to their TokenKind */
const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  and: TokenKind.AND,
  or: TokenKind.OR,
  not: TokenKind.NOT,
  eq: TokenKind.EQ,
  ne: TokenKind.NE,
  lt: TokenKind.LT,
  le: TokenKind.LE,
  gt: TokenKind.GT,
  ge: TokenKind.GE,
  has: TokenKind.HAS,
  in: TokenKind.IN,
  add: TokenKind.ADD,
  sub: TokenKind.SUB,
  mul: TokenKind.MUL,
  div: TokenKind.DIV,
  divby: TokenKind.DIVBY,
  mod: TokenKind.MOD,
}

/** GUID pattern: 8-4-4-4-12 hex chars */
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** A single lexer token with kind, value, and source position */
export interface Token {
  readonly kind: TokenKind
  readonly value: string | number | boolean | null
  readonly position: number
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch)
}

/**
 * Tokenize an OData query expression string into a token array.
 * The last token is always EOF.
 *
 * @param input - Raw OData expression string (e.g., "Price gt 5 and Active eq true")
 * @returns Array of tokens ending with EOF
 * @throws ODataParseError on unrecognized characters
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  while (pos < input.length) {
    // Skip whitespace
    if (input[pos] === ' ' || input[pos] === '\t') {
      pos++
      continue
    }

    const start = pos
    const ch = input[pos]

    // Single-character punctuation
    if (ch === '(') {
      tokens.push({ kind: TokenKind.OPEN_PAREN, value: '(', position: start })
      pos++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: TokenKind.CLOSE_PAREN, value: ')', position: start })
      pos++
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: TokenKind.COMMA, value: ',', position: start })
      pos++
      continue
    }
    if (ch === '/') {
      tokens.push({ kind: TokenKind.SLASH, value: '/', position: start })
      pos++
      continue
    }
    if (ch === ':') {
      tokens.push({ kind: TokenKind.COLON, value: ':', position: start })
      pos++
      continue
    }
    if (ch === '*') {
      tokens.push({ kind: TokenKind.STAR, value: '*', position: start })
      pos++
      continue
    }

    // String literal: starts with single quote
    if (ch === "'") {
      pos++ // consume opening quote
      let value = ''
      while (pos < input.length) {
        if (input[pos] === "'") {
          // Check for escaped quote: ''
          if (pos + 1 < input.length && input[pos + 1] === "'") {
            value += "'"
            pos += 2
          } else {
            pos++ // consume closing quote
            break
          }
        } else {
          value += input[pos]
          pos++
        }
      }
      tokens.push({ kind: TokenKind.STRING_LITERAL, value, position: start })
      continue
    }

    // Numeric literal: digit or negative number
    if (isDigit(ch)) {
      let numStr = ''
      while (pos < input.length && isDigit(input[pos])) {
        numStr += input[pos++]
      }
      // Check for decimal
      if (
        pos < input.length &&
        input[pos] === '.' &&
        pos + 1 < input.length &&
        isDigit(input[pos + 1])
      ) {
        numStr += '.'
        pos++
        while (pos < input.length && isDigit(input[pos])) {
          numStr += input[pos++]
        }
        tokens.push({ kind: TokenKind.DECIMAL_LITERAL, value: parseFloat(numStr), position: start })
      } else {
        // Could be start of GUID — check if followed by hex chars and dashes
        // e.g., 12345678-1234-...
        const remaining = input.slice(start)
        const guidMatch = GUID_RE.exec(remaining)
        if (guidMatch && remaining.length >= 36) {
          const guidStr = remaining.slice(0, 36)
          if (GUID_RE.test(guidStr)) {
            tokens.push({ kind: TokenKind.GUID_LITERAL, value: guidStr, position: start })
            pos = start + 36
            continue
          }
        }
        tokens.push({ kind: TokenKind.INT_LITERAL, value: parseInt(numStr, 10), position: start })
      }
      continue
    }

    // Identifier or keyword: starts with alpha or underscore
    if (isAlpha(ch)) {
      let word = ''
      // Collect alphanumeric + underscore + dash (for GUID-like patterns starting with letter)
      while (pos < input.length && (isAlphaNum(input[pos]) || input[pos] === '-')) {
        // Peek: if we see a dash, check if it looks like a GUID pattern
        if (input[pos] === '-') {
          // Only include dash if it looks like it's part of a GUID
          const soFar = word + input.slice(start, pos)
          void soFar
          // Check remaining from start
          const remaining = input.slice(start)
          if (GUID_RE.test(remaining.slice(0, 36))) {
            const guidStr = remaining.slice(0, 36)
            tokens.push({ kind: TokenKind.GUID_LITERAL, value: guidStr, position: start })
            pos = start + 36
            word = '' // signal we handled it
            break
          }
          // Not a GUID dash — stop consuming
          break
        }
        word += input[pos++]
      }

      // If word is empty, we consumed a GUID above — continue
      if (word === '') continue

      // Check for DateTimeOffset: word looks like date part "2024-01-15T..."
      // Actually DATETIME will start with digits, handled above. Skip here.

      // Boolean literals
      if (word === 'true') {
        tokens.push({ kind: TokenKind.BOOL_LITERAL, value: true, position: start })
        continue
      }
      if (word === 'false') {
        tokens.push({ kind: TokenKind.BOOL_LITERAL, value: false, position: start })
        continue
      }
      // Null literal
      if (word === 'null') {
        tokens.push({ kind: TokenKind.NULL_LITERAL, value: null, position: start })
        continue
      }

      // Keywords
      if (word in KEYWORDS) {
        tokens.push({ kind: KEYWORDS[word], value: word, position: start })
        continue
      }

      // Plain identifier
      tokens.push({ kind: TokenKind.IDENTIFIER, value: word, position: start })
      continue
    }

    // Unrecognized character
    throw new ODataParseError(`Unexpected character '${ch}' at position ${pos}`, pos)
  }

  tokens.push({ kind: TokenKind.EOF, value: null, position: pos })
  return tokens
}
