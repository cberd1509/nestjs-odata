import 'reflect-metadata'
import { ODATA_SEARCHABLE_KEY } from './metadata-keys.js'

/**
 * Marks a property as searchable via OData $search.
 * Multiple properties on the same entity can be decorated — all are stored.
 *
 * Usage:
 *   class Product {
 *     @ODataSearchable()
 *     name: string
 *
 *     @ODataSearchable()
 *     description: string
 *   }
 */
export function ODataSearchable(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const ctor = (target as { constructor: new (...args: unknown[]) => unknown }).constructor
    const existing: string[] =
      (Reflect.getMetadata(ODATA_SEARCHABLE_KEY, ctor) as string[] | undefined) ?? []
    Reflect.defineMetadata(ODATA_SEARCHABLE_KEY, [...existing, String(propertyKey)], ctor)
  }
}

/**
 * Get the list of searchable property names for a given entity class.
 * Returns an empty array if no properties are decorated with @ODataSearchable().
 */
export function getSearchableProperties(target: new (...args: unknown[]) => unknown): string[] {
  return (Reflect.getMetadata(ODATA_SEARCHABLE_KEY, target) as string[] | undefined) ?? []
}
