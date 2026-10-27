import type { SelectQueryBuilder, ObjectLiteral, EntityManager } from 'typeorm'
import type { ExpandNode, ExpandItem, EdmEntityType } from '@nestjs-odata/core'
import { navigationTargetTypeName, ODataValidationError } from '@nestjs-odata/core'
import type { EdmRegistry } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import { TypeOrmOrderByVisitor } from './orderby-visitor.js'
import { TypeOrmSelectVisitor } from './select-visitor.js'
import type { TypeOrmScopePlan } from '../scope/scope.types.js'
import {
  lookupScope,
  metadataForType,
  primaryKeyQuery,
  renderPrimaryKeyQuery,
  scopeInCondition,
} from '../scope/typeorm-scope.service.js'

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
  readonly dialect?: 'sqlite' | 'postgres' | 'ansi'
}

/**
 * TypeOrmExpandVisitor — translates $expand AST nodes into TypeORM
 * leftJoinAndSelect calls. Supports nested expand with depth tracking.
 *
 * Per D-09: Uses JOINs, NOT lazy loading — one SQL query.
 * Per D-07: Enforces maxExpandDepth.
 * Per D-10: Validates navigation property names against EDM.
 * Per D-13: Records $top/$skip per expand item in expandPaginationMap for
 *   post-JOIN in-memory slicing by TypeOrmQueryTranslator after getMany().
 *
 * Alias convention: `{parentAlias}_{navigationProperty}` — unique per level
 * to prevent TypeORM alias collision when the same nav prop appears at
 * different tree paths.
 */
export class TypeOrmExpandVisitor {
  /**
   * Records per-navigation-property $top/$skip values for post-JOIN slicing.
   * Populated during apply() calls. Consumed by TypeOrmQueryTranslator after
   * getMany() via applyExpandPagination().
   */
  readonly expandPaginationMap = new Map<string, { skip?: number; top?: number }>()

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

    // JOIN condition: the target's row-level scope and the nested $filter. Both restrict
    // which related rows are expanded, never which parent rows are returned.
    const conditions: string[] = []
    const params: Record<string, unknown> = {}
    const scopes = this.options.scopes
    const scoped = scopes ? lookupScope(scopes, 'expand', path) : undefined
    if (scoped) {
      conditions.push(scopeInCondition(scoped, (c) => `${joinAlias}.${c.propertyPath}`))
      Object.assign(params, scoped.params)
    }
    if (item.filter && targetEntityType) {
      const nested = this.renderNestedFilter(item, targetEntityType, joinAlias, path)
      conditions.push(nested.sql)
      Object.assign(params, nested.params)
    }
    const condition = conditions.length > 0 ? conditions.join(' AND ') : undefined

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
      new TypeOrmOrderByVisitor(this.qb, joinAlias).apply(item.orderBy)
    }

    // Per D-13: Record $top/$skip for post-JOIN in-memory slicing after getMany().
    // Only collections can be paginated — single-valued nav props are not arrays.
    if ((item.top !== undefined || item.skip !== undefined) && navProp.isCollection) {
      this.expandPaginationMap.set(item.navigationProperty, {
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
