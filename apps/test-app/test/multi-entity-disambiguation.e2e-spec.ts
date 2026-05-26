/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
// Supertest responses are typed as `any` for the body, so accessing `.value`,
// `.title`, etc. trips typed-linting rules even though it's safe in the test
// context. Disable the unsafe-* family for this file rather than litter every
// assertion with type casts.

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Body, Get, Header, Headers, Module, Param, Req } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm'
import supertest from 'supertest'
import {
  ODataController,
  ODataDelete,
  ODataGet,
  ODataGetByKey,
  ODataModule,
  ODataPatch,
  ODataPost,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { ODataTypeOrmModule, TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

/**
 * Regressions for the bugs + UX papercuts surfaced by the Pravex integration
 * report. All scenarios run against an in-memory SQLite fixture with two
 * entities that share column names (`id`, `tokens`, `title`) plus one entity-
 * unique column (`onlyA` / `onlyB`) — the same shape that previously caused
 * `TypeOrmAutoHandler` to mis-route /odata/Betas queries to the alphas table.
 *
 * NOTE on URLs: HTTP routes use slash-style keys (`/odata/Betas/1`) which is
 * what the library exposes for direct HTTP. The OData paren form `Betas(1)`
 * is only routable inside `$batch` requests.
 */

@Entity({ name: 'alphas' })
class Alpha {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'bigint', default: 0 })
  tokens: string

  @Column({ type: 'varchar', length: 100 })
  title: string

  @Column({ type: 'varchar', length: 100 })
  onlyA: string
}

@Entity({ name: 'betas' })
class Beta {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'bigint', default: 0 })
  tokens: string

  @Column({ type: 'varchar', length: 100 })
  title: string

  @Column({ type: 'varchar', length: 100 })
  onlyB: string
}

@ODataController('Alphas')
class AlphasController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Alphas', { path: '' })
  list(@ODataQueryParam('Alphas') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @Get('$count')
  @Header('Content-Type', 'text/plain')
  count(@ODataQueryParam('Alphas') query: ODataQuery) {
    return this.handler.handleCount(query)
  }

  @ODataGetByKey('Alphas')
  byKey(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Alphas', ifNoneMatch)
  }

  @ODataPost('Alphas')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Alphas')
  }

  @ODataPatch('Alphas')
  update(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Alphas', ifMatch)
  }

  @ODataDelete('Alphas')
  delete(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Alphas', ifMatch)
  }
}

@ODataController('Betas')
class BetasController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Betas', { path: '' })
  list(@ODataQueryParam('Betas') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @Get('$count')
  @Header('Content-Type', 'text/plain')
  count(@ODataQueryParam('Betas') query: ODataQuery) {
    return this.handler.handleCount(query)
  }

  @ODataGetByKey('Betas')
  byKey(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Betas', ifNoneMatch)
  }

  @ODataPost('Betas')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Betas')
  }

  @ODataPatch('Betas')
  update(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Betas', ifMatch)
  }

  @ODataDelete('Betas')
  delete(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Betas', ifMatch)
  }
}

// A separate controller exercising the entity-set name override (UX #1).
// Controller path 'Items' must match the OData entity-set name passed to
// forFeature() as `{ entity: Alpha, name: 'Items' }`.
@ODataController('Items')
class ItemsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Items', { path: '' })
  list(@ODataQueryParam('Items') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @ODataGetByKey('Items')
  byKey(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Items', ifNoneMatch)
  }
}

