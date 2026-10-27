import type { IETagProvider } from '@nestjs-odata/core'
import type { ODataETagSource } from './write.types.js'
import type { ODataWriteRegistry } from './write-registry.js'

/** Format a value as a weak ETag, the same way `TypeOrmETagProvider` does. */
export function formatWeakETag(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value)
  return `W/"${Buffer.from(text).toString('base64')}"`
}

/** Compute an entity's ETag from an {@link ODataETagSource}; `undefined` when it has none. */
export function computeETagFromSource(
  source: ODataETagSource,
  entity: Record<string, unknown>,
): string | undefined {
  const value = typeof source === 'string' ? entity[source] : source(entity)
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && /^(W\/)?".*"$/.test(value)) return value
  return formatWeakETag(value)
}

/**
 * True when an `If-Match` header is satisfied by the current ETag: `*` matches any existing
 * entity, otherwise any listed ETag must equal the current one (weak comparison).
 */
export function etagMatches(ifMatch: string, currentETag: string | undefined): boolean {
  const candidates = ifMatch.split(',').map((s) => s.trim())
  if (candidates.includes('*')) return true
  if (currentETag === undefined) return false
  const current = normalizeETag(currentETag)
  return candidates.some((c) => normalizeETag(c) === current)
}

/** An ETag's opaque value: without `W/` and the quotes (weak comparison). */
function normalizeETag(etag: string): string {
  return etag
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1')
}

/**
 * Whether an entity set has an ETag: an `etag` option, else an `@ODataETag` /
 * `@UpdateDateColumn` column known to the ETag provider.
 */
export function hasEntityETag(
  entitySetName: string,
  writes: ODataWriteRegistry | undefined,
  etagProvider: IETagProvider | undefined,
): boolean {
  return (
    writes?.getETag(entitySetName) !== undefined ||
    etagProvider?.getETagColumn(entitySetName) !== undefined
  )
}

/**
 * The ETag of an entity of `entitySetName`: from the entity set's `etag` option when it has
 * one, else from `@ODataETag` / `@UpdateDateColumn` through the ETag provider. Shared by the
 * HTTP routes and `$batch` so both send the same ETags.
 */
export function resolveEntityETag(
  entitySetName: string,
  entity: Record<string, unknown>,
  writes: ODataWriteRegistry | undefined,
  etagProvider: IETagProvider | undefined,
): string | undefined {
  const source = writes?.getETag(entitySetName)
  if (source !== undefined) return computeETagFromSource(source, entity)
  const column = etagProvider?.getETagColumn(entitySetName)
  return column ? etagProvider!.computeETag(entity, column) : undefined
}
