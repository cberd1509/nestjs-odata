/**
 * ODataQueryPipe — OData 4.01 query conformance (#66, #68, #69):
 * navigation paths in $filter, lambdas, nested $expand $count / /$count / $search / $levels.
 */
import { describe, it, expect } from 'vitest'
import type { ArgumentMetadata } from '@nestjs/common'
import { ODataQueryPipe } from './odata-query.pipe.js'
import { ODataValidationError } from './odata-validation.error.js'
import { ODataNotImplementedError } from '../parser/errors.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { EdmRegistry } from '../edm/edm-registry.js'
import type { ExpandItem } from '../parser/ast.js'

function type(
  name: string,
  props: string[],
  navs: { name: string; target: string; many?: boolean }[] = [],
): EdmEntityType {
  return {
    name,
    namespace: 'Default',
    properties: props.map((p) => ({ name: p, type: 'Edm.String', nullable: true })),
    navigationProperties: navs.map((n) => ({
      name: n.name,
      type: n.many ? `Collection(Default.${n.target})` : `Default.${n.target}`,
      nullable: true,
      isCollection: n.many === true,
    })),
    keyProperties: ['id'],
    isReadOnly: false,
  }
}

const types: Record<string, EdmEntityType> = {
  Product: type(
    'Product',
    ['id', 'name'],
    [
      { name: 'category', target: 'Category' },
      { name: 'reviews', target: 'Review', many: true },
    ],
  ),
  Category: type('Category', ['id', 'name'], [{ name: 'group', target: 'Group' }]),
  Group: type('Group', ['id', 'title']),
  Review: type('Review', ['id', 'stars'], [{ name: 'author', target: 'Author' }]),
  Author: type('Author', ['id', 'name']),
  Employee: type(
    'Employee',
    ['id', 'name'],
    [
      { name: 'manager', target: 'Employee' },
      { name: 'reports', target: 'Employee', many: true },
      { name: 'category', target: 'Category' },
    ],
  ),
}

const sets: Record<string, string> = { Products: 'Product', Employees: 'Employee' }

const registry = {
  getEntityType: (name: string) => types[name],
  getEntitySet: (name: string) =>
    sets[name] ? { name, entityTypeName: sets[name], namespace: 'Default' } : undefined,
  getEntitySecurityOptions: () => undefined,
}

const options = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 100,
  maxExpandDepth: 4,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip' as const,
}

const pipe = new ODataQueryPipe(registry as unknown as EdmRegistry, options)
const products: ArgumentMetadata = { type: 'query', data: 'Products' }
const employees: ArgumentMetadata = { type: 'query', data: 'Employees' }

describe('navigation paths in $filter (#66, P2 §5.1.1.15)', () => {
  it('accepts a single-valued navigation path', () => {
    const q = pipe.transform({ $filter: "category/name eq 'Tools'" }, products)
    expect(q.filter?.kind).toBe('BinaryExpr')
  })

  it('accepts a multi-segment single-valued path', () => {
    expect(() => pipe.transform({ $filter: "category/group/title eq 'x'" }, products)).not.toThrow()
  })

  it('validates the last segment against the navigation target', () => {
    expect(() => pipe.transform({ $filter: "category/nope eq 'x'" }, products)).toThrow(
      "Property 'nope' not found on entity 'Category'",
    )
  })

  it('rejects an unknown navigation segment', () => {
    expect(() => pipe.transform({ $filter: "nope/name eq 'x'" }, products)).toThrow(
      ODataValidationError,
    )
  })

  it('requires any/all for a collection-valued navigation', () => {
    expect(() => pipe.transform({ $filter: 'reviews/stars eq 1' }, products)).toThrow(
      /collection-valued.*any\/all/i,
    )
  })

  it('rejects a path continuing after a structural property', () => {
    expect(() => pipe.transform({ $filter: "name/foo eq 'x'" }, products)).toThrow(
      ODataValidationError,
    )
  })

  it('accepts navigation paths after the lambda variable', () => {
    expect(() =>
      pipe.transform({ $filter: "reviews/any(r: r/author/name eq 'x')" }, products),
    ).not.toThrow()
    expect(() =>
      pipe.transform({ $filter: "reviews/any(r: r/author/nope eq 'x')" }, products),
    ).toThrow("Property 'nope' not found on entity 'Author'")
  })

  it('accepts navigation paths in nested $expand filters', () => {
    expect(() =>
      pipe.transform({ $expand: "reviews($filter=author/name eq 'x')" }, products),
    ).not.toThrow()
  })

  it('answers 501 for navigation paths in $orderby', () => {
    expect(() => pipe.transform({ $orderby: 'category/name' }, products)).toThrow(
      ODataNotImplementedError,
    )
  })
})

