import { Inject, Injectable } from '@nestjs/common'
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common'
import { parseQuery } from '../parser/parser.js'
import { parseSearch } from '../parser/search-parser.js'
import { parseApply } from '../parser/apply-parser.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { ODataQuery } from './odata-query.types.js'
import { navigationTargetTypeName } from '../edm/navigation.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type {
  FilterNode,
  SelectItem,
  ExpandItem,
  ExpandNode,
  SearchNode,
  ApplyNode,
} from '../parser/ast.js'
import { ODataNotImplementedError } from '../parser/errors.js'
import { ODataValidationError } from './odata-validation.error.js'

/** Where a property path is validated, and whether navigation segments are allowed there. */
interface PathOption {
  readonly name: string
  readonly navigation: boolean
}

const FILTER: PathOption = { name: '$filter', navigation: true }
/** Navigation paths in `$orderby` are not implemented (501). */
const ORDER_BY: PathOption = { name: '$orderby', navigation: false }

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
    let expand = parsed.expand
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
              this.validateFilterNode(orderItem.expression, entityType, undefined, ORDER_BY)
            }
          }

          // Validate $expand navigation property names (T-04-09, D-10)
          if (parsed.expand?.items) {
            expand = this.validateExpandNode(parsed.expand, entityType)
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
      expand,
      search,
      apply,
    }
  }

  /**
   * Recursively walk a FilterNode tree and throw ODataValidationError for any property path
   * that does not resolve on `entityType`.
   *
   * Paths may go through single-valued navigation properties (`category/name`, P2 §5.1.1.15);
   * collection-valued ones must be used with `any`/`all`. In `$orderby` (`navigation: false`)
   * navigation paths are not implemented (501).
   *
   * Per D-10: validates property references before any DB query is constructed.
   * Per T-03-01: unknown properties throw ODataValidationError (not a generic error).
   */
  private validateFilterNode(
    node: FilterNode,
    entityType: EdmEntityType,
    lambda?: { readonly variable: string; readonly targetType: EdmEntityType },
    option: PathOption = FILTER,
  ): void {
    switch (node.kind) {
      case 'PropertyAccess': {
        // Inside a lambda predicate, `t/title` refers to the collection's entity type.
        if (lambda && node.path.length > 1 && node.path[0] === lambda.variable) {
          this.validatePropertyPath(node.path.slice(1), lambda.targetType, option)
          break
        }
        this.validatePropertyPath(node.path, entityType, option)
        break
      }
      case 'BinaryExpr':
        this.validateFilterNode(node.left, entityType, lambda, option)
        this.validateFilterNode(node.right, entityType, lambda, option)
        break
      case 'UnaryExpr':
        this.validateFilterNode(node.operand, entityType, lambda, option)
        break
      case 'FunctionCall':
        for (const arg of node.args) {
          this.validateFilterNode(arg, entityType, lambda, option)
        }
        break
      case 'LambdaExpr': {
        const navProp = entityType.navigationProperties.find(
          (np) => np.name.toLowerCase() === node.collection.toLowerCase(),
        )
        if (!navProp?.isCollection) {
          throw new ODataValidationError(
            `'${node.collection}' is not a collection-valued navigation property of ` +
              `'${entityType.name}', so it cannot be used with ${node.operator}`,
            entityType.name,
            node.collection,
            entityType.navigationProperties.filter((np) => np.isCollection).map((np) => np.name),
          )
        }
        if (!node.predicate) break
        const targetType = this.navigationTargetType(navProp.type)
        if (node.variable && targetType) {
          this.validateFilterNode(
            node.predicate,
            entityType,
            { variable: node.variable, targetType },
            option,
          )
        } else {
          this.validateFilterNode(node.predicate, entityType, undefined, option)
        }
        break
      }
      case 'Literal':
        // Literals have no property references to validate
        break
    }
  }

  /**
   * Resolve a property path on `entityType`: every segment but the last must be a single-valued
   * navigation property, the last one a structural property.
   */
  private validatePropertyPath(
    path: readonly string[],
    entityType: EdmEntityType,
    option: PathOption,
  ): void {
    let current = entityType
    for (let i = 0; i < path.length; i++) {
      const segment = path[i]
      if (!segment) return
      const knownNames = current.properties.map((p) => p.name)
      if (i === path.length - 1) {
        if (!knownNames.includes(segment)) {
          throw new ODataValidationError(
            `Property '${segment}' not found on entity '${current.name}'`,
            current.name,
            segment,
            knownNames,
          )
        }
        return
      }
      const navProp = current.navigationProperties.find((np) => np.name === segment)
      if (!navProp) {
        const message = knownNames.includes(segment)
          ? `Property '${segment}' of entity '${current.name}' is not a navigation property, ` +
            `so '${path.join('/')}' cannot be resolved`
          : `Property '${segment}' not found on entity '${current.name}'`
        throw new ODataValidationError(message, current.name, segment, [
          ...knownNames,
          ...current.navigationProperties.map((np) => np.name),
        ])
      }
      if (navProp.isCollection) {
        throw new ODataValidationError(
          `'${segment}' is a collection-valued navigation property of '${current.name}': ` +
            `use any/all to filter on it (for example ${segment}/any(x: x/...))`,
          current.name,
          segment,
        )
      }
      if (!option.navigation) {
        throw new ODataNotImplementedError(
          `Navigation paths ('${path.join('/')}') are not supported in ${option.name}`,
        )
      }
      const target = this.navigationTargetType(navProp.type)
      if (!target) {
        throw new ODataValidationError(
          `Navigation property '${segment}' of '${current.name}' targets a type that is not ` +
            'exposed by the service',
          current.name,
          segment,
        )
      }
      current = target
    }
  }

  /** Resolve `Default.X` / `Collection(Default.X)` to the registered entity type `X`. */
  private navigationTargetType(navType: string): EdmEntityType | undefined {
    return this.edmRegistry.getEntityType(navigationTargetTypeName(navType))
  }

  /**
   * Validate $expand navigation property names against the entity type's navigationProperties,
   * and the nested options against the target types. Returns the expand tree with `$levels`
   * replaced by the equivalent nested `$expand`s (P1 §11.2.5.2.1.1: the same options apply at
   * each level), so query translators never see `$levels`.
   *
   * Per T-04-09: prevents users from expanding properties not declared as navigation properties.
   * Per D-10: validates property references before any DB query is constructed.
   */
  private validateExpandNode(
    expandNode: ExpandNode,
    entityType: EdmEntityType,
    depth: number = 0,
  ): ExpandNode {
    const items = expandNode.items.map((item): ExpandItem => {
      const navNames = entityType.navigationProperties.map((np) => np.name)
      const navProp = entityType.navigationProperties.find(
        (np) => np.name === item.navigationProperty,
      )
      if (!navProp) {
        throw new ODataValidationError(
          `Navigation property '${item.navigationProperty}' not found on entity '${entityType.name}'`,
          entityType.name,
          item.navigationProperty,
          navNames,
        )
      }
      if ((item.count || item.countOnly) && !navProp.isCollection) {
        throw new ODataValidationError(
          `'${item.navigationProperty}' is a single-valued navigation property: $count only ` +
            'applies to collections',
          entityType.name,
          item.navigationProperty,
        )
      }
      // Nested options ($select, $filter, $orderby, $expand) are validated against the target
      // type, so they can only reference its exposed properties.
      const targetType = this.navigationTargetType(navProp.type)
      if (!targetType) return item
      for (const selectItem of item.select?.items ?? []) {
        this.validateSelectItem(selectItem, targetType)
      }
      if (item.filter) this.validateFilterNode(item.filter, targetType)
      for (const orderItem of item.orderBy ?? []) {
        this.validateFilterNode(orderItem.expression, targetType, undefined, ORDER_BY)
      }
      const expanded = item.levels !== undefined ? this.expandLevels(item, entityType, depth) : item
      if (!expanded.expand) return expanded
      return {
        ...expanded,
        expand: this.validateExpandNode(expanded.expand, targetType, depth + 1),
      }
    })
    return { items }
  }

  /**
   * Replace `nav($levels=n;...)` by `n` nested expands of `nav`, each with the item's other
   * options. `$levels` is defined for recursive navigation properties (whose target type is the
   * source type): `$levels=1` is a plain expand on any navigation property, more levels on a
   * non-recursive one are rejected. `max` is the remaining expansion depth (`maxExpandDepth`).
   */
  private expandLevels(item: ExpandItem, entityType: EdmEntityType, depth: number): ExpandItem {
    const { levels, ...options } = item
    const navProp = entityType.navigationProperties.find(
      (np) => np.name === item.navigationProperty,
    )
    const recursive = navProp && navigationTargetTypeName(navProp.type) === entityType.name
    const count =
      levels === 'max' ? Math.max(1, this.options.maxExpandDepth - depth) : (levels ?? 1)
    if (count > 1 && !recursive) {
      throw new ODataValidationError(
        `$levels applies to recursive navigation properties; '${item.navigationProperty}' of ` +
          `'${entityType.name}' is not recursive`,
        entityType.name,
        '$levels',
      )
    }
    // Checked before building the levels, so a huge $levels cannot build a huge tree.
    if (depth + count > this.options.maxExpandDepth) {
      throw new ODataValidationError(
        `$levels=${count} exceeds the $expand depth limit of ${this.options.maxExpandDepth}`,
        entityType.name,
        '$levels',
      )
    }
    let result: ExpandItem = options
    for (let level = 1; level < count; level++) {
      result = { ...options, expand: { items: [...(options.expand?.items ?? []), result] } }
    }
    return result
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
