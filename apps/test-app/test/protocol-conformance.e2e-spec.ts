/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// Supertest bodies are `any`; the unsafe-* rules are disabled for this file.

/**
 * OData 4.01 protocol conformance of HTTP writes, ETags, routing and errors:
 *
 *   #63 canonical Set(key) URLs are routed       #77 304 without a server error
 *   #70 If-None-Match on writes → 412             #78 Express `etag` warning
 *   #71 Content-Language on errors                #79 Prefer: return=minimal
 *   #75 computed / unknown properties on writes   #80 requireIfMatch → 428
 *   #76 PUT ignores a body key                    #81 @odata.etag on collection items
 */

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Body, INestApplication, Param, Req, type LoggerService } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Test } from '@nestjs/testing'
import {
  Column,
  CreateDateColumn,
  DataSource,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import supertest from 'supertest'
import {
  ODataController,
  ODataDelete,
  ODataGet,
  ODataGetByKey,
  ODataModule,
  ODataPatch,
  ODataPost,
  ODataPut,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { formatWeakETag, ODataTypeOrmModule, TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

@Entity({ name: 'pc_gadgets' })
class Gadget {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  name: string

  @Column({ type: 'integer' })
  price: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}

@Entity({ name: 'pc_vaults' })
class Vault {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  name: string

  @Column({ type: 'integer', default: 1 })
  version: number
}

@Entity({ name: 'pc_lines' })
class Line {
  @PrimaryColumn({ type: 'integer' })
  orderId: number

  @PrimaryColumn({ type: 'integer' })
  lineNo: number

  @Column({ type: 'varchar', length: 50 })
  label: string
}

/** Controllers bind no conditional headers: the handler reads them from the request. */
@ODataController('Gadgets')
class GadgetsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Gadgets', { path: '' })
  list(@ODataQueryParam('Gadgets') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @ODataGetByKey('Gadgets')
  get(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Gadgets')
  }

  @ODataPost('Gadgets')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Gadgets')
  }

  @ODataPatch('Gadgets')
  update(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.handler.handleUpdate(key, body, 'Gadgets')
  }

  @ODataPut('Gadgets')
  replace(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.handler.handleReplace(key, body, 'Gadgets')
  }

  @ODataDelete('Gadgets')
  remove(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Gadgets')
  }
}

@ODataController('Vaults')
class VaultsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGetByKey('Vaults')
  get(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Vaults')
  }

  @ODataPost('Vaults')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Vaults')
  }

  @ODataPatch('Vaults')
  update(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.handler.handleUpdate(key, body, 'Vaults')
  }

  @ODataDelete('Vaults')
  remove(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Vaults')
  }
}

@ODataController('Lines')
class LinesController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGetByKey('Lines')
  get(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Lines')
  }
}

/** Collects what Nest logs, to check that a 304 logs no error and the etag warning. */
class CollectingLogger implements LoggerService {
  readonly errors: string[] = []
  readonly warnings: string[] = []
  log(): void {}
  error(message: unknown, ...rest: unknown[]): void {
    this.errors.push([message, ...rest].map(String).join(' '))
  }
  warn(message: unknown): void {
    this.warnings.push(String(message))
  }
}

const BOUNDARY = 'pc_batch'
function batchBody(parts: string[]): string {
  return [...parts.map((p) => `--${BOUNDARY}\r\n${p}`), `--${BOUNDARY}--`].join('\r\n')
}
function batchRequest(
  method: string,
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): string {
  const headers = Object.entries(options.headers ?? {}).map(([k, v]) => `${k}: ${v}`)
  const head = [`${method} /odata/${url} HTTP/1.1`, ...headers]
  const request =
    options.body === undefined
      ? head.join('\r\n')
      : [...head, 'Content-Type: application/json', '', JSON.stringify(options.body)].join('\r\n')
  return ['Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', request].join(
    '\r\n',
  )
}

async function createApp(logger: LoggerService, disableExpressETag: boolean) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Gadget, Vault, Line],
        synchronize: true,
      }),
      ODataModule.forRoot({ serviceRoot: '/odata' }),
      ODataTypeOrmModule.forFeature(
        [
          { entity: Gadget, name: 'Gadgets' },
          { entity: Vault, name: 'Vaults', etag: 'version', requireIfMatch: true },
          { entity: Line, name: 'Lines' },
        ],
        { controllers: [GadgetsController, VaultsController, LinesController] },
      ),
    ],
  }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger })
  if (disableExpressETag) app.set('etag', false)
  await app.init()
  return app
}

