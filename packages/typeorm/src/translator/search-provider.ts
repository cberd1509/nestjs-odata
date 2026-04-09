import { Injectable } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { EdmRegistry, ODataValidationError, getSearchableProperties } from '@nestjs-odata/core'
import type {
  ISearchProvider,
  SearchNode,
  SearchTermNode,
  SearchBinaryNode,
} from '@nestjs-odata/core'

/**
 * TypeORM implementation of ISearchProvider.
 *
 * Builds parameterized LIKE conditions for $search queries.
 * Uses @ODataSearchable()-decorated properties to determine which fields to search.
 *
 * Search terms are parameterized (never interpolated) and LIKE special characters
 * (%, _) are escaped before use — mitigates T-11-04 SQL injection.
 *
 * If no @ODataSearchable fields are found, throws ODataValidationError with a
 * clear message instructing the developer to add the decorator.
 */
@Injectable()
export class TypeOrmSearchProvider implements ISearchProvider {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
  ) {}

  /**
   * Build a parameterized WHERE condition from a parsed $search AST node.
   *
   * @param searchNode - Parsed $search expression
   * @param entitySetName - OData entity set name being searched
   * @param alias - TypeORM QueryBuilder alias for the entity table
   * @returns Condition string + named params, or null if unable to build
   */
  buildSearchCondition(
    searchNode: SearchNode,
    entitySetName: string,
    alias: string,
  ): { condition: string; params: Record<string, unknown> } | null {
    const entityClass = this.resolveEntityClass(entitySetName)
    const searchableFields = entityClass ? getSearchableProperties(entityClass) : []

    if (searchableFields.length === 0) {
      throw new ODataValidationError(
        `No searchable fields configured for entity set '${entitySetName}'. Use @ODataSearchable() decorator on entity properties.`,
        entitySetName,
        '$search',
      )
    }

    const params: Record<string, unknown> = {}
    let paramCounter = 0

    const buildCondition = (node: SearchNode): string => {
      if (node.kind === 'SearchTerm') {
        return this.buildTermCondition(node, searchableFields, alias, params, paramCounter++)
      }
      // node is SearchBinaryNode here (discriminated union narrowing)
      return this.buildBinaryCondition(node, buildCondition)
    }

    const condition = buildCondition(searchNode)
    return { condition, params }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve the entity class from the EdmRegistry and DataSource metadata.
   */
  private resolveEntityClass(entitySetName: string): (new (...args: unknown[]) => unknown) | null {
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) return null

    const meta = this.dataSource.entityMetadatas.find((m) => m.name === entitySet.entityTypeName)
    if (!meta) return null

    const entityClass = meta.target
    if (typeof entityClass !== 'function') return null

    return entityClass as new (...args: unknown[]) => unknown
  }

  /**
   * Build a single LIKE condition for a search term across all searchable fields.
   * Fields are OR'd together: (alias.f1 LIKE :p OR alias.f2 LIKE :p)
   * Negated terms are wrapped: NOT (...)
   */
  private buildTermCondition(
    node: SearchTermNode,
    searchableFields: string[],
    alias: string,
    params: Record<string, unknown>,
    index: number,
  ): string {
    const paramName = `search_${index}`
    const escaped = this.escapeLike(node.value)
    params[paramName] = `%${escaped}%`

    const likeParts = searchableFields.map((field) => `${alias}.${field} LIKE :${paramName}`)
    const inner = `(${likeParts.join(' OR ')})`

    return node.negated ? `NOT ${inner}` : inner
  }

  /**
   * Build a binary AND/OR condition combining two recursively-built conditions.
   */
  private buildBinaryCondition(
    node: SearchBinaryNode,
    buildCondition: (n: SearchNode) => string,
  ): string {
    const leftCond = buildCondition(node.left)
    const rightCond = buildCondition(node.right)
    return `(${leftCond} ${node.operator} ${rightCond})`
  }

  /**
   * Escape LIKE special characters to prevent wildcard injection (T-11-04).
   * % -> \%, _ -> \_
   */
  private escapeLike(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  }
}
