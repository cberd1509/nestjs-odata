import { describe, it, expect } from 'vitest'
import { pluralizeEntityName } from './pluralize.js'

describe('pluralizeEntityName', () => {
  it("pluralizes 'Product' → 'Products'", () => {
    expect(pluralizeEntityName('Product')).toBe('Products')
  })

  it("pluralizes 'Category' → 'Categories'", () => {
    expect(pluralizeEntityName('Category')).toBe('Categories')
  })

  it("pluralizes 'OrderItem' → 'OrderItems'", () => {
    expect(pluralizeEntityName('OrderItem')).toBe('OrderItems')
  })

  it("pluralizes 'Person' → 'People'", () => {
    expect(pluralizeEntityName('Person')).toBe('People')
  })

  it("pluralizes 'Index' → 'Indices'", () => {
    expect(pluralizeEntityName('Index')).toBe('Indices')
  })
})
