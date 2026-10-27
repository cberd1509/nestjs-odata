import type { EntityManager } from 'typeorm'
import { getODataBatchPart } from '@nestjs-odata/core'

/**
 * The entity manager of the `$batch` changeset being executed, or `undefined` outside a
 * changeset.
 *
 * Each changeset operation runs through its route like a standalone request, inside the
 * changeset's transaction; the manager is the `changeset` of its `getODataBatchPart()` (read from
 * `request` when given, else the request of the OData request context, else the async context).
 * `TypeOrmAutoHandler`, row-level scopes and write handlers (`ctx.manager`) use it
 * automatically. Code of your own that writes to the database from an OData route (a custom
 * controller method, a service it calls) must use it too, so its writes commit or roll back with
 * the changeset:
 *
 * ```ts
 * const manager = getODataChangesetManager() ?? this.dataSource.manager
 * await manager.getRepository(AuditLog).save(entry)
 * ```
 */
export function getODataChangesetManager(request?: unknown): EntityManager | undefined {
  return getODataBatchPart(request)?.changeset as EntityManager | undefined
}
