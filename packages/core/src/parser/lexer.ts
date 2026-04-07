/**
 * OData v4 Lexer (tokenizer).
 * Converts an OData query expression string into a token stream.
 *
 * This is the stub file for the TDD RED phase.
 * Full implementation is in Task 2 (GREEN phase).
 */

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

/** A single lexer token with kind, value, and source position */
export interface Token {
  readonly kind: TokenKind
  readonly value: string | number | boolean | null
  readonly position: number
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
  void input
  throw new Error('Not implemented — TDD RED phase')
}
