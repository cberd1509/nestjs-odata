import 'reflect-metadata'
import { EDM_TYPE_KEY } from './metadata-keys.js'

/** Options for the @EdmType property decorator */
export interface EdmTypeOptions {
  readonly type: string
  readonly precision?: number
  readonly scale?: number
  readonly maxLength?: number
}

/**
 * @EdmType() — override the EDM primitive type for a property.
 * Use when the TypeScript type cannot be automatically mapped, or when
 * precision/scale/maxLength constraints are needed (e.g., Edm.Decimal).
 *
 * Zero imports from typeorm, @nestjs/common, or any ORM. Pure reflect-metadata.
 */
export function EdmType(options: EdmTypeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const constructor = (target as { constructor: object }).constructor
    const existing: Record<string | symbol, EdmTypeOptions> =
      (Reflect.getMetadata(EDM_TYPE_KEY, constructor) as Record<string | symbol, EdmTypeOptions>) ??
      {}
    Reflect.defineMetadata(EDM_TYPE_KEY, { ...existing, [propertyKey]: options }, constructor)
  }
}

/** Read all @EdmType overrides registered on a class */
export function getEdmTypeOverrides(target: object): Record<string, EdmTypeOptions> {
  return (Reflect.getMetadata(EDM_TYPE_KEY, target) as Record<string, EdmTypeOptions>) ?? {}
}
