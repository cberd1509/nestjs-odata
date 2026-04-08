/**
 * OData $search expression parser.
 *
 * Grammar (simplified OData v4 Part 2 Section 4.6):
 *   searchExpr     = searchTerm | searchBinary | searchUnary
 *   searchBinary   = searchExpr ('AND' | 'OR') searchExpr
 *   searchUnary    = 'NOT' searchTerm
 *   searchTerm     = DQUOTE searchPhrase DQUOTE | searchWord
 *   searchPhrase   = <any sequence of chars except DQUOTE>
 *   searchWord     = <sequence of non-whitespace chars, not AND/OR/NOT>
 *
 * Operator precedence (lowest to highest):
 *   1 — OR
 *   2 — AND (explicit and implicit)
 *   3 — NOT (prefix)
 *
 * Security: MAX_SEARCH_DEPTH prevents deeply nested AND/OR trees from
 * causing stack overflow (threat T-11-02).
 */

import type { SearchNode, SearchTermNode, SearchBinaryNode } from './ast.js'
import { ODataParseError } from './errors.js'

/** Maximum number of binary operations allowed in a search expression (DoS protection). */
const MAX_SEARCH_DEPTH = 20

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type SearchToken =
  | { type: 'TERM'; value: string; negated: boolean }
  | { type: 'AND' }
  | { type: 'OR' }

/**
 * Tokenizes a $search query string into a flat list of tokens.
 * Handles double-quoted phrases and keyword recognition.
 */
function tokenizeSearch(input: string): SearchToken[] {
  const tokens: SearchToken[] = []
  let i = 0
  const trimmed = input.trim()

  while (i < trimmed.length) {
    // Skip whitespace
    while (i < trimmed.length && trimmed[i] === ' ') i++
    if (i >= trimmed.length) break

    // Double-quoted phrase
    if (trimmed[i] === '"') {
      i++ // skip opening quote
      let phrase = ''
      while (i < trimmed.length && trimmed[i] !== '"') {
        phrase += trimmed[i++]
      }
      if (i < trimmed.length) i++ // skip closing quote
      tokens.push({ type: 'TERM', value: phrase, negated: false })
      continue
    }

    // Read a word (until whitespace)
    let word = ''
    while (i < trimmed.length && trimmed[i] !== ' ') {
      word += trimmed[i++]
    }

    if (word === 'AND') {
      tokens.push({ type: 'AND' })
    } else if (word === 'OR') {
      tokens.push({ type: 'OR' })
    } else if (word === 'NOT') {
      // Peek ahead: skip whitespace, then read the next term
      while (i < trimmed.length && trimmed[i] === ' ') i++
      if (i >= trimmed.length) {
        throw new ODataParseError('NOT operator must be followed by a search term', i)
      }

      if (trimmed[i] === '"') {
        // Quoted phrase after NOT
        i++ // skip opening quote
        let phrase = ''
        while (i < trimmed.length && trimmed[i] !== '"') {
          phrase += trimmed[i++]
        }
        if (i < trimmed.length) i++ // skip closing quote
        tokens.push({ type: 'TERM', value: phrase, negated: true })
      } else {
        // Bare word after NOT
        let nextWord = ''
        while (i < trimmed.length && trimmed[i] !== ' ') {
          nextWord += trimmed[i++]
        }
        tokens.push({ type: 'TERM', value: nextWord, negated: true })
      }
    } else {
      tokens.push({ type: 'TERM', value: word, negated: false })
    }
  }

  return tokens
}

// ---------------------------------------------------------------------------
// Parser — converts token list to SearchNode AST
// ---------------------------------------------------------------------------

/**
 * Build a SearchNode from a flat token list using a recursive-descent approach.
 * OR has lower precedence than AND (AND binds tighter).
 */
