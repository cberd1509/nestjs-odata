/**
 * OData $batch endpoint e2e tests.
 *
 * Validates BATCH-01, BATCH-02, BATCH-03:
 *   - POST /$batch with individual GET returns multipart/mixed response (BATCH-01)
 *   - POST /$batch with changeset POST+PATCH succeeds atomically (BATCH-02)
 *   - POST /$batch with failing changeset rolls back all operations (BATCH-02)
 *   - Individual request failure does not affect other independent requests (BATCH-03)
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'

const BOUNDARY = 'batch_e2e_test'

/**
 * Build a multipart/mixed batch request body.
 */
function buildBatchBody(parts: string[]): string {
  const lines: string[] = []
  for (const part of parts) {
    lines.push(`--${BOUNDARY}`)
    lines.push(part)
  }
  lines.push(`--${BOUNDARY}--`)
  return lines.join('\r\n')
}

function individualRequest(method: string, url: string, body?: string): string {
  const requestLine =
    body !== undefined
      ? `${method} ${url} HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${body}`
      : `${method} ${url} HTTP/1.1`

  return [
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    requestLine,
  ].join('\r\n')
}

function changeset(changesetParts: string[]): string {
  const csBoundary = 'changeset_e2e'
  const innerLines: string[] = []
  for (const part of changesetParts) {
    innerLines.push(`--${csBoundary}`)
    innerLines.push(part)
  }
  innerLines.push(`--${csBoundary}--`)
  const changesetBody = innerLines.join('\r\n')

  return [`Content-Type: multipart/mixed; boundary=${csBoundary}`, '', changesetBody].join('\r\n')
}

/**
 * Parse a multipart/mixed batch response body and extract per-operation status codes.
 */
function parseResponseStatusCodes(body: string): number[] {
  const httpStatusRegex = /HTTP\/1\.1 (\d{3})/g
  const codes: number[] = []
  let match: RegExpExecArray | null
  while ((match = httpStatusRegex.exec(body)) !== null) {
    codes.push(parseInt(match[1], 10))
  }
  return codes
}

/**
 * Extract the text body from a supertest response.
 * supertest does not set res.text for multipart/mixed content types.
 * We use a custom .parse() function (see postBatch helper) to collect
 * raw bytes and expose them as a string in res.body.
 */
function getResponseText(res: supertest.Response): string {
  if (typeof res.body === 'string' && res.body.length > 0) {
    return res.body
  }
  if (typeof res.text === 'string' && res.text.length > 0) {
    return res.text
  }
  if (Buffer.isBuffer(res.body)) {
    return res.body.toString('utf-8')
  }
  if (res.body instanceof Uint8Array) {
    return Buffer.from(res.body).toString('utf-8')
  }
  return JSON.stringify(res.body)
}

/**
 * POST to /$batch with a raw multipart/mixed body.
 * Uses a custom response parser so supertest exposes the response body as
 * a plain string rather than attempting JSON.parse on multipart/mixed content.
 */
function postBatch(request: ReturnType<typeof supertest>, body: string): supertest.Test {
  return request
    .post('/odata/$batch')
    .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
    .send(body)
    .buffer(true)
    .parse(
      (res: import('http').IncomingMessage, fn: (err: Error | null, data: unknown) => void) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => fn(null, Buffer.concat(chunks).toString('utf-8')))
      },
    )
}

