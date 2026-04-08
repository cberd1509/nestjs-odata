import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import type { SelectQueryBuilder, ObjectLiteral, Repository } from 'typeorm'
import type { EdmEntityType } from '@nestjs-odata/core'
import type { ApplyNode } from '@nestjs-odata/core'
import { TypeOrmApplyVisitor } from './apply-visitor.js'

// ── Mock QueryBuilder ─────────────────────────────────────────────────────────

type MockQb = SelectQueryBuilder<ObjectLiteral> & {
  select: MockInstance
  addSelect: MockInstance
  groupBy: MockInstance
  addGroupBy: MockInstance
  andWhere: MockInstance
}

function makeQb(): MockQb {
  const qb = {
    select: vi.fn().mockImplementation(() => qb),
    addSelect: vi.fn().mockImplementation(() => qb),
    groupBy: vi.fn().mockImplementation(() => qb),
    addGroupBy: vi.fn().mockImplementation(() => qb),
    andWhere: vi.fn().mockImplementation(() => qb),
  }
  return qb as unknown as MockQb
}

function makeEntityType(name = 'Product'): EdmEntityType {
  return {
    name,
    namespace: 'Default',
    properties: [],
    navigationProperties: [],
    keyProperties: [],
    isReadOnly: false,
  }
}

// ── TypeOrmApplyVisitor tests ─────────────────────────────────────────────────

