import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import type { SelectQueryBuilder } from 'typeorm'
import type { BinaryExprNode, FunctionCallNode, UnaryExprNode } from '@nestjs-odata/core'
import type { EdmEntityType } from '@nestjs-odata/core'

type MockQb = SelectQueryBuilder<never> & {
  andWhere: MockInstance
  orWhere: MockInstance
  _conditions: string[]
  _params: Record<string, unknown>
}

function makeQb(): MockQb {
  const params: Record<string, unknown> = {}
  const conditions: string[] = []
  const qb = {
    andWhere: vi.fn().mockImplementation((condition: string, p?: Record<string, unknown>) => {
      conditions.push(condition)
      if (p) Object.assign(params, p)
      return qb
    }),
    orWhere: vi.fn().mockImplementation((condition: string, p?: Record<string, unknown>) => {
      conditions.push(condition)
      if (p) Object.assign(params, p)
      return qb
    }),
    _conditions: conditions,
    _params: params,
  } as unknown as MockQb
  return qb
}

const entityType: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  properties: [
    { name: 'Id', edmType: 'Edm.Int32', isNullable: false, isCollection: false },
    { name: 'Name', edmType: 'Edm.String', isNullable: true, isCollection: false },
    { name: 'Price', edmType: 'Edm.Decimal', isNullable: true, isCollection: false },
    { name: 'Active', edmType: 'Edm.Boolean', isNullable: true, isCollection: false },
  ],
  navigationProperties: [],
  keyProperties: ['Id'],
  isReadOnly: false,
}

