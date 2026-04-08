import 'reflect-metadata'
import { ODATA_ETAG_KEY } from './metadata-keys.js'

/**
 * Marks a property as the ETag source for concurrency control.
 * Per D-03: opt-in per entity. Only entities with @ODataETag or @UpdateDateColumn get ETags.
 *
 * Usage:
 *   class Product {
 *     @ODataETag()
 *     version: number
 *   }
 */
export function ODataETag(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    Reflect.defineMetadata(
      ODATA_ETAG_KEY,
      String(propertyKey),
      (target as { constructor: new (...args: unknown[]) => unknown }).constructor,
    )
  }
}

/**
 * Get the ETag property name for a given entity class.
 * Returns undefined if the entity does not have @ODataETag.
 */
export function getETagProperty(target: new (...args: unknown[]) => unknown): string | undefined {
  return Reflect.getMetadata(ODATA_ETAG_KEY, target) as string | undefined
}
