import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { INTERCEPTORS_METADATA, FILTERS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { ODataGet } from './odata-get.decorator.js'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

class TestController {
  @ODataGet('Products')
  getProducts(): unknown[] {
    return []
  }

  @ODataGet('Orders', { path: 'orders-custom' })
  getOrders(): unknown[] {
    return []
  }
}

// Extract method references for metadata inspection.
// eslint-disable-next-line @typescript-eslint/unbound-method
const productsMethod = TestController.prototype.getProducts
// eslint-disable-next-line @typescript-eslint/unbound-method
const ordersMethod = TestController.prototype.getOrders

describe('@ODataGet()', () => {
  it('Test 1: sets ODATA_ROUTE_KEY metadata with entitySetName', () => {
    const meta = Reflect.getMetadata(ODATA_ROUTE_KEY, productsMethod) as {
      entitySetName: string
    }
    expect(meta).toMatchObject({ entitySetName: 'Products' })
  })

  it('Test 2: applies NestJS Get route metadata', () => {
    const path = Reflect.getMetadata(PATH_METADATA, productsMethod)
    expect(path).toBeDefined()
  })

  it('Test 3: applies UseInterceptors(ODataResponseInterceptor)', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, productsMethod) as unknown[]
    expect(interceptors).toContain(ODataResponseInterceptor)
  })

  it('Test 4: applies UseFilters(ODataExceptionFilter)', () => {
    const filters = Reflect.getMetadata(FILTERS_METADATA, productsMethod) as unknown[]
    expect(filters).toContain(ODataExceptionFilter)
  })

  it('Test 5: custom path option is applied to Get metadata', () => {
    const path = Reflect.getMetadata(PATH_METADATA, ordersMethod)
    expect(path).toBe('orders-custom')
  })
})
