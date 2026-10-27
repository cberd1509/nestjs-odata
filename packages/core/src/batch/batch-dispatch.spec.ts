import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  batchOperationHeaders,
  dispatchBatchOperation,
  getODataBatchPart,
  resolveBatchOperationUrl,
  runWithODataBatchPart,
} from './batch-dispatch.js'

/** A plain Node request handler standing in for the Express application. */
function echoHandler(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    res.statusCode = req.url === '/missing' ? 404 : 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('X-Powered-By', 'Express')
    res.setHeader('ETag', 'W/"1"')
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
        part: getODataBatchPart()?.contentId,
      }),
    )
  })
}

const adapter = (instance: unknown) => ({ getInstance: () => instance })

describe('batchOperationHeaders', () => {
  it('inherits the batch request headers, lets the part override them', () => {
    const headers = batchOperationHeaders(
      {
        authorization: 'Bearer t',
        'x-tenant': 'a',
        host: 'api.example.com',
        'accept-language': 'es',
      },
      { 'x-tenant': 'b', 'if-match': 'W/"1"' },
      false,
    )
    expect(headers).toEqual({
      authorization: 'Bearer t',
      'x-tenant': 'b',
      host: 'api.example.com',
      'accept-language': 'es',
      'if-match': 'W/"1"',
    })
  })

  it('never inherits body, batch-level and conditional headers', () => {
    const headers = batchOperationHeaders(
      {
        'content-type': 'multipart/mixed; boundary=b',
        'content-length': '512',
        'transfer-encoding': 'chunked',
        prefer: 'odata.continue-on-error',
        'if-match': '*',
        'if-none-match': '*',
        accept: 'multipart/mixed',
        expect: '100-continue',
        connection: 'keep-alive',
        cookie: 'sid=1',
      },
      {},
      false,
    )
    expect(headers).toEqual({ cookie: 'sid=1' })
  })

  it('joins array-valued headers and defaults a body to application/json', () => {
    expect(batchOperationHeaders({ 'x-a': ['1', '2'] }, {}, true)).toEqual({
      'x-a': '1, 2',
      'content-type': 'application/json',
    })
    expect(batchOperationHeaders({}, { 'content-type': 'text/plain' }, true)).toEqual({
      'content-type': 'text/plain',
    })
  })
})

describe('resolveBatchOperationUrl', () => {
  it('resolves a path relative to the $batch URL (the service root)', () => {
    expect(resolveBatchOperationUrl('Products(1)', '/odata/$batch')).toBe('/odata/Products(1)')
    expect(resolveBatchOperationUrl('Products?$top=1', '/api/odata/$batch?x=1')).toBe(
      '/api/odata/Products?$top=1',
    )
  })

  it('keeps an absolute path and takes the path and query of an absolute URI', () => {
    expect(resolveBatchOperationUrl('/odata/Products(1)', '/odata/$batch')).toBe(
      '/odata/Products(1)',
    )
    expect(
      resolveBatchOperationUrl('https://h.example/odata/Products?$filter=a eq 1', '/odata/$batch'),
    ).toBe('/odata/Products?$filter=a%20eq%201')
  })
})

describe('dispatchBatchOperation', () => {
  it('runs the operation through the application handler and captures the response', async () => {
    const res = await dispatchBatchOperation(adapter(echoHandler), {
      method: 'POST',
      url: '/odata/Products',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: '{"name":"x"}',
    })
    expect(res.statusCode).toBe(200)
    const echoed = JSON.parse(res.body ?? '{}') as {
      method: string
      url: string
      body: string
      headers: Record<string, string>
    }
    expect(echoed.method).toBe('POST')
    expect(echoed.url).toBe('/odata/Products')
    expect(echoed.body).toBe('{"name":"x"}')
    expect(echoed.headers.authorization).toBe('Bearer t')
  })

  it('drops connection-level response headers and keeps the OData ones', async () => {
    const res = await dispatchBatchOperation(adapter(echoHandler), {
      method: 'GET',
      url: '/missing',
      headers: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.headers['etag']).toBe('W/"1"')
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers['date']).toBeUndefined()
  })

  it('keeps the async context of the caller (changeset transactions rely on it)', async () => {
    const store = new AsyncLocalStorage<string>()
    let seen: string | undefined
    const handler = (_req: IncomingMessage, res: ServerResponse) => {
      setImmediate(() => {
        seen = store.getStore()
        res.end()
      })
    }
    const res = await store.run('changeset-1', () =>
      dispatchBatchOperation(adapter(handler), { method: 'DELETE', url: '/x', headers: {} }),
    )
    expect(seen).toBe('changeset-1')
    expect(res.body).toBeUndefined()
  })

  it('exposes the batch part to the application while it runs', async () => {
    const res = await runWithODataBatchPart(
      { method: 'GET', url: '/x', contentId: '4', inChangeset: false, batchRequest: {} },
      () => dispatchBatchOperation(adapter(echoHandler), { method: 'GET', url: '/x', headers: {} }),
    )
    expect((JSON.parse(res.body ?? '{}') as { part: string }).part).toBe('4')
    expect(getODataBatchPart()).toBeUndefined()
  })

  it('uses the platform inject() when the instance has one (Fastify)', async () => {
    const calls: unknown[] = []
    const fastifyLike = {
      inject: (opts: unknown) => {
        calls.push(opts)
        return Promise.resolve({
          statusCode: 201,
          headers: { location: '/odata/P(1)' },
          payload: '{}',
        })
      },
    }
    const res = await dispatchBatchOperation(adapter(fastifyLike), {
      method: 'POST',
      url: '/odata/P',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/odata/P',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      },
    ])
    expect(res).toEqual({ statusCode: 201, headers: { location: '/odata/P(1)' }, body: '{}' })
  })
})
