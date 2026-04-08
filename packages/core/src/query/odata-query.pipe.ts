import { Inject, Injectable } from '@nestjs/common'
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common'
import { parseQuery } from '../parser/parser.js'
import { parseSearch } from '../parser/search-parser.js'
import { parseApply } from '../parser/apply-parser.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { ODataQuery } from './odata-query.types.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { FilterNode, SelectItem, ExpandNode, SearchNode, ApplyNode } from '../parser/ast.js'
import { ODataValidationError } from './odata-validation.error.js'

/**
 * ODataQueryPipe — NestJS PipeTransform that converts raw Express query params
 * (req.query as Record<string, string>) into a typed, validated ODataQuery.
 *
 * Per threat model T-03-01: validates all $filter/$select/$orderby property
 * references against EdmRegistry. Unknown properties throw ODataValidationError.
 *
 * Per threat model T-03-03: clamps $top to maxTop from ODataModuleResolvedOptions.
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
@Injectable()
export class ODataQueryPipe implements PipeTransform<Record<string, string>, ODataQuery> {
  constructor(
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
  ) {}

  transform(value: Record<string, string>, metadata: ArgumentMetadata): ODataQuery {
    // metadata.data carries the entitySetName passed by @ODataQuery(entitySetName)
    const entitySetName = metadata.data ?? ''

    // Reconstruct query string from the Record entries (handling $count, $search, $apply separately)
    const parts: string[] = []
    let count = false
    let search: SearchNode | undefined
    let apply: ApplyNode | undefined

    for (const [key, val] of Object.entries(value)) {
      const lkey = key.toLowerCase()
      if (lkey === '$count') {
        count = val === 'true'
      } else if (lkey === '$search') {
        search = parseSearch(decodeURIComponent(val))
      } else if (lkey === '$apply') {
        apply = parseApply(decodeURIComponent(val))
      } else {
        parts.push(`${key}=${val}`)
      }
    }

    const queryString = parts.join('&')

    // Parse into QueryOptions (filter AST, select, orderBy, top, skip)
    const parsed = parseQuery(queryString)

    // Enforce maxTop: reject (HTTP 400) when $top exceeds the limit (per D-05, SEC-01)
    // Per-entity override takes precedence over global options (per D-07)
    const entitySecOpts = this.edmRegistry.getEntitySecurityOptions(entitySetName)
    const effectiveMaxTop = entitySecOpts?.maxTop ?? this.options.maxTop
    const top = parsed.top
    if (top !== undefined && top > effectiveMaxTop) {
      throw new ODataValidationError(
        `$top value ${top} exceeds maximum of ${effectiveMaxTop}`,
        entitySetName,
        '$top',
      )
    }

    // Validate field names against EdmRegistry when we have an entity set
    if (entitySetName) {
      const entitySet = this.edmRegistry.getEntitySet(entitySetName)
      if (entitySet) {
        const entityType = this.edmRegistry.getEntityType(entitySet.entityTypeName)
        if (entityType) {
          // Validate $filter property references
          if (parsed.filter) {
            this.validateFilterNode(parsed.filter, entityType)
          }

          // Validate $select field names (per T-03-01)
          if (parsed.select?.items) {
            for (const item of parsed.select.items) {
              this.validateSelectItem(item, entityType)
            }
          }

          // Validate $orderby expression property references
          if (parsed.orderBy) {
            for (const orderItem of parsed.orderBy) {
              this.validateFilterNode(orderItem.expression, entityType)
            }
          }

          // Validate $expand navigation property names (T-04-09, D-10)
          if (parsed.expand?.items) {
            this.validateExpandNode(parsed.expand, entityType)
          }
        }
      }
    }

    return {
      filter: parsed.filter,
      select: parsed.select,
      orderBy: parsed.orderBy,
      top,
      skip: parsed.skip,
      count: count || undefined,
      entitySetName,
      expand: parsed.expand,
      search,
      apply,
    }
  }

  /**
   * Recursively walk a FilterNode tree and throw ODataValidationError for any
   * PropertyAccessNode whose path[0] is not in entityType.properties.
   *
   * Per D-10: validates property references before any DB query is constructed.
   * Per T-03-01: unknown properties throw ODataValidationError (not a generic error).
   */
  private validateFilterNode(node: FilterNode, entityType: EdmEntityType): void {
    switch (node.kind) {
      case 'PropertyAccess': {
        const propertyName = node.path[0]
        if (!propertyName) break
        const knownNames = entityType.properties.map((p) => p.name)
        if (!knownNames.includes(propertyName)) {
          throw new ODataValidationError(
            `Property '${propertyName}' not found on entity '${entityType.name}'`,
            entityType.name,
            propertyName,
            knownNames,
          )
        }
        break
      }
      case 'BinaryExpr':
        this.validateFilterNode(node.left, entityType)
        this.validateFilterNode(node.right, entityType)
        break
      case 'UnaryExpr':
        this.validateFilterNode(node.operand, entityType)
        break
      case 'FunctionCall':
        for (const arg of node.args) {
          this.validateFilterNode(arg, entityType)
        }
        break
      case 'LambdaExpr':
        if (node.predicate) {
          this.validateFilterNode(node.predicate, entityType)
        }
        break
      case 'Literal':
        // Literals have no property references to validate
        break
    }
  }

  /**
   * Validate $expand navigation property names against the entity type's navigationProperties.
   * Validates top-level navigation properties only — nested expand validation is handled
   * by TypeOrmExpandVisitor at translation time with full EDM registry access.
   *
   * Per T-04-09: prevents users from expanding properties not declared as navigation properties.
   * Per D-10: validates property references before any DB query is constructed.
   */
  private validateExpandNode(expandNode: ExpandNode, entityType: EdmEntityType): void {
    for (const item of expandNode.items) {
      const navNames = entityType.navigationProperties.map((np) => np.name)
      if (!navNames.includes(item.navigationProperty)) {
        throw new ODataValidationError(
          `Navigation property '${item.navigationProperty}' not found on entity '${entityType.name}'`,
          entityType.name,
          item.navigationProperty,
          navNames,
        )
      }
    }
  }

  /**
   * Validate a $select item path[0] against entityType.properties.
   * Throws ODataValidationError for unknown property names.
   */
  private validateSelectItem(item: SelectItem, entityType: EdmEntityType): void {
    const propertyName = item.path[0]
    if (!propertyName) return

    const knownNames = entityType.properties.map((p) => p.name)
    if (!knownNames.includes(propertyName)) {
      throw new ODataValidationError(
        `Property '${propertyName}' not found on entity '${entityType.name}'`,
        entityType.name,
        propertyName,
        knownNames,
      )
    }
  }
}
