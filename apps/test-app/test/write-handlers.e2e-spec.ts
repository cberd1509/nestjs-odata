/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// Supertest bodies are `any`; the unsafe-* rules are disabled for this file.

/**
 * Custom write handlers (`writeHandlers` and `etag` in ODataTypeOrmModule.forFeature(),
 * `changesetRunner` in ODataTypeOrmModule.forRoot()).
 *
 * - Accounts: an injectable handlers class that writes through an application service with
 *   optimistic concurrency on a `version` column (the ETag source), plus a row-level scope.
 * - Invoices: a handlers object with `create` and `deepInsert` only (no update/delete).
 * - Changesets run through a custom `changesetRunner` that wraps `DataSource.transaction()`.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  Body,
  ConflictException,
  Headers,
  HttpException,
  Inject,
  Injectable,
  INestApplication,
  Module,
  Param,
} from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Test } from '@nestjs/testing'
import {
  Column,
  DataSource,
  Entity,
  EntityManager,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import supertest from 'supertest'
import {
  ODataController,
  ODataDelete,
  ODataGetByKey,
  ODataModule,
  ODataPatch,
  ODataPost,
  ODataPut,
} from '@nestjs-odata/core'
import {
  etagMatches,
  formatWeakETag,
  ODataTypeOrmModule,
  TypeOrmAutoHandler,
  type ODataChangesetRunner,
  type ODataEntityKey,
  type ODataWriteContext,
  type ODataWriteHandlers,
} from '@nestjs-odata/typeorm'

@Entity({ name: 'wh_accounts' })
class Account {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  name: string

  @Column({ type: 'integer', default: 1 })
  version: number

  @Column({ type: 'integer', nullable: true })
  ledgerId: number | null

  @ManyToOne(() => Ledger, (ledger) => ledger.accounts, { nullable: true })
  ledger: Ledger | null
}

/** No write handlers: its deep inserts use the repository, and its children must too. */
@Entity({ name: 'wh_ledgers' })
class Ledger {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  name: string

  @OneToMany(() => Account, (account) => account.ledger, { cascade: true })
  accounts: Account[]
}

@Entity({ name: 'wh_invoices' })
class Invoice {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  number: string

  @OneToMany(() => InvoiceLine, (line) => line.invoice)
  lines: InvoiceLine[]

  // ETag from the ETag provider (@UpdateDateColumn), not from an `etag` option.
  @UpdateDateColumn()
  updatedAt: Date
}

@Entity({ name: 'wh_invoice_lines' })
class InvoiceLine {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  label: string

  @Column({ type: 'integer' })
  invoiceId: number

  @ManyToOne(() => Invoice, (invoice) => invoice.lines)
  invoice: Invoice
}

interface Call {
  op: string
  key?: ODataEntityKey
  body?: Record<string, unknown>
  ctx: ODataWriteContext
}
const calls: Call[] = []

/** The application service the handlers delegate to (stands in for an app's use cases). */
@Injectable()
class AccountService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  manager(ctx: ODataWriteContext): EntityManager {
    return ctx.manager ?? this.dataSource.manager
  }

  async create(name: string, ctx: ODataWriteContext): Promise<Account> {
    if (name === 'conflict') throw new ConflictException('Name already taken')
    if (name === 'wrapped') {
      throw new Error('Unit of work failed', { cause: new ConflictException('Name already taken') })
    }
    return this.manager(ctx).getRepository(Account).save({ name, version: 1 })
  }

  async rename(id: number, name: string, ifMatch: string | undefined, ctx: ODataWriteContext) {
    const repo = this.manager(ctx).getRepository(Account)
    const current = await repo.findOneByOrFail({ id })
    if (ifMatch && !etagMatches(ifMatch, formatWeakETag(current.version))) {
      throw new HttpException('Stale version', 412)
    }
    return repo.save({ ...current, name, version: current.version + 1 })
  }

  async remove(id: number, ctx: ODataWriteContext) {
    await this.manager(ctx).getRepository(Account).delete({ id })
  }
}

