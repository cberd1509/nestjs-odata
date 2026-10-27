import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestException, HttpException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { buildODataErrorResponse } from './odata-error.js'
import { ODataExceptionFilter } from './odata-exception.filter.js'
import { ODataEmptyResponse } from './odata-empty-response.js'

function makeHost() {
  const headers = new Map<string, string>()
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn(),
    setHeader: vi.fn((k: string, v: string) => headers.set(k, v)),
  }
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost
  return { host, res, headers }
}

describe('Content-Language of OData errors (OData-Protocol 4.01 §9.4, JSON §21.1) — #71', () => {
  it('defaults to en', () => {
    expect(buildODataErrorResponse(new BadRequestException('x')).language).toBe('en')
  })

  it('uses the default language passed by the caller (module option errorLanguage)', () => {
    expect(
      buildODataErrorResponse(new BadRequestException('x'), undefined, {}, 'es-CO').language,
    ).toBe('es-CO')
  })

  it('a mapping may set its own language, which wins over the default', () => {
    const mapper = () => ({ status: 409, code: 'Dup', message: 'Ya existe', language: 'es' })
    expect(buildODataErrorResponse(new Error('x'), mapper, {}, 'de').language).toBe('es')
  })

  it('a mapping with an invalid language tag is rejected (header injection) and the default is used', () => {
    const mapper = () => ({ status: 409, code: 'Dup', message: 'm', language: 'en\r\nX-Evil: 1' })
    const response = buildODataErrorResponse(new BadRequestException('x'), mapper)
    expect(response.status).toBe(400)
    expect(response.language).toBe('en')
  })

  it('the language never appears in the error body', () => {
    const mapper = () => ({ status: 409, code: 'Dup', message: 'm', language: 'es' })
    expect(buildODataErrorResponse(new Error('x'), mapper).body.error).not.toHaveProperty(
      'language',
    )
  })

  it('ODataExceptionFilter sends Content-Language: en by default', () => {
    const { host, headers } = makeHost()
    new ODataExceptionFilter().catch(new BadRequestException('bad'), host)
    expect(headers.get('Content-Language')).toBe('en')
  })

  it('ODataExceptionFilter uses errorLanguage, and the mapping language over it', () => {
    const a = makeHost()
    new ODataExceptionFilter({ errorLanguage: 'fr' }).catch(new BadRequestException('bad'), a.host)
    expect(a.headers.get('Content-Language')).toBe('fr')

    const b = makeHost()
    new ODataExceptionFilter({
      errorLanguage: 'fr',
      errorMapper: () => ({ status: 422, code: 'V', message: 'Ungültig', language: 'de-DE' }),
    }).catch(new Error('x'), b.host)
    expect(b.headers.get('Content-Language')).toBe('de-DE')
  })
})

describe('ODataExceptionFilter — empty responses (#77, #79)', () => {
  it('answers ODataEmptyResponse with its status and no body, without error headers', () => {
    for (const status of [204, 304] as const) {
      const { host, res, headers } = makeHost()
      new ODataExceptionFilter().catch(new ODataEmptyResponse(status), host)
      expect(res.status).toHaveBeenCalledWith(status)
      expect(res.json).not.toHaveBeenCalled()
      expect(res.end).toHaveBeenCalled()
      expect(headers.has('Content-Language')).toBe(false)
      expect(headers.has('Content-Type')).toBe(false)
    }
  })

  it('never runs the errorMapper for ODataEmptyResponse', () => {
    const { host } = makeHost()
    const errorMapper = vi.fn()
    new ODataExceptionFilter({ errorMapper }).catch(new ODataEmptyResponse(304), host)
    expect(errorMapper).not.toHaveBeenCalled()
  })
})

describe('default mapping keeps the details of OData-shaped HttpException bodies', () => {
  it('passes valid details of a 4xx through, never those of a 5xx', () => {
    const details = [{ code: 'UnknownProperty', message: "'x' is unknown", target: 'x' }]
    const bad = new HttpException({ error: { message: 'Bad body', details } }, 400)
    expect(buildODataErrorResponse(bad).body.error).toEqual({
      code: 'BadRequest',
      message: 'Bad body',
      details,
    })
    const internal = new HttpException({ error: { message: 'x', details } }, 500)
    expect(buildODataErrorResponse(internal).body.error.details).toEqual([])
  })
})
