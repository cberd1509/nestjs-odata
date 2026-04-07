import type { EdmProperty, EdmNavigationProperty } from './edm-types.js'

/**
 * Represents an OData v4 EntitySet in the Entity Data Model.
 * An EntitySet is a named collection of entities of a given type.
 */
export interface EdmEntitySet {
  readonly name: string
  readonly entityTypeName: string
  readonly namespace: string
  readonly isReadOnly: boolean
}

/**
 * Full entity configuration combining type and set metadata.
 * Used by IEdmDeriver to pass complete entity information to the registry.
 */
export interface EdmEntityConfig {
  readonly entityTypeName: string
  readonly entitySetName: string
  readonly properties: readonly EdmProperty[]
  readonly navigationProperties: readonly EdmNavigationProperty[]
  readonly keyProperties: readonly string[]
  readonly isReadOnly: boolean
}

/**
 * Virtual view — a projection of an existing entity type exposing only
 * a subset of properties as its own EntitySet. Per design decisions D-22, D-23.
 */
export interface EdmVirtualView {
  readonly name: string
  readonly sourceEntityTypeName: string
  readonly exposedProperties: readonly string[]
  readonly entitySetName: string
}
