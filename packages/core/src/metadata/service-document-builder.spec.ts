import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { ServiceDocumentBuilder } from './service-document-builder.js'
import type { ODataModuleOptions } from '../odata.module.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { EdmEntitySet } from '../edm/edm-entity-set.js'

const DEFAULT_OPTIONS: ODataModuleOptions = { serviceRoot: '/odata', namespace: 'Default' }

async function buildModule(
  options: ODataModuleOptions = DEFAULT_OPTIONS,
  entities: Array<{ type: EdmEntityType; set: EdmEntitySet }> = [],
) {
  const module = await Test.createTestingModule({
    providers: [
      EdmRegistry,
      ServiceDocumentBuilder,
      { provide: ODATA_MODULE_OPTIONS, useValue: options },
    ],
  }).compile()

  const registry = module.get(EdmRegistry)
  for (const { type, set } of entities) {
    registry.register(type, set)
  }

  return module.get(ServiceDocumentBuilder)
}

function makeType(name: string): EdmEntityType {
  return {
    name,
    namespace: 'Default',
    properties: [],
    navigationProperties: [],
    keyProperties: [],
    isReadOnly: false,
  }
}

function makeSet(name: string, typeName: string): EdmEntitySet {
  return { name, entityTypeName: typeName, namespace: 'Default', isReadOnly: false }
}

describe('ServiceDocumentBuilder', () => {
  it('Test 11: Returns JSON with @odata.context pointing to $metadata', async () => {
    const builder = await buildModule()
    const doc = builder.buildServiceDocument()
    expect(doc['@odata.context']).toBe('/odata/$metadata')
  })

  it('Test 12: value array contains one entry per EntitySet with name and url', async () => {
    const entities = [
      { type: makeType('Product'), set: makeSet('Products', 'Product') },
      { type: makeType('Category'), set: makeSet('Categories', 'Category') },
    ]
    const builder = await buildModule(DEFAULT_OPTIONS, entities)
    const doc = builder.buildServiceDocument()
    const value = doc['value'] as Array<{ name: string; url: string; kind: string }>
    expect(value).toHaveLength(2)
    expect(value[0]).toEqual({ name: 'Products', url: 'Products', kind: 'EntitySet' })
    expect(value[1]).toEqual({ name: 'Categories', url: 'Categories', kind: 'EntitySet' })
  })

  it('Test 13: Empty registry → value is empty array', async () => {
    const builder = await buildModule()
    const doc = builder.buildServiceDocument()
    expect(doc['value']).toEqual([])
  })
})
