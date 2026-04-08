import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EdmFeatureInitializer } from './edm-feature-initializer.js'
import type { EdmEntityConfig } from './edm-entity-set.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'

const mockOptions: ODataModuleResolvedOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 1000,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
}

const sampleConfig: EdmEntityConfig = {
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

describe('EdmFeatureInitializer', () => {
  const registerFn = vi.fn()
  const mockRegistry = {
    register: registerFn,
    getEntityType: vi.fn(),
    getEntitySet: vi.fn(),
    getEntityTypes: vi.fn(),
    getEntitySets: vi.fn(),
    setEntitySecurityOptions: vi.fn(),
    getEntitySecurityOptions: vi.fn(),
  }

  beforeEach(() => {
    registerFn.mockClear()
  })

  it('MOD-02: registers each entity config in EdmRegistry on init', () => {
    const initializer = new EdmFeatureInitializer(mockRegistry as never, mockOptions, [
      sampleConfig,
    ])
    initializer.onModuleInit()

    expect(registerFn).toHaveBeenCalledTimes(1)
    expect(registerFn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Product', namespace: 'Default' }),
      expect.objectContaining({
        name: 'Products',
        entityTypeName: 'Product',
        namespace: 'Default',
      }),
    )
  })

  it('registers multiple configs when array has multiple entries', () => {
    const config2: EdmEntityConfig = {
      ...sampleConfig,
      entityTypeName: 'Category',
      entitySetName: 'Categories',
    }
    const initializer = new EdmFeatureInitializer(mockRegistry as never, mockOptions, [
      sampleConfig,
      config2,
    ])
    initializer.onModuleInit()
    expect(registerFn).toHaveBeenCalledTimes(2)
  })

  it('calls register zero times when entity config array is empty', () => {
    const initializer = new EdmFeatureInitializer(mockRegistry as never, mockOptions, [])
    initializer.onModuleInit()
    expect(registerFn).toHaveBeenCalledTimes(0)
  })

  it('uses namespace from options in registered types', () => {
    const customOptions = { ...mockOptions, namespace: 'MyNamespace' }
    const initializer = new EdmFeatureInitializer(mockRegistry as never, customOptions, [
      sampleConfig,
    ])
    initializer.onModuleInit()
    expect(registerFn).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'MyNamespace' }),
      expect.objectContaining({ namespace: 'MyNamespace' }),
    )
  })
})