describe('TypeOrmApplyVisitor', () => {
  const alias = 'entity'
  let qb: MockQb
  let entityType: EdmEntityType
  let repo: Repository<ObjectLiteral>

  beforeEach(() => {
    qb = makeQb()
    entityType = makeEntityType()
    repo = {} as Repository<ObjectLiteral>
  })

  function makeVisitor(): TypeOrmApplyVisitor {
    return new TypeOrmApplyVisitor(qb, alias, entityType, 10, 'ansi', repo)
  }

  // ── ApplyAggregateStep ────────────────────────────────────────────────────

  describe('ApplyAggregateStep', () => {
    it('translates sum aggregate to SUM SQL', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Total', method: 'sum', alias: 'GrandTotal' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.select).toHaveBeenCalledWith([])
      expect(qb.addSelect).toHaveBeenCalledWith('SUM(entity.Total)', 'GrandTotal')
    })

    it('translates count with $count property to COUNT(*)', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: '$count', method: 'count', alias: 'OrderCount' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('COUNT(*)', 'OrderCount')
    })

    it('translates count with field property to COUNT(field)', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Id', method: 'count', alias: 'TotalCount' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('COUNT(entity.Id)', 'TotalCount')
    })

    it('translates avg aggregate to AVG SQL', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Price', method: 'avg', alias: 'AvgPrice' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('AVG(entity.Price)', 'AvgPrice')
    })

    it('translates min aggregate to MIN SQL', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Price', method: 'min', alias: 'MinPrice' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('MIN(entity.Price)', 'MinPrice')
    })

    it('translates max aggregate to MAX SQL', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Price', method: 'max', alias: 'MaxPrice' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('MAX(entity.Price)', 'MaxPrice')
    })

    it('translates countdistinct to COUNT(DISTINCT ...)', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [
              { property: 'CustomerId', method: 'countdistinct', alias: 'UniqueCustomers' },
            ],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith(
        'COUNT(DISTINCT entity.CustomerId)',
        'UniqueCustomers',
      )
    })

    it('returns projected alias names from aggregate step', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [
              { property: 'Total', method: 'sum', alias: 'GrandTotal' },
              { property: '$count', method: 'count', alias: 'OrderCount' },
            ],
          },
        ],
      }
      const result = makeVisitor().apply(applyNode)
      expect(result).toEqual(['GrandTotal', 'OrderCount'])
    })

    it('clears existing select before aggregate step', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyAggregate',
            expressions: [{ property: 'Total', method: 'sum', alias: 'GrandTotal' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.select).toHaveBeenCalledWith([])
    })
  })

  // ── ApplyGroupByStep ──────────────────────────────────────────────────────

  describe('ApplyGroupByStep', () => {
    it('translates groupby with single property and aggregate', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyGroupBy',
            properties: ['CustomerId'],
            aggregate: [{ property: '$count', method: 'count', alias: 'Total' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.select).toHaveBeenCalledWith([])
      expect(qb.addSelect).toHaveBeenCalledWith('entity.CustomerId', 'CustomerId')
      expect(qb.addGroupBy).toHaveBeenCalledWith('entity.CustomerId')
      expect(qb.addSelect).toHaveBeenCalledWith('COUNT(*)', 'Total')
    })

    it('translates groupby with two properties', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyGroupBy',
            properties: ['CustomerId', 'Year'],
            aggregate: [{ property: '$count', method: 'count', alias: 'OrderCount' }],
          },
        ],
      }
      makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('entity.CustomerId', 'CustomerId')
      expect(qb.addGroupBy).toHaveBeenCalledWith('entity.CustomerId')
      expect(qb.addSelect).toHaveBeenCalledWith('entity.Year', 'Year')
      expect(qb.addGroupBy).toHaveBeenCalledWith('entity.Year')
    })

    it('returns projected property and alias names from groupby step', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyGroupBy',
            properties: ['CustomerId'],
            aggregate: [{ property: 'Total', method: 'sum', alias: 'GrandTotal' }],
          },
        ],
      }
      const result = makeVisitor().apply(applyNode)
      expect(result).toContain('CustomerId')
      expect(result).toContain('GrandTotal')
    })

    it('handles groupby without aggregate', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyGroupBy',
            properties: ['Category'],
          },
        ],
      }
      const result = makeVisitor().apply(applyNode)
      expect(qb.addSelect).toHaveBeenCalledWith('entity.Category', 'Category')
      expect(qb.addGroupBy).toHaveBeenCalledWith('entity.Category')
      expect(result).toContain('Category')
    })
  })

  // ── ApplyFilterStep ───────────────────────────────────────────────────────

  describe('ApplyFilterStep', () => {
    it('delegates filter step to TypeOrmFilterVisitor which calls andWhere', () => {
      // Using a simple binary eq filter node
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyFilter',
            filter: {
              kind: 'BinaryExpr',
              operator: 'eq',
              left: { kind: 'PropertyAccess', path: ['Status'] },
              right: { kind: 'Literal', literalKind: 'string', value: 'active' },
            },
          },
        ],
      }
      makeVisitor().apply(applyNode)
      // TypeOrmFilterVisitor calls qb.andWhere — verify it was invoked
      expect(qb.andWhere).toHaveBeenCalled()
    })

    it('returns empty array for filter-only step (no projections)', () => {
      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyFilter',
            filter: {
              kind: 'BinaryExpr',
              operator: 'eq',
              left: { kind: 'PropertyAccess', path: ['Status'] },
              right: { kind: 'Literal', literalKind: 'string', value: 'active' },
            },
          },
        ],
      }
      const result = makeVisitor().apply(applyNode)
      expect(result).toEqual([])
    })
  })

  // ── Pipeline: filter then groupby ─────────────────────────────────────────

  describe('filter then groupby pipeline', () => {
    it('applies filter WHERE before groupby SELECT and GROUP BY', () => {
      const calls: string[] = []
      const orderTrackingQb = {
        select: vi.fn().mockImplementation(() => {
          calls.push('select')
          return orderTrackingQb
        }),
        addSelect: vi.fn().mockImplementation(() => {
          calls.push('addSelect')
          return orderTrackingQb
        }),
        groupBy: vi.fn().mockImplementation(() => {
          calls.push('groupBy')
          return orderTrackingQb
        }),
        addGroupBy: vi.fn().mockImplementation(() => {
          calls.push('addGroupBy')
          return orderTrackingQb
        }),
        andWhere: vi.fn().mockImplementation(() => {
          calls.push('andWhere')
          return orderTrackingQb
        }),
      } as unknown as MockQb

      const applyNode: ApplyNode = {
        steps: [
          {
            kind: 'ApplyFilter',
            filter: {
              kind: 'BinaryExpr',
              operator: 'gt',
              left: { kind: 'PropertyAccess', path: ['Total'] },
              right: { kind: 'Literal', literalKind: 'number', value: 100 },
            },
          },
          {
            kind: 'ApplyGroupBy',
            properties: ['CustomerId'],
            aggregate: [{ property: '$count', method: 'count', alias: 'OrderCount' }],
          },
        ],
      }

      const visitor = new TypeOrmApplyVisitor(orderTrackingQb, alias, entityType, 10, 'ansi', repo)
      visitor.apply(applyNode)

      const andWhereIdx = calls.indexOf('andWhere')
      const selectIdx = calls.indexOf('select')
      expect(andWhereIdx).toBeLessThan(selectIdx)
    })
  })
})
