/**
 * Tests for $search and $apply AST node types.
 * TDD RED phase: verify type-level contracts before implementation.
 */
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

// These imports will fail until the types are added to ast.ts
import type {
  SearchTermNode,
  SearchBinaryNode,
  SearchNode,
  ApplyFilterStep,
  AggregateExpression,
  ApplyGroupByStep,
  ApplyAggregateStep,
  ApplyStep,
  ApplyNode,
} from './ast.js'

// These imports will fail until files are created
import type { ODataQuery, ODataQueryResult } from '../query/odata-query.types.js'
import type { ISearchProvider } from '../interfaces/search.interface.js'
import { SEARCH_PROVIDER } from '../interfaces/search.interface.js'
import {
  ODataSearchable,
  getSearchableProperties,
} from '../decorators/odata-searchable.decorator.js'

describe('$search AST nodes', () => {
  it('SearchTermNode has kind SearchTerm, value string, optional negated boolean', () => {
    const node: SearchTermNode = {
      kind: 'SearchTerm',
      value: 'laptop',
    }
    expect(node.kind).toBe('SearchTerm')
    expect(node.value).toBe('laptop')
    expect(node.negated).toBeUndefined()
  })

  it('SearchTermNode with negated=true', () => {
    const node: SearchTermNode = {
      kind: 'SearchTerm',
      value: 'laptop',
      negated: true,
    }
    expect(node.negated).toBe(true)
  })

  it('SearchBinaryNode has kind SearchBinary, operator AND|OR, left/right SearchNode', () => {
    const left: SearchTermNode = { kind: 'SearchTerm', value: 'laptop' }
    const right: SearchTermNode = { kind: 'SearchTerm', value: 'tablet' }
    const node: SearchBinaryNode = {
      kind: 'SearchBinary',
      operator: 'OR',
      left,
      right,
    }
    expect(node.kind).toBe('SearchBinary')
    expect(node.operator).toBe('OR')
    expect(node.left).toBe(left)
    expect(node.right).toBe(right)
  })

  it('SearchNode is a union type of SearchTermNode | SearchBinaryNode', () => {
    const term: SearchNode = { kind: 'SearchTerm', value: 'laptop' }
    const binary: SearchNode = {
      kind: 'SearchBinary',
      operator: 'AND',
      left: { kind: 'SearchTerm', value: 'a' },
      right: { kind: 'SearchTerm', value: 'b' },
    }
    expect(term.kind).toBe('SearchTerm')
    expect(binary.kind).toBe('SearchBinary')
  })
})

describe('$apply AST nodes', () => {
  it('ApplyFilterStep has kind ApplyFilter and filter: FilterNode', () => {
    const step: ApplyFilterStep = {
      kind: 'ApplyFilter',
      filter: { kind: 'Literal', literalKind: 'boolean', value: true },
    }
    expect(step.kind).toBe('ApplyFilter')
    expect(step.filter).toBeDefined()
  })

  it('AggregateExpression has property, method, alias', () => {
    const expr: AggregateExpression = {
      property: 'Total',
      method: 'sum',
      alias: 'GrandTotal',
    }
    expect(expr.property).toBe('Total')
    expect(expr.method).toBe('sum')
    expect(expr.alias).toBe('GrandTotal')
  })

  it('ApplyGroupByStep has kind ApplyGroupBy, properties string[], optional aggregate', () => {
    const step: ApplyGroupByStep = {
      kind: 'ApplyGroupBy',
      properties: ['CustomerId'],
      aggregate: [{ property: '$count', method: 'count', alias: 'OrderCount' }],
    }
    expect(step.kind).toBe('ApplyGroupBy')
    expect(step.properties).toEqual(['CustomerId'])
    expect(step.aggregate).toHaveLength(1)
  })

  it('ApplyGroupByStep without aggregate is valid', () => {
    const step: ApplyGroupByStep = {
      kind: 'ApplyGroupBy',
      properties: ['Region'],
    }
    expect(step.aggregate).toBeUndefined()
  })

  it('ApplyAggregateStep has kind ApplyAggregate, expressions AggregateExpression[]', () => {
    const step: ApplyAggregateStep = {
      kind: 'ApplyAggregate',
      expressions: [{ property: 'Price', method: 'avg', alias: 'AvgPrice' }],
    }
    expect(step.kind).toBe('ApplyAggregate')
    expect(step.expressions).toHaveLength(1)
  })

  it('ApplyStep is a union of ApplyFilterStep | ApplyGroupByStep | ApplyAggregateStep', () => {
    const steps: ApplyStep[] = [
      {
        kind: 'ApplyFilter',
        filter: { kind: 'Literal', literalKind: 'boolean', value: true },
      },
      { kind: 'ApplyGroupBy', properties: ['Id'] },
      { kind: 'ApplyAggregate', expressions: [] },
    ]
    expect(steps).toHaveLength(3)
  })

  it('ApplyNode has steps: ApplyStep[]', () => {
    const node: ApplyNode = {
      steps: [{ kind: 'ApplyAggregate', expressions: [] }],
    }
    expect(node.steps).toHaveLength(1)
  })
})

