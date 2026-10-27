/**
 * The OData key segment of an entity: `5` for a single key, `orderId=1,itemId=2` for a
 * composite one. Missing values render as `undefined`, never throw.
 */
export function formatEntityKey(keyProperties: readonly string[], entity: unknown): string {
  const record = (entity ?? {}) as Record<string, unknown>
  return keyProperties
    .map((kp) => (keyProperties.length === 1 ? String(record[kp]) : `${kp}=${String(record[kp])}`))
    .join(',')
}

/** `{serviceRoot}/{EntitySet}({key})`, the canonical URL of an entity (Location header). */
export function entityLocation(
  serviceRoot: string,
  entitySetName: string,
  keyProperties: readonly string[],
  entity: unknown,
): string {
  return `${serviceRoot}/${entitySetName}(${formatEntityKey(keyProperties, entity)})`
}
