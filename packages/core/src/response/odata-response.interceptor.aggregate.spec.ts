/**
 * ODataResponseInterceptor: aggregated ($apply) results, unwrapped create results and entity
 * sets whose entity type is not registered.
 */
import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { of, firstValueFrom } from 'rxjs'
import type { ExecutionContext, CallHandler } from '@nestjs/common'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import { ODataResponseInterceptor } from './odata-response.interceptor.js'

const options: ODataModuleResolvedOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 1000,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
}

function httpContext(setHeader = vi.fn()): ExecutionContext {
  return {
    getHandler: vi.fn().mockReturnValue({}),
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue({ headers: {} }),
      getResponse: vi.fn().mockReturnValue({ setHeader }),
    }),
  } as unknown as ExecutionContext
}

function run(
  meta: Record<string, unknown>,
  result: unknown,
  registry = new EdmRegistry(),
  ctx = httpContext(),
): Promise<Record<string, unknown>> {
  const interceptor = new ODataResponseInterceptor(
    { get: vi.fn().mockReturnValue(meta) } as never,
    options,
    registry,
  )
  const handler = { handle: () => of(result) } as CallHandler
  return firstValueFrom(interceptor.intercept(ctx, handler)) as Promise<Record<string, unknown>>
}

describe('ODataResponseInterceptor: aggregated results', () => {
  it('uses a projection context URL from the aggregated properties and keeps the count', async () => {
    const resp = await run(
      { entitySetName: 'Products' },
      {
        items: [{ Category: 'A', Total: 3 }],
        isAggregated: true,
        applyProperties: ['Category', 'Total'],
        count: 1,
      },
    )
    expect(resp).toEqual({
      '@odata.context': '/odata/$metadata#Products(Category,Total)',
      value: [{ Category: 'A', Total: 3 }],
      '@odata.count': 1,
    })
  })

  it('uses the entity set context URL and no count when neither is given', async () => {
    const resp = await run(
      { entitySetName: 'Products' },
      { items: [{ Total: 3 }], isAggregated: true, applyProperties: [] },
    )
    expect(resp).toEqual({ '@odata.context': '/odata/$metadata#Products', value: [{ Total: 3 }] })
  })
})

describe('ODataResponseInterceptor: create results', () => {
  it('treats a create result without an entity wrapper as the entity itself', async () => {
    const setHeader = vi.fn()
    const resp = await run(
      { entitySetName: 'Products', operation: 'create' },
      { id: 9, name: 'Bare' },
      new EdmRegistry(),
      httpContext(setHeader),
    )
    expect(resp).toMatchObject({
      '@odata.context': '/odata/$metadata#Products/$entity',
      id: 9,
      name: 'Bare',
    })
    expect(setHeader).not.toHaveBeenCalledWith('Location', expect.anything())
  })
})

describe('ODataResponseInterceptor: unregistered entity type', () => {
  it('skips entity annotations when the entity set has no registered type', async () => {
    const registry = new EdmRegistry()
    registry.register(
      {
        name: 'Other',
        namespace: 'Default',
        properties: [],
        navigationProperties: [],
        keyProperties: ['id'],
        isReadOnly: false,
      },
      { name: 'Products', entityTypeName: 'Ghost', namespace: 'Default', isReadOnly: false },
    )
    const resp = await run({ entitySetName: 'Products', isSingleEntity: true }, { id: 1 }, registry)
    expect(resp).toEqual({ '@odata.context': '/odata/$metadata#Products/$entity', id: 1 })
  })
})
