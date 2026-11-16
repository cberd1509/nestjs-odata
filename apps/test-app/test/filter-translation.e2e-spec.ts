/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// Supertest bodies are `any`; the unsafe-* rules are disabled for this file.

/**
 * `$filter` translation over HTTP (#101), asserting the exact rows each filter returns:
 *   - a top-level `or` matches either side, not both
 *   - `eq null` / `ne null` render `IS NULL` / `IS NOT NULL`, also with the operands reversed
 *   - lambda (`any`/`all`) predicates use the mapped column names of the range variable's
 *     properties (`@Column({ name })`), like top-level properties do
 *   - unquoted GUIDs that start with a digit, and bare dates, parse anywhere in the filter
 *
 * Every property of the fixture has a database column name that differs from its name.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Inject, INestApplication, Req } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import {
  Column,
  DataSource,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm'
import supertest from 'supertest'
import {
  ODataController,
  ODataGet,
  ODataModule,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { ODataTypeOrmModule, TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

@Entity({ name: 'ft_tasks' })
class FtTask {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ name: 'external_ref', type: 'varchar', length: 36 })
  externalRef: string

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null

  @Column({ name: 'priority_level', type: 'integer' })
  priorityLevel: number

  @OneToMany(() => FtNote, (n) => n.task)
  notes: FtNote[]
}

@Entity({ name: 'ft_notes' })
class FtNote {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ name: 'is_pinned', type: 'boolean' })
  isPinned: boolean

  @Column({ name: 'word_count', type: 'integer' })
  wordCount: number

  @Column({ name: 'task_id', type: 'integer' })
  taskId: number

  @ManyToOne(() => FtTask, (t) => t.notes)
  @JoinColumn({ name: 'task_id' })
  task: FtTask
}

@ODataController('FtTasks')
class FtTasksController {
  constructor(@Inject(TypeOrmAutoHandler) private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('FtTasks', { path: '' })
  list(@ODataQueryParam('FtTasks') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }
}

describe('$filter translation (#101, e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof supertest>

  const filter = async (expression: string): Promise<number[]> => {
    const res = await http.get('/odata/FtTasks').query({ $filter: expression }).expect(200)
    return res.body.value.map((v: { id: number }) => v.id).sort((a: number, b: number) => a - b)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [FtTask, FtNote],
          synchronize: true,
        }),
        ODataModule.forRoot({ serviceRoot: '/odata' }),
        ODataTypeOrmModule.forFeature(
          [
            { entity: FtTask, name: 'FtTasks' },
            { entity: FtNote, name: 'FtNotes' },
          ],
          { controllers: [FtTasksController] },
        ),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    http = supertest(app.getHttpServer())

    const ds = app.get(DataSource)
    await ds.getRepository(FtTask).save([
      {
        id: 1,
        externalRef: '12345678-aaaa-4bbb-8ccc-000000000001',
        dueDate: '2026-10-15',
        priorityLevel: 1,
      },
      {
        id: 2,
        externalRef: 'abcdef12-aaaa-4bbb-8ccc-000000000002',
        dueDate: null,
        priorityLevel: 2,
      },
      {
        id: 3,
        externalRef: '87654321-aaaa-4bbb-8ccc-000000000003',
        dueDate: '2026-11-20',
        priorityLevel: 3,
      },
    ])
    // Task 1: a pinned long note; task 2: an unpinned short note; task 3: no notes.
    await ds.getRepository(FtNote).save([
      { id: 1, isPinned: true, wordCount: 100, taskId: 1 },
      { id: 2, isPinned: false, wordCount: 10, taskId: 2 },
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  it('a top-level or matches the rows of either side', async () => {
    expect(await filter('priorityLevel eq 1 or priorityLevel eq 2')).toEqual([1, 2])
    expect(await filter('priorityLevel eq 1 or priorityLevel eq 3 or priorityLevel eq 9')).toEqual([
      1, 3,
    ])
    expect(await filter('(priorityLevel eq 1 or priorityLevel eq 2) and dueDate eq null')).toEqual([
      2,
    ])
  })

  it('eq null / ne null match null and non-null columns', async () => {
    expect(await filter('dueDate eq null')).toEqual([2])
    expect(await filter('dueDate ne null')).toEqual([1, 3])
  })

  it('null eq prop / null ne prop match like prop eq null / prop ne null', async () => {
    expect(await filter('null eq dueDate')).toEqual([2])
    expect(await filter('null ne dueDate')).toEqual([1, 3])
    expect(await filter('not (null eq dueDate)')).toEqual([1, 3])
  })

  it('any/all predicates use the mapped column of the range variable property', async () => {
    expect(await filter('notes/any(n: n/isPinned eq true)')).toEqual([1])
    expect(await filter('notes/any(n: n/wordCount lt 50 or n/isPinned eq true)')).toEqual([1, 2])
    // all() over an empty collection is true (task 3).
    expect(await filter('notes/all(n: n/wordCount gt 50)')).toEqual([1, 3])
    expect(await filter('not notes/any(n: n/isPinned eq true)')).toEqual([2, 3])
  })

  it('parses an unquoted GUID that starts with a digit anywhere in the filter', async () => {
    expect(
      await filter('externalRef eq 12345678-aaaa-4bbb-8ccc-000000000001 or priorityLevel eq 3'),
    ).toEqual([1, 3])
  })

  it('parses a bare date literal', async () => {
    expect(await filter('dueDate ge 2026-11-01')).toEqual([3])
    expect(await filter('dueDate lt 2026-11-01 and priorityLevel eq 1')).toEqual([1])
  })
})
