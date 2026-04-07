import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'

/**
 * Route isolation e2e tests.
 *
 * Validates Phase 4 route isolation requirements (RESP-03, MOD-05, T-04-14):
 *   - GET /api/health returns plain JSON — no OData envelope
 *   - GET /odata/Products returns OData envelope — @odata.context + value
 *   - ODataResponseInterceptor only activates on routes with ODATA_ROUTE_KEY metadata
 */
describe('Route Isolation (RESP-03, MOD-05)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Non-OData route: /api/health ──────────────────────────────────────────────

  it('GET /api/health returns plain JSON without OData envelope', async () => {
    const res = await request.get('/api/health').expect(200)

    const body = res.body as Record<string, unknown>
    expect(body).toHaveProperty('status', 'ok')
    expect(body).toHaveProperty('timestamp')
    // Must NOT have OData envelope properties (T-04-14)
    expect(body).not.toHaveProperty('@odata.context')
    expect(body).not.toHaveProperty('value')
    expect(body).not.toHaveProperty('@odata.count')
  })

  it('GET /api/health Content-Type is application/json (not OData-specific)', async () => {
    const res = await request.get('/api/health').expect(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  // ── OData route: /odata/Products ──────────────────────────────────────────────

  it('GET /odata/Products returns OData envelope with @odata.context and value', async () => {
    const res = await request.get('/odata/Products').expect(200)

    const body = res.body as Record<string, unknown>
    expect(body).toHaveProperty('@odata.context')
    expect(body).toHaveProperty('value')
    expect(Array.isArray(body['value'])).toBe(true)
  })

  it('GET /odata/Products @odata.context URL contains correct path', async () => {
    const res = await request.get('/odata/Products').expect(200)

    const body = res.body as { '@odata.context': string }
    expect(body['@odata.context']).toContain('/odata/$metadata#Products')
  })
})
