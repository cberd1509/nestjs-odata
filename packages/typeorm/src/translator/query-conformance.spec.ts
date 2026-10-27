/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// Hydrated entities are untyped rows here (`Row`).
/**
 * OData 4.01 query conformance of the TypeORM translator, run end to end (query pipe →
 * scopes → translator → SQLite):
 *   - #66 `$filter` on single-valued navigation paths, scoped
 *   - #68 `ANY`/`ALL` and `$it`
 *   - #69 nested `$expand` `$count`, `nav/$count`, `$search`
 *   - #72 lambdas over many-to-many navigations, scoped
 *   - #74 nested `$top`/`$skip` in SQL (ROW_NUMBER), keyed by expand path
 *
 * Fixture: regions → stores → items, items ↔ labels (many-to-many). Regions, items and labels
 * have an `owner`; the scope shows a caller only their own rows (stores are unscoped).
 */
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm'
import {
  EdmRegistry,
  ODataQueryPipe,
  ODataSearchable,
  runWithODataRequestContext,
  type ODataModuleResolvedOptions,
  type ODataQueryResult,
} from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from '../deriver/typeorm-edm-deriver.js'
import { TypeOrmQueryTranslator } from './typeorm-query-translator.js'
import { TypeOrmAutoHandler } from './typeorm-auto-handler.js'
import { TypeOrmSearchProvider } from './search-provider.js'
import { ODataScopeRegistry } from '../scope/scope-registry.js'
import { TypeOrmScopeService } from '../scope/typeorm-scope.service.js'
import type { ODataScopeFn } from '../scope/scope.types.js'

@Entity({ name: 'qc_region' })
class Region {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  name: string

  @Column({ type: 'varchar' })
  owner: string

  @OneToMany(() => Store, (s) => s.region)
  stores: Store[]
}

@Entity({ name: 'qc_store' })
class Store {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  name: string

  @Column({ type: 'integer' })
  minQty: number

  @Column({ type: 'integer', nullable: true })
  regionId: number | null

  @ManyToOne(() => Region, (r) => r.stores)
  region: Region

  @OneToMany(() => Item, (i) => i.store)
  items: Item[]
}

@Entity({ name: 'qc_item' })
class Item {
  @PrimaryGeneratedColumn()
  id: number

  @ODataSearchable()
  @Column({ type: 'varchar' })
  title: string

  @Column({ type: 'integer' })
  qty: number

  @Column({ type: 'varchar' })
  owner: string

  @Column({ type: 'integer' })
  storeId: number

  @ManyToOne(() => Store, (s) => s.items)
  store: Store

  @ManyToMany(() => Label, (l) => l.items)
  @JoinTable({ name: 'qc_item_labels' })
  labels: Label[]
}

@Entity({ name: 'qc_label' })
class Label {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  name: string

  @Column({ type: 'varchar' })
  owner: string