@Module({ providers: [AccountService], exports: [AccountService] })
class AccountServiceModule {}

@Injectable()
class AccountWriteHandlers implements ODataWriteHandlers<Account> {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  create(body: Record<string, unknown>, ctx: ODataWriteContext) {
    calls.push({ op: 'create', body, ctx })
    return this.accounts.create(String(body.name), ctx)
  }

  update(key: ODataEntityKey, body: Record<string, unknown>, ctx: ODataWriteContext) {
    calls.push({ op: 'update', key, body, ctx })
    // A buggy handler that forgets to return the entity.
    if (body.name === 'void') return undefined as unknown as Account
    return this.accounts.rename(Number(key.id), String(body.name), ctx.ifMatch, ctx)
  }

  replace(key: ODataEntityKey, body: Record<string, unknown>, ctx: ODataWriteContext) {
    calls.push({ op: 'replace', key, body, ctx })
    return this.accounts.rename(Number(key.id), String(body.name), ctx.ifMatch, ctx)
  }

  async delete(key: ODataEntityKey, ctx: ODataWriteContext) {
    calls.push({ op: 'delete', key, ctx })
    await this.accounts.remove(Number(key.id), ctx)
  }
}

const invoiceHandlers: ODataWriteHandlers<Invoice> = {
  async create(body, ctx) {
    calls.push({ op: 'create', body, ctx })
    // A buggy handler that forgets to return the entity.
    if (body.number === 'void') return undefined as unknown as Invoice
    return (ctx.manager ?? appDataSource.manager)
      .getRepository(Invoice)
      .save({ number: String(body.number) })
  },
  async deepInsert(body, ctx) {
    calls.push({ op: 'deepInsert', body, ctx })
    const manager = ctx.manager!
    const invoice = await manager.getRepository(Invoice).save({ number: String(body.number) })
    const lines = (body.lines as { label: string }[]).map((l) => ({
      label: l.label,
      invoiceId: invoice.id,
    }))
    await manager.getRepository(InvoiceLine).save(lines)
    return invoice
  },
}

let runnerCalls = 0
/** Set once the app starts, for handlers that run outside a transaction. */
let appDataSource: DataSource

@ODataController('Accounts')
class AccountsController {
  constructor(@Inject(TypeOrmAutoHandler) private readonly handler: TypeOrmAutoHandler) {}

  @ODataGetByKey('Accounts')
  byKey(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Accounts', ifNoneMatch)
  }

  @ODataPost('Accounts')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Accounts')
  }

  @ODataPatch('Accounts')
  update(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Accounts', ifMatch)
  }

  @ODataPut('Accounts')
  replace(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleReplace(key, body, 'Accounts', ifMatch)
  }

  @ODataDelete('Accounts')
  remove(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Accounts', ifMatch)
  }
}

@ODataController('Ledgers')
class LedgersController {
  constructor(
    @Inject(TypeOrmAutoHandler) private readonly handler: TypeOrmAutoHandler,
    @Inject(DataSource) private readonly dataSource: DataSource,
  ) {}

  @ODataPost('Ledgers')
  create(@Body() body: Record<string, unknown>) {
    return this.dataSource.transaction((manager) =>
      this.handler.handleDeepCreate(body, 'Ledgers', manager),
    )
  }
}

@ODataController('Invoices')
class InvoicesController {
  constructor(
    @Inject(TypeOrmAutoHandler) private readonly handler: TypeOrmAutoHandler,
    @Inject(DataSource) private readonly dataSource: DataSource,
  ) {}

  @ODataPost('Invoices')
  create(@Body() body: Record<string, unknown>) {
    return this.dataSource.transaction((manager) =>
      this.handler.handleDeepCreate(body, 'Invoices', manager),
    )
  }

  @ODataDelete('Invoices')
  remove(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Invoices')
  }
}

