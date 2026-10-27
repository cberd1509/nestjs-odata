/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// Supertest bodies are `any`; the unsafe-* rules are disabled for this file.

/**
 * The `errorMapper` option of ODataModule.forRoot(): maps any exception thrown by an OData
 * route, or by an operation of a `$batch` request, to an OData error.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  Body,
  Catch,
  Get,
  Header,
  INestApplication,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Test } from '@nestjs/testing'
import { Column, Entity, PrimaryGeneratedColumn, QueryFailedError } from 'typeorm'
import supertest from 'supertest'
import {
  ODataController,
  ODataExceptionFilter,
  ODataGet,
  ODataGetByKey,
  ODataModule,
  ODataPost,
  ODataQueryParam,
  type ODataErrorMapper,
  type ODataErrorMapperContext,
  type ODataQuery,
} from '@nestjs-odata/core'
import { ODataTypeOrmModule, TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

@Entity({ name: 'em_widgets' })
class Widget {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50, unique: true })
  sku: string
}

/** An application error type, unknown to the library. */
class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly field?: string,
  ) {
    super(code)
  }
}

const contexts: ODataErrorMapperContext[] = []

const errorMapper: ODataErrorMapper = (err, ctx) => {
  contexts.push(ctx)
  if (err instanceof AppError) {
    return {
      status: err.status,
      code: err.code,
      message: `Request failed: ${err.code}`,
      target: err.field,
      details: err.field ? [{ code: 'Invalid', message: 'invalid value', target: err.field }] : [],
    }
  }
  // The library's own $batch errors (here a 404 for a missing key) reach the mapper too.
  if (err instanceof NotFoundException && ctx.batch?.method === 'GET') {
    return { status: 404, code: 'BATCH_NOT_FOUND', message: `Nothing at ${ctx.batch.url}` }
  }
  if (err instanceof QueryFailedError && /UNIQUE/i.test(err.message)) {
    return { status: 409, code: 'DUPLICATE', message: 'A widget with this SKU already exists' }
  }
  return undefined
}

@ODataController('Widgets')
class WidgetsController {
  constructor(@Inject(TypeOrmAutoHandler) private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Widgets', { path: '' })
  list(@ODataQueryParam('Widgets') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  // A plain Nest route on an OData controller opts in to OData errors explicitly.
  @Get('$count')
  @Header('Content-Type', 'text/plain')
  @UseFilters(ODataExceptionFilter)
  count(): number {
    throw new AppError('COUNT_DISABLED', 403)
  }

  // A plain Nest route without it keeps the application's global filters.
  @Get('plain')
  plain(): never {
    throw new AppError('PLAIN', 400)
  }

  @ODataGetByKey('Widgets')
  byKey(@Param('key') key: string) {
    if (key === '0') throw new AppError('ZERO_KEY', 422, 'id')
    if (key === '13') throw new Error('database password is hunter2')
    return this.handler.handleGetByKey(key, 'Widgets')
  }

  @ODataPost('Widgets')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Widgets')
  }
}

/** The application's own global filter, which plain routes must keep reaching. */
@Catch(AppError)
class AppGlobalFilter implements ExceptionFilter {
  catch(err: AppError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<{ status(c: number): { json(b: unknown): void } }>()
      .status(418)
      .json({ handledBy: 'app', code: err.code })
  }
}

const BOUNDARY = 'em_batch'

describe('errorMapper (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Widget],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata', errorMapper }),
        ODataTypeOrmModule.forFeature([{ entity: Widget, name: 'Widgets' }], {
          controllers: [WidgetsController],
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useGlobalFilters(new AppGlobalFilter())
    await app.init()
    http = supertest(app.getHttpServer())
    await http.post('/odata/Widgets').send({ sku: 'A-1' }).expect(201)
  })

  afterAll(async () => {
    await app.close()
  })

  it('maps an application error on an OData route, with target and details', async () => {
    contexts.length = 0
    const res = await http.get('/odata/Widgets/0').expect(422)
    expect(res.body).toEqual({
      error: {
        code: 'ZERO_KEY',
        message: 'Request failed: ZERO_KEY',
        target: 'id',
        details: [{ code: 'Invalid', message: 'invalid value', target: 'id' }],
      },
    })
    expect((contexts[0].request as { url: string }).url).toBe('/odata/Widgets/0')
    expect(contexts[0].host).toBeDefined()
  })

  it('maps errors of plain routes that opt in with @UseFilters(ODataExceptionFilter)', async () => {
    const res = await http.get('/odata/Widgets/$count').expect(403)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body.error.code).toBe('COUNT_DISABLED')
  })

  it('leaves other plain routes of an @ODataController to the app global filters', async () => {
    const res = await http.get('/odata/Widgets/plain').expect(418)
    expect(res.body).toEqual({ handledBy: 'app', code: 'PLAIN' })
  })

  it('maps errors thrown by the library and the database', async () => {
    const res = await http.post('/odata/Widgets').send({ sku: 'A-1' }).expect(409)
    expect(res.body.error).toEqual({
      code: 'DUPLICATE',
      message: 'A widget with this SKU already exists',
      details: [],
    })
  })

  it('keeps the default mapping for errors the mapper does not handle', async () => {
    const res = await http.get('/odata/Widgets/13').expect(500)
    expect(res.body.error).toEqual({
      code: 'InternalServerError',
      message: 'An unexpected error occurred.',
      details: [],
    })
    const parse = await http.get('/odata/Widgets?$filter=sku eq').expect(400)
    expect(parse.body.error.code).toBe('BadRequest')
  })

  it('maps errors of $batch operations, with the batch part in the context', async () => {
    contexts.length = 0
    const body = [
      `--${BOUNDARY}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 7',
      '',
      'POST /odata/Widgets HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"sku":"A-1"}',
      `--${BOUNDARY}--`,
    ].join('\r\n')
    const res = await http
      .post('/odata/$batch')
      .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
      .send(body)
      .buffer(true)
      .parse((r, fn) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => fn(null, Buffer.concat(chunks).toString('utf-8')))
      })
    const text = res.body as string
    expect(text).toContain('HTTP/1.1 409')
    expect(text).toContain('"code":"DUPLICATE"')
    expect(contexts.at(-1)?.batch).toEqual({
      method: 'POST',
      url: '/odata/Widgets',
      contentId: '7',
    })
    expect(contexts.at(-1)?.request).toBeDefined()
  })

  it("maps the library's own $batch part errors, with the request from the request context", async () => {
    contexts.length = 0
    const body = [
      `--${BOUNDARY}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 9',
      '',
      'GET /odata/Widgets(999) HTTP/1.1',
      '',
      '',
      `--${BOUNDARY}--`,
    ].join('\r\n')
    const res = await http
      .post('/odata/$batch')
      .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
      .send(body)
      .buffer(true)
      .parse((r, fn) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => fn(null, Buffer.concat(chunks).toString('utf-8')))
      })
    const text = res.body as string
    expect(text).toContain('HTTP/1.1 404')
    expect(text).toContain('"code":"BATCH_NOT_FOUND"')
    expect(contexts.at(-1)?.batch).toEqual({
      method: 'GET',
      url: '/odata/Widgets(999)',
      contentId: '9',
    })
    expect((contexts.at(-1)?.request as { url: string }).url).toBe('/odata/$batch')
  })
})
