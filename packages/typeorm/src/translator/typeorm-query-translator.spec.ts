import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { TypeOrmQueryTranslator } from './typeorm-query-translator.js'
import type { Repository, SelectQueryBuilder } from 'typeorm'
import type { ODataQuery, EdmEntityType, EdmRegistry } from '@nestjs-odata/core'

type MockQb = SelectQueryBuilder<never> & {
  andWhere: MockInstance
  select: MockInstance
  orderBy: MockInstance
  addOrderBy: MockInstance
  take: MockInstance
  skip: MockInstance
  getMany: MockInstance
  getManyAndCount: MockInstance
}

type MockRepo = Repository<never> & {
  createQueryBuilder: MockInstance
}

function makeQb(): MockQb {
  return {
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    getManyAndCount: vi.fn().mockResolvedValue([[{ id: 1 }, { id: 2 }], 2]),
  } as unknown as MockQb
}

function makeRepo(qb: MockQb): MockRepo {
  return {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
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

    it('returns the SelectQueryBuilder', () => {
      const query: ODataQuery = { entitySetName: 'Products' }
      const result = translator.translate(query, entityType)
      expect(result).toBe(qb)
    })
  })

  describe('execute()', () => {
    it('calls getMany() when includeCount is false', async () => {
      const result = await translator.execute(qb, false)
      expect(qb.getMany).toHaveBeenCalled()
      expect(qb.getManyAndCount).not.toHaveBeenCalled()
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.count).toBeUndefined()
    })

    it('calls getManyAndCount() when includeCount is true', async () => {
      const result = await translator.execute(qb, true)
      expect(qb.getManyAndCount).toHaveBeenCalled()
      expect(qb.getMany).not.toHaveBeenCalled()
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.count).toBe(2)
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
})
