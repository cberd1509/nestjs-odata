import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { SelectQueryBuilder, ObjectLiteral, Repository, DeleteResult } from 'typeorm'
import type { ODataQuery, EdmEntityType, EdmEntitySet } from '@nestjs-odata/core'
import { EdmRegistry } from '@nestjs-odata/core'
import { NotFoundException } from '@nestjs/common'
import { TypeOrmAutoHandler } from './typeorm-auto-handler.js'
import type { TypeOrmQueryTranslator } from './typeorm-query-translator.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntityType(name: string): EdmEntityType {
  return {
    name,
    namespace: 'Default',
    properties: [
      { name: 'id', type: 'Edm.Int32', nullable: false },
      { name: 'name', type: 'Edm.String', nullable: true },
      { name: 'price', type: 'Edm.Decimal', nullable: false },
    ],
    navigationProperties: [],
    keyProperties: ['id'],
    isReadOnly: false,
  }
}

function makeEntitySet(name: string, typeName: string): EdmEntitySet {
  return { name, entityTypeName: typeName, namespace: 'Default', isReadOnly: false }
}

function makeQuery(overrides: Partial<ODataQuery> = {}): ODataQuery {
  return {
    entitySetName: 'Products',
    ...overrides,
  }
}

function makeOptions(maxTop = 1000) {
  return {
    serviceRoot: '/odata',
    namespace: 'Default',
    maxTop,
    maxExpandDepth: 2,
    unmappedTypeStrategy: 'skip' as const,
  }
}

// ── Mock QueryBuilder ─────────────────────────────────────────────────────────

interface MockQbResult {
  qb: SelectQueryBuilder<ObjectLiteral>
  getMany: MockInstance
  getManyAndCount: MockInstance
  getCount: MockInstance
  take: MockInstance
  skip: MockInstance
}

function makeMockQb(rows: ObjectLiteral[] = [], totalCount = 0): MockQbResult {
  const getManyFn = vi.fn().mockResolvedValue(rows)
  const getManyAndCountFn = vi.fn().mockResolvedValue([rows, totalCount])
  const getCountFn = vi.fn().mockResolvedValue(totalCount)
  const takeFn = vi.fn().mockReturnThis()
  const skipFn = vi.fn().mockReturnThis()

  const qb = {
    take: takeFn,
    skip: skipFn,
    getMany: getManyFn,
    getManyAndCount: getManyAndCountFn,
    getCount: getCountFn,
  } as unknown as SelectQueryBuilder<ObjectLiteral>

  return {
    qb,
    getMany: getManyFn,
    getManyAndCount: getManyAndCountFn,
    getCount: getCountFn,
    take: takeFn,
    skip: skipFn,
  }
}

// ── Mock Repository ───────────────────────────────────────────────────────────

