import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Controller, Injectable, Logger, Module } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import { Test, type TestingModule } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import {
  EdmRegistry,
  ETAG_PROVIDER,
  ODataController,
  ODataETag,
  ODataModule,
  SEARCH_PROVIDER,
} from '@nestjs-odata/core'
import {
  ODataTypeOrmModule,
  type ODataTypeOrmFeatureItem,
  type ODataTypeOrmFeatureOptions,
} from './odata-typeorm.module.js'
import { ODataScopeRegistry } from './scope/scope-registry.js'
import type { ODataScope, ODataScopeContext } from './scope/scope.types.js'
import { ODataWriteRegistry } from './write/write-registry.js'
import type { ODataWriteHandlers } from './write/write.types.js'
import { TypeOrmAutoHandler } from './translator/typeorm-auto-handler.js'
import { TypeOrmETagProvider } from './etag/typeorm-etag.provider.js'
import { TypeOrmSearchProvider } from './translator/search-provider.js'
import { BatchController } from './batch/batch-controller.js'

@Entity()
class WProduct {
  @PrimaryGeneratedColumn() id!: number
  @Column() name!: string
  @UpdateDateColumn() updatedAt!: Date
}

@Entity()
class WCategory {
  @PrimaryGeneratedColumn() id!: number
  @Column() label!: string
  @ODataETag() @Column({ default: 1 }) revision!: number
}

@Entity()
class WTag {
  @PrimaryGeneratedColumn() id!: number
  @Column() text!: string
}

@Entity()
class WNote {
  @PrimaryGeneratedColumn() id!: number
  @Column() body!: string
  @Column({ default: 0 }) version!: number
}

const ENTITIES = [WProduct, WCategory, WTag, WNote]

/** Service exported from another module, injected into a class-based scope and write handlers. */
@Injectable()
class TenantService {
  readonly tenantId = 'acme'
}

@Module({ providers: [TenantService], exports: [TenantService] })
class TenantModule {}

@Injectable()
class TenantScope implements ODataScope {
  constructor(readonly tenants: TenantService) {}
  apply(qb: { andWhere: (sql: string, params: object) => unknown }, ctx: ODataScopeContext): void {
    qb.andWhere(`${ctx.alias}.tenant = :t`, { t: this.tenants.tenantId })
  }
}

@Injectable()
class ProductWrites implements ODataWriteHandlers<WProduct> {
  constructor(readonly tenants: TenantService) {}
  create(body: Record<string, unknown>): WProduct {
    return { id: 1, name: String(body.name), updatedAt: new Date(0) }
  }
}

@ODataController('Products')
@Controller()
class ProductsController {}

class PlainController {}

let moduleRef: TestingModule | undefined

afterEach(async () => {
  await moduleRef?.close()
  moduleRef = undefined
  vi.restoreAllMocks()
})

async function boot(
  items: ODataTypeOrmFeatureItem[],
  featureOptions: ODataTypeOrmFeatureOptions = {},
  rootOptions: { requireScope?: boolean } = {},
): Promise<TestingModule> {
  moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: ENTITIES,
        synchronize: true,
      }),
      ODataModule.forRoot({ serviceRoot: '/odata', ...rootOptions }),
      ODataTypeOrmModule.forFeature(items, featureOptions),
    ],
  }).compile()
  await moduleRef.init()
  return moduleRef
}

