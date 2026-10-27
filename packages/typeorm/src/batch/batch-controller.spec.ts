/**
 * Unit tests for BatchController: operations are dispatched through the application's HTTP
 * handler (here a fake Node request handler), changesets run in one transaction whose entity
 * manager is visible to the operations, and a failed changeset is answered with one error part.
 */
import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException, HttpException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { HttpAdapterHost } from '@nestjs/core'
import { DataSource } from 'typeorm'
import {
  EdmRegistry,
  getODataBatchPart,
  ODATA_BATCH_PART,
  ODATA_MODULE_OPTIONS,
  runWithODataBatchPart,
  runWithODataRequestContext,
} from '@nestjs-odata/core'
import { BatchController, type BatchRequest } from './batch-controller.js'
import { getODataChangesetManager } from './changeset-context.js'
import { ODATA_BATCH_OPTIONS, type ODataBatchOptions } from './batch-options.js'
import { ODATA_CHANGESET_RUNNER } from '../write/changeset-runner.js'

interface Seen {
  method?: string
  url?: string
  headers: IncomingMessage['headers']
  body: string
  manager: unknown
  part: ReturnType<typeof getODataBatchPart>
  /** Set on the injected request (survives a lost async context). */
  attachedPart?: ReturnType<typeof getODataBatchPart>
}

/** What the fake application answers for one `METHOD url`. */
type Route = (seen: Seen) => {
  status: number
  headers?: Record<string, string | string[]>
  body?: unknown
  /** Sent as is (no JSON serialization). */
  raw?: string | Buffer
}

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

