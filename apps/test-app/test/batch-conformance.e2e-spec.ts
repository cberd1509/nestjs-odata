/**
 * OData 4.01 `$batch` conformance (e2e):
 *
 *   - #64 A failed changeset is answered with a single `application/http` error response that
 *         carries the failing request's Content-ID; a successful changeset is a nested
 *         multipart/mixed part (OData-Protocol §11.7.7.5).
 *   - #65 A GET in a batch honours its query options and gets the same response envelope as the
 *         standalone request (§11.7: "evaluated according to the same semantics").
 *   - #67 Every operation runs through its route: guards, interceptors, pipes, exception filters
 *         (a guard that denies answers 403; inside a changeset the whole changeset fails).
 *   - #73 One `$batch` endpoint serves the entity sets of every forFeature() module.
 */
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BadRequestException,
  Body,
  Get,
  Header,
  Injectable,
  Module,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
  type PipeTransform,
  UsePipes,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import supertest from 'supertest'
import { tap } from 'rxjs'
import { Column, DataSource, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import {
  getODataBatchPart,
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
import {
  ODataTypeOrmModule,
  TypeOrmAutoHandler,
  type ODataTypeOrmRootOptions,
} from '@nestjs-odata/typeorm'

@Entity({ name: 'bc_notes' })
class Note {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100 })
  title: string

  @Column({ type: 'integer', default: 0 })
  price: number

  @Column({ type: 'boolean', default: false })
  hidden: boolean

  @UpdateDateColumn()
  updatedAt: Date
}

@Entity({ name: 'bc_tickets' })
class Ticket {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100 })
  subject: string
}

/** Lets a request through only with `x-role: admin` (inherited from the `$batch` request). */
@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>()
    return req.headers['x-role'] === 'admin'
  }
}

/** A batch-specific policy: ticket deletes are not allowed inside `$batch`. */
@Injectable()
class NoBatchGuard implements CanActivate {
  canActivate(): boolean {
    return getODataBatchPart() === undefined
  }
}

/** Marks the responses of the route it is applied to. */
@Injectable()
class MarkInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const res = context.switchToHttp().getResponse<{ setHeader(n: string, v: string): void }>()
    return next.handle().pipe(tap(() => res.setHeader('X-Intercepted', 'yes')))
  }
}

/** Refuses a note titled "forbidden" (400). */
@Injectable()
class TitlePipe implements PipeTransform {
  transform(value: unknown) {
    if ((value as { title?: string } | undefined)?.title === 'forbidden') {
      throw new BadRequestException('Title not allowed')
    }
    return value
  }
}

@ODataController('Notes')
class NotesController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Notes', { path: '' })
  list(@ODataQueryParam('Notes') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @Get('$count')
  @Header('Content-Type', 'text/plain')
  count(@ODataQueryParam('Notes') query: ODataQuery) {
    return this.handler.handleCount(query)
  }

  @ODataGetByKey('Notes')
  @UseInterceptors(MarkInterceptor)
  get(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Notes')
  }

  @ODataPost('Notes')
  @UsePipes(TitlePipe)
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Notes')
  }

  @ODataPatch('Notes')
  update(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.handler.handleUpdate(key, body, 'Notes')
  }

  @ODataDelete('Notes')
  @UseGuards(AdminGuard)
  remove(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Notes')
  }
}

@ODataController('Tickets')
class TicketsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGetByKey('Tickets')
  get(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Tickets')
  }

  @ODataPost('Tickets')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Tickets')
  }

  @ODataDelete('Tickets')
  @UseGuards(NoBatchGuard)
  remove(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Tickets')
  }
}

@Module({
  imports: [
    ODataTypeOrmModule.forFeature(
      [
        {
          entity: Note,
          name: 'Notes',
          scope: (qb, ctx) => void qb.andWhere(`${ctx.alias}.hidden = 0`),
        },
      ],
      { serviceRoot: '/odata', controllers: [NotesController] },
    ),
  ],
})
class NotesModule {}

