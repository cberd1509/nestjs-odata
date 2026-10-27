import type { ExecutionContext } from '@nestjs/common'
import type { EdmEntityType } from '@nestjs-odata/core'
import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm'

/**
 * What the scoped query is for.
 *
 * - `collection`: the root query of a collection read (`GET /Set`, also with `$apply`)
 * - `count`: `GET /Set/$count`
 * - `entity`: a by-key read (`GET /Set/:key`)
 * - `expand`: an entity set reached through `$expand` (at any depth)
 * - `filter`: an entity set reached from `$filter`: through a lambda (`any`/`all`) or a
 *   single-valued navigation path (`category/name`)
 * - `write`: the existence check that runs before an update, replace or delete
 */
export type ODataScopeOperation = 'collection' | 'count' | 'entity' | 'expand' | 'filter' | 'write'

/** Everything a row-level scope receives besides the query builder. */
export interface ODataScopeContext {
  /** The OData entity set being scoped (for `expand`/`filter`, the target entity set). */
  readonly entitySetName: string
  /** The EDM entity type of that entity set. */
  readonly entityType: EdmEntityType
  /** The TypeORM metadata of the entity behind the entity set. */
  readonly metadata: EntityMetadata
  /**
   * The alias of the entity in the query builder. Write conditions against it, for example
   * `` qb.andWhere(`${ctx.alias}.ownerId = :ownerId`, { ownerId }) ``.
   */
  readonly alias: string
  /** What the scoped query is for. */
  readonly operation: ODataScopeOperation
  /**
   * Navigation properties followed from the requested entity set to reach this one: `[]` for
   * the root, `['items']` for `$expand=items`, `['items', 'product']` for
   * `$expand=items($expand=product)`, `['items']` for `$filter=items/any(...)`,
   * `['category', 'group']` for `$filter=category/group/name eq 'x'`.
   */
  readonly navigationPath: readonly string[]
  /**
   * The Nest execution context of the route (the `$batch` route for batch parts), or
   * `undefined` outside an HTTP request. See `getODataRequestContext()` in `@nestjs-odata/core`.
   */
  readonly executionContext: ExecutionContext | undefined
  /** The platform request object (Express or Fastify), or `undefined` outside a request. */
  readonly request: unknown
}

/**
 * A row-level scope: restricts which rows of an entity set a request can see or change.
 *
 * It receives a `SELECT` of the entity's primary key from its table (aliased `ctx.alias`) and
 * adds conditions or joins to it. Rows the resulting query does not return are invisible to
 * the request everywhere: collections, `$count`, by-key reads (404), `$expand`, lambdas in
 * `$filter`, `$apply`, `$batch` and the existence checks of writes.
 *
 * - Add conditions with `andWhere`, `where`, `orWhere` or `Brackets`: the scope runs on its own
 *   query, so it cannot widen or break the rest of the OData query.
 * - Do not change the selection (`select`, `addSelect`).
 * - Parameter names are renamed to stay unique, so the same name can be reused in every scope.
 * - It may be `async`, for example to look up what the current user can access.
 */
export type ODataScopeFn = (
  qb: SelectQueryBuilder<ObjectLiteral>,
  ctx: ODataScopeContext,
) => void | Promise<void>

/**
 * Class form of a row-level scope, for scopes that need dependency injection. Pass the class as
 * the `scope` of a `forFeature()` item (or as `defaultScope`); it is registered as a provider of
 * that feature module, so its constructor dependencies must be resolvable there (see the
 * `imports` option of `forFeature()`).
 */
export interface ODataScope {
  apply(qb: SelectQueryBuilder<ObjectLiteral>, ctx: ODataScopeContext): void | Promise<void>
}

/** A scope as accepted by `forFeature()`: a function or an injectable class. */
export type ODataScopeDefinition = ODataScopeFn | (new (...args: any[]) => ODataScope)

/**
 * A scope rendered as SQL: `SELECT <primary key> FROM <table> WHERE <scope>`, with parameter
 * names made unique. Used as `<primary key> IN (<sql>)`.
 */
export interface ScopedSubquery {
  readonly sql: string
  readonly params: Readonly<Record<string, unknown>>
  readonly primaryColumns: readonly {
    readonly propertyPath: string
    readonly databaseName: string
  }[]
}

/**
 * The scopes of one OData request, resolved ahead of query translation (scopes may be async,
 * translation is not). Produced by `TypeOrmScopeService.prepare()`.
 */
export interface TypeOrmScopePlan {
  /** Scope of the requested entity set, if any. */
  readonly root?: ScopedSubquery
  /** Scopes of expanded entity sets, keyed by navigation path (`items/product`). */
  readonly expand: ReadonlyMap<string, ScopedSubquery>
  /**
   * Scopes of entity sets reached from `$filter` — lambda (`any`/`all`) targets and the
   * navigation segments of property paths — keyed by navigation path (`items`, `category`,
   * `category/group`).
   */
  readonly lambda: ReadonlyMap<string, ScopedSubquery>
  /** True under `requireScope`: a path without an entry fails instead of running unscoped. */
  readonly required: boolean
}
