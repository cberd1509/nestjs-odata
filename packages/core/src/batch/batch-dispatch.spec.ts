import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  BatchOperationTimeoutError,
  batchOperationHeaders,
  dispatchBatchOperation,
  inheritedBatchHeaders,
  getODataBatchPart,
  ODATA_BATCH_PART,
  resolveBatchOperationUrl,
  runWithODataBatchPart,
} from './batch-dispatch.js'
import { runWithODataRequestContext } from '../context/odata-request-context.js'

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

/** The headers of an operation of a batch request carrying `batch` headers. */
const ops = (
  batch: Record<string, string | string[]>,
  part: Record<string, string>,
  hasBody: boolean,
) => batchOperationHeaders(inheritedBatchHeaders(batch), part, hasBody)

describe('batchOperationHeaders', () => {
  it('inherits the batch request headers, lets the part override them', () => {
    const headers = ops(
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
      'accept-encoding': 'identity',
    })
  })

  it('never inherits body, batch-level and conditional headers', () => {
    const headers = ops(
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
        'accept-encoding': 'gzip',
        cookie: 'sid=1',
      },
      {},
      false,
    )
    // The operation's response is read in process: always ask for an unencoded body.
    expect(headers).toEqual({ cookie: 'sid=1', 'accept-encoding': 'identity' })
  })

  it('joins array-valued headers and defaults a body to application/json', () => {
    expect(ops({ 'x-a': ['1', '2'] }, {}, true)).toEqual({
      'x-a': '1, 2',
      'content-type': 'application/json',
      'accept-encoding': 'identity',
    })
    expect(ops({}, { 'content-type': 'text/plain', 'content-length': '9' }, true)).toEqual({
      'content-type': 'text/plain',
      'accept-encoding': 'identity',
    })
  })
})

describe('resolveBatchOperationUrl', () => {
  const target = (operationUrl: string, batchUrl: string) => {
    const url = resolveBatchOperationUrl(operationUrl, batchUrl)
    return `${url.pathname}${url.search}`
  }

  it('resolves a path relative to the $batch URL (the service root)', () => {
    expect(target('Products(1)', '/odata/$batch')).toBe('/odata/Products(1)')
    expect(target('Products?$top=1', '/api/odata/$batch?x=1')).toBe('/api/odata/Products?$top=1')
  })

  it('keeps an absolute path and takes the path and query of an absolute URI', () => {
    expect(target('/odata/Products(1)', '/odata/$batch')).toBe('/odata/Products(1)')
    expect(target('https://h.example/odata/Products?$filter=a eq 1', '/odata/$batch')).toBe(
      '/odata/Products?$filter=a%20eq%201',
    )
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
    const echoed = JSON.parse(String(res.body ?? '{}')) as {
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
    expect((JSON.parse(String(res.body ?? '{}')) as { part: string }).part).toBe('4')
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
          rawPayload: Buffer.from('{}'),
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
    expect(res).toEqual({
      statusCode: 201,
      headers: { location: '/odata/P(1)' },
      body: Buffer.from('{}'),
    })
  })

  it('never passes a stale Content-Length to inject() (body rewritten by $N substitution)', async () => {
    const calls: { headers: Record<string, string> }[] = []
    const fastifyLike = {
      inject: (opts: { headers: Record<string, string> }) => {
        calls.push(opts)
        return Promise.resolve({ statusCode: 204, headers: {}, rawPayload: Buffer.alloc(0) })
      },
    }
    await dispatchBatchOperation(adapter(fastifyLike), {
      method: 'PATCH',
      url: '/odata/P(1)',
      headers: ops({}, { 'content-type': 'application/json', 'content-length': '3' }, true),
      body: '{"ref":"/odata/P(1)"}',
    })
    expect(calls[0]?.headers['content-length']).toBeUndefined()
  })

  it('keeps multi-valued response headers (Set-Cookie) as separate values', async () => {
    const handler = (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT'])
      res.end()
    }
    const res = await dispatchBatchOperation(adapter(handler), {
      method: 'GET',
      url: '/',
      headers: {},
    })
    expect(res.headers['set-cookie']).toEqual([
      'a=1; Path=/',
      'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
    ])
  })

  it('asks for an identity encoding and drops Content-Encoding from the part', async () => {
    let acceptEncoding: string | undefined
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      acceptEncoding = req.headers['accept-encoding']
      res.setHeader('Content-Encoding', 'identity')
      res.setHeader('Content-Type', 'application/json')
      res.end('{}')
    }
    const res = await dispatchBatchOperation(adapter(handler), {
      method: 'GET',
      url: '/',
      headers: ops({ 'accept-encoding': 'gzip, br' }, {}, false),
    })
    expect(acceptEncoding).toBe('identity')
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('keeps a binary response body as bytes', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x80, 0xfe])
    const handler = (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'image/jpeg')
      res.end(bytes)
    }
    const res = await dispatchBatchOperation(adapter(handler), {
      method: 'GET',
      url: '/',
      headers: {},
    })
    expect(Buffer.isBuffer(res.body)).toBe(true)
    expect(Buffer.compare(res.body as Buffer, bytes)).toBe(0)
  })

  it('rejects an operation that does not end within the timeout', async () => {
    const hang = () => undefined // never answers
    await expect(
      dispatchBatchOperation(adapter(hang), {
        method: 'GET',
        url: '/',
        headers: {},
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(BatchOperationTimeoutError)
  })

  it('runs as the given batch part: in its async context and attached to the request', async () => {
    const part = { method: 'GET', url: '/', contentId: '3', inChangeset: true, batchRequest: {} }
    let attached: unknown
    let fromContext: unknown
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      attached = (req as unknown as Record<symbol, unknown>)[ODATA_BATCH_PART]
      fromContext = getODataBatchPart({})
      res.end()
    }
    await dispatchBatchOperation(adapter(handler), { method: 'GET', url: '/', headers: {} }, part)
    expect(attached).toBe(part)
    expect(fromContext).toBe(part)
  })
})

describe('getODataBatchPart', () => {
  const part = { method: 'GET', url: '/x', contentId: '1', inChangeset: false, batchRequest: {} }

  it('reads the part attached to the request, before the async context', () => {
    const other = { ...part, contentId: 'wrong context' }
    const request = { [ODATA_BATCH_PART]: part }
    expect(runWithODataBatchPart(other, () => getODataBatchPart(request))).toBe(part)
    // From the request of the OData request context too.
    expect(
      runWithODataRequestContext({ request }, () =>
        runWithODataBatchPart(other, () => getODataBatchPart()),
      ),
    ).toBe(part)
  })

  it('falls back to the async context', () => {
    expect(runWithODataBatchPart(part, () => getODataBatchPart({}))).toBe(part)
  })
})

describe('batchOperationHeaders: HTTP/2 pseudo-headers', () => {
  it('never inherits pseudo-headers', () => {
    expect(
      ops({ ':authority': 'h', ':path': '/odata/$batch', 'x-a': '1' }, { ':method': 'GET' }, false),
    ).toEqual({ 'x-a': '1', 'accept-encoding': 'identity' })
  })
})
