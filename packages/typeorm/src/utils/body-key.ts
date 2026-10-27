/**
 * True when a write body carries a key property whose value differs from the URL key. The URL
 * key identifies the row (and is what the row-level scope checked), so such a body must be
 * refused rather than allowed to redirect the write to another row.
 */
export function bodyKeyMismatch(
  keyProperties: readonly string[],
  body: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return keyProperties.some((kp) => body[kp] !== undefined && body[kp] !== where[kp])
}

/**
 * The body without its key properties. OData-Protocol 4.01 §11.4.3: a PATCH body may carry key
 * (and other read-only) properties, and the service MUST ignore their values. The URL key
 * identifies the row, so a body key can never redirect the update to another row.
 */
export function withoutKeyProperties(
  keyProperties: readonly string[],
  body: Record<string, unknown>,
): Record<string, unknown> {
  const rest = { ...body }
  for (const kp of keyProperties) delete rest[kp]
  return rest
}