@Module({
  imports: [
    ODataTypeOrmModule.forFeature([{ entity: Ticket, name: 'Tickets' }], {
      serviceRoot: '/odata',
      controllers: [TicketsController],
    }),
  ],
})
class TicketsModule {}

async function createApp(root?: ODataTypeOrmRootOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Note, Ticket],
        synchronize: true,
      }),
      ODataModule.forRoot({ serviceRoot: '/odata' }),
      ODataTypeOrmModule.forRoot(root),
      NotesModule,
      TicketsModule,
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

// ── multipart helpers ───────────────────────────────────────────────────────

const BOUNDARY = 'bc_batch'

interface Op {
  method: string
  url: string
  body?: unknown
  contentId?: string
  headers?: Record<string, string>
}

function op(o: Op): string {
  const lines = ['Content-Type: application/http', 'Content-Transfer-Encoding: binary']
  if (o.contentId !== undefined) lines.push(`Content-ID: ${o.contentId}`)
  lines.push('', `${o.method} ${o.url.replace(/ /g, '%20')} HTTP/1.1`)
  for (const [k, v] of Object.entries(o.headers ?? {})) lines.push(`${k}: ${v}`)
  if (o.body !== undefined) lines.push('Content-Type: application/json', '', JSON.stringify(o.body))
  else lines.push('', '')
  return lines.join('\r\n')
}

function changeset(ops: Op[]): string {
  const cs = `cs_${Math.random().toString(36).slice(2)}`
  const inner = ops.flatMap((o) => [`--${cs}`, op(o)])
  return [`Content-Type: multipart/mixed; boundary=${cs}`, '', ...inner, `--${cs}--`].join('\r\n')
}

function batch(parts: string[]): string {
  return [...parts.flatMap((p) => [`--${BOUNDARY}`, p]), `--${BOUNDARY}--`].join('\r\n')
}

/** The JSON body of an operation response (its shape depends on the operation). */
interface ODataJson {
  readonly [key: string]: unknown
  readonly error: { readonly code: string; readonly message: string }
  readonly value: readonly Record<string, unknown>[]
}

interface PartResponse {
  contentId?: string
  status: number
  headers: Record<string, string>
  body: string
  json: ODataJson
}

const server = (app: INestApplication) => app.getHttpServer() as Parameters<typeof supertest>[0]

type TopLevel = PartResponse | { changeset: PartResponse[] }

function splitParts(body: string, boundary: string): string[] {
  const segments = body.split(`--${boundary}`)
  return segments.slice(1, -1).map((s) => s.replace(/^\r\n/, ''))
}

function parseOperation(raw: string): PartResponse {
  const [mime, ...rest] = raw.split('\r\n\r\n')
  const http = rest.join('\r\n\r\n')
  const contentId = /Content-ID: (\S+)/i.exec(mime)?.[1]
  const [head, ...bodyParts] = http.split('\r\n\r\n')
  const [statusLine, ...headerLines] = head.split('\r\n')
  const headers: Record<string, string> = {}
  for (const line of headerLines) {
    const i = line.indexOf(':')
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim()
  }
  const body = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '')
  let json = {} as ODataJson
  try {
    if (body) json = JSON.parse(body) as ODataJson
  } catch {
    // not JSON (e.g. text/plain $count)
  }
  return { contentId, status: Number(statusLine.split(' ')[1]), headers, body, json }
}

function parseBatchResponse(contentType: string, body: string): TopLevel[] {
  const boundary = /boundary=([^;\s]+)/.exec(contentType)![1]
  return splitParts(body, boundary).map((raw) => {
    const nested = /^Content-Type: multipart\/mixed; boundary=([^;\s]+)/.exec(raw)
    if (nested) return { changeset: splitParts(raw, nested[1]).map(parseOperation) }
    return parseOperation(raw)
  })
}

