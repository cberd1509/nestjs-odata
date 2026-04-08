import { Inject, Injectable, Optional } from '@nestjs/common'
import type { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm'
import type {
  IQueryTranslator,
  ODataQuery,
  ODataQueryResult,
  EdmEntityType,
  ODataModuleResolvedOptions,
  ISearchProvider,
} from '@nestjs-odata/core'
import { EdmRegistry, ODATA_MODULE_OPTIONS, SEARCH_PROVIDER } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import { TypeOrmSelectVisitor } from './select-visitor.js'
import { TypeOrmOrderByVisitor } from './orderby-visitor.js'
import { TypeOrmPaginationVisitor } from './pagination-visitor.js'
import { TypeOrmExpandVisitor } from './expand-visitor.js'
import { TypeOrmApplyVisitor } from './apply-visitor.js'
import { applyExpandPagination } from './expand-pagination.js'

/**
 * Translation result from translate() — includes the QueryBuilder and the
 * expandPaginationMap needed for post-JOIN in-memory slicing (D-13).
 * When $apply is present, applyProperties contains the projected column names.
 */
export interface TranslateResult {
  readonly qb: SelectQueryBuilder<ObjectLiteral>
  readonly expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }>
  readonly applyProperties?: string[]
}

/**
 * TypeOrmQueryTranslator — orchestrates all visitor classes to translate
 * an ODataQuery into a TypeORM SelectQueryBuilder, then executes it.
 *
 * Implements IQueryTranslator<SelectQueryBuilder<ObjectLiteral>> — the adapter seam
 * between @nestjs-odata/core query types and TypeORM query building.
 *
 * Visitor application order (deterministic):
 *   1. filter  — WHERE clause (must be first, affects result set)
 *   1.5 search — $search LIKE conditions (additional WHERE)
 *   2. apply   — $apply aggregation pipeline (skips select/orderby/expand)
 *   3. select  — column projection (skipped when $apply present)
 *   4. orderby — sorting (skipped when $apply present)
 *   5. pagination — take/skip
 *   6. expand  — JOINs for navigation properties (skipped when $apply present)
 */
@Injectable()
export class TypeOrmQueryTranslator implements IQueryTranslator<TranslateResult> {
  constructor(
    private readonly repo: Repository<ObjectLiteral>,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Optional() @Inject(SEARCH_PROVIDER) private readonly searchProvider?: ISearchProvider,
  ) {}

  /**
   * Translate an ODataQuery AST into a TypeORM SelectQueryBuilder.
   * Also returns the expandPaginationMap for post-JOIN slicing (D-13).
   * Does not execute the query — call execute() for DB access.
   */
  translate(query: ODataQuery, entityType: EdmEntityType): TranslateResult {
    const alias = 'entity'
    const qb = this.repo.createQueryBuilder(alias)

    const dbType = this.repo.manager.connection.options.type as 'sqlite' | 'postgres' | 'ansi'
    const dialect: 'sqlite' | 'postgres' | 'ansi' =
      dbType === 'sqlite' || dbType === 'postgres' ? dbType : 'ansi'

    // 1. Filter
    if (query.filter) {
      new TypeOrmFilterVisitor(
        qb,
        alias,
        entityType,
        this.options.maxFilterDepth,
        dialect,
        this.repo,
      ).visit(query.filter)
    }

    // 1.5 Search ($search free-text) — applies as additional WHERE clause
    if (query.search && this.searchProvider) {
      const searchResult = this.searchProvider.buildSearchCondition(
        query.search,
        query.entitySetName,
        alias,
      )
      if (searchResult) {
        qb.andWhere(searchResult.condition, searchResult.params)
      }
    }

    // 2. Apply ($apply aggregation pipeline)
    // When $apply is present, skip $select, $orderby, $expand per OData spec
    let applyProperties: string[] | undefined
    if (query.apply) {
      const applyVisitor = new TypeOrmApplyVisitor(
        qb,
        alias,
        entityType,
        this.options.maxFilterDepth,
        dialect,
        this.repo,
      )
      applyProperties = applyVisitor.apply(query.apply)
    }

    if (!query.apply) {
      // 3. Select (skip when $apply present)
      if (query.select) {
        new TypeOrmSelectVisitor(qb, alias, entityType).apply(query.select)
      }

      // 4. OrderBy (skip when $apply present)
      if (query.orderBy?.length) {
        new TypeOrmOrderByVisitor(qb, alias).apply(query.orderBy)
      }
    }

    // 5. Pagination (always applies — works on aggregated results too)
    new TypeOrmPaginationVisitor(qb).paginate(query.top, query.skip)

    // 6. Expand (JOINs — skip when $apply present)
    let expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }> = new Map()
    if (!query.apply && query.expand) {
      const expandVisitor = new TypeOrmExpandVisitor(
        qb,
        this.edmRegistry,
        this.options.maxExpandDepth,
      )
      expandVisitor.apply(query.expand, alias, entityType, 0)
      expandPaginationMap = expandVisitor.expandPaginationMap
    }

    return { qb, expandPaginationMap, applyProperties }
  }

  /**
   * Execute the translated SelectQueryBuilder and return structured results.
   * Applies post-JOIN in-memory expand pagination after getMany() (D-13).
   * When $apply is present, uses getRawMany() to preserve aggregate aliases.
   *
   * @param translateResult - The result from translate() (qb + expandPaginationMap)
   * @param includeCount - If true, uses getManyAndCount() to include total count
   */
  async execute(
    translateResult: TranslateResult | SelectQueryBuilder<ObjectLiteral>,
    includeCount: boolean,
  ): Promise<ODataQueryResult> {
    // Support legacy callers that pass a raw SelectQueryBuilder (backwards compat)
    let qb: SelectQueryBuilder<ObjectLiteral>
    let expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }>
    let applyProperties: string[] | undefined

    if ('qb' in translateResult && 'expandPaginationMap' in translateResult) {
      qb = translateResult.qb
      expandPaginationMap = translateResult.expandPaginationMap
      applyProperties = translateResult.applyProperties
    } else {
      qb = translateResult
      expandPaginationMap = new Map()
    }

    // When $apply is present, use getRawMany() — getMany() drops aggregate aliases
    // (Pitfall 1 from RESEARCH: TypeORM entity hydration strips unknown columns)
    const isAggregated = applyProperties !== undefined

    if (isAggregated) {
      if (includeCount) {
        const items = await qb.getRawMany()
        return { items, count: items.length, isAggregated: true, applyProperties }
      }
      const items = await qb.getRawMany()
      return { items, isAggregated: true, applyProperties }
    }

    if (includeCount) {
      const [items, count] = await qb.getManyAndCount()
      applyExpandPagination(items, expandPaginationMap)
      return { items, count }
    }
    const items = await qb.getMany()
    applyExpandPagination(items, expandPaginationMap)
    return { items }
  }
}
