import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm'
import {
  EdmRegistry,
  navigationTargetTypeName,
  runWithODataRequestContext,
  type ODataModuleResolvedOptions,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from '../deriver/typeorm-edm-deriver.js'
import { TypeOrmQueryTranslator } from '../translator/typeorm-query-translator.js'
import { TypeOrmAutoHandler } from '../translator/typeorm-auto-handler.js'
import { ODataScopeRegistry } from './scope-registry.js'
import {
  lookupScope,
  TypeOrmScopeService,
  renameParameters,
  scopeInCondition,
} from './typeorm-scope.service.js'
import type { ODataScopeContext, ODataScopeFn } from './scope.types.js'

@Entity({ name: 'sc_folder' })
class Folder {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  owner: string

  @OneToMany(() => Doc, (d) => d.folder)
  docs: Doc[]
}

@Entity({ name: 'sc_doc' })
class Doc {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  owner: string

  @Column({ type: 'varchar' })
  title: string

  @Column({ type: 'integer' })
  folderId: number

  @ManyToOne(() => Folder, (f) => f.docs, { eager: true })
  folder: Folder
}

const baseOptions: ODataModuleResolvedOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 100,
  maxExpandDepth: 3,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
  maxDeepInsertDepth: 5,
  requireScope: false,
}

const ownerScope: ODataScopeFn = (qb, ctx) => {
  const owner = (ctx.request as { owner?: string } | undefined)?.owner
  qb.andWhere(`${ctx.alias}.owner = :owner`, { owner: owner ?? '' })
}

