import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Product, Customer, Order } from '../src/entities/index.js'

/**
 * OData $search and $apply e2e tests.
 *
 * Validates Phase 11 success criteria (SRCH-01, SRCH-02, AGG-01, AGG-02, AGG-03):
 *   - $search returns products matching searchable fields via LIKE
 *   - $search combined with $filter works (AND semantics)
 *   - $apply groupby/aggregate/filter produce correct SQL aggregations
 *   - Aggregated responses use projection context URLs, no entity annotations
 */
describe('OData $search and $apply (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])

    // Seed test data
    const dataSource = app.get(DataSource)
    const productRepo = dataSource.getRepository(Product)
    const customerRepo = dataSource.getRepository(Customer)
    const orderRepo = dataSource.getRepository(Order)

    // Clear existing data (use query builder to avoid empty criteria error)
    await orderRepo.createQueryBuilder().delete().execute()
    await productRepo.createQueryBuilder().delete().execute()
    await customerRepo.createQueryBuilder().delete().execute()

    // Seed products with varied names/descriptions
    const now = new Date().toISOString()
    await productRepo.save([
      Object.assign(new Product(), {
        name: 'Gaming Laptop',
        description: 'High performance gaming laptop with RTX',
        price: 1500,
        active: true,
        createdAt: now,
      }),
      Object.assign(new Product(), {
        name: 'Premium Laptop Pro',
        description: 'Premium laptop for professionals',
        price: 2000,
        active: true,
        createdAt: now,
      }),
      Object.assign(new Product(), {
        name: 'Mechanical Keyboard',
        description: 'Cherry MX Blue switches',
        price: 120,
        active: true,
        createdAt: now,
      }),
      Object.assign(new Product(), {
        name: 'Wireless Mouse',
        description: 'Ergonomic wireless mouse',
        price: 45,
        active: false,
        createdAt: now,
      }),
    ])

    // Seed customers
    const cust1 = await customerRepo.save(
      Object.assign(new Customer(), {
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@test.com',
      }),
    )
    const cust2 = await customerRepo.save(
      Object.assign(new Customer(), {
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@test.com',
      }),
    )

    // Seed orders with varied statuses/amounts/customerIds
    await orderRepo.save([
      Object.assign(new Order(), {
        orderDate: now,
        totalAmount: 100,
        status: 'pending',
        customerId: cust1.id,
      }),
      Object.assign(new Order(), {
        orderDate: now,
        totalAmount: 200,
        status: 'pending',
        customerId: cust1.id,
      }),
      Object.assign(new Order(), {
        orderDate: now,
        totalAmount: 300,
        status: 'shipped',
        customerId: cust1.id,
      }),
      Object.assign(new Order(), {
        orderDate: now,
        totalAmount: 150,
        status: 'pending',
        customerId: cust2.id,
      }),
      Object.assign(new Order(), {
        orderDate: now,
        totalAmount: 250,
        status: 'shipped',
        customerId: cust2.id,
      }),
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  // ── $search ──────────────────────────────────────────────────────────────────

  describe('$search', () => {
    it('returns products matching "laptop" in name or description', async () => {
      const res = await request.get('/odata/Products?$search=laptop').expect(200)

      const body = res.body as {
        '@odata.context': string
        value: { name: string; description: string | null }[]
      }
      expect(body).toHaveProperty('@odata.context')
      expect(body.value).toBeInstanceOf(Array)
      expect(body.value.length).toBe(2)
      expect(
        body.value.every((p) => /laptop/i.test(p.name) || /laptop/i.test(p.description ?? '')),
      ).toBe(true)
    })

    it('searches for exact phrase in quoted string', async () => {
      const res = await request.get('/odata/Products?$search=%22premium%20laptop%22').expect(200)

      const body = res.body as { value: { name: string }[] }
      expect(body.value.length).toBeGreaterThanOrEqual(1)
      // "Premium Laptop Pro" has "premium laptop" in description
      const names = body.value.map((p) => p.name)
      expect(names).toContain('Premium Laptop Pro')
    })

    it('$search combined with $filter works (AND semantics)', async () => {
      const res = await request
        .get('/odata/Products?$search=laptop&$filter=price gt 1800')
        .expect(200)

      const body = res.body as { value: { name: string; price: number }[] }
      expect(body.value.length).toBe(1)
      expect(body.value[0].name).toBe('Premium Laptop Pro')
    })

    it('$search with NOT excludes matching products', async () => {
      const res = await request.get('/odata/Products?$search=NOT keyboard').expect(200)

      const body = res.body as { value: { name: string }[] }
      // "Mechanical Keyboard" should be excluded; "Cherry MX Blue switches" description doesn't contain "keyboard"
      const names = body.value.map((p) => p.name)
      expect(names).not.toContain('Mechanical Keyboard')
      expect(body.value.length).toBeGreaterThanOrEqual(2)
    })

    it('$search on orders matches status field', async () => {
      const res = await request.get('/odata/Orders?$search=pending').expect(200)

      const body = res.body as { value: { status: string }[] }
      expect(body.value.length).toBe(3)
      expect(body.value.every((o) => o.status === 'pending')).toBe(true)
    })
  })

  // ── $apply ───────────────────────────────────────────────────────────────────

  describe('$apply', () => {
    it('groupby with count returns one row per group (AGG-01)', async () => {
      const res = await request
        .get('/odata/Orders?$apply=groupby((customerId),aggregate($count as OrderCount))')
        .expect(200)

      const body = res.body as {
        '@odata.context': string
        value: { customerId: number; OrderCount: number }[]
      }
      expect(body['@odata.context']).toContain('(customerId,OrderCount)')
      expect(body.value).toBeInstanceOf(Array)
      expect(body.value.length).toBe(2) // 2 customers
      // Each row has customerId and OrderCount
      for (const row of body.value) {
        expect(row).toHaveProperty('customerId')
        expect(row).toHaveProperty('OrderCount')
        expect(typeof row.OrderCount).toBe('number')
      }
    })

    it('aggregate with sum returns single aggregated row (AGG-02)', async () => {
      const res = await request
        .get('/odata/Orders?$apply=aggregate(totalAmount with sum as GrandTotal)')
        .expect(200)

      const body = res.body as {
        '@odata.context': string
        value: { GrandTotal: number }[]
      }
      expect(body['@odata.context']).toContain('(GrandTotal)')
      expect(body.value.length).toBe(1)
      // 100 + 200 + 300 + 150 + 250 = 1000
      expect(Number(body.value[0].GrandTotal)).toBe(1000)
    })

    it('filter before groupby applies WHERE clause (AGG-03)', async () => {
      const res = await request
        .get(
          "/odata/Orders?$apply=filter(status eq 'pending')/groupby((customerId),aggregate($count as PendingOrders))",
        )
        .expect(200)

      const body = res.body as {
        value: { customerId: number; PendingOrders: number }[]
      }
      expect(body.value.length).toBe(2) // both customers have pending orders
      // Alice (cust1) has 2 pending, Bob (cust2) has 1 pending
      const totalPending = body.value.reduce((sum, row) => sum + Number(row.PendingOrders), 0)
      expect(totalPending).toBe(3)
    })

    it('aggregate with avg produces correct average', async () => {
      const res = await request
        .get('/odata/Orders?$apply=aggregate(totalAmount with avg as AvgAmount)')
        .expect(200)

      const body = res.body as { value: { AvgAmount: number }[] }
      expect(body.value.length).toBe(1)
      // Average of 100, 200, 300, 150, 250 = 200
      expect(Number(body.value[0].AvgAmount)).toBe(200)
    })

    it('groupby with multiple properties groups correctly', async () => {
      const res = await request
        .get('/odata/Orders?$apply=groupby((customerId,status),aggregate($count as Total))')
        .expect(200)

      const body = res.body as {
        value: { customerId: number; status: string; Total: number }[]
      }
      // cust1: pending(2), shipped(1); cust2: pending(1), shipped(1) = 4 groups
      expect(body.value.length).toBe(4)
    })

    it('$apply combined with $top limits aggregated results', async () => {
      const res = await request
        .get('/odata/Orders?$apply=groupby((customerId),aggregate($count as Total))&$top=1')
        .expect(200)

      const body = res.body as { value: unknown[] }
      expect(body.value.length).toBe(1)
    })

    it('$apply combined with $count=true returns count of groups', async () => {
      const res = await request
        .get('/odata/Orders?$apply=groupby((customerId),aggregate($count as Total))&$count=true')
        .expect(200)

      const body = res.body as { '@odata.count': number; value: unknown[] }
      expect(body['@odata.count']).toBe(2)
    })

    it('aggregated response does not include entity annotations', async () => {
      const res = await request
        .get('/odata/Orders?$apply=aggregate(totalAmount with sum as Total)')
        .expect(200)

      const body = res.body as { value: Record<string, unknown>[] }
      for (const item of body.value) {
        expect(item).not.toHaveProperty('@odata.id')
        expect(item).not.toHaveProperty('@odata.type')
      }
      // Check that navigation links are also absent
      const keys = Object.keys(body.value[0])
      const navLinkKeys = keys.filter((k) => k.includes('@odata.navigationLink'))
      expect(navLinkKeys.length).toBe(0)
    })
  })
})
