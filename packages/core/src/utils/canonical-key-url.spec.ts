import { describe, it, expect } from 'vitest'
import { rewriteCanonicalKeyUrl } from './canonical-key-url.js'

const sets = new Set(['Products', 'OrderItems'])
const isEntitySet = (name: string) => sets.has(name)
const rewrite = (url: string, root = '/odata') => rewriteCanonicalKeyUrl(url, root, isEntitySet)

describe('rewriteCanonicalKeyUrl (OData-URL 4.01 §4.3.1)', () => {
  it('rewrites Set(key) to the key-as-segment form the routes serve', () => {
    expect(rewrite('/odata/Products(1)')).toBe('/odata/Products/1')
  })

  it('keeps the query string', () => {
    expect(rewrite('/odata/Products(1)?$select=name,price')).toBe(
      '/odata/Products/1?$select=name,price',
    )
  })

  it('keeps path segments after the key (navigation, custom routes)', () => {
    expect(rewrite('/odata/Products(1)/category')).toBe('/odata/Products/1/category')
  })

  it('rewrites composite keys', () => {
    expect(rewrite('/odata/OrderItems(orderId=1,productId=2)')).toBe(
      '/odata/OrderItems/orderId=1,productId=2',
    )
  })

  it('rewrites string keys, quoted and percent-encoded', () => {
    expect(rewrite("/odata/Products('a(b)c')")).toBe("/odata/Products/'a(b)c'")
    expect(rewrite('/odata/Products(%27a%2Fb%27)')).toBe('/odata/Products/%27a%2Fb%27')
  })

  it('accepts a service root with or without slashes, and nested roots', () => {
    expect(rewrite('/odata/Products(1)', 'odata')).toBe('/odata/Products/1')
    expect(rewrite('/odata/Products(1)', '/odata/')).toBe('/odata/Products/1')
    expect(rewrite('/api/v2/odata/Products(1)', '/api/v2/odata')).toBe('/api/v2/odata/Products/1')
  })

  it('also matches under a global prefix that ends with the service root', () => {
    expect(rewrite('/api/odata/Products(1)')).toBe('/api/odata/Products/1')
  })

  it('returns undefined for URLs it does not handle', () => {
    expect(rewrite('/odata/Products')).toBeUndefined()
    expect(rewrite('/odata/Products/1')).toBeUndefined()
    expect(rewrite('/odata/Products()')).toBeUndefined()
    expect(rewrite('/odata/Unknown(1)')).toBeUndefined()
    expect(rewrite('/other/Products(1)')).toBeUndefined()
    expect(rewrite('/odata/Products(1)x')).toBeUndefined()
    expect(rewrite('/odata/$batch')).toBeUndefined()
    expect(rewrite('/odata/Products?$filter=(id eq 1)')).toBeUndefined()
  })

  it('only rewrites the segment right after the service root', () => {
    expect(rewrite('/odata/Products(1)/OrderItems(2)')).toBe('/odata/Products/1/OrderItems(2)')
  })

  it('stays linear on adversarial input (many slashes, parentheses and root repetitions)', () => {
    const started = performance.now()
    rewriteCanonicalKeyUrl('/'.repeat(50_000) + 'odata', '/'.repeat(50_000) + 'odata', () => true)
    rewrite('/odata'.repeat(10_000) + '/Products(' + '('.repeat(50_000))
    rewrite('/odata/Products(' + ')'.repeat(50_000) + '/'.repeat(50_000))
    expect(performance.now() - started).toBeLessThan(500)
  })
})
