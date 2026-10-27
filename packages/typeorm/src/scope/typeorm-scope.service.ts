import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common'
import {
  EdmRegistry,
  getODataRequestContext,
  navigationTargetTypeName,
  ODATA_MODULE_OPTIONS,
  type EdmEntityType,
  type ExpandNode,
  type FilterNode,
  type ODataModuleResolvedOptions,
  type ODataQuery,
} from '@nestjs-odata/core'
import type {
  DataSource,
  EntityManager,
  EntityMetadata,
  ObjectLiteral,
  SelectQueryBuilder,
} from 'typeorm'
import { ODataScopeRegistry } from './scope-registry.js'
import type {
  ODataScopeContext,
  ODataScopeOperation,
  ScopedSubquery,
  TypeOrmScopePlan,
} from './scope.types.js'

/**
 * Build `<primary key> IN (<scoped subquery>)` for an outer reference to the scoped entity.
 * `columnRef` renders one primary-key column of the outer entity.
 */
export function scopeInCondition(
  sub: ScopedSubquery,
  columnRef: (column: ScopedSubquery['primaryColumns'][number]) => string,
): string {
  const columns = sub.primaryColumns.map(columnRef)
  const lhs = columns.length === 1 ? columns[0] : `(${columns.join(', ')})`
  return `${lhs} IN (${sub.sql})`
}

/** Apply a scope to a query builder whose entity is aliased `alias`. */
export function applyScopeToQuery(
  qb: SelectQueryBuilder<ObjectLiteral>,
  alias: string,
  sub: ScopedSubquery | undefined,
): void {
  if (!sub) return
  qb.andWhere(
    scopeInCondition(sub, (c) => `${alias}.${c.propertyPath}`),
    sub.params,
  )
}

let paramSequence = 0

/**
 * Rename every named parameter of `sql` with a unique prefix, so SQL rendered by a separate
 * query builder (a scope, a nested `$expand` filter) can be embedded in another query without
 * its parameters colliding with that query's own.
 */
export function renameParameters(
  sql: string,
  params: Record<string, unknown>,
): { sql: string; params: Record<string, unknown> } {
  const prefix = `odata_scope${++paramSequence}_`
  const renamed: Record<string, unknown> = {}
  let out = sql
  // Longest names first so `id` never replaces inside `idList`.
  for (const name of Object.keys(params).sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(
      new RegExp(`(?<![:\\w]):(\\.\\.\\.)?${escaped}(?![\\w.])`, 'g'),
      (_m, spread: string | undefined) => `:${spread ?? ''}${prefix}${name}`,
    )
    renamed[`${prefix}${name}`] = params[name]
  }
  return { sql: out, params: renamed }
}

/**
 * Resolves and renders row-level scopes (see `ODataScopeFn`) for the TypeORM adapter.
 *
 * `TypeOrmAutoHandler` and the `$batch` controller use it on every read and before every
 * update, replace and delete. Custom controllers that build queries with
 * `TypeOrmQueryTranslator` directly call {@link prepare} and pass the plan to `translate()`.
 */
