import type { EntityMetadata } from 'typeorm'
import type {
  EdmEntityConfig,
  EdmNavigationProperty,
  EdmPrimitiveType,
  EdmProperty,
  UnmappedTypeStrategy,
} from '@nestjs-odata/core'
import {
  getEdmTypeOverrides,
  getEntitySetName,
  getExcludedProperties,
  pluralizeEntityName,
} from '@nestjs-odata/core'
import type { IEdmDeriver, EntityClass } from '@nestjs-odata/core'
import { mapColumnTypeToEdm } from './typeorm-type-mapper.js'

/**
 * TypeOrmEdmDeriver — derives OData v4 EdmEntityConfig[] from TypeORM EntityMetadata.
 *
 * Respects OData decorators: @EdmType, @ODataExclude, @ODataEntitySet.
 * Detects ViewEntity and marks them read-only.
 * Navigation property types are always namespace-qualified (e.g., 'Default.Category').
 *
 * CRITICAL: Never produces Edm.DateTime — all datetime-like types produce Edm.DateTimeOffset.
 *
 * Usage (runtime):
 *   const deriver = new TypeOrmEdmDeriver('Default', 'skip')
 *   // When called by the module, metadatas come from the registered DataSource
 *
 * Usage (testing):
 *   deriver.deriveEntityTypes([Product], dataSource.entityMetadatas)
 */
export class TypeOrmEdmDeriver implements IEdmDeriver {
  constructor(
    private readonly namespace: string,
    private readonly unmappedTypeStrategy: UnmappedTypeStrategy,
  ) {}

  /**
   * Implement IEdmDeriver — called by the core module.
   * When entity metadatas are not provided, returns empty (requires integration with DataSource).
   */
  deriveEntityTypes(entityClasses: EntityClass[]): EdmEntityConfig[]
  /**
   * Overload for direct use with TypeORM EntityMetadata (used in tests and adapter integration).
   */
  deriveEntityTypes(
    entityClasses: EntityClass[],
    entityMetadatas: EntityMetadata[],
  ): EdmEntityConfig[]
  deriveEntityTypes(
    entityClasses: EntityClass[],
    entityMetadatas: EntityMetadata[] = [],
  ): EdmEntityConfig[] {
    return entityClasses
      .map((entityClass) => this.deriveEntity(entityClass, entityMetadatas))
      .filter((config): config is EdmEntityConfig => config !== null)
  }

  private deriveEntity(
    entityClass: EntityClass,
    entityMetadatas: EntityMetadata[],
  ): EdmEntityConfig | null {
    const meta = entityMetadatas.find((m) => m.target === entityClass)
    if (!meta) return null

    const excludedProps = getExcludedProperties(entityClass)
    const edmTypeOverrides = getEdmTypeOverrides(entityClass)
    const customSetName = getEntitySetName(entityClass)

    const properties = this.deriveProperties(meta, excludedProps, edmTypeOverrides)
    const navigationProperties = this.deriveNavigationProperties(meta)
    const keyProperties = meta.primaryColumns.map((c) => c.propertyName)
    const entitySetName = customSetName ?? pluralizeEntityName(meta.name)
    const isReadOnly = meta.tableType === 'view'

    return {
      entityTypeName: meta.name,
      entitySetName,
      properties,
      navigationProperties,
      keyProperties,
      isReadOnly,
    }
  }

  private deriveProperties(
    meta: EntityMetadata,
    excludedProps: Set<string>,
    edmTypeOverrides: Record<
      string,
      { type: string; precision?: number; scale?: number; maxLength?: number }
    >,
  ): readonly EdmProperty[] {
    return meta.columns
      .filter((col) => !excludedProps.has(col.propertyName))
      .reduce<EdmProperty[]>((acc, col) => {
        const override = edmTypeOverrides[col.propertyName]

        if (override) {
          acc.push({
            name: col.propertyName,
            type: override.type as EdmPrimitiveType,
            nullable: col.isNullable,
            ...(override.precision !== undefined ? { precision: override.precision } : {}),
            ...(override.scale !== undefined ? { scale: override.scale } : {}),
            ...(override.maxLength !== undefined ? { maxLength: override.maxLength } : {}),
          })
          return acc
        }

        const columnType =
          typeof col.type === 'string' ? col.type : ((col.type as { name?: string }).name ?? '')

        const edmType = mapColumnTypeToEdm(columnType, undefined, this.unmappedTypeStrategy)
        if (edmType === undefined) {
          // strategy is 'skip' — omit this property
          return acc
        }

        acc.push({
          name: col.propertyName,
          type: edmType,
          nullable: col.isNullable,
          ...(col.precision !== undefined && col.precision !== null
            ? { precision: col.precision }
            : {}),
          ...(col.scale !== undefined && col.scale !== null ? { scale: col.scale } : {}),
          ...(col.length
            ? {
                maxLength: typeof col.length === 'string' ? parseInt(col.length, 10) : col.length,
              }
            : {}),
        })
        return acc
      }, [])
  }

  private deriveNavigationProperties(meta: EntityMetadata): readonly EdmNavigationProperty[] {
    return meta.relations.map((rel) => {
      const isCollection = rel.isOneToMany || rel.isManyToMany
      const targetName =
        typeof rel.type === 'string'
          ? rel.type
          : ((rel.type as { name?: string }).name ?? String(rel.type))

      const type = isCollection
        ? `Collection(${this.namespace}.${targetName})`
        : `${this.namespace}.${targetName}`

      return {
        name: rel.propertyName,
        type,
        nullable: !isCollection,
        isCollection,
      }
    })
  }
}
