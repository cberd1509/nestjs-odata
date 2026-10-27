import { AsyncLocalStorage } from 'node:async_hooks'
import type { EntityManager } from 'typeorm'

const storage = new AsyncLocalStorage<EntityManager>()

/**
 * The entity manager of the `$batch` changeset being executed, or `undefined` outside a
 * changeset.
 *
 * Each changeset operation runs through its route like a standalone request, inside the
 * changeset's transaction. `TypeOrmAutoHandler`, row-level scopes and write handlers
 * (`ctx.manager`) use this manager automatically. Code of your own that writes to the database
 * from an OData route (a custom controller method, a service it calls) must use it too, so its
 * writes commit or roll back with the changeset:
 *
 * ```ts
 * const manager = getODataChangesetManager() ?? this.dataSource.manager
 * await manager.getRepository(AuditLog).save(entry)
 * ```
 */
export function getODataChangesetManager(): EntityManager | undefined {
  return storage.getStore()
}

/** Runs `fn` with `manager` as the current changeset's entity manager. */
export function runInODataChangeset<T>(manager: EntityManager, fn: () => T): T {
  return storage.run(manager, fn)
}
