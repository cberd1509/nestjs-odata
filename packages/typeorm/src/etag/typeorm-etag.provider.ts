import { Injectable } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { EdmRegistry } from '@nestjs-odata/core'
import { getETagProperty } from '@nestjs-odata/core'
import type { IETagProvider } from '@nestjs-odata/core'

/**
 * TypeORM implementation of IETagProvider.
 *
 * Discovers the ETag source column per entity set in priority order:
 *   1. @ODataETag() decorator (explicit opt-in takes precedence)
 *   2. TypeORM @UpdateDateColumn (automatic fallback via isUpdateDate)
 *
 * ETag format: W/"<base64-encoded column value>"
 * This is deterministic and changes whenever the column value changes.
 *
 * Caches column name resolution per entity set for performance.
 */
@Injectable()
export class TypeOrmETagProvider implements IETagProvider {
  private readonly cache = new Map<string, string | null>()

  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
  ) {}

  /**
   * Get the ETag column name for an entity set.
   * Returns undefined if neither @ODataETag nor @UpdateDateColumn is found.
   * Results are cached to avoid repeated metadata reflection.
   */
  getETagColumn(entitySetName: string): string | undefined {
    if (this.cache.has(entitySetName)) {
      const cached = this.cache.get(entitySetName)
      return cached ?? undefined
    }

    const column = this.resolveETagColumn(entitySetName)
    this.cache.set(entitySetName, column ?? null)
    return column
  }

  /**
   * Compute a weak ETag string from an entity's ETag column value.
   * Format: W/"<base64-encoded string value>"
   */
  computeETag(entity: Record<string, unknown>, etagColumn: string): string {
    const value = entity[etagColumn]
    let stringValue: string
    if (value instanceof Date) {
      stringValue = value.toISOString()
    } else {
      stringValue = String(value)
    }
    const encoded = Buffer.from(stringValue).toString('base64')
    return `W/"${encoded}"`
  }

  /**
   * Validate an If-Match header value against the current entity.
   * Returns true if the ETag matches (safe to proceed with mutation).
   */
  validateIfMatch(
    ifMatchValue: string,
    entity: Record<string, unknown>,
    etagColumn: string,
  ): boolean {
    const current = this.computeETag(entity, etagColumn)
    // Normalize: strip surrounding quotes/whitespace for robust comparison
    const normalize = (s: string): string =>
      s
        .trim()
        .replace(/^W\//, '')
        .replace(/^"(.*)"$/, '$1')
    return normalize(current) === normalize(ifMatchValue)
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private resolveETagColumn(entitySetName: string): string | undefined {
    // Step 1: resolve entity type name from registry
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) return undefined

    const entityTypeName = entitySet.entityTypeName

    // Step 2: find the TypeORM metadata for this entity type
    const meta = this.dataSource.entityMetadatas.find((m) => m.name === entityTypeName)
    if (!meta) return undefined

    const entityClass = meta.target as new (...args: unknown[]) => unknown
    if (typeof entityClass !== 'function') return undefined

    // Step 3: check @ODataETag decorator first (explicit opt-in takes precedence)
    const explicitProperty = getETagProperty(entityClass)
    if (explicitProperty) return explicitProperty

    // Step 4: fall back to TypeORM @UpdateDateColumn
    const updateDateCol = meta.columns.find((c) => c.isUpdateDate)
    if (updateDateCol) return updateDateCol.propertyName

    return undefined
  }
}
