import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  INTERCEPTORS_METADATA,
  FILTERS_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
} from '@nestjs/common/constants.js'
import { RequestMethod } from '@nestjs/common'
import { ODataPut } from './odata-put.decorator.js'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

class TestController {
  @ODataPut('Orders')
  replaceOrder(): unknown {
    return {}
  }

  @ODataPut('Orders', { path: ':id' })
  replaceOrderCustomPath(): unknown {
    return {}
  }
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const replaceMethod = TestController.prototype.replaceOrder
// eslint-disable-next-line @typescript-eslint/unbound-method
const replaceCustomPathMethod = TestController.prototype.replaceOrderCustomPath

describe('@ODataPut()', () => {
  it('Test 1: applies Put(:key) path by default', () => {
    const path = Reflect.getMetadata(PATH_METADATA, replaceMethod)
    expect(path).toBe(':key')
  })

  it('Test 2: sets ODATA_ROUTE_KEY metadata with operation=replace and isSingleEntity=true', () => {
    const meta = Reflect.getMetadata(ODATA_ROUTE_KEY, replaceMethod) as {
      entitySetName: string
      operation: string
      isSingleEntity: boolean
    }
    expect(meta).toMatchObject({
      entitySetName: 'Orders',
      operation: 'replace',
      isSingleEntity: true,
    })
  })

  it('Test 3: applies UseInterceptors(ODataResponseInterceptor)', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, replaceMethod) as unknown[]
    expect(interceptors).toContain(ODataResponseInterceptor)
  })

  it('Test 4: applies UseFilters(ODataExceptionFilter)', () => {
    const filters = Reflect.getMetadata(FILTERS_METADATA, replaceMethod) as unknown[]
    expect(filters).toContain(ODataExceptionFilter)
  })

  it('Test 5: uses PUT HTTP method', () => {
    const method = Reflect.getMetadata(METHOD_METADATA, replaceMethod) as number
    // NestJS RequestMethod.PUT = 4
    expect(method).toBe(RequestMethod.PUT)
  })

  it('Test 6: respects custom path option', () => {
    const path = Reflect.getMetadata(PATH_METADATA, replaceCustomPathMethod)
    expect(path).toBe(':id')
  })
})