describe('lambdas (#68)', () => {
  it('accepts uppercase ANY and $it', () => {
    expect(() =>
      pipe.transform({ $filter: 'reviews/ANY(r: r/stars gt $it/name)' }, products),
    ).not.toThrow()
  })

  it('rejects a lambda over something that is not a collection-valued navigation', () => {
    expect(() => pipe.transform({ $filter: 'category/any(c: c/name eq 1)' }, products)).toThrow(
      ODataValidationError,
    )
    expect(() => pipe.transform({ $filter: 'nope/any(c: c/name eq 1)' }, products)).toThrow(
      ODataValidationError,
    )
  })
})

describe('nested $expand options (#69, P2 §5.1.3)', () => {
  it('passes nested $count and $search through', () => {
    const q = pipe.transform({ $expand: 'reviews($count=true;$search=good)' }, products)
    expect(q.expand?.items[0]).toMatchObject({ count: true, search: { value: 'good' } })
  })

  it('rejects $count and /$count on a single-valued navigation', () => {
    expect(() => pipe.transform({ $expand: 'category($count=true)' }, products)).toThrow(
      ODataValidationError,
    )
    expect(() => pipe.transform({ $expand: 'category/$count' }, products)).toThrow(
      ODataValidationError,
    )
  })

  it('accepts reviews/$count', () => {
    const q = pipe.transform({ $expand: 'reviews/$count' }, products)
    expect(q.expand?.items[0]).toMatchObject({ navigationProperty: 'reviews', countOnly: true })
  })

  it('expands $levels into nested expands, repeating the options at each level', () => {
    const q = pipe.transform({ $expand: 'manager($levels=3;$select=name)' }, employees)
    const level1 = q.expand!.items[0]
    expect(level1.levels).toBeUndefined()
    expect(level1.select?.items).toEqual([{ path: ['name'] }])
    const level2 = level1.expand!.items[0]
    expect(level2).toMatchObject({ navigationProperty: 'manager', select: level1.select })
    const level3 = level2.expand!.items[0]
    expect(level3.navigationProperty).toBe('manager')
    expect(level3.expand).toBeUndefined()
  })

  it('keeps other nested expands at every level', () => {
    const q = pipe.transform({ $expand: 'reports($levels=2;$expand=category)' }, employees)
    const level1 = q.expand!.items[0]
    expect(level1.expand!.items.map((i: ExpandItem) => i.navigationProperty)).toEqual([
      'category',
      'reports',
    ])
    const level2 = level1.expand!.items[1]
    expect(level2.expand!.items.map((i: ExpandItem) => i.navigationProperty)).toEqual(['category'])
  })

  it('resolves $levels=max to the remaining expansion depth', () => {
    const q = pipe.transform({ $expand: 'manager($levels=max)' }, employees)
    let depth = 0
    let item: ExpandItem | undefined = q.expand!.items[0]
    while (item) {
      depth++
      item = item.expand?.items[0]
    }
    expect(depth).toBe(options.maxExpandDepth)
  })

  it('treats $levels=1 on a non-recursive navigation as a plain expand', () => {
    const q = pipe.transform({ $expand: 'category($levels=1)' }, products)
    expect(q.expand!.items[0]).toEqual({ navigationProperty: 'category' })
  })

  it('rejects $levels > 1 on a non-recursive navigation', () => {
    expect(() => pipe.transform({ $expand: 'category($levels=2)' }, products)).toThrow(/\$levels/)
  })

  it('rejects $levels beyond the expansion depth limit before building the levels', () => {
    expect(() => pipe.transform({ $expand: 'manager($levels=100000000)' }, employees)).toThrow(
      /exceeds the \$expand depth limit/,
    )
  })

  it('answers 501 for $it in $expand options', () => {
    expect(() =>
      pipe.transform({ $expand: 'reviews($filter=$it/name eq stars)' }, products),
    ).toThrow(ODataNotImplementedError)
  })
})
