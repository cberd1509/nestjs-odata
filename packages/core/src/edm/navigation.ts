/**
 * The bare entity type name a navigation property points to: strips `Collection(...)` and the
 * namespace, so `Collection(Default.OrderItem)` and `Default.OrderItem` both give `OrderItem`
 * (the key `EdmRegistry.getEntityType()` expects).
 */
export function navigationTargetTypeName(navType: string): string {
  const inner =
    navType.startsWith('Collection(') && navType.endsWith(')')
      ? navType.slice('Collection('.length, -1)
      : navType
  return inner.split('.').pop() ?? inner
}
