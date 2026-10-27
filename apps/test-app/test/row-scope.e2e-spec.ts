/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
// Supertest bodies are `any`; the unsafe-* rules are disabled for this file.

/**
 * Row-level scopes (`scope` / `defaultScope` in ODataTypeOrmModule.forFeature()).
 *
 * Fixture: projects, tasks and notes, each with an `ownerId`. Every entity set is scoped to
 * the `x-owner` request header, through the three registration forms:
 *   - Projects: an async scope function on the forFeature() item
 *   - Tasks: an injectable scope class whose dependency comes from `imports`
 *   - Notes: the feature's `defaultScope`
 *
 * Owner A owns project 1, task 1 and note 1. Owner B owns project 2, task 2 (in A's
 * project 1), task 3 and note 2 (on A's task 1). Every test checks that rows outside the
 * caller's scope never appear, however they are reached.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  Body,
  Get,
  Header,
  Headers,
  Inject,
  Injectable,
  INestApplication,
  Module,
  Param,
  Req,
} from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Test } from '@nestjs/testing'
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
  ODataDelete,
  ODataGet,
  ODataGetByKey,
  ODataExclude,
  ODataModule,
  ODataPatch,
  ODataPut,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import {
  ODataTypeOrmModule,
  TypeOrmAutoHandler,
  type ODataScope,
  type ODataScopeContext,
  type ODataScopeFn,
} from '@nestjs-odata/typeorm'

@Entity({ name: 'scope_projects' })
class ScopedProject {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  title: string

  @Column({ type: 'varchar', length: 10 })
  ownerId: string

  @OneToMany(() => ScopedTask, (task) => task.project)
  tasks: ScopedTask[]
}

@Entity({ name: 'scope_tasks' })
class ScopedTask {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  title: string

  @Column({ type: 'varchar', length: 10 })
  ownerId: string

  @Column({ type: 'integer' })
  projectId: number

  /** Not loaded by TypeORM by default: must not be reachable through OData either. */
  @Column({ type: 'varchar', length: 50, select: false, default: 'top-secret' })
  secret: string

  @ODataExclude()
  @Column({ type: 'varchar', length: 50, default: 'internal' })
  internalNote: string

  @ManyToOne(() => ScopedProject, (project) => project.tasks)
  project: ScopedProject

  @OneToMany(() => ScopedNote, (note) => note.task)
  notes: ScopedNote[]
}

@Entity({ name: 'scope_notes' })
class ScopedNote {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 50 })
  text: string

  @Column({ type: 'varchar', length: 10 })
  ownerId: string

  @Column({ type: 'integer' })
  taskId: number

  @ManyToOne(() => ScopedTask, (task) => task.notes)
  task: ScopedTask
}

/** Reads the caller from the request; stands in for an app's auth service. */
@Injectable()
class OwnerResolver {
  ownerOf(request: unknown): string | undefined {
    const header = (request as { headers?: Record<string, string> } | undefined)?.headers?.[
      'x-owner'
    ]
    return header || undefined
  }
}

@Module({ providers: [OwnerResolver], exports: [OwnerResolver] })
class OwnerModule {}

/** Restrict `qb` to the owner's rows; no owner sees nothing. */
function restrictToOwner(
  qb: SelectQueryBuilder<ObjectLiteral>,
  ctx: ODataScopeContext,
  owner: string | undefined,
): void {
  if (!owner) {
    qb.andWhere('1 = 0')
    return
  }
  // The same parameter name in every scope: the library renames them per scope.
  qb.andWhere(`${ctx.alias}.ownerId = :owner`, { owner })
}

const resolver = new OwnerResolver()
const seenContexts: ODataScopeContext[] = []

/** Async function scope (Projects). */
const projectScope: ODataScopeFn = async (qb, ctx) => {
  seenContexts.push(ctx)
  await Promise.resolve()
  restrictToOwner(qb, ctx, resolver.ownerOf(ctx.request))
}

