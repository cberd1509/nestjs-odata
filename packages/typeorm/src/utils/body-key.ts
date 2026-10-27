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
