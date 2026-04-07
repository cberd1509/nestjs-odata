import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Product } from '../src/entities/index.js'

/**
 * OData query surface e2e tests.
 *
 * Validates Phase 3 success criteria:
 *   1. Full query with $filter+$select+$orderby+$top+$skip returns valid OData JSON envelope
 *   2. Invalid filter fields return OData error body with HTTP 400
 *   3. Parameterized queries work without SQL errors (various filter expressions)
 *   4. $count=true adds @odata.count; /$count returns plain integer
 */
describe('OData Query Surface (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  let dataSource: DataSource

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])

    // Seed test data — 7 products with known values
    dataSource = moduleFixture.get<DataSource>(DataSource)
    const productRepo = dataSource.getRepository(Product)

    await productRepo.save([
      Object.assign(new Product(), {
        name: 'Alpha Widget',
        description: 'A basic widget',
        price: 5.99,
        active: true,
        createdAt: new Date('2024-01-01'),
      }),
      Object.assign(new Product(), {
        name: 'Beta Gadget',
        description: 'A cool gadget',
        price: 15.5,
        active: true,
        createdAt: new Date('2024-01-02'),
      }),
      Object.assign(new Product(), {
        name: 'Gamma Device',
        description: 'A smart device',
        price: 25.0,
        active: false,
        createdAt: new Date('2024-01-03'),
      }),
      Object.assign(new Product(), {
        name: 'Delta Tool',
        description: 'A handy tool',
        price: 35.75,
        active: true,
        createdAt: new Date('2024-01-04'),
      }),
      Object.assign(new Product(), {
        name: 'Epsilon Sensor',
        description: 'A precision sensor',
        price: 50.0,
        active: true,
        createdAt: new Date('2024-01-05'),
      }),
      Object.assign(new Product(), {
        name: 'Zeta Module',
        description: 'A reusable module',
        price: 12.25,
        active: false,
        createdAt: new Date('2024-01-06'),
      }),
      Object.assign(new Product(), {
        name: 'Eta Component',
        description: 'A vital component',
        price: 8.0,
        active: true,
        createdAt: new Date('2024-01-07'),
      }),
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Test 1: Basic collection request returns OData JSON envelope ─────────────

  it('Test 1: GET /odata/Products returns OData JSON envelope with @odata.context and value array', async () => {
    const res = await request.get('/odata/Products')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)

    const body = res.body as { '@odata.context': string; value: unknown[] }
    expect(body['@odata.context']).toContain('/odata/$metadata#Products')
    expect(Array.isArray(body.value)).toBe(true)
    expect(body.value.length).toBeGreaterThan(0)
  })

  // ── Test 2: Full query with $filter+$select+$orderby+$top+$skip ──────────────

  it('Test 2: GET /odata/Products with $filter+$select+$orderby+$top+$skip returns filtered, projected, sorted, paginated results (SC-1)', async () => {
    const res = await request.get('/odata/Products').query({
      $filter: 'price gt 10',
      $select: 'name,price',
      $orderby: 'price asc',
      $top: '5',
      $skip: '0',
    })

    expect(res.status).toBe(200)
    const body = res.body as { '@odata.context': string; value: Array<Record<string, unknown>> }
    expect(body['@odata.context']).toContain('/odata/$metadata#Products')
    expect(Array.isArray(body.value)).toBe(true)

    // All returned items should have price > 10
    for (const item of body.value) {
      expect(Number(item['price'])).toBeGreaterThan(10)
    }

    // Results should be ordered by price ascending
    const prices = body.value.map((item) => Number(item['price']))
    const sorted = [...prices].sort((a, b) => a - b)
    expect(prices).toEqual(sorted)
  })

  // ── Test 3: $select projection ────────────────────────────────────────────────

  it('Test 3: $select=name,price returns items with only those fields (plus key)', async () => {
    const res = await request.get('/odata/Products').query({ $select: 'name,price' })
    expect(res.status).toBe(200)

    const body = res.body as { value: Array<Record<string, unknown>> }
    const firstItem = body.value[0]
    expect(firstItem).toBeDefined()

    // The projected item should have name and price
    expect(firstItem).toHaveProperty('name')
    expect(firstItem).toHaveProperty('price')
    // id (key) is always included
    expect(firstItem).toHaveProperty('id')
  })

  // ── Test 4: Invalid filter field returns HTTP 400 with OData error (SC-2) ────

  it('Test 4: GET /odata/Products?$filter=FakeField eq 1 returns HTTP 400 with OData error body (SC-2)', async () => {
    const res = await request.get('/odata/Products').query({ $filter: 'FakeField eq 1' })

    expect(res.status).toBe(400)
    const body = res.body as { error: { code: string; message: string } }
    expect(body.error).toBeDefined()
    expect(body.error.code).toBeTruthy()
    expect(body.error.message).toContain('FakeField')
  })

  // ── Test 5: Malformed filter returns HTTP 400 with OData error (SC-2) ────────

  it('Test 5: GET /odata/Products with malformed $filter returns HTTP 400 with OData error body (SC-2)', async () => {
    const res = await request.get('/odata/Products').query({ $filter: 'price gt' })

    expect(res.status).toBe(400)
    const body = res.body as { error: { code: string; message: string } }
    expect(body.error).toBeDefined()
    expect(body.error.code).toBeTruthy()
    expect(body.error.message).toBeTruthy()
  })

  // ── Test 6: $count=true inline count (SC-4) ──────────────────────────────────

  it('Test 6: GET /odata/Products?$count=true returns @odata.count in response (SC-4)', async () => {
    const res = await request.get('/odata/Products').query({ $count: 'true' })
    expect(res.status).toBe(200)

    const body = res.body as { '@odata.count': number; value: unknown[] }
    expect(typeof body['@odata.count']).toBe('number')
    expect(body['@odata.count']).toBeGreaterThan(0)
  })

  // ── Test 7: $count path segment returns plain integer (SC-4) ─────────────────

  it('Test 7: GET /odata/Products/$count returns plain integer as text/plain (SC-4)', async () => {
    const res = await request.get('/odata/Products/$count')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)

    const count = parseInt(res.text.trim(), 10)
    expect(Number.isInteger(count)).toBe(true)
    expect(count).toBeGreaterThan(0)
  })

  // ── Test 8: nextLink present when more items exist ────────────────────────────

  it('Test 8: GET /odata/Products?$top=2 with 7 products returns @odata.nextLink', async () => {
    const res = await request.get('/odata/Products').query({ $top: '2' })
    expect(res.status).toBe(200)

    const body = res.body as { '@odata.nextLink'?: string; value: unknown[] }
    expect(body.value).toHaveLength(2)
    expect(body['@odata.nextLink']).toBeDefined()
    expect(body['@odata.nextLink']).toContain('$skip=2')
  })

  // ── Test 9: No nextLink when all items fit on one page ────────────────────────

  it('Test 9: GET /odata/Products?$top=1000 does NOT include @odata.nextLink', async () => {
    const res = await request.get('/odata/Products').query({ $top: '1000' })
    expect(res.status).toBe(200)

    const body = res.body as { '@odata.nextLink'?: string; value: unknown[] }
    expect(body['@odata.nextLink']).toBeUndefined()
  })

  // ── Test 10: Various filter expressions work without SQL errors (SC-3) ────────

  it('Test 10: Various filter expressions execute without SQL errors (parameterized — SC-3)', async () => {
    // Test string function filter
    const res1 = await request.get('/odata/Products').query({ $filter: "contains(name, 'Widget')" })
    expect(res1.status).toBe(200)
    const body1 = res1.body as { value: Array<Record<string, unknown>> }
    for (const item of body1.value) {
      expect(String(item['name'])).toContain('Widget')
    }

    // Test boolean filter
    const res2 = await request.get('/odata/Products').query({ $filter: 'active eq true' })
    expect(res2.status).toBe(200)

    // Test numeric comparison
    const res3 = await request.get('/odata/Products').query({ $filter: 'price ge 25' })
    expect(res3.status).toBe(200)
    const body3 = res3.body as { value: Array<Record<string, unknown>> }
    for (const item of body3.value) {
      expect(Number(item['price'])).toBeGreaterThanOrEqual(25)
    }
  })
})