@Injectable()
export class TypeOrmScopeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    private readonly registry: ODataScopeRegistry,
  ) {}

  /** True when reads and writes of `entitySetName` are scoped (or must be, with `requireScope`). */
  isScoped(entitySetName: string): boolean {
    return this.registry.has(entitySetName) || this.options.requireScope === true
  }

  /**
   * Render the scope of `entitySetName` as a subquery, or `undefined` when it has none.
   * Throws when it has none and `requireScope` is enabled.
   */
  async subqueryFor(
    entitySetName: string,
    operation: ODataScopeOperation,
    navigationPath: readonly string[] = [],
    manager?: EntityManager,
  ): Promise<ScopedSubquery | undefined> {
    const fn = this.registry.get(entitySetName)
    if (!fn) {
      if (this.options.requireScope) throw missingScopeError(entitySetName)
      return undefined
    }
    const entityType = this.entityTypeOf(entitySetName)
    const metadata = this.metadataOf(entityType.name)
    const alias = `${entitySetName.replace(/\W/g, '_')}_scope`
    const qb = (manager ?? this.dataSource.manager)
      .createQueryBuilder(metadata.target, alias)
      .select(metadata.primaryColumns.map((c) => `${alias}.${c.propertyPath}`))
    const request = getODataRequestContext()
    const ctx: ODataScopeContext = {
      entitySetName,
      entityType,
      metadata,
      alias,
      operation,
      navigationPath,
      executionContext: request?.executionContext,
      request: request?.request,
    }
    await fn(qb, ctx)
    const { sql, params } = renameParameters(qb.getQuery(), qb.getParameters())
    return {
      entitySetName,
      sql,
      params,
      primaryColumns: metadata.primaryColumns.map((c) => ({
        propertyPath: c.propertyPath,
        databaseName: c.databaseName,
      })),
    }
  }

  /**
   * Resolve every scope an OData query touches: the root entity set, each `$expand` path and
   * each lambda (`any`/`all`) target in `$filter` (also inside `$expand` and `$apply` filters).
   *
   * Each scope runs once per entity set and operation for the request (concurrently), even
   * when the entity set is reached through several paths; `ctx.navigationPath` is the first
   * path it was reached through.
   */
  async prepare(
    query: ODataQuery,
    operation: ODataScopeOperation,
    manager?: EntityManager,
  ): Promise<TypeOrmScopePlan> {
    const entityType = this.entityTypeOf(query.entitySetName)
    const memo = new Map<string, Promise<ScopedSubquery | undefined>>()
    const tasks: Promise<void>[] = []
    const resolve = (
      entitySetName: string,
      op: ODataScopeOperation,
      path: readonly string[],
      store: (sub: ScopedSubquery | undefined) => void,
    ): void => {
      const key = `${entitySetName}\u0000${op}`
      let pending = memo.get(key)
      if (!pending) {
        pending = this.subqueryFor(entitySetName, op, path, manager)
        memo.set(key, pending)
      }
      tasks.push(pending.then(store))
    }

    let root: ScopedSubquery | undefined
    const expand = new Map<string, ScopedSubquery>()
    const lambda = new Map<string, ScopedSubquery>()
    const walker: ScopeWalker = {
      expand: (set, path) =>
        resolve(set, 'expand', path, (sub) => sub && expand.set(path.join('/'), sub)),
      lambda: (set, path) =>
        resolve(set, 'filter', path, (sub) => sub && lambda.set(path.join('/'), sub)),
    }

    resolve(query.entitySetName, operation, [], (sub) => (root = sub))
    if (query.filter) this.collectLambdas(query.filter, entityType, [], walker)
    for (const step of query.apply?.steps ?? []) {
      if (step.kind === 'ApplyFilter') this.collectLambdas(step.filter, entityType, [], walker)
    }
    if (query.expand && !query.apply) {
      this.collectExpand(query.expand, entityType, [], walker)
    }
    await Promise.all(tasks)
    return { root, expand, lambda, required: this.options.requireScope === true }
  }

  /**
   * Load one entity by key through its scope; `undefined` when it does not exist or is out of
   * scope. `where` maps key property names to values (as returned by `parseODataKey`).
   * Eager relations are loaded, as `Repository.findOne()` does.
   *
   * With `lock: true` (used by the write paths, inside their transaction) the row is locked for
   * update on drivers that support it, so it cannot leave the scope before the write.
   */
  async findOne(
    entitySetName: string,
    where: Record<string, unknown>,
    operation: ODataScopeOperation,
    manager?: EntityManager,
    options: { lock?: boolean } = {},
  ): Promise<ObjectLiteral | undefined> {
    const metadata = this.metadataOf(this.entityTypeOf(entitySetName).name)
    const em = manager ?? this.dataSource.manager
    const alias = 'entity'
    const qb = em.createQueryBuilder(metadata.target, alias)
    // Find options make getOne() join `eager: true` relations like Repository.findOne().
    qb.setFindOptions({ where: where as never, loadEagerRelations: true })
    applyScopeToQuery(qb, alias, await this.subqueryFor(entitySetName, operation, [], em))
    if (options.lock && supportsRowLocks(em)) qb.setLock('pessimistic_write')
    return (await qb.getOne()) ?? undefined
  }

  private collectExpand(
    node: ExpandNode,
    entityType: EdmEntityType,
    path: readonly string[],
    walker: ScopeWalker,
  ): void {
    for (const item of node.items) {
      const navProp = entityType.navigationProperties.find(
        (np) => np.name === item.navigationProperty,
      )
      // Unknown properties are rejected by the query pipe and the expand visitor with a 400.
      if (!navProp) continue
      const itemPath = [...path, navProp.name]
      const target = this.targetOf(navProp.type, itemPath)
      if (!target) continue
      walker.expand(target.entitySetName, itemPath)
      if (item.filter) this.collectLambdas(item.filter, target.entityType, itemPath, walker)
      if (item.expand) this.collectExpand(item.expand, target.entityType, itemPath, walker)
    }
  }

  private collectLambdas(
    node: FilterNode,
    entityType: EdmEntityType,
    path: readonly string[],
    walker: ScopeWalker,
  ): void {
    switch (node.kind) {
      case 'BinaryExpr':
        this.collectLambdas(node.left, entityType, path, walker)
        this.collectLambdas(node.right, entityType, path, walker)
        return
      case 'UnaryExpr':
        this.collectLambdas(node.operand, entityType, path, walker)
        return
      case 'FunctionCall':
        for (const arg of node.args) this.collectLambdas(arg, entityType, path, walker)
        return
      case 'LambdaExpr': {
        const navProp = entityType.navigationProperties.find(
          (np) => np.name.toLowerCase() === node.collection.toLowerCase(),
        )
        if (!navProp) return
        const lambdaPath = [...path, navProp.name]
        const target = this.targetOf(navProp.type, lambdaPath)
        if (target) walker.lambda(target.entitySetName, lambdaPath)
        return
      }
      default:
        return
    }
  }

  /** Resolve the entity set behind a navigation property; fails closed under `requireScope`. */
  private targetOf(
    navType: string,
    path: readonly string[],
  ): { entitySetName: string; entityType: EdmEntityType } | undefined {
    const typeName = navigationTargetTypeName(navType)
    const entityType = this.edmRegistry.getEntityType(typeName)
    const entitySet = [...this.edmRegistry.getEntitySets().values()].find(
      (es) => es.entityTypeName === typeName,
    )
    if (!entityType || !entitySet) {
      if (this.options.requireScope) {
        throw new InternalServerErrorException(
          `Navigation '${path.join('/')}' targets '${typeName}', which is not an OData entity set, ` +
            'so no row-level scope can apply to it and requireScope is enabled',
        )
      }
      return undefined
    }
    return { entitySetName: entitySet.name, entityType }
  }

  private entityTypeOf(entitySetName: string): EdmEntityType {
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    const entityType = entitySet && this.edmRegistry.getEntityType(entitySet.entityTypeName)
    if (!entityType) {
      throw new Error(`TypeOrmScopeService: entity set '${entitySetName}' is not registered`)
    }
    return entityType
  }

  private metadataOf(entityTypeName: string): EntityMetadata {
    const metadata = this.dataSource.entityMetadatas.find((m) => m.name === entityTypeName)
    if (!metadata) {
      throw new Error(`TypeOrmScopeService: no TypeORM entity named '${entityTypeName}'`)
    }
    return metadata
  }
}

