/**
 * Deep Insert e2e tests.
 *
 * Validates WRITE-02: OData v4 deep insert — POST with nested navigation property
 * arrays creates parent and children atomically in a single transaction.
 *
 * Tests:
 *   - POST /odata/Orders with nested 'items' array creates order + items atomically
 *   - Failed child save rolls back the parent (transaction atomicity)
 *   - POST without nested nav props falls back to normal create (201)
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module.js'
import { Customer, OrderItem, Product } from '../src/entities/index.js'

describe('Deep Insert (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  let dataSource: DataSource
  let customerId: number
  let productId1: number
  let productId2: number

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
    dataSource = moduleFixture.get<DataSource>(DataSource)

    // Seed a customer so orders can reference it
    const customerRepo = dataSource.getRepository(Customer)
    const customer = customerRepo.create({
      firstName: 'Deep',
      lastName: 'Insert',
      email: 'deep-insert@test.com',
    })
    const savedCustomer = await customerRepo.save(customer)
    customerId = savedCustomer.id

    // Seed products so order items can reference them
    const productRepo = dataSource.getRepository(Product)
    const p1 = await productRepo.save(
      productRepo.create({ name: 'Product A', price: 50, active: true, createdAt: new Date() }),
    )
    const p2 = await productRepo.save(
      productRepo.create({ name: 'Product B', price: 100, active: true, createdAt: new Date() }),
    )
    productId1 = p1.id
    productId2 = p2.id
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Test 1: Deep insert creates parent and children atomically ────────────────

  it('deep insert creates order and all items in one transaction', async () => {
    const orderDate = new Date().toISOString()

    const res = await request
      .post('/odata/Orders')
      .send({
        orderDate,
        totalAmount: 200,
        status: 'new',
        customerId,
        items: [
          { quantity: 2, unitPrice: 50, productId: productId1 },
          { quantity: 1, unitPrice: 100, productId: productId2 },
        ],
      })
      .expect(201)

    const body = res.body as { id?: number; '@odata.context'?: string }
    expect(body).toHaveProperty('id')
    const orderId = body.id as number

    // Verify the order was created via HTTP
    const orderRes = await request.get(`/odata/Orders/${orderId}`).expect(200)
    const order = orderRes.body as { id: number; status: string }
    expect(order.id).toBe(orderId)
    expect(order.status).toBe('new')

    // Verify the items were created with correct orderId via DataSource
    const items = await dataSource.getRepository(OrderItem).find({ where: { orderId } })
    expect(items).toHaveLength(2)

    const quantities = items.map((i) => i.quantity).sort((a, b) => a - b)
    expect(quantities).toEqual([1, 2])

    for (const item of items) {
      expect(item.orderId).toBe(orderId)
    }
  })

  // ── Test 2: Deep insert rolls back on child failure ──────────────────────────

  it('deep insert rolls back parent when child fails', async () => {
    // Count orders before
    const beforeRes = await request.get('/odata/Orders/$count').expect(200)
    const countBefore = Number(beforeRes.text)

    // Send a body with a child that will fail at the DB level (missing required productId)
    // SQLite will reject the NOT NULL constraint on productId
    const orderDate = new Date().toISOString()
    const failRes = await request.post('/odata/Orders').send({
      orderDate,
      totalAmount: 100,
      status: 'new',
      customerId,
      items: [
        // productId is required (NOT NULL) — omitting it causes a constraint error
        { quantity: 2, unitPrice: 50 },
      ],
    })

    // Should be an error response
    expect(failRes.status).toBeGreaterThanOrEqual(400)

    // Verify parent was NOT created (order count unchanged)
    const afterRes = await request.get('/odata/Orders/$count').expect(200)
    const countAfter = Number(afterRes.text)
    expect(countAfter).toBe(countBefore)
  })

  // ── Test 3: Normal POST (no nav props) still works ────────────────────────────

  it('POST without nested nav props falls back to normal create', async () => {
    const orderDate = new Date().toISOString()
    const res = await request
      .post('/odata/Orders')
      .send({
        orderDate,
        totalAmount: 50,
        status: 'pending',
        customerId,
      })
      .expect(201)

    const body = res.body as { id: number }
    expect(body.id).toBeDefined()
  })
})
