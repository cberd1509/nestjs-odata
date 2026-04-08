/**
 * Injection token for IETagProvider.
 * Use this token when registering or injecting the ETag provider via NestJS DI.
 */
export const ETAG_PROVIDER = Symbol('ETAG_PROVIDER')

/**
 * Interface for computing and validating ETags for OData entities.
 *
 * Implementations are adapter-specific (e.g., TypeOrmETagProvider).
 * Core uses this interface without importing any ORM code.
 */
export interface IETagProvider {
  /**
   * Get the ETag column name for an entity set.
   * Returns undefined if the entity set is not ETag-enabled
   * (no @UpdateDateColumn or @ODataETag decorator found).
   */
  getETagColumn(entitySetName: string): string | undefined

  /**
   * Compute a weak ETag string from an entity's ETag column value.
   * Format: W/"<value>"
   */
  computeETag(entity: Record<string, unknown>, etagColumn: string): string

  /**
   * Validate an If-Match header value against the current entity state.
   * Returns true if the ETag matches (proceed with mutation),
   * false if the ETag is stale (return 412).
   */
  validateIfMatch(
    ifMatchValue: string,
    entity: Record<string, unknown>,
    etagColumn: string,
  ): boolean
}
