import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DataSource, EntityMetadata } from 'typeorm'
import type { EdmRegistry, EdmEntitySet } from '@nestjs-odata/core'
import { ODataValidationError } from '@nestjs-odata/core'
import { ODataSearchable } from '@nestjs-odata/core'
import type { SearchNode, SearchTermNode, SearchBinaryNode } from '@nestjs-odata/core'
import { TypeOrmSearchProvider } from './search-provider.js'

// ── Test entities ─────────────────────────────────────────────────────────────

class ProductWithSearchable {
  @ODataSearchable()
  name!: string

  @ODataSearchable()
  description!: string

  price!: number
}

class ProductNoSearchable {
  name!: string
  price!: number
}

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeDataSource(entityClass: new (...args: unknown[]) => unknown): DataSource {
  return {
    entityMetadatas: [{ name: entityClass.name, target: entityClass } as EntityMetadata],
  } as unknown as DataSource
}

function makeEdmRegistry(entitySetName: string, entityTypeName: string): EdmRegistry {
  return {
    getEntitySet: vi.fn().mockReturnValue({ entityTypeName } as EdmEntitySet),
  } as unknown as EdmRegistry
}

// ── TypeOrmSearchProvider tests ───────────────────────────────────────────────

describe('TypeOrmSearchProvider', () => {
  describe('buildSearchCondition', () => {
    let provider: TypeOrmSearchProvider

    beforeEach(() => {
      const dataSource = makeDataSource(ProductWithSearchable)
      const edmRegistry = makeEdmRegistry('Products', 'ProductWithSearchable')
      provider = new TypeOrmSearchProvider(dataSource, edmRegistry)
    })

    it('builds LIKE condition for a SearchTermNode on entity with searchable fields', () => {
      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result).not.toBeNull()
      expect(result!.condition).toContain('entity.name LIKE :search_0')
      expect(result!.condition).toContain('entity.description LIKE :search_0')
      expect(result!.condition).toContain(' OR ')
      expect(result!.params['search_0']).toBe('%laptop%')
    })

    it('wraps OR LIKE group in parentheses', () => {
      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result!.condition).toMatch(/^\(.+\)$/)
    })

    it('escapes % in search terms', () => {
      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: '50% off' }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result!.params['search_0']).toBe('%50\\% off%')
    })

    it('escapes _ in search terms', () => {
      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'foo_bar' }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result!.params['search_0']).toBe('%foo\\_bar%')
    })

    it('builds NOT condition for negated SearchTermNode', () => {
      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop', negated: true }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result).not.toBeNull()
      expect(result!.condition).toMatch(/^NOT \(.+\)$/)
    })

    it('builds OR binary condition for SearchBinaryNode with OR operator', () => {
      const searchNode: SearchBinaryNode = {
        kind: 'SearchBinary',
        operator: 'OR',
        left: { kind: 'SearchTerm', value: 'laptop' },
        right: { kind: 'SearchTerm', value: 'tablet' },
      }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result).not.toBeNull()
      // Should have two separate LIKE conditions with different param indices
      expect(result!.condition).toContain('search_0')
      expect(result!.condition).toContain('search_1')
      expect(result!.params['search_0']).toBe('%laptop%')
      expect(result!.params['search_1']).toBe('%tablet%')
      // Top-level OR wrapping the two term conditions
      expect(result!.condition).toContain(' OR ')
    })

    it('builds AND binary condition for SearchBinaryNode with AND operator', () => {
      const searchNode: SearchBinaryNode = {
        kind: 'SearchBinary',
        operator: 'AND',
        left: { kind: 'SearchTerm', value: 'laptop' },
        right: { kind: 'SearchTerm', value: 'gaming' },
      }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result).not.toBeNull()
      expect(result!.condition).toContain('search_0')
      expect(result!.condition).toContain('search_1')
      expect(result!.condition).toContain(' AND ')
    })

    it('increments param counter across binary node children', () => {
      const searchNode: SearchBinaryNode = {
        kind: 'SearchBinary',
        operator: 'OR',
        left: { kind: 'SearchTerm', value: 'a' },
        right: { kind: 'SearchTerm', value: 'b' },
      }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result!.params).toHaveProperty('search_0')
      expect(result!.params).toHaveProperty('search_1')
      expect(Object.keys(result!.params)).toHaveLength(2)
    })

    it('throws ODataValidationError when entity has no searchable fields', () => {
      const dataSource = makeDataSource(ProductNoSearchable)
      const edmRegistry = makeEdmRegistry('Products', 'ProductNoSearchable')
      const providerNoFields = new TypeOrmSearchProvider(dataSource, edmRegistry)

      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      expect(() => providerNoFields.buildSearchCondition(searchNode, 'Products', 'entity')).toThrow(
        ODataValidationError,
      )
    })

    it('throws ODataValidationError with clear message when no searchable fields', () => {
      const dataSource = makeDataSource(ProductNoSearchable)
      const edmRegistry = makeEdmRegistry('Products', 'ProductNoSearchable')
      const providerNoFields = new TypeOrmSearchProvider(dataSource, edmRegistry)

      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      expect(() => providerNoFields.buildSearchCondition(searchNode, 'Products', 'entity')).toThrow(
        /No searchable fields configured for entity set 'Products'/,
      )
    })

    it('throws when entity set not found in registry', () => {
      const dataSource = makeDataSource(ProductWithSearchable)
      const edmRegistry = {
        getEntitySet: vi.fn().mockReturnValue(undefined),
      } as unknown as EdmRegistry
      const providerNoSet = new TypeOrmSearchProvider(dataSource, edmRegistry)

      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      expect(() => providerNoSet.buildSearchCondition(searchNode, 'Unknown', 'entity')).toThrow(
        ODataValidationError,
      )
    })

    it('throws when entity metadata not found in DataSource', () => {
      const dataSource = { entityMetadatas: [] } as unknown as DataSource
      const edmRegistry = makeEdmRegistry('Products', 'NonExistent')
      const providerNoMeta = new TypeOrmSearchProvider(dataSource, edmRegistry)

      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      expect(() => providerNoMeta.buildSearchCondition(searchNode, 'Products', 'entity')).toThrow(
        ODataValidationError,
      )
    })

    it('throws when entity target is not a function', () => {
      const dataSource = {
        entityMetadatas: [{ name: 'ProductWithSearchable', target: 'not-a-function' }],
      } as unknown as DataSource
      const edmRegistry = makeEdmRegistry('Products', 'ProductWithSearchable')
      const providerBadTarget = new TypeOrmSearchProvider(dataSource, edmRegistry)

      const searchNode: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
      expect(() =>
        providerBadTarget.buildSearchCondition(searchNode, 'Products', 'entity'),
      ).toThrow(ODataValidationError)
    })

    it('handles nested binary nodes (OR of two AND nodes)', () => {
      const searchNode: SearchNode = {
        kind: 'SearchBinary',
        operator: 'OR',
        left: {
          kind: 'SearchBinary',
          operator: 'AND',
          left: { kind: 'SearchTerm', value: 'laptop' },
          right: { kind: 'SearchTerm', value: 'gaming' },
        },
        right: { kind: 'SearchTerm', value: 'tablet' },
      }
      const result = provider.buildSearchCondition(searchNode, 'Products', 'entity')
      expect(result).not.toBeNull()
      expect(result!.params).toHaveProperty('search_0')
      expect(result!.params).toHaveProperty('search_1')
      expect(result!.params).toHaveProperty('search_2')
    })
  })
})
