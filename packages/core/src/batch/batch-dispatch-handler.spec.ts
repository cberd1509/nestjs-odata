/**
 * In-process dispatch of $batch operations into a plain Node request handler (the Express
 * path): how the response stand-in collects the body, and how failures are reported.
 */
import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  batchErrorContext,
  dispatchBatchOperation,
  headerValue,
  parseBatchUrl,
  resolveBatchOperationUrl,
} from './batch-dispatch.js'

const adapter = (instance: unknown) => ({ getInstance: () => instance })
const op = { method: 'get', url: '/odata/Products', headers: {} }

describe('headerValue', () => {
  it('returns a single header as is and the first of repeated headers', () => {
    expect(headerValue('a')).toBe('a')
    expect(headerValue(['first', 'second'])).toBe('first')
    expect(headerValue(undefined)).toBeUndefined()
    expect(headerValue([])).toBeUndefined()
  })
})

describe('batchErrorContext', () => {
  it('keeps only method, url and contentId of the part', () => {
    const part = { method: 'POST', url: '/odata/P', contentId: '1', extra: true }
    expect(batchErrorContext(part)).toEqual({ method: 'POST', url: '/odata/P', contentId: '1' })
  })
})

describe('resolveBatchOperationUrl with a parsed batch URL', () => {
  it('accepts an already parsed URL as the base', () => {
    const url = resolveBatchOperationUrl('Products?$top=1', parseBatchUrl('/odata/$batch'))
    expect(url.pathname + url.search).toBe('/odata/Products?$top=1')
  })
})

describe('dispatchBatchOperation into a request handler', () => {
  it('collects strings (with their encoding), Buffers and Uint8Arrays written to the response', async () => {
    const handler = (_req: IncomingMessage, res: ServerResponse): void => {
      res.statusCode = 201
      res.write('café', 'latin1')
      res.write(Buffer.from('-buf'))
      res.write(new Uint8Array([45, 117, 56]))
      res.end('-end')
    }
    const response = await dispatchBatchOperation(adapter(handler), op)
    expect(response.statusCode).toBe(201)
    expect(response.body?.toString('latin1')).toBe('café-buf-u8-end')
  })

  it('calls write() callbacks, whether passed as the encoding or the callback argument', async () => {
    const calls: string[] = []
    const handler = (_req: IncomingMessage, res: ServerResponse): void => {
      res.write('a', () => calls.push('as-encoding'))
      res.write('b', 'utf-8', () => {
        calls.push('as-callback')
        res.end()
      })
    }
    const response = await dispatchBatchOperation(adapter(handler), op)
    expect(calls).toEqual(['as-encoding', 'as-callback'])
    expect(response.body?.toString()).toBe('ab')
  })

  it('returns no body for an empty response', async () => {
    const handler = (_req: IncomingMessage, res: ServerResponse): void => {
      res.statusCode = 204
      res.end()
    }
    const response = await dispatchBatchOperation(adapter(handler), op)
    expect(response).toMatchObject({ statusCode: 204, body: undefined })
  })

  it('passes the client address of the batch request to the operation', async () => {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      res.end(req.socket.remoteAddress)
    }
    const fromClient = await dispatchBatchOperation(adapter(handler), {
      ...op,
      remoteAddress: '10.0.0.7',
    })
    expect(fromClient.body?.toString()).toBe('10.0.0.7')
    const local = await dispatchBatchOperation(adapter(handler), op)
    expect(local.body?.toString()).toBe('127.0.0.1')
  })

  it('gives the handler a socket that supports the connection methods platforms call', async () => {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      const socket = req.socket
      const same = [
        socket.setTimeout(10),
        socket.setNoDelay(true),
        socket.setKeepAlive(true),
        socket.pause(),
        socket.resume(),
      ].every((s) => s === socket)
      res.end(String(same))
    }
    const response = await dispatchBatchOperation(adapter(handler), op)
    expect(response.body?.toString()).toBe('true')
  })

  it('rejects when the handler throws an Error', async () => {
    const handler = (): void => {
      throw new Error('boom')
    }
    await expect(dispatchBatchOperation(adapter(handler), op)).rejects.toThrow('boom')
  })

  it('wraps a thrown non-Error value in an Error', async () => {
    const handler = (): void => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
      throw 'plain string'
    }
    await expect(dispatchBatchOperation(adapter(handler), op)).rejects.toThrow('plain string')
  })

  it('rejects when the response is closed before it ends', async () => {
    const handler = (_req: IncomingMessage, res: ServerResponse): void => {
      res.destroy()
    }
    await expect(dispatchBatchOperation(adapter(handler), op)).rejects.toThrow(
      '$batch operation: the response was closed before it ended',
    )
  })

  it('rejects when the adapter instance can neither inject nor handle requests', async () => {
    await expect(dispatchBatchOperation(adapter({}), op)).rejects.toThrow(
      '$batch: the HTTP adapter instance cannot dispatch requests in process',
    )
  })

  it('does not send an empty body as a payload', async () => {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      res.end(String(req.headers['content-length']))
    }
    const response = await dispatchBatchOperation(adapter(handler), { ...op, body: '' })
    expect(response.body?.toString()).toBe('undefined')
  })

  it('ignores a timeout that is not a positive finite number', async () => {
    const handler = (_req: IncomingMessage, res: ServerResponse): void => {
      setTimeout(() => res.end('late'), 5)
    }
    for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY]) {
      const response = await dispatchBatchOperation(adapter(handler), { ...op, timeoutMs })
      expect(response.body?.toString()).toBe('late')
    }
  })
})
