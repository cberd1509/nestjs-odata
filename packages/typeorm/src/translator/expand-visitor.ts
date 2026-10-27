import type {
  SelectQueryBuilder,
  ObjectLiteral,
  EntityManager,
  EntityMetadata,
  RelationMetadata,
} from 'typeorm'
import { supportsWindowFunctions, type SqlDialect } from './sql-dialect.js'
import type { ExpandNode, ExpandItem, EdmEntityType, ISearchProvider } from '@nestjs-odata/core'
import {
  navigationTargetTypeName,
  ODataNotImplementedError,
  ODataValidationError,
} from '@nestjs-odata/core'
import type { EdmRegistry } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import { TypeOrmOrderByVisitor } from './orderby-visitor.js'
import { TypeOrmSelectVisitor } from './select-visitor.js'
import type { TypeOrmScopePlan } from '../scope/scope.types.js'
import {
  lookupScope,
  metadataForType,
  primaryKeyQuery,
  renameParameters,
  renderPrimaryKeyQuery,
  scopeInCondition,
} from '../scope/typeorm-scope.service.js'
import type { ExpandCountQuery } from './expand-count.js'

/** Options for {@link TypeOrmExpandVisitor} beyond the query builder and the registry. */
export interface TypeOrmExpandVisitorOptions {
  /** Row-level scopes of the request; each expanded entity set's scope goes in its JOIN. */
  readonly scopes?: TypeOrmScopePlan
  /**
   * Entity manager used to render nested `$filter`s inside `$expand` into the JOIN condition.
   * Without it, nested filters are rejected.
   */
  readonly manager?: EntityManager
  readonly maxFilterDepth?: number
  readonly dialect?: SqlDialect
  /** Renders nested `$search`; without it, a nested `$search` is answered with 501. */
  readonly searchProvider?: ISearchProvider
  /**
   * TypeORM driver type (`DataSourceOptions['type']`). Nested `$top`/`$skip` on one-to-many
   * navigations are paged in SQL with `ROW_NUMBER()` when the driver supports window functions
   * (see `supportsWindowFunctions`); otherwise in memory after the query.
   */
  readonly driverType?: string
}

/** A SQL condition with its named parameters. */
interface Condition {
  readonly sql: string
  readonly params: Readonly<Record<string, unknown>>
}

let aliasSequence = 0

/** The parameters of several conditions, in one object. */
function mergeParams(conditions: readonly Condition[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const condition of conditions) Object.assign(params, condition.params)
  return params
}

/**
 * TypeOrmExpandVisitor — translates $expand AST nodes into TypeORM
 * leftJoinAndSelect calls. Supports nested expand with depth tracking.
 *
 * Per D-09: Uses JOINs, NOT lazy loading — one SQL query.
 * Per D-07: Enforces maxExpandDepth.
 * Per D-10: Validates navigation property names against EDM.
 * Nested $top/$skip: on one-to-many navigations with a driver that supports window functions,
 *   paged in SQL (`ROW_NUMBER() OVER (PARTITION BY <fk> ORDER BY ...)` in the JOIN condition).
 *   Otherwise recorded in expandPaginationMap, by expand path, for in-memory slicing by
 *   TypeOrmQueryTranslator after getMany() (D-13).
 * Nested $count=true and nav/$count: recorded in expandCounts, run by the translator after the
 *   main query (one grouped COUNT per expand item).
 *
 * Alias convention: `{parentAlias}_{navigationProperty}` — unique per level
 * to prevent TypeORM alias collision when the same nav prop appears at
 * different tree paths.
 */
export class TypeOrmExpandVisitor {
  /**
   * $top/$skip of expand items paged in memory, keyed by expand path (`items`,
   * `store/items`). Consumed by TypeOrmQueryTranslator after getMany() via
   * applyExpandPagination().
   */
  readonly expandPaginationMap = new Map<string, { skip?: number; top?: number }>()

