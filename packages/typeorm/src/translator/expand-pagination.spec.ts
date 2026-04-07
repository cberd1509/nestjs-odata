import { describe, it, expect } from 'vitest'
import { applyExpandPagination } from './expand-pagination.js'

describe('applyExpandPagination', () => {
  it('Test 1: slices expanded array with top=2 from 5 items to 2 items', () => {
    const items = [{ id: 1, tags: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }]
    const paginationMap = new Map([['tags', { top: 2 }]])

    applyExpandPagination(items, paginationMap)

    expect(items[0].tags).toHaveLength(2)
    expect(items[0].tags).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('Test 2: with skip=1 and top=2 returns items [1,2] from 5-item array (indices 1,2)', () => {
    const items = [{ id: 1, tags: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }]
    const paginationMap = new Map([['tags', { skip: 1, top: 2 }]])

    applyExpandPagination(items, paginationMap)

    expect(items[0].tags).toHaveLength(2)
    expect(items[0].tags).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('Test 3: with skip=3 and no top returns items from index 3 to end', () => {
    const items = [{ id: 1, tags: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }]
    const paginationMap = new Map([['tags', { skip: 3 }]])

    applyExpandPagination(items, paginationMap)

    expect(items[0].tags).toHaveLength(2)
    expect(items[0].tags).toEqual([{ id: 3 }, { id: 4 }])
  })

  it('Test 4: nav prop that is not an array is a no-op', () => {
    const items = [{ id: 1, category: { id: 99, name: 'Widget' } }]
    const paginationMap = new Map([['category', { top: 2 }]])

    applyExpandPagination(items, paginationMap)

    // category is an object, not array — should be unchanged
    expect(items[0].category).toEqual({ id: 99, name: 'Widget' })
  })

  it('Test 5: empty pagination map is a no-op', () => {
    const items = [{ id: 1, tags: [{ id: 1 }, { id: 2 }, { id: 3 }] }]
    const paginationMap = new Map<string, { skip?: number; top?: number }>()

    applyExpandPagination(items, paginationMap)

    expect(items[0].tags).toHaveLength(3)
  })

  it('Test 6: applies pagination to multiple parent items independently', () => {
    const items = [
      { id: 1, tags: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      { id: 2, tags: [{ id: 4 }, { id: 5 }, { id: 6 }] },
    ]
    const paginationMap = new Map([['tags', { top: 2 }]])

    applyExpandPagination(items, paginationMap)

    expect(items[0].tags).toHaveLength(2)
    expect(items[0].tags).toEqual([{ id: 1 }, { id: 2 }])
    expect(items[1].tags).toHaveLength(2)
    expect(items[1].tags).toEqual([{ id: 4 }, { id: 5 }])
  })
})
