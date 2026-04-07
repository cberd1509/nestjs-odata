import { describe, it, expect } from 'vitest'
import { buildContextUrl } from './odata-context-url.builder.js'
import type { SelectNode } from '../parser/ast.js'

describe('buildContextUrl', () => {
  it('Test 1: returns base context URL without select', () => {
    expect(buildContextUrl('/odata', 'Products', undefined)).toBe('/odata/$metadata#Products')
  })

  it('Test 2: appends select projection when items are specified', () => {
    const select: SelectNode = {
      items: [{ path: ['Name'] }, { path: ['Price'] }],
    }
    expect(buildContextUrl('/odata', 'Products', select)).toBe(
      '/odata/$metadata#Products(Name,Price)',
    )
  })

  it('Test 3: no projection suffix for $select=* (all=true)', () => {
    const select: SelectNode = { all: true }
    expect(buildContextUrl('/odata', 'Products', select)).toBe('/odata/$metadata#Products')
  })

  it('Test 4: normalizes trailing slash from serviceRoot', () => {
    expect(buildContextUrl('/odata/', 'Products', undefined)).toBe('/odata/$metadata#Products')
  })
})
