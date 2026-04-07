import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArgumentMetadata } from '@nestjs/common'
import { ODataQueryPipe } from './odata-query.pipe.js'
import { ODataValidationError } from './odata-validation.error.js'
import { ODataParseError } from '../parser/errors.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { EdmEntitySet } from '../edm/edm-entity-set.js'
import type { EdmRegistry } from '../edm/edm-registry.js'

// Mock EdmRegistry
const mockEntityType: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Name', type: 'Edm.String', nullable: false },
    { name: 'Price', type: 'Edm.Decimal', nullable: false },
  ],
  navigationProperties: [
    { name: 'Category', type: 'Category', nullable: true, isCollection: false },
    { name: 'Supplier', type: 'Supplier', nullable: true, isCollection: false },
  ],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const mockEntitySet: EdmEntitySet = {
  name: 'Products',
  entityTypeName: 'Product',
  namespace: 'Default',
  isReadOnly: false,
}

const mockEdmRegistry = {
  getEntityType: vi.fn((name: string) => (name === 'Product' ? mockEntityType : undefined)),
  getEntitySet: vi.fn((name: string) => (name === 'Products' ? mockEntitySet : undefined)),
  getEntitySecurityOptions: vi.fn(() => undefined),
}

const mockOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 100,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip' as const,
}

function createPipe(): ODataQueryPipe {
  return new ODataQueryPipe(mockEdmRegistry as unknown as EdmRegistry, mockOptions)
}

const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: undefined,
  data: 'Products',
}

describe('ODataQueryPipe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEdmRegistry.getEntityType.mockImplementation((name: string) =>
      name === 'Product' ? mockEntityType : undefined,
    )
    mockEdmRegistry.getEntitySet.mockImplementation((name: string) =>
      name === 'Products' ? mockEntitySet : undefined,
    )
  })

  it('Test 1: parses $filter, $select, $orderby, $top, $skip into ODataQuery', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $filter: 'Price gt 5',
      $select: 'Name,Price',
      $orderby: 'Name asc',
      $top: '10',
      $skip: '0',
    }

    const result = pipe.transform(rawQuery, metadata)

    expect(result.entitySetName).toBe('Products')
    expect(result.filter).toBeDefined()
    expect(result.filter?.kind).toBe('BinaryExpr')
    expect(result.select).toBeDefined()
    expect(result.select?.items).toHaveLength(2)
    expect(result.orderBy).toHaveLength(1)
    expect(result.top).toBe(10)
    expect(result.skip).toBe(0)
  })

  it('Test 2: adds count: true when $count=true', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $count: 'true',
    }

    const result = pipe.transform(rawQuery, metadata)

    expect(result.count).toBe(true)
    expect(result.entitySetName).toBe('Products')
  })

  it('Test 3: count is false/undefined when $count is absent', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $top: '5',
    }

    const result = pipe.transform(rawQuery, metadata)

    expect(result.count).toBeFalsy()
  })

  it('Test 4: sets entitySetName from pipe metadata data argument', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {}

    const result = pipe.transform(rawQuery, { ...metadata, data: 'Products' })

    expect(result.entitySetName).toBe('Products')
  })

  it('Test 5: throws ODataValidationError for unknown $select field', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $select: 'Name,UnknownField',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      "Property 'UnknownField' not found on entity 'Product'",
    )
  })

  it('Test 6: throws ODataValidationError for unknown $filter property', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $filter: 'FakeField eq 1',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      "Property 'FakeField' not found on entity 'Product'",
    )
  })

  it('Test 7: throws ODataValidationError for unknown $orderby field', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $orderby: 'FakeField asc',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      "Property 'FakeField' not found on entity 'Product'",
    )
  })

  it('Test 8: passes through ODataParseError for malformed syntax', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $filter: 'Price gt',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataParseError)
  })

  it('Test 9 (SEC-01): enforces maxTop — throws ODataValidationError when $top=5000 exceeds maxTop=100', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $top: '5000',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      '$top value 5000 exceeds maximum of 100',
    )
  })

  it('Test 9b (SEC-01): allows $top=50 when maxTop=100 (within limit)', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $top: '50',
    }

    const result = pipe.transform(rawQuery, metadata)
    expect(result.top).toBe(50)
  })

  it('Test 9c (SEC-01): allows $top=100 when maxTop=100 (boundary, no error)', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $top: '100',
    }

    const result = pipe.transform(rawQuery, metadata)
    expect(result.top).toBe(100)
  })

  it('Test 10: returns empty ODataQuery when query string is empty', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {}

    const result = pipe.transform(rawQuery, metadata)

    expect(result.entitySetName).toBe('Products')
    expect(result.filter).toBeUndefined()
    expect(result.select).toBeUndefined()
    expect(result.orderBy).toBeUndefined()
    expect(result.top).toBeUndefined()
    expect(result.skip).toBeUndefined()
  })

  it('Test 11: $expand=Category passes validation for known navigation property', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $expand: 'Category',
    }

    const result = pipe.transform(rawQuery, metadata)

    expect(result.expand).toBeDefined()
    expect(result.expand?.items).toHaveLength(1)
    expect(result.expand?.items[0]?.navigationProperty).toBe('Category')
  })

  it('Test 12: $expand=InvalidNavProp throws ODataValidationError for unknown navigation property', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $expand: 'NonExistentNavProp',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      "Navigation property 'NonExistentNavProp' not found on entity 'Product'",
    )
  })

  it('Test 13: $expand=Category,Supplier passes validation for multiple known navigation properties', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $expand: 'Category,Supplier',
    }

    const result = pipe.transform(rawQuery, metadata)

    expect(result.expand).toBeDefined()
    expect(result.expand?.items).toHaveLength(2)
  })

  it('Test 14: $expand is present in returned ODataQuery.expand field', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $expand: 'Category',
    }

    const result = pipe.transform(rawQuery, metadata)

    expect(result.expand).toBeDefined()
    expect(result.expand?.items[0]?.navigationProperty).toBe('Category')
  })

  describe('Per-entity security overrides (D-07)', () => {
    it('Test D-07a: per-entity maxTop=500 for Products allows $top=400 (exceeds global 100 but within entity limit)', () => {
      mockEdmRegistry.getEntitySecurityOptions.mockReturnValue({ maxTop: 500 })
      const pipe = createPipe()
      const rawQuery: Record<string, string> = { $top: '400' }

      const result = pipe.transform(rawQuery, metadata)

      expect(result.top).toBe(400)
    })

    it('Test D-07b: per-entity maxTop=500 for Products rejects $top=600 (exceeds entity limit 500)', () => {
      mockEdmRegistry.getEntitySecurityOptions.mockReturnValue({ maxTop: 500 })
      const pipe = createPipe()
      const rawQuery: Record<string, string> = { $top: '600' }

      expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
      expect(() => pipe.transform(rawQuery, metadata)).toThrow(
        '$top value 600 exceeds maximum of 500',
      )
    })

    it('Test D-07c: no per-entity override falls back to global maxTop=100 and rejects $top=150', () => {
      mockEdmRegistry.getEntitySecurityOptions.mockReturnValue(undefined)
      const pipe = createPipe()
      const rawQuery: Record<string, string> = { $top: '150' }

      expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
      expect(() => pipe.transform(rawQuery, metadata)).toThrow(
        '$top value 150 exceeds maximum of 100',
      )
    })
  })
})
