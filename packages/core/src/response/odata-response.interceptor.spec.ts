import 'reflect-metadata'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { of, firstValueFrom } from 'rxjs'
import type { ExecutionContext, CallHandler } from '@nestjs/common'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { EdmRegistry } from '../edm/edm-registry.js'
import { ODataResponseInterceptor } from './odata-response.interceptor.js'

interface MockCallHandler {
  handle: MockInstance
}

function makeContext(): ExecutionContext {
  return {
    getHandler: vi.fn().mockReturnValue({}),
    switchToHttp: vi.fn(),
  } as unknown as ExecutionContext
}

function makeReflector(meta: unknown) {
  return {
    get: vi.fn().mockReturnValue(meta),
  }
}

const resolvedOptions: ODataModuleResolvedOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 1000,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
}

/** Create a mock EdmRegistry that returns no entity set/type (graceful degradation path). */
function makeEmptyEdmRegistry(): EdmRegistry {
  return {
    getEntitySet: vi.fn().mockReturnValue(undefined),
    getEntityType: vi.fn().mockReturnValue(undefined),
    register: vi.fn(),
    getEntityTypes: vi.fn().mockReturnValue(new Map()),
    getEntitySets: vi.fn().mockReturnValue(new Map()),
    setEntitySecurityOptions: vi.fn(),
    getEntitySecurityOptions: vi.fn().mockReturnValue(undefined),
  } as unknown as EdmRegistry
}

/** Create a mock EdmRegistry with a known Products entity. */
function makeProductsEdmRegistry(): EdmRegistry {
  const entitySet = {
    name: 'Products',
    entityTypeName: 'Product',
    namespace: 'Default',
    isReadOnly: false,
  }
  const entityType = {
    name: 'Product',
    namespace: 'Default',
    properties: [],
    navigationProperties: [
      { name: 'category', type: 'Default.Category', nullable: true, isCollection: false },
    ],
    keyProperties: ['id'],
    isReadOnly: false,
  }
  return {
    getEntitySet: vi.fn().mockReturnValue(entitySet),
    getEntityType: vi.fn().mockReturnValue(entityType),
    register: vi.fn(),
    getEntityTypes: vi.fn().mockReturnValue(new Map()),
    getEntitySets: vi.fn().mockReturnValue(new Map()),
    setEntitySecurityOptions: vi.fn(),
    getEntitySecurityOptions: vi.fn().mockReturnValue(undefined),
  } as unknown as EdmRegistry
}

