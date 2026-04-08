import { describe, it, expect } from 'vitest'
import { annotateEntity, annotateEntities } from './odata-annotation.builder.js'
import type { AnnotationContext } from './odata-annotation.builder.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'

function makeEntityType(overrides: Partial<EdmEntityType> = {}): EdmEntityType {
  return {
    name: 'Product',
    namespace: 'Default',
    properties: [],
    navigationProperties: [],
    keyProperties: ['id'],
    isReadOnly: false,
    ...overrides,
  }
}

function makeCtx(overrides: Partial<AnnotationContext> = {}): AnnotationContext {
  return {
    serviceRoot: '/odata',
    entitySetName: 'Products',
    entityType: makeEntityType(),
    namespace: 'Default',
    ...overrides,
  }
}

describe('annotateEntity', () => {
  it('Test 1: single entity with integer key — adds @odata.id and @odata.type, preserves original fields', () => {
    const entity = { id: 1, name: 'Laptop', price: 99 }
    const ctx = makeCtx()

    const result = annotateEntity(entity, ctx)

    expect(result['@odata.id']).toBe('/odata/Products(1)')
    expect(result['@odata.type']).toBe('#Default.Product')
    expect(result['id']).toBe(1)
    expect(result['name']).toBe('Laptop')
    expect(result['price']).toBe(99)
  })

  it('Test 2: entity with navigation properties — adds @odata.navigationLink entries', () => {
    const entityType = makeEntityType({
      navigationProperties: [
        { name: 'category', type: 'Default.Category', nullable: true, isCollection: false },
        { name: 'orderItems', type: 'Default.OrderItem', nullable: true, isCollection: true },
      ],
    })
    const entity = { id: 1, name: 'Laptop' }
    const ctx = makeCtx({ entityType })

    const result = annotateEntity(entity, ctx)

    expect(result['category@odata.navigationLink']).toBe('/odata/Products(1)/category')
    expect(result['orderItems@odata.navigationLink']).toBe('/odata/Products(1)/orderItems')
  })

  it('Test 3: composite key — @odata.id uses orderId=1,productId=2 format', () => {
    const entityType = makeEntityType({
      name: 'OrderItem',
      keyProperties: ['orderId', 'productId'],
    })
    const entity = { orderId: 1, productId: 2, quantity: 5 }
    const ctx = makeCtx({
      entitySetName: 'OrderItems',
      entityType,
      namespace: 'Default',
    })

    const result = annotateEntity(entity, ctx)

    expect(result['@odata.id']).toBe('/odata/OrderItems(orderId=1,productId=2)')
  })

  it('Test 4: string key — @odata.id uses single-quoted key', () => {
    const entityType = makeEntityType({
      name: 'Customer',
      keyProperties: ['code'],
    })
    const entity = { code: 'abc', name: 'Acme' }
    const ctx = makeCtx({
      entitySetName: 'Customers',
      entityType,
    })

    const result = annotateEntity(entity, ctx)

    expect(result['@odata.id']).toBe("/odata/Customers('abc')")
  })

  it('Test 5: null entity — returns null unchanged without crashing', () => {
    const result = annotateEntity(null as unknown as Record<string, unknown>, makeCtx())
    expect(result).toBeNull()
  })

  it('Test 5b: undefined entity — returns undefined unchanged without crashing', () => {
    const result = annotateEntity(undefined as unknown as Record<string, unknown>, makeCtx())
    expect(result).toBeUndefined()
  })

  it('Test 6: annotateEntities — annotates every item in the array', () => {
    const items = [
      { id: 1, name: 'Laptop' },
      { id: 2, name: 'Phone' },
    ]
    const ctx = makeCtx()

    const results = annotateEntities(items, ctx)

    expect(results).toHaveLength(2)
    expect(results[0]['@odata.id']).toBe('/odata/Products(1)')
    expect(results[0]['@odata.type']).toBe('#Default.Product')
    expect(results[1]['@odata.id']).toBe('/odata/Products(2)')
    expect(results[1]['@odata.type']).toBe('#Default.Product')
  })

  it('Test 7: immutability — annotateEntity returns a new object, does not mutate original', () => {
    const entity = { id: 1, name: 'Laptop' }
    const ctx = makeCtx()

    const result = annotateEntity(entity, ctx)

    // Original must remain unchanged
    expect(entity).not.toHaveProperty('@odata.id')
    expect(entity).not.toHaveProperty('@odata.type')
    // Result must be a different reference
    expect(result).not.toBe(entity)
  })

  it('Test 8: namespace from context is used in @odata.type', () => {
    const entityType = makeEntityType({ name: 'Widget' })
    const ctx = makeCtx({
      entityType,
      namespace: 'MyCompany.Models',
    })
    const entity = { id: 1 }

    const result = annotateEntity(entity, ctx)

    expect(result['@odata.type']).toBe('#MyCompany.Models.Widget')
  })
})
