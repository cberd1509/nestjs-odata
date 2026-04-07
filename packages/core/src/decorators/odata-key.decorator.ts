import 'reflect-metadata'
import { ODATA_KEY_KEY } from './metadata-keys.js'

/**
 * @ODataKey() — marks a property as part of the entity key.
 * Can be applied to multiple properties for composite keys.
 *
 * Zero imports from typeorm, @nestjs/common, or any ORM. Pure reflect-metadata.
 */
export function ODataKey(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const constructor = (target as { constructor: object }).constructor
    const existing: string[] = (Reflect.getMetadata(ODATA_KEY_KEY, constructor) as string[]) ?? []
    if (typeof propertyKey === 'string') {
      Reflect.defineMetadata(ODATA_KEY_KEY, [...existing, propertyKey], constructor)
    }
  }
}

/** Read all key property names registered via @ODataKey() on a class */
export function getKeyProperties(target: object): string[] {
  return (Reflect.getMetadata(ODATA_KEY_KEY, target) as string[]) ?? []
}
