import { Inject, Injectable } from '@nestjs/common'
import type { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm'
import type {
  IQueryTranslator,
  ODataQuery,
  ODataQueryResult,
  EdmEntityType,
  ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import { EdmRegistry, ODATA_MODULE_OPTIONS } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import { TypeOrmSelectVisitor } from './select-visitor.js'
import { TypeOrmOrderByVisitor } from './orderby-visitor.js'
import { TypeOrmPaginationVisitor } from './pagination-visitor.js'
import { TypeOrmExpandVisitor } from './expand-visitor.js'
import { applyExpandPagination } from './expand-pagination.js'

/**
 * Translation result from translate() — includes the QueryBuilder and the
 * expandPaginationMap needed for post-JOIN in-memory slicing (D-13).
 */
export interface TranslateResult {
  readonly qb: SelectQueryBuilder<ObjectLiteral>
  readonly expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }>
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
 *   2. select  — column projection
 *   3. orderby — sorting
 *   4. pagination — take/skip
 *   5. expand  — JOINs for navigation properties
 */
@Injectable()
export class TypeOrmQueryTranslator implements IQueryTranslator<SelectQueryBuilder<ObjectLiteral>> {
  constructor(
    private readonly repo: Repository<ObjectLiteral>,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
  ) {}

  /**
   * Translate an ODataQuery AST into a TypeORM SelectQueryBuilder.
   * Also returns the expandPaginationMap for post-JOIN slicing (D-13).
   * Does not execute the query — call execute() for DB access.
   */
  translate(query: ODataQuery, entityType: EdmEntityType): TranslateResult {
    const alias = 'entity'
    const qb = this.repo.createQueryBuilder(alias)

    // 1. Filter
    if (query.filter) {
      new TypeOrmFilterVisitor(qb, alias, entityType, this.options.maxFilterDepth).visit(
        query.filter,
      )
    }

    // 2. Select
    if (query.select) {
      new TypeOrmSelectVisitor(qb, alias, entityType).apply(query.select)
    }

    // 3. OrderBy
    if (query.orderBy?.length) {
      new TypeOrmOrderByVisitor(qb, alias).apply(query.orderBy)
    }

    // 4. Pagination
    new TypeOrmPaginationVisitor(qb).paginate(query.top, query.skip)

    // 5. Expand (JOINs for navigation properties)
    let expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }> = new Map()
    if (query.expand) {
      const expandVisitor = new TypeOrmExpandVisitor(
        qb,
        this.edmRegistry,
        this.options.maxExpandDepth,
      )
      expandVisitor.apply(query.expand, alias, entityType, 0)
      expandPaginationMap = expandVisitor.expandPaginationMap
    }

    return { qb, expandPaginationMap }
  }

  /**
   * Execute the translated SelectQueryBuilder and return structured results.
   * Applies post-JOIN in-memory expand pagination after getMany() (D-13).
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

    if ('qb' in translateResult && 'expandPaginationMap' in translateResult) {
      qb = translateResult.qb
      expandPaginationMap = translateResult.expandPaginationMap
    } else {
      qb = translateResult
      expandPaginationMap = new Map()
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
