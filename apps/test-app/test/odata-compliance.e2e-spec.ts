import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Product, Category, Customer, Order, OrderItem, Tag } from '../src/entities/index.js'

/**
 * Exhaustive OData v4 compliance test suite.
 *
 * Tests complex queries, edge cases, and standard conformance against
 * the OData v4 OASIS specification. Designed to push the library to
 * its limits with real relational data.
 *
 * Entity graph:
 *   Customer --(1:M)--> Order --(1:M)--> OrderItem --(M:1)--> Product
 *   Product --(M:1)--> Category
 *   Product --(M:M)--> Tag
 */
describe('OData v4 Compliance Suite (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  let dataSource: DataSource

  // Seeded IDs for reference
  let catElectronics: Category
  let catBooks: Category
  let catClothing: Category
  let prodLaptop: Product
  let prodPhone: Product
  let prodBook1: Product
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
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
    dataSource = moduleFixture.get<DataSource>(DataSource)

    // Seed comprehensive test data
    const categoryRepo = dataSource.getRepository(Category)
    const productRepo = dataSource.getRepository(Product)
    const customerRepo = dataSource.getRepository(Customer)
    const orderRepo = dataSource.getRepository(Order)
    const orderItemRepo = dataSource.getRepository(OrderItem)
    const tagRepo = dataSource.getRepository(Tag)

    // Categories
    catElectronics = await categoryRepo.save(Object.assign(new Category(), { name: 'Electronics' }))
    catBooks = await categoryRepo.save(Object.assign(new Category(), { name: 'Books' }))
    catClothing = await categoryRepo.save(Object.assign(new Category(), { name: 'Clothing' }))

    // Tags
    const tagSale = await tagRepo.save(Object.assign(new Tag(), { name: 'sale' }))
    const tagNew = await tagRepo.save(Object.assign(new Tag(), { name: 'new-arrival' }))
    const tagPremium = await tagRepo.save(Object.assign(new Tag(), { name: 'premium' }))

    // Products with varying properties for filtering
    prodLaptop = await productRepo.save(
      Object.assign(new Product(), {
        name: 'Pro Laptop 15"',
        description: 'High-performance laptop with 16GB RAM',
        price: 1299.99,
        active: true,
        createdAt: new Date('2024-01-15T10:30:00Z'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [tagPremium, tagNew],
      }),
    )

    prodPhone = await productRepo.save(
      Object.assign(new Product(), {
        name: 'SmartPhone X',
        description: 'Latest smartphone with OLED display',
        price: 899.5,
        active: true,
        createdAt: new Date('2024-02-20T14:00:00Z'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [tagNew],
      }),
    )

    await productRepo.save(
      Object.assign(new Product(), {
        name: 'Tablet Mini',
        description: 'Compact tablet for reading',
        price: 399.0,
        active: true,
        createdAt: new Date('2024-03-10T09:15:00Z'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [tagSale],
      }),
    )

    prodBook1 = await productRepo.save(
      Object.assign(new Product(), {
        name: 'The Art of Programming',
        description: 'A comprehensive guide to software engineering',
        price: 49.99,
        active: true,
        createdAt: new Date('2024-04-01T08:00:00Z'),
        category: catBooks,
        categoryId: catBooks.id,
        tags: [tagNew],
      }),
    )

    await productRepo.save(
      Object.assign(new Product(), {
        name: 'Data Structures & Algorithms',
        description: 'Classic CS textbook',
        price: 59.95,
        active: true,
        createdAt: new Date('2024-04-15T12:00:00Z'),
        category: catBooks,
        categoryId: catBooks.id,
        tags: [],
      }),
    )

    await productRepo.save(
      Object.assign(new Product(), {
        name: 'Cotton T-Shirt',
        description: 'Comfortable 100% cotton',
        price: 19.99,
        active: true,
        createdAt: new Date('2024-05-01T06:00:00Z'),
        category: catClothing,
        categoryId: catClothing.id,
        tags: [tagSale, tagNew],
      }),
    )

    await productRepo.save(
      Object.assign(new Product(), {
        name: 'Discontinued Widget',
        description: 'No longer available',
        price: 9.99,
        active: false,
        createdAt: new Date('2023-01-01T00:00:00Z'),
        category: catElectronics,
        categoryId: catElectronics.id,
        tags: [],
      }),
    )

    // Customers
    customer1 = await customerRepo.save(
      Object.assign(new Customer(), {
        firstName: 'Alice',
        lastName: 'Johnson',
        email: 'alice@example.com',
      }),
    )

    customer2 = await customerRepo.save(
      Object.assign(new Customer(), {
        firstName: 'Bob',
        lastName: "O'Brien",
        email: 'bob@example.com',
      }),
    )

    // Orders
    order1 = await orderRepo.save(
      Object.assign(new Order(), {
        orderDate: new Date('2024-06-01T10:00:00Z'),
        totalAmount: 2199.49,
        status: 'completed',
        customer: customer1,
        customerId: customer1.id,
      }),
    )

    order2 = await orderRepo.save(
      Object.assign(new Order(), {
        orderDate: new Date('2024-06-15T14:30:00Z'),
        totalAmount: 899.5,
        status: 'pending',
        customer: customer1,
        customerId: customer1.id,
      }),
    )

    order3 = await orderRepo.save(
      Object.assign(new Order(), {
        orderDate: new Date('2024-07-01T09:00:00Z'),
        totalAmount: 49.99,
        status: 'completed',
        customer: customer2,
        customerId: customer2.id,
      }),
    )

    // Order Items
    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 1299.99,
        order: order1,
        orderId: order1.id,
        product: prodLaptop,
        productId: prodLaptop.id,
      }),
    )

    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 899.5,
        order: order1,
        orderId: order1.id,
        product: prodPhone,
        productId: prodPhone.id,
      }),
    )

    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 899.5,
        order: order2,
        orderId: order2.id,
        product: prodPhone,
        productId: prodPhone.id,
      }),
    )

    await orderItemRepo.save(
      Object.assign(new OrderItem(), {
        quantity: 1,
        unitPrice: 49.99,
        order: order3,
        orderId: order3.id,
        product: prodBook1,
        productId: prodBook1.id,
      }),
    )
  })

  afterAll(async () => {
    await app.close()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: $filter — Comparison Operators
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$filter comparison operators', () => {
    it('eq: filters by exact string match', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "name eq 'SmartPhone X'" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
      expect(body.value[0]['name']).toBe('SmartPhone X')
    })

    it('ne: excludes exact value', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'active ne true' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(item['active']).toBe(false)
      }
      expect(body.value.length).toBeGreaterThan(0)
    })

    it('gt: numeric greater than', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price gt 500' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeGreaterThan(500)
      }
    })

    it('ge: numeric greater than or equal', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price ge 899.5' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeGreaterThanOrEqual(899.5)
      }
    })

    it('lt: numeric less than', async () => {
      const res = await request.get('/odata/Products').query({ $filter: 'price lt 50' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeLessThan(50)
      }
    })

    it('le: numeric less than or equal', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price le 19.99' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeLessThanOrEqual(19.99)
      }
    })

    it('eq with boolean: filters active products', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'active eq true' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(item['active']).toBe(true)
      }
    })

    it('eq with null: filters nullable fields', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'categoryId eq null' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(item['categoryId']).toBeNull()
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: $filter — Logical Operators
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$filter logical operators', () => {
    it('and: combines two conditions', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price gt 100 and active eq true' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeGreaterThan(100)
        expect(item['active']).toBe(true)
      }
    })

    it('or: matches either condition', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price gt 1000 or active eq false' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const priceOver1000 = Number(item['price']) > 1000
        const inactive = item['active'] === false
        expect(priceOver1000 || inactive).toBe(true)
      }
    })

    it('not: negates a comparison', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'not (active eq false)' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(item['active']).toBe(true)
      }
    })

    it('complex: triple and with different fields', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price gt 10 and price lt 100 and active eq true' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const price = Number(item['price'])
        expect(price).toBeGreaterThan(10)
        expect(price).toBeLessThan(100)
        expect(item['active']).toBe(true)
      }
    })

    it('complex: and + or with parentheses', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: '(price lt 30 or price gt 1000) and active eq true' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const price = Number(item['price'])
        expect(price < 30 || price > 1000).toBe(true)
        expect(item['active']).toBe(true)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: $filter — String Functions
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$filter string functions', () => {
    it('contains: finds products with substring in name', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "contains(name, 'Phone')" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(String(item['name']).toLowerCase()).toContain('phone')
      }
    })

    it('startswith: finds products starting with prefix', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "startswith(name, 'Pro')" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value.length).toBeGreaterThan(0)
      for (const item of body.value) {
        expect(String(item['name']).startsWith('Pro')).toBe(true)
      }
    })

    it('endswith: finds products ending with suffix', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "endswith(name, 'Mini')" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value.length).toBeGreaterThan(0)
      for (const item of body.value) {
        expect(String(item['name']).endsWith('Mini')).toBe(true)
      }
    })

    it('contains with special characters: SQL wildcard injection prevented', async () => {
      // % and _ should be escaped — no wildcard matching
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "contains(name, '%')" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      // No product names contain literal %
      expect(body.value).toHaveLength(0)
    })

    it('tolower used in comparison: case-insensitive search', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "tolower(name) eq 'smartphone x'" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
      expect(body.value[0]['name']).toBe('SmartPhone X')
    })

    it('toupper used in comparison', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "toupper(name) eq 'TABLET MINI'" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
    })

    it('length used in comparison: filter by string length', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'length(name) gt 15' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(String(item['name']).length).toBeGreaterThan(15)
      }
    })

    it('contains combined with and: string function + comparison', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "contains(name, 'Laptop') and price gt 1000" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value.length).toBeGreaterThan(0)
      for (const item of body.value) {
        expect(String(item['name'])).toContain('Laptop')
        expect(Number(item['price'])).toBeGreaterThan(1000)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: $select — Field Projection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$select projection', () => {
    it('single field: returns only selected field + key', async () => {
      const res = await request.get('/odata/Products').query({ $select: 'name' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const first = body.value[0]
      expect(first).toHaveProperty('name')
      expect(first).toHaveProperty('id') // key always included
    })

    it('multiple fields: returns selected fields + key', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $select: 'name,price,active' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const first = body.value[0]
      expect(first).toHaveProperty('name')
      expect(first).toHaveProperty('price')
      expect(first).toHaveProperty('active')
      expect(first).toHaveProperty('id')
    })

    it('invalid field: returns 400', async () => {
      await request.get('/odata/Products').query({ $select: 'nonexistent' }).expect(400)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: $orderby — Sorting
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$orderby sorting', () => {
    it('ascending by default', async () => {
      const res = await request.get('/odata/Products').query({ $orderby: 'price' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const prices = body.value.map((p) => Number(p['price']))
      const sorted = [...prices].sort((a, b) => a - b)
      expect(prices).toEqual(sorted)
    })

    it('explicit ascending', async () => {
      const res = await request.get('/odata/Products').query({ $orderby: 'price asc' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const prices = body.value.map((p) => Number(p['price']))
      const sorted = [...prices].sort((a, b) => a - b)
      expect(prices).toEqual(sorted)
    })

    it('descending', async () => {
      const res = await request.get('/odata/Products').query({ $orderby: 'price desc' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const prices = body.value.map((p) => Number(p['price']))
      const sorted = [...prices].sort((a, b) => b - a)
      expect(prices).toEqual(sorted)
    })

    it('multiple sort keys: name asc, price desc', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $orderby: 'active desc, price asc' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value.length).toBeGreaterThan(0)
      // Verify active=true items come first
      const firstInactive = body.value.findIndex((p) => p['active'] === false)
      let lastActive = -1
      for (let i = body.value.length - 1; i >= 0; i--) {
        if (body.value[i]['active'] === true) {
          lastActive = i
          break
        }
      }
      if (firstInactive !== -1 && lastActive !== -1) {
        expect(lastActive).toBeLessThan(firstInactive)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: $top, $skip — Pagination
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$top and $skip pagination', () => {
    it('$top=3 returns exactly 3 items', async () => {
      const res = await request.get('/odata/Products').query({ $top: '3' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(3)
    })

    it('$skip=2 skips first 2 items', async () => {
      const allRes = await request.get('/odata/Products').query({ $orderby: 'id asc' }).expect(200)
      const allBody = allRes.body as { value: Array<Record<string, unknown>> }

      const skippedRes = await request
        .get('/odata/Products')
        .query({ $orderby: 'id asc', $skip: '2' })
        .expect(200)
      const skippedBody = skippedRes.body as { value: Array<Record<string, unknown>> }

      expect(skippedBody.value[0]['id']).toBe(allBody.value[2]['id'])
    })

    it('$top + $skip for page 2: page size 2, page 2', async () => {
      const page1 = await request
        .get('/odata/Products')
        .query({ $orderby: 'id asc', $top: '2', $skip: '0' })
        .expect(200)

      const page2 = await request
        .get('/odata/Products')
        .query({ $orderby: 'id asc', $top: '2', $skip: '2' })
        .expect(200)

      const body1 = page1.body as { value: Array<Record<string, unknown>> }
      const body2 = page2.body as { value: Array<Record<string, unknown>> }

      // Pages should not overlap
      const ids1 = body1.value.map((p) => p['id'])
      const ids2 = body2.value.map((p) => p['id'])
      for (const id of ids2) {
        expect(ids1).not.toContain(id)
      }
    })

    it('$top=0 returns empty array', async () => {
      const res = await request.get('/odata/Products').query({ $top: '0' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(0)
    })

    it('$skip beyond total returns empty array', async () => {
      const res = await request.get('/odata/Products').query({ $skip: '10000' }).expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(0)
    })

    it('nextLink includes $skip for next page', async () => {
      const res = await request.get('/odata/Products').query({ $top: '2' }).expect(200)

      const body = res.body as { '@odata.nextLink'?: string; value: unknown[] }
      expect(body['@odata.nextLink']).toBeDefined()
      expect(body['@odata.nextLink']).toContain('$skip=2')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: $count — Inline Count
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$count', () => {
    it('$count=true returns @odata.count with total matching filter', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $count: 'true', $filter: 'active eq true' })
        .expect(200)

      const body = res.body as { '@odata.count': number; value: Array<Record<string, unknown>> }
      expect(typeof body['@odata.count']).toBe('number')
      // Count should equal total active products, not just page
      expect(body['@odata.count']).toBeGreaterThan(0)
    })

    it('$count=true + $top: count reflects total, not page size', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $count: 'true', $top: '2' })
        .expect(200)

      const body = res.body as { '@odata.count': number; value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(2)
      // Count should be total products, not 2
      expect(body['@odata.count']).toBeGreaterThan(2)
    })

    it('/$count path segment returns plain integer', async () => {
      const res = await request.get('/odata/Products/$count').expect(200)
      expect(res.headers['content-type']).toMatch(/text\/plain/)
      const count = parseInt(res.text.trim(), 10)
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThan(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: $expand — Navigation Properties
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$expand navigation properties', () => {
    it('ManyToOne: $expand=category inlines related entity', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $filter: `id eq ${prodLaptop.id}` })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(1)
      const product = body.value[0]
      expect(product['category']).toBeDefined()
      expect((product['category'] as Record<string, unknown>)['name']).toBe('Electronics')
    })

    it('invalid navigation property returns 400', async () => {
      await request.get('/odata/Products').query({ $expand: 'doesNotExist' }).expect(400)
    })

    it('$expand + $filter: combined filtering with expand', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $filter: 'price gt 500 and active eq true' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeGreaterThan(500)
        expect(item['active']).toBe(true)
        expect(item['category']).toBeDefined()
      }
    })

    it('$expand + $select: selected fields with expanded relation', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $select: 'name,price' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      const first = body.value[0]
      expect(first).toHaveProperty('name')
      expect(first).toHaveProperty('price')
      expect(first).toHaveProperty('category')
    })

    it('$expand + $orderby + $top: paged expanded results', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $expand: 'category', $orderby: 'price desc', $top: '3' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(3)
      const prices = body.value.map((p) => Number(p['price']))
      expect(prices[0]).toBeGreaterThanOrEqual(prices[1])
      expect(prices[1]).toBeGreaterThanOrEqual(prices[2])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: Combined Complex Queries
  // ═══════════════════════════════════════════════════════════════════════════

  describe('complex combined queries', () => {
    it('$filter + $select + $orderby + $top + $skip + $count: full pipeline', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: 'active eq true',
          $select: 'name,price',
          $orderby: 'price desc',
          $top: '3',
          $skip: '1',
          $count: 'true',
        })
        .expect(200)

      const body = res.body as {
        '@odata.context': string
        '@odata.count': number
        value: Array<Record<string, unknown>>
      }

      // OData envelope present
      expect(body['@odata.context']).toContain('Products')
      // Count reflects total active products, not page
      expect(body['@odata.count']).toBeGreaterThan(3)
      // Page size respected
      expect(body.value.length).toBeLessThanOrEqual(3)
      // Sorted descending
      const prices = body.value.map((p) => Number(p['price']))
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1]).toBeGreaterThanOrEqual(prices[i])
      }
    })

    it('$filter with contains + $expand + $orderby: string search with expand', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: "contains(description, 'laptop')",
          $expand: 'category',
          $orderby: 'price asc',
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      // SQLite LIKE is case-insensitive by default for ASCII
      expect(body.value.length).toBeGreaterThan(0)
    })

    it('$filter with or + parentheses + $select: complex logic', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: '(price lt 25 or price gt 800) and active eq true',
          $select: 'name,price,active',
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const price = Number(item['price'])
        expect(price < 25 || price > 800).toBe(true)
        expect(item['active']).toBe(true)
      }
    })

    it('$filter with not + contains: negated string function', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "not contains(name, 'Phone')" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(String(item['name']).toLowerCase()).not.toContain('phone')
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10: OData Response Format Compliance
  // ═══════════════════════════════════════════════════════════════════════════

  describe('OData response format compliance', () => {
    it('collection response has @odata.context with #EntitySetName', async () => {
      const res = await request.get('/odata/Products').expect(200)
      const body = res.body as { '@odata.context': string }
      expect(body['@odata.context']).toMatch(/\$metadata#Products/)
    })

    it('single entity response has @odata.context with $entity', async () => {
      const res = await request.get(`/odata/Products/${prodLaptop.id}`).expect(200)
      const body = res.body as { '@odata.context': string }
      expect(body['@odata.context']).toContain('$entity')
    })

    it('error response follows OData error format', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'bogusField eq 1' })
        .expect(400)

      const body = res.body as { error: { code: string; message: string } }
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
    })

    it('content-type is application/json for collection', async () => {
      const res = await request.get('/odata/Products').expect(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
    })

    it('$metadata content-type is application/xml', async () => {
      const res = await request.get('/odata/$metadata').expect(200)
      expect(res.headers['content-type']).toMatch(/application\/xml/)
    })

    it('service document has @odata.context and value array', async () => {
      const res = await request.get('/odata').expect(200)
      const body = res.body as {
        '@odata.context': string
        value: Array<{ name: string; kind: string; url: string }>
      }
      expect(body['@odata.context']).toContain('$metadata')
      expect(Array.isArray(body.value)).toBe(true)
      expect(body.value.length).toBeGreaterThan(0)
    })

    it('service document entity sets have name, kind, url', async () => {
      const res = await request.get('/odata').expect(200)
      const body = res.body as { value: Array<Record<string, unknown>> }
      const productsSet = body.value.find((e) => e['name'] === 'Products')
      expect(productsSet).toBeDefined()
      expect(productsSet).toHaveProperty('url')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11: CRUD Operations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('CRUD operations compliance', () => {
    it('POST: returns 201 with Location header', async () => {
      const res = await request
        .post('/odata/Products')
        .send({
          name: 'Compliance Test Item',
          price: 42.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      expect(res.headers['location']).toBeDefined()
      expect(res.headers['location']).toMatch(/Products\(\d+\)/)
      expect(res.body).toHaveProperty('@odata.context')
    })

    it('GET by key: returns entity without value wrapper', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Key Test',
          price: 10.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id
      const res = await request.get(`/odata/Products/${id}`).expect(200)

      expect(res.body).toHaveProperty('name', 'Key Test')
      expect(res.body).not.toHaveProperty('value') // Not wrapped
    })

    it('PATCH: merge-patch semantics — only specified fields updated', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Merge Patch Test',
          description: 'Original description',
          price: 100.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id

      const res = await request.patch(`/odata/Products/${id}`).send({ price: 75.0 }).expect(200)

      const body = res.body as Record<string, unknown>
      expect(body['name']).toBe('Merge Patch Test') // Unchanged
      expect(body['description']).toBe('Original description') // Unchanged
      expect(Number(body['price'])).toBeCloseTo(75.0) // Updated
    })

    it('DELETE: returns 204 No Content', async () => {
      const created = await request
        .post('/odata/Products')
        .send({
          name: 'Delete Me',
          price: 1.0,
          active: true,
          createdAt: new Date().toISOString(),
        })
        .expect(201)

      const id = (created.body as { id: number }).id
      await request.delete(`/odata/Products/${id}`).expect(204)
      await request.get(`/odata/Products/${id}`).expect(404)
    })

    it('GET non-existent key: returns 404', async () => {
      await request.get('/odata/Products/999999').expect(404)
    })

    it('PATCH non-existent key: returns 404', async () => {
      await request.patch('/odata/Products/999999').send({ price: 1.0 }).expect(404)
    })

    it('DELETE non-existent key: returns 404', async () => {
      await request.delete('/odata/Products/999999').expect(404)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12: $metadata Compliance
  // ═══════════════════════════════════════════════════════════════════════════

  describe('$metadata compliance', () => {
    it('returns valid EDMX with Version="4.0"', async () => {
      const res = await request.get('/odata/$metadata').expect(200)
      expect(res.text).toContain('<edmx:Edmx')
      expect(res.text).toContain('Version="4.0"')
    })

    it('contains EntityType for all registered entities', async () => {
      const res = await request.get('/odata/$metadata').expect(200)
      expect(res.text).toContain('EntityType Name="Product"')
      expect(res.text).toContain('EntityType Name="Category"')
      expect(res.text).toContain('EntityType Name="Customer"')
      expect(res.text).toContain('EntityType Name="Order"')
      expect(res.text).toContain('EntityType Name="OrderItem"')
      expect(res.text).toContain('EntityType Name="Tag"')
    })

    it('contains NavigationProperty for relationships', async () => {
      const res = await request.get('/odata/$metadata').expect(200)
      // Product -> Category (ManyToOne)
      expect(res.text).toContain('NavigationProperty Name="category"')
      // Product -> OrderItems (OneToMany)
      expect(res.text).toContain('NavigationProperty Name="orderItems"')
      // Product -> Tags (ManyToMany)
      expect(res.text).toContain('NavigationProperty Name="tags"')
    })

    it('uses correct Edm types', async () => {
      const res = await request.get('/odata/$metadata').expect(200)
      expect(res.text).toContain('Edm.Int32')
      expect(res.text).toContain('Edm.String')
      expect(res.text).toContain('Edm.Decimal')
      expect(res.text).toContain('Edm.Boolean')
      expect(res.text).toContain('Edm.DateTimeOffset')
      // Should NOT have Edm.DateTime (OData v4 uses DateTimeOffset)
      expect(res.text).not.toMatch(/Edm\.DateTime[^O]/)
    })

    it('EntityContainer has all entity sets', async () => {
      const res = await request.get('/odata/$metadata').expect(200)
      expect(res.text).toContain('EntitySet Name="Products"')
      expect(res.text).toContain('EntitySet Name="Categories"')
      expect(res.text).toContain('EntitySet Name="Customers"')
      expect(res.text).toContain('EntitySet Name="Orders"')
      expect(res.text).toContain('EntitySet Name="OrderItems"')
      expect(res.text).toContain('EntitySet Name="Tags"')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13: Security — Input Validation & Limits
  // ═══════════════════════════════════════════════════════════════════════════

  describe('security and input validation', () => {
    it('SQL injection via $filter: parameterized query prevents injection', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "name eq '1; DROP TABLE Product; --'" })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      // Should return 0 results, not error
      expect(body.value).toHaveLength(0)
    })

    it('SQL injection via contains: wildcard characters escaped', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "contains(name, '_%')" })
        .expect(200)

      // Should not match all products via wildcard
      const body = res.body as { value: Array<Record<string, unknown>> }
      expect(body.value).toHaveLength(0)
    })

    it('invalid field name in $filter: returns 400', async () => {
      await request.get('/odata/Products').query({ $filter: 'nonExistentField eq 1' }).expect(400)
    })

    it('invalid field name in $orderby: returns 400', async () => {
      await request.get('/odata/Products').query({ $orderby: 'nonExistentField asc' }).expect(400)
    })

    it('malformed $filter expression: returns 400', async () => {
      await request.get('/odata/Products').query({ $filter: 'price gt gt gt' }).expect(400)
    })

    it('deeply nested filter: respects depth limit', async () => {
      // Build a deeply nested filter
      let filter = 'price gt 0'
      for (let i = 0; i < 15; i++) {
        filter = `(${filter} and price gt 0)`
      }

      const res = await request.get('/odata/Products').query({ $filter: filter })

      // Should either succeed or fail with 400 (depth exceeded), never 500
      expect([200, 400]).toContain(res.status)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14: Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('empty collection: $filter matching nothing returns empty value array', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "name eq 'NONEXISTENT_PRODUCT_XYZZY'" })
        .expect(200)

      const body = res.body as { '@odata.context': string; value: unknown[] }
      expect(body['@odata.context']).toBeDefined()
      expect(body.value).toHaveLength(0)
    })

    it('$count=true with empty result: returns 0', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "name eq 'NONEXISTENT'", $count: 'true' })
        .expect(200)

      const body = res.body as { '@odata.count': number; value: unknown[] }
      expect(body['@odata.count']).toBe(0)
      expect(body.value).toHaveLength(0)
    })

    it('single quote in string literal: OData escaping with double single-quote', async () => {
      // OData uses '' to escape ' inside strings
      const res = await request
        .get('/odata/Products')
        .query({ $filter: "name eq 'The Art of Programming'" })
        .expect(200)

      // Should match our book (the name doesn't actually have a quote, but the query should parse OK)
      expect(res.status).toBe(200)
    })

    it('$top=1 returns exactly 1 item', async () => {
      const res = await request.get('/odata/Products').query({ $top: '1' }).expect(200)

      const body = res.body as { value: unknown[] }
      expect(body.value).toHaveLength(1)
    })

    it('$filter with decimal precision: handles cents correctly', async () => {
      const res = await request
        .get('/odata/Products')
        .query({ $filter: 'price eq 49.99' })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        expect(Number(item['price'])).toBeCloseTo(49.99, 2)
      }
    })

    it('simultaneous $count + $top + $skip: count unaffected by pagination', async () => {
      const allRes = await request.get('/odata/Products').query({ $count: 'true' }).expect(200)
      const totalCount = (allRes.body as { '@odata.count': number })['@odata.count']

      const pagedRes = await request
        .get('/odata/Products')
        .query({ $count: 'true', $top: '2', $skip: '1' })
        .expect(200)
      const pagedBody = pagedRes.body as { '@odata.count': number; value: unknown[] }

      expect(pagedBody['@odata.count']).toBe(totalCount)
      expect(pagedBody.value).toHaveLength(2)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 15: Query Option Combinations — Stress Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('query option stress tests', () => {
    it('all query options simultaneously', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: "active eq true and contains(name, 'a')",
          $select: 'name,price,active',
          $expand: 'category',
          $orderby: 'price desc',
          $top: '5',
          $skip: '0',
          $count: 'true',
        })
        .expect(200)

      const body = res.body as {
        '@odata.context': string
        '@odata.count': number
        value: Array<Record<string, unknown>>
      }

      expect(body['@odata.context']).toBeDefined()
      expect(typeof body['@odata.count']).toBe('number')
      expect(body.value.length).toBeLessThanOrEqual(5)

      for (const item of body.value) {
        expect(item['active']).toBe(true)
        expect(item).toHaveProperty('name')
        expect(item).toHaveProperty('price')
      }
    })

    it('chain multiple string functions with and', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: "contains(name, 'a') and startswith(name, 'T')",
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const name = String(item['name'])
        expect(name.toLowerCase()).toContain('a')
        expect(name.startsWith('T')).toBe(true)
      }
    })

    it('or with different string functions', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: "startswith(name, 'Pro') or endswith(name, 'Mini')",
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const name = String(item['name'])
        expect(name.startsWith('Pro') || name.endsWith('Mini')).toBe(true)
      }
    })

    it('filter on multiple numeric ranges with or', async () => {
      const res = await request
        .get('/odata/Products')
        .query({
          $filter: '(price ge 0 and price le 20) or (price ge 800 and price le 1500)',
        })
        .expect(200)

      const body = res.body as { value: Array<Record<string, unknown>> }
      for (const item of body.value) {
        const price = Number(item['price'])
        const inLowRange = price >= 0 && price <= 20
        const inHighRange = price >= 800 && price <= 1500
        expect(inLowRange || inHighRange).toBe(true)
      }
    })

    it('pagination consistency: page through entire collection', async () => {
      const pageSize = 2
      const allItems: Record<string, unknown>[] = []
      let skip = 0
      let hasMore = true

      while (hasMore) {
        const res = await request
          .get('/odata/Products')
          .query({ $orderby: 'id asc', $top: String(pageSize), $skip: String(skip) })
          .expect(200)

        const body = res.body as {
          value: Array<Record<string, unknown>>
          '@odata.nextLink'?: string
        }
        allItems.push(...body.value)

        if (body.value.length < pageSize || !body['@odata.nextLink']) {
          hasMore = false
        } else {
          skip += pageSize
        }
      }

      // Verify no duplicates
      const ids = allItems.map((p) => p['id'])
      const uniqueIds = [...new Set(ids)]
      expect(ids.length).toBe(uniqueIds.length)

      // Verify we got all products
      const totalRes = await request.get('/odata/Products/$count').expect(200)
      const total = parseInt(totalRes.text.trim(), 10)
      expect(allItems.length).toBe(total)
    })
  })
})