describe('OData protocol conformance (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>
  let dataSource: DataSource
  const logger = new CollectingLogger()

  async function postBatch(body: string): Promise<string> {
    const res = await http
      .post('/odata/$batch')
      .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
      .send(body)
      .buffer(true)
      .parse((res, fn) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => fn(null, Buffer.concat(chunks).toString('utf-8')))
      })
    expect(res.status).toBe(200)
    return res.body as string
  }

  async function newGadget(name = 'g', price = 1): Promise<{ id: number; etag: string }> {
    const res = await http.post('/odata/Gadgets').send({ name, price }).expect(201)
    return { id: res.body.id, etag: res.headers.etag }
  }

  async function gadget(id: number) {
    return dataSource.getRepository(Gadget).findOneBy({ id })
  }

  beforeAll(async () => {
    app = await createApp(logger, true)
    http = supertest(app.getHttpServer())
    dataSource = app.get(DataSource)
    await dataSource.getRepository(Line).save({ orderId: 1, lineNo: 2, label: 'one-two' })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('#63 canonical Set(key) URLs', () => {
    it('Location and @odata.id are canonical and resolvable', async () => {
      const created = await http.post('/odata/Gadgets').send({ name: 'loc', price: 3 }).expect(201)
      const location = created.headers.location
      expect(location).toBe(`/odata/Gadgets(${created.body.id})`)
      expect(created.body['@odata.id']).toBe(location)

      const fetched = await http.get(location).expect(200)
      expect(fetched.body).toMatchObject({ id: created.body.id, name: 'loc' })
      expect(fetched.body['@odata.id']).toBe(location)
    })

    it('GET, PATCH, PUT and DELETE work on Set(key), and the key-as-segment form still works', async () => {
      const { id } = await newGadget('routes')
      await http.get(`/odata/Gadgets/${id}`).expect(200)
      await http.patch(`/odata/Gadgets(${id})`).send({ price: 5 }).expect(200)
      expect((await gadget(id))?.price).toBe(5)
      await http.put(`/odata/Gadgets(${id})`).send({ name: 'put', price: 6 }).expect(200)
      expect(await gadget(id)).toMatchObject({ name: 'put', price: 6 })
      await http.delete(`/odata/Gadgets(${id})`).expect(204)
      const missing = await http.get(`/odata/Gadgets(${id})`).expect(404)
      expect(missing.body.error.code).toBe('NotFound')
    })

    it('routes composite keys in both forms', async () => {
      const a = await http.get('/odata/Lines(orderId=1,lineNo=2)').expect(200)
      expect(a.body).toMatchObject({ orderId: 1, lineNo: 2, label: 'one-two' })
      expect(a.body['@odata.id']).toBe('/odata/Lines(orderId=1,lineNo=2)')
      await http.get('/odata/Lines/orderId=1,lineNo=2').expect(200)
    })

    it('leaves unknown entity sets alone', async () => {
      await http.get('/odata/Nope(1)').expect(404)
    })
  })

  describe('#70 If-None-Match on data modification requests', () => {
    it('PATCH, PUT and DELETE with a matching If-None-Match answer 412 and change nothing', async () => {
      const { id, etag } = await newGadget('inm', 1)
      for (const value of [etag, '*']) {
        await http
          .patch(`/odata/Gadgets(${id})`)
          .set('If-None-Match', value)
          .send({ price: 9 })
          .expect(412)
        await http
          .put(`/odata/Gadgets(${id})`)
          .set('If-None-Match', value)
          .send({ name: 'x', price: 9 })
          .expect(412)
        await http.delete(`/odata/Gadgets(${id})`).set('If-None-Match', value).expect(412)
      }
      expect(await gadget(id)).toMatchObject({ name: 'inm', price: 1 })
    })

    it('a non-matching If-None-Match lets the write through', async () => {
      const { id } = await newGadget('inm2', 1)
      await http
        .patch(`/odata/Gadgets(${id})`)
        .set('If-None-Match', formatWeakETag('other'))
        .send({ price: 2 })
        .expect(200)
    })

    it('applies to $batch parts', async () => {
      const { id } = await newGadget('inm3', 1)
      const text = await postBatch(
        batchBody([
          batchRequest('PATCH', `Gadgets(${id})`, {
            body: { price: 7 },
            headers: { 'If-None-Match': '*' },
          }),
        ]),
      )
      expect(text).toContain('HTTP/1.1 412')
      expect((await gadget(id))?.price).toBe(1)
    })
  })

  describe('#71 Content-Language on errors', () => {
    it('error responses carry Content-Language: en', async () => {
      const res = await http.get('/odata/Gadgets?$filter=nope eq 1').expect(400)
      expect(res.headers['content-language']).toBe('en')
    })

    it('$batch error parts carry Content-Language', async () => {
      const text = await postBatch(batchBody([batchRequest('GET', 'Gadgets(999999)')]))
      expect(text).toContain('HTTP/1.1 404')
      expect(text).toContain('Content-Language: en')
    })
  })

  describe('#75 computed and unknown properties on writes', () => {
    it('POST and PATCH ignore computed properties', async () => {
      const created = await http
        .post('/odata/Gadgets')
        .send({ name: 'computed', price: 1, createdAt: '2000-01-01T00:00:00.000Z' })
        .expect(201)
      expect(new Date(created.body.createdAt).getFullYear()).not.toBe(2000)
      const patched = await http
        .patch(`/odata/Gadgets(${created.body.id})`)
        .send({ price: 2, updatedAt: '2000-01-01T00:00:00.000Z' })
        .expect(200)
      expect(new Date(patched.body.updatedAt).getFullYear()).not.toBe(2000)
    })

    it('a property that is not in the entity type answers 400, with no change', async () => {
      const { id } = await newGadget('unknown', 1)
      const res = await http.patch(`/odata/Gadgets(${id})`).send({ price: 3, nope: 1 }).expect(400)
      expect(res.body.error.message).toContain("'nope'")
      expect(res.body.error.details[0]).toMatchObject({ code: 'UnknownProperty', target: 'nope' })
      expect((await gadget(id))?.price).toBe(1)
      await http.post('/odata/Gadgets').send({ name: 'n', price: 1, nope: 1 }).expect(400)
      await http.put(`/odata/Gadgets(${id})`).send({ name: 'n', price: 1, nope: 1 }).expect(400)
    })

    it('$batch writes follow the same rules', async () => {
      const text = await postBatch(
        batchBody([batchRequest('POST', 'Gadgets', { body: { name: 'b', price: 1, nope: 1 } })]),
      )
      expect(text).toContain('HTTP/1.1 400')
    })

    it('$metadata annotates computed properties with Core.Computed', async () => {
      const res = await http.get('/odata/$metadata').expect(200)
      expect(res.text).toContain('<edmx:Include Namespace="Org.OData.Core.V1" Alias="Core"/>')
      expect(res.text).toMatch(
        /<Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false">\s*<Annotation Term="Core.Computed" Bool="true"\/>/,
      )
      expect(res.text).toMatch(
        /<Property Name="createdAt"[^>]*>\s*<Annotation Term="Core.Computed"/,
      )
    })
  })

  describe('#76 PUT ignores a body key that differs from the URL key', () => {
    it('replaces the entity at the URL key, over HTTP and in $batch', async () => {
      const a = await newGadget('a', 1)
      const b = await newGadget('b', 1)
      const res = await http
        .put(`/odata/Gadgets(${a.id})`)
        .send({ id: b.id, name: 'a2', price: 2 })
        .expect(200)
      expect(res.body.id).toBe(a.id)
      expect(await gadget(a.id)).toMatchObject({ name: 'a2', price: 2 })
      expect(await gadget(b.id)).toMatchObject({ name: 'b', price: 1 })

      const text = await postBatch(
        batchBody([
          batchRequest('PUT', `Gadgets(${a.id})`, { body: { id: b.id, name: 'a3', price: 3 } }),
        ]),
      )
      expect(text).toContain('HTTP/1.1 200')
      expect(await gadget(a.id)).toMatchObject({ name: 'a3', price: 3 })
      expect(await gadget(b.id)).toMatchObject({ name: 'b', price: 1 })
    })
  })

  describe('#77 304 Not Modified', () => {
    it('answers 304 with no body and logs no error', async () => {
      const { id } = await newGadget('cache', 1)
      const first = await http.get(`/odata/Gadgets(${id})`).expect(200)
      const before = logger.errors.length
      const res = await http
        .get(`/odata/Gadgets(${id})`)
        .set('If-None-Match', first.headers.etag)
        .expect(304)
      expect(res.text ?? '').toBe('')
      expect(res.headers.etag).toBe(first.headers.etag)
      // Let Nest finish its reply before checking the log.
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(logger.errors.slice(before).join('\n')).not.toContain('Cannot set headers')
      expect(logger.errors.length).toBe(before)
    })
  })

  describe("#78 Express's etag setting", () => {
    it('with app.set("etag", false), error responses carry no hash ETag and no warning is logged', async () => {
      const res = await http.get('/odata/Gadgets?$filter=nope eq 1').expect(400)
      expect(res.headers.etag).toBeUndefined()
      expect(logger.warnings.join('\n')).not.toContain("'etag' setting")
    })

    it('warns at startup when the setting is left on', async () => {
      const other = new CollectingLogger()
      const defaultApp = await createApp(other, false)
      await defaultApp.close()
      expect(other.warnings.join('\n')).toContain("app.set('etag', false)")
    })
  })

  describe('#79 Prefer: return=minimal', () => {
    it('POST answers 204 with Location, OData-EntityId and Preference-Applied', async () => {
      const res = await http
        .post('/odata/Gadgets')
        .set('Prefer', 'return=minimal')
        .send({ name: 'minimal', price: 1 })
        .expect(204)
      expect(res.text ?? '').toBe('')
      expect(res.headers['preference-applied']).toBe('return=minimal')
      expect(res.headers.location).toMatch(/^\/odata\/Gadgets\(\d+\)$/)
      expect(res.headers['odata-entityid']).toBe(res.headers.location)
      await http.get(res.headers.location).expect(200)
    })

    it('PATCH and PUT answer 204 with Preference-Applied and the new ETag', async () => {
      const { id } = await newGadget('min', 1)
      const patch = await http
        .patch(`/odata/Gadgets(${id})`)
        .set('Prefer', 'return=minimal')
        .send({ price: 4 })
        .expect(204)
      expect(patch.headers['preference-applied']).toBe('return=minimal')
      expect(patch.headers.etag).toBeDefined()
      expect((await gadget(id))?.price).toBe(4)
      await http
        .put(`/odata/Gadgets(${id})`)
        .set('Prefer', 'return=minimal')
        .send({ name: 'min', price: 5 })
        .expect(204)
    })

    it('return=representation answers with the entity and Preference-Applied', async () => {
      const { id } = await newGadget('rep', 1)
      const res = await http
        .patch(`/odata/Gadgets(${id})`)
        .set('Prefer', 'return=representation')
        .send({ price: 4 })
        .expect(200)
      expect(res.body.price).toBe(4)
      expect(res.headers['preference-applied']).toBe('return=representation')
    })

    it('applies to $batch parts', async () => {
      const text = await postBatch(
        batchBody([
          batchRequest('POST', 'Gadgets', {
            body: { name: 'batch-min', price: 1 },
            headers: { Prefer: 'return=minimal' },
          }),
        ]),
      )
      expect(text).toContain('HTTP/1.1 204')
      expect(text).toContain('Preference-Applied: return=minimal')
      expect(text).toMatch(/OData-EntityId: \/odata\/Gadgets\(\d+\)/)
      expect(text).not.toContain('"batch-min"')
    })
  })

  describe('#80 requireIfMatch', () => {
    async function newVault(): Promise<{ id: number; etag: string }> {
      const res = await http.post('/odata/Vaults').send({ name: 'v' }).expect(201)
      return { id: res.body.id, etag: res.headers.etag }
    }

    it('PATCH and DELETE without If-Match answer 428 and change nothing', async () => {
      const { id } = await newVault()
      const res = await http.patch(`/odata/Vaults(${id})`).send({ name: 'w' }).expect(428)
      expect(res.body.error.code).toBe('PreconditionRequired')
      await http.delete(`/odata/Vaults(${id})`).expect(428)
      expect(await dataSource.getRepository(Vault).findOneBy({ id })).toMatchObject({ name: 'v' })
    })

    it('writes with a matching If-Match succeed', async () => {
      const { id, etag } = await newVault()
      await http.patch(`/odata/Vaults(${id})`).set('If-Match', etag).send({ name: 'w' }).expect(200)
    })

    it('$batch parts without If-Match answer 428', async () => {
      const { id } = await newVault()
      const text = await postBatch(
        batchBody([batchRequest('PATCH', `Vaults(${id})`, { body: { name: 'b' } })]),
      )
      expect(text).toContain('HTTP/1.1 428')
      expect(await dataSource.getRepository(Vault).findOneBy({ id })).toMatchObject({ name: 'v' })
    })

    it('$metadata advertises Core.OptimisticConcurrency on the entity set', async () => {
      const res = await http.get('/odata/$metadata').expect(200)
      expect(res.text).toMatch(
        /<EntitySet Name="Vaults" EntityType="Default.Vault">\s*<Annotation Term="Core.OptimisticConcurrency">\s*<Collection>\s*<PropertyPath>version<\/PropertyPath>/,
      )
      expect(res.text).toContain('<EntitySet Name="Gadgets" EntityType="Default.Gadget"/>')
    })
  })

  describe('#81 @odata.etag on collection items', () => {
    it('each entity of a collection carries the ETag a by-key read returns', async () => {
      const { id } = await newGadget('collection', 1)
      const single = await http.get(`/odata/Gadgets(${id})`).expect(200)
      const list = await http.get(`/odata/Gadgets?$filter=id eq ${id}`).expect(200)
      expect(list.body.value[0]['@odata.etag']).toBe(single.headers.etag)
      expect(list.body.value[0]).not.toHaveProperty('__etag')
      expect(list.headers.etag).toBeUndefined()
      await http
        .patch(`/odata/Gadgets(${id})`)
        .set('If-Match', list.body.value[0]['@odata.etag'])
        .send({ price: 2 })
        .expect(200)
    })
  })
})
