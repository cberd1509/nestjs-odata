import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Column, DataSource, Entity, PrimaryColumn, type SelectQueryBuilder } from 'typeorm'
import { applyExpandCounts } from './expand-count.js'
import { entitiesAt } from './expand-pagination.js'

/** Order line with a composite key (orderId, lineNo); each has zero or more shipments. */
@Entity({ name: 'ec_line' })
class Line {
  @PrimaryColumn({ type: 'integer' }) orderId!: number
  @PrimaryColumn({ type: 'integer' }) lineNo!: number
}

@Entity({ name: 'ec_shipment' })
class Shipment {
  @PrimaryColumn({ type: 'integer' }) id!: number
  @Column({ type: 'integer' }) orderId!: number
  @Column({ type: 'integer' }) lineNo!: number
}

describe('entitiesAt', () => {
  it('follows single values and collections, skipping null and scalar values', () => {
    const items = [
      { id: 1, store: { id: 10, items: [{ id: 100 }, { id: 101 }] } },
      { id: 2, store: null },
      { id: 3, store: 'not an entity' },
      { id: 4, store: { id: 11, items: [] } },
    ]
    expect(entitiesAt(items, [])).toEqual(items)
    expect(entitiesAt(items, ['store']).map((s): unknown => s.id)).toEqual([10, 11])
    expect(entitiesAt(items, ['store', 'items']).map((i): unknown => i.id)).toEqual([100, 101])
  })
})

describe('applyExpandCounts', () => {
  let ds: DataSource

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Line, Shipment],
      synchronize: true,
    })
    await ds.initialize()
    await ds.getRepository(Line).save([
      { orderId: 1, lineNo: 1 },
      { orderId: 1, lineNo: 2 },
      { orderId: 2, lineNo: 1 },
    ])
    await ds.getRepository(Shipment).save([
      { id: 1, orderId: 1, lineNo: 1 },
      { id: 2, orderId: 1, lineNo: 1 },
      { id: 3, orderId: 2, lineNo: 1 },
      // Belongs to a line that is not in the result: must not leak into the counts.
      { id: 4, orderId: 9, lineNo: 9 },
    ])
  })

  afterAll(async () => {
    await ds.destroy()
  })

  function countQuery(): SelectQueryBuilder<Line> {
    return ds
      .getRepository(Line)
      .createQueryBuilder('l')
      .select('l.orderId', 'odata_key0')
      .addSelect('l.lineNo', 'odata_key1')
      .addSelect('COUNT(*)', 'odata_count')
      .innerJoin(Shipment, 's', 's.orderId = l.orderId AND s.lineNo = l.lineNo')
      .groupBy('l.orderId')
      .addGroupBy('l.lineNo')
  }

  it('counts per composite-key parent, with 0 for parents without related rows', async () => {
    const lines: Record<string, unknown>[] = [
      { orderId: 1, lineNo: 1 },
      { orderId: 1, lineNo: 2 },
      { orderId: 2, lineNo: 1 },
    ]
    await applyExpandCounts(lines, [
      { path: ['shipments'], alias: 'l', keyProperties: ['orderId', 'lineNo'], qb: countQuery() },
    ])
    expect(lines.map((l) => l['shipments@odata.count'])).toEqual([2, 0, 1])
  })

  it('restricts the count query to the parents in the result', async () => {
    const qb = countQuery()
    const lines: Record<string, unknown>[] = [{ orderId: 2, lineNo: 1 }]
    await applyExpandCounts(lines, [
      { path: ['shipments'], alias: 'l', keyProperties: ['orderId', 'lineNo'], qb },
    ])
    expect(lines[0]['shipments@odata.count']).toBe(1)
    expect(qb.getParameters()).toEqual({ odata_count_k0_0: 2, odata_count_k0_1: 1 })
  })

  it('does not run the query when there are no parents at the expand path', async () => {
    const qb = { getRawMany: vi.fn(), andWhere: vi.fn() }
    await applyExpandCounts(
      [{ id: 1, order: null }],
      [{ path: ['order', 'lines'], alias: 'o', keyProperties: ['id'], qb: qb as never }],
    )
    expect(qb.getRawMany).not.toHaveBeenCalled()
    expect(qb.andWhere).not.toHaveBeenCalled()
  })
})
