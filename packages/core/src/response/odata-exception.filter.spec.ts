import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { ODataExceptionFilter } from './odata-exception.filter.js'
import { ODataParseError } from '../parser/errors.js'
import { ODataValidationError } from '../query/odata-validation.error.js'

interface MockResponse {
  status: MockInstance
  json: MockInstance
}

function makeHost(): { host: ArgumentsHost; res: MockResponse } {
  const json = vi.fn()
  const status = vi.fn().mockReturnThis()
  const res: MockResponse = { status, json }
  const host: ArgumentsHost = {
    switchToHttp: vi.fn().mockReturnValue({
      getResponse: vi.fn().mockReturnValue(res),
    }),
  } as unknown as ArgumentsHost
  return { host, res }
}

describe('ODataExceptionFilter', () => {
  const filter = new ODataExceptionFilter()

  it('Test 10: ODataParseError -> HTTP 400 with OData error body', () => {
    const { host, res } = makeHost()
    const error = new ODataParseError('Unexpected token at position 5', 5)

    filter.catch(error, host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'BadRequest',
        message: 'Unexpected token at position 5',
        details: [],
      },
    })
  })

  it('Test 11: ODataValidationError -> HTTP 400 with OData error body', () => {
    const { host, res } = makeHost()
    const error = new ODataValidationError(
      "Property 'Foo' not found on entity 'Product'",
      'Product',
      'Foo',
    )

    filter.catch(error, host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'BadRequest',
        message: "Property 'Foo' not found on entity 'Product'",
        details: [],
      },
    })
  })

  it('Test 12: Generic Error -> HTTP 500 with generic message, no stack trace', () => {
    const { host, res } = makeHost()
    const error = new Error('Internal DB connection failed')

    filter.catch(error, host)

    expect(res.status).toHaveBeenCalledWith(500)
    const body = res.json.mock.calls[0][0] as Record<string, unknown>
    expect(body).toMatchObject({
      error: {
        code: 'InternalServerError',
        message: 'An unexpected error occurred.',
        details: [],
      },
    })
    // Ensure no stack trace is leaked
    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('at ')
    expect(bodyStr).not.toContain('Error:')
    expect(bodyStr).not.toContain('Internal DB connection failed')
  })

  it('Test 13: HttpException (NotFoundException) uses exception status and message', () => {
    const { host, res } = makeHost()
    const error = new NotFoundException('Product not found')

    filter.catch(error, host)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'NotFound',
        }),
      }),
    )
  })
})