/** Callbacks `prepare()` uses while walking `$expand` and lambdas. */
interface ScopeWalker {
  expand(entitySetName: string, path: readonly string[]): void
  lambda(entitySetName: string, path: readonly string[]): void
}

/** Drivers that implement `SELECT ... FOR UPDATE` (TypeORM's `pessimistic_write`). */
const ROW_LOCK_DRIVERS = new Set([
  'postgres',
  'cockroachdb',
  'mysql',
  'mariadb',
  'aurora-mysql',
  'aurora-postgres',
  'mssql',
  'oracle',
  'sap',
  'spanner',
])

function supportsRowLocks(manager: EntityManager): boolean {
  return ROW_LOCK_DRIVERS.has(String(manager.connection.options.type))
}

/**
 * Look up a pre-resolved scope; under `requireScope` (`plan.required`) a missing entry is a
 * bug in the caller (a path `prepare()` did not see), so fail closed instead of running
 * unscoped.
 */
export function lookupScope(
  plan: TypeOrmScopePlan,
  kind: 'expand' | 'lambda',
  path: readonly string[],
): ScopedSubquery | undefined {
  const sub = plan[kind].get(path.join('/'))
  if (!sub && plan.required) {
    throw new InternalServerErrorException(
      `No row-level scope was prepared for ${kind} path '${path.join('/')}' and requireScope is enabled`,
    )
  }
  return sub
}

function missingScopeError(entitySetName: string): InternalServerErrorException {
  return new InternalServerErrorException(
    `No row-level scope is registered for entity set '${entitySetName}' and requireScope is enabled`,
  )
}
