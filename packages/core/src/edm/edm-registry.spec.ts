import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { EdmRegistry } from './edm-registry.js'
import type { EdmEntityType } from './edm-entity-type.js'
import type { EdmEntitySet } from './edm-entity-set.js'

describe('EdmRegistry', () => {
  let registry: EdmRegistry

  const makeEntityType = (name: string): EdmEntityType => ({
    name,
    namespace: 'TestService',
    properties: [],
    navigationProperties: [],
    keyProperties: ['id'],
    isReadOnly: false,
  })

  const makeEntitySet = (name: string, entityTypeName: string): EdmEntitySet => ({
    name,
    entityTypeName,
    namespace: 'TestService',
    isReadOnly: false,
  })

  beforeEach(() => {
    registry = new EdmRegistry()
  })

  it('Test 1: register() stores an EdmEntityType and EdmEntitySet; getEntityType returns it', () => {
    const entityType = makeEntityType('Product')
    const entitySet = makeEntitySet('Products', 'Product')

    registry.register(entityType, entitySet)

    const retrieved = registry.getEntityType('Product')
    expect(retrieved).toEqual(entityType)
  })

  it('Test 2: getEntityTypes() returns a ReadonlyMap with all registered types', () => {
    const product = makeEntityType('Product')
    const order = makeEntityType('Order')
    registry.register(product, makeEntitySet('Products', 'Product'))
    registry.register(order, makeEntitySet('Orders', 'Order'))

    const types = registry.getEntityTypes()
    expect(types.size).toBe(2)
    expect(types.get('Product')).toEqual(product)
    expect(types.get('Order')).toEqual(order)
  })

  it('Test 3: getEntitySets() returns a ReadonlyMap with all registered sets', () => {
    const entitySet = makeEntitySet('Products', 'Product')
    registry.register(makeEntityType('Product'), entitySet)

    const sets = registry.getEntitySets()
    expect(sets.size).toBe(1)
    expect(sets.get('Products')).toEqual(entitySet)
  })

  it('Test 4: register() with duplicate entity type name throws error', () => {
    const entityType = makeEntityType('Product')
    registry.register(entityType, makeEntitySet('Products', 'Product'))

    expect(() => {
      registry.register(entityType, makeEntitySet('Products2', 'Product'))
    }).toThrow(/duplicate/i)
  })

  it('Test 5: getEntityType("Unknown") returns undefined', () => {
    expect(registry.getEntityType('Unknown')).toBeUndefined()
  })
})
