import 'reflect-metadata'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { of, firstValueFrom } from 'rxjs'
import type { ExecutionContext, CallHandler } from '@nestjs/common'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
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
  unmappedTypeStrategy: 'skip',
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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).not.toHaveProperty('@odata.count')
  })

  it('Test 7: includes @odata.nextLink when present', async () => {
    const result = { items: [], nextLink: 'http://odata/Products?$skip=10' }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).toHaveProperty('@odata.nextLink', 'http://odata/Products?$skip=10')
  })

  it('Test 7b: omits @odata.nextLink when undefined', async () => {
    const result = { items: [] }
    mockHandler.handle.mockReturnValue(of(result))
    const reflector = makeReflector({ entitySetName: 'Products' })
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

    const resp = await firstValueFrom(interceptor.intercept(ctx, handler))
    expect(resp).not.toHaveProperty('@odata.nextLink')
  })

  it('Test 8: passes through unchanged when route does NOT have ODATA_ROUTE_KEY metadata', async () => {
    const rawResult = { some: 'data' }
    mockHandler.handle.mockReturnValue(of(rawResult))
    const reflector = makeReflector(undefined) // no metadata
    const ctx = makeContext()
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

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
    const interceptor = new ODataResponseInterceptor(reflector as never, resolvedOptions)

    const resp = (await firstValueFrom(interceptor.intercept(ctx, handler))) as Record<
      string,
      unknown
    >
    expect(resp).toHaveProperty('value')
    expect(resp['value']).toEqual([{ id: 1 }, { id: 2 }])
    expect(resp['@odata.context']).toBe('/odata/$metadata#Products')
  })
})
