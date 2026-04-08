import 'reflect-metadata'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DataSource, EntityMetadata, ColumnMetadata } from 'typeorm'
import type { EdmRegistry } from '@nestjs-odata/core'
import { ODataETag } from '@nestjs-odata/core'
import { TypeOrmETagProvider } from './typeorm-etag.provider.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeColumn(propertyName: string, overrides: Partial<ColumnMetadata> = {}): ColumnMetadata {
  return {
    propertyName,
    isUpdateDate: false,
    isVersion: false,
    isCreateDate: false,
    ...overrides,
  } as ColumnMetadata
}

function makeEntityMetadata(name: string, columns: ColumnMetadata[]): EntityMetadata {
  return {
    name,
    tableName: name.toLowerCase(),
    columns,
    target: Object, // will be overridden in specific tests
  } as unknown as EntityMetadata
}

function makeEdmRegistry(entityTypeName: string): EdmRegistry {
  return {
    getEntitySet: vi
      .fn()
      .mockReturnValue({ name: entityTypeName + 's', entityTypeName, namespace: 'Default' }),
    getEntityType: vi
      .fn()
      .mockReturnValue({
        name: entityTypeName,
        namespace: 'Default',
        properties: [],
        navigationProperties: [],
        keyProperties: ['id'],
        isReadOnly: false,
      }),
  } as unknown as EdmRegistry
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TypeOrmETagProvider', () => {
  describe('getETagColumn()', () => {
    it('Test 3: returns "updatedAt" when Product entity has @UpdateDateColumn on updatedAt', () => {
      class Product {
        id: number = 0
        name: string = ''
        updatedAt: Date = new Date()
      }

      const col = makeColumn('updatedAt', { isUpdateDate: true })
      const productMeta = { ...makeEntityMetadata('Product', [col]), target: Product }

      const dataSource = {
        getMetadata: vi.fn().mockReturnValue(productMeta),
        entityMetadatas: [productMeta],
      } as unknown as DataSource

      const edmRegistry = makeEdmRegistry('Product')

      const provider = new TypeOrmETagProvider(dataSource, edmRegistry)

      expect(provider.getETagColumn('Products')).toBe('updatedAt')
    })

    it('Test 4: returns "version" when Product has @ODataETag() on version (explicit override takes precedence)', () => {
      class Product {
        id: number = 0
        name: string = ''
        updatedAt: Date = new Date()

        @ODataETag()
        version: number = 0
      }

      const colUpdated = makeColumn('updatedAt', { isUpdateDate: true })
      const colVersion = makeColumn('version')
      const productMeta = {
        ...makeEntityMetadata('Product', [colUpdated, colVersion]),
        target: Product,
      }

      const dataSource = {
        getMetadata: vi.fn().mockReturnValue(productMeta),
        entityMetadatas: [productMeta],
      } as unknown as DataSource

      const edmRegistry = makeEdmRegistry('Product')

      const provider = new TypeOrmETagProvider(dataSource, edmRegistry)

      expect(provider.getETagColumn('Products')).toBe('version')
    })

    it('Test 5: returns undefined when Tag has neither @UpdateDateColumn nor @ODataETag', () => {
      class Tag {
        id: number = 0
        name: string = ''
      }

      const tagMeta = {
        ...makeEntityMetadata('Tag', [makeColumn('id'), makeColumn('name')]),
        target: Tag,
      }

      const dataSource = {
        getMetadata: vi.fn().mockReturnValue(tagMeta),
        entityMetadatas: [tagMeta],
      } as unknown as DataSource

      const edmRegistry = makeEdmRegistry('Tag')

      const provider = new TypeOrmETagProvider(dataSource, edmRegistry)

      expect(provider.getETagColumn('Tags')).toBeUndefined()
    })
  })

  describe('computeETag()', () => {
    let provider: TypeOrmETagProvider

    beforeEach(() => {
      class Tag {
        id = 0
      }
      const tagMeta = { ...makeEntityMetadata('Tag', [makeColumn('id')]), target: Tag }
      const dataSource = {
        entityMetadatas: [tagMeta],
      } as unknown as DataSource
      const edmRegistry = makeEdmRegistry('Tag')
      provider = new TypeOrmETagProvider(dataSource, edmRegistry)
    })

    it('Test 6: computeETag returns a weak ETag string: W/"..."', () => {
      const entity = { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') }
      const etag = provider.computeETag(entity, 'updatedAt')

      expect(etag).toMatch(/^W\/"[^"]+"\s*$/)
    })

    it('Test 7: computeETag with Date value produces consistent hash', () => {
      const date = new Date('2024-06-15T12:00:00.000Z')
      const entity = { id: 1, updatedAt: date }
      const etag1 = provider.computeETag(entity, 'updatedAt')
      const etag2 = provider.computeETag(entity, 'updatedAt')

      expect(etag1).toBe(etag2)
      expect(etag1).toMatch(/^W\/"[^"]+"\s*$/)
    })

    it('Test 8: computeETag with integer version column produces consistent hash', () => {
      const entity = { id: 1, version: 42 }
      const etag1 = provider.computeETag(entity, 'version')
      const etag2 = provider.computeETag(entity, 'version')

      expect(etag1).toBe(etag2)
      expect(etag1).toMatch(/^W\/"[^"]+"\s*$/)
      // Different version → different ETag
      const entity2 = { id: 1, version: 43 }
      const etag3 = provider.computeETag(entity2, 'version')
      expect(etag3).not.toBe(etag1)
    })
  })

  describe('validateIfMatch()', () => {
    let provider: TypeOrmETagProvider

    beforeEach(() => {
      class Tag {
        id = 0
      }
      const tagMeta = { ...makeEntityMetadata('Tag', [makeColumn('id')]), target: Tag }
      const dataSource = {
        entityMetadatas: [tagMeta],
      } as unknown as DataSource
      const edmRegistry = makeEdmRegistry('Tag')
      provider = new TypeOrmETagProvider(dataSource, edmRegistry)
    })

    it('validates matching ETags correctly', () => {
      const entity = { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') }
      const etag = provider.computeETag(entity, 'updatedAt')

      expect(provider.validateIfMatch(etag, entity, 'updatedAt')).toBe(true)
    })

    it('rejects stale ETags', () => {
      const entity = { id: 1, updatedAt: new Date('2024-01-01T00:00:00Z') }

      expect(provider.validateIfMatch('W/"stale-value"', entity, 'updatedAt')).toBe(false)
    })
  })
})
