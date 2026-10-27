import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { of, firstValueFrom } from 'rxjs'
import type { ExecutionContext, CallHandler } from '@nestjs/common'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { EdmRegistry } from '../edm/edm-registry.js'
import { ODataResponseInterceptor } from './odata-response.interceptor.js'
import { ODataEmptyResponse } from './odata-empty-response.js'

const options = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 1000,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
} as ODataModuleResolvedOptions

function registry(): EdmRegistry {
  return {
    getEntitySet: vi.fn().mockReturnValue({
      name: 'Products',
      entityTypeName: 'Product',
      namespace: 'Default',
      isReadOnly: false,
    }),
    getEntityType: vi.fn().mockReturnValue({
      name: 'Product',
      namespace: 'Default',
      properties: [],
      navigationProperties: [],
      keyProperties: ['id'],
      isReadOnly: false,
    }),
  } as unknown as EdmRegistry
}

function setup(meta: unknown, result: unknown, request: Record<string, unknown> = {}) {
  const headers = new Map<string, string>()
  const response = { setHeader: vi.fn((k: string, v: string) => headers.set(k, v)) }
  const ctx = {
    getHandler: vi.fn().mockReturnValue({}),
    switchToHttp: vi.fn().mockReturnValue({
      getResponse: vi.fn().mockReturnValue(response),
      getRequest: vi
        .fn()
        .mockReturnValue({ headers: {}, originalUrl: '/odata/Products', ...request }),
    }),
  } as unknown as ExecutionContext
  const handler = { handle: vi.fn().mockReturnValue(of(result)) } as unknown as CallHandler
  const interceptor = new ODataResponseInterceptor(
    { get: vi.fn().mockReturnValue(meta) } as never,
    options,
    registry(),
  )
  return { run: () => firstValueFrom(interceptor.intercept(ctx, handler)), headers, response }
}

describe('ODataResponseInterceptor — 304 Not Modified (#77)', () => {
  it('signals an empty 304 through ODataEmptyResponse instead of ending the response itself', async () => {
    const { run, headers } = setup(
      { entitySetName: 'Products', operation: 'getByKey', isSingleEntity: true },
      { __notModified: true, etag: 'W/"abc"' },
    )
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ODataEmptyResponse)
    expect((error as ODataEmptyResponse).status).toBe(304)
    expect(headers.get('ETag')).toBe('W/"abc"')
  })
})

describe('ODataResponseInterceptor — Prefer: return=minimal (#79)', () => {
  const created = {
    entity: { id: 5, name: 'New', __etag: 'W/"v1"' },
    locationUrl: '/odata/Products(5)',
  }

  it('POST with return=minimal answers 204 with Location, OData-EntityId, ETag and Preference-Applied', async () => {
    const { run, headers } = setup({ entitySetName: 'Products', operation: 'create' }, created, {
      headers: { prefer: 'return=minimal' },
    })
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ODataEmptyResponse)
    expect((error as ODataEmptyResponse).status).toBe(204)
    expect(headers.get('Location')).toBe('/odata/Products(5)')
    expect(headers.get('OData-EntityId')).toBe('/odata/Products(5)')
    expect(headers.get('ETag')).toBe('W/"v1"')
    expect(headers.get('Preference-Applied')).toBe('return=minimal')
  })

  it('PATCH and PUT with return=minimal answer 204 with Preference-Applied', async () => {
    for (const operation of ['update', 'replace']) {
      const { run, headers } = setup(
        { entitySetName: 'Products', operation, isSingleEntity: true },
        { id: 1, name: 'x', __etag: 'W/"v2"' },
        { headers: { prefer: 'return=minimal' }, originalUrl: '/odata/Products(1)' },
      )
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ODataEmptyResponse)
      expect((error as ODataEmptyResponse).status).toBe(204)
      expect(headers.get('Preference-Applied')).toBe('return=minimal')
      expect(headers.get('ETag')).toBe('W/"v2"')
    }
  })

  it('return=representation keeps the body and reports Preference-Applied', async () => {
    const { run, headers } = setup({ entitySetName: 'Products', operation: 'create' }, created, {
      headers: { prefer: 'return=representation' },
    })
    const body = (await run()) as Record<string, unknown>
    expect(body['id']).toBe(5)
    expect(headers.get('Preference-Applied')).toBe('return=representation')
  })

  it('$select on the request implies representation: no 204, no Preference-Applied', async () => {
    const { run, headers } = setup(
      { entitySetName: 'Products', operation: 'update', isSingleEntity: true },
      { id: 1, name: 'x' },
      { headers: { prefer: 'return=minimal' }, originalUrl: '/odata/Products(1)?$select=name' },
    )
    const body = (await run()) as Record<string, unknown>
    expect(body['id']).toBe(1)
    expect(headers.has('Preference-Applied')).toBe(false)
  })

  it('return=minimal is ignored on GET', async () => {
    const { run } = setup(
      { entitySetName: 'Products', operation: 'getByKey', isSingleEntity: true },
      { id: 1 },
      { headers: { prefer: 'return=minimal' } },
    )
    const body = (await run()) as Record<string, unknown>
    expect(body['id']).toBe(1)
  })
})

describe('ODataResponseInterceptor — @odata.etag on collection items (#81)', () => {
  it('turns each item __etag into @odata.etag without setting an ETag header', async () => {
    const { run, headers } = setup(
      { entitySetName: 'Products' },
      { items: [{ id: 1, __etag: 'W/"a"' }, { id: 2 }] },
    )
    const body = (await run()) as { value: Record<string, unknown>[] }
    expect(body.value[0]['@odata.etag']).toBe('W/"a"')
    expect(body.value[0]).not.toHaveProperty('__etag')
    expect(body.value[1]).not.toHaveProperty('@odata.etag')
    expect(headers.has('ETag')).toBe(false)
  })
})