function buildModule(
  entityOrder: 'AlphaFirst' | 'BetaFirst',
  passControllersInForFeature: boolean,
  controllers: NonNullable<Parameters<typeof ODataModule.forRoot>[0]['controllers']>,
) {
  const items = entityOrder === 'AlphaFirst' ? ([Alpha, Beta] as const) : ([Beta, Alpha] as const)

  // forRoot always patches PATH_METADATA — that doesn't depend on which
  // module owns the controllers.
  const odataModule = ODataModule.forRoot({
    serviceRoot: '/odata',
    namespace: 'Default',
    controllers: [...controllers],
  })

  // UX #2 fix: when forFeature receives a `controllers` option, it both
  // patches PATH_METADATA (idempotently) AND registers them in its dynamic
  // module — so callers no longer need to declare them again in @Module.
  const featureModule = passControllersInForFeature
    ? ODataTypeOrmModule.forFeature(
        items as unknown as Parameters<typeof ODataTypeOrmModule.forFeature>[0],
        { controllers: [...controllers] },
      )
    : ODataTypeOrmModule.forFeature(
        items as unknown as Parameters<typeof ODataTypeOrmModule.forFeature>[0],
      )

  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Alpha, Beta],
        synchronize: true,
      }),
      odataModule,
      featureModule,
    ],
    // Legacy dual-declaration path: declare controllers in @Module too.
    // When the caller uses the new forFeature({controllers}) form they don't
    // need this any more — the feature module owns the registration.
    controllers: passControllersInForFeature ? [] : [...controllers],
  })
  class TestAppModule {}

  return TestAppModule
}

async function bootstrap(
  entityOrder: 'AlphaFirst' | 'BetaFirst',
  passControllersInForFeature: boolean,
  controllers: NonNullable<Parameters<typeof ODataModule.forRoot>[0]['controllers']> = [
    AlphasController,
    BetasController,
  ],
): Promise<{
  app: INestApplication
  request: ReturnType<typeof supertest>
  close: () => Promise<void>
}> {
  const TestAppModule = buildModule(entityOrder, passControllersInForFeature, controllers)
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile()
  const app = moduleFixture.createNestApplication()
  await app.init()
  const ds = moduleFixture.get<DataSource>(DataSource)
  const alphaRepo = ds.getRepository(Alpha)
  const betaRepo = ds.getRepository(Beta)
  await alphaRepo.save({ tokens: '111', title: 'A-shared', onlyA: 'alpha-only' })
  await betaRepo.save({ tokens: '222', title: 'B-shared', onlyB: 'beta-only' })
  const request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
  return { app, request, close: () => app.close() }
}

