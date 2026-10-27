import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { CsdlBuilder } from './csdl-builder.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { EdmEntitySet } from '../edm/edm-entity-set.js'

const CORE_INCLUDE = '<edmx:Include Namespace="Org.OData.Core.V1" Alias="Core"/>'

async function csdl(type: Partial<EdmEntityType>, set: Partial<EdmEntitySet>): Promise<string> {
  const module = await Test.createTestingModule({
    providers: [
      EdmRegistry,
      CsdlBuilder,
      { provide: ODATA_MODULE_OPTIONS, useValue: { serviceRoot: '/odata', namespace: 'Default' } },
    ],
  }).compile()
  module.get(EdmRegistry).register(
    {
      name: 'Product',
      namespace: 'Default',
      properties: [],
      navigationProperties: [],
      keyProperties: ['id'],
      isReadOnly: false,
      ...type,
    },
    {
      name: 'Products',
      entityTypeName: 'Product',
      namespace: 'Default',
      isReadOnly: false,
      ...set,
    },
  )
  return module.get(CsdlBuilder).buildCsdlXml()
}

describe('CsdlBuilder — Core vocabulary annotations (#75, #80)', () => {
  it('annotates computed properties with Core.Computed and references the Core vocabulary', async () => {
    const xml = await csdl(
      {
        properties: [
          { name: 'id', type: 'Edm.Int32', nullable: false },
          { name: 'updatedAt', type: 'Edm.DateTimeOffset', nullable: false, computed: true },
        ],
      },
      {},
    )
    expect(xml).toContain(CORE_INCLUDE)
    expect(xml).toMatch(
      /<Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false">\s*<Annotation Term="Core.Computed" Bool="true"\/>\s*<\/Property>/,
    )
    expect(xml).toContain('<Property Name="id" Type="Edm.Int32" Nullable="false"/>')
    // The reference precedes edmx:DataServices (CSDL XML §3.3).
    expect(xml.indexOf('edmx:Reference')).toBeLessThan(xml.indexOf('edmx:DataServices'))
  })

  it('annotates entity sets that require If-Match with Core.OptimisticConcurrency', async () => {
    const xml = await csdl({}, { optimisticConcurrency: ['updatedAt'] })
    expect(xml).toContain(CORE_INCLUDE)
    expect(xml).toMatch(
      /<EntitySet Name="Products" EntityType="Default.Product">\s*<Annotation Term="Core.OptimisticConcurrency">\s*<Collection>\s*<PropertyPath>updatedAt<\/PropertyPath>\s*<\/Collection>\s*<\/Annotation>\s*<\/EntitySet>/,
    )
  })

  it('an ETag computed by a function gives an empty OptimisticConcurrency collection', async () => {
    const xml = await csdl({}, { optimisticConcurrency: [] })
    expect(xml).toMatch(
      /<Annotation Term="Core.OptimisticConcurrency">\s*<Collection\/>\s*<\/Annotation>/,
    )
  })

  it('adds no vocabulary reference when nothing is annotated', async () => {
    const xml = await csdl({}, {})
    expect(xml).not.toContain('edmx:Reference')
    expect(xml).toContain('<EntitySet Name="Products" EntityType="Default.Product"/>')
  })
})
