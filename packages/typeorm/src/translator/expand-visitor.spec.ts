import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SelectQueryBuilder, ObjectLiteral } from 'typeorm'
import { ODataValidationError } from '@nestjs-odata/core'
import type { EdmEntityType, EdmRegistry } from '@nestjs-odata/core'
import type { ExpandNode } from '@nestjs-odata/core'
import { TypeOrmExpandVisitor } from './expand-visitor.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const customerEntityType: EdmEntityType = {
  name: 'Customer',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Name', type: 'Edm.String', nullable: false },
  ],
  navigationProperties: [{ name: 'Orders', type: 'Order', nullable: false, isCollection: true }],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const orderEntityType: EdmEntityType = {
  name: 'Order',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Total', type: 'Edm.Decimal', nullable: false },
  ],
  navigationProperties: [{ name: 'Items', type: 'OrderItem', nullable: false, isCollection: true }],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const orderItemEntityType: EdmEntityType = {
  name: 'OrderItem',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Quantity', type: 'Edm.Int32', nullable: false },
  ],
  navigationProperties: [],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const productEntityType: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Name', type: 'Edm.String', nullable: false },
  ],
  navigationProperties: [
    { name: 'Category', type: 'Category', nullable: true, isCollection: false },
    { name: 'Supplier', type: 'Supplier', nullable: true, isCollection: false },
  ],
  keyProperties: ['Id'],
  isReadOnly: false,
}

function createMockQb() {
  const leftJoinAndSelect = vi.fn().mockReturnThis()
  const andWhere = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const orderBy = vi.fn().mockReturnThis()
  const addOrderBy = vi.fn().mockReturnThis()
  const take = vi.fn().mockReturnThis()
  const skip = vi.fn().mockReturnThis()

  const qb = {
    leftJoinAndSelect,
    andWhere,
    select,
    orderBy,
    addOrderBy,
    take,
    skip,
  } as unknown as SelectQueryBuilder<ObjectLiteral>

  return { qb, leftJoinAndSelect, andWhere, select, orderBy }
}

function createMockEdmRegistry(): EdmRegistry {
  return {
    getEntityType: vi.fn((name: string) => {
      switch (name) {
        case 'Customer':
          return customerEntityType
        case 'Order':
          return orderEntityType
        case 'OrderItem':
          return orderItemEntityType
        case 'Product':
          return productEntityType
        default:
          return undefined
      }
    }),
    getEntitySet: vi.fn(),
    getEntityTypes: vi.fn(),
    getEntitySets: vi.fn(),
    register: vi.fn(),
  } as unknown as EdmRegistry
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TypeOrmExpandVisitor', () => {
  let edmRegistry: EdmRegistry

  beforeEach(() => {
    edmRegistry = createMockEdmRegistry()
  })

  it('Test 1: single expand item calls leftJoinAndSelect with correct path and alias', () => {
    const { qb, leftJoinAndSelect } = createMockQb()
    const expandNode: ExpandNode = {
      items: [{ navigationProperty: 'Orders' }],
    }

    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 3)
    visitor.apply(expandNode, 'entity', customerEntityType, 0)

    expect(leftJoinAndSelect).toHaveBeenCalledOnce()
    expect(leftJoinAndSelect).toHaveBeenCalledWith('entity.Orders', 'entity_Orders')
  })

  it('Test 2: two expand items call leftJoinAndSelect twice with unique aliases', () => {
    const { qb, leftJoinAndSelect } = createMockQb()
    const expandNode: ExpandNode = {
      items: [{ navigationProperty: 'Category' }, { navigationProperty: 'Supplier' }],
    }

    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 3)
    visitor.apply(expandNode, 'entity', productEntityType, 0)

    expect(leftJoinAndSelect).toHaveBeenCalledTimes(2)
    expect(leftJoinAndSelect).toHaveBeenNthCalledWith(1, 'entity.Category', 'entity_Category')
    expect(leftJoinAndSelect).toHaveBeenNthCalledWith(2, 'entity.Supplier', 'entity_Supplier')
  })

  it('Test 3: nested expand calls leftJoinAndSelect for parent and child with correct alias chain', () => {
    const { qb, leftJoinAndSelect } = createMockQb()
    const expandNode: ExpandNode = {
      items: [
        {
          navigationProperty: 'Orders',
          expand: {
            items: [{ navigationProperty: 'Items' }],
          },
        },
      ],
    }

    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 3)
    visitor.apply(expandNode, 'entity', customerEntityType, 0)

    expect(leftJoinAndSelect).toHaveBeenCalledTimes(2)
    // Parent join: entity.Orders -> entity_Orders
    expect(leftJoinAndSelect).toHaveBeenNthCalledWith(1, 'entity.Orders', 'entity_Orders')
    // Child join: entity_Orders.Items -> entity_Orders_Items
    expect(leftJoinAndSelect).toHaveBeenNthCalledWith(
      2,
      'entity_Orders.Items',
      'entity_Orders_Items',
    )
  })

  it('Test 4: exceeding maxExpandDepth throws ODataValidationError', () => {
    const { qb } = createMockQb()
    const expandNode: ExpandNode = {
      items: [
        {
          navigationProperty: 'Orders',
          expand: {
            items: [
              {
                navigationProperty: 'Items',
                expand: {
                  items: [{ navigationProperty: 'Something' }],
                },
              },
            ],
          },
        },
      ],
    }

    // maxExpandDepth=2 means depth 0 and 1 are valid, depth 2 throws
    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 2)

    expect(() => visitor.apply(expandNode, 'entity', customerEntityType, 0)).toThrow(
      ODataValidationError,
    )
    expect(() => visitor.apply(expandNode, 'entity', customerEntityType, 0)).toThrow(
      '$expand depth limit of 2 exceeded',
    )
  })

  it('Test 5: expanding a property not in navigationProperties throws ODataValidationError', () => {
    const { qb } = createMockQb()
    const expandNode: ExpandNode = {
      items: [{ navigationProperty: 'NonExistentNavProp' }],
    }

    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 3)

    expect(() => visitor.apply(expandNode, 'entity', customerEntityType, 0)).toThrow(
      ODataValidationError,
    )
    expect(() => visitor.apply(expandNode, 'entity', customerEntityType, 0)).toThrow(
      "'NonExistentNavProp' is not a navigation property of 'Customer'",
    )
  })

  it('Test 6: expand at current depth equal to maxExpandDepth throws immediately', () => {
    const { qb } = createMockQb()
    const expandNode: ExpandNode = {
      items: [{ navigationProperty: 'Orders' }],
    }

    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 2)

    // Start at depth=2 (equal to maxExpandDepth=2) -> should throw
    expect(() => visitor.apply(expandNode, 'entity', customerEntityType, 2)).toThrow(
      ODataValidationError,
    )
  })

  it('Test 7: expand at depth below maxExpandDepth succeeds', () => {
    const { qb, leftJoinAndSelect } = createMockQb()
    const expandNode: ExpandNode = {
      items: [{ navigationProperty: 'Orders' }],
    }

    const visitor = new TypeOrmExpandVisitor(qb, edmRegistry, 2)

    // depth=0 is below maxExpandDepth=2 -> should succeed
    expect(() => visitor.apply(expandNode, 'entity', customerEntityType, 0)).not.toThrow()
    expect(leftJoinAndSelect).toHaveBeenCalledWith('entity.Orders', 'entity_Orders')
  })
})
