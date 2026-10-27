import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { buildODataErrorResponse, httpStatusToODataCode } from './odata-error.js'
import type { ODataErrorMapper } from './odata-error.js'
import { ODataExceptionFilter } from './odata-exception.filter.js'

class DomainProblem extends Error {
  constructor(
    readonly code: string,
    readonly field?: string,
  ) {
    super(`problem ${code}`)
  }
}

const mapper: ODataErrorMapper = (err) =>
  err instanceof DomainProblem
    ? {
        status: 422,
        code: err.code,
        message: 'Validation failed',
        target: err.field,
        details: [{ code: 'Required', message: 'name is required', target: 'name' }],
        innererror: { ref: 'abc' },
      }
    : undefined

describe('buildODataErrorResponse', () => {
  it('uses the mapping returned by the mapper', () => {
    expect(buildODataErrorResponse(new DomainProblem('NAME_MISSING', 'name'), mapper)).toEqual({
      status: 422,
      body: {
        error: {
          code: 'NAME_MISSING',
          message: 'Validation failed',
          target: 'name',
          details: [{ code: 'Required', message: 'name is required', target: 'name' }],
          innererror: { ref: 'abc' },
        },
      },
    })
  })

  it('omits optional fields the mapping does not set', () => {
    const res = buildODataErrorResponse(new Error('x'), () => ({
      status: 409,
      code: 'C',
      message: 'm',
    }))
    expect(res).toEqual({ status: 409, body: { error: { code: 'C', message: 'm', details: [] } } })
  })

  it('falls back to the default mapping when the mapper returns nothing, throws or is invalid', () => {
    const fallback = {
      status: 500,
      body: {
        error: {
          code: 'InternalServerError',
          message: 'An unexpected error occurred.',
          details: [],
        },
      },
    }
    expect(buildODataErrorResponse(new Error('secret'), mapper)).toEqual(fallback)
    expect(
      buildODataErrorResponse(new Error('secret'), () => {
        throw new Error('boom')
      }),
    ).toEqual(fallback)
    expect(
      buildODataErrorResponse(new Error('secret'), () => ({
        status: 200,
        code: 'x',
        message: 'y',
      })),
    ).toEqual(fallback)
    expect(buildODataErrorResponse(new Error('secret'))).toEqual(fallback)
  })

  it('passes the context to the mapper', () => {
    const spy = vi.fn(() => undefined)
    const ctx = { request: { url: '/x' }, batch: { method: 'GET', url: '/odata/X(1)' } }
    buildODataErrorResponse('thrown string', spy, ctx)
    expect(spy).toHaveBeenCalledWith('thrown string', ctx)
  })

  it('keeps the message of HttpExceptions with an OData-shaped body', () => {
    const res = buildODataErrorResponse(
      new HttpException({ error: { code: '412', message: 'ETag mismatch' } }, 412),
    )
    expect(res).toEqual({
      status: 412,
      body: { error: { code: 'PreconditionFailed', message: 'ETag mismatch', details: [] } },
    })
    expect(buildODataErrorResponse(new BadRequestException('Bad name')).body.error.message).toBe(
      'Bad name',
    )
  })

  it('maps unknown statuses to the generic Error code', () => {
    expect(httpStatusToODataCode(418)).toBe('Error')
  })
})

describe('ODataExceptionFilter with errorMapper', () => {
  it('applies the configured mapper and hands it the host and request', () => {
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    const request = { url: '/odata/Things' }
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => request }),
    } as unknown as ArgumentsHost
    const spy = vi.fn(mapper)
    new ODataExceptionFilter({ errorMapper: spy }).catch(new DomainProblem('X'), host)
    expect(status).toHaveBeenCalledWith(422)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'X' }) }),
    )
    expect(spy).toHaveBeenCalledWith(expect.any(DomainProblem), { host, request })
  })
})

