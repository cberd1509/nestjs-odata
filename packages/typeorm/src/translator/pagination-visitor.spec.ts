import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { TypeOrmPaginationVisitor } from './pagination-visitor.js'
import type { SelectQueryBuilder } from 'typeorm'

type MockQb = SelectQueryBuilder<never> & {
  take: MockInstance
  skip: MockInstance
}

function makeQb(): MockQb {
  return {
    take: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  } as unknown as MockQb
}

describe('TypeOrmPaginationVisitor', () => {
  let qb: MockQb

  beforeEach(() => {
    qb = makeQb()
  })

  it('applies top to qb.take()', () => {
    const visitor = new TypeOrmPaginationVisitor(qb)
    visitor.paginate(10, undefined)
    expect(qb.take).toHaveBeenCalledWith(10)
    expect(qb.skip).not.toHaveBeenCalled()
  })

  it('applies skip to qb.skip()', () => {
    const visitor = new TypeOrmPaginationVisitor(qb)
    visitor.paginate(undefined, 20)
    expect(qb.skip).toHaveBeenCalledWith(20)
    expect(qb.take).not.toHaveBeenCalled()
  })

  it('applies both top and skip', () => {
    const visitor = new TypeOrmPaginationVisitor(qb)
    visitor.paginate(10, 20)
    expect(qb.take).toHaveBeenCalledWith(10)
    expect(qb.skip).toHaveBeenCalledWith(20)
  })

  it('applies top=0 as valid (returns empty result)', () => {
    const visitor = new TypeOrmPaginationVisitor(qb)
    visitor.paginate(0, undefined)
    expect(qb.take).toHaveBeenCalledWith(0)
  })

  it('does not call take/skip when both are undefined', () => {
    const visitor = new TypeOrmPaginationVisitor(qb)
    visitor.paginate(undefined, undefined)
    expect(qb.take).not.toHaveBeenCalled()
    expect(qb.skip).not.toHaveBeenCalled()
  })
})