describe('TypeOrmScopeService', () => {
  let dataSource: DataSource
  let edm: EdmRegistry

  function makeService(
    scopes: Record<string, ODataScopeFn>,
    options: Partial<ODataModuleResolvedOptions> = {},
  ) {
    const registry = new ODataScopeRegistry()
    for (const [set, fn] of Object.entries(scopes)) registry.register(set, fn, fn)
    const resolved = { ...baseOptions, ...options }
    const service = new TypeOrmScopeService(dataSource, edm, resolved, registry)
    const repo = dataSource.getRepository(Folder) as never
    const translator = new TypeOrmQueryTranslator(repo, edm, resolved)
    const handler = new TypeOrmAutoHandler(
      translator,
      edm,
      resolved,
      repo,
      undefined,
      dataSource,
      service,
    )
    return { service, translator, handler }
  }

  const asOwner = <T>(owner: string, fn: () => Promise<T>) =>
    runWithODataRequestContext({ request: { owner } }, fn)

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Folder, Doc],
      synchronize: true,
    })
    await dataSource.initialize()
    edm = new EdmRegistry()
    const metas = [dataSource.getMetadata(Folder), dataSource.getMetadata(Doc)]
    for (const config of new TypeOrmEdmDeriver('Default', 'skip').deriveEntityTypes(
      [Folder, Doc],
      metas,
    )) {
      edm.register(
        {
          name: config.entityTypeName,
          namespace: 'Default',
          properties: config.properties,
          navigationProperties: config.navigationProperties,
          keyProperties: config.keyProperties,
          isReadOnly: false,
        },
        {
          name: config.entitySetName,
          entityTypeName: config.entityTypeName,
          namespace: 'Default',
          isReadOnly: false,
        },
      )
    }
    await dataSource.getRepository(Folder).save([
      { id: 1, owner: 'a' },
      { id: 2, owner: 'b' },
    ])
    await dataSource.getRepository(Doc).save([
      { id: 1, owner: 'a', title: 'x', folderId: 1 },
      { id: 2, owner: 'b', title: 'y', folderId: 1 },
    ])
  })

  afterAll(async () => {
    await dataSource.destroy()
  })

  it('returns no subquery for an unscoped entity set', async () => {
    const { service } = makeService({})
    expect(service.isScoped('Folders')).toBe(false)
    expect(await service.subqueryFor('Folders', 'collection')).toBeUndefined()
  })

  it('fails closed under requireScope, for the root and for navigation targets', async () => {
    const { service, translator } = makeService({ Folders: ownerScope }, { requireScope: true })
    expect(service.isScoped('Docs')).toBe(true)
    await expect(service.subqueryFor('Docs', 'collection')).rejects.toThrow(
      /No row-level scope is registered for entity set 'Docs'/,
    )
    await expect(
      service.prepare(
        { entitySetName: 'Folders', expand: { items: [{ navigationProperty: 'docs' }] } },
        'collection',
      ),
    ).rejects.toThrow(/'Docs'/)
    const entityType = edm.getEntityType('Folder')!
    expect(() => translator.translate({ entitySetName: 'Folders' }, entityType)).toThrow(
      /requireScope is enabled/,
    )
  })

  it('renders a scope with unique parameter names and the request context', async () => {
    let seen: ODataScopeContext | undefined
    const { service } = makeService({
      Docs: (qb, ctx) => {
        seen = ctx
        return ownerScope(qb, ctx)
      },
    })
    const sub = await asOwner('a', () => service.subqueryFor('Docs', 'filter', ['docs']))
    expect(sub!.sql).toMatch(/:odata_scope\d+_owner/)
    expect(Object.values(sub!.params)).toEqual(['a'])
    expect(seen).toMatchObject({
      entitySetName: 'Docs',
      operation: 'filter',
      navigationPath: ['docs'],
      alias: 'Docs_scope',
      request: { owner: 'a' },
    })
    expect(seen!.metadata.tableName).toBe('sc_doc')
    expect(seen!.entityType.name).toBe('Doc')
  })

  it('scopes reads through the auto handler: collection, count, by key, expand and lambdas', async () => {
    const { handler } = makeService({ Folders: ownerScope, Docs: ownerScope })
    const result = await asOwner('a', () =>
      handler.handleGet(
        {
          entitySetName: 'Folders',
          expand: { items: [{ navigationProperty: 'docs' }] },
          filter: {
            kind: 'LambdaExpr',
            operator: 'any',
            collection: 'docs',
            variable: 'd',
            predicate: {
              kind: 'BinaryExpr',
              operator: 'eq',
              left: { kind: 'PropertyAccess', path: ['d', 'title'] },
              right: { kind: 'Literal', value: 'x', literalType: 'string' },
            },
          } as ODataQuery['filter'],
        },
        '/odata/Folders',
      ),
    )
    expect(result.items).toHaveLength(1)
    expect((result.items[0] as { docs: Doc[] }).docs.map((d) => d.id)).toEqual([1])

    // Doc 2 ('y') belongs to b: a's folder has no visible doc titled 'y'.
    const hidden = await asOwner('a', () =>
      handler.handleCount({
        entitySetName: 'Folders',
        filter: {
          kind: 'LambdaExpr',
          operator: 'any',
          collection: 'docs',
          variable: 'd',
          predicate: {
            kind: 'BinaryExpr',
            operator: 'eq',
            left: { kind: 'PropertyAccess', path: ['d', 'title'] },
            right: { kind: 'Literal', value: 'y', literalType: 'string' },
          },
        } as ODataQuery['filter'],
      }),
    )
    expect(hidden).toBe(0)

    await expect(asOwner('a', () => handler.handleGetByKey('2', 'Folders'))).rejects.toThrow(
      /not found/,
    )
    expect(await asOwner('b', () => handler.handleGetByKey('2', 'Folders'))).toMatchObject({
      id: 2,
    })
  })

  it('refuses updates, replaces and deletes outside the scope', async () => {
    const { handler } = makeService({ Folders: ownerScope })
    await expect(
      asOwner('a', () => handler.handleUpdate('2', { owner: 'a' }, 'Folders')),
    ).rejects.toThrow(/not found/)
    await expect(
      asOwner('a', () => handler.handleReplace('2', { owner: 'a' }, 'Folders')),
    ).rejects.toThrow(/not found/)
    await expect(asOwner('a', () => handler.handleDelete('2', 'Folders'))).rejects.toThrow(
      /not found/,
    )
    expect(await dataSource.getRepository(Folder).findOneByOrFail({ id: 2 })).toMatchObject({
      owner: 'b',
    })
  })

  it('collects lambda scopes inside $apply filters and nested $expand filters', async () => {
    const { service } = makeService({ Folders: ownerScope, Docs: ownerScope })
    const lambda = {
      kind: 'LambdaExpr',
      operator: 'any',
      collection: 'Docs',
      variable: null,
      predicate: null,
    } as const
    const plan = await service.prepare(
      {
        entitySetName: 'Docs',
        apply: {
          steps: [
            {
              kind: 'ApplyFilter',
              filter: {
                kind: 'UnaryExpr',
                operator: 'not',
                operand: { kind: 'FunctionCall', name: 'x', args: [] },
              },
            },
          ],
        },
      },
      'collection',
    )
    expect(plan.lambda.size).toBe(0)
    const nested = await service.prepare(
      {
        entitySetName: 'Docs',
        expand: {
          items: [
            { navigationProperty: 'folder', filter: lambda },
            { navigationProperty: 'unknown' },
          ],
        },
      },
      'collection',
    )
    expect([...nested.expand.keys()]).toEqual(['folder'])
    expect([...nested.lambda.keys()]).toEqual(['folder/docs'])
  })
  it('loads eager relations on scoped by-key reads, like Repository.findOne()', async () => {
    const { service } = makeService({ Docs: ownerScope })
    const doc = await asOwner('a', () => service.findOne('Docs', { id: 1 }, 'entity'))
    expect(doc).toMatchObject({ id: 1, folder: { id: 1 } })
  })

  it('runs a scope once per entity set and operation, even through several paths', async () => {
    const calls: string[] = []
    const counting: ODataScopeFn = (qb, ctx) => {
      calls.push(`${ctx.entitySetName}:${ctx.operation}:${ctx.navigationPath.join('/')}`)
      return ownerScope(qb, ctx)
    }
    const { service } = makeService({ Folders: counting, Docs: counting })
    const plan = await asOwner('a', () =>
      service.prepare(
        {
          entitySetName: 'Folders',
          expand: {
            items: [
              {
                navigationProperty: 'docs',
                expand: {
                  items: [
                    {
                      navigationProperty: 'folder',
                      expand: { items: [{ navigationProperty: 'docs' }] },
                    },
                  ],
                },
              },
            ],
          },
        },
        'collection',
      ),
    )
    expect(calls.sort()).toEqual([
      'Docs:expand:docs',
      'Folders:collection:',
      'Folders:expand:docs/folder',
    ])
    expect([...plan.expand.keys()].sort()).toEqual(['docs', 'docs/folder', 'docs/folder/docs'])
  })

  it('runs scoped writes in a transaction with the row check inside it', async () => {
    const { handler } = makeService({ Folders: ownerScope })
    const spy = vi.spyOn(dataSource.getRepository(Folder).manager, 'transaction')
    await asOwner('a', () => handler.handleUpdate('1', { owner: 'a' }, 'Folders'))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('ignores a PATCH body key that differs from the URL key (OData §11.4.3)', async () => {
    const { handler } = makeService({ Folders: ownerScope })
    const updated = await asOwner('a', () =>
      handler.handleUpdate('1', { id: 2, owner: 'a' }, 'Folders'),
    )
    expect(updated).toMatchObject({ id: 1, owner: 'a' })
    // The row the body key named is untouched.
    expect(await dataSource.getRepository(Folder).findOneByOrFail({ id: 2 })).toMatchObject({
      owner: 'b',
    })
  })

  it('locks the checked row on drivers with row locks, inside a transaction only', async () => {
    const calls: string[] = []
    const qb: Record<string, unknown> = {}
    for (const m of ['setFindOptions', 'andWhere']) qb[m] = () => qb
    qb.setLock = (mode: string) => {
      calls.push(mode)
      return qb
    }
    qb.getOne = () => Promise.resolve(null)
    const manager = {
      dataSource: { options: { type: 'postgres' } },
      createQueryBuilder: () => qb,
      queryRunner: { isTransactionActive: true },
    }
    const { service } = makeService({})
    await service.findOne('Folders', { id: 1 }, 'write', manager as never, { lock: true })
    expect(calls).toEqual(['pessimistic_write'])
    calls.length = 0
    await service.findOne('Folders', { id: 1 }, 'write', manager as never)
    expect(calls).toEqual([])
    // PostgreSQL refuses FOR UPDATE outside a transaction: no lock there.
    const outside = { ...manager, queryRunner: undefined }
    await service.findOne('Folders', { id: 1 }, 'write', outside as never, { lock: true })
    expect(calls).toEqual([])
  })

  it('quotes the primary-key column of a lambda scope', async () => {
    const { service, translator } = makeService({ Folders: ownerScope, Docs: ownerScope })
    const query: ODataQuery = {
      entitySetName: 'Folders',
      filter: {
        kind: 'LambdaExpr',
        operator: 'any',
        collection: 'docs',
        variable: null,
        predicate: null,
      },
    }
    const plan = await asOwner('a', () => service.prepare(query, 'collection'))
    const { qb } = translator.translate(
      query,
      edm.getEntityType('Folder')!,
      dataSource.getRepository(Folder),
      plan,
    )
    expect(qb.getQuery()).toMatch(/sub_lambda_\d+\."id" IN \(SELECT/)
  })

  it('fails closed when a required plan misses a lambda path', () => {
    const { translator } = makeService({}, { requireScope: true })
    const query: ODataQuery = {
      entitySetName: 'Folders',
      filter: {
        kind: 'LambdaExpr',
        operator: 'any',
        collection: 'docs',
        variable: null,
        predicate: null,
      },
    }
    expect(() =>
      translator.translate(
        query,
        edm.getEntityType('Folder')!,
        dataSource.getRepository(Folder) as never,
        {
          expand: new Map(),
          lambda: new Map(),
          required: true,
        },
      ),
    ).toThrow(/lambda path 'docs'/)
  })

  it('binds unprefixed lambda properties to the outer entity', async () => {
    const { handler } = makeService({})
    const lambda = (outerOwner: string): ODataQuery => ({
      entitySetName: 'Folders',
      filter: {
        kind: 'LambdaExpr',
        operator: 'any',
        collection: 'docs',
        variable: 'd',
        predicate: {
          kind: 'BinaryExpr',
          operator: 'and',
          left: {
            kind: 'BinaryExpr',
            operator: 'eq',
            left: { kind: 'PropertyAccess', path: ['d', 'title'] },
            right: { kind: 'Literal', value: 'y' },
          },
          right: {
            kind: 'BinaryExpr',
            operator: 'eq',
            left: { kind: 'PropertyAccess', path: ['owner'] },
            right: { kind: 'Literal', value: outerOwner },
          },
        },
      } as ODataQuery['filter'],
    })
    // Doc 2 ('y') is owned by b but sits in folder 1, owned by a: `owner` is the folder's.
    expect(await handler.handleCount(lambda('a'))).toBe(1)
    expect(await handler.handleCount(lambda('b'))).toBe(0)
  })

  describe('navigation targets that are not entity sets', () => {
    /** EDM where Folder also has `ghosts` (an unregistered type) and Phantoms has no TypeORM entity. */
    function edmWithGhosts(): EdmRegistry {
      const ghostly = new EdmRegistry()
      const folder = edm.getEntityType('Folder')!
      ghostly.register(
        {
          ...folder,
          navigationProperties: [
            ...folder.navigationProperties,
            {
              name: 'ghosts',
              type: 'Collection(Default.Ghost)',
              nullable: true,
              isCollection: true,
            },
            { name: 'ghost', type: 'Default.Ghost', nullable: true, isCollection: false },
          ],
        },
        { ...edm.getEntitySet('Folders')!, name: 'Folders' },
      )
      ghostly.register(edm.getEntityType('Doc')!, { ...edm.getEntitySet('Docs')!, name: 'Docs' })
      ghostly.register(
        { ...folder, name: 'Phantom', navigationProperties: [] },
        { name: 'Phantoms', entityTypeName: 'Phantom', namespace: 'Default', isReadOnly: false },
      )
      return ghostly
    }

    function serviceOn(
      registry: EdmRegistry,
      scopes: Record<string, ODataScopeFn>,
      requireScope: boolean,
    ) {
      const reg = new ODataScopeRegistry()
      for (const [set, fn] of Object.entries(scopes)) reg.register(set, fn, fn)
      return new TypeOrmScopeService(dataSource, registry, { ...baseOptions, requireScope }, reg)
    }

    const ghostsAny = {
      kind: 'LambdaExpr',
      operator: 'any',
      collection: 'ghosts',
      variable: null,
      predicate: null,
    } as const
    const ghostPath = {
      kind: 'BinaryExpr',
      operator: 'eq',
      left: { kind: 'PropertyAccess', path: ['ghost', 'id'] },
      right: { kind: 'Literal', value: 1 },
    } as const

    it('requireScope: fails closed for $expand, lambdas and navigation paths into them', async () => {
      const service = serviceOn(edmWithGhosts(), { Folders: ownerScope, Docs: ownerScope }, true)
      const message = /Navigation 'ghosts' targets 'Ghost', which is not an OData entity set/
      await expect(
        service.prepare(
          { entitySetName: 'Folders', expand: { items: [{ navigationProperty: 'ghosts' }] } },
          'collection',
        ),
      ).rejects.toThrow(message)
      await expect(
        service.prepare({ entitySetName: 'Folders', filter: ghostsAny }, 'collection'),
      ).rejects.toThrow(message)
      await expect(
        service.prepare({ entitySetName: 'Folders', filter: ghostPath as never }, 'collection'),
      ).rejects.toThrow(/Navigation 'ghost' targets 'Ghost'/)
    })

    it('without requireScope: such targets are skipped (nothing to scope)', async () => {
      const service = serviceOn(edmWithGhosts(), { Folders: ownerScope }, false)
      const plan = await asOwner('a', () =>
        service.prepare(
          {
            entitySetName: 'Folders',
            filter: {
              kind: 'BinaryExpr',
              operator: 'and',
              left: ghostsAny,
              right: ghostPath,
            } as never,
            expand: { items: [{ navigationProperty: 'ghosts' }] },
          },
          'collection',
        ),
      )
      expect(plan.root).toBeDefined()
      expect(plan.expand.size).toBe(0)
      expect(plan.lambda.size).toBe(0)
    })

    it('ignores unknown lambda collections and collection-valued path segments (the pipe rejects them)', async () => {
      const { service } = makeService({ Folders: ownerScope, Docs: ownerScope })
      const plan = await asOwner('a', () =>
        service.prepare(
          {
            entitySetName: 'Folders',
            filter: {
              kind: 'BinaryExpr',
              operator: 'or',
              left: { ...ghostsAny, collection: 'nope' },
              right: {
                kind: 'BinaryExpr',
                operator: 'eq',
                left: { kind: 'PropertyAccess', path: ['docs', 'title'] },
                right: { kind: 'Literal', value: 'x' },
              },
            } as never,
          },
          'collection',
        ),
      )
      expect(plan.lambda.size).toBe(0)
    })

    it('fails clearly for an unregistered entity set or one without a TypeORM entity', async () => {
      const service = serviceOn(edmWithGhosts(), { Phantoms: ownerScope }, false)
      await expect(service.prepare({ entitySetName: 'Nope' }, 'collection')).rejects.toThrow(
        "TypeOrmScopeService: entity set 'Nope' is not registered",
      )
      await expect(service.findOne('Phantoms', { id: 1 }, 'entity')).rejects.toThrow(
        "TypeOrmScopeService: no TypeORM entity named 'Phantom'",
      )
    })

    it('$apply steps other than filter contribute no scope targets', async () => {
      const { service } = makeService({ Docs: ownerScope, Folders: ownerScope })
      const plan = await asOwner('a', () =>
        service.prepare(
          {
            entitySetName: 'Docs',
            apply: { steps: [{ kind: 'ApplyGroupBy', properties: ['title'] }] } as never,
            // $expand is ignored with $apply: the response has no entities to expand.
            expand: { items: [{ navigationProperty: 'folder' }] },
          },
          'collection',
        ),
      )
      expect(plan.root).toBeDefined()
      expect(plan.expand.size).toBe(0)
    })
  })
})

describe('lookupScope', () => {
  it('fails closed on a missing path only when the plan is required', () => {
    const plan = { expand: new Map(), lambda: new Map() }
    expect(lookupScope(plan, 'lambda', ['x'])).toBeUndefined()
    expect(() => lookupScope({ ...plan, required: true }, 'expand', ['a', 'b'])).toThrow(
      /No row-level scope was prepared for expand path 'a\/b'/,
    )
  })
})

describe('scope helpers', () => {
  it('renames parameters, including spread parameters, without touching casts', () => {
    const { sql, params } = renameParameters(
      'a = :id AND b IN (:...ids) AND c::text = :idx AND d = ::id',
      { id: 1, ids: [2], idx: 3 },
    )
    const prefix = /:(odata_scope\d+_)id\b/.exec(sql)![1]
    expect(sql).toBe(
      `a = :${prefix}id AND b IN (:...${prefix}ids) AND c::text = :${prefix}idx AND d = ::id`,
    )
    expect(params).toEqual({ [`${prefix}id`]: 1, [`${prefix}ids`]: [2], [`${prefix}idx`]: 3 })
  })

  it('builds single and composite IN conditions', () => {
    const one = {
      entitySetName: 'S',
      sql: 'SELECT 1',
      params: {},
      primaryColumns: [{ propertyPath: 'id', databaseName: 'id' }],
    }
    expect(scopeInCondition(one, (c) => `x.${c.propertyPath}`)).toBe('x.id IN (SELECT 1)')
    const two = {
      ...one,
      primaryColumns: [
        { propertyPath: 'a', databaseName: 'a_col' },
        { propertyPath: 'b', databaseName: 'b_col' },
      ],
    }
    expect(scopeInCondition(two, (c) => `x.${c.databaseName}`)).toBe(
      '(x.a_col, x.b_col) IN (SELECT 1)',
    )
  })

  it('strips Collection() and namespaces from navigation types (core helper)', () => {
    expect(navigationTargetTypeName('Collection(Default.Doc)')).toBe('Doc')
    expect(navigationTargetTypeName('Default.Folder')).toBe('Folder')
    expect(navigationTargetTypeName('Folder')).toBe('Folder')
  })
})

describe('ODataScopeRegistry', () => {
  it('is shared per application key', () => {
    const key = {}
    expect(ODataScopeRegistry.for(key)).toBe(ODataScopeRegistry.for(key))
    expect(ODataScopeRegistry.for({})).not.toBe(ODataScopeRegistry.for(key))
  })

  it('ignores re-registration of the same source and rejects a different one', () => {
    const registry = new ODataScopeRegistry()
    const fn: ODataScopeFn = () => undefined
    registry.register('Things', fn, fn)
    registry.register('Things', fn, fn)
    expect(registry.get('Things')).toBe(fn)
    expect(() => registry.register('Things', () => undefined, 'other')).toThrow(
      /two different row-level scopes/,
    )
  })
})
