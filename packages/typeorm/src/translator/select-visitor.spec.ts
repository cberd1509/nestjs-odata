import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { TypeOrmSelectVisitor } from './select-visitor.js'
import type { SelectQueryBuilder } from 'typeorm'
import type { EdmEntityType, SelectNode } from '@nestjs-odata/core'

type MockQb = SelectQueryBuilder<never> & { select: MockInstance }

function makeQb(): MockQb {
  return {
    select: vi.fn().mockReturnThis(),
  } as unknown as MockQb
}

const entityType: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  properties: [
    { name: 'Id', edmType: 'Edm.Int32', isNullable: false, isCollection: false },
    { name: 'Name', edmType: 'Edm.String', isNullable: true, isCollection: false },
    { name: 'Price', edmType: 'Edm.Decimal', isNullable: true, isCollection: false },
  ],
  navigationProperties: [],
  keyProperties: ['Id'],
  isReadOnly: false,
}

describe('TypeOrmSelectVisitor', () => {
  let qb: MockQb

  beforeEach(() => {
    qb = makeQb()
  })

  it('translates $select=Name,Price to qb.select() with those columns', () => {
    const visitor = new TypeOrmSelectVisitor(qb, 'entity', entityType)
    const select: SelectNode = {
      items: [{ path: ['Name'] }, { path: ['Price'] }],
    }
    visitor.apply(select)
    const selectMock = qb.select
    expect(selectMock).toHaveBeenCalledTimes(1)
    const cols = selectMock.mock.calls[0][0] as string[]
    expect(cols).toContain('entity.Name')
    expect(cols).toContain('entity.Price')
  })

  it('always includes key properties in $select', () => {
    const visitor = new TypeOrmSelectVisitor(qb, 'entity', entityType)
    const select: SelectNode = {
      items: [{ path: ['Name'] }],
    }
    visitor.apply(select)
    const selectMock = qb.select
    const cols = selectMock.mock.calls[0][0] as string[]
    expect(cols).toContain('entity.Id')
  })

  it('deduplicates columns when key is already in select items', () => {
    const visitor = new TypeOrmSelectVisitor(qb, 'entity', entityType)
    const select: SelectNode = {
      items: [{ path: ['Id'] }, { path: ['Name'] }],
    }
    visitor.apply(select)
    const selectMock = qb.select
    const cols = selectMock.mock.calls[0][0] as string[]
    const idCount = cols.filter((c) => c === 'entity.Id').length
    expect(idCount).toBe(1)
  })

  it('does not call qb.select() when select.all is true', () => {
    const visitor = new TypeOrmSelectVisitor(qb, 'entity', entityType)
    const select: SelectNode = { all: true }
    visitor.apply(select)
    expect(qb.select).not.toHaveBeenCalled()
  })

  it('does not call qb.select() when select.items is empty', () => {
    const visitor = new TypeOrmSelectVisitor(qb, 'entity', entityType)
    const select: SelectNode = { items: [] }
    visitor.apply(select)
    expect(qb.select).not.toHaveBeenCalled()
  })

  it('does not call qb.select() when select.items is undefined', () => {
    const visitor = new TypeOrmSelectVisitor(qb, 'entity', entityType)
    const select: SelectNode = {}
    visitor.apply(select)
    expect(qb.select).not.toHaveBeenCalled()
  })
})
