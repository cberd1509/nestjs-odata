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
  DATE_LITERAL = 'DATE_LITERAL',
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

/** dateValue (P2 ABNF): `YYYY-MM-DD`. */
const DATE_RE = /\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/y

/** The time part of a dateTimeOffsetValue: `THH:MM[:SS[.fff]]` and `Z` or `±HH:MM`. */
const TIME_OF_DAY_OFFSET_RE =
  /T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,12})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)/y

/** The match of a sticky regex at `pos`, or undefined. */
function matchAt(re: RegExp, input: string, pos: number): string | undefined {
  re.lastIndex = pos
  return re.exec(input)?.[0]
}

/** True when the character at `pos` would continue a word (so a literal cannot end there). */
function continuesWord(input: string, pos: number): boolean {
  return pos < input.length && (isAlphaNum(input[pos]) || input[pos] === '-')
}

/** The GUID literal starting at `pos`, when it is one whole token. */
function guidAt(input: string, pos: number): string | undefined {
  const candidate = input.slice(pos, pos + 36)
  return GUID_RE.test(candidate) && !continuesWord(input, pos + 36) ? candidate : undefined
}

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
      // A GUID, date or dateTimeOffset that starts with a digit, anywhere in the input.
      const guid = guidAt(input, start)
      if (guid) {
        tokens.push({ kind: TokenKind.GUID_LITERAL, value: guid, position: start })
        pos = start + guid.length
        continue
      }
      const date = matchAt(DATE_RE, input, start)
      if (date) {
        const time = matchAt(TIME_OF_DAY_OFFSET_RE, input, start + date.length)
        const literal = date + (time ?? '')
        if (continuesWord(input, start + literal.length) || input[start + literal.length] === 'T') {
          throw new ODataParseError(`Invalid date/time literal at position ${start}`, start)
        }
        tokens.push({
          kind: time ? TokenKind.DATETIME_LITERAL : TokenKind.DATE_LITERAL,
          value: literal,
          position: start,
        })
        pos = start + literal.length
        continue
      }
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
        tokens.push({ kind: TokenKind.INT_LITERAL, value: parseInt(numStr, 10), position: start })
      }
      continue
    }

    // `$`-prefixed identifier (`$it`, `$root`, ...): the parser decides which ones it supports.
    if (ch === '$' && pos + 1 < input.length && isAlpha(input[pos + 1])) {
      pos++ // consume '$'
      let word = '$'
      while (pos < input.length && isAlphaNum(input[pos])) {
        word += input[pos++]
      }
      tokens.push({ kind: TokenKind.IDENTIFIER, value: word, position: start })
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
          const guidStr = guidAt(input, start)
          if (guidStr) {
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