describe('Multi-entity disambiguation (e2e)', () => {
  describe('forFeature([Alpha, Beta]) — Alpha registered first', () => {
    let request: ReturnType<typeof supertest>
    let close: () => Promise<void>

    beforeAll(async () => {
      ;({ request, close } = await bootstrap('AlphaFirst', false))
    })

    afterAll(async () => {
      await close()
    })

    it('Bug #1 — /odata/Alphas returns Alpha rows (with onlyA column)', async () => {
      const res = await request.get('/odata/Alphas')
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].title).toBe('A-shared')
      expect(res.body.value[0].onlyA).toBe('alpha-only')
    })

    it('Bug #1 — /odata/Betas returns Beta rows, never misrouted Alpha rows', async () => {
      const res = await request.get('/odata/Betas')
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].title).toBe('B-shared')
      expect(res.body.value[0].onlyB).toBe('beta-only')
      // Critical assertion: the row must not be a misrouted Alpha row.
      expect(res.body.value[0]).not.toHaveProperty('onlyA')
    })

    it('Bug #1 — $filter on a column unique to Beta works (used to 500)', async () => {
      const res = await request.get('/odata/Betas').query({ $filter: "onlyB eq 'beta-only'" })
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].onlyB).toBe('beta-only')
    })

    it('Bug #1 — GET-by-key on Betas/1 returns the Beta row, not the Alpha row with id=1', async () => {
      const res = await request.get('/odata/Betas/1')
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('B-shared')
      expect(res.body.onlyB).toBe('beta-only')
    })

    it('Bug #1 — $count on Betas counts Beta rows', async () => {
      const res = await request.get('/odata/Betas/$count')
      expect(res.status).toBe(200)
      expect(Number(res.text)).toBe(1)
    })

    it('Bug #1 — POST to /odata/Betas creates a Beta row, not an Alpha row', async () => {
      const res = await request
        .post('/odata/Betas')
        .send({ tokens: '999', title: 'new-beta', onlyB: 'inserted-via-odata' })
        .set('Content-Type', 'application/json')
      expect(res.status).toBe(201)
      const list = await request.get('/odata/Betas')
      expect(
        list.body.value.some((row: { onlyB: string }) => row.onlyB === 'inserted-via-odata'),
      ).toBe(true)
      const alphaList = await request.get('/odata/Alphas')
      expect(alphaList.body.value.some((row: { title: string }) => row.title === 'new-beta')).toBe(
        false,
      )
    })

    it('Bug #1 — PATCH on /odata/Betas/:key updates a Beta row, not an Alpha row', async () => {
      const res = await request
        .patch('/odata/Betas/1')
        .send({ title: 'B-renamed' })
        .set('Content-Type', 'application/json')
      expect(res.status).toBe(200)
      const beta = await request.get('/odata/Betas/1')
      expect(beta.body.title).toBe('B-renamed')
      const alpha = await request.get('/odata/Alphas/1')
      expect(alpha.body.title).toBe('A-shared') // unchanged
    })

    it('Bug #1 — DELETE on /odata/Betas/:key removes a Beta row, not an Alpha row', async () => {
      const created = await request
        .post('/odata/Betas')
        .send({ tokens: '0', title: 'to-delete', onlyB: 'gone' })
        .set('Content-Type', 'application/json')
      const newId: number = created.body.id
      await request.delete(`/odata/Betas/${newId}`).expect(204)
      const alpha = await request.get('/odata/Alphas/1')
      expect(alpha.status).toBe(200)
      const beta = await request.get(`/odata/Betas/${newId}`)
      expect(beta.status).toBe(404)
    })

    it('Bug #2 — filter with multi-word string literal works on the correct table', async () => {
      // Multi-word literal + period inside quotes — the exact shape that
      // originally surfaced as a 500 in the Pravex report
      // (`model eq 'Claude Haiku 4.5'`). Once routed to the correct table,
      // the tokenizer + filter visitor handle it fine.
      await request
        .post('/odata/Betas')
        .send({ tokens: '0', title: 'Wireless Mouse 4.5', onlyB: 'multi-word' })
        .set('Content-Type', 'application/json')

      const res = await request
        .get('/odata/Betas')
        .query({ $filter: "title eq 'Wireless Mouse 4.5'" })
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].onlyB).toBe('multi-word')
    })

    it('UX #3 — @odata.nextLink uses serviceRoot, not req.originalUrl', async () => {
      // Seed enough rows to require pagination so the response carries nextLink.
      for (let i = 0; i < 25; i++) {
        await request
          .post('/odata/Betas')
          .send({ tokens: '0', title: `paginated-${i}`, onlyB: `p${i}` })
          .set('Content-Type', 'application/json')
      }
      const res = await request.get('/odata/Betas').query({ $top: 5 })
      expect(res.status).toBe(200)
      const link = res.body['@odata.nextLink'] as string
      expect(link).toBeDefined()
      // Critical: must match @odata.context base — both rooted at serviceRoot.
      const ctx = res.body['@odata.context'] as string
      expect(ctx.startsWith('/odata/')).toBe(true)
      expect(link.startsWith('/odata/Betas')).toBe(true)
      expect(link).toContain('$skip=5')
      expect(link).toContain('$top=5')
    })
  })

  describe('forFeature([Beta, Alpha]) — registration order swapped', () => {
    let request: ReturnType<typeof supertest>
    let close: () => Promise<void>

    beforeAll(async () => {
      ;({ request, close } = await bootstrap('BetaFirst', false))
    })

    afterAll(async () => {
      await close()
    })

    it('/odata/Alphas still returns Alpha rows (order-independent)', async () => {
      const res = await request.get('/odata/Alphas')
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].onlyA).toBe('alpha-only')
    })

    it('/odata/Betas still returns Beta rows (order-independent)', async () => {
      const res = await request.get('/odata/Betas')
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].onlyB).toBe('beta-only')
    })
  })

  describe('UX #2 — single declaration via forFeature({ controllers })', () => {
    let request: ReturnType<typeof supertest>
    let close: () => Promise<void>

    beforeAll(async () => {
      // Crucial: @Module({controllers}) is empty here. ODataTypeOrmModule
      // .forFeature({ controllers }) is the only place controllers appear —
      // it must register them in its own dynamic module (so DI sees
      // TypeOrmAutoHandler) AND patch their PATH_METADATA.
      ;({ request, close } = await bootstrap('AlphaFirst', true))
    })

    afterAll(async () => {
      await close()
    })

    it('routes registered via forFeature({controllers}) alone are reachable', async () => {
      const res = await request.get('/odata/Alphas')
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].onlyA).toBe('alpha-only')
    })

    it('routes for the second entity also reachable from a single forFeature call', async () => {
      const res = await request.get('/odata/Betas')
      expect(res.status).toBe(200)
      expect(res.body.value).toHaveLength(1)
      expect(res.body.value[0].onlyB).toBe('beta-only')
    })
  })
})

