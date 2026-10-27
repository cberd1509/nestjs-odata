/**
 * ODataModule: the Express canonical-key rewrite installed by configure(), controller path
 * patching in forRoot(), globalPrefixExclude() and the MetadataController routes.
 */
import 'reflect-metadata'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Logger } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import { Test } from '@nestjs/testing'
import type { HttpAdapterHost } from '@nestjs/core'
import { ODataModule, type ODataModuleResolvedOptions } from './odata.module.js'
import { EdmRegistry } from './edm/edm-registry.js'
import { ODataController } from './decorators/odata-controller.decorator.js'
import { MetadataController } from './metadata/metadata.controller.js'

const options = { serviceRoot: '/odata' } as ODataModuleResolvedOptions

function registryWithProducts(): EdmRegistry {
  const registry = new EdmRegistry()
  registry.register(
    {
      name: 'Product',
      namespace: 'Default',
      properties: [{ name: 'id', type: 'Edm.Int32', nullable: false }],
      navigationProperties: [],
      keyProperties: ['id'],
      isReadOnly: false,
    },
    { name: 'Products', entityTypeName: 'Product', namespace: 'Default', isReadOnly: false },
  )
  return registry
}

type Middleware = (req: { url: string }, res: unknown, next: () => void) => void

function expressHost(app: { use: (fn: Middleware) => void; enabled?: (s: string) => boolean }) {
  return {
    httpAdapter: { getType: () => 'express', getInstance: () => app },
  } as unknown as HttpAdapterHost
}

describe('ODataModule.configure()', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does nothing without an HTTP adapter, options or registry', () => {
    const use = vi.fn()
    new ODataModule(undefined, options, new EdmRegistry()).configure()
    new ODataModule(expressHost({ use }), undefined, new EdmRegistry()).configure()
    new ODataModule(expressHost({ use }), options, undefined).configure()
    expect(use).not.toHaveBeenCalled()
  })

  it('does nothing on a non-Express adapter', () => {
    const use = vi.fn()
    const host = {
      httpAdapter: { getType: () => 'fastify', getInstance: () => ({ use }) },
    } as unknown as HttpAdapterHost
    new ODataModule(host, options, new EdmRegistry()).configure()
    expect(use).not.toHaveBeenCalled()
  })

  it('rewrites canonical key URLs of known entity sets, once per application', () => {
    const use = vi.fn()
    const app = { use }
    const module = new ODataModule(expressHost(app), options, registryWithProducts())
    module.configure()
    module.configure()
    expect(use).toHaveBeenCalledTimes(1)

    const middleware = use.mock.calls[0]?.[0] as Middleware
    const next = vi.fn()
    const known = { url: '/odata/Products(1)?$select=id' }
    middleware(known, {}, next)
    expect(known.url).toBe('/odata/Products/1?$select=id')

    const unknown = { url: '/odata/Orders(1)' }
    middleware(unknown, {}, next)
    expect(unknown.url).toBe('/odata/Orders(1)')
    expect(next).toHaveBeenCalledTimes(2)
  })

  it("warns when Express's etag setting is on", () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const app = { use: vi.fn(), enabled: (setting: string) => setting === 'etag' }
    new ODataModule(expressHost(app), options, new EdmRegistry()).configure()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Express's 'etag' setting is on"))
  })

  it('does not warn when the etag setting is off', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const app = { use: vi.fn(), enabled: () => false }
    new ODataModule(expressHost(app), options, new EdmRegistry()).configure()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('ODataModule.forRoot() controller paths', () => {
  it('prefixes OData controllers with a service root given without a leading slash', () => {
    @ODataController('Widgets')
    class WidgetsController {}
    ODataModule.forRoot({ serviceRoot: 'api/odata', controllers: [WidgetsController] })
    expect(Reflect.getMetadata(PATH_METADATA, WidgetsController)).toBe('api/odata/Widgets')
    expect(Reflect.getMetadata(PATH_METADATA, MetadataController)).toBe('api/odata')
  })

  it('uses the bare entity set name when the service root is "/"', () => {
    @ODataController('Gadgets')
    class GadgetsController {}
    ODataModule.forRoot({ serviceRoot: '/', controllers: [GadgetsController] })
    expect(Reflect.getMetadata(PATH_METADATA, GadgetsController)).toBe('Gadgets')
  })

  it('leaves classes that are not OData controllers alone', () => {
    class PlainController {}
    ODataModule.forRoot({ serviceRoot: '/odata', controllers: [PlainController] })
    expect(Reflect.getMetadata(PATH_METADATA, PlainController)).toBeUndefined()
  })

  it('rejects a blank service root', () => {
    expect(() => ODataModule.forRoot({ serviceRoot: '  ' })).toThrow(
      'ODataModule.forRoot(): serviceRoot must be a non-empty string',
    )
  })
})

describe('ODataModule.globalPrefixExclude()', () => {
  it('excludes the registered service root and everything below it', () => {
    ODataModule.forRoot({ serviceRoot: '/odata' })
    expect(ODataModule.registeredServiceRoot).toBe('/odata')
    expect(ODataModule.globalPrefixExclude()).toEqual([
      { path: 'odata', method: 7 },
      { path: 'odata/{*splat}', method: 7 },
    ])
  })

  it('accepts an explicit service root, with or without a leading slash', () => {
    expect(ODataModule.globalPrefixExclude('/v4')).toEqual([
      { path: 'v4', method: 7 },
      { path: 'v4/{*splat}', method: 7 },
    ])
    expect(ODataModule.globalPrefixExclude('v4')[0]).toEqual({ path: 'v4', method: 7 })
  })
})

describe('MetadataController', () => {
  it('serves the CSDL document and the service document', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' })],
    }).compile()
    moduleRef.get(EdmRegistry).register(
      {
        name: 'Product',
        namespace: 'Default',
        properties: [{ name: 'id', type: 'Edm.Int32', nullable: false }],
        navigationProperties: [],
        keyProperties: ['id'],
        isReadOnly: false,
      },
      { name: 'Products', entityTypeName: 'Product', namespace: 'Default', isReadOnly: false },
    )
    const controller = moduleRef.get(MetadataController)
    expect(controller.getMetadata()).toContain('<EntitySet Name="Products"')
    expect(controller.getServiceDocument()).toMatchObject({
      '@odata.context': '/odata/$metadata',
      value: [{ name: 'Products', kind: 'EntitySet', url: 'Products' }],
    })
  })
})
