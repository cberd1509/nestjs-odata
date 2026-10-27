/**
 * TypeOrmAutoHandler against a real SQLite database: deep insert failure modes, scoped writes
 * (transaction) and writes inside a `$batch` changeset, and request-time registry errors.
 */
import 'reflect-metadata'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import {
  Column,
  DataSource,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type EntityManager,
} from 'typeorm'
import {
  EdmRegistry,
  runWithODataBatchPart,
  type EdmNavigationProperty,
  type ODataModuleResolvedOptions,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from '../deriver/typeorm-edm-deriver.js'
import { TypeOrmQueryTranslator } from './typeorm-query-translator.js'
import { TypeOrmAutoHandler } from './typeorm-auto-handler.js'
import { ODataScopeRegistry } from '../scope/scope-registry.js'
import { TypeOrmScopeService } from '../scope/typeorm-scope.service.js'
import { ODataWriteRegistry } from '../write/write-registry.js'

@Entity({ name: 'ah_order' })
class Order {
  @PrimaryGeneratedColumn() id!: number
  @Column({ type: 'varchar' }) customer!: string
  @Column({ type: 'varchar', default: 'A' }) owner!: string
  @OneToMany(() => OrderLine, (l) => l.order) lines!: OrderLine[]
}

@Entity({ name: 'ah_line' })
class OrderLine {
  @PrimaryGeneratedColumn() id!: number
  @Column({ type: 'varchar' }) product!: string
  @Column({ type: 'integer', nullable: true }) orderId!: number | null
  @ManyToOne(() => Order, (o) => o.lines) order!: Order
}

/** Child without a TypeORM relation to Order: the FK name comes from the entity-set name. */
@Entity({ name: 'ah_note' })
class Note {
  @PrimaryGeneratedColumn() id!: number
  @Column({ type: 'varchar' }) text!: string
  @Column({ type: 'integer', nullable: true }) orderId!: number | null
}

const options: ODataModuleResolvedOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 100,
  maxExpandDepth: 3,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
  maxDeepInsertDepth: 5,
  requireScope: false,
}

/** Navigation properties added to Order's EDM type on top of the derived ones. */
const extraNavigation: EdmNavigationProperty[] = [
  { name: 'notes', type: 'Collection(Default.Note)', nullable: true, isCollection: true },
  { name: 'phantoms', type: 'Collection(Default.Phantom)', nullable: true, isCollection: true },
]