  /** Count queries of `$count=true` / `nav/$count` expand items, run after the main query. */
  readonly expandCounts: ExpandCountQuery[] = []

  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly edmRegistry: EdmRegistry,
    private readonly maxExpandDepth: number,
    private readonly options: TypeOrmExpandVisitorOptions = {},
  ) {}

  /**
   * Apply an ExpandNode to the SelectQueryBuilder starting from parentAlias.
   *
   * @param expandNode   - The $expand AST node to process
   * @param parentAlias  - The QueryBuilder alias for the parent entity (e.g. 'entity')
   * @param entityType   - EDM entity type of the parent (for validation)
   * @param currentDepth - Current recursion depth (0 = top-level expand)
   */
  apply(
    expandNode: ExpandNode,
    parentAlias: string,
    entityType: EdmEntityType,
    currentDepth: number,
    path: readonly string[] = [],
  ): void {
    if (currentDepth >= this.maxExpandDepth) {
      throw new ODataValidationError(
        `$expand depth limit of ${this.maxExpandDepth} exceeded`,
        entityType.name,
        '$expand',
      )
    }

    for (const item of expandNode.items) {
      this.applyExpandItem(item, parentAlias, entityType, currentDepth, path)
    }
  }

  private applyExpandItem(
    item: ExpandItem,
    parentAlias: string,
    entityType: EdmEntityType,
    currentDepth: number,
    parentPath: readonly string[],
  ): void {
    // Validate against EDM navigation properties (D-10, T-04-09)
    const navProp = entityType.navigationProperties.find(
      (np) => np.name === item.navigationProperty,
    )
    if (!navProp) {
      throw new ODataValidationError(
        `'${item.navigationProperty}' is not a navigation property of '${entityType.name}'`,
        entityType.name,
        item.navigationProperty,
      )
    }

    const path = [...parentPath, navProp.name]
    // Build unique alias: parentAlias_navigationProperty
    const joinAlias = `${parentAlias}_${item.navigationProperty}`

    // Resolve the target entity type for nested query options. Navigation types are
    // qualified (`Default.Category`, `Collection(Default.OrderItem)`); the registry is keyed
    // by the bare type name.
    const targetEntityType = this.edmRegistry.getEntityType(navigationTargetTypeName(navProp.type))

    // $count=true / nav/$count: a grouped COUNT run after the main query.
    if ((item.count || item.countOnly) && targetEntityType) {
      this.recordCount(item, entityType, targetEntityType, path)
    }
    if (item.countOnly) return

    // JOIN condition: the target's row-level scope, the nested $filter and $search, and the SQL
    // paging. They restrict which related rows are expanded, never which parent rows return.
    const conditions = targetEntityType
      ? this.relatedRowConditions(item, targetEntityType, joinAlias, path)
      : []
    const paging =
      targetEntityType &&
      (item.top !== undefined || item.skip !== undefined) &&
      navProp.isCollection
        ? this.sqlPaging(item, entityType, targetEntityType, joinAlias, path)
        : undefined
    if (paging) conditions.push(paging)
    const condition = conditions.length > 0 ? conditions.map((c) => c.sql).join(' AND ') : undefined
    const params = mergeParams(conditions)

    // Nested $select: join without selecting, then add only the requested columns and the key.
    const relation = `${parentAlias}.${item.navigationProperty}`
    const columns =
      item.select && targetEntityType
        ? new TypeOrmSelectVisitor(this.qb, joinAlias, targetEntityType).columns(item.select)
        : []
    if (columns.length > 0) {
      this.qb.leftJoin(relation, joinAlias, condition, params)
      this.qb.addSelect(columns)
    } else if (condition) {
      this.qb.leftJoinAndSelect(relation, joinAlias, condition, params)
    } else {
      this.qb.leftJoinAndSelect(relation, joinAlias)
    }

    if (item.orderBy?.length) {
      new TypeOrmOrderByVisitor(this.qb, joinAlias).apply(item.orderBy, true)
    }

    // Per D-13: $top/$skip not paged in SQL are sliced in memory after getMany(), by expand
    // path. Only collections can be paginated — single-valued nav props are not arrays.
    if (!paging && (item.top !== undefined || item.skip !== undefined) && navProp.isCollection) {
      this.expandPaginationMap.set(path.join('/'), {
        skip: item.skip,
        top: item.top,
      })
    }

    // Recursive nested expand (D-07)
    if (item.expand && targetEntityType) {
      this.apply(item.expand, joinAlias, targetEntityType, currentDepth + 1, path)
    }
  }

  /**
   * Conditions on the related rows of an expand item, for an alias of the target entity: its
   * row-level scope, the nested `$filter` and the nested `$search`.
   */
  private relatedRowConditions(
    item: ExpandItem,
    targetEntityType: EdmEntityType,
    alias: string,
    path: readonly string[],
  ): Condition[] {
    const conditions: Condition[] = []
    const scopes = this.options.scopes
    const scoped = scopes ? lookupScope(scopes, 'expand', path) : undefined
    if (scoped) {
      conditions.push({
        sql: scopeInCondition(scoped, (c) => `${alias}.${c.propertyPath}`),
        params: scoped.params,
      })
    }
    if (item.filter) {
      conditions.push(this.renderNestedFilter(item, targetEntityType, alias, path))
    }
    if (item.search) {
      conditions.push(this.renderNestedSearch(item, targetEntityType, alias))
    }
    return conditions
  }

  /** Render a nested `$search` with the search provider, its parameters renamed. */
  private renderNestedSearch(
    item: ExpandItem,
    targetEntityType: EdmEntityType,
    alias: string,
  ): Condition {
    const provider = this.options.searchProvider
    const entitySet = this.edmRegistry.getEntitySetByTypeName(targetEntityType.name)
    if (!provider || !entitySet) {
      throw new ODataNotImplementedError(
        `$search inside $expand of '${item.navigationProperty}' is not supported`,
      )
    }
    const search = provider.buildSearchCondition(item.search!, entitySet.name, alias)
    if (!search) {
      throw new ODataNotImplementedError(
        `$search inside $expand of '${item.navigationProperty}' is not supported`,
      )
    }
    const renamed = renameParameters(`(${search.condition})`, search.params)
    return { sql: renamed.sql, params: renamed.params }
  }

  /**
   * Page an expanded one-to-many collection in SQL: the JOIN keeps only the related rows whose
   * `ROW_NUMBER() OVER (PARTITION BY <fk> ORDER BY <nested $orderby>, <key>)`, computed over
   * the rows inside the scope, nested `$filter` and nested `$search`, is in
   * `(skip, skip + top]`. Returns `undefined` (in-memory paging) for other relations, composite
   * keys and drivers without window functions.
   */
  private sqlPaging(
    item: ExpandItem,
    entityType: EdmEntityType,
    targetEntityType: EdmEntityType,
    joinAlias: string,
    path: readonly string[],
  ): Condition | undefined {
    const manager = this.options.manager
    if (!manager || !supportsWindowFunctions(this.options.driverType ?? '')) return undefined
    const relation = this.relationOf(manager, entityType, item.navigationProperty)
    const fkColumns = relation?.inverseRelation?.joinColumns ?? []
    const target = relation?.inverseEntityMetadata
    if (
      !relation?.isOneToMany ||
      !target ||
      fkColumns.length === 0 ||
      target.primaryColumns.length !== 1
    ) {
      return undefined
    }
    const escape = (name: string) => manager.connection.driver.escape(name)
    const id = ++aliasSequence
    const r = `odata_rank${id}`
    const key = target.primaryColumns[0]
    const order: string[] = []
    for (const o of item.orderBy ?? []) {
      const property =
        o.expression.kind === 'PropertyAccess' && o.expression.path.length === 1
          ? o.expression.path[0]
          : undefined
      const column = property ? target.findColumnWithPropertyPath(property) : undefined
      // An ordering the ranking can't reproduce would page the wrong rows: page in memory instead.
      if (!column) return undefined
      order.push(`${r}.${escape(column.databaseName)} ${o.direction.toUpperCase()}`)
    }
    order.push(`${r}.${escape(key.databaseName)} ASC`)
    const partition = fkColumns.map((c) => `${r}.${escape(c.databaseName)}`).join(', ')

    const ranked = manager
      .createQueryBuilder(target.target, r)
      .select(`${r}.${escape(key.databaseName)}`, 'odata_key')
      .addSelect(
        `ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${order.join(', ')})`,
        'odata_rn',
      )
    for (const condition of this.relatedRowConditions(item, targetEntityType, r, path)) {
      ranked.andWhere(condition.sql, condition.params)
    }
    const rendered = renameParameters(ranked.getQuery(), ranked.getParameters())

    const skip = item.skip ?? 0
    const params: Record<string, unknown> = { ...rendered.params, [`odata_rank${id}_skip`]: skip }
    let window = `odata_ranked${id}.odata_rn > :odata_rank${id}_skip`
    if (item.top !== undefined) {
      params[`odata_rank${id}_end`] = skip + item.top
      window += ` AND odata_ranked${id}.odata_rn <= :odata_rank${id}_end`
    }
    return {
      sql:
        `${joinAlias}.${key.propertyPath} IN (SELECT odata_ranked${id}.odata_key FROM ` +
        `(${rendered.sql}) odata_ranked${id} WHERE ${window})`,
      params,
    }
  }

  /**
   * Record the count query of a `$count=true` / `nav/$count` expand item: the parent keys with
   * the number of related rows inside the scope, nested `$filter` and nested `$search`
   * (P1 §11.2.6.5: `$top`/`$skip` do not apply).
   */
  private recordCount(
    item: ExpandItem,
    entityType: EdmEntityType,
    targetEntityType: EdmEntityType,
    path: readonly string[],
  ): void {
    const manager = this.options.manager
    const parent = manager && metadataForType(manager, entityType.name)
    const relation = manager && this.relationOf(manager, entityType, item.navigationProperty)
    if (!manager || !parent || !relation) {
      throw new ODataNotImplementedError(
        `$count inside $expand of '${item.navigationProperty}' is not supported`,
      )
    }
    const id = ++aliasSequence
    const p = `odata_count${id}`
    const c = `${p}_rel`
    const conditions = this.relatedRowConditions(item, targetEntityType, c, path)
    const qb = manager.createQueryBuilder(parent.target, p)
    parent.primaryColumns.forEach((col, i) => {
      if (i === 0) qb.select(`${p}.${col.propertyPath}`, `odata_key${i}`)
      else qb.addSelect(`${p}.${col.propertyPath}`, `odata_key${i}`)
    })
    qb.addSelect('COUNT(*)', 'odata_count')
      .innerJoin(
        `${p}.${relation.propertyPath}`,
        c,
        conditions.length > 0 ? conditions.map((x) => x.sql).join(' AND ') : undefined,
        mergeParams(conditions),
      )
      .groupBy(parent.primaryColumns.map((col) => `${p}.${col.propertyPath}`).join(', '))
    this.expandCounts.push({
      path,
      alias: p,
      keyProperties: parent.primaryColumns.map((col) => col.propertyPath),
      qb,
    })
  }

  /** The TypeORM relation behind a navigation property of an EDM entity type. */
  private relationOf(
    manager: EntityManager,
    entityType: EdmEntityType,
    navigationProperty: string,
  ): RelationMetadata | undefined {
    const metadata: EntityMetadata | undefined = metadataForType(manager, entityType.name)
    return metadata?.findRelationWithPropertyPath(navigationProperty)
  }

  /**
   * Render a nested `$filter` as `<key> IN (SELECT <key> FROM <target> WHERE <filter>)` so it
   * can go in the JOIN condition. Lambdas in it get the scopes of their targets.
   */
  private renderNestedFilter(
    item: ExpandItem,
    targetEntityType: EdmEntityType,
    joinAlias: string,
    path: readonly string[],
  ): { sql: string; params: Readonly<Record<string, unknown>> } {
    const manager = this.options.manager
    const metadata = manager && metadataForType(manager, targetEntityType.name)
    if (!manager || !metadata) {
      throw new ODataValidationError(
        `$filter inside $expand is not supported for '${item.navigationProperty}'`,
        targetEntityType.name,
        '$filter',
      )
    }
    const subAlias = `${joinAlias}_filter`
    const sub = primaryKeyQuery(manager, metadata, subAlias)
    const scopes = this.options.scopes
    new TypeOrmFilterVisitor(
      sub,
      subAlias,
      targetEntityType,
      this.options.maxFilterDepth,
      this.options.dialect,
      manager.getRepository(metadata.target),
      scopes ? (nav) => lookupScope(scopes, 'lambda', [...path, nav]) : undefined,
    ).visit(item.filter!)
    const rendered = renderPrimaryKeyQuery(sub, metadata)
    return {
      sql: scopeInCondition(rendered, (c) => `${joinAlias}.${c.propertyPath}`),
      params: rendered.params,
    }
  }
}
