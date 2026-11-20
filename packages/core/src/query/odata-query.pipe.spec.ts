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
      /Property 'UnknownField' not found on entity 'Product'/,
    )
  })

  it('Test 6: throws ODataValidationError for unknown $filter property', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $filter: 'FakeField eq 1',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      /Property 'FakeField' not found on entity 'Product'/,
    )
  })

  it('Test 7: throws ODataValidationError for unknown $orderby field', () => {
    const pipe = createPipe()
    const rawQuery: Record<string, string> = {
      $orderby: 'FakeField asc',
    }

    expect(() => pipe.transform(rawQuery, metadata)).toThrow(ODataValidationError)
    expect(() => pipe.transform(rawQuery, metadata)).toThrow(
      /Property 'FakeField' not found on entity 'Product'/,
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
      /Navigation property 'NonExistentNavProp' not found on entity 'Product'/,
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

  describe('Enriched error messages (D-09)', () => {
    it('Test D-09a: validateFilterNode passes available property names to ODataValidationError', () => {
      const pipe = createPipe()
      const rawQuery: Record<string, string> = {
        $filter: 'FakeField eq 1',
      }

      try {
        pipe.transform(rawQuery, metadata)
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ODataValidationError)
        const validationErr = err as ODataValidationError
        expect(validationErr.availableProperties).toEqual(['Id', 'Name', 'Price'])
        expect(validationErr.message).not.toContain('Available properties')
      }
    })

    it('Test D-09b: validateSelectItem passes available property names to ODataValidationError', () => {
      const pipe = createPipe()
      const rawQuery: Record<string, string> = {
        $select: 'UnknownField',
      }

      try {
        pipe.transform(rawQuery, metadata)
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ODataValidationError)
        const validationErr = err as ODataValidationError
        expect(validationErr.availableProperties).toEqual(['Id', 'Name', 'Price'])
        expect(validationErr.message).not.toContain('Available properties')
      }
    })

    it('Test D-09c: validateExpandNode passes available nav property names to ODataValidationError', () => {
      const pipe = createPipe()
      const rawQuery: Record<string, string> = {
        $expand: 'NonExistentNavProp',
      }

      try {
        pipe.transform(rawQuery, metadata)
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ODataValidationError)
        const validationErr = err as ODataValidationError
        expect(validationErr.availableProperties).toEqual(['Category', 'Supplier'])
        expect(validationErr.message).not.toContain('Available properties')
      }
    })

    it('Test D-09d: no "did you mean" text in any validation error (D-11)', () => {
      const pipe = createPipe()

      try {
        pipe.transform({ $filter: 'Prce eq 1' }, metadata)
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ODataValidationError)
        const msg = (err as ODataValidationError).message.toLowerCase()
        expect(msg).not.toContain('did you mean')
        expect(msg).not.toContain('suggest')
        expect(msg).not.toContain('levenshtein')
      }
    })
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

  describe('lambda predicates', () => {
    const reviewType: EdmEntityType = {
      name: 'Review',
      namespace: 'Default',
      properties: [{ name: 'Stars', type: 'Edm.Int32', nullable: false }],
      navigationProperties: [],
      keyProperties: ['Stars'],
      isReadOnly: false,
    }
    const withReviews: EdmEntityType = {
      ...mockEntityType,
      navigationProperties: [
        ...mockEntityType.navigationProperties,
        {
          name: 'Reviews',
          type: 'Collection(Default.Review)',
          nullable: false,
          isCollection: true,
        },
      ],
    }

    beforeEach(() => {
      mockEdmRegistry.getEntityType.mockImplementation((name: string) =>
        name === 'Product' ? withReviews : name === 'Review' ? reviewType : undefined,
      )
    })

    it('validates `r/Stars` against the collection entity type, not the root', () => {
      const result = createPipe().transform({ $filter: 'Reviews/any(r: r/Stars gt 3)' }, metadata)
      expect(result.filter?.kind).toBe('LambdaExpr')
    })

    it('rejects an unknown property of the collection entity type', () => {
      expect(() =>
        createPipe().transform({ $filter: 'Reviews/any(r: r/Nope gt 3)' }, metadata),
      ).toThrow("Property 'Nope' not found on entity 'Review'")
    })
  })

  describe('query option values (decoded once by the URL parser, never again)', () => {
    const literal = (node: unknown) =>
      (node as { right: { value: unknown } } | undefined)?.right.value

    it.each(['A & B', '100% cotton', 'C+ grade', 'a%20b', 'a%26b'])(
      '$filter keeps %j as given',
      (text) => {
        const result = createPipe().transform({ $filter: `Name eq '${text}'` }, metadata)
        expect(literal(result.filter)).toBe(text)
      },
    )

    it("$filter: OData's '' escape inside a literal", () => {
      const result = createPipe().transform({ $filter: "Name eq 'O''Brien'" }, metadata)
      expect(literal(result.filter)).toBe("O'Brien")
    })

    it('$search: &, % and + inside a phrase are not decoded again', () => {
      const result = createPipe().transform({ $search: '"A & B 100% C+"' }, metadata)
      expect(result.search).toEqual({ kind: 'SearchTerm', value: 'A & B 100% C+' })
    })

    it('$search: a value that would be malformed percent-encoding does not throw', () => {
      const result = createPipe().transform({ $search: '100%' }, metadata)
      expect(result.search).toMatchObject({ kind: 'SearchTerm', value: '100%' })
    })

    it('$apply: a literal with & and % inside filter()', () => {
      const result = createPipe().transform({ $apply: "filter(Name eq 'A & 100%')" }, metadata)
      const [step] = (result.apply as { steps: { filter: unknown }[] }).steps
      expect(literal(step?.filter)).toBe('A & 100%')
    })

    it('$orderby and $select with literals and spaces', () => {
      const result = createPipe().transform(
        { $orderby: "Name eq 'A & B, C' desc,Price", $select: 'Name, Price' },
        metadata,
      )
      expect(result.orderBy).toHaveLength(2)
      expect(literal(result.orderBy?.[0]?.expression)).toBe('A & B, C')
      expect(result.select?.items?.map((i) => i.path)).toEqual([['Name'], ['Price']])
    })

    it("nested $expand options: Category($filter=Name eq 'b & c')", () => {
      mockEdmRegistry.getEntityType.mockImplementation((name: string) =>
        name === 'Product' || name === 'Category' ? mockEntityType : undefined,
      )
      const result = createPipe().transform(
        { $expand: "Category($filter=Name eq 'b & c; 100%')" },
        metadata,
      )
      expect(literal(result.expand?.items[0]?.filter)).toBe('b & c; 100%')
    })

    it('a value holding & does not create other options', () => {
      const result = createPipe().transform({ $filter: "Name eq 'x&$top=1'" }, metadata)
      expect(literal(result.filter)).toBe('x&$top=1')
      expect(result.top).toBeUndefined()
    })

    it('refuses a repeated system query option ($count, $search, $apply included)', () => {
      for (const name of ['$filter', '$top', '$count', '$search', '$apply']) {
        expect(() => createPipe().transform({ [name]: ['1', '2'] }, metadata)).toThrow(
          /more than once/,
        )
      }
    })

    it('refuses non-string values of system query options; ignores unknown parameters', () => {
      expect(() => createPipe().transform({ $count: { a: 'b' } }, metadata)).toThrow(
        /single text value/,
      )
      expect(() => createPipe().transform({ $filter: { x: 'Id eq 1' } }, metadata)).toThrow(
        ODataParseError,
      )
      const result = createPipe().transform(
        { tags: ['a', 'b'], other: { x: 1 }, $top: '3' },
        metadata,
      )
      expect(result.top).toBe(3)
    })

    it('refuses a system query option repeated in another letter case', () => {
      expect(() => createPipe().transform({ $top: '1', $TOP: '2' }, metadata)).toThrow(
        /more than once/,
      )
      expect(() =>
        createPipe().transform({ $filter: 'Id eq 1', $FILTER: 'Id eq 2' }, metadata),
      ).toThrow(/more than once/)
    })

    it('an undefined query object parses as an empty query', () => {
      const result = createPipe().transform(
        undefined as unknown as Record<string, string>,
        metadata,
      )
      expect(result).toMatchObject({ entitySetName: 'Products', filter: undefined })
    })
  })
})
