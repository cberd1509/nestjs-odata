/**
 * Unit tests for BatchController: operations are dispatched through the application's HTTP
 * handler (here a fake Node request handler), changesets run in one transaction whose entity
 * manager is visible to the operations, and a failed changeset is answered with one error part.
 */
import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Test } from '@nestjs/testing'
import { HttpAdapterHost } from '@nestjs/core'
import { DataSource } from 'typeorm'
import {
  getODataBatchPart,
  ODATA_MODULE_OPTIONS,
  runWithODataRequestContext,
} from '@nestjs-odata/core'
import { BatchController, type BatchRequest } from './batch-controller.js'
import { getODataChangesetManager } from './changeset-context.js'
import { ODATA_BATCH_OPTIONS, type ODataBatchOptions } from './batch-options.js'

interface Seen {
  method?: string
  url?: string
  headers: IncomingMessage['headers']
  body: string
  manager: unknown
  part: ReturnType<typeof getODataBatchPart>
}

/** What the fake application answers for one `METHOD url`. */
type Route = (seen: Seen) => { status: number; headers?: Record<string, string>; body?: unknown }

const mockQueryRunner = {
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
  manager: { name: 'changeset-manager' },
}

const mockDataSource = {
  createQueryRunner: vi.fn().mockReturnValue(mockQueryRunner),
}

const mockOptions = { serviceRoot: '/odata', errorLanguage: 'en' }

function mockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }
}

