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
  // No value (e.g. the column was left out by $select): no ETag rather than a wrong one.
  if (!column || entity[column] === undefined || entity[column] === null) return undefined
  return etagProvider!.computeETag(entity, column)
}

/**
 * 412 / 428 checks of a data modification request against the target entity's current ETag
 * (OData-Protocol 4.01 §8.2.4, §8.2.5, §11.4.1.1), shared by the HTTP routes and `$batch`.
 * Returns the failing status and message, or `undefined` when the write may proceed.
 */
export function preconditionFailure(
  headers: { readonly ifMatch?: string; readonly ifNoneMatch?: string },
  currentETag: string | undefined,
): { readonly status: 412; readonly message: string } | undefined {
  // If-Match on an entity set without ETags is ignored (nothing to compare with).
  if (headers.ifMatch && currentETag !== undefined && !etagMatches(headers.ifMatch, currentETag)) {
    return { status: 412, message: ETAG_MISMATCH_MESSAGE }
  }
  // `*` matches any existing entity; a list matches when it contains the current ETag.
  if (headers.ifNoneMatch && etagMatches(headers.ifNoneMatch, currentETag)) {
    return { status: 412, message: 'The entity matches the If-None-Match precondition' }
  }
  return undefined
}

/** Message of the 412 for an `If-Match` that does not match. */
export const ETAG_MISMATCH_MESSAGE =
  'The ETag value does not match the current version of the entity'

/** Message of the 428 for a write without `If-Match` on an entity set that requires it. */
export const IF_MATCH_REQUIRED_MESSAGE =
  'This entity set requires an If-Match header for data modification requests'
