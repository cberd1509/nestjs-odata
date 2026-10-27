import type { EdmEntityType } from './edm-entity-type.js'
import type { EdmEntitySet } from './edm-entity-set.js'

/** The registry lookups {@link resolveNavigationTarget} needs (an `EdmRegistry`). */
export interface NavigationTargetRegistry {
  getEntityType(name: string): EdmEntityType | undefined
  getEntitySetByTypeName(typeName: string): EdmEntitySet | undefined
}

/** What a navigation property points to: its type name, and its entity type and set if any. */
export interface NavigationTarget {
  readonly typeName: string
  readonly entityType: EdmEntityType | undefined
  readonly entitySet: EdmEntitySet | undefined
}

/**
 * Resolve the target of a navigation property: by its EDM type (`navType`, e.g.
 * `Collection(Default.OrderItem)`), or by name on `source` (`undefined` when `source` has no
 * such navigation property).
 */
export function resolveNavigationTarget(
  registry: NavigationTargetRegistry,
  navType: string,
): NavigationTarget
export function resolveNavigationTarget(
  registry: NavigationTargetRegistry,
  source: EdmEntityType,
  name: string,
): NavigationTarget | undefined
export function resolveNavigationTarget(
  registry: NavigationTargetRegistry,
  typeOrSource: string | EdmEntityType,
  name?: string,
): NavigationTarget | undefined {
  let navType: string
  if (typeof typeOrSource === 'string') {
    navType = typeOrSource
  } else {
    const nav = typeOrSource.navigationProperties.find((n) => n.name === name)
    if (!nav) return undefined
    navType = nav.type
  }
  const typeName = navigationTargetTypeName(navType)
  return {
    typeName,
    entityType: registry.getEntityType(typeName),
    entitySet: registry.getEntitySetByTypeName(typeName),
  }
}

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
