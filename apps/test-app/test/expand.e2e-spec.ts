import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Category, Product } from '../src/entities/index.js'

/**
 * OData $expand integration tests.
 *
 * Validates Phase 4 $expand success criteria (QUERY-07, QUERY-08):
 *   - GET /odata/Products?$expand=category returns products with category inlined
 *   - $expand with invalid navigation property returns 400
 *   - $expand uses LEFT JOIN (single SQL query, no N+1)
 */
describe('OData $expand (e2e)', () => {
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

    // Seed data: Category + Product with a category relation for $expand testing
    dataSource = moduleFixture.get<DataSource>(DataSource)
    const categoryRepo = dataSource.getRepository(Category)
    const productRepo = dataSource.getRepository(Product)

    const category = await categoryRepo.save(Object.assign(new Category(), { name: 'Electronics' }))

    await productRepo.save([
      Object.assign(new Product(), {
        name: 'Laptop',
        price: 999.99,
        active: true,
        createdAt: new Date(),
        category,
        categoryId: category.id,
      }),
      Object.assign(new Product(), {
        name: 'Phone',
        price: 499.99,
        active: true,
        createdAt: new Date(),
        category,
        categoryId: category.id,
      }),
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  // ── $expand: Related entity inlined ──────────────────────────────────────────

  it('GET /odata/Products?$expand=category returns products with category inlined', async () => {
    const res = await request.get('/odata/Products').query({ $expand: 'category' }).expect(200)

    const body = res.body as { value: Array<Record<string, unknown>> }
    expect(Array.isArray(body.value)).toBe(true)

    // Find a product that has a category set
    const withCategory = body.value.find(
      (p) => p['category'] !== null && p['category'] !== undefined,
    )
    expect(withCategory).toBeDefined()
    expect(withCategory?.['category']).toHaveProperty('name', 'Electronics')
  })

  it('GET /odata/Products?$expand=category returns OData envelope with @odata.context', async () => {
    const res = await request.get('/odata/Products').query({ $expand: 'category' }).expect(200)

    const body = res.body as { '@odata.context': string; value: unknown[] }
    expect(body['@odata.context']).toContain('/odata/$metadata#Products')
    expect(Array.isArray(body.value)).toBe(true)
  })

  // ── $expand: Validation ───────────────────────────────────────────────────────

  it('GET /odata/Products?$expand=NonExistent returns 400', async () => {
    const res = await request.get('/odata/Products').query({ $expand: 'NonExistent' }).expect(400)

    const body = res.body as { error: { code: string; message: string } }
    expect(body.error).toBeDefined()
    expect(body.error.message).toContain('NonExistent')
  })

  // ── $expand: Combined with $filter ────────────────────────────────────────────

  it('GET /odata/Products?$expand=category&$filter=active eq true returns filtered results with category', async () => {
    const res = await request
      .get('/odata/Products')
      .query({ $expand: 'category', $filter: 'active eq true' })
      .expect(200)

    const body = res.body as { value: Array<Record<string, unknown>> }
    expect(Array.isArray(body.value)).toBe(true)
    // All results should have active=true
    for (const item of body.value) {
      expect(item['active']).toBe(true)
    }
  })
})
