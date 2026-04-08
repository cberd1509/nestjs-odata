/**
 * OData parser error types.
 * ODataParseError carries position information for diagnostic messages.
 */

/**
 * Thrown when the lexer or parser encounters malformed OData query syntax.
 *
 * The `position` field indicates the character offset in the input string
 * where the error was detected. The `token` field (if available) holds
 * the token that triggered the error.
 *
 * Note: position info is intentionally included — the input is the user's own
 * query string, not server-internal data, so there is no information disclosure risk.
 */
export class ODataParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly token: unknown = null,
    public readonly queryContext?: string,
  ) {
    super(message)
    this.name = 'ODataParseError'
    // Ensure instanceof works correctly when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Create an ODataParseError with a context snippet extracted from the query string.
   * Extracts ~20 characters before and after the error position for diagnostic context.
   *
   * Per threat model T-12-05: context snippet shows only the user's own query input
   * (already known to them) — never includes stack traces or internal paths.
   *
   * @param message - Base error message
   * @param position - Character offset where the error was detected
   * @param queryString - The full query string for context extraction
   * @param token - Optional token that triggered the error
   */
  static withContext(
    message: string,
    position: number,
    queryString: string,
    token: unknown = null,
  ): ODataParseError {
    const contextRadius = 20
    const start = Math.max(0, position - contextRadius)
    const end = Math.min(queryString.length, position + contextRadius)

    const prefix = start > 0 ? '...' : ''
    const suffix = end < queryString.length ? '...' : ''
    const snippet = `${prefix}${queryString.slice(start, end)}${suffix}`

    const enrichedMessage = `${message} at position ${position}: ${snippet}`
    return new ODataParseError(enrichedMessage, position, token, snippet)
  }
}