describe('ODataTypeOrmModule.forFeature() wiring (real Nest container + SQLite)', () => {
  it('derives and registers every entity set, applying { entity, name } overrides', async () => {
    const app = await boot([{ entity: WProduct, name: 'Products' }, WCategory])
    const edm = app.get(EdmRegistry)

    expect(edm.getEntitySet('Products')?.entityTypeName).toBe('WProduct')
    // No override: the pluralized default name is used.
    const categorySet = edm.getEntitySetByTypeName('WCategory')
    expect(categorySet).toBeDefined()
    expect(categorySet?.name).not.toBe('Products')
    // Without requireIfMatch, no Core.OptimisticConcurrency is advertised.
    expect(edm.getEntitySet('Products')?.optimisticConcurrency).toBeUndefined()
  })

  it('provides the adapter services under their core tokens', async () => {
    const app = await boot([WProduct])
    expect(app.get(ETAG_PROVIDER)).toBe(app.get(TypeOrmETagProvider))
    expect(app.get(SEARCH_PROVIDER)).toBe(app.get(TypeOrmSearchProvider))
    expect(app.get(TypeOrmAutoHandler)).toBeInstanceOf(TypeOrmAutoHandler)
  })

  it('registers function scopes, class scopes (resolved with injected deps) and the default scope', async () => {
    const fnScope = vi.fn()
    const app = await boot(
      [
        { entity: WProduct, name: 'Products', scope: fnScope },
        { entity: WCategory, name: 'Categories', scope: TenantScope },
        { entity: WTag, name: 'Tags' },
      ],
      { defaultScope: TenantScope, imports: [TenantModule] },
    )
    const scopes = app.get(ODataScopeRegistry)

    expect(scopes.get('Products')).toBe(fnScope)

    // The class scope is instantiated by Nest (with TenantService injected) and wrapped.
    const categoryScope = scopes.get('Categories')
    expect(categoryScope).toBeTypeOf('function')
    const qb = { andWhere: vi.fn() }
    void categoryScope!(qb as never, { alias: 'c' } as never)
    expect(qb.andWhere).toHaveBeenCalledWith('c.tenant = :t', { t: 'acme' })

    // WTag has no scope of its own: it falls back to defaultScope.
    expect(scopes.has('Tags')).toBe(true)
  })

  it('registers write handlers given as an injectable class or as an object', async () => {
    const noteHandlers: ODataWriteHandlers = { delete: vi.fn() }
    const app = await boot(
      [
        { entity: WProduct, name: 'Products', writeHandlers: ProductWrites },
        { entity: WNote, name: 'Notes', writeHandlers: noteHandlers },
        { entity: WTag, name: 'Tags' },
      ],
      { imports: [TenantModule] },
    )
    const writes = app.get(ODataWriteRegistry)

    const productHandlers = writes.getHandlers('Products')
    expect(productHandlers).toBeInstanceOf(ProductWrites)
    expect((productHandlers as ProductWrites).tenants.tenantId).toBe('acme')
    expect(writes.getHandlers('Notes')).toBe(noteHandlers)
    expect(writes.getHandlers('Tags')).toBeUndefined()
  })

  it('advertises Core.OptimisticConcurrency from the etag option, @ODataETag or @UpdateDateColumn', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const etagFn = (n: WNote) => n.version
    const app = await boot([
      { entity: WProduct, name: 'Products', requireIfMatch: true },
      { entity: WCategory, name: 'Categories', requireIfMatch: true },
      { entity: WNote, name: 'Notes', etag: etagFn, requireIfMatch: true },
      { entity: WTag, name: 'Tags', etag: 'text', requireIfMatch: true },
    ])
    const edm = app.get(EdmRegistry)
    const writes = app.get(ODataWriteRegistry)

    // @UpdateDateColumn
    expect(edm.getEntitySet('Products')?.optimisticConcurrency).toEqual(['updatedAt'])
    // @ODataETag
    expect(edm.getEntitySet('Categories')?.optimisticConcurrency).toEqual(['revision'])
    // etag function: concurrency is required but no property can be named.
    expect(edm.getEntitySet('Notes')?.optimisticConcurrency).toEqual([])
    // etag property name
    expect(edm.getEntitySet('Tags')?.optimisticConcurrency).toEqual(['text'])

    for (const set of ['Products', 'Categories', 'Notes', 'Tags']) {
      expect(writes.requiresIfMatch(set)).toBe(true)
    }
    expect(writes.getETag('Notes')).toBe(etagFn)
    expect(writes.getETag('Tags')).toBe('text')
    expect(writes.getETag('Products')).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and advertises an empty property list when requireIfMatch has no ETag source', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const app = await boot([{ entity: WTag, name: 'Tags', requireIfMatch: true }])

    expect(app.get(EdmRegistry).getEntitySet('Tags')?.optimisticConcurrency).toEqual([])
    expect(app.get(ODataWriteRegistry).requiresIfMatch('Tags')).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Entity set 'Tags' requires If-Match"),
    )
  })

  it('requireScope: refuses to start when an entity set has no scope', async () => {
    await expect(
      boot(
        [
          { entity: WProduct, name: 'Products', scope: vi.fn() },
          { entity: WTag, name: 'Tags' },
        ],
        {},
        {
          requireScope: true,
        },
      ),
    ).rejects.toThrow(/requireScope is enabled but these entity sets have no row-level scope: Tags/)
  })

  it('requireScope: starts when every entity set is scoped (directly or via defaultScope)', async () => {
    const app = await boot(
      [
        { entity: WProduct, name: 'Products', scope: vi.fn() },
        { entity: WTag, name: 'Tags' },
      ],
      { defaultScope: vi.fn() },
      { requireScope: true },
    )
    const scopes = app.get(ODataScopeRegistry)
    expect(scopes.has('Products')).toBe(true)
    expect(scopes.has('Tags')).toBe(true)
  })
})

describe('ODataTypeOrmModule.forFeature() route paths', () => {
  it('prefixes @ODataController routes and $batch with the serviceRoot, leaving plain controllers alone', () => {
    const feature = ODataTypeOrmModule.forFeature([WProduct], {
      serviceRoot: '/api/v2',
      controllers: [ProductsController, PlainController],
    })

    expect(feature.controllers).toEqual([ProductsController, PlainController])
    expect(Reflect.getMetadata(PATH_METADATA, ProductsController)).toBe('api/v2/Products')
    expect(Reflect.getMetadata(PATH_METADATA, PlainController)).toBeUndefined()
    expect(Reflect.getMetadata(PATH_METADATA, BatchController)).toBe('api/v2')
  })

  it('uses the bare entity-set path when the serviceRoot is empty', () => {
    ODataTypeOrmModule.forFeature([WProduct], {
      serviceRoot: '',
      controllers: [ProductsController],
    })
    expect(Reflect.getMetadata(PATH_METADATA, ProductsController)).toBe('Products')
    expect(Reflect.getMetadata(PATH_METADATA, BatchController)).toBe('')
  })

  it('registers each scope / handlers class once as a provider, and forwards imports', () => {
    const feature = ODataTypeOrmModule.forFeature(
      [
        { entity: WProduct, scope: TenantScope, writeHandlers: ProductWrites },
        { entity: WCategory, scope: TenantScope, writeHandlers: ProductWrites },
      ],
      { defaultScope: TenantScope, imports: [TenantModule] },
    )
    const providers = feature.providers ?? []
    expect(providers.filter((p) => p === TenantScope)).toHaveLength(1)
    expect(providers.filter((p) => p === ProductWrites)).toHaveLength(1)
    expect(feature.imports).toContain(TenantModule)
  })

  it('forRoot() defaults: no changeset runner, empty $batch options, global', () => {
    const root = ODataTypeOrmModule.forRoot()
    expect(root.global).toBe(true)
    const values = (root.providers ?? []).map((p) => (p as { useValue: unknown }).useValue)
    expect(values).toEqual([undefined, {}])
  })
})
