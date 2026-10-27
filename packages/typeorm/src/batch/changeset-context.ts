import { AsyncLocalStorage } from 'node:async_hooks'
import type { EntityManager } from 'typeorm'
import { getODataBatchRequestValue } from '@nestjs-odata/core'

const storage = new AsyncLocalStorage<EntityManager>()

/**
 * The entity manager of the `$batch` changeset being executed, or `undefined` outside a
 * changeset.
 *
 * Each changeset operation runs through its route like a standalone request, inside the
 * changeset's transaction. The manager is attached to the operation's request and kept in an
 * `AsyncLocalStorage`; it is read from the request of the current OData request context (or
 * `request`, when given) first. `TypeOrmAutoHandler`, row-level scopes and write handlers
 * (`ctx.manager`) use this manager automatically. Code of your own that writes to the database
 * from an OData route (a custom controller method, a service it calls) must use it too, so its
 * writes commit or roll back with the changeset:
 *
 * ```ts
 * const manager = getODataChangesetManager() ?? this.dataSource.manager
 * await manager.getRepository(AuditLog).save(entry)
 * ```
 */
export function getODataChangesetManager(request?: unknown): EntityManager | undefined {
  // The manager attached to the operation's request first: an async context can be lost (or be
  // another request's) when middleware resumes `next()` from a foreign context.
  const attached = getODataBatchRequestValue<EntityManager>(ODATA_CHANGESET_MANAGER, request)
  if (attached !== undefined) return attached ?? undefined
  return storage.getStore()
}

/**
 * Request property (a symbol) holding the changeset's entity manager on the request injected
 * for a `$batch` operation (`null` outside a changeset). See {@link getODataChangesetManager}.
 */
export const ODATA_CHANGESET_MANAGER: unique symbol = Symbol.for('@nestjs-odata/changeset-manager')

/** Runs `fn` with `manager` as the current changeset's entity manager. */
export function runInODataChangeset<T>(manager: EntityManager, fn: () => T): T {
  return storage.run(manager, fn)
}
