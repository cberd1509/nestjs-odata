import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  INTERCEPTORS_METADATA,
  FILTERS_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
} from '@nestjs/common/constants.js'
import { ODataPost } from './odata-post.decorator.js'
import { ODataPatch } from './odata-patch.decorator.js'
import { ODataDelete } from './odata-delete.decorator.js'
import { ODataGetByKey } from './odata-get-by-key.decorator.js'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

class TestController {
  @ODataPost('Products')
  createProduct(): unknown {
    return {}
  }

  @ODataPatch('Products')
  updateProduct(): unknown {
    return {}
  }

  @ODataDelete('Products')
  deleteProduct(): void {}

  @ODataGetByKey('Products')
  getProductByKey(): unknown {
    return {}
  }
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const createMethod = TestController.prototype.createProduct
// eslint-disable-next-line @typescript-eslint/unbound-method
const updateMethod = TestController.prototype.updateProduct
// eslint-disable-next-line @typescript-eslint/unbound-method
const deleteMethod = TestController.prototype.deleteProduct
// eslint-disable-next-line @typescript-eslint/unbound-method
const getByKeyMethod = TestController.prototype.getProductByKey

describe('@ODataPost()', () => {
  it('Test 1: applies Post() route (path is defined)', () => {
    const path = Reflect.getMetadata(PATH_METADATA, createMethod)
    expect(path).toBeDefined()
  })

  it('Test 2: sets ODATA_ROUTE_KEY metadata with entitySetName and operation=create', () => {
    const meta = Reflect.getMetadata(ODATA_ROUTE_KEY, createMethod) as {
      entitySetName: string
      operation: string
    }
    expect(meta).toMatchObject({ entitySetName: 'Products', operation: 'create' })
  })

  it('Test 3: applies UseInterceptors(ODataResponseInterceptor)', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, createMethod) as unknown[]
    expect(interceptors).toContain(ODataResponseInterceptor)
  })

  it('Test 4: applies UseFilters(ODataExceptionFilter)', () => {
    const filters = Reflect.getMetadata(FILTERS_METADATA, createMethod) as unknown[]
    expect(filters).toContain(ODataExceptionFilter)
  })
})

describe('@ODataPatch()', () => {
  it('Test 5: applies Patch(:key) path', () => {
    const path = Reflect.getMetadata(PATH_METADATA, updateMethod)
    expect(path).toBe(':key')
  })

  it('Test 6: sets ODATA_ROUTE_KEY metadata with entitySetName, operation=update, and isSingleEntity=true', () => {
    const meta = Reflect.getMetadata(ODATA_ROUTE_KEY, updateMethod) as {
      entitySetName: string
      operation: string
      isSingleEntity: boolean
    }
    expect(meta).toMatchObject({
      entitySetName: 'Products',
      operation: 'update',
      isSingleEntity: true,
    })
  })

  it('Test 7: applies UseInterceptors(ODataResponseInterceptor)', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, updateMethod) as unknown[]
    expect(interceptors).toContain(ODataResponseInterceptor)
  })

  it('Test 8: applies UseFilters(ODataExceptionFilter)', () => {
    const filters = Reflect.getMetadata(FILTERS_METADATA, updateMethod) as unknown[]
    expect(filters).toContain(ODataExceptionFilter)
  })
})

describe('@ODataDelete()', () => {
  it('Test 9: applies Delete(:key) path', () => {
    const path = Reflect.getMetadata(PATH_METADATA, deleteMethod)
    expect(path).toBe(':key')
  })

  it('Test 10: sets ODATA_ROUTE_KEY metadata with entitySetName and operation=delete', () => {
    const meta = Reflect.getMetadata(ODATA_ROUTE_KEY, deleteMethod) as {
      entitySetName: string
      operation: string
    }
    expect(meta).toMatchObject({ entitySetName: 'Products', operation: 'delete' })
  })

  it('Test 11: applies UseFilters(ODataExceptionFilter)', () => {
    const filters = Reflect.getMetadata(FILTERS_METADATA, deleteMethod) as unknown[]
    expect(filters).toContain(ODataExceptionFilter)
  })

  it('Test 12: does NOT apply UseInterceptors (204 has no body)', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, deleteMethod) as
      | unknown[]
      | undefined
    const hasInterceptor = interceptors?.includes(ODataResponseInterceptor) ?? false
    expect(hasInterceptor).toBe(false)
  })
})

describe('@ODataGetByKey()', () => {
  it('Test 13: applies Get(:key) path', () => {
    const path = Reflect.getMetadata(PATH_METADATA, getByKeyMethod)
    expect(path).toBe(':key')
  })

  it('Test 14: sets ODATA_ROUTE_KEY metadata with entitySetName, operation=getByKey, and isSingleEntity=true', () => {
    const meta = Reflect.getMetadata(ODATA_ROUTE_KEY, getByKeyMethod) as {
      entitySetName: string
      operation: string
      isSingleEntity: boolean
    }
    expect(meta).toMatchObject({
      entitySetName: 'Products',
      operation: 'getByKey',
      isSingleEntity: true,
    })
  })

  it('Test 15: applies UseInterceptors(ODataResponseInterceptor)', () => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, getByKeyMethod) as unknown[]
    expect(interceptors).toContain(ODataResponseInterceptor)
  })

  it('Test 16: applies UseFilters(ODataExceptionFilter)', () => {
    const filters = Reflect.getMetadata(FILTERS_METADATA, getByKeyMethod) as unknown[]
    expect(filters).toContain(ODataExceptionFilter)
  })
})

describe('HTTP method verification', () => {
  it('Test 17: @ODataPost uses POST http method', () => {
    const method = Reflect.getMetadata(METHOD_METADATA, createMethod)
    expect(method).toBeDefined()
  })

  it('Test 18: @ODataPatch uses PATCH http method', () => {
    const method = Reflect.getMetadata(METHOD_METADATA, updateMethod)
    expect(method).toBeDefined()
  })
})