/** Class scope with an injected dependency (Tasks). */
@Injectable()
class TaskScope implements ODataScope {
  constructor(@Inject(OwnerResolver) private readonly owners: OwnerResolver) {}

  apply(qb: SelectQueryBuilder<ObjectLiteral>, ctx: ODataScopeContext): void {
    seenContexts.push(ctx)
    restrictToOwner(qb, ctx, this.owners.ownerOf(ctx.request))
  }
}

/** Default scope of the feature (Notes). */
const defaultScope: ODataScopeFn = (qb, ctx) => {
  seenContexts.push(ctx)
  restrictToOwner(qb, ctx, resolver.ownerOf(ctx.request))
}

function crudController(entitySetName: string) {
  @ODataController(entitySetName)
  class CrudController {
    constructor(@Inject(TypeOrmAutoHandler) readonly handler: TypeOrmAutoHandler) {}

    @ODataGet(entitySetName, { path: '' })
    list(@ODataQueryParam(entitySetName) query: ODataQuery, @Req() req: { originalUrl: string }) {
      return this.handler.handleGet(query, req.originalUrl)
    }

    @Get('$count')
    @Header('Content-Type', 'text/plain')
    count(@ODataQueryParam(entitySetName) query: ODataQuery) {
      return this.handler.handleCount(query)
    }

    @ODataGetByKey(entitySetName)
    byKey(@Param('key') key: string) {
      return this.handler.handleGetByKey(key, entitySetName)
    }

    @ODataPatch(entitySetName)
    update(@Param('key') key: string, @Body() body: Record<string, unknown>) {
      return this.handler.handleUpdate(key, body, entitySetName)
    }

    @ODataPut(entitySetName)
    replace(@Param('key') key: string, @Body() body: Record<string, unknown>) {
      return this.handler.handleReplace(key, body, entitySetName)
    }

    @ODataDelete(entitySetName)
    remove(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
      return this.handler.handleDelete(key, entitySetName, ifMatch)
    }
  }
  return CrudController
}

const ProjectsController = crudController('ScopedProjects')
const TasksController = crudController('ScopedTasks')

const BOUNDARY = 'scope_batch'

function batchBody(parts: string[]): string {
  return [...parts.map((p) => `--${BOUNDARY}\r\n${p}`), `--${BOUNDARY}--`].join('\r\n')
}

function batchRequest(method: string, url: string, body?: string): string {
  const line =
    body === undefined
      ? `${method} ${url} HTTP/1.1`
      : `${method} ${url} HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${body}`
  return ['Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', line].join(
    '\r\n',
  )
}

function batchChangeset(parts: string[]): string {
  const cs = 'scope_changeset'
  const inner = [...parts.map((p) => `--${cs}\r\n${p}`), `--${cs}--`].join('\r\n')
  return [`Content-Type: multipart/mixed; boundary=${cs}`, '', inner].join('\r\n')
}

