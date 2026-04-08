/**
 * OData $apply transformation pipeline parser.
 *
 * Supports the following transformation steps (OData v4 Aggregation Extension):
 *   - aggregate(...) — aggregate expressions over the current set
 *   - groupby((...), aggregate(...)) — partition and aggregate
 *   - filter(...) — filter the current set (only BEFORE aggregate/groupby steps)
 *
 * Security:
 *   - Aggregate aliases are validated against /^[A-Za-z_][A-Za-z0-9_]*$/ to prevent
 *     SQL injection when aliases are interpolated into query strings (T-11-01).
 *   - Post-groupby filter steps are rejected since HAVING translation is not supported (A5).
 */

import type {
  ApplyNode,
  ApplyStep,
  ApplyFilterStep,
  ApplyGroupByStep,
  ApplyAggregateStep,
  AggregateExpression,
} from './ast.js'
import { ODataParseError } from './errors.js'
import { parseFilter } from './parser.js'

/** Regex for valid SQL-safe identifiers (prevents SQL injection via aliases). */
const ALIAS_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

// ---------------------------------------------------------------------------
// Pipeline splitter
// ---------------------------------------------------------------------------

/**
 * Split a $apply string on '/' characters that are at parenthesis depth 0.
 * This correctly handles filter(a/b gt 0) without splitting inside the parens.
 */
export function splitApplyPipeline(value: string): string[] {
  const steps: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === '/' && depth === 0) {
      steps.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) {
    steps.push(current.trim())
  }

  return steps
}

// ---------------------------------------------------------------------------
// Aggregate expression parser
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated list of aggregate expressions.
 * Handles both:
 *   - `property with method as alias`
 *   - `$count as alias` (shorthand for count of records)
 */
function parseAggregateExpressions(inner: string): AggregateExpression[] {
  const parts = splitTopLevelCommas(inner)
  return parts.map((part) => parseOneAggregateExpression(part.trim()))
}

function parseOneAggregateExpression(expr: string): AggregateExpression {
  // Handle $count as alias
  const countMatch = /^\$count\s+as\s+(\S+)$/.exec(expr)
  if (countMatch) {
    const alias = countMatch[1]
    validateAlias(alias)
    return { property: '$count', method: 'count', alias }
  }

  // Handle property with method as alias
  const withMatch = /^(\S+)\s+with\s+(\w+)\s+as\s+(\S+)$/.exec(expr)
  if (withMatch) {
    const [, property, methodRaw, alias] = withMatch
    const method = methodRaw.toLowerCase()
    if (!isValidMethod(method)) {
      throw new ODataParseError(
        `Unknown aggregate method '${method}'. Valid methods: sum, count, avg, min, max, countdistinct`,
        0,
      )
    }
    validateAlias(alias)
    return { property, method, alias }
  }

  throw new ODataParseError(
    `Invalid aggregate expression '${expr}'. Expected 'property with method as alias' or '$count as alias'`,
    0,
  )
}

function isValidMethod(method: string): method is AggregateExpression['method'] {
  return ['sum', 'count', 'avg', 'min', 'max', 'countdistinct'].includes(method)
}

function validateAlias(alias: string): void {
  if (!ALIAS_REGEX.test(alias)) {
    throw new ODataParseError(
      `Invalid aggregate alias '${alias}'. Aliases must match /^[A-Za-z_][A-Za-z0-9_]*$/ to prevent SQL injection`,
      0,
    )
  }
}

// ---------------------------------------------------------------------------
// Step parsers
// ---------------------------------------------------------------------------

function parseFilterStep(inner: string): ApplyFilterStep {
  const filter = parseFilter(inner)
  return { kind: 'ApplyFilter', filter }
}

function parseAggregateStep(inner: string): ApplyAggregateStep {
  const expressions = parseAggregateExpressions(inner)
  return { kind: 'ApplyAggregate', expressions }
}

function parseGroupByStep(inner: string): ApplyGroupByStep {
  // groupby((prop1,prop2,...),aggregate(...))
  // or groupby((prop1,prop2,...))
  //
  // Extract first parenthesized group (properties), then optionally the aggregate part.
  if (!inner.startsWith('(')) {
    throw new ODataParseError(
      `Invalid groupby() syntax: expected '(' to start property list, got '${inner[0]}'`,
      0,
    )
  }

  // Find the matching closing paren for the property list
  let depth = 0
  let propEnd = -1
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++
    else if (inner[i] === ')') {
      depth--
      if (depth === 0) {
        propEnd = i
        break
      }
    }
  }

  if (propEnd === -1) {
    throw new ODataParseError('Unclosed parenthesis in groupby() property list', 0)
  }

  const propList = inner.slice(1, propEnd) // contents inside the first (...)
  const properties = propList
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  // Check for optional aggregate part
  const rest = inner.slice(propEnd + 1).trim()
  let aggregate: readonly AggregateExpression[] | undefined

  if (rest.startsWith(',aggregate(')) {
    const aggInner = rest.slice(',aggregate('.length, rest.length - 1)
    aggregate = parseAggregateExpressions(aggInner)
  } else if (rest.startsWith(',')) {
    throw new ODataParseError(`Unexpected content after groupby() property list: '${rest}'`, 0)
  }

  return { kind: 'ApplyGroupBy', properties, aggregate }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a string on ',' characters at parenthesis depth 0.
 * Reusable utility — same algorithm as pipeline splitter but for commas.
 */
function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return parts
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an OData $apply transformation pipeline into an ApplyNode AST.
 *
 * Steps are separated by '/' at depth 0. Each step is one of:
 *   - filter(...)
 *   - aggregate(...)
 *   - groupby((...),aggregate(...))
 *
 * @param input - The raw $apply query string value (without the $apply= prefix)
 * @throws ODataParseError for empty input, unrecognized steps, invalid aliases,
 *         or post-groupby filter steps (HAVING not supported)
 */
export function parseApply(input: string): ApplyNode {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new ODataParseError(
      'Empty $apply expression — at least one transformation step is required',
      0,
    )
  }

  const stepStrings = splitApplyPipeline(trimmed)
  const steps: ApplyStep[] = []
  let seenAggregation = false // track if we've seen aggregate() or groupby()

  for (const stepStr of stepStrings) {
    // Determine step type by prefix
    if (stepStr.startsWith('filter(') && stepStr.endsWith(')')) {
      if (seenAggregation) {
        throw new ODataParseError(
          'Post-groupby filter (HAVING) is not supported in this version. Place filter() steps before groupby()',
          0,
        )
      }
      const inner = stepStr.slice('filter('.length, stepStr.length - 1)
      steps.push(parseFilterStep(inner))
    } else if (stepStr.startsWith('aggregate(') && stepStr.endsWith(')')) {
      seenAggregation = true
      const inner = stepStr.slice('aggregate('.length, stepStr.length - 1)
      steps.push(parseAggregateStep(inner))
    } else if (stepStr.startsWith('groupby(') && stepStr.endsWith(')')) {
      seenAggregation = true
      const inner = stepStr.slice('groupby('.length, stepStr.length - 1)
      steps.push(parseGroupByStep(inner))
    } else {
      // Extract the step name for error message
      const nameMatch = /^(\w+)\(/.exec(stepStr)
      const stepName = nameMatch ? nameMatch[1] : stepStr
      throw new ODataParseError(
        `Unrecognized $apply transformation step '${stepName}'. Supported steps: filter, aggregate, groupby`,
        0,
      )
    }
  }

  return { steps }
}
