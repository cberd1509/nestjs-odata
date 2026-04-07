import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { EdmType, getEdmTypeOverrides } from './edm-type.decorator.js'
import { ODataExclude, getExcludedProperties } from './odata-exclude.decorator.js'
import { ODataEntitySet, getEntitySetName } from './odata-entity-set.decorator.js'
import { ODataKey, getKeyProperties } from './odata-key.decorator.js'
import { ODataView, getODataViewOptions } from './odata-view.decorator.js'

describe('OData Decorators', () => {
  it('Test 1: @EdmType stores metadata retrievable via Reflect.getMetadata', () => {
    class Product {
      @EdmType({ type: 'Edm.Decimal', precision: 10, scale: 2 })
      price: number = 0
    }

    const overrides = getEdmTypeOverrides(Product)
    expect(overrides['price']).toEqual({ type: 'Edm.Decimal', precision: 10, scale: 2 })
  })

  it('Test 2: @ODataExclude stores property name in the exclude set', () => {
    class Order {
      @ODataExclude()
      internalNote: string = ''
    }

    const excluded = getExcludedProperties(Order)
    expect(excluded.has('internalNote')).toBe(true)
  })

  it('Test 3: @ODataEntitySet stores custom name retrievable via helper', () => {
    @ODataEntitySet('CustomProducts')
    class Product {}

    const name = getEntitySetName(Product)
    expect(name).toBe('CustomProducts')
  })

  it('Test 4: @ODataKey stores property in the key property list', () => {
    class Customer {
      @ODataKey()
      id: string = ''
    }

    const keys = getKeyProperties(Customer)
    expect(keys).toContain('id')
  })

  it('Test 5: class with no @ODataEntitySet returns undefined', () => {
    class Undecorated {}
    expect(getEntitySetName(Undecorated)).toBeUndefined()
  })

  it('Test 6: @ODataView stores virtual view metadata', () => {
    @ODataView({ sourceEntity: 'Product', exposedProperties: ['id', 'name', 'price'] })
    class ProductSummary {}

    const opts = getODataViewOptions(ProductSummary)
    expect(opts).toBeDefined()
    expect(opts?.sourceEntity).toBe('Product')
    expect(opts?.exposedProperties).toEqual(['id', 'name', 'price'])
  })

  it('Test 7: multiple @EdmType decorators on different properties are all retrievable', () => {
    class Invoice {
      @EdmType({ type: 'Edm.Decimal', precision: 18, scale: 4 })
      amount: number = 0

      @EdmType({ type: 'Edm.DateTimeOffset' })
      createdAt: Date = new Date()

      @EdmType({ type: 'Edm.String', maxLength: 500 })
      description: string = ''
    }

    const overrides = getEdmTypeOverrides(Invoice)
    expect(overrides['amount']).toEqual({ type: 'Edm.Decimal', precision: 18, scale: 4 })
    expect(overrides['createdAt']).toEqual({ type: 'Edm.DateTimeOffset' })
    expect(overrides['description']).toEqual({ type: 'Edm.String', maxLength: 500 })
  })
})
