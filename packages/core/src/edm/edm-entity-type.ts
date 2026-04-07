import type { EdmProperty, EdmNavigationProperty } from './edm-types.js'

/**
 * Represents an OData v4 EntityType in the Entity Data Model.
 * Immutable — always create new instances rather than mutating existing ones.
 */
export interface EdmEntityType {
  readonly name: string
  readonly namespace: string
  readonly properties: readonly EdmProperty[]
  readonly navigationProperties: readonly EdmNavigationProperty[]
  readonly keyProperties: readonly string[]
  readonly isReadOnly: boolean
}
