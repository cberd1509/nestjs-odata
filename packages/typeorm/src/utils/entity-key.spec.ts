import { describe, expect, it } from 'vitest'
import { entityLocation, formatEntityKey } from './entity-key.js'

describe('formatEntityKey', () => {
  it('renders a single key as its bare value', () => {
    expect(formatEntityKey(['id'], { id: 5, name: 'x' })).toBe('5')
    expect(formatEntityKey(['code'], { code: 'ABC' })).toBe('ABC')
  })

  it('renders a composite key as name=value pairs in key order', () => {
    expect(formatEntityKey(['orderId', 'itemId'], { itemId: 2, orderId: 1 })).toBe(
      'orderId=1,itemId=2',
    )
  })

  it('renders missing values as undefined instead of throwing', () => {
    expect(formatEntityKey(['id'], undefined)).toBe('undefined')
    expect(formatEntityKey(['a', 'b'], null)).toBe('a=undefined,b=undefined')
  })
})

describe('entityLocation', () => {
  it('builds the canonical entity URL', () => {
    expect(entityLocation('/odata', 'Products', ['id'], { id: 7 })).toBe('/odata/Products(7)')
    expect(entityLocation('/api', 'Lines', ['o', 'l'], { o: 1, l: 2 })).toBe('/api/Lines(o=1,l=2)')
  })
})
