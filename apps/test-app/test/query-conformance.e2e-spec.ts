/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// Supertest bodies are `any`; the unsafe-* rules are disabled for this file.

/**
 * OData 4.01 query-language conformance over HTTP:
 *   - #66 `$filter` on single-valued navigation paths (P2 §5.1.1.15)
 *   - #68 case-insensitive `any`/`all` and `$it` (P2 §5.1.1.13, §5.1.1.14.4)
 *   - #69 nested `$expand` `$count`, `nav/$count`, `$search`, `$levels`; 501 for the options
 *         that are not implemented (P2 §5.1.3, P1 §9.3.1)
 *   - #72 lambdas over many-to-many navigations
 *   - #74 nested `$top`/`$skip`, paged in SQL and keyed by expand path
 *
 * The issue repros run against the test app (Products, Orders); `$levels`, nested `$search`
 * and scoped counts use a small fixture with a recursive navigation property.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Inject, INestApplication, Req } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import {
  Column,
  DataSource,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm'
import supertest from 'supertest'
import {
  ODataController,
  ODataGet,
  ODataModule,
  ODataQueryParam,
  ODataSearchable,
  type ODataQuery,
} from '@nestjs-odata/core'
import {
  ODataTypeOrmModule,
  TypeOrmAutoHandler,
  type ODataScopeContext,
} from '@nestjs-odata/typeorm'
import { AppModule } from '../src/app.module.js'
import { Category, Order, OrderItem, Product, Tag, Customer } from '../src/entities/index.js'

describe('OData query conformance — test app (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>

  const ids = (res: { body: { value: { id: number }[] } }) =>
    res.body.value.map((v) => v.id).sort((a, b) => a - b)

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    await app.init()
    http = supertest(app.getHttpServer())

    const ds = moduleFixture.get(DataSource)
    const [tools, food] = await ds
      .getRepository(Category)
      .save([{ name: 'Tools' }, { name: 'Food' }] as Category[])
    const [sale, fresh] = await ds
      .getRepository(Tag)
      .save([{ name: 'sale' }, { name: 'fresh' }] as Tag[])
    const base = { active: true, createdAt: new Date() }
    await ds.getRepository(Product).save([
      { ...base, id: 1, name: 'Hammer', price: 10, categoryId: tools.id, tags: [sale] },
      { ...base, id: 2, name: 'Saw', price: 20, categoryId: tools.id, tags: [] },
      { ...base, id: 3, name: 'Bread', price: 3, categoryId: food.id, tags: [fresh, sale] },
      { ...base, id: 4, name: 'Loose', price: 1, categoryId: null, tags: [] },
    ] as Product[])
    const customer = await ds
      .getRepository(Customer)
      .save({ firstName: 'Ada', lastName: 'L', email: 'ada@example.com' } as Customer)
    await ds.getRepository(Order).save([
      { id: 1, orderDate: new Date(), totalAmount: 50, customerId: customer.id },
      { id: 2, orderDate: new Date(), totalAmount: 500, customerId: customer.id },
    ] as Order[])
    await ds.getRepository(OrderItem).save([
      { id: 1, orderId: 1, productId: 1, quantity: 150, unitPrice: 1 },
      { id: 2, orderId: 1, productId: 2, quantity: 30, unitPrice: 1 },
      { id: 3, orderId: 1, productId: 3, quantity: 60, unitPrice: 1 },
      { id: 4, orderId: 2, productId: 1, quantity: 5, unitPrice: 1 },
    ] as OrderItem[])
  })

  afterAll(async () => {
    await app.close()
  })

  describe('#66 navigation paths in $filter', () => {
    it("GET /odata/Products?$filter=category/name eq 'Tools' returns the Tools products", async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: "category/name eq 'Tools'" })
        .expect(200)
      expect(ids(res)).toEqual([1, 2])
    })

    it('combines navigation paths with or and string functions', async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: "startswith(category/name, 'Fo') or price gt 15" })
        .expect(200)
      expect(ids(res)).toEqual([2, 3])
    })

    it('treats a missing related entity as null (eq null)', async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: 'category/name eq null' })
        .expect(200)
      expect(ids(res)).toEqual([4])
    })

    it('rejects a collection-valued navigation without any/all (400)', async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: 'orderItems/quantity gt 1' })
        .expect(400)
      expect(res.body.error.message).toMatch(/any\/all/)
    })

    it('answers 501 for navigation paths in $orderby', async () => {
      const res = await http.get('/odata/Products').query({ $orderby: 'category/name' }).expect(501)
      expect(res.body.error.code).toBe('NotImplemented')
    })
  })

  describe('#68 lambda operators', () => {
    it('accepts uppercase ANY', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $filter: 'items/ANY(d:d/quantity gt 100)' })
        .expect(200)
      expect(ids(res)).toEqual([1])
    })

    it('binds $it to the outer entity inside a lambda', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $filter: 'items/any(d:d/quantity gt $it/totalAmount)' })
        .expect(200)
      expect(ids(res)).toEqual([1])
    })

    it('answers 501 for $root', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $filter: "$root/Products(1)/name eq 'x'" })
        .expect(501)
      expect(res.body.error).toMatchObject({ code: 'NotImplemented' })
      expect(res.body.error.message).toContain('$root')
    })
  })

  describe('#72 lambdas over many-to-many navigations', () => {
    it("GET /odata/Products?$filter=tags/any(t:t/name eq 'sale') filters by tag", async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: "tags/any(t:t/name eq 'sale')" })
        .expect(200)
      expect(ids(res)).toEqual([1, 3])
    })

    it('negates a many-to-many lambda with not', async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: "not tags/any(t:t/name eq 'sale')" })
        .expect(200)
      expect(ids(res)).toEqual([2, 4])
    })

    it('supports all over a many-to-many navigation', async () => {
      const res = await http
        .get('/odata/Products')
        .query({ $filter: "tags/all(t:t/name eq 'sale')" })
        .expect(200)
      // Products without tags satisfy all() vacuously.
      expect(ids(res)).toEqual([1, 2, 4])
    })
  })

  describe('#69 nested $expand options', () => {
    it('GET /odata/Orders?$expand=items($count=true) annotates items@odata.count', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $expand: 'items($count=true;$top=1)', $orderby: 'id' })
        .expect(200)
      expect(res.body.value.map((o: any) => o['items@odata.count'])).toEqual([3, 1])
      expect(res.body.value[0].items).toHaveLength(1)
    })

    it('GET /odata/Orders?$expand=items/$count returns only the count', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $expand: 'items/$count($filter=quantity gt 40)', $orderby: 'id' })
        .expect(200)
      expect(res.body.value.map((o: any) => o['items@odata.count'])).toEqual([2, 0])
      expect(res.body.value[0]).not.toHaveProperty('items')
    })

    it('rejects $search on an entity without searchable properties instead of ignoring it', async () => {
      await http.get('/odata/Orders').query({ $expand: 'items($search=x)' }).expect(400)
    })

    it('answers 501 for nested options that are not implemented', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $expand: 'items($compute=quantity mul 2 as double)' })
        .expect(501)
      expect(res.body.error.code).toBe('NotImplemented')
      await http.get('/odata/Orders').query({ $expand: 'items/$ref' }).expect(501)
    })

    it('rejects an unknown nested option (400)', async () => {
      await http.get('/odata/Orders').query({ $expand: 'items($foo=1)' }).expect(400)
    })
  })

  describe('#74 nested $top/$skip', () => {
    it('GET /odata/Orders?$expand=items($top=1;$skip=1;$orderby=quantity desc) returns the page', async () => {
      const res = await http
        .get('/odata/Orders')
        .query({ $expand: 'items($top=1;$skip=1;$orderby=quantity desc)', $orderby: 'id' })
        .expect(200)
      // Order 1 by quantity desc: 150 (1), 60 (3), 30 (2) → the second is item 3.
      expect(res.body.value.map((o: any) => o.items.map((i: any) => i.id))).toEqual([[3], []])
    })
  })
})

// ---------------------------------------------------------------------------
// Fixture: a recursive navigation ($levels), searchable names and a row-level scope
// ---------------------------------------------------------------------------

@Entity({ name: 'qc_employees' })
class QcEmployee {
  @PrimaryGeneratedColumn()
  id: number

  @ODataSearchable()
  @Column({ type: 'varchar', length: 50 })
  name: string

  @Column({ type: 'varchar', length: 10 })
  team: string

  @Column({ type: 'integer', nullable: true })
  managerId: number | null

  @ManyToOne(() => QcEmployee, (e) => e.reports)
  manager: QcEmployee | null

  @OneToMany(() => QcEmployee, (e) => e.manager)
  reports: QcEmployee[]
}

/** Callers see the employees of their team (`x-team` header); no header sees everyone. */
function teamScope(qb: SelectQueryBuilder<ObjectLiteral>, ctx: ODataScopeContext): void {
  const team = (ctx.request as { headers?: Record<string, string> } | undefined)?.headers?.[
    'x-team'
  ]
  if (team) qb.andWhere(`${ctx.alias}.team = :team`, { team })
}

