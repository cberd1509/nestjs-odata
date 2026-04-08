import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { INTERCEPTORS_METADATA, FILTERS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { ODataController } from './odata-controller.decorator.js'
import { ODATA_CONTROLLER_KEY } from './metadata-keys.js'
import { ODataModule } from '../odata.module.js'

@ODataController('Products')
class ProductsController {}

@ODataController('Orders', { path: 'custom-orders' })
class OrdersController {}

describe('@ODataController()', () => {
  it('Test 1: applies Controller route prefix equal to entitySetName by default', () => {
    const path = Reflect.getMetadata(PATH_METADATA, ProductsController)
    expect(path).toBe('Products')
  })

  it('Test 2: sets ODATA_CONTROLLER_KEY metadata to the entitySetName', () => {
    const meta = Reflect.getMetadata(ODATA_CONTROLLER_KEY, ProductsController) as string
    expect(meta).toBe('Products')
  })

  it('Test 3: applies custom path when options.path is provided', () => {
    const path = Reflect.getMetadata(PATH_METADATA, OrdersController)
    expect(path).toBe('custom-orders')
  })

  it('Test 4: does NOT apply class-level UseInterceptors (each method decorator handles interceptors)', () => {
    // Interceptors are applied per-method by @ODataGet/@ODataPost/etc, not at class level,
    // to avoid double-wrapping when @ODataController is combined with CRUD method decorators.
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, ProductsController) as
      | unknown[]
      | undefined
    expect(interceptors).toBeUndefined()
  })

  it('Test 5: does NOT apply class-level UseFilters (each method decorator handles filters)', () => {
    // Filters are applied per-method by @ODataGet/@ODataPost/etc, not at class level.
    const filters = Reflect.getMetadata(FILTERS_METADATA, ProductsController) as
      | unknown[]
      | undefined
    expect(filters).toBeUndefined()
  })
})

describe('ODataModule.forRoot() controller patching', () => {
  it('Test 3b: forRoot() patches PATH_METADATA on controllers with serviceRoot prefix', () => {
    // Create a fresh controller class to avoid polluting other tests
    @ODataController('Categories')
    class CategoriesController {}

    // Before forRoot: path should be just the entitySetName
    expect(Reflect.getMetadata(PATH_METADATA, CategoriesController)).toBe('Categories')

    // Call forRoot with controllers array
    ODataModule.forRoot({
      serviceRoot: '/odata',
      controllers: [CategoriesController],
    })

    // After forRoot: path should be serviceRoot/entitySetName
    expect(Reflect.getMetadata(PATH_METADATA, CategoriesController)).toBe('odata/Categories')
  })

  it('Test 3c: forRoot() stores serviceRoot on static registeredServiceRoot property', () => {
    ODataModule.forRoot({
      serviceRoot: '/api/odata',
      controllers: [],
    })

    expect(ODataModule.registeredServiceRoot).toBe('/api/odata')
  })

  it('Test 3d: forRoot() validates serviceRoot is a non-empty string (T-12-01)', () => {
    expect(() =>
      ODataModule.forRoot({
        serviceRoot: '',
        controllers: [],
      }),
    ).toThrow()
  })
})
