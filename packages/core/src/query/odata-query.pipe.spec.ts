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
  navigationProperties: [],
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
}

const mockOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 100,
  maxExpandDepth: 2,
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

  it('Test 9: enforces maxTop — clamps $top=5000 to maxTop=100', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $top: '5000',
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
})
