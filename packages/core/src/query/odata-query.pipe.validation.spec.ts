/**
 * ODataQueryPipe against a real EdmRegistry: validation of every filter node kind, lambdas,
 * navigation targets that are not exposed, per-entity security options and the
 * $search / $apply options.
 */
import { describe, it, expect } from 'vitest'
import type { ArgumentMetadata } from '@nestjs/common'
import { ODataQueryPipe } from './odata-query.pipe.js'
import { ODataValidationError } from './odata-validation.error.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'

const product: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Name', type: 'Edm.String', nullable: false },
    { name: 'Price', type: 'Edm.Decimal', nullable: false },
  ],
  navigationProperties: [
    { name: 'Category', type: 'Default.Category', nullable: true, isCollection: false },
    { name: 'Tags', type: 'Collection(Default.Tag)', nullable: true, isCollection: true },
    { name: 'Secrets', type: 'Collection(Default.Secret)', nullable: true, isCollection: true },
    { name: 'Vault', type: 'Default.Secret', nullable: true, isCollection: false },
  ],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const category: EdmEntityType = {
  name: 'Category',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Title', type: 'Edm.String', nullable: false },
  ],
  navigationProperties: [],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const tag: EdmEntityType = {
  name: 'Tag',
  namespace: 'Default',
  properties: [
    { name: 'Id', type: 'Edm.Int32', nullable: false },
    { name: 'Label', type: 'Edm.String', nullable: false },
  ],
  navigationProperties: [],
  keyProperties: ['Id'],
  isReadOnly: false,
}

const options = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 100,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
} as unknown as ODataModuleResolvedOptions

function setup(): { pipe: ODataQueryPipe; registry: EdmRegistry } {
  const registry = new EdmRegistry()
  for (const type of [product, category, tag]) {
    registry.register(type, {
      name: `${type.name}s`,
      entityTypeName: type.name,
      namespace: 'Default',
      isReadOnly: false,
    })
  }
  return { pipe: new ODataQueryPipe(registry, options), registry }
}

const products: ArgumentMetadata = { type: 'query', metatype: undefined, data: 'Products' }

