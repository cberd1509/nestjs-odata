import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { ODataQueryParam } from './odata-query.decorator.js'
import { ODataQueryPipe } from '../query/odata-query.pipe.js'

describe('@ODataQuery() / ODataQueryParam', () => {
  it('Test 6: ODataQueryParam is a valid NestJS param decorator factory', () => {
    // ODataQueryParam is now a wrapper function (not a raw createParamDecorator result)
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

  it('Test 8: ODataQueryParam auto-attaches ODataQueryPipe via class reference', () => {
    class PipeTestController {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      getItems(@ODataQueryParam('Items') _query: unknown): unknown[] {
        return []
      }
    }
    // NestJS stores param-level pipes in the route args metadata.
    // When a pipe class is passed as the second arg to a createParamDecorator result,
    // it appears in the metadata's pipes array for that parameter.
    const metadata = Reflect.getMetadata(
      '__routeArguments__',
      PipeTestController,
      'getItems',
    ) as Record<string, { pipes?: unknown[] }>
    expect(metadata).toBeDefined()

    // Find the parameter entry and check its pipes
    const paramEntries = Object.values(metadata)
    const hasPipe = paramEntries.some(
      (entry) => entry.pipes && entry.pipes.some((pipe) => pipe === ODataQueryPipe),
    )
    expect(hasPipe).toBe(true)
  })
})