function buildSearchNode(tokens: SearchToken[], depth: number): SearchNode {
  if (depth > MAX_SEARCH_DEPTH) {
    throw new ODataParseError(
      `$search expression exceeds maximum depth of ${MAX_SEARCH_DEPTH} — expression too complex`,
      0,
    )
  }

  if (tokens.length === 0) {
    throw new ODataParseError('Empty $search expression — at least one search term is required', 0)
  }

  // Split on top-level OR (lowest precedence)
  const orIdx = findTopLevelOperator(tokens, 'OR')
  if (orIdx !== -1) {
    const left = buildSearchNode(tokens.slice(0, orIdx), depth + 1)
    const right = buildSearchNode(tokens.slice(orIdx + 1), depth + 1)
    const node: SearchBinaryNode = { kind: 'SearchBinary', operator: 'OR', left, right }
    return node
  }

  // Split on top-level AND (explicit)
  const andIdx = findTopLevelOperator(tokens, 'AND')
  if (andIdx !== -1) {
    const left = buildSearchNode(tokens.slice(0, andIdx), depth + 1)
    const right = buildSearchNode(tokens.slice(andIdx + 1), depth + 1)
    const node: SearchBinaryNode = { kind: 'SearchBinary', operator: 'AND', left, right }
    return node
  }

  // No explicit AND/OR — multiple TERM tokens means implicit AND (left-associative)
  const termTokens = tokens.filter((t) => t.type === 'TERM')
  if (termTokens.length > 1) {
    // Build left-associative tree: ((a AND b) AND c)
    let left: SearchNode = termToNode(
      termTokens[0] as { type: 'TERM'; value: string; negated: boolean },
    )
    for (let i = 1; i < termTokens.length; i++) {
      const right = termToNode(termTokens[i] as { type: 'TERM'; value: string; negated: boolean })
      if (depth + i > MAX_SEARCH_DEPTH) {
        throw new ODataParseError(
          `$search expression exceeds maximum depth of ${MAX_SEARCH_DEPTH}`,
          0,
        )
      }
      const node: SearchBinaryNode = { kind: 'SearchBinary', operator: 'AND', left, right }
      left = node
    }
    return left
  }

  // Single TERM
  if (tokens.length === 1 && tokens[0].type === 'TERM') {
    return termToNode(tokens[0] as { type: 'TERM'; value: string; negated: boolean })
  }

  throw new ODataParseError(`Unexpected token sequence in $search expression`, 0)
}

function termToNode(token: { type: 'TERM'; value: string; negated: boolean }): SearchTermNode {
  const node: SearchTermNode = token.negated
    ? { kind: 'SearchTerm', value: token.value, negated: true }
    : { kind: 'SearchTerm', value: token.value }
  return node
}

/**
 * Find the index of the last top-level occurrence of the given operator type.
 * Returns -1 if not found.
 * "Top-level" means outside of any grouping (search doesn't use parens, so all are top-level).
 */
function findTopLevelOperator(tokens: SearchToken[], opType: 'AND' | 'OR'): number {
  // Find the rightmost occurrence (for left-associativity, we want the last one at top level)
  // Actually for left-associativity we want the last operator at this level so the right operand
  // is a single term while the left operand gets recursively built.
  // But to handle precedence correctly: OR has lower precedence, so we split on OR first.
  // Within the OR split, we want to keep left-associativity.
  // So: find the LAST occurrence of the operator (rightmost split gives left-associative tree).
  let lastIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === opType) {
      lastIdx = i
    }
  }
  return lastIdx
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an OData $search query string into a SearchNode AST.
 *
 * @param input - The raw $search query string value (without the $search= prefix)
 * @throws ODataParseError if the input is empty, malformed, or exceeds MAX_SEARCH_DEPTH
 */
export function parseSearch(input: string): SearchNode {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new ODataParseError('Empty $search expression — at least one search term is required', 0)
  }

  const tokens = tokenizeSearch(trimmed)

  if (tokens.length === 0) {
    throw new ODataParseError('Empty $search expression — at least one search term is required', 0)
  }

  // Count total binary operators to detect DoS early (each AND/OR creates one tree level)
  const operatorCount = tokens.filter((t) => t.type === 'AND' || t.type === 'OR').length
  // Implicit AND operators = TERM count - 1 when there are no explicit operators
  const termCount = tokens.filter((t) => t.type === 'TERM').length
  const explicitOps = operatorCount
  const implicitAnds = explicitOps === 0 && termCount > 1 ? termCount - 1 : 0
  const totalOps = explicitOps + implicitAnds

  if (totalOps >= MAX_SEARCH_DEPTH) {
    throw new ODataParseError(
      `$search expression exceeds maximum depth of ${MAX_SEARCH_DEPTH} — expression too complex`,
      0,
    )
  }

  return buildSearchNode(tokens, 0)
}