describe('UX #1 — entity-set name override via forFeature({ entity, name })', () => {
  let request: ReturnType<typeof supertest>
  let app: INestApplication

  beforeAll(async () => {
    @Module({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Alpha],
          synchronize: true,
        }),
        ODataModule.forRoot({
          serviceRoot: '/odata',
          namespace: 'Default',
          controllers: [ItemsController],
        }),
        ODataTypeOrmModule.forFeature([{ entity: Alpha, name: 'Items' }], {
          controllers: [ItemsController],
        }),
      ],
    })
    class TestAppModule {}

    const fixture = await Test.createTestingModule({ imports: [TestAppModule] }).compile()
    app = fixture.createNestApplication()
    await app.init()
    const ds = fixture.get<DataSource>(DataSource)
    await ds.getRepository(Alpha).save({ tokens: '111', title: 'A-only', onlyA: 'override-set' })
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
  })

  afterAll(async () => {
    await app.close()
  })

  it('exposes /odata/Items (not /odata/Alphas) when name is overridden', async () => {
    const res = await request.get('/odata/Items')
    expect(res.status).toBe(200)
    expect(res.body.value).toHaveLength(1)
    expect(res.body.value[0].onlyA).toBe('override-set')
    // @odata.context should use the overridden set name
    expect(res.body['@odata.context']).toBe('/odata/$metadata#Items')
  })

  it('the default /odata/Alphas is no longer registered', async () => {
    const res = await request.get('/odata/Alphas')
    // Either 404 (no route) or 500/400 if metadata controller falls through — accept any non-200
    expect(res.status).not.toBe(200)
  })
})

describe('UX #4 — ODataModule.globalPrefixExclude() helper', () => {
  it('returns Express 5 splat patterns covering the service root and its children', async () => {
    // Force forRoot to register the service root so the helper returns the
    // correct pattern. Use a unique value to avoid leaking state between tests.
    ODataModule.forRoot({ serviceRoot: '/odata' })
    const patterns = ODataModule.globalPrefixExclude()
    expect(Array.isArray(patterns)).toBe(true)
    expect(patterns.length).toBeGreaterThanOrEqual(1)
    // Should contain both the bare root and the splat pattern matching children.
    const paths = patterns.map((p) => p.path)
    expect(paths).toContain('odata')
    expect(paths.some((p) => p.includes('odata') && p.includes('{*splat}'))).toBe(true)
  })

  it('honors an explicit override argument', () => {
    const patterns = ODataModule.globalPrefixExclude('/v2/odata')
    const paths = patterns.map((p) => p.path)
    expect(paths).toContain('v2/odata')
  })
})