  @ManyToMany(() => Item, (i) => i.labels)
  items: Item[]
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

const ownerScope: ODataScopeFn = (qb, ctx) => {
  const owner = (ctx.request as { owner?: string } | undefined)?.owner
  qb.andWhere(`${ctx.alias}.owner = :owner`, { owner: owner ?? '' })
}

type Row = Record<string, any>

describe('OData query conformance (TypeORM, SQLite)', () => {
  let dataSource: DataSource
  let edm: EdmRegistry
  let pipe: ODataQueryPipe
  let translator: TypeOrmQueryTranslator
  let handler: TypeOrmAutoHandler

  /** Run `GET /<set>?<query>` as `owner` (A sees everything of A, B of B). */
  async function get(
    set: string,
    query: Record<string, string>,
    owner = 'A',
    opts: { requireScope?: boolean } = {},
  ): Promise<Row[]> {
    const parsed = pipe.transform(query, { type: 'query', data: set })
    const h = opts.requireScope ? makeHandler({ ...options, requireScope: true }) : handler
    const result: ODataQueryResult = await runWithODataRequestContext({ request: { owner } }, () =>
      h.handleGet(parsed, `/odata/${set}`),
    )
    return result.items as Row[]
  }

  const ids = (rows: Row[]) => rows.map((r) => r.id as number).sort((a, b) => a - b)

  function makeHandler(resolved: ODataModuleResolvedOptions): TypeOrmAutoHandler {
    const registry = new ODataScopeRegistry()
    for (const set of ['Regions', 'Items', 'Labels']) registry.register(set, ownerScope, ownerScope)
    // Stores are unscoped; under requireScope they get an allow-all scope.
    if (resolved.requireScope)
      registry.register(
        'Stores',
        () => {},
        () => {},
      )
    const scopes = new TypeOrmScopeService(dataSource, edm, resolved, registry)
    const repo = dataSource.getRepository(Store) as never
    const search = new TypeOrmSearchProvider(dataSource, edm)
    const t = new TypeOrmQueryTranslator(repo, edm, resolved, search)
    return new TypeOrmAutoHandler(t, edm, resolved, repo, undefined, dataSource, scopes)
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Region, Store, Item, Label],
      synchronize: true,
    })
    await dataSource.initialize()
    edm = new EdmRegistry()
    const classes = [Region, Store, Item, Label]
    const configs = new TypeOrmEdmDeriver('Default', 'skip').deriveEntityTypes(
      classes,
      classes.map((c) => dataSource.getMetadata(c)),
    )
    for (const config of configs) {
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
    pipe = new ODataQueryPipe(edm, options)
    handler = makeHandler(options)
    translator = (handler as unknown as { translator: TypeOrmQueryTranslator }).translator

    await dataSource.getRepository(Region).save([
      { id: 1, name: 'North', owner: 'A' },
      { id: 2, name: 'South', owner: 'B' },
    ])
    await dataSource.getRepository(Store).save([
      { id: 1, name: 'S1', minQty: 5, regionId: 1 },
      { id: 2, name: 'S2', minQty: 50, regionId: 2 },
      { id: 3, name: 'S3', minQty: 1, regionId: null },
    ])
    await dataSource.getRepository(Label).save([
      { id: 1, name: 'sale', owner: 'A' },
      { id: 2, name: 'new', owner: 'A' },
      { id: 3, name: 'sale', owner: 'B' },
    ])
    const items = dataSource.getRepository(Item)
    await items.save([
      { id: 1, title: 'apple', qty: 10, owner: 'A', storeId: 1, labels: [{ id: 1 }, { id: 2 }] },
      { id: 2, title: 'banana', qty: 3, owner: 'A', storeId: 1, labels: [{ id: 2 }] },
      { id: 3, title: 'apple pie', qty: 7, owner: 'A', storeId: 1, labels: [] },
      { id: 4, title: 'cherry', qty: 20, owner: 'B', storeId: 1, labels: [{ id: 3 }] },
      { id: 5, title: 'apple', qty: 60, owner: 'A', storeId: 2, labels: [{ id: 1 }, { id: 3 }] },
      { id: 6, title: 'damson', qty: 2, owner: 'A', storeId: 3, labels: [] },
    ])
  })

  afterAll(async () => {
    await dataSource.destroy()
  })

  describe('#66 navigation paths in $filter', () => {
    it('filters on a single-valued navigation property', async () => {
      expect(ids(await get('Items', { $filter: "store/name eq 'S1'" }))).toEqual([1, 2, 3])
    })

    it('follows several single-valued navigation properties', async () => {
      expect(ids(await get('Items', { $filter: "store/region/name eq 'North'" }))).toEqual([
        1, 2, 3,
      ])
    })

    it('applies the row-level scope of the navigation target', async () => {
      // Region 1 (North) belongs to A: B cannot reach it through store/region.
      expect(await get('Stores', { $filter: "region/name eq 'North'" }, 'B')).toEqual([])
      expect(ids(await get('Stores', { $filter: "region/name eq 'North'" }, 'A'))).toEqual([1])
    })

    it('works inside or, not and functions', async () => {
      expect(ids(await get('Items', { $filter: "store/name eq 'S2' or qty lt 3" }))).toEqual([5, 6])
      expect(ids(await get('Items', { $filter: "not (store/name eq 'S1')" }))).toEqual([5, 6])
      expect(ids(await get('Items', { $filter: "contains(store/name, '3')" }))).toEqual([6])
    })

    it('works inside lambda predicates, after the range variable and for the outer entity', async () => {
      expect(
        ids(await get('Regions', { $filter: "stores/any(s: s/region/name eq 'North')" })),
      ).toEqual([1])
      expect(ids(await get('Labels', { $filter: "items/any(i: i/store/name eq 'S2')" }))).toEqual([
        1,
      ])
    })

    it('works in nested $expand filters', async () => {
      const [store] = await get('Stores', {
        $filter: 'id eq 1',
        $expand: "items($filter=store/region/name eq 'North')",
      })
      expect(ids(store.items as Row[])).toEqual([1, 2, 3])
    })

    it('prepares every scope it uses under requireScope', async () => {
      const rows = await get('Items', { $filter: "store/region/name eq 'North'" }, 'A', {
        requireScope: true,
      })
      expect(ids(rows)).toEqual([1, 2, 3])
    })
  })

  describe('$filter null comparisons and property comparisons', () => {
    it('renders eq null / ne null as IS NULL / IS NOT NULL, also on navigation paths', async () => {
      expect(ids(await get('Stores', { $filter: 'regionId eq null' }))).toEqual([3])
      expect(ids(await get('Stores', { $filter: 'regionId ne null' }))).toEqual([1, 2])
      // Region 2 is B's: for A, store 2's region is outside the scope and reads as null.
      expect(ids(await get('Stores', { $filter: 'region/name eq null' }, 'A'))).toEqual([2, 3])
      expect(
        ids(await get('Regions', { $filter: 'stores/any(s: s/regionId ne null)' }, 'A')),
      ).toEqual([1])
    })

    it('compares two properties', async () => {
      expect(ids(await get('Items', { $filter: 'qty gt storeId mul 5' }))).toEqual([1, 3, 5])
      expect(ids(await get('Stores', { $filter: 'minQty gt $it/id' }))).toEqual([1, 2])
    })
  })

  describe('$filter or', () => {
    it('matches rows satisfying either side (not both)', async () => {
      expect(ids(await get('Items', { $filter: 'qty lt 3 or qty gt 50' }))).toEqual([5, 6])
      expect(
        ids(await get('Items', { $filter: "(qty lt 3 or qty gt 50) and title eq 'apple'" })),
      ).toEqual([5])
    })
  })

  describe('#68 lambda operator case and $it', () => {
    it('accepts ANY and ALL', async () => {
      expect(ids(await get('Stores', { $filter: 'items/ANY(i: i/qty gt 15)' }))).toEqual([2])
      expect(ids(await get('Stores', { $filter: 'items/ALL(i: i/qty gt 5)' }))).toEqual([2])
    })

    it('negates a lambda with not', async () => {
      expect(ids(await get('Stores', { $filter: 'not items/any(i: i/qty gt 15)' }))).toEqual([1, 3])
      expect(
        ids(await get('Items', { $filter: "not labels/any(l: l/name eq 'sale') and qty gt 2" })),
      ).toEqual([2, 3])
    })

    it('binds $it to the outer entity inside a lambda', async () => {
      // Stores with an item whose qty exceeds the store's own minQty.
      expect(ids(await get('Stores', { $filter: 'items/any(i: i/qty gt $it/minQty)' }))).toEqual([
        1, 2, 3,
      ])
      expect(
        ids(await get('Stores', { $filter: 'items/any(i: i/qty gt $it/minQty add 5)' })),
      ).toEqual([2])
    })
  })

  describe('#72 lambdas over many-to-many navigations', () => {
    it('any over the owning side', async () => {
      expect(ids(await get('Items', { $filter: "labels/any(l: l/name eq 'sale')" }))).toEqual([
        1, 5,
      ])
    })

    it('any over the inverse side', async () => {
      expect(ids(await get('Labels', { $filter: 'items/any(i: i/qty gt 50)' }))).toEqual([1])
    })

    it('any() and all()', async () => {
      expect(ids(await get('Items', { $filter: 'labels/any()' }))).toEqual([1, 2, 5])
      expect(ids(await get('Items', { $filter: "labels/all(l: l/name eq 'new')" }))).toEqual([
        2, 3, 6,
      ])
    })

    it('applies the row-level scope of the target', async () => {
      // Item 4 only has B's 'sale' label: A does not see it through the lambda.
      expect(ids(await get('Items', { $filter: "labels/any(l: l/name eq 'sale')" }, 'A'))).toEqual([
        1, 5,
      ])
      expect(ids(await get('Items', { $filter: "labels/any(l: l/name eq 'sale')" }, 'B'))).toEqual([
        4,
      ])
    })
  })

  describe('#69 nested $expand $count, /$count and $search', () => {
    it('annotates the expanded collection with its scoped, filtered count', async () => {
      const [s1] = await get('Stores', {
        $filter: 'id eq 1',
        $expand: 'items($count=true;$top=1;$filter=qty gt 2)',
      })
      // Items 1, 2, 3 are A's (item 4 is B's); $top does not affect the count.
      expect(s1['items@odata.count']).toBe(3)
      expect(s1.items).toHaveLength(1)
    })

    it('answers nav/$count with the count only', async () => {
      const stores = await get('Stores', { $expand: 'items/$count', $orderby: 'id' })
      expect(stores.map((s) => s['items@odata.count'])).toEqual([3, 1, 1])
      expect(stores[0].items).toBeUndefined()
      const filtered = await get('Stores', {
        $filter: 'id eq 1',
        $expand: 'items/$count($filter=qty gt 5)',
      })
      expect(filtered[0]['items@odata.count']).toBe(2)
    })

    it('counts many-to-many and nested expands', async () => {
      const [item] = await get('Items', { $filter: 'id eq 5', $expand: 'labels($count=true)' })
      expect(item['labels@odata.count']).toBe(1) // label 3 is B's
      const [region] = await get('Regions', {
        $filter: 'id eq 1',
        $expand: 'stores($expand=items($count=true))',
      })
      expect(region.stores[0]['items@odata.count']).toBe(3)
    })

    it('applies a nested $search', async () => {
      const [s1] = await get('Stores', {
        $filter: 'id eq 1',
        $expand: 'items($search=apple;$count=true)',
      })
      expect(ids(s1.items as Row[])).toEqual([1, 3])
      expect(s1['items@odata.count']).toBe(2)
    })
  })

  describe('#74 nested $top/$skip', () => {
    it('pages one-to-many expansions in SQL with ROW_NUMBER()', async () => {
      const parsed = pipe.transform(
        { $expand: 'items($top=1;$skip=1;$orderby=qty desc)' },
        { type: 'query', data: 'Stores' },
      )
      const repo = dataSource.getRepository(Store) as never
      const result = translator.translate(parsed, edm.getEntityType('Store')!, repo)
      expect(result.qb.getQuery()).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY/)
      expect(result.expandPaginationMap.size).toBe(0)

      const stores = await get('Stores', {
        $orderby: 'id',
        $expand: 'items($top=1;$skip=1;$orderby=qty desc)',
      })
      // Store 1, A's items by qty desc: 10 (1), 7 (3), 3 (2) → the second is item 3.
      expect(stores.map((s) => ids(s.items as Row[]))).toEqual([[3], [], []])
    })

    it('ranks only the rows inside the scope and the nested filter', async () => {
      const [s1] = await get('Stores', {
        $filter: 'id eq 1',
        $expand: 'items($top=2;$orderby=qty desc;$filter=qty lt 10)',
      })
      expect(ids(s1.items as Row[])).toEqual([2, 3])
      const [b] = await get('Stores', { $filter: 'id eq 1', $expand: 'items($top=1)' }, 'B')
      expect(ids(b.items as Row[])).toEqual([4])
    })

    it('keys paging by expand path, not navigation name', async () => {
      const [item] = await get('Items', {
        $filter: 'id eq 1',
        $expand:
          'store($expand=items($top=1;$orderby=qty desc)),labels($expand=items($top=2;$orderby=id))',
      })
      expect(ids(item.store.items as Row[])).toEqual([1])
      // Many-to-many paging falls back to in-memory slicing.
      const sale = (item.labels as Row[]).find((l) => l.id === 1)!
      expect(ids(sale.items as Row[])).toEqual([1, 5])
      const fresh = (item.labels as Row[]).find((l) => l.id === 2)!
      expect(ids(fresh.items as Row[])).toEqual([1, 2])
    })
  })
})
