/**
 * OData v4 EDM (Entity Data Model) primitive type system.
 * All 15 OData v4 primitive types per the OASIS OData v4 specification.
 * Note: Edm.DateTime is NOT included — use Edm.DateTimeOffset per OData v4.
 */

/** All 15 OData v4 EDM primitive types */
export type EdmPrimitiveType =
  | 'Edm.Binary'
  | 'Edm.Boolean'
  | 'Edm.Byte'
  | 'Edm.Date'
  | 'Edm.DateTimeOffset'
  | 'Edm.Decimal'
  | 'Edm.Double'
  | 'Edm.Guid'
  | 'Edm.Int16'
  | 'Edm.Int32'
  | 'Edm.Int64'
  | 'Edm.SByte'
  | 'Edm.Single'
  | 'Edm.String'
  | 'Edm.TimeOfDay'

/** A structural property of an EDM entity type */
export interface EdmProperty {
  readonly name: string
  readonly type: EdmPrimitiveType
  readonly nullable: boolean
  readonly precision?: number
  readonly scale?: number
  readonly maxLength?: number
}

/** A navigation property linking two EDM entity types */
export interface EdmNavigationProperty {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly isCollection: boolean
  readonly partner?: string
}

/** Strategy when a TypeScript type cannot be mapped to an EDM primitive type */
export type UnmappedTypeStrategy = 'skip' | 'string-fallback' | 'error'
