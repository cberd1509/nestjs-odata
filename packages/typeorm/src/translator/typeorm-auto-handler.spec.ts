import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type {
  SelectQueryBuilder,
  ObjectLiteral,
  Repository,
  DeleteResult,
  EntityManager,
  DataSource,
} from 'typeorm'
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

interface MockColumnMetadata {
  propertyName: string
  isPrimary?: boolean
  isNullable?: boolean
  isCreateDate?: boolean
  isUpdateDate?: boolean
  isVersion?: boolean
  default?: unknown
}

function makeMockRepo(columns: MockColumnMetadata[] = []) {
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
    metadata: { columns },
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

  /** Helper to create a TranslateResult mock from a qb */
  function makeTranslateResult(qb: SelectQueryBuilder<ObjectLiteral>) {
    return { qb, expandPaginationMap: new Map<string, { skip?: number; top?: number }>() }
  }

  describe('handleGet()', () => {
    it('Test 1: calls translator.translate() then execute() and returns ODataQueryResult', async () => {
      const { qb } = makeMockQb([{ id: 1, name: 'Widget' }], 1)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(makeTranslateResult(qb))
      executeMock.mockResolvedValue({ items: [{ id: 1, name: 'Widget' }] })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ filter: undefined, select: undefined })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(translateMock).toHaveBeenCalledWith(
        expect.objectContaining({ entitySetName: 'Products' }),
        entityType,
        // Third arg is the per-request Repository resolved from entitySetName.
        // In the unit fixture there's no DataSource so it falls back to the
        // injected default repo.
        expect.anything(),
      )
      expect(result.items).toBeDefined()
    })

    it('Test 2: with $count=true passes includeCount=true to execute() — result has count field', async () => {
      const rows = [{ id: 1 }, { id: 2 }]
      const { qb } = makeMockQb(rows, 2)
      const { repo } = makeMockRepo()
      const translateResult = makeTranslateResult(qb)
      translateMock.mockReturnValue(translateResult)
      executeMock.mockResolvedValue({ items: rows, count: 2 })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ count: true, top: 10 })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(executeMock).toHaveBeenCalledWith(translateResult, true)
      expect(result.count).toBe(2)
    })

    it('Test 3: with $count=false or undefined passes includeCount=false — result has no count field', async () => {
      const rows = [{ id: 1 }]
      const { qb } = makeMockQb(rows)
      const { repo } = makeMockRepo()
      const translateResult = makeTranslateResult(qb)
      translateMock.mockReturnValue(translateResult)
      executeMock.mockResolvedValue({ items: rows })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ count: undefined, top: 10 })
      const result = await autoHandler.handleGet(query, 'http://localhost/odata/Products')

      expect(executeMock).toHaveBeenCalledWith(translateResult, false)
      expect(result.count).toBeUndefined()
    })

    it('Test 4: with $top=2, fetches top+1=3 items; when more exist, returns nextLink and slices items to top', async () => {
      // 3 items returned means there are more than 2
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const { qb } = makeMockQb(rows)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(makeTranslateResult(qb))
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
      translateMock.mockReturnValue(makeTranslateResult(qb))
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
      translateMock.mockReturnValue(makeTranslateResult(qb))

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
      translateMock.mockReturnValue(makeTranslateResult(qb))

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

  describe('buildNextLink()', () => {
    it('Test 17: builds nextLink with no existing query string', () => {
      const { repo } = makeMockRepo()
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const nextLink = autoHandler.buildNextLink('http://localhost/odata/Products', 10, 5)

      expect(nextLink).toBe('http://localhost/odata/Products?$skip=10&$top=5')
    })

    it('Test 18: builds nextLink preserving existing query params and updating $skip/$top', () => {
      const { repo } = makeMockRepo()
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      const nextLink = autoHandler.buildNextLink(
        'http://localhost/odata/Products?$filter=name%20eq%20%27Widget%27&$top=5&$skip=0',
        5,
        5,
      )

      expect(nextLink).toContain('$skip=5')
      expect(nextLink).toContain('$top=5')
      expect(nextLink).toContain('$filter=')
    })

    it('Test 19: handleGet with URL containing existing query string builds correct nextLink', async () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const { qb } = makeMockQb(rows)
      const { repo } = makeMockRepo()
      translateMock.mockReturnValue(makeTranslateResult(qb))
      executeMock.mockResolvedValue({ items: rows })

      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)
      const query = makeQuery({ top: 2, skip: 0 })
      const result = await autoHandler.handleGet(
        query,
        'http://localhost/odata/Products?$top=2&$skip=0',
      )

      expect(result.nextLink).toBeDefined()
      expect(result.nextLink).toContain('$skip=2')
    })
  })

  // --- ETag / If-Match / If-None-Match tests (Task 2 of Phase 09-02) ---

  describe('handleUpdate() with If-Match', () => {
    it('Test E1: handleUpdate with matching If-Match succeeds', async () => {
      const entity = { id: 1, name: 'Widget', updatedAt: new Date('2024-01-01T00:00:00Z') }
      const { repo, findOne, preload, save } = makeMockRepo()
      findOne.mockResolvedValue(entity)
      preload.mockResolvedValue({ ...entity, name: 'Updated' })
      save.mockResolvedValue({ ...entity, name: 'Updated' })

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue('updatedAt'),
        computeETag: vi.fn().mockReturnValue('W/"dXBkYXRlZEF0"'),
        validateIfMatch: vi.fn().mockReturnValue(true),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )
      const result = await autoHandler.handleUpdate(
        '1',
        { name: 'Updated' },
        'Products',
        'W/"dXBkYXRlZEF0"',
      )

      expect(etagProvider.validateIfMatch).toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('Test E2: handleUpdate with stale If-Match throws PreconditionFailedException (412)', async () => {
      const entity = { id: 1, name: 'Widget', updatedAt: new Date('2024-01-01T00:00:00Z') }
      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue(entity)

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue('updatedAt'),
        computeETag: vi.fn().mockReturnValue('W/"current"'),
        validateIfMatch: vi.fn().mockReturnValue(false),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )

      await expect(
        autoHandler.handleUpdate('1', { name: 'Updated' }, 'Products', 'W/"stale"'),
      ).rejects.toMatchObject({ status: 412 })
    })

    it('Test E3: handleUpdate without If-Match header on ETag-enabled entity proceeds (no enforcement)', async () => {
      const entity = { id: 1, name: 'Widget' }
      const { repo, preload, save } = makeMockRepo()
      preload.mockResolvedValue(entity)
      save.mockResolvedValue({ ...entity, name: 'Updated' })

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue('updatedAt'),
        computeETag: vi.fn(),
        validateIfMatch: vi.fn(),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )
      // No ifMatchHeader provided
      const result = await autoHandler.handleUpdate('1', { name: 'Updated' }, 'Products')

      // validateIfMatch should NOT be called when no header
      expect(etagProvider.validateIfMatch).not.toHaveBeenCalled()
      expect(result).toBeDefined()
    })
  })

  describe('handleDelete() with If-Match', () => {
    it('Test E4: handleDelete with stale If-Match throws PreconditionFailedException (412)', async () => {
      const entity = { id: 1, name: 'Widget' }
      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue(entity)

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue('updatedAt'),
        computeETag: vi.fn().mockReturnValue('W/"current"'),
        validateIfMatch: vi.fn().mockReturnValue(false),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )

      await expect(autoHandler.handleDelete('1', 'Products', 'W/"stale"')).rejects.toMatchObject({
        status: 412,
      })
    })
  })

  describe('handleReplace()', () => {
    // Columns used for the Product entity in replace tests
    const replaceColumns: MockColumnMetadata[] = [
      { propertyName: 'id', isPrimary: true },
      { propertyName: 'name', isNullable: true },
      { propertyName: 'price', isNullable: false },
      { propertyName: 'category', isNullable: true },
      { propertyName: 'status', isNullable: false, default: 'active' },
    ]

    it('Test R1: resets nullable unspecified fields to null', async () => {
      const existing = {
        id: 1,
        name: 'Widget',
        price: 10,
        category: 'electronics',
        status: 'active',
      }
      const { repo, findOne, create, save } = makeMockRepo(replaceColumns)
      findOne.mockResolvedValue(existing)
      create.mockImplementation((v: ObjectLiteral) => v)
      save.mockResolvedValue({ id: 1, name: null, price: 20, category: null, status: 'active' })
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      // Omit `name` and `category` (both nullable) — they should reset to null
      const result = await autoHandler.handleReplace('1', { price: 20 }, 'Products')

      // create() should be called with name=null, category=null (nullable reset)
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: null, category: null, price: 20, id: 1 }),
      )
      expect(result).toBeDefined()
    })

    it('Test R2: resets fields with column defaults to their default value when omitted from body', async () => {
      const existing = { id: 1, name: 'Widget', price: 10, status: 'shipped' }
      const { repo, findOne, create, save } = makeMockRepo(replaceColumns)
      findOne.mockResolvedValue(existing)
      create.mockImplementation((v: ObjectLiteral) => v)
      save.mockResolvedValue({ id: 1, name: null, price: 99, status: 'active' })
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      // Omit `status` — it has default='active', should reset
      const result = await autoHandler.handleReplace('1', { price: 99 }, 'Products')

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', price: 99, id: 1 }),
      )
      expect(result).toBeDefined()
    })

    it('Test R3: body key mismatch returns 400 HttpException', async () => {
      const { repo, findOne } = makeMockRepo(replaceColumns)
      findOne.mockResolvedValue({ id: 1, name: 'Widget', price: 10 })
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      // body has id=2 but URL key is 1 — should reject
      await expect(
        autoHandler.handleReplace('1', { id: 2, price: 50 }, 'Products'),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('Test R4: throws NotFoundException when entity does not exist', async () => {
      const { repo, findOne } = makeMockRepo(replaceColumns)
      findOne.mockResolvedValue(null)
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      await expect(autoHandler.handleReplace('99999', { price: 50 }, 'Products')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('Test R5: ETag mismatch returns 412 HttpException', async () => {
      const entity = { id: 1, name: 'Widget', price: 10, updatedAt: new Date() }
      const { repo, findOne } = makeMockRepo(replaceColumns)
      findOne.mockResolvedValue(entity)

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue('updatedAt'),
        computeETag: vi.fn().mockReturnValue('W/"current"'),
        validateIfMatch: vi.fn().mockReturnValue(false),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )

      await expect(
        autoHandler.handleReplace('1', { price: 50 }, 'Products', 'W/"stale"'),
      ).rejects.toMatchObject({ status: 412 })
    })

    it('Test R6: skips isPrimary columns when building replacement (key comes from URL)', async () => {
      const existing = { id: 1, price: 10 }
      const { repo, findOne, create, save } = makeMockRepo(replaceColumns)
      findOne.mockResolvedValue(existing)
      create.mockImplementation((v: ObjectLiteral) => v)
      save.mockResolvedValue({ id: 1, price: 50 })
      autoHandler = new TypeOrmAutoHandler(translator, edmRegistry, makeOptions(), repo)

      await autoHandler.handleReplace('1', { price: 50 }, 'Products')

      // The key (id) must be set from URL, but create() must NOT receive id from column iteration
      // (it should receive id from the explicit where assignment)
      const callArg = (create.mock.calls[0] as [ObjectLiteral])[0]
      expect(callArg['id']).toBe(1)
    })
  })

  describe('handleDeepCreate()', () => {
    // Entity type with a navigation property 'items' -> 'OrderItem'
    const orderEntityType: EdmEntityType = {
      name: 'Order',
      namespace: 'Default',
      properties: [
        { name: 'id', type: 'Edm.Int32', nullable: false },
        { name: 'totalAmount', type: 'Edm.Decimal', nullable: false },
        { name: 'status', type: 'Edm.String', nullable: false },
      ],
      navigationProperties: [
        { name: 'items', type: 'Default.OrderItem', nullable: false, isCollection: true },
      ],
      keyProperties: ['id'],
      isReadOnly: false,
    }
    const orderItemEntityType: EdmEntityType = {
      name: 'OrderItem',
      namespace: 'Default',
      properties: [
        { name: 'id', type: 'Edm.Int32', nullable: false },
        { name: 'quantity', type: 'Edm.Int32', nullable: false },
        { name: 'orderId', type: 'Edm.Int32', nullable: false },
      ],
      navigationProperties: [],
      keyProperties: ['id'],
      isReadOnly: false,
    }
    const orderEntitySet: EdmEntitySet = {
      name: 'Orders',
      entityTypeName: 'Order',
      namespace: 'Default',
      isReadOnly: false,
    }
    const orderItemEntitySet: EdmEntitySet = {
      name: 'OrderItems',
      entityTypeName: 'OrderItem',
      namespace: 'Default',
      isReadOnly: false,
    }

    function makeDeepRegistry(): EdmRegistry {
      const reg = new EdmRegistry()
      reg.register(orderEntityType, orderEntitySet)
      reg.register(orderItemEntityType, orderItemEntitySet)
      return reg
    }

    it('Test D1: saves parent and returns entity with locationUrl when no nav props in body', async () => {
      const saved = { id: 42, totalAmount: 100, status: 'new' }
      const { repo, create, save } = makeMockRepo()
      create.mockReturnValue(saved)
      save.mockResolvedValue(saved)

      const deepReg = makeDeepRegistry()
      autoHandler = new TypeOrmAutoHandler(translator, deepReg, makeOptions(), repo)

      // Use a manager that delegates to the same repo
      const managerRepo = { create: create, save: save }
      const manager = {
        getRepository: vi.fn().mockReturnValue(managerRepo),
      } as unknown as EntityManager

      const result = await autoHandler.handleDeepCreate(
        { totalAmount: 100, status: 'new' },
        'Orders',
        manager,
      )

      expect(create).toHaveBeenCalledWith({ totalAmount: 100, status: 'new' })
      expect(save).toHaveBeenCalled()
      expect((result.entity as { id: number }).id).toBe(42)
      expect(result.locationUrl).toBe('/odata/Orders(42)')
    })

    it('Test D2: saves parent then child with injected FK when nav prop present', async () => {
      const savedParent = { id: 10, totalAmount: 200, status: 'new' }
      const childItem = { quantity: 2, unitPrice: 50, productId: 1 }

      const parentCreate = vi.fn().mockReturnValue(savedParent)
      const parentSave = vi.fn().mockResolvedValue(savedParent)
      const childCreate = vi.fn().mockReturnValue({ ...childItem, orderId: 10 })
      const childSave = vi.fn().mockResolvedValue({ id: 1, ...childItem, orderId: 10 })

      const parentRepo = { create: parentCreate, save: parentSave }
      const childRepo = { create: childCreate, save: childSave }

      let callCount = 0
      const getRepository = vi.fn().mockImplementation(() => {
        callCount++
        return callCount === 1 ? parentRepo : childRepo
      })

      const manager = { getRepository } as unknown as EntityManager

      // Mock DataSource that resolves OrderItem class
      const mockOrderItemMeta = { name: 'OrderItem', target: class OrderItem {} }
      const mockDataSource = {
        getMetadata: vi.fn().mockReturnValue({
          relations: [
            {
              propertyName: 'items',
              inverseRelation: { joinColumns: [{ propertyName: 'orderId' }] },
            },
          ],
        }),
        entityMetadatas: [mockOrderItemMeta],
      } as unknown as DataSource

      const deepReg = makeDeepRegistry()
      const { repo } = makeMockRepo()
      autoHandler = new TypeOrmAutoHandler(
        translator,
        deepReg,
        makeOptions(),
        repo,
        undefined,
        mockDataSource,
      )

      const result = await autoHandler.handleDeepCreate(
        { totalAmount: 200, status: 'new', items: [childItem] },
        'Orders',
        manager,
      )

      expect(parentSave).toHaveBeenCalled()
      // Child should have been saved with orderId=10 injected
      expect(childCreate).toHaveBeenCalledWith(expect.objectContaining({ orderId: 10 }))
      expect(result.locationUrl).toBe('/odata/Orders(10)')
    })

    it('Test D3: throws 400 when depth >= maxDeepInsertDepth', async () => {
      const deepReg = makeDeepRegistry()
      const { repo } = makeMockRepo()
      const options = { ...makeOptions(), maxDeepInsertDepth: 2 }
      autoHandler = new TypeOrmAutoHandler(translator, deepReg, options, repo)

      const manager = { getRepository: vi.fn() } as unknown as EntityManager

      await expect(
        autoHandler.handleDeepCreate({ totalAmount: 100 }, 'Orders', manager, 2),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('Test D4: wraps child errors with navigation path context', async () => {
      const savedParent = { id: 5, totalAmount: 100, status: 'new' }
      const parentCreate = vi.fn().mockReturnValue(savedParent)
      const parentSave = vi.fn().mockResolvedValue(savedParent)
      const childCreate = vi.fn().mockReturnValue({})
      const childSave = vi.fn().mockRejectedValue(new Error('FK constraint violation'))

      const parentRepo = { create: parentCreate, save: parentSave }
      const childRepo = { create: childCreate, save: childSave }

      let callCount = 0
      const getRepository = vi.fn().mockImplementation(() => {
        callCount++
        return callCount === 1 ? parentRepo : childRepo
      })
      const manager = { getRepository } as unknown as EntityManager

      const mockOrderItemMeta = { name: 'OrderItem', target: class OrderItem {} }
      const mockDataSource = {
        getMetadata: vi.fn().mockReturnValue({
          relations: [
            {
              propertyName: 'items',
              inverseRelation: { joinColumns: [{ propertyName: 'orderId' }] },
            },
          ],
        }),
        entityMetadatas: [mockOrderItemMeta],
      } as unknown as DataSource

      const deepReg = makeDeepRegistry()
      const { repo } = makeMockRepo()
      autoHandler = new TypeOrmAutoHandler(
        translator,
        deepReg,
        makeOptions(),
        repo,
        undefined,
        mockDataSource,
      )

      const error = await autoHandler
        .handleDeepCreate(
          { totalAmount: 100, status: 'new', items: [{ quantity: 2 }] },
          'Orders',
          manager,
        )
        .catch((e: unknown) => e)

      expect((error as { status: number }).status).toBe(400)
      const body = (error as { response: { error: { message: string } } }).response.error.message
      expect(body).toContain('items[0]')
      expect(body).toContain('FK constraint violation')
    })
  })

  describe('handleGetByKey() with If-None-Match', () => {
    it('Test E5: handleGetByKey with matching If-None-Match returns { __notModified: true, etag }', async () => {
      const entity = { id: 1, name: 'Widget', updatedAt: new Date('2024-01-01T00:00:00Z') }
      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue(entity)

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue('updatedAt'),
        computeETag: vi.fn().mockReturnValue('W/"abc"'),
        validateIfMatch: vi.fn().mockReturnValue(true),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )
      const result = (await autoHandler.handleGetByKey('1', 'Products', 'W/"abc"')) as Record<
        string,
        unknown
      >

      expect(result['__notModified']).toBe(true)
      expect(result['etag']).toBe('W/"abc"')
    })

    it('Test E6: handleGetByKey without ETag column returns entity normally', async () => {
      const entity = { id: 1, name: 'Widget' }
      const { repo, findOne } = makeMockRepo()
      findOne.mockResolvedValue(entity)

      const etagProvider = {
        getETagColumn: vi.fn().mockReturnValue(undefined),
        computeETag: vi.fn(),
        validateIfMatch: vi.fn(),
      }

      autoHandler = new TypeOrmAutoHandler(
        translator,
        edmRegistry,
        makeOptions(),
        repo,
        etagProvider,
      )
      const result = await autoHandler.handleGetByKey('1', 'Products', 'W/"anything"')

      // Should return entity normally (no __notModified)
      expect(result).toEqual(entity)
    })
  })
})
