import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'

describe('Metadata E2E ($metadata and service document)', () => {
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

  it('Test 1: GET /odata/$metadata returns 200 with Content-Type application/xml', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/xml/)
  })

  it('Test 2: Response body contains <edmx:Edmx and Version="4.0"', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.text).toContain('<edmx:Edmx')
    expect(res.text).toContain('Version="4.0"')
  })

  it('Test 3: Response body contains <EntityType Name="Product">', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.text).toContain('<EntityType Name="Product">')
  })

  it('Test 4: Response body contains <EntitySet Name="Products" EntityType="Default.Product"/>', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.text).toContain('<EntitySet Name="Products" EntityType="Default.Product"/>')
  })

  it('Test 5: Response body contains NavigationProperty for category (ManyToOne)', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.text).toContain('<NavigationProperty Name="category" Type="Default.Category"')
  })

  it('Test 6: Response body contains NavigationProperty for orderItems (OneToMany)', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.text).toContain(
      '<NavigationProperty Name="orderItems" Type="Collection(Default.OrderItem)"',
    )
  })

  it('Test 7: Response body does NOT contain Edm.DateTime (without Offset)', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.text).not.toMatch(/Edm\.DateTime[^O]/)
  })

  it('Test 8: GET /odata/ returns 200 with service document listing all 6 EntitySets', async () => {
    const res = await request.get('/odata')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const doc = res.body as { value: Array<{ name: string }> }
    const names = doc.value.map((e) => e.name)
    expect(names).toContain('Products')
    expect(names).toContain('Categories')
    expect(names).toContain('Customers')
    expect(names).toContain('Orders')
    expect(names).toContain('OrderItems')
    expect(names).toContain('Tags')
  })
})