describe('TypeOrmFilterVisitor', () => {
  let qb: MockQb

  beforeEach(() => {
    qb = makeQb()
  })

  describe('comparison operators', () => {
    it('translates eq to = with parameterized value', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'eq',
        left: { kind: 'PropertyAccess', path: ['Price'] },
        right: { kind: 'Literal', literalKind: 'number', value: 5 },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Price = :p1', { p1: 5 })
    })

    it('translates gt to > with parameterized value', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'gt',
        left: { kind: 'PropertyAccess', path: ['Price'] },
        right: { kind: 'Literal', literalKind: 'number', value: 5 },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Price > :p1', { p1: 5 })
    })

    it('translates ge to >= with parameterized value', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'ge',
        left: { kind: 'PropertyAccess', path: ['Price'] },
        right: { kind: 'Literal', literalKind: 'number', value: 10 },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Price >= :p1', { p1: 10 })
    })

    it('translates lt to <', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'lt',
        left: { kind: 'PropertyAccess', path: ['Price'] },
        right: { kind: 'Literal', literalKind: 'number', value: 100 },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Price < :p1', { p1: 100 })
    })

    it('translates le to <=', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'le',
        left: { kind: 'PropertyAccess', path: ['Price'] },
        right: { kind: 'Literal', literalKind: 'number', value: 50 },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Price <= :p1', { p1: 50 })
    })

    it('translates ne to !=', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'ne',
        left: { kind: 'PropertyAccess', path: ['Name'] },
        right: { kind: 'Literal', literalKind: 'string', value: 'Widget' },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Name != :p1', { p1: 'Widget' })
    })

    it('parameterizes string literal — no raw value in query string', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'eq',
        left: { kind: 'PropertyAccess', path: ['Name'] },
        right: { kind: 'Literal', literalKind: 'string', value: 'Widget' },
      }
      visitor.visit(node)
      const andWhereMock = qb.andWhere
      const sql = andWhereMock.mock.calls[0][0] as string
      expect(sql).not.toContain('Widget')
      expect(sql).toContain(':p')
    })
  })

  describe('logical operators', () => {
    it('translates and with two andWhere calls and unique param names', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'and',
        left: {
          kind: 'BinaryExpr',
          operator: 'gt',
          left: { kind: 'PropertyAccess', path: ['Price'] },
          right: { kind: 'Literal', literalKind: 'number', value: 5 },
        },
        right: {
          kind: 'BinaryExpr',
          operator: 'eq',
          left: { kind: 'PropertyAccess', path: ['Active'] },
          right: { kind: 'Literal', literalKind: 'boolean', value: true },
        },
      }
      visitor.visit(node)
      const andWhereMock = qb.andWhere
      expect(andWhereMock).toHaveBeenCalledTimes(2)
      const calls = andWhereMock.mock.calls
      expect(calls[0][0]).toContain(':p1')
      expect(calls[1][0]).toContain(':p2')
      expect(calls[0][1]).not.toEqual(calls[1][1])
    })

    it('translates not with NOT(...) wrapping', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: UnaryExprNode = {
        kind: 'UnaryExpr',
        operator: 'not',
        operand: {
          kind: 'BinaryExpr',
          operator: 'eq',
          left: { kind: 'PropertyAccess', path: ['Active'] },
          right: { kind: 'Literal', literalKind: 'boolean', value: true },
        },
      }
      visitor.visit(node)
      const andWhereMock = qb.andWhere
      expect(andWhereMock).toHaveBeenCalledTimes(1)
      const call = andWhereMock.mock.calls[0]
      expect(call[0]).toMatch(/NOT\s*\(/)
    })
  })

  describe('string functions', () => {
    it('translates contains() to LIKE %value%', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: FunctionCallNode = {
        kind: 'FunctionCall',
        name: 'contains',
        args: [
          { kind: 'PropertyAccess', path: ['Name'] },
          { kind: 'Literal', literalKind: 'string', value: 'widget' },
        ],
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Name LIKE :p1', { p1: '%widget%' })
    })

    it('translates startswith() to LIKE value%', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: FunctionCallNode = {
        kind: 'FunctionCall',
        name: 'startswith',
        args: [
          { kind: 'PropertyAccess', path: ['Name'] },
          { kind: 'Literal', literalKind: 'string', value: 'Wid' },
        ],
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Name LIKE :p1', { p1: 'Wid%' })
    })

    it('translates endswith() to LIKE %value', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: FunctionCallNode = {
        kind: 'FunctionCall',
        name: 'endswith',
        args: [
          { kind: 'PropertyAccess', path: ['Name'] },
          { kind: 'Literal', literalKind: 'string', value: 'get' },
        ],
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Name LIKE :p1', { p1: '%get' })
    })

    it('escapes LIKE special characters in contains() — % becomes \\%', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: FunctionCallNode = {
        kind: 'FunctionCall',
        name: 'contains',
        args: [
          { kind: 'PropertyAccess', path: ['Name'] },
          { kind: 'Literal', literalKind: 'string', value: 'widget%special' },
        ],
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Name LIKE :p1', { p1: '%widget\\%special%' })
    })

    it('escapes LIKE underscore in contains() — _ becomes \\_', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: FunctionCallNode = {
        kind: 'FunctionCall',
        name: 'contains',
        args: [
          { kind: 'PropertyAccess', path: ['Name'] },
          { kind: 'Literal', literalKind: 'string', value: 'wid_get' },
        ],
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('entity.Name LIKE :p1', { p1: '%wid\\_get%' })
    })
  })

  describe('scalar functions', () => {
    it('translates length() to LENGTH(alias.prop)', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'gt',
        left: {
          kind: 'FunctionCall',
          name: 'length',
          args: [{ kind: 'PropertyAccess', path: ['Name'] }],
        },
        right: { kind: 'Literal', literalKind: 'number', value: 5 },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('LENGTH(entity.Name) > :p1', { p1: 5 })
    })

    it('translates tolower() to LOWER(alias.prop)', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'eq',
        left: {
          kind: 'FunctionCall',
          name: 'tolower',
          args: [{ kind: 'PropertyAccess', path: ['Name'] }],
        },
        right: { kind: 'Literal', literalKind: 'string', value: 'widget' },
      }
      visitor.visit(node)
      expect(qb.andWhere).toHaveBeenCalledWith('LOWER(entity.Name) = :p1', { p1: 'widget' })
    })
  })

  describe('parameter uniqueness', () => {
    it('uses unique :pN names across complex filter — no collisions', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'and',
        left: {
          kind: 'BinaryExpr',
          operator: 'gt',
          left: { kind: 'PropertyAccess', path: ['Price'] },
          right: { kind: 'Literal', literalKind: 'number', value: 5 },
        },
        right: {
          kind: 'BinaryExpr',
          operator: 'eq',
          left: { kind: 'PropertyAccess', path: ['Name'] },
          right: { kind: 'Literal', literalKind: 'string', value: 'Widget' },
        },
      }
      visitor.visit(node)
      const andWhereMock = qb.andWhere
      const paramKeys = andWhereMock.mock.calls.flatMap((c: unknown[]) =>
        Object.keys((c[1] as Record<string, unknown>) ?? {}),
      )
      const uniqueKeys = new Set(paramKeys)
      expect(uniqueKeys.size).toBe(paramKeys.length)
    })
  })

  describe('security — parameterized queries', () => {
    it('SECURITY: no raw literal values appear in the SQL condition string', () => {
      const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType)
      const rawValue = 'dangerous-input-123'
      const node: BinaryExprNode = {
        kind: 'BinaryExpr',
        operator: 'eq',
        left: { kind: 'PropertyAccess', path: ['Name'] },
        right: { kind: 'Literal', literalKind: 'string', value: rawValue },
      }
      visitor.visit(node)
      const andWhereMock = qb.andWhere
      const sqlCondition = andWhereMock.mock.calls[0][0] as string
      expect(sqlCondition).not.toContain(rawValue)
      expect(sqlCondition).toMatch(/:p\d+/)
    })
  })
})
