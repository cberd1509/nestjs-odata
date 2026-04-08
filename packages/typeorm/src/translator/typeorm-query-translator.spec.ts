import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { TypeOrmQueryTranslator } from './typeorm-query-translator.js'
import type { Repository, SelectQueryBuilder } from 'typeorm'
import type { ODataQuery, EdmEntityType, EdmRegistry, BinaryExprNode } from '@nestjs-odata/core'
import { ODataValidationError } from '@nestjs-odata/core'

type MockQb = SelectQueryBuilder<never> & {
  andWhere: MockInstance
  select: MockInstance
  addSelect: MockInstance
  groupBy: MockInstance
  addGroupBy: MockInstance
  orderBy: MockInstance
  addOrderBy: MockInstance
  take: MockInstance
  skip: MockInstance
  getMany: MockInstance
  getManyAndCount: MockInstance
  getRawMany: MockInstance
}

type MockRepo = Repository<never> & {
  createQueryBuilder: MockInstance
}

function makeQb(): MockQb {
  return {
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    addGroupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    setParameter: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    getManyAndCount: vi.fn().mockResolvedValue([[{ id: 1 }, { id: 2 }], 2]),
    getRawMany: vi.fn().mockResolvedValue([]),
  } as unknown as MockQb
}

function makeRepo(qb: MockQb): MockRepo {
  return {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    manager: {
      connection: {
        options: { type: 'sqlite' },
      },
    },
  } as unknown as MockRepo
}

const entityType: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  properties: [
    { name: 'Id', edmType: 'Edm.Int32', isNullable: false, isCollection: false },
    { name: 'Name', edmType: 'Edm.String', isNullable: true, isCollection: false },
    { name: 'Price', edmType: 'Edm.Decimal', isNullable: true, isCollection: false },
  ],
  navigationProperties: [],
  keyProperties: ['Id'],
  isReadOnly: false,
}

