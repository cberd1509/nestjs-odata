import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'

/**
 * OData CRUD operations e2e tests.
 *
 * Validates Phase 4 CRUD success criteria (CRUD-01 through CRUD-04):
 *   - POST /odata/Products returns 201 + Location header + OData JSON body
 *   - GET /odata/Products/:key returns single entity without value wrapper
 *   - GET /odata/Products/:key returns 404 for non-existent entity
 *   - PATCH /odata/Products/:key updates entity with merge-patch semantics
 *   - DELETE /odata/Products/:key returns 204 No Content
 */
describe('OData CRUD Operations (e2e)', () => {
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

  // ── POST: Create entity ───────────────────────────────────────────────────────

  it('POST /odata/Products returns 201 + Location header + OData JSON body', async () => {
    const res = await request
      .post('/odata/Products')
      .send({ name: 'Widget', price: 9.99, active: true, createdAt: new Date().toISOString() })
      .expect(201)

    expect(res.body).toHaveProperty('@odata.context')
    expect((res.body as { '@odata.context': string })['@odata.context']).toContain('Products')
    expect(res.body).toHaveProperty('name', 'Widget')
    expect(res.headers).toHaveProperty('location')
    expect(res.headers['location']).toMatch(/Products\(\d+\)/)
  })

  // ── GET by key: Single entity ─────────────────────────────────────────────────

  it('GET /odata/Products/:key returns single entity without value wrapper', async () => {
    // Create an entity first
    const created = await request
      .post('/odata/Products')
      .send({ name: 'Gadget', price: 19.99, active: true, createdAt: new Date().toISOString() })
      .expect(201)

    const keyId = (created.body as { id: number }).id

    const res = await request.get(`/odata/Products/${keyId}`).expect(200)

    expect(res.body).toHaveProperty('@odata.context')
    expect((res.body as { '@odata.context': string })['@odata.context']).toContain('$entity')
    expect(res.body).toHaveProperty('name', 'Gadget')
    // NOT a collection — no value wrapper
    expect(res.body).not.toHaveProperty('value')
  })

  it('GET /odata/Products/:key returns 404 for non-existent entity', async () => {
    await request.get('/odata/Products/999999').expect(404)
  })

  // ── PATCH: Update entity ──────────────────────────────────────────────────────

  it('PATCH /odata/Products/:key updates entity with merge-patch semantics', async () => {
    const created = await request
      .post('/odata/Products')
      .send({ name: 'Patchable', price: 5.0, active: true, createdAt: new Date().toISOString() })
      .expect(201)

    const keyId = (created.body as { id: number }).id

    const res = await request.patch(`/odata/Products/${keyId}`).send({ price: 14.99 }).expect(200)

    // Merge-patch: name unchanged, price updated
    expect(res.body).toHaveProperty('name', 'Patchable')
    expect(Number((res.body as { price: number }).price)).toBeCloseTo(14.99, 1)
  })

  it('PATCH /odata/Products/:key returns 404 for non-existent entity', async () => {
    await request.patch('/odata/Products/999999').send({ price: 14.99 }).expect(404)
  })

  // ── DELETE: Remove entity ──────────────────────────────────────────────────────

  it('DELETE /odata/Products/:key removes entity and returns 204', async () => {
    const created = await request
      .post('/odata/Products')
      .send({ name: 'Disposable', price: 1.0, active: true, createdAt: new Date().toISOString() })
      .expect(201)

    const keyId = (created.body as { id: number }).id

    await request.delete(`/odata/Products/${keyId}`).expect(204)

    // Verify entity no longer exists
    await request.get(`/odata/Products/${keyId}`).expect(404)
  })

  it('DELETE /odata/Products/:key returns 404 for non-existent entity', async () => {
    await request.delete('/odata/Products/999999').expect(404)
  })
})
