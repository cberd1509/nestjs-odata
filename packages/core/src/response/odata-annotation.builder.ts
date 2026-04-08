import type { EdmEntityType } from '../edm/edm-entity-type.js'

/**
 * Context needed to annotate an entity with OData metadata annotations.
 */
export interface AnnotationContext {
  /** The OData service root path (e.g. '/odata') */
  readonly serviceRoot: string
  /** The OData entity set name (e.g. 'Products') */
  readonly entitySetName: string
  /** The EDM entity type descriptor */
  readonly entityType: EdmEntityType
  /** The EDM namespace (e.g. 'Default') */
  readonly namespace: string
}

/**
 * Build the canonical key string for a given entity and its key properties.
 *
 * - Single key, integer value: (1)
 * - Single key, string value: ('abc')
 * - Composite key: (orderId=1,productId=2)
 *
 * @param entity - The entity object
 * @param keyProperties - The key property names from the EDM entity type
 */
function buildKeyString(
  entity: Record<string, unknown>,
  keyProperties: readonly string[],
): string {
  if (keyProperties.length === 1) {
    const keyName = keyProperties[0]
    const keyValue = entity[keyName]
    if (typeof keyValue === 'string') {
      return `('${keyValue}')`
    }
    return `(${String(keyValue)})`
  }

  // Composite key
  const parts = keyProperties.map((keyName) => {
    const keyValue = entity[keyName]
    if (typeof keyValue === 'string') {
      return `${keyName}='${keyValue}'`
    }
    return `${keyName}=${String(keyValue)}`
  })
  return `(${parts.join(',')})`
}

/**
 * Annotate a single entity object with OData v4 metadata annotations.
 *
 * Adds:
 * - @odata.id — canonical URL for the entity (RESP-04)
 * - @odata.type — qualified type name with namespace prefix (RESP-05)
 * - {navProp}@odata.navigationLink — for each navigation property (RESP-06)
 *
 * Returns the entity unchanged if it is null, undefined, or not an object.
 *
 * This function is pure — it never mutates the input entity.
 *
 * @param entity - The entity object to annotate
 * @param ctx - The annotation context (service root, entity set name, entity type, namespace)
 */
export function annotateEntity(
  entity: Record<string, unknown>,
  ctx: AnnotationContext,
): Record<string, unknown> {
  if (entity === null || entity === undefined || typeof entity !== 'object') {
    return entity
  }

  const { serviceRoot, entitySetName, entityType, namespace } = ctx

  // Normalize serviceRoot: strip trailing slash
  const root = serviceRoot.endsWith('/') ? serviceRoot.slice(0, -1) : serviceRoot

  const keyStr = buildKeyString(entity, entityType.keyProperties)
  const odataId = `${root}/${entitySetName}${keyStr}`
  const odataType = `#${namespace}.${entityType.name}`

  // Build navigation link entries
  const navLinks: Record<string, string> = {}
  for (const navProp of entityType.navigationProperties) {
    navLinks[`${navProp.name}@odata.navigationLink`] = `${odataId}/${navProp.name}`
  }

  // Return new object — immutable (never mutate input)
  return {
    ...entity,
    '@odata.id': odataId,
    '@odata.type': odataType,
    ...navLinks,
  }
}

/**
 * Annotate an array of entity objects with OData v4 metadata annotations.
 *
 * Applies `annotateEntity` to every item in the array and returns a new array.
 * Does not mutate the input array or any items.
 *
 * @param items - The array of entity objects to annotate
 * @param ctx - The annotation context
 */
export function annotateEntities(
  items: Record<string, unknown>[],
  ctx: AnnotationContext,
): Record<string, unknown>[] {
  return items.map((item) => annotateEntity(item, ctx))
}
