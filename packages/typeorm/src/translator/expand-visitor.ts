import type { SelectQueryBuilder, ObjectLiteral } from 'typeorm'
import type { ExpandNode, ExpandItem, EdmEntityType } from '@nestjs-odata/core'
import { ODataValidationError } from '@nestjs-odata/core'
import type { EdmRegistry } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import { TypeOrmSelectVisitor } from './select-visitor.js'
import { TypeOrmOrderByVisitor } from './orderby-visitor.js'

/**
 * TypeOrmExpandVisitor — translates $expand AST nodes into TypeORM
 * leftJoinAndSelect calls. Supports nested expand with depth tracking.
 *
 * Per D-09: Uses JOINs, NOT lazy loading — one SQL query.
 * Per D-07: Enforces maxExpandDepth.
 * Per D-10: Validates navigation property names against EDM.
 * Per D-13: Records $top/$skip per expand item in expandPaginationMap for
 *   post-JOIN in-memory slicing by TypeOrmQueryTranslator after getMany().
 *
 * Alias convention: `{parentAlias}_{navigationProperty}` — unique per level
 * to prevent TypeORM alias collision when the same nav prop appears at
 * different tree paths.
 */
export class TypeOrmExpandVisitor {
  /**
   * Records per-navigation-property $top/$skip values for post-JOIN slicing.
   * Populated during apply() calls. Consumed by TypeOrmQueryTranslator after
   * getMany() via applyExpandPagination().
   */
  readonly expandPaginationMap = new Map<string, { skip?: number; top?: number }>()

  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly edmRegistry: EdmRegistry,
    private readonly maxExpandDepth: number,
  ) {}

  /**
   * Apply an ExpandNode to the SelectQueryBuilder starting from parentAlias.
   *
   * @param expandNode   - The $expand AST node to process
   * @param parentAlias  - The QueryBuilder alias for the parent entity (e.g. 'entity')
   * @param entityType   - EDM entity type of the parent (for validation)
   * @param currentDepth - Current recursion depth (0 = top-level expand)
   */
  apply(
    expandNode: ExpandNode,
    parentAlias: string,
    entityType: EdmEntityType,
    currentDepth: number,
  ): void {
    if (currentDepth >= this.maxExpandDepth) {
      throw new ODataValidationError(
        `$expand depth limit of ${this.maxExpandDepth} exceeded`,
        entityType.name,
        '$expand',
      )
    }

    for (const item of expandNode.items) {
      this.applyExpandItem(item, parentAlias, entityType, currentDepth)
    }
  }

  private applyExpandItem(
    item: ExpandItem,
    parentAlias: string,
    entityType: EdmEntityType,
    currentDepth: number,
  ): void {
    // Validate against EDM navigation properties (D-10, T-04-09)
    const navProp = entityType.navigationProperties.find(
      (np) => np.name === item.navigationProperty,
    )
    if (!navProp) {
      throw new ODataValidationError(
        `'${item.navigationProperty}' is not a navigation property of '${entityType.name}'`,
        entityType.name,
        item.navigationProperty,
      )
    }

    // Build unique alias: parentAlias_navigationProperty
    const joinAlias = `${parentAlias}_${item.navigationProperty}`
    this.qb.leftJoinAndSelect(`${parentAlias}.${item.navigationProperty}`, joinAlias)

    // Resolve the target entity type for nested query options
    const targetEntityType = this.edmRegistry.getEntityType(navProp.type)

    // Apply nested query options on the joined relation
    if (item.filter && targetEntityType) {
      new TypeOrmFilterVisitor(this.qb, joinAlias, targetEntityType).visit(item.filter)
    }
    if (item.select && targetEntityType) {
      new TypeOrmSelectVisitor(this.qb, joinAlias, targetEntityType).apply(item.select)
    }
    if (item.orderBy?.length) {
      new TypeOrmOrderByVisitor(this.qb, joinAlias).apply(item.orderBy)
    }

    // Per D-13: Record $top/$skip for post-JOIN in-memory slicing after getMany().
    // Only collections can be paginated — single-valued nav props are not arrays.
    if ((item.top !== undefined || item.skip !== undefined) && navProp.isCollection) {
      this.expandPaginationMap.set(item.navigationProperty, {
        skip: item.skip,
        top: item.top,
      })
    }

    // Recursive nested expand (D-07)
    if (item.expand && targetEntityType) {
      this.apply(item.expand, joinAlias, targetEntityType, currentDepth + 1)
    }
  }
}
