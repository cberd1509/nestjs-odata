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
})
