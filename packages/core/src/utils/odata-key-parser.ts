/**
 * Parse an OData parenthetical key string into a Record of key-value pairs.
 *
 * Formats per D-02:
 *   Simple:    '42'                  -> { Id: 42 }
 *   String:    "'hello'"             -> { Name: 'hello' }
 *   Composite: 'OrderId=1,ItemId=3'  -> { OrderId: 1, ItemId: 3 }
 *
 * Per T-04-02: Key values are returned as typed JS values (number, string, boolean)
 * — never interpolated into SQL. Safe for parameterized ORM queries.
 */

/**
 * Coerce an OData key value string to the appropriate JS type.
 * - Strips surrounding single quotes (OData string literal)
 * - Parses 'true'/'false' as boolean
 * - Parses numeric strings as numbers
 * - Otherwise returns as string
 */
function coerceKeyValue(val: string): unknown {
  const trimmed = val.trim()

  // OData string literal: surrounded by single quotes
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }

  // Boolean literals
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // Numeric: integer or decimal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  // Default: return as string (e.g., unquoted identifiers, GUIDs)
  return trimmed
}

/**
 * Parse an OData parenthetical key string into a Record of key-value pairs.
 *
 * @param keyStr - The key string extracted from parentheses (e.g., '42', "'hello'", 'OrderId=1,ItemId=3')
 * @param keyProperties - Ordered list of key property names (used for simple keys)
 * @returns Record mapping property names to coerced values
 * @throws Error if keyStr is empty
 */
export function parseODataKey(
  keyStr: string,
  keyProperties: readonly string[],
): Record<string, unknown> {
  if (!keyStr) {
    throw new Error('OData key cannot be empty')
  }

  // Composite key: contains '=' (name=value pairs)
  if (keyStr.includes('=')) {
    const pairs = keyStr.split(',')
    const result: Record<string, unknown> = {}
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=')
      const name = pair.slice(0, eqIdx).trim()
      const value = pair.slice(eqIdx + 1).trim()
      result[name] = coerceKeyValue(value)
    }
    return result
  }

  // Simple key: single value, use first key property name
  const keyName = keyProperties[0]
  return { [keyName]: coerceKeyValue(keyStr) }
}
