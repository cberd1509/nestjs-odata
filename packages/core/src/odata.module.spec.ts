import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import type { EdmEntityConfig } from './edm/edm-entity-set.js'
import type { ODataModuleResolvedOptions } from './odata.module.js'
import { EdmRegistry } from './edm/edm-registry.js'

describe('ODataModule', () => {
  it('Test 1: ODataModule.forRoot({ serviceRoot: "/odata" }) creates a dynamic module with EdmRegistry as a provider', async () => {
    const { ODataModule } = await import('./odata.module.js')
    const { EdmRegistry } = await import('./edm/edm-registry.js')

    const module = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' })],
    }).compile()

    const registry = module.get(EdmRegistry)
    expect(registry).toBeInstanceOf(EdmRegistry)
  })

  it('Test 2: ODataModule.forRoot() defaults: namespace="Default", maxTop=1000, maxExpandDepth=2, unmappedTypeStrategy="skip"', async () => {
    const { ODataModule, ODATA_MODULE_OPTIONS } = await import('./odata.module.js')

    const module = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' })],
    }).compile()

    const opts = module.get<ODataModuleResolvedOptions>(ODATA_MODULE_OPTIONS)
    expect(opts.serviceRoot).toBe('/odata')
    expect(opts.namespace).toBe('Default')
    expect(opts.maxTop).toBe(1000)
    expect(opts.maxExpandDepth).toBe(2)
    expect(opts.unmappedTypeStrategy).toBe('skip')
  })

  it('Test 3: ODataModule.forFeature([edmEntityConfig]) creates a dynamic module that provides the config via EDM_ENTITY_CONFIGS token', async () => {
    const { ODataModule } = await import('./odata.module.js')
    const { EDM_ENTITY_CONFIGS } = await import('./tokens.js')

    const config: EdmEntityConfig = {
      entityTypeName: 'Product',
      entitySetName: 'Products',
      properties: [],
      navigationProperties: [],
      keyProperties: ['id'],
      isReadOnly: false,
    }

    const module = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' }), ODataModule.forFeature([config])],
    }).compile()

    const configs = module.get<EdmEntityConfig[]>(EDM_ENTITY_CONFIGS)
    expect(configs).toEqual([config])
  })

  it('Test 4: ODATA_MODULE_OPTIONS token is injectable and contains the options from forRoot', async () => {
    const { ODataModule, ODATA_MODULE_OPTIONS } = await import('./odata.module.js')

    const module = await Test.createTestingModule({
      imports: [
        ODataModule.forRoot({ serviceRoot: '/api/odata', namespace: 'MyService', maxTop: 500 }),
      ],
    }).compile()

    const opts = module.get<ODataModuleResolvedOptions>(ODATA_MODULE_OPTIONS)
    expect(opts.serviceRoot).toBe('/api/odata')
    expect(opts.namespace).toBe('MyService')
    expect(opts.maxTop).toBe(500)
  })

  it('MOD-02: forFeature() registers entity configs in EdmRegistry when combined with forRoot', async () => {
    const { ODataModule } = await import('./odata.module.js')

    const config: EdmEntityConfig = {
      entityTypeName: 'Product',
      entitySetName: 'Products',
      properties: [
        { name: 'Id', edmType: 'Edm.Int32', isNullable: false, isCollection: false },
        { name: 'Name', edmType: 'Edm.String', isNullable: true, isCollection: false },
      ],
      navigationProperties: [],
      keyProperties: ['Id'],
      isReadOnly: false,
    }

    const module = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' }), ODataModule.forFeature([config])],
    }).compile()
    await module.init()

    const registry = module.get(EdmRegistry)
    expect(registry.getEntityType('Product')).toBeDefined()
    expect(registry.getEntitySet('Products')).toBeDefined()
    await module.close()
  })

  it('Test 5: ODataModule.forRootAsync({ useFactory: () => opts }) works', async () => {
    const { ODataModule, ODATA_MODULE_OPTIONS } = await import('./odata.module.js')
    const { EdmRegistry } = await import('./edm/edm-registry.js')

    const module = await Test.createTestingModule({
      imports: [
        ODataModule.forRootAsync({
          useFactory: () => ({ serviceRoot: '/async-odata' }),
        }),
      ],
    }).compile()

    const registry = module.get(EdmRegistry)
    expect(registry).toBeInstanceOf(EdmRegistry)

    const opts = module.get<ODataModuleResolvedOptions>(ODATA_MODULE_OPTIONS)
    expect(opts.serviceRoot).toBe('/async-odata')
  })
})