describe('TypeOrmAutoHandler (SQLite)', () => {
  let ds: DataSource
  let edm: EdmRegistry

  function makeHandler(
    opts: {
      scoped?: boolean
      writes?: ODataWriteRegistry
      options?: Partial<ODataModuleResolvedOptions>
    } = {},
  ): TypeOrmAutoHandler {
    const resolved = { ...options, ...opts.options }
    const registry = new ODataScopeRegistry()
    if (opts.scoped) {
      const ownerA = (
        qb: { andWhere: (s: string, p: object) => unknown },
        ctx: { alias: string },
      ) => qb.andWhere(`${ctx.alias}.owner = :owner`, { owner: 'A' })
      registry.register('Orders', ownerA as never, ownerA)
    }
    const scopes = new TypeOrmScopeService(ds, edm, resolved, registry)
    const repo = ds.getRepository(Order) as never
    const translator = new TypeOrmQueryTranslator(repo, edm, resolved)
    return new TypeOrmAutoHandler(
      translator,
      edm,
      resolved,
      repo,
      undefined,
      ds,
      scopes,
      opts.writes,
    )
  }

  async function expectHttp400(promise: Promise<unknown>, message: RegExp): Promise<void> {
    const err = await promise.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(HttpException)
    expect((err as HttpException).getStatus()).toBe(400)
    expect(JSON.stringify((err as HttpException).getResponse())).toMatch(message)
  }

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Order, OrderLine, Note],
      synchronize: true,
    })
    await ds.initialize()
    edm = new EdmRegistry()
    const classes = [Order, OrderLine, Note]
    const configs = new TypeOrmEdmDeriver('Default', 'skip').deriveEntityTypes(
      classes,
      classes.map((c) => ds.getMetadata(c)),
    )
    for (const config of configs) {
      edm.register(
        {
          name: config.entityTypeName,
          namespace: 'Default',
          properties: config.properties,
          navigationProperties:
            config.entityTypeName === 'Order'
              ? [...config.navigationProperties, ...extraNavigation]
              : config.navigationProperties,
          keyProperties: config.keyProperties,
          isReadOnly: false,
        },
        {
          name: { Order: 'Orders', OrderLine: 'Lines', Note: 'Notes' }[config.entityTypeName]!,
          entityTypeName: config.entityTypeName,
          namespace: 'Default',
          isReadOnly: false,
        },
      )
    }
  })

  beforeEach(async () => {
    await ds.getRepository(OrderLine).clear()
    await ds.getRepository(Note).clear()
    await ds.getRepository(Order).clear()
  })

  afterAll(async () => {
    await ds.destroy()
  })

  describe('deep insert', () => {
    /** Deep insert runs in one transaction, as the controller layer does. */
    const deepCreate = (handler: TypeOrmAutoHandler, body: Record<string, unknown>) =>
      ds.manager.transaction((m) => handler.handleDeepCreate(body, 'Orders', m))

    it('saves children through the TypeORM relation FK', async () => {
      const handler = makeHandler()
      const { entity, locationUrl } = (await deepCreate(handler, {
        customer: 'Ann',
        lines: [{ product: 'pen' }, { product: 'ink' }],
      })) as { entity: Order; locationUrl: string }
      expect(locationUrl).toBe(`/odata/Orders(${entity.id})`)
      const lines = await ds.getRepository(OrderLine).find({ order: { id: 'ASC' } })
      expect(lines.map((l) => [l.product, l.orderId])).toEqual([
        ['pen', entity.id],
        ['ink', entity.id],
      ])
    })

    it('derives the FK from the entity-set name when there is no TypeORM relation', async () => {
      const handler = makeHandler()
      // A client-supplied FK is overridden with the parent key.
      const { entity } = (await deepCreate(handler, {
        customer: 'Bob',
        notes: [{ text: 'fragile', orderId: 999 }],
      })) as { entity: Order }
      const notes = await ds.getRepository(Note).find()
      expect(notes).toEqual([expect.objectContaining({ text: 'fragile', orderId: entity.id })])
    })

    it('answers 400 when a child cannot be saved, naming the failing item', async () => {
      const handler = makeHandler()
      await expectHttp400(
        deepCreate(handler, { customer: 'Cy', lines: [{ product: 'ok' }, {}] }),
        /Deep insert failed at 'lines\[1\]'/,
      )
      // The parent and the first child are rolled back with the failing child.
      expect(await ds.getRepository(Order).count()).toBe(0)
      expect(await ds.getRepository(OrderLine).count()).toBe(0)
    })

    it('answers 400 when the navigation target has no entity set', async () => {
      const handler = makeHandler()
      await expectHttp400(
        deepCreate(handler, { customer: 'Di', phantoms: [{ x: 1 }] }),
        /cannot resolve entity set for navigation property 'phantoms' \(type 'Phantom'\)/,
      )
    })

    it('answers 400 when the child entity set writes through write handlers', async () => {
      const writes = new ODataWriteRegistry()
      const lineHandlers = { create: vi.fn() }
      writes.registerHandlers('Lines', lineHandlers, lineHandlers)
      const handler = makeHandler({ writes })
      await expectHttp400(
        deepCreate(handler, { customer: 'Ed', lines: [{ product: 'x' }] }),
        /Deep insert into 'Lines' is not supported/,
      )
      expect(lineHandlers.create).not.toHaveBeenCalled()
    })
  })

  describe('scoped writes', () => {
    it('updates, replaces and deletes rows inside the scope', async () => {
      const order = await ds.getRepository(Order).save({ customer: 'Fay', owner: 'A' })
      const handler = makeHandler({ scoped: true })

      await handler.handleUpdate(String(order.id), { customer: 'Fay2' }, 'Orders')
      expect((await ds.getRepository(Order).findOneBy({ id: order.id }))?.customer).toBe('Fay2')

      await handler.handleReplace(String(order.id), { customer: 'Fay3', owner: 'A' }, 'Orders')
      expect((await ds.getRepository(Order).findOneBy({ id: order.id }))?.customer).toBe('Fay3')

      await handler.handleDelete(String(order.id), 'Orders')
      expect(await ds.getRepository(Order).findOneBy({ id: order.id })).toBeNull()
    })

    it('answers 404 for a row outside the scope, leaving it unchanged', async () => {
      const order = await ds.getRepository(Order).save({ customer: 'Gus', owner: 'B' })
      const handler = makeHandler({ scoped: true })
      await expect(
        handler.handleUpdate(String(order.id), { customer: 'hacked' }, 'Orders'),
      ).rejects.toMatchObject({ status: 404 })
      await expect(handler.handleDelete(String(order.id), 'Orders')).rejects.toMatchObject({
        status: 404,
      })
      expect((await ds.getRepository(Order).findOneBy({ id: order.id }))?.customer).toBe('Gus')
    })
  })

  describe('inside a $batch changeset', () => {
    async function inChangeset<T>(work: () => Promise<T>, rollback: boolean): Promise<void> {
      await ds.manager
        .transaction(async (manager: EntityManager) => {
          const part = {
            method: 'PATCH',
            url: 'Orders(1)',
            inChangeset: true,
            batchRequest: {},
            changeset: manager,
          }
          await runWithODataBatchPart(part, work)
          if (rollback) throw new Error('rollback')
        })
        .catch((e: unknown) => {
          if (!(e instanceof Error) || e.message !== 'rollback') throw e
        })
    }

    it("writes through the changeset's transaction (rolled back with it)", async () => {
      const order = await ds.getRepository(Order).save({ customer: 'Hal', owner: 'A' })
      const handler = makeHandler({ scoped: true })
      await inChangeset(
        () => handler.handleUpdate(String(order.id), { customer: 'rolled back' }, 'Orders'),
        true,
      )
      expect((await ds.getRepository(Order).findOneBy({ id: order.id }))?.customer).toBe('Hal')

      await inChangeset(
        () => handler.handleUpdate(String(order.id), { customer: 'committed' }, 'Orders'),
        false,
      )
      expect((await ds.getRepository(Order).findOneBy({ id: order.id }))?.customer).toBe(
        'committed',
      )
    })
  })

  describe('reads', () => {
    it('pages with the default maxTop of 1000 when none is configured', async () => {
      await ds.getRepository(Order).save([{ customer: 'a' }, { customer: 'b' }])
      const handler = makeHandler({ options: { maxTop: undefined } })
      const query = { entitySetName: 'Orders', top: 1, skip: 1 } as ODataQuery
      const result = await handler.handleGet(query, '/odata/Orders?$top=1&$skip=1')
      expect(result.items).toHaveLength(1)
      expect(result.nextLink).toBeUndefined()

      const first = await handler.handleGet(
        { entitySetName: 'Orders', top: 1 },
        '/odata/Orders?$top=1',
      )
      expect(first.nextLink).toBe('/odata/Orders?$top=1&$skip=1')
    })

    it('fails clearly for an entity set missing from the EDM registry', async () => {
      const handler = makeHandler()
      await expect(handler.handleGet({ entitySetName: 'Ghosts' }, '/odata/Ghosts')).rejects.toThrow(
        "ODataAutoHandler: entity set 'Ghosts' not found in EdmRegistry",
      )
    })
  })
})