describe('BatchController', () => {
  let routes: Record<string, Route>
  let seen: Seen[]

  /** The fake Express application: a Node request handler. */
  const app = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const s: Seen = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
        manager: getODataChangesetManager(),
        part: getODataBatchPart(),
      }
      seen.push(s)
      const route = routes[`${req.method} ${req.url}`]
      const out = route
        ? route(s)
        : { status: 404, body: { message: `Cannot ${req.method} ${req.url}`, statusCode: 404 } }
      res.statusCode = out.status
      for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
      if (out.body === undefined) {
        res.end()
      } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(out.body))
      }
    })
  }

  async function makeController(batchOptions?: ODataBatchOptions): Promise<BatchController> {
    const module = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        { provide: HttpAdapterHost, useValue: { httpAdapter: { getInstance: () => app } } },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ODATA_MODULE_OPTIONS, useValue: mockOptions },
        ...(batchOptions ? [{ provide: ODATA_BATCH_OPTIONS, useValue: batchOptions }] : []),
      ],
    }).compile()
    return module.get(BatchController)
  }

  function op(
    method: string,
    url: string,
    opts: { cid?: string; body?: unknown; headers?: string[] } = {},
  ): string {
    return [
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      ...(opts.cid ? [`Content-ID: ${opts.cid}`] : []),
      '',
      `${method} ${url} HTTP/1.1`,
      ...(opts.headers ?? []),
      ...(opts.body !== undefined
        ? ['Content-Type: application/json', '', JSON.stringify(opts.body)]
        : ['', '']),
    ].join('\r\n')
  }

  function changeset(parts: string[]): string {
    return [
      'Content-Type: multipart/mixed; boundary=cs',
      '',
      ...parts.flatMap((p) => ['--cs', p]),
      '--cs--',
    ].join('\r\n')
  }

  async function run(
    controller: BatchController,
    parts: string[],
    headers: Record<string, string> = {},
  ): Promise<{ status: number; text: string }> {
    const res = mockResponse()
    const body = [...parts.flatMap((p) => ['--b', p]), '--b--'].join('\r\n')
    const req = {
      body,
      originalUrl: '/odata/$batch',
      headers: { 'content-type': 'multipart/mixed; boundary=b', ...headers },
    }
    await controller.handleBatch(req as unknown as BatchRequest, res)
    const sent: unknown = res.send.mock.calls[0]?.[0] ?? JSON.stringify(res.json.mock.calls[0]?.[0])
    return { status: res.status.mock.calls[0]?.[0] as number, text: String(sent) }
  }

  const statuses = (text: string) => [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1])

  beforeEach(() => {
    vi.clearAllMocks()
    mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner)
    seen = []
    routes = {
      'GET /odata/Products?$top=1': () => ({
        status: 200,
        body: { '@odata.context': 'ctx', value: [] },
      }),
      'GET /odata/Products(1)': () => ({
        status: 200,
        headers: { ETag: 'W/"1"' },
        body: { id: 1 },
      }),
      'POST /odata/Products': () => ({
        status: 201,
        headers: { Location: '/odata/Products(7)' },
        body: { id: 7 },
      }),
      'PATCH /odata/Products(7)': () => ({ status: 200, body: { id: 7 } }),
      'DELETE /odata/Products(1)': () => ({
        status: 403,
        headers: { 'Content-Language': 'en' },
        body: { error: { code: 'Forbidden', message: 'Forbidden resource', details: [] } },
      }),
    }
  })

  it('dispatches each operation through the application with its query string', async () => {
    const controller = await makeController()
    const { status, text } = await run(controller, [op('GET', 'Products?$top=1')])
    expect(status).toBe(200)
    expect(seen[0]?.url).toBe('/odata/Products?$top=1')
    expect(text).toContain('HTTP/1.1 200 OK')
    expect(text).toContain('"@odata.context":"ctx"')
  })

  it('operations inherit the batch request headers; their own headers win', async () => {
    const controller = await makeController()
    await run(controller, [op('GET', '/odata/Products(1)', { headers: ['X-Tenant: b'] })], {
      authorization: 'Bearer t',
      'x-tenant': 'a',
      prefer: 'odata.continue-on-error',
    })
    expect(seen[0]?.headers['authorization']).toBe('Bearer t')
    expect(seen[0]?.headers['x-tenant']).toBe('b')
    expect(seen[0]?.headers['prefer']).toBeUndefined()
  })

  it('exposes the operation through getODataBatchPart() while it runs', async () => {
    const controller = await makeController()
    await run(controller, [op('GET', '/odata/Products(1)', { cid: '5' })])
    expect(seen[0]?.part).toMatchObject({
      method: 'GET',
      url: '/odata/Products(1)',
      contentId: '5',
      inChangeset: false,
    })
    expect(seen[0]?.manager).toBeUndefined()
  })

  it('runs a changeset in one transaction, nested in the response, resolving $N', async () => {
    const controller = await makeController()
    const { text } = await run(controller, [
      changeset([
        op('POST', '/odata/Products', { cid: '1', body: { name: 'x' } }),
        op('PATCH', '$1', { cid: '2', body: { name: 'y' } }),
      ]),
    ])
    expect(seen.map((s) => s.url)).toEqual(['/odata/Products', '/odata/Products(7)'])
    expect(seen.every((s) => s.manager === mockQueryRunner.manager)).toBe(true)
    expect(seen.every((s) => s.part?.inChangeset === true)).toBe(true)
    expect(seen[0]?.body).toBe('{"name":"x"}')
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalledOnce()
    expect(text).toMatch(/Content-Type: multipart\/mixed; boundary=changeset_/)
    expect(statuses(text)).toEqual(['201', '200'])
  })

  it('answers a failed changeset with the failing operation alone, and rolls back', async () => {
    const controller = await makeController()
    const { text } = await run(controller, [
      changeset([
        op('POST', '/odata/Products', { cid: '1', body: {} }),
        op('DELETE', '/odata/Products(1)', { cid: '2' }),
        op('PATCH', '/odata/Products(7)', { cid: '3', body: {} }),
      ]),
    ])
    expect(seen).toHaveLength(2) // the operation after the failure does not run
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledOnce()
    expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled()
    expect(statuses(text)).toEqual(['403'])
    expect(text).toContain('Content-ID: 2')
    expect(text).not.toContain('Content-ID: 1')
    expect(text).not.toContain('boundary=changeset_')
    expect(text).toContain('Content-Language: en')
  })

  it('maps changeset-level failures with batch context and the batch request', async () => {
    const controller = await makeController()
    mockQueryRunner.commitTransaction.mockRejectedValueOnce(new Error('commit failed'))
    const errorMapper = vi.fn(() => ({ status: 409, code: 'COMMIT', message: 'retry' }))
    ;(controller as unknown as { options: Record<string, unknown> }).options = {
      ...mockOptions,
      errorMapper,
    }
    const request = { url: '/odata/$batch' }
    const { text } = await runWithODataRequestContext({ request }, () =>
      run(controller, [changeset([op('POST', '/odata/Products', { cid: '1', body: {} })])]),
    )
    expect(errorMapper).toHaveBeenCalledWith(expect.any(Error), {
      request,
      batch: { changeset: true },
    })
    expect(statuses(text)).toEqual(['409'])
  })

  it('answers non-OData errors (no route) as OData errors', async () => {
    const controller = await makeController()
    const { text } = await run(controller, [op('GET', '/odata/Nothing(1)')])
    expect(statuses(text)).toEqual(['404'])
    expect(text).toContain('"error":{"code"')
    expect(text).toContain('Cannot GET /odata/Nothing(1)')
  })

  it('refuses a nested $batch operation (400) without dispatching it', async () => {
    const controller = await makeController()
    const { text } = await run(controller, [op('POST', '$batch', { body: {} })])
    expect(statuses(text)).toEqual(['400'])
    expect(seen).toHaveLength(0)
  })

  it('batch.entitySets: operations on other entity sets answer 403 without dispatching', async () => {
    const controller = await makeController({ entitySets: ['Orders'] })
    const { text } = await run(controller, [
      op('GET', '/odata/Products(1)'),
      op('GET', '/odata/$metadata'),
    ])
    expect(statuses(text)).toEqual(['403', '403'])
    expect(seen).toHaveLength(0)
    const allowed = await makeController({ entitySets: ['Products'] })
    expect(statuses((await run(allowed, [op('GET', 'Products(1)')])).text)).toEqual(['200'])
  })

  it('batch.enabled: false answers 404 for the whole request', async () => {
    const controller = await makeController({ enabled: false })
    const { status, text } = await run(controller, [op('GET', '/odata/Products(1)')])
    expect(status).toBe(404)
    expect(text).toContain('"code":"NotFound"')
    expect(seen).toHaveLength(0)
  })

  it('returns 400 when the content-type boundary is missing', async () => {
    const controller = await makeController()
    const res = mockResponse()
    await controller.handleBatch(
      { body: 'x', headers: { 'content-type': 'multipart/mixed' } } as unknown as BatchRequest,
      res,
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('reads the body from the stream when req.body is empty', async () => {
    const controller = await makeController()
    const fullBody = ['--b', op('GET', '/odata/Products(1)'), '--b--'].join('\r\n')
    const emitter = new EventEmitter()
    const streamReq = emitter as unknown as BatchRequest
    streamReq.headers = { 'content-type': 'multipart/mixed; boundary=b' }
    setImmediate(() => {
      emitter.emit('data', Buffer.from(fullBody))
      emitter.emit('end')
    })
    const res = mockResponse()
    await controller.handleBatch(streamReq, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(String(res.send.mock.calls[0]?.[0])).toContain('HTTP/1.1 200 OK')
  })

  // ── Content-ID reference resolution (WRITE-03) ────────────────────────────

  type ResolveFn = (
    part: Record<string, unknown>,
    map: Map<string, string>,
  ) => Record<string, unknown>
  const resolveRef = (c: BatchController): ResolveFn =>
    (c as unknown as Record<string, (...args: unknown[]) => unknown>)[
      'resolveContentIdReferences'
    ].bind(c) as unknown as ResolveFn

  it('ContentID: an empty map returns the same part object', async () => {
    const controller = await makeController()
    const part = { kind: 'request' as const, method: 'PATCH', url: '$1', headers: {} }
    expect(resolveRef(controller)(part, new Map())).toBe(part)
  })

  it('ContentID: substitutes $1 in the URL (also $1/SubPath) and the body', async () => {
    const controller = await makeController()
    const map = new Map([['1', '/odata/Orders(42)']])
    const resolve = resolveRef(controller)
    expect(resolve({ method: 'PATCH', url: '$1', headers: {} }, map)['url']).toBe(
      '/odata/Orders(42)',
    )
    expect(resolve({ method: 'POST', url: '$1/Items', headers: {} }, map)['url']).toBe(
      '/odata/Orders(42)/Items',
    )
    expect(
      resolve({ method: 'PATCH', url: 'x', headers: {}, body: '{"ref":"$1"}' }, map)['body'],
    ).toContain('/odata/Orders(42)')
  })

  it('ContentID: no matching token returns the same part object', async () => {
    const controller = await makeController()
    const part = { kind: 'request' as const, method: 'GET', url: '/odata/Orders', headers: {} }
    expect(resolveRef(controller)(part, new Map([['1', '/odata/Orders(42)']]))).toBe(part)
  })
})
