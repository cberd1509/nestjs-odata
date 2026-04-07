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

  it('Test 4: register() with duplicate entity type name is idempotent (skips silently)', () => {
    const entityType = makeEntityType('Product')
    const entitySet = makeEntitySet('Products', 'Product')
    registry.register(entityType, entitySet)

    // Second registration with same name is silently skipped — no error thrown
    expect(() => {
      registry.register(entityType, makeEntitySet('Products2', 'Product'))
    }).not.toThrow()

    // Original registration is preserved
    expect(registry.getEntityType('Product')).toEqual(entityType)
    expect(registry.getEntitySets().size).toBe(1)
    expect(registry.getEntitySet('Products')).toEqual(entitySet)
    expect(registry.getEntitySet('Products2')).toBeUndefined()
  })

  it('Test 5: getEntityType("Unknown") returns undefined', () => {
    expect(registry.getEntityType('Unknown')).toBeUndefined()
  })
})