describe('TypeOrmQueryTranslator', () => {
  let qb: MockQb
  let repo: MockRepo
  let translator: TypeOrmQueryTranslator

  const mockEdmRegistry: EdmRegistry = {
    getEntityType: vi.fn(),
    getEntitySet: vi.fn(),
    getEntityTypes: vi.fn(),
    getEntitySets: vi.fn(),
    register: vi.fn(),
  } as unknown as EdmRegistry

  const mockOptions = {
    serviceRoot: '/odata',
    namespace: 'Default',
    maxTop: 1000,
    maxExpandDepth: 2,
    maxFilterDepth: 10,
    unmappedTypeStrategy: 'skip' as const,
  }

  beforeEach(() => {
    qb = makeQb()
    repo = makeRepo(qb)
    translator = new TypeOrmQueryTranslator(repo, mockEdmRegistry, mockOptions)
  })

  describe('translate()', () => {
    it('creates query builder with alias entity', () => {
      const query: ODataQuery = { entitySetName: 'Products' }
      translator.translate(query, entityType)
      expect(repo.createQueryBuilder).toHaveBeenCalledWith('entity')
    })

    it('applies filter when query.filter is set', () => {
      const query: ODataQuery = {
        entitySetName: 'Products',
        filter: {
          kind: 'BinaryExpr',
          operator: 'gt',
          left: { kind: 'PropertyAccess', path: ['Price'] },
          right: { kind: 'Literal', literalKind: 'number', value: 5 },
        },
      }
      translator.translate(query, entityType)
      expect(qb.andWhere).toHaveBeenCalled()
    })

    it('applies select when query.select has items', () => {
      const query: ODataQuery = {
        entitySetName: 'Products',
        select: { items: [{ path: ['Name'] }] },
      }
      translator.translate(query, entityType)
      expect(qb.select).toHaveBeenCalled()
    })

    it('applies orderby when query.orderBy has items', () => {
      const query: ODataQuery = {
        entitySetName: 'Products',
        orderBy: [{ expression: { kind: 'PropertyAccess', path: ['Name'] }, direction: 'asc' }],
      }
      translator.translate(query, entityType)
      expect(qb.orderBy).toHaveBeenCalled()
    })

    it('applies pagination when query.top is set', () => {
      const query: ODataQuery = {
        entitySetName: 'Products',
        top: 10,
        skip: 5,
      }
      translator.translate(query, entityType)
      expect(qb.take).toHaveBeenCalledWith(10)
      expect(qb.skip).toHaveBeenCalledWith(5)
    })

    it('returns TranslateResult with qb and expandPaginationMap', () => {
      const query: ODataQuery = { entitySetName: 'Products' }
      const result = translator.translate(query, entityType)
      expect(result.qb).toBe(qb)
      expect(result.expandPaginationMap).toBeInstanceOf(Map)
    })
  })

  describe('execute()', () => {
    it('calls getMany() when includeCount is false (TranslateResult)', async () => {
      const translateResult = { qb, expandPaginationMap: new Map() }
      const result = await translator.execute(translateResult, false)
      expect(qb.getMany).toHaveBeenCalled()
      expect(qb.getManyAndCount).not.toHaveBeenCalled()
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.count).toBeUndefined()
    })

    it('calls getManyAndCount() when includeCount is true (TranslateResult)', async () => {
      const translateResult = { qb, expandPaginationMap: new Map() }
      const result = await translator.execute(translateResult, true)
      expect(qb.getManyAndCount).toHaveBeenCalled()
      expect(qb.getMany).not.toHaveBeenCalled()
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.count).toBe(2)
    })

    it('applies expandPaginationMap after getMany() for post-JOIN slicing (D-13)', async () => {
      const fullItems = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
      qb.getMany.mockResolvedValue(
        fullItems.map((item) => ({ ...item, tags: [{ t: 1 }, { t: 2 }, { t: 3 }] })),
      )
      const paginationMap = new Map([['tags', { top: 2 }]])
      const translateResult = { qb, expandPaginationMap: paginationMap }

      const result = await translator.execute(translateResult, false)

      // Each parent item should have its tags sliced to 2
      for (const item of result.items as Array<{ tags: unknown[] }>) {
        expect(item.tags).toHaveLength(2)
      }
    })
  })

  describe('visitor ordering', () => {
    it('applies visitors in order: filter -> select -> orderby -> pagination', () => {
      const callOrder: string[] = []
      qb.andWhere.mockImplementation(() => {
        callOrder.push('filter')
        return qb
      })
      qb.select.mockImplementation(() => {
        callOrder.push('select')
        return qb
      })
      qb.orderBy.mockImplementation(() => {
        callOrder.push('orderby')
        return qb
      })
      qb.take.mockImplementation(() => {
        callOrder.push('pagination')
        return qb
      })

      const query: ODataQuery = {
        entitySetName: 'Products',
        filter: {
          kind: 'BinaryExpr',
          operator: 'gt',
          left: { kind: 'PropertyAccess', path: ['Price'] },
          right: { kind: 'Literal', literalKind: 'number', value: 5 },
        },
        select: { items: [{ path: ['Name'] }] },
        orderBy: [{ expression: { kind: 'PropertyAccess', path: ['Name'] }, direction: 'asc' }],
        top: 10,
      }
      translator.translate(query, entityType)
      expect(callOrder).toEqual(['filter', 'select', 'orderby', 'pagination'])
    })
  })

  describe('SEC-04: maxFilterDepth forwarding', () => {
    it('passes options.maxFilterDepth to TypeOrmFilterVisitor — custom depth enforced', () => {
      // Build a translator with maxFilterDepth: 2
      const strictOptions = { ...mockOptions, maxFilterDepth: 2 }
      const strictQb = makeQb()
      const strictRepo = makeRepo(strictQb)
      const strictTranslator = new TypeOrmQueryTranslator(
        strictRepo,
        mockEdmRegistry,
        strictOptions,
      )

      // A filter AST with depth 3: (A eq 1) and ((B eq 2) and (C eq 3))
      // Depth=1 at root 'and', depth=2 at inner 'and', depth=3 at inner 'eq' leaves
      const deepFilter: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'and',
        left: {
          kind: 'BinaryExpr',
          operator: 'eq',
          left: { kind: 'PropertyAccess', path: ['Id'] },
          right: { kind: 'Literal', literalKind: 'number', value: 1 },
        },
        right: {
          kind: 'BinaryExpr',
          operator: 'and',
          left: {
            kind: 'BinaryExpr',
            operator: 'eq',
            left: { kind: 'PropertyAccess', path: ['Id'] },
            right: { kind: 'Literal', literalKind: 'number', value: 2 },
          },
          right: {
            kind: 'BinaryExpr',
            operator: 'eq',
            left: { kind: 'PropertyAccess', path: ['Id'] },
            right: { kind: 'Literal', literalKind: 'number', value: 3 },
          },
        },
      }

      const result = () =>
        strictTranslator.translate({ entitySetName: 'Products', filter: deepFilter }, entityType)
      expect(result).toThrow(ODataValidationError)
    })

    it('does NOT throw for filter within configured depth', () => {
      const looseOptions = { ...mockOptions, maxFilterDepth: 10 }
      const looseTranslator = new TypeOrmQueryTranslator(
        makeRepo(makeQb()),
        mockEdmRegistry,
        looseOptions,
      )
      const shallowFilter: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'eq',
        left: { kind: 'PropertyAccess', path: ['Name'] },
        right: { kind: 'Literal', literalKind: 'string', value: 'Alice' },
      }
      expect(() =>
        looseTranslator.translate({ entitySetName: 'Products', filter: shallowFilter }, entityType),
      ).not.toThrow()
    })
  })

  describe('$search integration', () => {
    it('calls searchProvider.buildSearchCondition when query.search is set', () => {
      const mockSearchProvider = {
        buildSearchCondition: vi.fn().mockReturnValue({
          condition: 'entity.name LIKE :s0',
          params: { s0: '%laptop%' },
        }),
      }
      const searchTranslator = new TypeOrmQueryTranslator(
        repo,
        mockEdmRegistry,
        mockOptions,
        mockSearchProvider as never,
      )
      const query: ODataQuery = {
        entitySetName: 'Products',
        search: { kind: 'SearchTerm', value: 'laptop' },
      }
      searchTranslator.translate(query, entityType)
      expect(mockSearchProvider.buildSearchCondition).toHaveBeenCalledWith(
        query.search,
        'Products',
        'entity',
      )
      expect(qb.andWhere).toHaveBeenCalledWith('entity.name LIKE :s0', { s0: '%laptop%' })
    })

    it('skips search when no searchProvider is injected', () => {
      const query: ODataQuery = {
        entitySetName: 'Products',
        search: { kind: 'SearchTerm', value: 'laptop' },
      }
      // Default translator has no searchProvider
      translator.translate(query, entityType)
      // Should not throw — just skips
      expect(qb.andWhere).not.toHaveBeenCalled()
    })

    it('skips search condition when buildSearchCondition returns null', () => {
      const mockSearchProvider = {
        buildSearchCondition: vi.fn().mockReturnValue(null),
      }
      const searchTranslator = new TypeOrmQueryTranslator(
        repo,
        mockEdmRegistry,
        mockOptions,
        mockSearchProvider as never,
      )
      const query: ODataQuery = {
        entitySetName: 'Products',
        search: { kind: 'SearchTerm', value: 'laptop' },
      }
      searchTranslator.translate(query, entityType)
      expect(qb.andWhere).not.toHaveBeenCalled()
    })
  })

  describe('$apply integration', () => {
    it('skips select/orderby/expand when query.apply is present', () => {
      const query: ODataQuery = {
        entitySetName: 'Products',
        select: { items: [{ path: ['Name'] }] },
        orderBy: [{ expression: { kind: 'PropertyAccess', path: ['Name'] }, direction: 'asc' }],
        apply: {
          steps: [
            {
              kind: 'ApplyAggregate',
              expressions: [{ property: 'Price', method: 'sum', alias: 'Total' }],
            },
          ],
        },
      }
      const result = translator.translate(query, entityType)
      // orderby should be skipped when $apply is present
      expect(qb.orderBy).not.toHaveBeenCalled()
      // apply visitor uses addSelect for aggregate columns
      expect(qb.addSelect).toHaveBeenCalled()
      // result should contain applyProperties
      expect(result.applyProperties).toBeDefined()
    })
  })

  describe('execute() aggregated path', () => {
    it('uses getRawMany for aggregated results without count', async () => {
      const getRawManySpy = vi.fn().mockResolvedValue([{ Total: 100 }])
      qb.getRawMany = getRawManySpy as never
      const translateResult = {
        qb,
        expandPaginationMap: new Map(),
        applyProperties: ['Total'],
      }
      const result = await translator.execute(translateResult, false)
      expect(getRawManySpy).toHaveBeenCalled()
      expect(result.isAggregated).toBe(true)
      expect(result.applyProperties).toEqual(['Total'])
      expect(result.items).toEqual([{ Total: 100 }])
    })

    it('uses getRawMany for aggregated results with count', async () => {
      const getRawManySpy = vi.fn().mockResolvedValue([{ Total: 100 }, { Total: 200 }])
      qb.getRawMany = getRawManySpy as never
      const translateResult = {
        qb,
        expandPaginationMap: new Map(),
        applyProperties: ['Total'],
      }
      const result = await translator.execute(translateResult, true)
      expect(getRawManySpy).toHaveBeenCalled()
      expect(result.isAggregated).toBe(true)
      expect(result.count).toBe(2)
    })

    it('supports legacy raw SelectQueryBuilder input', async () => {
      const result = await translator.execute(qb as never, false)
      expect(qb.getMany).toHaveBeenCalled()
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
    })
  })
})
