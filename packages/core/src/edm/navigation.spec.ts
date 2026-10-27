import { describe, it, expect } from 'vitest'
import { EdmRegistry } from './edm-registry.js'
import { navigationTargetTypeName, resolveNavigationTarget } from './navigation.js'

function registry(): EdmRegistry {
  const edm = new EdmRegistry()
  edm.register(
    {
      name: 'Order',
      namespace: 'Default',
      keyProperties: ['id'],
      isReadOnly: false,
      properties: [{ name: 'id', type: 'Edm.Int32', nullable: false }],
      navigationProperties: [
        {
          name: 'items',
          type: 'Collection(Default.OrderItem)',
          nullable: true,
          isCollection: true,
        },
      ],
    },
    { name: 'Orders', entityTypeName: 'Order', namespace: 'Default', isReadOnly: false },
  )
  edm.register(
    {
      name: 'OrderItem',
      namespace: 'Default',
      keyProperties: ['id'],
      isReadOnly: false,
      properties: [{ name: 'id', type: 'Edm.Int32', nullable: false }],
      navigationProperties: [],
    },
    { name: 'OrderItems', entityTypeName: 'OrderItem', namespace: 'Default', isReadOnly: false },
  )
  return edm
}

describe('navigationTargetTypeName', () => {
  it('strips Collection() and the namespace', () => {
    expect(navigationTargetTypeName('Collection(Default.OrderItem)')).toBe('OrderItem')
    expect(navigationTargetTypeName('Default.OrderItem')).toBe('OrderItem')
  })
})

describe('resolveNavigationTarget', () => {
  it('resolves a navigation type to its entity type and set', () => {
    const target = resolveNavigationTarget(registry(), 'Collection(Default.OrderItem)')
    expect(target.typeName).toBe('OrderItem')
    expect(target.entitySet?.name).toBe('OrderItems')
    expect(target.entityType?.name).toBe('OrderItem')
  })

  it('resolves a navigation property by name on its source type', () => {
    const edm = registry()
    const order = edm.getEntityType('Order')
    if (!order) throw new Error('Order is registered')
    expect(resolveNavigationTarget(edm, order, 'items')?.entitySet?.name).toBe('OrderItems')
    expect(resolveNavigationTarget(edm, order, 'missing')).toBeUndefined()
  })

  it('leaves entity type and set undefined for a type that is not an entity set', () => {
    const target = resolveNavigationTarget(registry(), 'Default.Address')
    expect(target).toEqual({ typeName: 'Address', entityType: undefined, entitySet: undefined })
  })
})
