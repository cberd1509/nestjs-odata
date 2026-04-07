import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { INTERCEPTORS_METADATA, FILTERS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { ODataController } from './odata-controller.decorator.js'
import { ODATA_CONTROLLER_KEY } from './metadata-keys.js'

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
