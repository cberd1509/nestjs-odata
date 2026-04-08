import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Customer } from '../src/entities/index.js'

/**
 * OData PUT full entity replacement e2e tests.
 *
 * Validates WRITE-01: PUT replaces entire entity — all unspecified fields
 * reset to column defaults (null for nullable, default value otherwise).
 *
 * Uses the Orders entity set which has:
 *   - status: varchar with default='pending'
 *   - orderDate: datetime (not nullable, no default)
 *   - totalAmount: decimal (not nullable, no default)
 *   - customerId: integer (FK, not nullable)
 *
 * NOTE: NestJS routes use `:key` which matches /odata/Orders/:key (slash format).
 * The OData parenthetical key format (Orders(1)) is passed as the key string to
 * parseODataKey, which strips the parens. Direct HTTP requests use slash format.
 */
describe('OData PUT Full Replacement (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  let dataSource: DataSource
  let customerId: number

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
    dataSource = moduleFixture.get<DataSource>(DataSource)

    // Seed a customer directly via DataSource so orders can reference it
    const customerRepo = dataSource.getRepository(Customer)
    const customer = customerRepo.create({
      firstName: 'Put',
      lastName: 'Test',
      email: 'put-test@example.com',
    })
    const savedCustomer = await customerRepo.save(customer)
    customerId = savedCustomer.id
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Helper: create an order via POST ─────────────────────────────────────

  async function createOrder(overrides: Record<string, unknown> = {}): Promise<number> {
    const res = await request
      .post('/odata/Orders')
      .send({
        orderDate: '2024-01-01T00:00:00.000Z',
        totalAmount: 100,
        status: 'shipped',
        customerId,
        ...overrides,
      })
      .expect(201)
    return (res.body as { id: number }).id
  }

  // ── Test 1: PUT returns 200 with replaced entity body ─────────────────────

  it('PUT /odata/Orders/:key returns 200 with the replaced entity', async () => {
    const orderId = await createOrder()

    const res = await request
      .put(`/odata/Orders/${orderId}`)
      .send({
        orderDate: '2024-06-01T00:00:00.000Z',
        totalAmount: 50,
        customerId,
      })
      .expect(200)

    expect(res.body).toHaveProperty('id', orderId)
    expect(Number((res.body as { totalAmount: number }).totalAmount)).toBeCloseTo(50, 1)
  })

  // ── Test 2: PUT resets unspecified fields to column defaults ──────────────

  it('PUT with omitted status resets status to column default "pending"', async () => {
    const orderId = await createOrder({ status: 'shipped' })

    // PUT without status field
    await request
      .put(`/odata/Orders/${orderId}`)
      .send({
        orderDate: '2024-06-01T00:00:00.000Z',
        totalAmount: 50,
        customerId,
      })
      .expect(200)

    // GET and verify status was reset to 'pending' (column default)
    const getRes = await request.get(`/odata/Orders/${orderId}`).expect(200)

    expect((getRes.body as { status: string }).status).toBe('pending')
  })

  // ── Test 3: PUT with nonexistent key returns 404 ──────────────────────────

  it('PUT /odata/Orders/99999 returns 404', async () => {
    const res = await request
      .put('/odata/Orders/99999')
      .send({
        orderDate: '2024-06-01T00:00:00.000Z',
        totalAmount: 50,
        customerId,
      })
      .expect(404)

    // OData error format from ODataExceptionFilter
    expect(res.body).toHaveProperty('error')
  })

  // ── Test 4: PUT with body key mismatch returns 400 ───────────────────────

  it('PUT /odata/Orders/:key with different id in body returns 400', async () => {
    const orderId = await createOrder()

    const res = await request
      .put(`/odata/Orders/${orderId}`)
      .send({
        id: orderId + 9999, // mismatch
        orderDate: '2024-06-01T00:00:00.000Z',
        totalAmount: 50,
        customerId,
      })
      .expect(400)

    expect(res.body).toHaveProperty('error')
  })

  // ── Test 5: PUT preserves explicitly provided fields ─────────────────────

  it('PUT with explicit status value preserves the provided status', async () => {
    const orderId = await createOrder({ status: 'pending' })

    // PUT with explicit status='confirmed'
    await request
      .put(`/odata/Orders/${orderId}`)
      .send({
        orderDate: '2024-06-01T00:00:00.000Z',
        totalAmount: 75,
        status: 'confirmed',
        customerId,
      })
      .expect(200)

    const getRes = await request.get(`/odata/Orders/${orderId}`).expect(200)

    expect((getRes.body as { status: string }).status).toBe('confirmed')
  })

  // ── Test 6: PUT in $batch changeset works ────────────────────────────────
  // NOTE: $batch uses the OData parenthetical URL format (Orders(key)) internally
  // since the batch parser sees the raw sub-request URL and the BatchController
  // parses it with parseEntityUrl() which handles the parenthetical format.

  it('PUT in $batch changeset succeeds and resets status to default', async () => {
    const orderId = await createOrder({ status: 'shipped' })

    const boundary = 'batch_put_test'
    const csBoundary = 'changeset_put_test'

    const putBody = JSON.stringify({
      orderDate: '2024-06-01T00:00:00.000Z',
      totalAmount: 88,
      customerId,
      // status omitted — should reset to 'pending'
    })

    // Batch uses the OData parenthetical key format in sub-request URLs
    const batchBody = [
      `--${boundary}`,
      `Content-Type: multipart/mixed; boundary=${csBoundary}`,
      '',
      `--${csBoundary}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      `PUT /odata/Orders(${orderId}) HTTP/1.1`,
      'Content-Type: application/json',
      '',
      putBody,
      `--${csBoundary}--`,
      `--${boundary}--`,
    ].join('\r\n')

    const batchRes = await request
      .post('/odata/$batch')
      .set('Content-Type', `multipart/mixed; boundary=${boundary}`)
      .send(batchBody)
      .expect(200)

    // Response should be multipart/mixed
    expect(batchRes.headers['content-type']).toContain('multipart/mixed')

    // Verify the order was actually replaced (use slash format for direct HTTP)
    const getRes = await request.get(`/odata/Orders/${orderId}`).expect(200)

    expect((getRes.body as { status: string }).status).toBe('pending')
    expect(Number((getRes.body as { totalAmount: number }).totalAmount)).toBeCloseTo(88, 1)
  })
})
