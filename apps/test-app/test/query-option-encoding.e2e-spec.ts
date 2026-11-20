import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import { AppModule } from '../src/app.module.js'
import { Product, Tag } from '../src/entities/index.js'

/**
 * Query option values are parsed from their own (decoded once) value: `&`, `%`, `+`, spaces and
 * quotes inside literals reach the parser unchanged, in every system query option.
 */
describe('Query option encoding (e2e)', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>

  /** GET /odata/Products with each option value percent-encoded, as a client sends it. */
  function get(options: Record<string, string>) {
    const qs = Object.entries(options)
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('&')
    return request.get(`/odata/Products?${qs}`)
  }

  function names(body: unknown): string[] {
    return (body as { value: { name: string }[] }).value.map((p) => p.name).sort()
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])

    const dataSource = moduleFixture.get<DataSource>(DataSource)
    const [ampTag, plainTag] = await dataSource
      .getRepository(Tag)
      .save([
        Object.assign(new Tag(), { name: 'b & c' }),
        Object.assign(new Tag(), { name: 'plain' }),
      ])
    const product = (name: string, tags: Tag[] = []) =>
      Object.assign(new Product(), {
        name,
        description: null,
        price: 10,
        active: true,
        createdAt: new Date('2024-01-01'),
        tags,
      })
    await dataSource
      .getRepository(Product)
      .save([
        product('A & B', [ampTag, plainTag]),
        product('A'),
        product('B'),
        product('100% cotton'),
        product('C+ grade'),
        product('two words'),
        product("O'Brien"),
      ])
  })

  afterAll(async () => {
    await app.close()
  })

  it('$filter: an encoded & stays inside the literal', async () => {
    const res = await get({ $filter: "contains(name,'A & B')" }).expect(200)
    expect(names(res.body)).toEqual(['A & B'])
  })

  it('$filter: a literal % is not decoded again', async () => {
    const res = await get({ $filter: "name eq '100% cotton'" }).expect(200)
    expect(names(res.body)).toEqual(['100% cotton'])
  })

  it('$filter: an encoded + stays a plus sign', async () => {
    const res = await get({ $filter: "name eq 'C+ grade'" }).expect(200)
    expect(names(res.body)).toEqual(['C+ grade'])
  })

  it('$filter: %20 is a space', async () => {
    const res = await request.get("/odata/Products?$filter=name%20eq%20'two%20words'").expect(200)
    expect(names(res.body)).toEqual(['two words'])
  })

  it("$filter: a doubled quote ('') is an escaped quote", async () => {
    const res = await get({ $filter: "name eq 'O''Brien'" }).expect(200)
    expect(names(res.body)).toEqual(["O'Brien"])
  })

  it('$filter: a literal that looks like percent-encoding (%26) is kept as is', async () => {
    const res = await get({ $filter: "name eq 'A %26 B'" }).expect(200)
    expect(names(res.body)).toEqual([])
  })

  it('$search: a phrase with & and +', async () => {
    const amp = await get({ $search: '"A & B"' }).expect(200)
    expect(names(amp.body)).toEqual(['A & B'])
    const plus = await get({ $search: '"C+"' }).expect(200)
    expect(names(plus.body)).toEqual(['C+ grade'])
  })

  it('$select and $orderby with encoded spaces, combined with a $filter holding &', async () => {
    const res = await get({
      $filter: "contains(name,'A & B') or name eq 'A'",
      $select: 'name, price',
      $orderby: 'name desc',
    }).expect(200)
    const value = (res.body as { value: Record<string, unknown>[] }).value
    expect(value.map((p) => p.name)).toEqual(['A & B', 'A'])
    expect(value[0]).toMatchObject({ name: 'A & B', price: 10 })
    expect(value[0]).not.toHaveProperty('description')
    expect(value[0]).not.toHaveProperty('active')
  })

  it("nested $expand options: $expand=tags($filter=name eq 'b & c')", async () => {
    const res = await get({
      $filter: "name eq 'A & B'",
      $expand: "tags($filter=name eq 'b & c';$select=name)",
    }).expect(200)
    const [first] = (res.body as { value: { tags: { name: string }[] }[] }).value
    expect(first.tags.map((t) => t.name)).toEqual(['b & c'])
  })

  it('@odata.nextLink keeps an encoded & inside its value', async () => {
    const filter = "contains(name,'A & B') or name eq '100% cotton' or contains(name,'C+')"
    const page1 = await get({ $filter: filter, $orderby: 'name', $top: '2' }).expect(200)
    const link = (page1.body as { '@odata.nextLink': string })['@odata.nextLink']
    expect(link).toContain(encodeURIComponent(filter))
    const page2 = await request.get(link.slice(link.indexOf('/odata/'))).expect(200)
    expect(names(page1.body).concat(names(page2.body)).sort()).toEqual(
      ['100% cotton', 'A & B', 'C+ grade'].sort(),
    )
  })

  it('a repeated system query option is refused with 400', async () => {
    await request.get('/odata/Products?$top=1&$top=2').expect(400)
  })

  it('normal queries are unchanged', async () => {
    const res = await request
      .get('/odata/Products')
      .query({ $filter: "startswith(name,'A')", $orderby: 'name asc', $count: 'true' })
      .expect(200)
    expect(names(res.body)).toEqual(['A', 'A & B'])
    expect((res.body as { '@odata.count': number })['@odata.count']).toBe(2)
  })
})