function makeMockRepo() {
  const findOne = vi.fn()
  const create = vi.fn()
  const save = vi.fn()
  const preload = vi.fn()
  const deleteMethod = vi.fn()

  const repo = {
    findOne,
    create,
    save,
    preload,
    delete: deleteMethod,
  } as unknown as Repository<ObjectLiteral>

  return { repo, findOne, create, save, preload, deleteMethod }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TypeOrmAutoHandler', () => {
  let translator: TypeOrmQueryTranslator
  let translateMock: MockInstance
  let executeMock: MockInstance
  let edmRegistry: EdmRegistry
  let autoHandler: TypeOrmAutoHandler
  const entityType = makeEntityType('Product')
  const entitySet = makeEntitySet('Products', 'Product')

  beforeEach(() => {
    translateMock = vi.fn()
    executeMock = vi.fn()
    translator = {
      translate: translateMock,
      execute: executeMock,
    } as unknown as TypeOrmQueryTranslator

    edmRegistry = new EdmRegistry()
    edmRegistry.register(entityType, entitySet)
  })

  describe('handleGet()', () => {
    it('Test 1: calls translator.translate() then execute() and returns ODataQueryResult', async () => {
      const { qb } = makeMockQb([{ id: 1, name: 'Widget' }], 1)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)
      executeMock.mockResolvedValue({ items: [{ id: 1, name: 'Widget' }] })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ filter: undefined, select: undefined })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(translateMock).toHaveBeenCalledWith(
        expect.objectContaining({ entitySetName: 'Products' }),
        entityType,
      )
      expect(result.items).toBeDefined()
    })

    it('Test 2: with $count=true passes includeCount=true to execute() — result has count field', async () => {
      const rows = [{ id: 1 }, { id: 2 }]
      const { qb } = makeMockQb(rows, 2)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)
      executeMock.mockResolvedValue({ items: rows, count: 2 })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ count: true, top: 10 })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(executeMock).toHaveBeenCalledWith(qb, true)
      expect(result.count).toBe(2)
    })

    it('Test 3: with $count=false or undefined passes includeCount=false — result has no count field', async () => {
      const rows = [{ id: 1 }]
      const { qb } = makeMockQb(rows)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)
      executeMock.mockResolvedValue({ items: rows })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ count: undefined, top: 10 })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(executeMock).toHaveBeenCalledWith(qb, false)
      expect(result.count).toBeUndefined()
    })

    it('Test 4: with $top=2, fetches top+1=3 items; when more exist, returns nextLink and slices items to top', async () => {
      // 3 items returned means there are more than 2
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const { qb } = makeMockQb(rows)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)
      executeMock.mockResolvedValue({ items: rows })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ top: 2, skip: 0 })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      // Should have sliced to 2 items only
      expect(result.items).toHaveLength(2)
      // nextLink should be defined
      expect(result.nextLink).toBeDefined()
      expect(result.nextLink).toContain('$skip=2')
    })

    it('Test 5: when results.length <= top, nextLink is undefined (no more pages)', async () => {
      // Only 2 items returned for top=5: no more pages
      const rows = [{ id: 1 }, { id: 2 }]
      const { qb } = makeMockQb(rows)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)
      executeMock.mockResolvedValue({ items: rows })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ top: 5, skip: 0 })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(result.items).toHaveLength(2)
      expect(result.nextLink).toBeUndefined()
    })
  })

  describe('handleCount()', () => {
    it('Test 6: calls translator.translate() with stripped query (filter only) then returns count from qb.getCount()', async () => {
      const { qb, getCount } = makeMockQb([], 42)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({
        top: 5,
        skip: 10,
        filter: {
          kind: 'BinaryExpr',
          op: 'gt',
          left: { kind: 'PropertyAccess', path: ['price'] },
          right: { kind: 'Literal', value: 10 },
        },
      })
      const count = await autoHandler.handleCount(query)

      // translate should be called with a stripped query — no top/skip/orderby/select
      const strippedQuery = translateMock.mock.calls[0]?.[0] as ODataQuery
      expect(strippedQuery.top).toBeUndefined()
      expect(strippedQuery.skip).toBeUndefined()
      expect(strippedQuery.orderBy).toBeUndefined()
      expect(strippedQuery.select).toBeUndefined()
      // filter preserved
      expect(strippedQuery.filter).toBeDefined()

      expect(getCount).toHaveBeenCalled()
      expect(count).toBe(42)
    })

    it('Test 7: ignores $top and $skip in count query (Pitfall 3 — count is always total matching filter)', async () => {
      const { qb, getCount } = makeMockQb([], 100)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(qb)

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ top: 5, skip: 50 })
      const count = await autoHandler.handleCount(query)

      const strippedQuery = translateMock.mock.calls[0]?.[0] as ODataQuery
      expect(strippedQuery.top).toBeUndefined()
      expect(strippedQuery.skip).toBeUndefined()
      expect(getCount).toHaveBeenCalled()
      expect(count).toBe(100)
    })
  })

  describe('handleGetByKey()', () => {
    it('Test 8: returns entity when repo.findOne finds the entity', async () => {
      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue({ id: 42, name: 'Widget' })
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const result = await autoHandler.handleGetByKey('42', 'Products')

      expect(findOne).toHaveBeenCalledWith({ where: { id: 42 } })
      expect(result).toEqual({ id: 42, name: 'Widget' })
    })

    it('Test 9: throws NotFoundException when repo.findOne returns null', async () => {
      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue(null)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      await expect(autoHandler.handleGetByKey('999', 'Products')).rejects.toThrow(NotFoundException)
    })

    it('Test 10: composite key calls repo.findOne with correct multi-field where clause', async () => {
      // Register a composite key entity
      const compositeEntityType: EdmEntityType = {
        name: 'OrderItem',
        namespace: 'Default',
        properties: [
          { name: 'orderId', type: 'Edm.Int32', nullable: false },
          { name: 'itemId', type: 'Edm.Int32', nullable: false },
        ],
        navigationProperties: [],
        keyProperties: ['orderId', 'itemId'],
        isReadOnly: false,
      }
      const compositeEntitySet = makeEntitySet('OrderItems', 'OrderItem')
      edmRegistry.register(compositeEntityType, compositeEntitySet)

      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue({ orderId: 1, itemId: 3 })
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const result = await autoHandler.handleGetByKey('orderId=1,itemId=3', 'OrderItems')

      expect(findOne).toHaveBeenCalledWith({ where: { orderId: 1, itemId: 3 } })
      expect(result).toEqual({ orderId: 1, itemId: 3 })
    })
  })

  describe('handleCreate()', () => {
    it('Test 11: calls repo.create + repo.save and returns entity with locationUrl', async () => {
      const savedEntity = { id: 99, name: 'New Widget', price: 10.0 }
      const { repo, create, save } = makeMockRepo()
      create.mockReturnValue(savedEntity)
      save.mockResolvedValue(savedEntity)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const result = await autoHandler.handleCreate({ name: 'New Widget', price: 10.0 }, 'Products')

      expect(create).toHaveBeenCalledWith({ name: 'New Widget', price: 10.0 })
      expect(save).toHaveBeenCalled()
      expect(result.entity).toEqual(savedEntity)
      expect(result.locationUrl).toBe('/odata/Products(99)')
    })

    it('Test 12: locationUrl format is {serviceRoot}/{entitySetName}({key})', async () => {
      const savedEntity = { id: 7, name: 'Widget' }
      const { repo, create, save } = makeMockRepo()
      create.mockReturnValue(savedEntity)
      save.mockResolvedValue(savedEntity)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const result = await autoHandler.handleCreate({ name: 'Widget' }, 'Products')

      expect(result.locationUrl).toMatch(/^\/odata\/Products\(7\)$/)
    })
  })

  describe('handleUpdate()', () => {
    it('Test 13: calls repo.preload + repo.save and returns merged entity', async () => {
      const mergedEntity = { id: 1, name: 'Updated', price: 20.0 }
      const { repo, preload, save } = makeMockRepo()
      preload.mockResolvedValue(mergedEntity)
      save.mockResolvedValue(mergedEntity)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const result = await autoHandler.handleUpdate(
        '1',
        { name: 'Updated', price: 20.0 },
        'Products',
      )

      expect(preload).toHaveBeenCalledWith({ id: 1, name: 'Updated', price: 20.0 })
      expect(save).toHaveBeenCalledWith(mergedEntity)
      expect(result).toEqual(mergedEntity)
    })

    it('Test 14: throws NotFoundException when repo.preload returns undefined (entity not found)', async () => {
      const { repo, preload } = makeMockRepo()
      preload.mockResolvedValue(undefined)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      await expect(autoHandler.handleUpdate('999', { name: 'Ghost' }, 'Products')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('handleDelete()', () => {
    it('Test 15: calls repo.delete with correct where clause and returns void on success', async () => {
      const { repo, deleteMethod } = makeMockRepo()
      deleteMethod.mockResolvedValue({ affected: 1 } as DeleteResult)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      await expect(autoHandler.handleDelete('1', 'Products')).resolves.toBeUndefined()
      expect(deleteMethod).toHaveBeenCalledWith({ id: 1 })
    })

    it('Test 16: throws NotFoundException when repo.delete returns affected=0', async () => {
      const { repo, deleteMethod } = makeMockRepo()
      deleteMethod.mockResolvedValue({ affected: 0 } as DeleteResult)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      await expect(autoHandler.handleDelete('999', 'Products')).rejects.toThrow(NotFoundException)
    })
  })
})