const BOUNDARY = 'wh_batch'
function batchBody(parts: string[]): string {
  return [...parts.map((p) => `--${BOUNDARY}\r\n${p}`), `--${BOUNDARY}--`].join('\r\n')
}
function batchRequest(method: string, url: string, body?: string, contentId?: string): string {
  const line =
    body === undefined
      ? `${method} ${url} HTTP/1.1`
      : `${method} ${url} HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${body}`
  return [
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    ...(contentId ? [`Content-ID: ${contentId}`] : []),
    '',
    line,
  ].join('\r\n')
}
function batchChangeset(parts: string[]): string {
  const cs = 'wh_changeset'
  const inner = [...parts.map((p) => `--${cs}\r\n${p}`), `--${cs}--`].join('\r\n')
  return [`Content-Type: multipart/mixed; boundary=${cs}`, '', inner].join('\r\n')
}

describe('Custom write handlers (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>
  let dataSource: DataSource

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
    return res.body as string
  }

  beforeAll(async () => {
    // Like an application's unit of work, the runner wraps whatever error it sees.
    const changesetRunner: ODataChangesetRunner = async (work) => {
      runnerCalls++
      try {
        return await dataSource.transaction((manager) => work(manager))
      } catch (err) {
        throw new Error('Unit of work failed', { cause: err })
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Account, Ledger, Invoice, InvoiceLine],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata' }),
        ODataTypeOrmModule.forRoot({ changesetRunner }),
        ODataTypeOrmModule.forFeature(
          [
            {
              entity: Account,
              name: 'Accounts',
              writeHandlers: AccountWriteHandlers,
              etag: 'version',
              scope: (qb, ctx) => {
                qb.andWhere(`${ctx.alias}.name != :hidden`, { hidden: 'hidden' })
              },
            },
            { entity: Invoice, name: 'Invoices', writeHandlers: invoiceHandlers },
            { entity: InvoiceLine, name: 'InvoiceLines' },
            { entity: Ledger, name: 'Ledgers' },
          ],
          {
            controllers: [AccountsController, InvoicesController, LedgersController],
            imports: [AccountServiceModule],
          },
        ),
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
    http = supertest(app.getHttpServer())
    dataSource = app.get(DataSource)
    appDataSource = dataSource
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    calls.length = 0
  })

  it('routes POST to the create handler and serializes what it returns', async () => {
    const res = await http.post('/odata/Accounts').send({ name: 'Acme' }).expect(201)
    expect(res.body).toMatchObject({ name: 'Acme', version: 1, '@odata.etag': formatWeakETag(1) })
    expect(res.headers.location).toBe(`/odata/Accounts(${res.body.id})`)
    expect(res.headers.etag).toBe(formatWeakETag(1))

    expect(calls).toHaveLength(1)
    const [{ op, body, ctx }] = calls
    expect(op).toBe('create')
    expect(body).toEqual({ name: 'Acme' })
    expect(ctx).toMatchObject({ entitySetName: 'Accounts', operation: 'create' })
    expect(ctx.entityType.name).toBe('Account')
    expect(ctx.executionContext?.getType()).toBe('http')
    expect((ctx.request as { method: string }).method).toBe('POST')
    expect(ctx.manager).toBeUndefined()
    expect(ctx.batch).toBeUndefined()
  })

  it('maps exceptions thrown by a handler to their HTTP status', async () => {
    await http.post('/odata/Accounts').send({ name: 'conflict' }).expect(409)
  })

  it('serves the ETag from the configured property and honours If-None-Match', async () => {
    const { body } = await http.post('/odata/Accounts').send({ name: 'Etag' }).expect(201)
    const res = await http.get(`/odata/Accounts/${body.id}`).expect(200)
    expect(res.headers.etag).toBe(formatWeakETag(1))
    await http.get(`/odata/Accounts/${body.id}`).set('If-None-Match', formatWeakETag(1)).expect(304)
  })

  it('passes key, body and If-Match to PATCH and PUT handlers', async () => {
    const { body: created } = await http.post('/odata/Accounts').send({ name: 'Old' })
    calls.length = 0

    const patched = await http
      .patch(`/odata/Accounts/${created.id}`)
      .set('If-Match', formatWeakETag(1))
      .send({ name: 'New' })
      .expect(200)
    expect(patched.body).toMatchObject({ name: 'New', version: 2 })
    expect(patched.headers.etag).toBe(formatWeakETag(2))
    expect(calls[0]).toMatchObject({
      op: 'update',
      key: { id: created.id },
      body: { name: 'New' },
      ctx: { operation: 'update', rawKey: String(created.id), ifMatch: formatWeakETag(1) },
    })

    // The handler enforces If-Match: version 1 is stale now.
    await http
      .put(`/odata/Accounts/${created.id}`)
      .set('If-Match', formatWeakETag(1))
      .send({ name: 'Stale' })
      .expect(412)
    const replaced = await http
      .put(`/odata/Accounts/${created.id}`)
      .set('If-Match', formatWeakETag(2))
      .send({ name: 'Replaced' })
      .expect(200)
    expect(replaced.body).toMatchObject({ name: 'Replaced', version: 3 })
    expect(calls.map((c) => c.op)).toEqual(['update', 'replace', 'replace'])
  })

  it('routes DELETE to the delete handler', async () => {
    const { body } = await http.post('/odata/Accounts').send({ name: 'Gone' })
    await http.delete(`/odata/Accounts/${body.id}`).expect(204)
    expect(calls.at(-1)).toMatchObject({ op: 'delete', key: { id: body.id } })
    expect(await dataSource.getRepository(Account).findOneBy({ id: body.id })).toBeNull()
  })

  it('answers 404 without calling the handler for rows outside the row-level scope', async () => {
    const hidden = await dataSource.getRepository(Account).save({ name: 'hidden' })
    calls.length = 0
    await http.patch(`/odata/Accounts/${hidden.id}`).send({ name: 'x' }).expect(404)
    await http.delete(`/odata/Accounts/${hidden.id}`).expect(404)
    expect(calls).toEqual([])
  })

  it('answers 405 for an operation the handlers do not implement', async () => {
    await http.delete('/odata/Invoices/1').expect(405)
  })

  it('routes a POST with navigation properties to the deepInsert handler', async () => {
    const res = await http
      .post('/odata/Invoices')
      .send({ number: 'INV-1', lines: [{ label: 'a' }, { label: 'b' }] })
      .expect(201)
    expect(calls.map((c) => c.op)).toEqual(['deepInsert'])
    expect(calls[0].ctx.manager).toBeDefined()
    const lines = await dataSource.getRepository(InvoiceLine).findBy({ invoiceId: res.body.id })
    expect(lines.map((l) => l.label).sort()).toEqual(['a', 'b'])

    calls.length = 0
    await http.post('/odata/Invoices').send({ number: 'INV-2' }).expect(201)
    expect(calls.map((c) => c.op)).toEqual(['create'])
  })

  it('runs $batch changesets through the handlers inside the changeset runner', async () => {
    const before = runnerCalls
    const text = await postBatch(
      batchBody([
        batchChangeset([
          batchRequest('POST', '/odata/Accounts', '{"name":"Batch"}', '1'),
          batchRequest('PATCH', '$1', '{"name":"Batch renamed"}', '2'),
        ]),
      ]),
    )
    expect([...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1])).toEqual(['201', '200'])
    expect(text).toMatch(/etag: W\/"/i)
    expect(runnerCalls).toBe(before + 1)
    expect(calls.map((c) => [c.op, c.ctx.batch?.inChangeset, c.ctx.manager !== undefined])).toEqual(
      [
        ['create', true, true],
        ['update', true, true],
      ],
    )
    expect(
      await dataSource.getRepository(Account).findOneBy({ name: 'Batch renamed' }),
    ).not.toBeNull()
  })

  it('rolls back the whole changeset when a handler fails', async () => {
    const text = await postBatch(
      batchBody([
        batchChangeset([
          batchRequest('POST', '/odata/Accounts', '{"name":"Rolled back"}', '1'),
          batchRequest('POST', '/odata/Accounts', '{"name":"conflict"}', '2'),
        ]),
        batchRequest('DELETE', '/odata/Invoices(1)'),
      ]),
    )
    expect([...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1])).toEqual([
      '409',
      '409',
      '405',
    ])
    expect(await dataSource.getRepository(Account).findOneBy({ name: 'Rolled back' })).toBeNull()
  })

  it('refuses a deep insert whose children write through handlers (no repository bypass)', async () => {
    await http
      .post('/odata/Ledgers')
      .send({ name: 'L1', accounts: [{ name: 'Child' }] })
      .expect(400)
    expect(calls).toEqual([])
    expect(await dataSource.getRepository(Ledger).findOneBy({ name: 'L1' })).toBeNull()
    expect(await dataSource.getRepository(Account).findOneBy({ name: 'Child' })).toBeNull()
    // Without children the repository path still works.
    await http.post('/odata/Ledgers').send({ name: 'L2' }).expect(201)
  })

  it('answers 500 when a create handler returns nothing, over HTTP and in $batch', async () => {
    await http.post('/odata/Invoices').send({ number: 'void' }).expect(500)
    const text = await postBatch(
      batchBody([
        batchRequest('POST', '/odata/Invoices', '{"number":"void"}'),
        batchChangeset([
          batchRequest('POST', '/odata/Accounts', '{"name":"Before void"}', '1'),
          batchRequest('POST', '/odata/Invoices', '{"number":"void"}', '2'),
        ]),
      ]),
    )
    expect([...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1])).toEqual([
      '500',
      '500',
      '500',
    ])
    expect(text).not.toMatch(/TypeError|Cannot read/)
    expect(await dataSource.getRepository(Account).findOneBy({ name: 'Before void' })).toBeNull()

    // Same for update handlers (which used to answer 200 with a `null` body).
    const { body } = await http.post('/odata/Accounts').send({ name: 'To void' }).expect(201)
    await http.patch(`/odata/Accounts/${body.id}`).send({ name: 'void' }).expect(500)
    const patched = await postBatch(
      batchBody([batchRequest('PATCH', `/odata/Accounts(${body.id})`, '{"name":"void"}')]),
    )
    expect([...patched.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1])).toEqual(['500'])
  })

  it('sends provider ETags in $batch, with @odata.etag, also on GET by key', async () => {
    const text = await postBatch(
      batchBody([batchRequest('POST', '/odata/Invoices', '{"number":"INV-E"}')]),
    )
    const etag = /ETag: (W\/"[^"]+")/.exec(text)?.[1]
    expect(etag).toBeDefined()
    expect(text).toContain(`"@odata.etag":"${etag!.replace(/"/g, '\\"')}"`)

    const { body } = await http.post('/odata/Accounts').send({ name: 'Batch get' }).expect(201)
    const got = await postBatch(batchBody([batchRequest('GET', `/odata/Accounts(${body.id})`)]))
    expect(got).toContain(`ETag: ${formatWeakETag(1)}`)
    expect(got).toContain('"@odata.etag"')
  })

  it('keeps the status of errors wrapped by application code', async () => {
    await http.post('/odata/Accounts').send({ name: 'wrapped' }).expect(500)
    const text = await postBatch(
      batchBody([batchRequest('POST', '/odata/Accounts', '{"name":"wrapped"}')]),
    )
    expect([...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1])).toEqual(['409'])
  })

  it('does not treat null or scalar navigation values as a deep insert', async () => {
    await http.post('/odata/Invoices').send({ number: 'INV-N', lines: null }).expect(201)
    expect(calls.map((c) => c.op)).toEqual(['create'])
  })
})
