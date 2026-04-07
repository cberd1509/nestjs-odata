import type { EdmEntityConfig } from '../edm/edm-entity-set.js'

/** A generic constructor type representing an entity class */
export type EntityClass = new (...args: unknown[]) => unknown

/**
 * IEdmDeriver — adapter seam interface for ORM-specific EDM derivation.
 * Implementations live in adapter packages (e.g., @nestjs-odata/typeorm).
 * Core has zero ORM dependencies — adapters inject their implementation
 * via the EDM_DERIVER token.
 */
export interface IEdmDeriver {
  deriveEntityTypes(entityClasses: EntityClass[]): EdmEntityConfig[]
}

/** NestJS injection token for IEdmDeriver */
export const EDM_DERIVER = Symbol('EDM_DERIVER')