describe('Row-level scopes (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>
  let dataSource: DataSource

  const asOwner = (owner: string, path: string) => http.get(path).set('x-owner', owner)

  async function postBatch(owner: string, body: string): Promise<string> {
    const res = await http
      .post('/odata/$batch')
      .set('x-owner', owner)
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
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [ScopedProject, ScopedTask, ScopedNote],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata' }),
        ODataTypeOrmModule.forFeature(
          [
            { entity: ScopedProject, name: 'ScopedProjects', scope: projectScope },
            { entity: ScopedTask, name: 'ScopedTasks', scope: TaskScope },
            { entity: ScopedNote, name: 'ScopedNotes' },
          ],
          {
            controllers: [ProjectsController, TasksController],
            defaultScope,
            imports: [OwnerModule],
          },
        ),
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
    http = supertest(app.getHttpServer())
    dataSource = app.get(DataSource)

    await dataSource.getRepository(ScopedProject).save([
      { id: 1, title: 'A-project', ownerId: 'A' },
      { id: 2, title: 'B-project', ownerId: 'B' },
    ])
    await dataSource.getRepository(ScopedTask).save([
      { id: 1, title: 'A-task', ownerId: 'A', projectId: 1 },
      { id: 2, title: 'B-task', ownerId: 'B', projectId: 1 },
      { id: 3, title: 'B-task', ownerId: 'B', projectId: 2 },
    ])
    await dataSource.getRepository(ScopedNote).save([
      { id: 1, text: 'A-note', ownerId: 'A', taskId: 1 },
      { id: 2, text: 'B-note', ownerId: 'B', taskId: 1 },
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  it('filters the root collection', async () => {
    const res = await asOwner('A', '/odata/ScopedProjects').expect(200)
    expect(res.body.value.map((p: { id: number }) => p.id)).toEqual([1])

    const b = await asOwner('B', '/odata/ScopedProjects').expect(200)
    expect(b.body.value.map((p: { id: number }) => p.id)).toEqual([2])
  })

  it('shows nothing when the scope denies the request', async () => {
    const res = await http.get('/odata/ScopedProjects').expect(200)
    expect(res.body.value).toEqual([])
  })

  it('combines with $filter instead of replacing it', async () => {
    const res = await asOwner('B', "/odata/ScopedTasks?$filter=title eq 'B-task'").expect(200)
    expect(res.body.value.map((t: { id: number }) => t.id).sort()).toEqual([2, 3])
    const a = await asOwner('A', "/odata/ScopedTasks?$filter=title eq 'B-task'").expect(200)
    expect(a.body.value).toEqual([])
  })

  it('scopes $count=true and /$count', async () => {
    const res = await asOwner('A', '/odata/ScopedTasks?$count=true').expect(200)
    expect(res.body['@odata.count']).toBe(1)
    const count = await asOwner('A', '/odata/ScopedTasks/$count').expect(200)
    expect(count.text).toBe('1')
    const filtered = await asOwner('B', "/odata/ScopedTasks/$count?$filter=title eq 'B-task'")
    expect(filtered.text).toBe('2')
  })

  it('returns 404 for a by-key read outside the scope', async () => {
    await asOwner('A', '/odata/ScopedProjects/2').expect(404)
    const own = await asOwner('A', '/odata/ScopedProjects/1').expect(200)
    expect(own.body.title).toBe('A-project')
  })

  it("scopes $expand: another owner's rows in an owned parent are not expanded", async () => {
    const res = await asOwner('A', '/odata/ScopedProjects?$expand=tasks').expect(200)
    expect(res.body.value).toHaveLength(1)
    expect(res.body.value[0].tasks.map((t: { id: number }) => t.id)).toEqual([1])
  })

  it('scopes nested $expand with each entity set’s own scope', async () => {
    const res = await asOwner('A', '/odata/ScopedProjects?$expand=tasks($expand=notes)').expect(200)
    const [project] = res.body.value
    expect(project.tasks.map((t: { id: number }) => t.id)).toEqual([1])
    expect(project.tasks[0].notes.map((n: { id: number }) => n.id)).toEqual([1])
  })

  it('scopes a single-valued $expand (the parent is outside the scope)', async () => {
    const res = await asOwner('B', '/odata/ScopedTasks?$expand=project&$orderby=id').expect(200)
    const byId = Object.fromEntries(
      res.body.value.map((t: { id: number; project: unknown }) => [t.id, t.project]),
    )
    expect(byId[2]).toBeNull() // task 2 is B's, its project 1 is A's
    expect(byId[3]).toMatchObject({ id: 2 })
  })

  it('keeps parents when a nested $expand filter matches nothing', async () => {
    const res = await asOwner(
      'A',
      "/odata/ScopedProjects?$expand=tasks($filter=title eq 'nothing')",
    ).expect(200)
    expect(res.body.value).toHaveLength(1)
    expect(res.body.value[0].tasks).toEqual([])
  })

  it('scopes lambda any over a navigation property', async () => {
    // Task 2 (owner B, title B-task) is in project 1, but A cannot see it.
    const res = await asOwner(
      'A',
      "/odata/ScopedProjects?$filter=tasks/any(t: t/title eq 'B-task')",
    ).expect(200)
    expect(res.body.value).toEqual([])

    const any = await asOwner('A', '/odata/ScopedProjects?$filter=tasks/any()').expect(200)
    expect(any.body.value.map((p: { id: number }) => p.id)).toEqual([1])
  })

  it('scopes lambda all over a navigation property', async () => {
    // Unscoped, project 1 has an A-task and a B-task, so `all(title eq 'A-task')` is false.
    // Scoped to A, only the A-task is in range, so it is true.
    const res = await asOwner(
      'A',
      "/odata/ScopedProjects?$filter=tasks/all(t: t/title eq 'A-task')",
    ).expect(200)
    expect(res.body.value.map((p: { id: number }) => p.id)).toEqual([1])
  })

  it('scopes $apply aggregations', async () => {
    const res = await asOwner(
      'B',
      '/odata/ScopedTasks?$apply=groupby((ownerId),aggregate($count as Total))',
    ).expect(200)
    expect(res.body.value).toEqual([{ ownerId: 'B', Total: 2 }])
  })

  it('refuses PATCH, PUT and DELETE outside the scope (404) and leaves the row unchanged', async () => {
    await http
      .patch('/odata/ScopedProjects/2')
      .set('x-owner', 'A')
      .send({ title: 'hijacked' })
      .expect(404)
    await http
      .put('/odata/ScopedProjects/2')
      .set('x-owner', 'A')
      .send({ title: 'hijacked', ownerId: 'A' })
      .expect(404)
    await http.delete('/odata/ScopedProjects/2').set('x-owner', 'A').expect(404)

    const row = await dataSource.getRepository(ScopedProject).findOneByOrFail({ id: 2 })
    expect(row).toMatchObject({ title: 'B-project', ownerId: 'B' })

    // Inside the scope, writes go through.
    const ok = await http
      .patch('/odata/ScopedProjects/2')
      .set('x-owner', 'B')
      .send({ title: 'B-project 2' })
      .expect(200)
    expect(ok.body.title).toBe('B-project 2')
  })

  it('scopes $batch reads and the existence checks of changeset writes', async () => {
    const text = await postBatch(
      'A',
      batchBody([
        batchRequest('GET', '/odata/ScopedProjects(2)'),
        batchRequest('GET', '/odata/ScopedProjects(1)'),
        batchRequest('GET', '/odata/ScopedTasks'),
        batchChangeset([batchRequest('PATCH', '/odata/ScopedTasks(3)', '{"title":"x"}')]),
        batchChangeset([batchRequest('DELETE', '/odata/ScopedTasks(3)')]),
      ]),
    )
    const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]))
    expect(statuses).toEqual([404, 200, 200, 404, 404])
    expect(text).not.toContain('B-project')
    expect(text).not.toContain('B-task')

    const task = await dataSource.getRepository(ScopedTask).findOneByOrFail({ id: 3 })
    expect(task.title).toBe('B-task')
  })

  it('validates nested $expand options and hides select:false and @ODataExclude columns', async () => {
    for (const path of [
      '/odata/ScopedProjects?$expand=tasks($select=secret)',
      "/odata/ScopedProjects?$expand=tasks($filter=secret eq 'top-secret')",
      '/odata/ScopedProjects?$expand=tasks($orderby=internalNote)',
      '/odata/ScopedProjects?$expand=tasks($select=nope)',
      '/odata/ScopedProjects?$expand=tasks($expand=nope)',
      "/odata/ScopedTasks?$filter=secret eq 'top-secret'",
    ]) {
      const res = await asOwner('A', path)
      expect({ path, status: res.status }).toEqual({ path, status: 400 })
    }
    const ok = await asOwner('A', '/odata/ScopedProjects?$expand=tasks($select=title)').expect(200)
    expect(ok.body.value[0].tasks[0]).not.toHaveProperty('secret')
  })

  it('binds lambda properties without the range variable to the outer entity', async () => {
    // `title` is the project's (A-project), `t/ownerId` the task's.
    const res = await asOwner(
      'A',
      "/odata/ScopedProjects?$filter=tasks/any(t: t/ownerId eq 'A' and title eq 'A-project')",
    ).expect(200)
    expect(res.body.value.map((p: { id: number }) => p.id)).toEqual([1])
  })

  it('ignores a PATCH body key that points at another row (OData §11.4.3, HTTP and $batch)', async () => {
    const before = await dataSource.getRepository(ScopedProject).findOneByOrFail({ id: 2 })
    const res = await http
      .patch('/odata/ScopedProjects/1')
      .set('x-owner', 'A')
      .send({ id: 2, title: 'renamed over HTTP' })
      .expect(200)
    expect(res.body).toMatchObject({ id: 1, title: 'renamed over HTTP' })
    const text = await postBatch(
      'A',
      batchBody([
        batchChangeset([
          batchRequest('PATCH', '/odata/ScopedProjects(1)', '{"id":2,"title":"renamed in batch"}'),
        ]),
      ]),
    )
    expect(text).toContain('HTTP/1.1 200')
    const rows = await dataSource.getRepository(ScopedProject).find({ order: { id: 'ASC' } })
    expect(rows.find((r) => r.id === 1)?.title).toBe('renamed in batch')
    // The row the body key named (another owner's) is untouched.
    expect(rows.find((r) => r.id === 2)).toEqual(before)
  })

  it('hands the scope its context: entity set, metadata, alias, operation, path and request', async () => {
    seenContexts.length = 0
    await asOwner('A', '/odata/ScopedProjects?$expand=tasks($expand=notes)').expect(200)
    const summary = seenContexts.map((c) => ({
      set: c.entitySetName,
      op: c.operation,
      path: c.navigationPath.join('/'),
      table: c.metadata.tableName,
      type: c.entityType.name,
      hasAlias: c.alias.length > 0,
      owner: (c.request as { headers: Record<string, string> }).headers['x-owner'],
      http: c.executionContext?.getType(),
    }))
    expect(summary).toEqual([
      {
        set: 'ScopedProjects',
        op: 'collection',
        path: '',
        table: 'scope_projects',
        type: 'ScopedProject',
        hasAlias: true,
        owner: 'A',
        http: 'http',
      },
      {
        set: 'ScopedTasks',
        op: 'expand',
        path: 'tasks',
        table: 'scope_tasks',
        type: 'ScopedTask',
        hasAlias: true,
        owner: 'A',
        http: 'http',
      },
      {
        set: 'ScopedNotes',
        op: 'expand',
        path: 'tasks/notes',
        table: 'scope_notes',
        type: 'ScopedNote',
        hasAlias: true,
        owner: 'A',
        http: 'http',
      },
    ])
  })
})

describe('requireScope (e2e)', () => {
  @Entity({ name: 'unscoped_things' })
  class UnscopedThing {
    @PrimaryGeneratedColumn()
    id: number
  }

  it('refuses to start when an entity set has no scope', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [UnscopedThing],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata', requireScope: true }),
        ODataTypeOrmModule.forFeature([UnscopedThing]),
      ],
    }).compile()
    const app = moduleRef.createNestApplication()
    await expect(app.init()).rejects.toThrow(/requireScope is enabled.*UnscopedThings/)
    await app.close()
  })

  it('starts when every entity set has a scope', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [UnscopedThing],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata', requireScope: true }),
        ODataTypeOrmModule.forFeature([UnscopedThing], { defaultScope: () => undefined }),
      ],
    }).compile()
    const app = moduleRef.createNestApplication()
    await expect(app.init()).resolves.toBeDefined()
    await app.close()
  })
})