describe('buildODataErrorResponse hardening', () => {
  const fallback = buildODataErrorResponse(new Error('secret'))

  it('validates every field of a mapping and falls back (with a warning) when one is invalid', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const base = { status: 422, code: 'X', message: 'm' }
    const invalid: unknown[] = [
      { ...base, details: 'oops' }, // a string would be spread into characters
      { ...base, details: [{ code: 1, message: 'm' }] },
      { ...base, details: [{ code: 'c', message: 'm', target: 3 }] },
      { ...base, target: 42 },
      { ...base, innererror: 'trace' },
      { ...base, innererror: ['x'] },
      { ...base, code: '' }, // JSON §21.1: code and message are non-empty
      { ...base, message: '' },
      { ...base, details: [{ code: '', message: 'm' }] },
      'not an object',
    ]
    for (const mapping of invalid) {
      expect(buildODataErrorResponse(new Error('secret'), () => mapping as never)).toEqual(fallback)
    }
    expect(warn).toHaveBeenCalledTimes(invalid.length)
    expect(String(warn.mock.calls[0][0])).toMatch(/details must be an array/)
    warn.mockRestore()
  })

  it('logs a mapper that throws instead of failing silently', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const res = buildODataErrorResponse(new Error('secret'), () => {
      throw new TypeError('bug in mapper')
    })
    expect(res).toEqual(fallback)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/errorMapper threw \(TypeError\)/))
    warn.mockRestore()
  })

  it('refuses async mappers without leaving a rejection unhandled', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const res = buildODataErrorResponse(new Error('secret'), (() =>
      Promise.reject(new Error('async boom'))) as unknown as ODataErrorMapper)
    expect(res).toEqual(fallback)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Promise/))
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps the 4xx status of non-HttpException errors carrying status/statusCode', () => {
    const httpErrorsStyle = Object.assign(new Error('Payload too large'), { status: 413 })
    expect(buildODataErrorResponse(httpErrorsStyle)).toEqual({
      status: 413,
      body: { error: { code: 'Error', message: 'Payload too large', details: [] } },
    })
    const withStatusCode = Object.assign(new Error('Gone away'), { statusCode: 410 })
    expect(buildODataErrorResponse(withStatusCode).status).toBe(410)
    // Out-of-range or non-numeric statuses are ignored.
    expect(buildODataErrorResponse(Object.assign(new Error('x'), { status: 200 })).status).toBe(500)
    expect(buildODataErrorResponse(Object.assign(new Error('x'), { status: '404' })).status).toBe(
      500,
    )
  })

  it('never sends the message of a 5xx error', () => {
    const res = buildODataErrorResponse(new ServiceUnavailableException('db at 10.0.0.5 is down'))
    expect(res).toEqual({
      status: 503,
      body: {
        error: {
          code: 'ServiceUnavailable',
          message: 'An unexpected error occurred.',
          details: [],
        },
      },
    })
    const carried = Object.assign(new Error('internal path /srv/x'), { status: 502 })
    expect(buildODataErrorResponse(carried).body.error.message).toBe(
      'An unexpected error occurred.',
    )
  })
})

describe('OData JSON §21.1 error shape', () => {
  it('accepts a null target, as the format allows', () => {
    const res = buildODataErrorResponse(new Error('x'), () => ({
      status: 422,
      code: 'X',
      message: 'm',
      target: null,
    }))
    expect(res.body.error).toEqual({ code: 'X', message: 'm', target: null, details: [] })
  })
})

describe('default mapping of wrapped errors', () => {
  it('maps an error by its cause chain (4xx only), without exposing the wrapper', () => {
    const wrapped = new Error('Unit of work failed', {
      cause: new BadRequestException('Bad name'),
    })
    expect(buildODataErrorResponse(wrapped)).toEqual({
      status: 400,
      body: { error: { code: 'BadRequest', message: 'Bad name', details: [] } },
    })
    // A wrapped 5xx stays a redacted 500.
    const internal = new Error('outer', { cause: new Error('db password') })
    expect(buildODataErrorResponse(internal).status).toBe(500)
  })
})
