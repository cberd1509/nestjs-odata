import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Product, Tag } from '../src/entities/index.js'

type ODataBody = Record<string, unknown>
type ODataCollectionBody = { value: ODataBody[] } & Record<string, unknown>

/**
 * OData ETag Concurrency Control E2E tests.
 *
 * Verifies:
 * - ETag header and @odata.etag annotation on GET responses for ETag-enabled entities
 * - PATCH with current If-Match succeeds
 * - PATCH with stale If-Match returns 412 Precondition Failed
 * - DELETE with stale If-Match returns 412
 * - GET with matching If-None-Match returns 304 Not Modified
 * - GET with non-matching If-None-Match returns 200 with body
 * - Collection response does not have @odata.etag at root level
 *
 * Note: key URLs use /odata/Products/:id format (not parentheses) matching
 * the NestJS route pattern `:key` registered by @ODataGetByKey.
 */
describe('OData ETag Concurrency Control (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  let dataSource: DataSource

  let productId: number
  let deleteProductId: number

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
    dataSource = moduleFixture.get<DataSource>(DataSource)

    const productRepo = dataSource.getRepository(Product)
    const tagRepo = dataSource.getRepository(Tag)

    // Seed products for ETag tests
    const product = await productRepo.save(
      Object.assign(new Product(), {
        name: 'ETag Test Product',
        description: 'Product for ETag testing',
        price: 99.99,
        active: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    )
    productId = product.id

    const productToDelete = await productRepo.save(
      Object.assign(new Product(), {
        name: 'Product To Delete',
        description: 'Will be tested with stale If-Match on DELETE',
        price: 49.99,
        active: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    )
    deleteProductId = productToDelete.id

    // Seed tags (no @UpdateDateColumn — should have no ETag)
    await tagRepo.save(Object.assign(new Tag(), { name: 'no-etag-tag' }))
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /odata/Products/:id returns @odata.id, @odata.type annotations', async () => {
    const res = await request.get(`/odata/Products/${productId}`).expect(200)
    const body = res.body as ODataBody
    expect(body['@odata.id']).toBeDefined()
    expect(body['@odata.type']).toBe('#Default.Product')
  })

  it('GET /odata/Products/:id returns ETag header and @odata.etag in body', async () => {
    const res = await request.get(`/odata/Products/${productId}`).expect(200)
    const body = res.body as ODataBody
    expect(res.headers['etag']).toBeDefined()
    expect(res.headers['etag']).toMatch(/^W\/"[^"]+"\s*$/)
    expect(body['@odata.etag']).toBe(res.headers['etag'])
  })

  it('GET /odata/Products returns @odata.id and @odata.type annotations on each collection item', async () => {
    const res = await request.get('/odata/Products').expect(200)
    const body = res.body as ODataCollectionBody
    expect(Array.isArray(body.value)).toBe(true)
    for (const item of body.value) {
      expect(item['@odata.id']).toBeDefined()
      expect(item['@odata.type']).toBe('#Default.Product')
    }
  })

  it('PATCH with current If-Match succeeds', async () => {
    const getRes = await request.get(`/odata/Products/${productId}`).expect(200)
    const etag = getRes.headers['etag']

    const patchRes = await request
      .patch(`/odata/Products/${productId}`)
      .set('If-Match', etag)
      .send({ name: 'Updated ETag Test Product' })
      .expect(200)

    const patchBody = patchRes.body as ODataBody
    expect(patchBody['name']).toBe('Updated ETag Test Product')
  })

  it('PATCH with stale If-Match returns 412', async () => {
    await request
      .patch(`/odata/Products/${productId}`)
      .set('If-Match', 'W/"stale-etag-value"')
      .send({ name: 'Should Fail' })
      .expect(412)
  })

  it('DELETE with stale If-Match returns 412', async () => {
    await request
      .delete(`/odata/Products/${deleteProductId}`)
      .set('If-Match', 'W/"stale-etag-value"')
      .expect(412)
  })

  it('GET with If-None-Match matching current ETag returns 304', async () => {
    const getRes = await request.get(`/odata/Products/${productId}`).expect(200)
    const etag = getRes.headers['etag']

    await request.get(`/odata/Products/${productId}`).set('If-None-Match', etag).expect(304)
  })

  it('GET with non-matching If-None-Match returns 200 with body', async () => {
    const res = await request
      .get(`/odata/Products/${productId}`)
      .set('If-None-Match', 'W/"old-value"')
      .expect(200)

    const body = res.body as ODataBody
    expect(body['id']).toBe(productId)
    expect(body['@odata.etag']).toBeDefined()
  })

  it('collection response does not include @odata.etag at root level', async () => {
    const res = await request.get('/odata/Products').expect(200)
    const body = res.body as ODataCollectionBody
    expect(Array.isArray(body.value)).toBe(true)
    // Collection-level response should NOT have @odata.etag (ETags are per-entity)
    expect(body['@odata.etag']).toBeUndefined()
    if (body.value.length > 0) {
      const item = body.value[0]
      expect(item['@odata.id']).toBeDefined()
      expect(item['@odata.type']).toBe('#Default.Product')
    }
  })
})
