import 'reflect-metadata'
import { ODATA_EXCLUDE_KEY } from './metadata-keys.js'

/**
 * @ODataExclude() — marks a property to be excluded from the OData EDM.
 * The property will not appear in $metadata and will be stripped from responses.
 *
 * Zero imports from typeorm, @nestjs/common, or any ORM. Pure reflect-metadata.
 */
export function ODataExclude(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const constructor = (target as { constructor: object }).constructor
    const existing: Set<string | symbol> =
      (Reflect.getMetadata(ODATA_EXCLUDE_KEY, constructor) as Set<string | symbol>) ?? new Set()
    const updated = new Set(existing)
    updated.add(propertyKey)
    Reflect.defineMetadata(ODATA_EXCLUDE_KEY, updated, constructor)
  }
}

/** Read all property names excluded via @ODataExclude() on a class */
export function getExcludedProperties(target: object): Set<string> {
  const meta = Reflect.getMetadata(ODATA_EXCLUDE_KEY, target) as Set<string | symbol> | undefined
  if (!meta) return new Set<string>()
  const result = new Set<string>()
  for (const key of meta) {
    if (typeof key === 'string') result.add(key)
  }
  return result
}