describe('ODataQuery and ODataQueryResult extensions', () => {
  it('ODataQuery has optional search and apply fields', () => {
    const query: ODataQuery = {
      entitySetName: 'Products',
      search: { kind: 'SearchTerm', value: 'laptop' },
      apply: { steps: [] },
    }
    expect(query.search).toBeDefined()
    expect(query.apply).toBeDefined()
  })

  it('ODataQuery remains valid without search and apply', () => {
    const query: ODataQuery = { entitySetName: 'Products' }
    expect(query.search).toBeUndefined()
    expect(query.apply).toBeUndefined()
  })

  it('ODataQueryResult has optional isAggregated and applyProperties fields', () => {
    const result: ODataQueryResult = {
      items: [],
      isAggregated: true,
      applyProperties: ['CustomerId', 'OrderCount'],
    }
    expect(result.isAggregated).toBe(true)
    expect(result.applyProperties).toEqual(['CustomerId', 'OrderCount'])
  })

  it('ODataQueryResult remains valid without new fields', () => {
    const result: ODataQueryResult = { items: [] }
    expect(result.isAggregated).toBeUndefined()
    expect(result.applyProperties).toBeUndefined()
  })
})

describe('ISearchProvider and SEARCH_PROVIDER', () => {
  it('SEARCH_PROVIDER is a Symbol', () => {
    expect(typeof SEARCH_PROVIDER).toBe('symbol')
  })

  it('ISearchProvider has buildSearchCondition method signature', () => {
    // Verify the interface can be implemented
    const provider: ISearchProvider = {
      buildSearchCondition: (searchNode, entitySetName, alias) => {
        return { condition: `${alias}.name LIKE '%test%'`, params: {} }
      },
    }
    const result = provider.buildSearchCondition(
      { kind: 'SearchTerm', value: 'test' },
      'Products',
      'p',
    )
    expect(result).not.toBeNull()
    expect(result?.condition).toContain('LIKE')
  })

  it('ISearchProvider.buildSearchCondition can return null', () => {
    const provider: ISearchProvider = {
      buildSearchCondition: () => null,
    }
    expect(provider.buildSearchCondition({ kind: 'SearchTerm', value: 'x' }, 'E', 'e')).toBeNull()
  })
})

describe('@ODataSearchable decorator', () => {
  it('getSearchableProperties returns empty array when no decorator applied', () => {
    class NoSearchableEntity {
      id: number = 0
      name: string = ''
    }
    expect(getSearchableProperties(NoSearchableEntity)).toEqual([])
  })

  it('@ODataSearchable() stores property name via Reflect.getMetadata', () => {
    class ProductEntity {
      @ODataSearchable()
      name: string = ''
    }
    const props = getSearchableProperties(ProductEntity)
    expect(props).toContain('name')
  })

  it('getSearchableProperties returns all decorated property names', () => {
    class ArticleEntity {
      @ODataSearchable()
      name: string = ''

      @ODataSearchable()
      description: string = ''

      id: number = 0
    }
    const props = getSearchableProperties(ArticleEntity)
    expect(props).toContain('name')
    expect(props).toContain('description')
    expect(props).toHaveLength(2)
  })
})