describe('ODataResponseInterceptor', () => {
  let mockHandler: MockCallHandler
  let handler: CallHandler

  beforeEach(() => {
    mockHandler = { handle: vi.fn() }
    handler = mockHandler as unknown as CallHandler
  })

  it('Test 5: wraps ODataQueryResult into OData envelope with @odata.count', async () => {
    const result = { items: [{ id: 1 }], count: 5 }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).toMatchObject({
      '@odata.context': '/odata/$metadata#Products',
      value: [{ id: 1 }],
      '@odata.count': 5,
    })
  })

  it('Test 6: omits @odata.count key when count is undefined', async () => {
    const result = { items: [{ id: 1 }] }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).not.toHaveProperty('@odata.count')
  })

  it('Test 7: includes @odata.nextLink when present', async () => {
    const result = { items: [], nextLink: 'http://odata/Products?$skip=10' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).toHaveProperty('@odata.nextLink', 'http://odata/Products?$skip=10')
  })

  it('Test 7b: omits @odata.nextLink when undefined', async () => {
    const result = { items: [] }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).not.toHaveProperty('@odata.nextLink')
  })

  it('Test 8: passes through unchanged when route does NOT have ODATA_ROUTE_KEY metadata', async () => {
    const rawResult = { some: 'data' }
    mockHandler.handle.mockReturnValue(of(rawResult))
    const reflector = makeReflector(undefined) // no metadata
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).toBe(rawResult)
  })

  it('Test 9: includes select projection in @odata.context when select has items', async () => {
    const result = {
      items: [],
      select: { items: [{ path: ['Name'] }, { path: ['Price'] }] },
    }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    expect(resp['@odata.context']).toBe('/odata/$metadata#Products(Name,Price)')
  })

  it('Test 10: returns single entity at top level with /$entity context when isSingleEntity=true', async () => {
    const result = { id: 1, name: 'Widget' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', isSingleEntity: true })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    expect(resp['@odata.context']).toBe('/odata/$metadata#Products/$entity')
    expect(resp['id']).toBe(1)
    expect(resp['name']).toBe('Widget')
    expect(resp).not.toHaveProperty('value')
  })

  it('Test 11: context URL ends with /$entity for single-entity responses', async () => {
    const result = { id: 42 }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({
      entitySetName: 'Orders',
      operation: 'getByKey',
      isSingleEntity: true,
    })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    expect(resp['@odata.context']).toMatch(/\/\$entity$/)
  })

  it('Test 12: create operation sets Location header on response', async () => {
    const setHeader = vi.fn()
    const result = { entity: { id: 5, name: 'New' }, locationUrl: '/odata/Products(5)' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', operation: 'create' })
    const ctx = {
      getHandler: vi.fn().mockReturnValue({}),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ setHeader }),
      }),
    } as unknown as ExecutionContext
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    expect(setHeader).toHaveBeenCalledWith('Location', '/odata/Products(5)')
    expect(resp['@odata.context']).toBe('/odata/$metadata#Products/$entity')
    expect(resp['id']).toBe(5)
    expect(resp['name']).toBe('New')
  })

  it('Test 13: collection response still wraps in value array when isSingleEntity is not set', async () => {
    const result = { items: [{ id: 1 }, { id: 2 }] }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    expect(resp).toHaveProperty('value')
    expect(resp['value']).toEqual([{ id: 1 }, { id: 2 }])
    expect(resp['@odata.context']).toBe('/odata/$metadata#Products')
  })

  // --- NEW: Annotation tests (Task 2 of Phase 09-01) ---

  it('Test A1: single entity response (isSingleEntity=true) — includes @odata.id, @odata.type, @odata.navigationLink', async () => {
    const result = { id: 1, name: 'Laptop' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', isSingleEntity: true })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >

    expect(resp['@odata.id']).toBe('/odata/Products(1)')
    expect(resp['@odata.type']).toBe('#Default.Product')
    expect(resp['category@odata.navigationLink']).toBe('/odata/Products(1)/category')
    // Original fields preserved
    expect(resp['id']).toBe(1)
    expect(resp['name']).toBe('Laptop')
  })

  it('Test A2: collection response — each item in value[] has annotations', async () => {
    const result = {
      items: [
        { id: 1, name: 'Laptop' },
        { id: 2, name: 'Phone' },
      ],
    }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    const items = resp['value'] as Record<string, unknown>[]

    expect(items).toHaveLength(2)
    expect(items[0]['@odata.id']).toBe('/odata/Products(1)')
    expect(items[0]['@odata.type']).toBe('#Default.Product')
    expect(items[1]['@odata.id']).toBe('/odata/Products(2)')
    expect(items[1]['@odata.type']).toBe('#Default.Product')
  })

  it('Test A3: POST create response — created entity has annotations', async () => {
    const setHeader = vi.fn()
    const result = { entity: { id: 5, name: 'New Product' }, locationUrl: '/odata/Products(5)' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', operation: 'create' })
    const ctx = {
      getHandler: vi.fn().mockReturnValue({}),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ setHeader }),
      }),
    } as unknown as ExecutionContext
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >

    expect(resp['@odata.id']).toBe('/odata/Products(5)')
    expect(resp['@odata.type']).toBe('#Default.Product')
    expect(resp['id']).toBe(5)
    expect(resp['name']).toBe('New Product')
  })

  it('Test A4: entity set not found in registry — annotations skipped gracefully, response still has @odata.context', async () => {
    const result = { id: 1, name: 'Widget' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Unknown', isSingleEntity: true })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeEmptyEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >

    // No crash, @odata.context still present
    expect(resp['@odata.context']).toBe('/odata/$metadata#Unknown/$entity')
    expect(resp['id']).toBe(1)
    // No annotation added
    expect(resp).not.toHaveProperty('@odata.id')
    expect(resp).not.toHaveProperty('@odata.type')
  })

  it('Test A5: non-OData route — passes through completely unchanged', async () => {
    const rawResult = { custom: 'data', unmodified: true }
    mockHandler.handle.mockReturnValue(of(rawResult))
    const reflector = makeReflector(undefined) // no OData metadata
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))

    expect(resp).toBe(rawResult) // Same reference — completely unchanged
    expect(resp).not.toHaveProperty('@odata.id')
  })

  // --- ETag tests (Task 2 of Phase 09-02) ---

  it('Test E1: single entity with __etag property — sets ETag response header and @odata.etag in body', async () => {
    const result = { id: 1, name: 'Widget', __etag: 'W/"abc123"' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', isSingleEntity: true })
    const setHeader = vi.fn()
    const ctx = {
      getHandler: vi.fn().mockReturnValue({}),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ setHeader }),
        getRequest: vi.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >

    // ETag header should be set
    expect(setHeader).toHaveBeenCalledWith('ETag', 'W/"abc123"')
    // @odata.etag in body
    expect(resp['@odata.etag']).toBe('W/"abc123"')
    // Internal __etag removed
    expect(resp).not.toHaveProperty('__etag')
    // Other fields preserved
    expect(resp['id']).toBe(1)
  })

  it('Test E2: single entity without __etag property — no ETag header or @odata.etag', async () => {
    const result = { id: 1, name: 'Widget' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', isSingleEntity: true })
    const setHeader = vi.fn()
    const ctx = {
      getHandler: vi.fn().mockReturnValue({}),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ setHeader }),
        getRequest: vi.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >

    expect(setHeader).not.toHaveBeenCalledWith('ETag', expect.anything())
    expect(resp).not.toHaveProperty('@odata.etag')
  })

  it('Test E3: entity with __notModified flag — sets 304 status, empty body, ETag header', async () => {
    const result = { __notModified: true, etag: 'W/"abc123"' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products', isSingleEntity: true })
    const setHeader = vi.fn()
    const status = vi.fn().mockReturnThis()
    const ctx = {
      getHandler: vi.fn().mockReturnValue({}),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ setHeader, status }),
        getRequest: vi.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext
    const interceptor = new ODataResponseInterceptor(
      reflector as never,
      resolvedOptions,
      makeProductsEdmRegistry(),
    )

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))

    expect(setHeader).toHaveBeenCalledWith('ETag', 'W/"abc123"')
    // Response should be empty (null/undefined)
    expect(resp == null || resp === '').toBe(true)
  })
})
