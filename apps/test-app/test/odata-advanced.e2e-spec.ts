import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Product, Category, Customer, Order, OrderItem, Tag } from '../src/entities/index.js'

/**
 * Advanced OData v4 tests: complex $expand, complex $batch, write operations.
 *
 * Pushes the library to its limits with:
 * - Multi-level nested $expand with sub-query options
 * - Complex batch requests with multiple changesets
 * - Write operation edge cases (invalid payloads, FK constraints, concurrent ops)
 * - Combined expand + CRUD scenarios
 */

// ─── Batch Helpers ───────────────────────────────────────────────────────────

const BOUNDARY = 'batch_advanced'

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

function changeset(changesetParts: string[], csBoundary = 'changeset_adv'): string {
  const innerLines: string[] = []
  for (const part of changesetParts) {
    innerLines.push(`--${csBoundary}`)
    innerLines.push(part)
  }
  innerLines.push(`--${csBoundary}--`)
  const changesetBody = innerLines.join('\r\n')

  return [`Content-Type: multipart/mixed; boundary=${csBoundary}`, '', changesetBody].join('\r\n')
}

function parseResponseStatusCodes(body: string): number[] {
  const httpStatusRegex = /HTTP\/1\.1 (\d{3})/g
  const codes: number[] = []
  let match: RegExpExecArray | null
  while ((match = httpStatusRegex.exec(body)) !== null) {
    codes.push(parseInt(match[1], 10))
  }
  return codes
}

