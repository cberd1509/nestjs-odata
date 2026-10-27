import type { ExecutionContext } from '@nestjs/common'
import type { EdmEntityType } from '@nestjs-odata/core'
import type { EntityManager } from 'typeorm'

/** The write being handled. `deepInsert` is a POST whose body contains navigation properties. */
export type ODataWriteOperation = 'create' | 'deepInsert' | 'update' | 'replace' | 'delete'

/** Everything a write handler receives besides the body and the key. */
export interface ODataWriteContext {
  readonly entitySetName: string
  readonly entityType: EdmEntityType
  readonly operation: ODataWriteOperation
  /** The key exactly as it appeared in the URL (`5`, `'abc'`, `orderId=1,itemId=2`). */
  readonly rawKey?: string
  /** The `If-Match` request header, if any. The handler decides whether it matches. */
  readonly ifMatch?: string
  /**
   * The `If-None-Match` request header, if any. The handler decides whether it matches; for a
   * data modification request a match (`*` matches any existing entity) MUST answer 412 with
   * no change (OData-Protocol 4.01 §8.2.5).
   */
  readonly ifNoneMatch?: string
  /**
   * True when the entity set requires `If-Match` (`requireIfMatch`). The library already
   * answered 428 when the header is missing; the handler still checks that it matches.
   */
  readonly requireIfMatch?: boolean
  /**
   * The Nest execution context of the route. A `$batch` operation runs through its own route,
   * so this is that route's context (the `$batch` request is `getODataBatchPart()?.batchRequest`).
   */
  readonly executionContext?: ExecutionContext
  /** The platform request object (for a `$batch` operation, the operation's own request). */
  readonly request?: unknown
  /**
   * Inside a `$batch` changeset: the entity manager of the changeset's transaction (also
   * available as `getODataChangesetManager()`). Write through it (or through whatever your
   * `changesetRunner` set up) so the changeset stays atomic.
   * For `handleDeepCreate(body, set, manager)`: the manager the caller passed.
   * `undefined` otherwise.
   */
  readonly manager?: EntityManager
  /** Set when the write is part of a `$batch` request. */
  readonly batch?: { readonly contentId?: string; readonly inChangeset: boolean }
}

/** Key of the target entity, by key property name (`{ id: 5 }`). */
export type ODataEntityKey = Readonly<Record<string, unknown>>

/**
 * Per-entity-set write handlers: route OData writes through application code instead of the
 * TypeORM repository.
 *
 * Each handler returns the entity to serialize: the created entity for POST (its key properties
 * build the `Location` header), the updated entity for PATCH and PUT. Throw to fail the write;
 * throw an `HttpException` (or map your errors with the error-mapping option) to choose the status.
 *
 * An entity set with write handlers never falls back to the repository: an operation without a
 * handler answers 405 Method Not Allowed.
 *
 * Handlers are declared as function properties, so a class implementing this interface can
 * use ordinary methods; they are always invoked on the handlers object (`this` is preserved).
 */
export interface ODataWriteHandlers<TEntity extends object = Record<string, unknown>> {
  /** POST. Also receives deep-insert bodies when there is no `deepInsert` handler. */
  create?: (body: Record<string, unknown>, ctx: ODataWriteContext) => TEntity | Promise<TEntity>
  /** POST whose body contains navigation properties (deep insert). */
  deepInsert?: (body: Record<string, unknown>, ctx: ODataWriteContext) => TEntity | Promise<TEntity>
  /** PATCH (merge semantics). */
  update?: (
    key: ODataEntityKey,
    body: Record<string, unknown>,
    ctx: ODataWriteContext,
  ) => TEntity | Promise<TEntity>
  /** PUT (replace semantics). */
  replace?: (
    key: ODataEntityKey,
    body: Record<string, unknown>,
    ctx: ODataWriteContext,
  ) => TEntity | Promise<TEntity>
  /** DELETE. */
  delete?: (key: ODataEntityKey, ctx: ODataWriteContext) => void | Promise<void>
}

/**
 * Write handlers as accepted by `forFeature()`: an object, or an injectable class registered
 * as a provider of the feature module (so it can inject your services).
 */
export type ODataWriteHandlersDefinition =
  ODataWriteHandlers<any> | (new (...args: any[]) => ODataWriteHandlers<any>)

/**
 * Where an entity set's ETag comes from: a property name, or a function of the entity. The
 * value is turned into a weak ETag (`W/"<base64>"`); a function may also return a complete
 * ETag (`W/"..."` or `"..."`), used as is. Return `undefined`/`null` for no ETag.
 */
export type ODataETagSource =
  string | ((entity: Record<string, unknown>) => string | number | Date | null | undefined)

/**
 * Runs the operations of one `$batch` changeset atomically. `work` executes every operation
 * and throws when one fails; the runner must commit when it resolves and roll back when it
 * rejects. The default runs `work` in a TypeORM `QueryRunner` transaction. Provide your own to
 * join your application's unit of work. The manager passed to `work` is what the changeset's
 * operations see as `getODataChangesetManager()` and write handlers as `ctx.manager`. `ctx`
 * describes the `$batch` request.
 */
export type ODataChangesetRunner = <T>(
  work: (manager: EntityManager) => Promise<T>,
  ctx: { readonly executionContext?: ExecutionContext; readonly request?: unknown },
) => Promise<T>