async function postBatch(
  app: INestApplication,
  parts: string[],
  headers: Record<string, string> = {},
): Promise<TopLevel[]> {
  const res = await supertest(server(app))
    .post('/odata/$batch')
    .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
    .set(headers)
    .send(batch(parts))
    .buffer(true)
    .parse((r, fn) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => fn(null, Buffer.concat(chunks).toString('utf-8')))
    })
  expect(res.status).toBe(200)
  return parseBatchResponse(String(res.headers['content-type']), res.body as string)
}

const single = (p: TopLevel): PartResponse => {
  expect('changeset' in p).toBe(false)
  return p as PartResponse
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('$batch conformance (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>
  let notes: Note[]
  let ticket: Ticket

  beforeAll(async () => {
    app = await createApp()
    http = supertest(server(app))
    const ds = app.get(DataSource)
    notes = await ds.getRepository(Note).save([
      { title: 'cheap', price: 5 },
      { title: 'mid', price: 20 },
      { title: 'pricey', price: 50 },
      { title: 'secret', price: 99, hidden: true },
    ])
    ticket = await ds.getRepository(Ticket).save({ subject: 'first' })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('#73 one $batch endpoint for every forFeature() module', () => {
    it('serves entity sets of two feature modules in the same batch', async () => {
      const [a, b] = await postBatch(app, [
        op({ method: 'GET', url: `/odata/Tickets(${ticket.id})` }),
        op({ method: 'GET', url: `/odata/Notes(${notes[0].id})` }),
      ])
      expect(single(a).status).toBe(200)
      expect(single(a).json.subject).toBe('first')
      expect(single(b).status).toBe(200)
      expect(single(b).json.title).toBe('cheap')
    })

    it('commits a changeset spanning both modules atomically', async () => {
      const ds = app.get(DataSource)
      const ticketsBefore = await ds.getRepository(Ticket).count()
      const [cs] = await postBatch(app, [
        changeset([
          { method: 'POST', url: '/odata/Tickets', body: { subject: 'cs' }, contentId: '1' },
          { method: 'POST', url: '/odata/Notes', body: { title: 'forbidden' }, contentId: '2' },
        ]),
      ])
      expect(single(cs).status).toBe(400)
      expect(await ds.getRepository(Ticket).count()).toBe(ticketsBefore)

      const [ok] = await postBatch(app, [
        changeset([
          { method: 'POST', url: '/odata/Tickets', body: { subject: 'cs' }, contentId: '1' },
          { method: 'POST', url: 'Notes', body: { title: 'from cs', price: 1 }, contentId: '2' },
        ]),
      ])
      expect('changeset' in ok).toBe(true)
      const parts = (ok as { changeset: PartResponse[] }).changeset
      expect(parts.map((p) => [p.contentId, p.status])).toEqual([
        ['1', 201],
        ['2', 201],
      ])
      expect(await ds.getRepository(Ticket).count()).toBe(ticketsBefore + 1)
    })
  })

  describe('#64 changeset responses', () => {
    it('answers a failed changeset with one application/http part carrying the failing Content-ID', async () => {
      const ds = app.get(DataSource)
      const before = await ds.getRepository(Note).count()
      const res = await postBatch(app, [
        changeset([
          { method: 'POST', url: '/odata/Notes', body: { title: 'rolled back' }, contentId: '1' },
          { method: 'PATCH', url: '/odata/Notes(999999)', body: { title: 'x' }, contentId: '2' },
          { method: 'POST', url: '/odata/Notes', body: { title: 'never run' }, contentId: '3' },
        ]),
        op({ method: 'GET', url: `/odata/Notes(${notes[0].id})` }),
      ])
      expect(res).toHaveLength(2)
      const failed = single(res[0])
      expect(failed.status).toBe(404)
      expect(failed.contentId).toBe('2')
      expect(failed.json.error.code).toBeDefined()
      expect(failed.headers['content-language']).toBe('en')
      expect(single(res[1]).status).toBe(200)
      expect(await ds.getRepository(Note).count()).toBe(before)
    })

    it('nests a successful changeset and resolves $<Content-ID> references through the routes', async () => {
      const [cs] = await postBatch(app, [
        changeset([
          { method: 'POST', url: '/odata/Notes', body: { title: 'ref', price: 3 }, contentId: '1' },
          { method: 'PATCH', url: '$1', body: { price: 4 }, contentId: '2' },
        ]),
      ])
      const parts = (cs as { changeset: PartResponse[] }).changeset
      expect(parts.map((p) => p.contentId)).toEqual(['1', '2'])
      expect(parts[0].status).toBe(201)
      expect(parts[0].headers['location']).toMatch(/\/odata\/Notes\(\d+\)$/)
      expect(parts[1].status).toBe(200)
      expect(parts[1].json.price).toBe(4)
    })
  })

  describe('#65 GET operations get the standalone semantics', () => {
    it('honours $filter, $orderby, $top, $count and $select with the same envelope', async () => {
      const url =
        '/odata/Notes?$filter=price gt 10&$orderby=price desc&$top=1&$count=true&$select=title,price'
      const standalone = await http.get(url.replace(/ /g, '%20')).expect(200)
      const [part] = await postBatch(app, [op({ method: 'GET', url })])
      const got = single(part)
      expect(got.status).toBe(200)
      expect(got.json).toEqual(standalone.body)
      expect(got.json['@odata.context']).toContain('$metadata#Notes(title,price)')
      // The hidden note is outside the row-level scope: not counted.
      expect(got.json['@odata.count']).toBeGreaterThanOrEqual(2)
      expect(got.json.value).toHaveLength(1)
      const keys = Object.keys(got.json.value[0]).filter((k) => !k.startsWith('@'))
      // The key is always selected, like the standalone request.
      expect(keys.sort()).toEqual(['id', 'price', 'title'])
      expect(got.json['@odata.nextLink']).toContain('$skip=1')
    })

    it('a relative URL resolves against the service root', async () => {
      const [part] = await postBatch(app, [op({ method: 'GET', url: 'Notes?$top=1' })])
      expect(single(part).json.value).toHaveLength(1)
    })

    it('GET by key gets @odata.context, @odata.etag and the ETag header', async () => {
      const [part] = await postBatch(app, [op({ method: 'GET', url: `Notes(${notes[1].id})` })])
      const got = single(part)
      expect(got.json['@odata.context']).toContain('$metadata#Notes/$entity')
      expect(got.json['@odata.etag']).toBeDefined()
      expect(got.headers['etag']).toBe(got.json['@odata.etag'])
    })

    it('applies the row-level scope and the query validation', async () => {
      const [hidden, invalid, count] = await postBatch(app, [
        op({ method: 'GET', url: `/odata/Notes(${notes[3].id})` }),
        op({ method: 'GET', url: '/odata/Notes?$filter=nope eq 1' }),
        op({ method: 'GET', url: '/odata/Notes/$count?$filter=price gt 10' }),
      ])
      expect(single(hidden).status).toBe(404)
      expect(single(invalid).status).toBe(400)
      expect(single(invalid).json.error.code).toBe('BadRequest')
      expect(single(count).status).toBe(200)
      expect(single(count).headers['content-type']).toMatch(/^text\/plain/)
      expect(Number(single(count).body)).toBeGreaterThanOrEqual(2)
    })
  })

  describe('#67 operations run through the route (guards, interceptors, pipes)', () => {
    it('a guard that denies the standalone request denies the batch operation (403)', async () => {
      await http.delete(`/odata/Notes/${notes[2].id}`).expect(403)
      const [part] = await postBatch(app, [
        op({ method: 'DELETE', url: `/odata/Notes(${notes[2].id})` }),
      ])
      expect(single(part).status).toBe(403)
      expect(single(part).json.error).toBeDefined()
      await http.get(`/odata/Notes/${notes[2].id}`).expect(200)
    })

    it('the operation inherits the credentials of the $batch request', async () => {
      const ds = app.get(DataSource)
      const victim = await ds.getRepository(Note).save({ title: 'to delete' })
      const [part] = await postBatch(
        app,
        [op({ method: 'DELETE', url: `/odata/Notes(${victim.id})` })],
        { 'x-role': 'admin' },
      )
      expect(single(part).status).toBe(204)
    })

    it('a denied operation fails its whole changeset (rolled back)', async () => {
      const ds = app.get(DataSource)
      const before = await ds.getRepository(Note).count()
      const [cs] = await postBatch(app, [
        changeset([
          { method: 'POST', url: '/odata/Notes', body: { title: 'kept?' }, contentId: '1' },
          { method: 'DELETE', url: `/odata/Notes(${notes[0].id})`, contentId: '2' },
        ]),
      ])
      expect(single(cs).status).toBe(403)
      expect(single(cs).contentId).toBe('2')
      expect(await ds.getRepository(Note).count()).toBe(before)
    })

    it('runs the route interceptors and pipes', async () => {
      const [get, post] = await postBatch(app, [
        op({ method: 'GET', url: `/odata/Notes(${notes[0].id})` }),
        op({ method: 'POST', url: '/odata/Notes', body: { title: 'forbidden' } }),
      ])
      expect(single(get).headers['x-intercepted']).toBe('yes')
      expect(single(post).status).toBe(400)
      expect(single(post).json.error.message).toBe('Title not allowed')
    })

    it('guards can apply a batch-specific policy with getODataBatchPart()', async () => {
      const ds = app.get(DataSource)
      const t = await ds.getRepository(Ticket).save({ subject: 'batch-proof' })
      const [part] = await postBatch(app, [
        op({ method: 'DELETE', url: `/odata/Tickets(${t.id})` }),
      ])
      expect(single(part).status).toBe(403)
      await http.delete(`/odata/Tickets/${t.id}`).expect(204)
    })

    it('refuses a nested $batch operation and unknown routes with OData errors', async () => {
      const [nested, unknown] = await postBatch(app, [
        op({ method: 'POST', url: '/odata/$batch', body: {} }),
        op({ method: 'GET', url: '/odata/Nothing(1)' }),
      ])
      expect(single(nested).status).toBe(400)
      expect(single(unknown).status).toBe(404)
      expect(single(unknown).json.error.code).toBeDefined()
    })
  })
})

describe('$batch options of ODataTypeOrmModule.forRoot()', () => {
  it('batch.enabled: false turns the $batch endpoint off (404)', async () => {
    const app = await createApp({ batch: { enabled: false } })
    try {
      const res = await supertest(server(app))
        .post('/odata/$batch')
        .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
        .send(batch([op({ method: 'GET', url: '/odata/Tickets(1)' })]))
      expect(res.status).toBe(404)
      expect((res.body as ODataJson).error).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('batch.entitySets allow-lists the entity sets operations may target (403 otherwise)', async () => {
    const app = await createApp({ batch: { entitySets: ['Tickets'] } })
    try {
      const ds = app.get(DataSource)
      const t = await ds.getRepository(Ticket).save({ subject: 'allowed' })
      const n = await ds.getRepository(Note).save({ title: 'not allowed' })
      const [ticketPart, notePart] = await postBatch(app, [
        op({ method: 'GET', url: `/odata/Tickets(${t.id})` }),
        op({ method: 'GET', url: `/odata/Notes(${n.id})` }),
      ])
      expect(single(ticketPart).status).toBe(200)
      expect(single(notePart).status).toBe(403)
    } finally {
      await app.close()
    }
  })
})
