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
  ) {
    super(message)
    this.name = 'ODataParseError'
    // Ensure instanceof works correctly when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