@ODataController('QcEmployees')
class QcEmployeesController {
  constructor(@Inject(TypeOrmAutoHandler) private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('QcEmployees', { path: '' })
  list(@ODataQueryParam('QcEmployees') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }
}

describe('OData query conformance — recursive fixture (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [QcEmployee],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata', maxExpandDepth: 3 }),
        ODataTypeOrmModule.forFeature(
          [{ entity: QcEmployee, name: 'QcEmployees', scope: teamScope }],
          { controllers: [QcEmployeesController] },
        ),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    http = supertest(app.getHttpServer())

    // 1 (ceo) ← 2 (cto) ← 3 (dev lead) ← 4 (dev); 5 (designer) and 6 (other team) report to 1.
    await app
      .get(DataSource)
      .getRepository(QcEmployee)
      .save([
        { id: 1, name: 'Ceo Alice', team: 'core', managerId: null },
        { id: 2, name: 'Cto Bob', team: 'core', managerId: 1 },
        { id: 3, name: 'Lead Carol', team: 'core', managerId: 2 },
        { id: 4, name: 'Dev Dan', team: 'core', managerId: 3 },
        { id: 5, name: 'Designer Eve', team: 'core', managerId: 1 },
        { id: 6, name: 'Sales Frank', team: 'sales', managerId: 1 },
      ])
  })

  afterAll(async () => {
    await app.close()
  })

  it('expands a recursive navigation $levels deep, repeating the nested options', async () => {
    const res = await http
      .get('/odata/QcEmployees')
      .query({ $filter: 'id eq 4', $expand: 'manager($levels=2;$select=id,name)' })
      .expect(200)
    const [dan] = res.body.value
    expect(dan.manager).toMatchObject({ id: 3, name: 'Lead Carol' })
    expect(dan.manager.manager).toMatchObject({ id: 2, name: 'Cto Bob' })
    expect(dan.manager.manager.manager).toBeUndefined()
    expect(dan.manager).not.toHaveProperty('team')
  })

  it('$levels=max expands to the configured maximum depth', async () => {
    const res = await http
      .get('/odata/QcEmployees')
      .query({ $filter: 'id eq 4', $expand: 'manager($levels=max)' })
      .expect(200)
    const [dan] = res.body.value
    expect(dan.manager.manager.manager).toMatchObject({ id: 1 })
  })

  it('rejects $levels above the expansion depth limit (400)', async () => {
    await http.get('/odata/QcEmployees').query({ $expand: 'manager($levels=5)' }).expect(400)
  })

  it('applies a nested $search and counts the matches', async () => {
    const res = await http
      .get('/odata/QcEmployees')
      .query({ $filter: 'id eq 1', $expand: 'reports($search=Cto OR Sales;$count=true)' })
      .expect(200)
    const [ceo] = res.body.value
    expect(ceo.reports.map((e: any) => e.id).sort()).toEqual([2, 6])
    expect(ceo['reports@odata.count']).toBe(2)
  })

  it('applies the row-level scope to nested counts and navigation filters', async () => {
    const count = await http
      .get('/odata/QcEmployees')
      .set('x-team', 'core')
      .query({ $filter: 'id eq 1', $expand: 'reports/$count' })
      .expect(200)
    expect(count.body.value[0]['reports@odata.count']).toBe(2) // 6 is in the sales team

    const nav = await http
      .get('/odata/QcEmployees')
      .set('x-team', 'sales')
      .query({ $filter: "manager/name eq 'Ceo Alice'" })
      .expect(200)
    // Frank's manager is outside the sales scope: the path is null, nothing matches.
    expect(nav.body.value).toEqual([])
  })

  it('pages nested collections per parent', async () => {
    const res = await http
      .get('/odata/QcEmployees')
      .query({
        $filter: 'id le 2',
        $orderby: 'id',
        $expand: 'reports($top=1;$skip=1;$orderby=id)',
      })
      .expect(200)
    // Reports of 1: 2, 5, 6 → [5]; reports of 2: 3 → [].
    expect(res.body.value.map((e: any) => e.reports.map((r: any) => r.id))).toEqual([[5], []])
  })

  it('keeps the options of two expand paths ending in the same navigation apart', async () => {
    const res = await http
      .get('/odata/QcEmployees')
      .query({
        $filter: 'id eq 2',
        $expand: 'reports($top=1),manager($expand=reports($top=2;$skip=1;$orderby=id))',
      })
      .expect(200)
    const [bob] = res.body.value
    expect(bob.reports.map((e: any) => e.id)).toEqual([3])
    // Reports of Alice (Bob's manager): 2, 5, 6 → skip 1, top 2 → 5, 6.
    expect(bob.manager.reports.map((e: any) => e.id)).toEqual([5, 6])
  })
})
