/**
 * OData validation error types.
 * ODataValidationError is distinct from ODataParseError — it represents
 * semantic validation failures (unknown properties, type mismatches) rather
 * than syntax errors.
 *
 * Per threat model T-03-02: includes property name and entity type name
 * (user's own query input) but never stack traces or internal paths.
 */

/**
 * Thrown when field name validation fails against the EdmRegistry.
 *
 * The `entityTypeName` and `propertyName` fields provide diagnostic context
 * for the user's own query (not internal server data).
 */
export class ODataValidationError extends Error {
  constructor(
    message: string,
    public readonly entityTypeName: string,
    public readonly propertyName: string,
  ) {
    super(message)
    this.name = 'ODataValidationError'
    // Ensure instanceof works correctly when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
