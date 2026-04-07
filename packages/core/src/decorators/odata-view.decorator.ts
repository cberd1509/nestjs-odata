import 'reflect-metadata'
import { ODATA_VIEW_KEY } from './metadata-keys.js'

/** Options for the @ODataView class decorator */
export interface ODataViewOptions {
  readonly sourceEntity: string
  readonly exposedProperties: string[]
  readonly entitySetName?: string
}

/**
 * @ODataView() — marks a class as a virtual OData view.
 * A virtual view projects a subset of an existing entity type's properties
 * as its own EntitySet without duplicating entity registration. Per D-22, D-23.
 *
 * Zero imports from typeorm, @nestjs/common, or any ORM. Pure reflect-metadata.
 */
export function ODataView(options: ODataViewOptions): ClassDecorator {
  return (target: object): void => {
    Reflect.defineMetadata(ODATA_VIEW_KEY, options, target)
  }
}

/** Read the ODataView options from a class, or undefined if not decorated */
export function getODataViewOptions(target: object): ODataViewOptions | undefined {
  return Reflect.getMetadata(ODATA_VIEW_KEY, target) as ODataViewOptions | undefined
}
