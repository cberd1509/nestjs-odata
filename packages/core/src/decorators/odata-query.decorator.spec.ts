import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { ODataQueryParam } from './odata-query.decorator.js'

describe('@ODataQuery() / ODataQueryParam', () => {
  it('Test 6: ODataQueryParam is a valid NestJS param decorator factory', () => {
    expect(typeof ODataQueryParam).toBe('function')
  })

  it('Test 7: ODataQueryParam registers param metadata when applied', () => {
    class TestController {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      getProducts(@ODataQueryParam('Products') _query: unknown): unknown[] {
        return []
      }
    }
    // Verify the decorator applied param metadata via NestJS route args metadata key
    const metadata = Reflect.getMetadata('__routeArguments__', TestController, 'getProducts')
    expect(metadata).toBeDefined()
  })
})
