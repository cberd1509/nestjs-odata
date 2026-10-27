/**
 * ODataExceptionFilter on a Fastify-style reply (header()/send() instead of setHeader()/end())
 * and the less common inputs of the default error mapping.
 */
import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { HttpException, Logger } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { ODataExceptionFilter } from './odata-exception.filter.js'
import { ODataEmptyResponse } from './odata-empty-response.js'
import { buildODataErrorResponse } from './odata-error.js'

function fastifyHost() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    header: vi.fn(),
    send: vi.fn(),
  }
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost
  return { host, reply }
}

describe('ODataExceptionFilter on a reply without setHeader()/end()', () => {
  const filter = new ODataExceptionFilter()

  it('sets error headers with header()', () => {
    const { host, reply } = fastifyHost()
    filter.catch(new HttpException('Gone away', 410), host)
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
    expect(reply.header).toHaveBeenCalledWith('Content-Language', 'en')
    expect(reply.status).toHaveBeenCalledWith(410)
    expect(reply.json).toHaveBeenCalledWith({
      error: { code: 'Gone', message: 'Gone away', details: [] },
    })
  })

  it('answers an empty-response signal with send()', () => {
    const { host, reply } = fastifyHost()
    filter.catch(new ODataEmptyResponse(304), host)
    expect(reply.status).toHaveBeenCalledWith(304)
    expect(reply.send).toHaveBeenCalledWith()
    expect(reply.json).not.toHaveBeenCalled()
  })

  it('sends the error body even when the reply has no header method at all', () => {
    const reply = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const host = {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ArgumentsHost
    filter.catch(new HttpException('Nope', 403), host)
    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.json).toHaveBeenCalledOnce()
  })
})

describe('buildODataErrorResponse() default mapping edge cases', () => {
  it('uses the message of an HttpException built with a string response', () => {
    const response = buildODataErrorResponse(new HttpException('Plain text', 409))
    expect(response).toMatchObject({
      status: 409,
      body: { error: { code: 'Conflict', message: 'Plain text' } },
    })
  })

  it('uses a generic message for a carried status whose message is not a string', () => {
    const error = { status: 422, message: { not: 'a string' } }
    expect(buildODataErrorResponse(error).body.error.message).toBe('Request error')
  })

  it('falls back to the default mapping when the mapper throws a non-Error', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const response = buildODataErrorResponse(new HttpException('Boom', 400), () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
      throw 'not an error'
    })
    expect(response.status).toBe(400)
    expect(warn).toHaveBeenCalledWith('errorMapper threw (string). Using the default.')
    warn.mockRestore()
  })
})
