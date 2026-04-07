import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { CsdlBuilder } from './csdl-builder.js'
import type { ODataModuleOptions } from '../odata.module.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { EdmEntitySet } from '../edm/edm-entity-set.js'
import type { EdmProperty, EdmNavigationProperty } from '../edm/edm-types.js'

const DEFAULT_OPTIONS: ODataModuleOptions = { serviceRoot: '/odata', namespace: 'Default' }

async function buildModule(
  options: ODataModuleOptions = DEFAULT_OPTIONS,
  entities: Array<{ type: EdmEntityType; set: EdmEntitySet }> = [],
) {
  const module = await Test.createTestingModule({
    providers: [EdmRegistry, CsdlBuilder, { provide: ODATA_MODULE_OPTIONS, useValue: options }],
  }).compile()

  const registry = module.get(EdmRegistry)
  for (const { type, set } of entities) {
    registry.register(type, set)
  }

  const builder = module.get(CsdlBuilder)
  return { builder, registry }
}

function makeEntityType(overrides: Partial<EdmEntityType> = {}): EdmEntityType {
  return {
    name: 'Product',
    namespace: 'Default',
    properties: [],
    navigationProperties: [],
    keyProperties: ['id'],
    isReadOnly: false,
    ...overrides,
  }
}

function makeEntitySet(overrides: Partial<EdmEntitySet> = {}): EdmEntitySet {
  return {
    name: 'Products',
    entityTypeName: 'Product',
    namespace: 'Default',
    isReadOnly: false,
    ...overrides,
  }
}

describe('CsdlBuilder', () => {
  it('Test 1: Empty registry → valid minimal EDMX with empty Schema and EntityContainer', async () => {
    const { builder } = await buildModule()
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('<edmx:Edmx')
    expect(xml).toContain('<Schema')
    expect(xml).toContain('<EntityContainer Name="Container"')
    expect(xml).toContain('</Schema>')
    expect(xml).toContain('</edmx:Edmx>')
  })

  it('Test 2: One EntityType with 3 properties → correct <EntityType> with <Property> elements, types, and Nullable attributes', async () => {
    const properties: EdmProperty[] = [
      { name: 'id', type: 'Edm.Int32', nullable: false },
      { name: 'name', type: 'Edm.String', nullable: false },
      { name: 'description', type: 'Edm.String', nullable: true },
    ]
    const type = makeEntityType({ properties, keyProperties: ['id'] })
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('<EntityType Name="Product">')
    expect(xml).toContain('Name="id" Type="Edm.Int32" Nullable="false"')
    expect(xml).toContain('Name="name" Type="Edm.String" Nullable="false"')
    expect(xml).toContain('Name="description" Type="Edm.String" Nullable="true"')
  })

  it('Test 3: EntityType with key property → <Key><PropertyRef Name="id"/></Key> inside EntityType', async () => {
    const type = makeEntityType({ keyProperties: ['id'] })
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('<Key>')
    expect(xml).toContain('<PropertyRef Name="id"/>')
    expect(xml).toContain('</Key>')
  })

  it('Test 4: EntitySet in EntityContainer references correct EntityType', async () => {
    const type = makeEntityType()
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('<EntitySet Name="Products" EntityType="Default.Product"/>')
  })

  it('Test 5: NavigationProperty ManyToOne → <NavigationProperty Name="category" Type="Default.Category" Nullable="true"/>', async () => {
    const navProps: EdmNavigationProperty[] = [
      { name: 'category', type: 'Default.Category', nullable: true, isCollection: false },
    ]
    const type = makeEntityType({ navigationProperties: navProps })
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain(
      '<NavigationProperty Name="category" Type="Default.Category" Nullable="true"/>',
    )
  })

  it('Test 6: NavigationProperty OneToMany → <NavigationProperty Name="orderItems" Type="Collection(Default.OrderItem)"/>', async () => {
    const navProps: EdmNavigationProperty[] = [
      {
        name: 'orderItems',
        type: 'Collection(Default.OrderItem)',
        nullable: false,
        isCollection: true,
      },
    ]
    const type = makeEntityType({ navigationProperties: navProps })
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain(
      '<NavigationProperty Name="orderItems" Type="Collection(Default.OrderItem)"/>',
    )
  })

  it('Test 7: Custom namespace → Schema Namespace="MyApp.Models", EntityType references use "MyApp.Models.Product"', async () => {
    const opts: ODataModuleOptions = { serviceRoot: '/odata', namespace: 'MyApp.Models' }
    const type = makeEntityType({ namespace: 'MyApp.Models' })
    const set = makeEntitySet({ namespace: 'MyApp.Models' })
    const { builder } = await buildModule(opts, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('Namespace="MyApp.Models"')
    expect(xml).toContain('EntityType="MyApp.Models.Product"')
  })

  it('Test 8: Property with precision/scale → <Property ... Precision="10" Scale="2"/>', async () => {
    const properties: EdmProperty[] = [
      { name: 'price', type: 'Edm.Decimal', nullable: false, precision: 10, scale: 2 },
    ]
    const type = makeEntityType({ properties, keyProperties: [] })
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('Precision="10"')
    expect(xml).toContain('Scale="2"')
  })

  it('Test 9: Root element contains xmlns:edmx and Version="4.0"', async () => {
    const { builder } = await buildModule()
    const xml = builder.buildCsdlXml()
    expect(xml).toContain('xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"')
    expect(xml).toContain('Version="4.0"')
  })

  it('Test 10: XML declaration present: <?xml version="1.0" encoding="UTF-8"?>', async () => {
    const { builder } = await buildModule()
    const xml = builder.buildCsdlXml()
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  })

  it('Test 11: CSDL XML is cached — second call returns identical string reference', async () => {
    const { builder } = await buildModule()
    const xml1 = builder.buildCsdlXml()
    const xml2 = builder.buildCsdlXml()
    expect(xml1).toBe(xml2)
  })

  it('Test 12: Does NOT contain Edm.DateTime (without Offset)', async () => {
    const properties: EdmProperty[] = [
      { name: 'createdAt', type: 'Edm.DateTimeOffset', nullable: false },
    ]
    const type = makeEntityType({ properties })
    const set = makeEntitySet()
    const { builder } = await buildModule(DEFAULT_OPTIONS, [{ type, set }])
    const xml = builder.buildCsdlXml()
    expect(xml).not.toMatch(/Edm\.DateTime[^O]/)
  })
})