/** Products (with a `Supplier` navigation property) and Suppliers. */
function productsEdm(): EdmRegistry {
  const edm = new EdmRegistry()
  edm.register(
    {
      name: 'Product',
      namespace: 'Default',
      keyProperties: ['id'],
      isReadOnly: false,
      properties: [{ name: 'id', type: 'Edm.Int32', nullable: false }],
      navigationProperties: [
        { name: 'Supplier', type: 'Default.Supplier', nullable: true, isCollection: false },
      ],
    },
    { name: 'Products', entityTypeName: 'Product', namespace: 'Default', isReadOnly: false },
  )
  edm.register(
    {
      name: 'Supplier',
      namespace: 'Default',
      keyProperties: ['id'],
      isReadOnly: false,
      properties: [{ name: 'id', type: 'Edm.Int32', nullable: false }],
      navigationProperties: [],
    },
    { name: 'Suppliers', entityTypeName: 'Supplier', namespace: 'Default', isReadOnly: false },
  )
  return edm
}

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
        attachedPart: (req as unknown as Record<symbol, Seen['part']>)[ODATA_BATCH_PART],
      }
      seen.push(s)
      const route = routes[`${req.method} ${req.url}`]
      const out = route
        ? route(s)
        : { status: 404, body: { message: `Cannot ${req.method} ${req.url}`, statusCode: 404 } }
      if (out.status < 0) return // never answers
      res.statusCode = out.status
      for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
      if (out.raw !== undefined) {
        res.end(out.raw)
      } else if (out.body === undefined) {
        res.end()
      } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(out.body))
      }
    })
  }

  async function makeController(
    batchOptions?: ODataBatchOptions,
    edm: EdmRegistry = productsEdm(),
  ): Promise<BatchController> {
    const module = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        { provide: EdmRegistry, useValue: edm },
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
    batchUrl = '/odata/$batch',
    extra: Record<symbol, unknown> = {},
  ): Promise<{ status: number; text: string }> {
    const res = mockResponse()
    const body = [...parts.flatMap((p) => ['--b', p]), '--b--'].join('\r\n')
    const req = {
      ...extra,
      body,
      originalUrl: batchUrl,
      headers: { 'content-type': 'multipart/mixed; boundary=b', ...headers },
    }
    try {
      await controller.handleBatch(req as unknown as BatchRequest, res)
    } catch (err) {
      // Errors of the $batch request itself are thrown, for ODataExceptionFilter to answer.
      if (!(err instanceof HttpException)) throw err
      return { status: err.getStatus(), text: JSON.stringify(err.getResponse()) }
    }
    const sent: unknown = res.send.mock.calls[0]?.[0]
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
    expect(text).toContain('The $batch endpoint is disabled')
    expect(seen).toHaveLength(0)
  })

  it('returns 400 when the content-type boundary is missing', async () => {
    const controller = await makeController()
    await expect(
      controller.handleBatch(
        { body: 'x', headers: { 'content-type': 'multipart/mixed' } } as unknown as BatchRequest,
        mockResponse(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
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

  // ── Review fixes (PR #87) ─────────────────────────────────────────────────

  it('refuses a nested $batch whatever its case, and a $batch run from inside an operation', async () => {
    const controller = await makeController()
    const { text } = await run(controller, [
      op('POST', '/odata/$BATCH', { body: {} }),
      op('POST', '%24Batch', { body: {} }),
    ])
    expect(statuses(text)).toEqual(['400', '400'])
    expect(seen).toHaveLength(0)

    const part = { method: 'POST', url: 'x', inChangeset: false, batchRequest: {} }
    const viaRequest = await run(controller, [op('GET', 'Products(1)')], {}, '/odata/$batch', {
      [ODATA_BATCH_PART]: part,
    })
    expect(viaRequest.status).toBe(400)
    const viaContext = await runWithODataBatchPart(part, () =>
      run(controller, [op('GET', 'Products(1)')]),
    )
    expect(viaContext.status).toBe(400)
    expect(seen).toHaveLength(0)
  })

  it('attaches the operation (and the changeset manager) to the injected request', async () => {
    const controller = await makeController()
    await run(controller, [changeset([op('POST', '/odata/Products', { cid: '1', body: {} })])])
    expect(seen[0]?.attachedPart?.contentId).toBe('1')
    expect(seen[0]?.attachedPart?.changeset).toBe(mockQueryRunner.manager)
  })

  it('fails an operation that does not answer in time, rolling back its changeset (504)', async () => {
    routes['PATCH /odata/Products(7)'] = () => ({ status: -1 })
    const controller = await makeController({ operationTimeout: 30 })
    const { text } = await run(controller, [
      changeset([
        op('POST', '/odata/Products', { cid: '1', body: {} }),
        op('PATCH', '$1', { cid: '2', body: {} }),
      ]),
    ])
    expect(statuses(text)).toEqual(['504'])
    expect(text).toContain('Content-ID: 2')
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledOnce()
  })

  it('entitySets: refuses navigation and $expand into entity sets outside the allow-list', async () => {
    routes['GET /odata/Products(1)/id'] = () => ({ status: 200, body: { value: 1 } })
    const controller = await makeController({ entitySets: ['Products'] })
    const { text } = await run(controller, [
      op('GET', 'Products(1)/Supplier'),
      op('GET', 'Products?$expand=Supplier'),
      // Query option names are case-insensitive for the route: so for the allow-list.
      op('GET', 'Products?$EXPAND=Supplier'),
      op('GET', 'Products?%24Expand=Supplier'),
      op('GET', 'Products?$top=1&$expand=Supplier&$EXPAND=Supplier'),
      op('GET', 'Products(1)/id'),
      op('GET', 'Products?$top=1'),
    ])
    expect(statuses(text)).toEqual(['403', '403', '403', '403', '403', '200', '200'])
    const both = await makeController({ entitySets: ['Products', 'Suppliers'] })
    routes['GET /odata/Products(1)/Supplier'] = () => ({ status: 200, body: { id: 3 } })
    expect(statuses((await run(both, [op('GET', 'Products(1)/Supplier')])).text)).toEqual(['200'])
  })

  it('entitySets: the service root comes from the $batch URL (global prefix equal to the root)', async () => {
    routes['GET /odata/odata/Products(1)'] = () => ({ status: 200, body: { id: 1 } })
    const controller = await makeController({ entitySets: ['Products'] })
    const { text } = await run(controller, [op('GET', 'Products(1)')], {}, '/odata/odata/$batch')
    expect(statuses(text)).toEqual(['200'])
  })

  it("passes a route's own non-OData error through unchanged (status, headers, body)", async () => {
    routes['GET /odata/Products(2)'] = () => ({
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="odata"', 'Retry-After': '5' },
      body: { message: 'login first' },
    })
    const errorMapper = vi.fn(() => undefined)
    const controller = await makeController()
    ;(controller as unknown as { options: Record<string, unknown> }).options = {
      ...mockOptions,
      errorMapper,
    }
    const { text } = await run(controller, [op('GET', '/odata/Products(2)')])
    expect(statuses(text)).toEqual(['401'])
    expect(text).toContain('WWW-Authenticate: Bearer realm="odata"')
    expect(text).toContain('Retry-After: 5')
    expect(text).toContain('{"message":"login first"}')
    expect(errorMapper).not.toHaveBeenCalled()
  })

  it('emits one Set-Cookie line per cookie', async () => {
    routes['GET /odata/Products(1)'] = () => ({
      status: 200,
      headers: { 'Set-Cookie': ['a=1', 'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT'] },
      body: { id: 1 },
    })
    const controller = await makeController()
    const { text } = await run(controller, [op('GET', '/odata/Products(1)')])
    expect(text).toContain('Set-Cookie: a=1\r\n')
    expect(text).toContain('Set-Cookie: b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT\r\n')
  })

  it('keeps binary operation bodies byte for byte', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x80])
    routes['GET /odata/Products(1)/$value'] = () => ({
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
      raw: bytes,
    })
    const controller = await makeController()
    const res = mockResponse()
    const body = ['--b', op('GET', '/odata/Products(1)/$value'), '--b--'].join('\r\n')
    await controller.handleBatch(
      {
        body,
        originalUrl: '/odata/$batch',
        headers: { 'content-type': 'multipart/mixed; boundary=b' },
      } as unknown as BatchRequest,
      res,
    )
    const sent = res.send.mock.calls[0]?.[0] as Buffer
    expect(Buffer.isBuffer(sent)).toBe(true)
    expect(sent.includes(bytes)).toBe(true)
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

  it('ContentID: replaces whole tokens only, with exact IDs', async () => {
    const controller = await makeController()
    const map = new Map([
      ['1', '/odata/Orders(42)'],
      ['10', '/odata/Orders(99)'],
    ])
    const resolve = resolveRef(controller)
    expect(resolve({ method: 'PATCH', url: '$10', headers: {} }, map)['url']).toBe(
      '/odata/Orders(99)',
    )
    expect(resolve({ method: 'GET', url: '$10/Items', headers: {} }, map)['url']).toBe(
      '/odata/Orders(99)/Items',
    )
    // Not a reference: a token elsewhere in the URL, or a longer ID.
    expect(resolve({ method: 'GET', url: 'Orders?$filter=a eq $1', headers: {} }, map)['url']).toBe(
      'Orders?$filter=a eq $1',
    )
    expect(resolve({ method: 'GET', url: '$12', headers: {} }, map)['url']).toBe('$12')
    const body = JSON.stringify({
      note: 'costs $1',
      'Order@odata.bind': '$1',
      'Lines@odata.bind': ['$10', '$1'],
      nested: { link: '$1/Items' },
    })
    const resolved = JSON.parse(
      resolve({ method: 'POST', url: 'Lines', headers: {}, body }, map)['body'] as string,
    ) as Record<string, unknown>
    expect(resolved).toEqual({
      note: 'costs $1',
      'Order@odata.bind': '/odata/Orders(42)',
      'Lines@odata.bind': ['/odata/Orders(99)', '/odata/Orders(42)'],
      nested: { link: '/odata/Orders(42)/Items' },
    })
  })

  it('ContentID: no matching token returns the same part object', async () => {
    const controller = await makeController()
    const part = { kind: 'request' as const, method: 'GET', url: '/odata/Orders', headers: {} }
    expect(resolveRef(controller)(part, new Map([['1', '/odata/Orders(42)']]))).toBe(part)
  })

  // ── Allow-list, body sources and changeset runner edge cases ──────────────

  it('entitySets: $-segments and properties pass; unknown segments and unregistered sets are refused', async () => {
    routes['GET /odata/Products/$count'] = () => ({ status: 200, raw: '3' })
    routes['GET /odata/Products(1)/Supplier/id'] = () => ({ status: 200, body: { value: 3 } })
    const edm = productsEdm()
    const controller = await makeController(
      { entitySets: ['Products', 'Suppliers', 'Ghosts'] },
      edm,
    )
    const { text } = await run(controller, [
      op('GET', 'Products/$count'),
      op('GET', 'Products(1)/Supplier/id'),
      // Neither a navigation nor a structural property of Product.
      op('GET', 'Products(1)/bogus'),
      // Allow-listed, but not an entity set of the EDM.
      op('GET', 'Ghosts'),
      // The service root itself is no entity set.
      op('GET', '/odata/'),
    ])
    expect(statuses(text)).toEqual(['200', '200', '403', '403', '403'])
    expect(seen.map((s) => s.url)).toEqual([
      '/odata/Products/$count',
      '/odata/Products(1)/Supplier/id',
    ])
  })

  it('entitySets: nested $expand targets are checked; an unparsable $expand is left to the route', async () => {
    routes['GET /odata/Products?$expand=Supplier($select=id)'] = () => ({ status: 200, body: {} })
    routes['GET /odata/Products?$expand=(('] = () => ({
      status: 400,
      body: { error: { code: '400', message: 'bad' } },
    })
    const both = await makeController({ entitySets: ['Products', 'Suppliers'] })
    const { text } = await run(both, [
      op('GET', 'Products?$expand=Supplier($select=id)'),
      op('GET', 'Products?$expand=(('),
      op('GET', 'Products?$expand=Supplier/Nope'),
    ])
    expect(statuses(text)).toEqual(['200', '400', '403'])
  })

  it('answers 400 for an operation URL that cannot be parsed', async () => {
    const controller = await makeController()
    const { text } = await run(controller, [op('GET', 'http://[bad')])
    expect(statuses(text)).toEqual(['400'])
    expect(text).toContain('Cannot parse the operation URL')
    expect(seen).toHaveLength(0)
  })

  it('reads the body from req.rawBody (string or Buffer), and falls back to req.url', async () => {
    const controller = await makeController()
    const body = ['--b', op('GET', '/odata/Products(1)'), '--b--'].join('\r\n')
    for (const rawBody of [body, Buffer.from(body)]) {
      const res = mockResponse()
      await controller.handleBatch(
        {
          rawBody,
          url: '/odata/$batch',
          headers: { 'content-type': 'multipart/mixed; boundary=b' },
        } as unknown as BatchRequest,
        res,
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(String(res.send.mock.calls[0]?.[0])).toContain('HTTP/1.1 200 OK')
    }
    expect(seen.map((s) => s.url)).toEqual(['/odata/Products(1)', '/odata/Products(1)'])
  })

  it('answers 400 without a Content-Type, and when the body stream fails or is too large', async () => {
    const controller = await makeController()
    await expect(
      controller.handleBatch({ body: 'x', headers: {} } as unknown as BatchRequest, mockResponse()),
    ).rejects.toThrow('Missing or invalid boundary')

    const failing = new EventEmitter() as unknown as BatchRequest
    failing.headers = { 'content-type': 'multipart/mixed; boundary=b' }
    setImmediate(() =>
      (failing as unknown as EventEmitter).emit('error', new Error('socket hang up')),
    )
    await expect(controller.handleBatch(failing, mockResponse())).rejects.toThrow('socket hang up')

    const huge = new EventEmitter() as unknown as BatchRequest & { destroy: () => void }
    huge.headers = { 'content-type': 'multipart/mixed; boundary=b' }
    huge.destroy = vi.fn()
    setImmediate(() => {
      ;(huge as unknown as EventEmitter).emit('data', Buffer.alloc(6 * 1024 * 1024))
      ;(huge as unknown as EventEmitter).emit('data', Buffer.alloc(6 * 1024 * 1024))
    })
    await expect(controller.handleBatch(huge, mockResponse())).rejects.toThrow(
      'Batch request body exceeds maximum size',
    )
    expect(huge.destroy).toHaveBeenCalled()
  })

  it('runs changesets through the configured changesetRunner, with the request context', async () => {
    const appManager = { name: 'app-unit-of-work' }
    const runner = vi.fn((work: (m: unknown) => Promise<unknown>) => work(appManager))
    const module = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        { provide: EdmRegistry, useValue: productsEdm() },
        { provide: HttpAdapterHost, useValue: { httpAdapter: { getInstance: () => app } } },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ODATA_MODULE_OPTIONS, useValue: mockOptions },
        { provide: ODATA_CHANGESET_RUNNER, useValue: runner },
      ],
    }).compile()
    const controller = module.get(BatchController)
    const request = { user: 'ann' }
    const { text } = await runWithODataRequestContext({ request }, () =>
      run(controller, [changeset([op('POST', '/odata/Products', { cid: '1', body: {} })])]),
    )
    expect(statuses(text)).toEqual(['201'])
    expect(runner).toHaveBeenCalledOnce()
    expect(runner.mock.calls[0]?.[1]).toEqual({ executionContext: undefined, request })
    expect(seen[0]?.manager).toBe(appManager)
    expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled()
  })

  it('ContentID: resolves references nested in objects, leaving non-JSON bodies and scalars alone', async () => {
    const controller = await makeController()
    const map = new Map([['1', '/odata/Orders(42)']])
    const resolve = resolveRef(controller)
    const body = JSON.stringify({ a: { b: ['$1', null, 3, { c: '$1' }] }, n: null })
    expect(
      JSON.parse(resolve({ method: 'POST', url: 'X', headers: {}, body }, map)['body'] as string),
    ).toEqual({ a: { b: ['/odata/Orders(42)', null, 3, { c: '/odata/Orders(42)' }] }, n: null })
    const notJson = { method: 'POST', url: 'X', headers: {}, body: '"$1 not json' }
    expect(resolve(notJson, map)).toBe(notJson)
    const unchanged = { method: 'POST', url: 'X', headers: {}, body: '{"x":"$2"}' }
    expect(resolve(unchanged, map)).toBe(unchanged)
  })
})
