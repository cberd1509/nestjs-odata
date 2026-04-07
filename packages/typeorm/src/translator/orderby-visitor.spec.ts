import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { TypeOrmOrderByVisitor } from './orderby-visitor.js'
import type { SelectQueryBuilder } from 'typeorm'
import type { OrderByItem } from '@nestjs-odata/core'

type MockQb = SelectQueryBuilder<never> & {
  orderBy: MockInstance
  addOrderBy: MockInstance
}

function makeQb(): MockQb {
  return {
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
  } as unknown as MockQb
}

describe('TypeOrmOrderByVisitor', () => {
  let qb: MockQb

  beforeEach(() => {
    qb = makeQb()
  })

  it('translates single $orderby asc to qb.orderBy()', () => {
    const visitor = new TypeOrmOrderByVisitor(qb, 'entity')
    const items: OrderByItem[] = [
      { expression: { kind: 'PropertyAccess', path: ['Name'] }, direction: 'asc' },
    ]
    visitor.apply(items)
    expect(qb.orderBy).toHaveBeenCalledWith('entity.Name', 'ASC')
    expect(qb.addOrderBy).not.toHaveBeenCalled()
  })

  it('translates single $orderby desc to qb.orderBy()', () => {
    const visitor = new TypeOrmOrderByVisitor(qb, 'entity')
    const items: OrderByItem[] = [
      { expression: { kind: 'PropertyAccess', path: ['Price'] }, direction: 'desc' },
    ]
    visitor.apply(items)
    expect(qb.orderBy).toHaveBeenCalledWith('entity.Price', 'DESC')
  })

  it('translates multiple $orderby items using orderBy + addOrderBy', () => {
    const visitor = new TypeOrmOrderByVisitor(qb, 'entity')
    const items: OrderByItem[] = [
      { expression: { kind: 'PropertyAccess', path: ['Price'] }, direction: 'desc' },
      { expression: { kind: 'PropertyAccess', path: ['Name'] }, direction: 'asc' },
    ]
    visitor.apply(items)
    expect(qb.orderBy).toHaveBeenCalledWith('entity.Price', 'DESC')
    expect(qb.addOrderBy).toHaveBeenCalledWith('entity.Name', 'ASC')
  })

  it('does not call orderBy when items is empty', () => {
    const visitor = new TypeOrmOrderByVisitor(qb, 'entity')
    visitor.apply([])
    expect(qb.orderBy).not.toHaveBeenCalled()
    expect(qb.addOrderBy).not.toHaveBeenCalled()
  })
})
