import 'reflect-metadata'
import { ODATA_ENTITY_SET_KEY } from './metadata-keys.js'

/**
 * @ODataEntitySet(name) — override the entity set name for an entity class.
 * Without this decorator, the adapter will auto-pluralize the class name.
 *
 * Zero imports from typeorm, @nestjs/common, or any ORM. Pure reflect-metadata.
 */
export function ODataEntitySet(name: string): ClassDecorator {
  return (target: object): void => {
    Reflect.defineMetadata(ODATA_ENTITY_SET_KEY, name, target)
  }
}

/** Read the entity set name set via @ODataEntitySet(), or undefined if not set */
export function getEntitySetName(target: object): string | undefined {
  return Reflect.getMetadata(ODATA_ENTITY_SET_KEY, target) as string | undefined
}