describe('ODataQueryPipe validation with a real registry', () => {
  it('validates the operand of not and the arguments of function calls', () => {
    const { pipe } = setup()
    expect(() => pipe.transform({ $filter: 'not (Missing eq 1)' }, products)).toThrow(
      "Property 'Missing' not found on entity 'Product'",
    )
    expect(() => pipe.transform({ $filter: "contains(Missing,'a')" }, products)).toThrow(
      "Property 'Missing' not found on entity 'Product'",
    )
    expect(pipe.transform({ $filter: "not contains(Name,'a')" }, products).filter).toMatchObject({
      kind: 'UnaryExpr',
      operator: 'not',
    })
  })

  it('accepts a lambda without a predicate (Tags/any())', () => {
    const { pipe } = setup()
    expect(pipe.transform({ $filter: 'Tags/any()' }, products).filter).toMatchObject({
      kind: 'LambdaExpr',
      predicate: null,
    })
  })

  it('validates lambda variable paths against the collection type', () => {
    const { pipe } = setup()
    expect(() => pipe.transform({ $filter: "Tags/any(t:t/Name eq 'x')" }, products)).toThrow(
      "Property 'Name' not found on entity 'Tag'",
    )
    expect(
      pipe.transform({ $filter: "Tags/all(t:t/Label eq 'x')" }, products).filter,
    ).toMatchObject({ kind: 'LambdaExpr', operator: 'all' })
  })

  it('validates a lambda over a collection whose type is not exposed against the source type', () => {
    const { pipe } = setup()
    // Without a registered target type, `s/...` paths cannot be resolved: they are checked
    // against Product and rejected instead of passing through unvalidated.
    expect(() => pipe.transform({ $filter: 'Secrets/any(s:s/Code eq 1)' }, products)).toThrow(
      ODataValidationError,
    )
  })

  it('rejects any/all on a single-valued navigation property', () => {
    const { pipe } = setup()
    expect(() => pipe.transform({ $filter: 'Category/any(c:c/Title eq 1)' }, products)).toThrow(
      /'Category' is not a collection-valued navigation property of 'Product'/,
    )
  })

  it('rejects a path through a navigation property whose type is not exposed', () => {
    const { pipe } = setup()
    expect(() => pipe.transform({ $filter: 'Vault/Code eq 1' }, products)).toThrow(
      "Navigation property 'Vault' of 'Product' targets a type that is not exposed by the service",
    )
  })

  it('rejects a path through a structural property', () => {
    const { pipe } = setup()
    expect(() => pipe.transform({ $filter: 'Name/Length eq 1' }, products)).toThrow(
      /Property 'Name' of entity 'Product' is not a navigation property/,
    )
  })

  it('leaves the nested options of an expand whose target is not exposed unvalidated', () => {
    const { pipe } = setup()
    const result = pipe.transform({ $expand: 'Vault($select=Anything)' }, products)
    expect(result.expand?.items[0]).toMatchObject({
      navigationProperty: 'Vault',
      select: { items: [{ path: ['Anything'] }] },
    })
  })

  it('rejects $levels > 1 on a non-recursive navigation property', () => {
    const { pipe } = setup()
    expect(() => pipe.transform({ $expand: 'Category($levels=2)' }, products)).toThrow(
      /is not recursive/,
    )
  })

  it('ignores empty $select items', () => {
    const { pipe } = setup()
    const result = pipe.transform({ $select: 'Name,,Price' }, products)
    expect(result.select?.items).toHaveLength(3)
  })

  it('applies a per-entity maxTop override before the global one', () => {
    const { pipe, registry } = setup()
    registry.setEntitySecurityOptions('Products', { maxTop: 5 })
    expect(registry.getEntitySecurityOptions('Products')).toEqual({ maxTop: 5 })
    expect(() => pipe.transform({ $top: '6' }, products)).toThrow(
      '$top value 6 exceeds maximum of 5',
    )
    expect(pipe.transform({ $top: '5' }, products).top).toBe(5)
    // Other entity sets keep the global limit.
    expect(
      pipe.transform({ $top: '50' }, { type: 'query', metatype: undefined, data: 'Tags' }).top,
    ).toBe(50)
  })

  it('parses $search and $apply (URL-decoded) into their ASTs', () => {
    const { pipe } = setup()
    const result = pipe.transform(
      { $search: 'blue%20OR%20red', $apply: 'aggregate(Price%20with%20sum%20as%20Total)' },
      products,
    )
    expect(result.search).toMatchObject({ kind: 'SearchBinary', operator: 'OR' })
    expect(result.apply?.steps[0]).toMatchObject({ kind: 'ApplyAggregate' })
  })

  it('skips validation when no entity set is given, or it is not registered', () => {
    const { pipe } = setup()
    const anonymous = pipe.transform(
      { $filter: 'Anything eq 1' },
      { type: 'query', metatype: undefined },
    )
    expect(anonymous.entitySetName).toBe('')
    expect(anonymous.filter).toBeDefined()
    const unknown = pipe.transform(
      { $filter: 'Anything eq 1' },
      { type: 'query', metatype: undefined, data: 'Unknowns' },
    )
    expect(unknown.filter).toBeDefined()
  })

  it('skips validation when the entity set has no registered type', () => {
    const registry = new EdmRegistry()
    registry.register(
      { ...tag, name: 'Other' },
      { name: 'Orphans', entityTypeName: 'Ghost', namespace: 'Default', isReadOnly: false },
    )
    const pipe = new ODataQueryPipe(registry, options)
    const result = pipe.transform(
      { $filter: 'Anything eq 1' },
      { type: 'query', metatype: undefined, data: 'Orphans' },
    )
    expect(result.filter).toBeDefined()
  })
})