describe('OData $batch endpoint (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    // Disable NestJS default body parsers so we can register them manually
    // in the correct order: text (for multipart/mixed) BEFORE json.
    app = moduleFixture.createNestApplication()

    // Register text body parser for multipart/mixed BEFORE NestJS adds JSON parser.
    // This ensures req.body is a string for $batch requests before the JSON parser
    // reads and discards the stream.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expressLib = require('express') as {
      text: (opts: { type: string | string[]; limit: string }) => unknown
      json: (opts?: { limit?: string }) => unknown
      urlencoded: (opts?: { extended?: boolean; limit?: string }) => unknown
    }
    app.use(
      expressLib.text({
        type: 'multipart/mixed',
        limit: '10mb',
      }),
    )

    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Test 7 (e2e): Individual GET via $batch ─────────────────────────────────

  it('Test 7: POST /$batch with individual GET returns 200 with data in multipart response', async () => {
    // First create a product to GET
    const created = await request
      .post('/odata/Products')
      .send({ name: 'BatchWidget', price: 5.99, active: true, createdAt: new Date().toISOString() })
      .expect(201)

    const productId = (created.body as { id: number }).id

    const body = buildBatchBody([individualRequest('GET', `/odata/Products(${productId})`)])

    const res = await postBatch(request, body)

    const responseText = getResponseText(res)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/multipart\/mixed/)
    expect(responseText).toContain('HTTP/1.1 200 OK')
    expect(responseText).toContain('BatchWidget')
  })

  // ── Test 8 (e2e): Changeset POST+PATCH succeeds ─────────────────────────────

  it('Test 8: POST /$batch with changeset POST+PATCH succeeds, entities created/updated in DB', async () => {
    const postBody = JSON.stringify({
      name: 'ChangesetProduct',
      price: 15.0,
      active: true,
      createdAt: new Date().toISOString(),
    })

    // Create one product first so we can PATCH it
    const existing = await request
      .post('/odata/Products')
      .send({ name: 'ToBePatched', price: 10.0, active: true, createdAt: new Date().toISOString() })
      .expect(201)
    const existingId = (existing.body as { id: number }).id

    const patchBody = JSON.stringify({ price: 99.99 })

    const body = buildBatchBody([
      changeset([
        individualRequest('POST', '/odata/Products', postBody),
        individualRequest('PATCH', `/odata/Products(${existingId})`, patchBody),
      ]),
    ])

    const res = await postBatch(request, body)

    const responseText = getResponseText(res)

    expect(res.status).toBe(200)
    const codes = parseResponseStatusCodes(responseText)
    expect(codes).toContain(201)
    expect(codes).toContain(200)

    // Verify PATCH was applied — use slash key format that matches the NestJS route
    const patched = await request.get(`/odata/Products/${existingId}`).expect(200)
    expect((patched.body as { price: number }).price).toBeCloseTo(99.99, 1)
  })

  // ── Test 9 (e2e): Changeset rollback on failure ─────────────────────────────

  it('Test 9: POST /$batch with failing changeset rolls back all operations — DB unchanged', async () => {
    // Count products before batch
    const beforeRes = await request.get('/odata/Products').expect(200)
    const countBefore = (beforeRes.body as { value: unknown[] }).value.length

    const validPostBody = JSON.stringify({
      name: 'ShouldBeRolledBack',
      price: 1.0,
      active: true,
      createdAt: new Date().toISOString(),
    })

    // PATCH against a non-existent key to force rollback
    const nonExistentKey = 999999
    const failingPatchBody = JSON.stringify({ name: 'WillFail' })

    const body = buildBatchBody([
      changeset([
        individualRequest('POST', '/odata/Products', validPostBody),
        individualRequest('PATCH', `/odata/Products(${nonExistentKey})`, failingPatchBody),
      ]),
    ])

    const res = await postBatch(request, body)

    const responseText = getResponseText(res)

    expect(res.status).toBe(200)
    // Both changeset parts should have error status due to rollback
    const codes = parseResponseStatusCodes(responseText)
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.every((c) => c >= 400)).toBe(true)

    // Verify DB state is unchanged — no new product was added
    const afterRes = await request.get('/odata/Products').expect(200)
    const countAfter = (afterRes.body as { value: unknown[] }).value.length
    expect(countAfter).toBe(countBefore)
  })

  // ── Test 10 (e2e): Independent request isolation ────────────────────────────

  it('Test 10: POST /$batch with individual request failure does not affect other requests', async () => {
    // Create a product to GET successfully
    const existing = await request
      .post('/odata/Products')
      .send({
        name: 'IndependentProduct',
        price: 7.0,
        active: true,
        createdAt: new Date().toISOString(),
      })
      .expect(201)
    const existingId = (existing.body as { id: number }).id

    // Mix a successful GET with a failing GET (non-existent key)
    const body = buildBatchBody([
      individualRequest('GET', `/odata/Products(${existingId})`),
      individualRequest('GET', '/odata/Products(999999)'),
      individualRequest('GET', `/odata/Products(${existingId})`),
    ])

    const res = await postBatch(request, body)

    const responseText = getResponseText(res)

    expect(res.status).toBe(200)
    const codes = parseResponseStatusCodes(responseText)
    expect(codes).toHaveLength(3)
    expect(codes[0]).toBe(200) // First GET succeeds
    expect(codes[1]).toBe(404) // Second GET fails (not found)
    expect(codes[2]).toBe(200) // Third GET still succeeds (BATCH-03)
  })
})