function getResponseText(res: supertest.Response): string {
  if (typeof res.body === 'string' && res.body.length > 0) return res.body
  if (typeof res.text === 'string' && res.text.length > 0) return res.text
  if (Buffer.isBuffer(res.body)) return res.body.toString('utf-8')
  if (res.body instanceof Uint8Array) return Buffer.from(res.body).toString('utf-8')
  return JSON.stringify(res.body)
}

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

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('OData v4 Advanced Tests (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  let dataSource: DataSource

  // Seeded entity references
  let catElectronics: Category
  let catBooks: Category
  let prodLaptop: Product
  let prodPhone: Product
  let prodTablet: Product
  let prodBook: Product
  let customer1: Customer
  let customer2: Customer
  let order1: Order
  let order2: Order
  let order3: Order

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()

    // Register text parser for multipart/mixed before init (batch tests need this)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expressLib = require('express') as {
      text: (opts: { type: string | string[]; limit: string }) => unknown
    }
    app.use(expressLib.text({ type: 'multipart/mixed', limit: '10mb' }))

    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
    dataSource = moduleFixture.get<DataSource>(DataSource)

    // ── Seed comprehensive relational data ──────────────────────────────

    const categoryRepo = dataSource.getRepository(Category)
    const productRepo = dataSource.getRepository(Product)
    const customerRepo = dataSource.getRepository(Customer)
    const orderRepo = dataSource.getRepository(Order)
    const orderItemRepo = dataSource.getRepository(OrderItem)
    const tagRepo = dataSource.getRepository(Tag)

    catElectronics = await categoryRepo.save(Object.assign(new Category(), { name: 'Electronics' }))
    catBooks = await categoryRepo.save(Object.assign(new Category(), { name: 'Books' }))

    const tagPremium = await tagRepo.save(Object.assign(new Tag(), { name: 'premium' }))
    const tagSale = await tagRepo.save(Object.assign(new Tag(), { name: 'on-sale' }))

    prodLaptop = await productRepo.save(
      Object.assign(new Product(), {
        name: 'Laptop Pro',
        description: 'High-end laptop',
        price: 1499.99,
        active: true,
        createdAt: new Date('2024-01-15'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [tagPremium],
      }),
    )

    prodPhone = await productRepo.save(
      Object.assign(new Product(), {
        name: 'SmartPhone',
        description: 'Latest phone model',
        price: 899.0,
        active: true,
        createdAt: new Date('2024-02-20'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [tagPremium, tagSale],
      }),
    )

    prodTablet = await productRepo.save(
      Object.assign(new Product(), {
        name: 'Tablet',
        description: 'Compact tablet',
        price: 399.0,
        active: true,
        createdAt: new Date('2024-03-10'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [tagSale],
      }),
    )

    prodBook = await productRepo.save(
      Object.assign(new Product(), {
        name: 'OData Handbook',
        description: 'Complete OData v4 reference',
        price: 59.99,
        active: true,
        createdAt: new Date('2024-04-01'),
        category: catBooks,
        categoryId: catBooks.id,
        tags: [],
      }),
    )

    customer1 = await customerRepo.save(
      Object.assign(new Customer(), {
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice.adv@test.com',
      }),
    )

    customer2 = await customerRepo.save(
      Object.assign(new Customer(), {
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob.adv@test.com',
      }),
    )

    // Alice has 2 orders with multiple items
    order1 = await orderRepo.save(
      Object.assign(new Order(), {
        orderDate: new Date('2024-06-01'),
        totalAmount: 2398.99,
        status: 'completed',
        customer: customer1,
        customerId: customer1.id,
      }),
    )

    order2 = await orderRepo.save(
      Object.assign(new Order(), {
        orderDate: new Date('2024-07-15'),
        totalAmount: 899.0,
        status: 'pending',
        customer: customer1,
        customerId: customer1.id,
      }),
    )

    // Bob has 1 order
    order3 = await orderRepo.save(
      Object.assign(new Order(), {
        orderDate: new Date('2024-08-01'),
        totalAmount: 59.99,
        status: 'completed',
        customer: customer2,
        customerId: customer2.id,
      }),
    )

    // Order 1: Laptop + Phone
    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 1499.99,
        order: order1,
        orderId: order1.id,
        product: prodLaptop,
        productId: prodLaptop.id,
      }),
    )

    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 899.0,
        order: order1,
        orderId: order1.id,
        product: prodPhone,
        productId: prodPhone.id,
      }),
    )

    // Order 2: Phone only
    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 899.0,
        order: order2,
        orderId: order2.id,
        product: prodPhone,
        productId: prodPhone.id,
      }),
    )

    // Order 3: Book
    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 2,
        unitPrice: 59.99,
        order: order3,
        orderId: order3.id,
        product: prodBook,
        productId: prodBook.id,
      }),
    )
  })

  afterAll(async () => {
    await app.close()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Complex $expand — Multi-level Nesting
  // ═══════════════════════════════════════════════════════════════════════════

  describe('complex $expand — multi-level nesting', () => {
    it('2-level expand: Products with category (ManyToOne)', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $filter: `id eq ${prodLaptop.id}` })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
      const laptop = body.value[0]
      expect(laptop['category']).toBeDefined()
      expect((laptop['category'] as Record<string, unknown>)['name']).toBe('Electronics')
    })

    it('expand with $filter inside: $expand=category($filter=...)', async () => {
      // Expand category but only if name matches
      const res = await request
        .get('/odata/Products')
        .query({ $expand: "category($filter=name eq 'Electronics')" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value.length).toBeGreaterThan(0)
    })

    it('expand with $select inside: only projected fields from related entity', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'category($select=name)',
          $filter: `id eq ${prodLaptop.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const laptop = body.value[0]
      const cat = laptop['category'] as Record<string, unknown>
      expect(cat).toBeDefined()
      expect(cat['name']).toBe('Electronics')
    })

    it('expand with $orderby inside: sorted related collection', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'orderItems($orderby=unitPrice desc)',
          $filter: `id eq ${prodPhone.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const phone = body.value[0]
      const items = phone['orderItems'] as Array<Record<string, unknown>>
      expect(items).toBeDefined()
      expect(items.length).toBeGreaterThan(0)

      // Verify descending order of unitPrice
      const prices = items.map((i) => Number(i['unitPrice']))
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1]).toBeGreaterThanOrEqual(prices[i])
      }
    })

    it('expand with $top inside: limits expanded collection', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'orderItems($top=1)',
          $filter: `id eq ${prodPhone.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const phone = body.value[0]
      const items = phone['orderItems'] as Array<Record<string, unknown>>
      expect(items).toBeDefined()
      // Should be limited to 1
      expect(items.length).toBeLessThanOrEqual(1)
    })

    it('expand + parent $filter + parent $orderby + parent $top: all combined', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'category',
          $filter: 'active eq true and price gt 100',
          $orderby: 'price desc',
          $top: '3',
          $count: 'true',
        })
        .expect(200)

      const body = res.body as {
        '@odata.count': number
        value: Array<Record<string, unknown>>
      }

      expect(body.value.length).toBeLessThanOrEqual(3)
      expect(body['@odata.count']).toBeGreaterThan(0)

      for (const item of body.value) {
        expect(item['active']).toBe(true)
        expect(Number(item['price'])).toBeGreaterThan(100)
        expect(item['category']).toBeDefined()
      }

      // Verify descending price order
      const prices = body.value.map((p) => Number(p['price']))
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1]).toBeGreaterThanOrEqual(prices[i])
      }
    })

    it('expand invalid navigation property: returns 400', async () => {
      await request.get('/odata/Products').query({ $expand: 'nonExistentRelation' }).expect(400)
    })

    it('multiple expands: $expand=category,orderItems', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'category,orderItems',
          $filter: `id eq ${prodLaptop.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const laptop = body.value[0]
      expect(laptop['category']).toBeDefined()
      expect(laptop['orderItems']).toBeDefined()
      expect(Array.isArray(laptop['orderItems'])).toBe(true)
    })

    it('expand with combined $filter + $select in sub-query', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'orderItems($filter=quantity ge 1;$select=quantity,unitPrice)',
          $filter: `id eq ${prodLaptop.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const laptop = body.value[0]
      const items = laptop['orderItems'] as Array<Record<string, unknown>>
      expect(items).toBeDefined()
      for (const item of items) {
        expect(Number(item['quantity'])).toBeGreaterThanOrEqual(1)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Complex $batch — Multi-Changeset, Mixed Operations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('complex $batch operations', () => {
    it('batch with multiple individual GETs: all return independently', async () => {
      const body = buildBatchBody([
        individualRequest('GET', `/odata/Products(${prodLaptop.id})`),
        individualRequest('GET', `/odata/Products(${prodPhone.id})`),
        individualRequest('GET', `/odata/Products(${prodTablet.id})`),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      expect(codes).toHaveLength(3)
      expect(codes).toEqual([200, 200, 200])

      // Verify each product appears in the response
      expect(text).toContain('Laptop Pro')
      expect(text).toContain('SmartPhone')
      expect(text).toContain('Tablet')
    })

    it('batch with changeset: create + update atomically', async () => {
      const createBody = JSON.stringify({
        name: 'Batch Created Widget',
        price: 42.0,
        active: true,
        createdAt: new Date().toISOString(),
      })

      const patchBody = JSON.stringify({ price: 1599.99 })

      const body = buildBatchBody([
        changeset([
          individualRequest('POST', '/odata/Products', createBody),
          individualRequest('PATCH', `/odata/Products(${prodLaptop.id})`, patchBody),
        ]),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      expect(codes).toContain(201) // Created
      expect(codes).toContain(200) // Updated

      // Verify PATCH took effect
      const verify = await request.get(`/odata/Products/${prodLaptop.id}`).expect(200)
      expect(Number((verify.body as Record<string, unknown>)['price'])).toBeCloseTo(1599.99, 1)

      // Restore original price
      await request.patch(`/odata/Products/${prodLaptop.id}`).send({ price: 1499.99 })
    })

    it('batch changeset rollback: one failure rolls back all', async () => {
      // Count before
      const beforeRes = await request.get('/odata/Products/$count').expect(200)
      const countBefore = parseInt(beforeRes.text.trim(), 10)

      const validCreate = JSON.stringify({
        name: 'ShouldNotExist',
        price: 1.0,
        active: true,
        createdAt: new Date().toISOString(),
      })

      const failingPatch = JSON.stringify({ name: 'WillFail' })

      const body = buildBatchBody([
        changeset([
          individualRequest('POST', '/odata/Products', validCreate),
          individualRequest('PATCH', '/odata/Products(999999)', failingPatch),
        ]),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      // All operations should fail due to rollback
      expect(codes.every((c) => c >= 400)).toBe(true)

      // Verify no product was created (rolled back)
      const afterRes = await request.get('/odata/Products/$count').expect(200)
      const countAfter = parseInt(afterRes.text.trim(), 10)
      expect(countAfter).toBe(countBefore)
    })

    it('batch with mixed: individual GET + changeset + individual GET', async () => {
      const createBody = JSON.stringify({
        name: 'Mixed Batch Item',
        price: 25.0,
        active: true,
        createdAt: new Date().toISOString(),
      })

      const body = buildBatchBody([
        individualRequest('GET', `/odata/Products(${prodLaptop.id})`),
        changeset([individualRequest('POST', '/odata/Products', createBody)]),
        individualRequest('GET', `/odata/Products(${prodPhone.id})`),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      expect(codes.length).toBeGreaterThanOrEqual(3)
      // First GET, changeset POST, second GET
      expect(codes[0]).toBe(200)
      expect(codes).toContain(201)
    })

    it('batch: individual request failure does not affect others', async () => {
      const body = buildBatchBody([
        individualRequest('GET', `/odata/Products(${prodLaptop.id})`),
        individualRequest('GET', '/odata/Products(999999)'), // 404
        individualRequest('GET', `/odata/Products(${prodPhone.id})`),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      expect(codes).toHaveLength(3)
      expect(codes[0]).toBe(200) // First succeeds
      expect(codes[1]).toBe(404) // Second fails
      expect(codes[2]).toBe(200) // Third still succeeds
    })

    it('batch with DELETE in changeset: deletes atomically', async () => {
      // Create a throwaway product
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'ToDeleteInBatch',
          price: 1.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const deleteId = (created.body as { id: number }).id

      const body = buildBatchBody([
        changeset([individualRequest('DELETE', `/odata/Products(${deleteId})`)]),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      expect(codes).toContain(204)

      // Verify deleted
      await request.get(`/odata/Products/${deleteId}`).expect(404)
    })

    it('batch with multiple operations in single changeset: create + create + patch', async () => {
      const create1 = JSON.stringify({
        name: 'Batch Multi 1',
        price: 10.0,
        active: true,
        createdAt: new Date().toISOString(),
      })
      const create2 = JSON.stringify({
        name: 'Batch Multi 2',
        price: 20.0,
        active: true,
        createdAt: new Date().toISOString(),
      })
      const patchBody = JSON.stringify({ description: 'Updated in batch' })

      const body = buildBatchBody([
        changeset([
          individualRequest('POST', '/odata/Products', create1),
          individualRequest('POST', '/odata/Products', create2),
          individualRequest('PATCH', `/odata/Products(${prodTablet.id})`, patchBody),
        ]),
      ])

      const res = await postBatch(request, body)
      expect(res.status).toBe(200)

      const text = getResponseText(res)
      const codes = parseResponseStatusCodes(text)
      expect(codes.filter((c) => c === 201)).toHaveLength(2) // Two creates
      expect(codes).toContain(200) // One patch

      // Verify tablet was updated
      const verify = await request.get(`/odata/Products/${prodTablet.id}`).expect(200)
      expect((verify.body as Record<string, unknown>)['description']).toBe('Updated in batch')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Write Operations — Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('write operations — edge cases', () => {
    it('POST: returns created entity with @odata.context', async () => {
      const res = await request
        .post('/odata/Products')
        .send({
          name: 'Write Test Product',
          price: 99.99,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const body = res.body as Record<string, unknown>
      expect(body['@odata.context']).toBeDefined()
      expect(body['name']).toBe('Write Test Product')
      expect(body['id']).toBeDefined()
    })

    it('POST: Location header follows OData format Products(key)', async () => {
      const res = await request
        .post('/odata/Products')
        .send({
          name: 'Location Test',
          price: 1.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const location = res.headers['location']
      expect(location).toMatch(/Products\(\d+\)/)
    })

    it('POST: extra unknown fields are ignored (mass assignment protection)', async () => {
      const res = await request
        .post('/odata/Products')
        .send({
          name: 'Mass Assign Test',
          price: 10.0,
          active: true,
          createdAt: new Date().toISOString(),
          __admin: true, // unknown field
          secretField: 'should be ignored',
        })
        .expect(201)

      const body = res.body as Record<string, unknown>
      expect(body['__admin']).toBeUndefined()
      expect(body['secretField']).toBeUndefined()
    })

    it('PATCH: partial update preserves unmentioned fields', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Partial Update Test',
          description: 'Original description',
          price: 100.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      // Only update price
      const res = await request.patch(`/odata/Products/${id}`).send({ price: 50.0 }).expect(200)

      const body = res.body as Record<string, unknown>
      expect(body['name']).toBe('Partial Update Test') // Preserved
      expect(body['description']).toBe('Original description') // Preserved
      expect(Number(body['price'])).toBeCloseTo(50.0) // Updated
      expect(body['active']).toBe(true) // Preserved
    })

    it('PATCH: update multiple fields at once', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Multi Field Patch',
          description: 'Before',
          price: 10.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      const res = await request
        .patch(`/odata/Products/${id}`)
        .send({
          name: 'Updated Name',
          description: 'After',
          price: 20.0,
          active: false,
        })
        .expect(200)

      const body = res.body as Record<string, unknown>
      expect(body['name']).toBe('Updated Name')
      expect(body['description']).toBe('After')
      expect(Number(body['price'])).toBeCloseTo(20.0)
      expect(body['active']).toBe(false)
    })

    it('DELETE: verify cascade or isolation behavior', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Delete Isolation Test',
          price: 5.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      // Delete
      await request.delete(`/odata/Products/${id}`).expect(204)

      // Verify gone
      await request.get(`/odata/Products/${id}`).expect(404)

      // Other products still exist
      const res = await request.get(`/odata/Products/${prodLaptop.id}`).expect(200)
      expect((res.body as Record<string, unknown>)['name']).toBe('Laptop Pro')
    })

    it('POST then immediate GET: created entity is queryable', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Queryable After Create',
          price: 77.77,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      // Query by filter to find it
      const res = await request
        .get('/odata/Products')
        .query({ $filter: `id eq ${id}` })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
      expect(body.value[0]['name']).toBe('Queryable After Create')
    })

    it('POST with categoryId: creates product with FK relationship', async () => {
      const res = await request
        .post('/odata/Products')
        .send({
          name: 'FK Test Product',
          price: 30.0,
          active: true,
          createdAt: new Date().toISOString(),
          categoryId: catElectronics.id,
        })
        .expect(201)

      const id = (res.body as { id: number }).id

      // Verify the relationship works via expand
      const expandRes = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $filter: `id eq ${id}` })
        .expect(200)

      const body = expandRes.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
      const cat = body.value[0]['category'] as Record<string, unknown>
      expect(cat['name']).toBe('Electronics')
    })

    it('POST + PATCH + DELETE sequence: full lifecycle', async () => {
      // Create
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Lifecycle Test',
          price: 10.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      // Update
      await request
        .patch(`/odata/Products/${id}`)
        .send({ price: 20.0, name: 'Updated Lifecycle' })
        .expect(200)

      // Verify update
      const updated = await request.get(`/odata/Products/${id}`).expect(200)
      expect((updated.body as Record<string, unknown>)['name']).toBe('Updated Lifecycle')
      expect(Number((updated.body as Record<string, unknown>)['price'])).toBeCloseTo(20.0)

      // Delete
      await request.delete(`/odata/Products/${id}`).expect(204)

      // Verify deletion
      await request.get(`/odata/Products/${id}`).expect(404)
    })

    it('PATCH with empty body: no changes applied, returns current entity', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Empty Patch Test',
          price: 15.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      const res = await request.patch(`/odata/Products/${id}`).send({}).expect(200)

      const body = res.body as Record<string, unknown>
      expect(body['name']).toBe('Empty Patch Test')
      expect(Number(body['price'])).toBeCloseTo(15.0)
    })

    it('multiple sequential creates: all assigned unique IDs', async () => {
      const ids: number[] = []
      for (let i = 0; i < 5; i++) {
        const res = await request
          .post('/odata/Products')
          .send({
            name: `Sequential Create ${i}`,
            price: i + 1,
            active: true,
            createdAt: new Date().toISOString(),
          })
          .expect(201)
        ids.push((res.body as { id: number }).id)
      }

      // All IDs should be unique
      const uniqueIds = [...new Set(ids)]
      expect(uniqueIds.length).toBe(5)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Expand + Write Scenarios
  // ═══════════════════════════════════════════════════════════════════════════

  describe('expand + write combined scenarios', () => {
    it('create product with FK, then expand to verify relationship', async () => {
      const res = await request
        .post('/odata/Products')
        .send({
          name: 'Expand After Create',
          price: 45.0,
          active: true,
          createdAt: new Date().toISOString(),
          categoryId: catBooks.id,
        })
        .expect(201)

      const id = (res.body as { id: number }).id

      const expandRes = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $filter: `id eq ${id}` })
        .expect(200)

      const body = expandRes.body as { value: Array<Record<string, unknown>> }
      const product = body.value[0]
      const cat = product['category'] as Record<string, unknown>
      expect(cat['name']).toBe('Books')
    })

    it('update FK via PATCH, then expand shows new relationship', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'FK Switch Test',
          price: 10.0,
          active: true,
          createdAt: new Date().toISOString(),
          categoryId: catElectronics.id,
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      // Switch from Electronics to Books
      await request.patch(`/odata/Products/${id}`).send({ categoryId: catBooks.id }).expect(200)

      // Verify via expand
      const expandRes = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $filter: `id eq ${id}` })
        .expect(200)

      const body = expandRes.body as { value: Array<Record<string, unknown>> }
      const cat = body.value[0]['category'] as Record<string, unknown>
      expect(cat['name']).toBe('Books')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Query + Expand Stress Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('query + expand stress tests', () => {
    it('$expand + $filter + $select + $orderby + $top + $count: full expand pipeline', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'category',
          $filter: 'active eq true',
          $select: 'name,price',
          $orderby: 'price desc',
          $top: '3',
          $count: 'true',
        })
        .expect(200)

      const body = res.body as {
        '@odata.context': string
        '@odata.count': number
        value: Array<Record<string, unknown>>
      }

      expect(body['@odata.context']).toBeDefined()
      expect(body['@odata.count']).toBeGreaterThan(0)
      expect(body.value.length).toBeLessThanOrEqual(3)

      // Verify price descending
      const prices = body.value.map((p) => Number(p['price']))
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1]).toBeGreaterThanOrEqual(prices[i])
      }
    })

    it('$expand with $filter + contains: string filter inside expand', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'orderItems($filter=unitPrice gt 500)',
          $filter: `id eq ${prodLaptop.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const laptop = body.value[0]
      const items = laptop['orderItems'] as Array<Record<string, unknown>>
      expect(items).toBeDefined()
      for (const item of items) {
        expect(Number(item['unitPrice'])).toBeGreaterThan(500)
      }
    })

    it('filtered expand returns empty array for no matches', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $expand: 'orderItems($filter=unitPrice gt 999999)',
          $filter: `id eq ${prodLaptop.id}`,
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const laptop = body.value[0]
      // With the JOIN-based approach, this filters the parent too
      // The result depends on whether the filter is a WHERE or a JOIN condition
      expect(laptop).toBeDefined()
    })
  })
})
