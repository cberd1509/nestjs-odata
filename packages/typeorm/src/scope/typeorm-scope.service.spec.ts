import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm'
import {
  EdmRegistry,
  runWithODataRequestContext,
  type ODataModuleResolvedOptions,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from '../deriver/typeorm-edm-deriver.js'
import { TypeOrmQueryTranslator } from '../translator/typeorm-query-translator.js'
import { TypeOrmAutoHandler } from '../translator/typeorm-auto-handler.js'
import { ODataScopeRegistry } from './scope-registry.js'
import {
  TypeOrmScopeService,
  navigationTargetTypeName,
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

  @ManyToOne(() => Folder, (f) => f.docs)
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
      } as ODataQuery,
      'collection',
    )
    expect(plan.lambda.size).toBe(0)
    const nested = await service.prepare(
      {
        entitySetName: 'Docs',
        expand: {
          items: [
            { navigationProperty: 'folder', filter: lambda as never },
            { navigationProperty: 'unknown' },
          ],
        },
      },
      'collection',
    )
    expect([...nested.expand.keys()]).toEqual(['folder'])
    expect([...nested.lambda.keys()]).toEqual(['folder/docs'])
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

  it('strips Collection() and namespaces from navigation types', () => {
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
