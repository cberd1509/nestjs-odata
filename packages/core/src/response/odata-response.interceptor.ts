import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { ODataQueryResult } from '../query/odata-query.types.js'
import type { SelectNode } from '../parser/ast.js'
import { buildContextUrl } from './odata-context-url.builder.js'
import { annotateEntity, annotateEntities } from './odata-annotation.builder.js'
import type { AnnotationContext } from './odata-annotation.builder.js'
import { ODATA_ROUTE_KEY } from '../decorators/metadata-keys.js'
import { EdmRegistry } from '../edm/edm-registry.js'
import { ODataEmptyResponse } from './odata-empty-response.js'
import { resolveReturnPreference } from './prefer.js'

/** Data modification operations whose response honours `Prefer: return=...` (§8.2.8.7). */
const WRITE_OPERATIONS = new Set(['create', 'update', 'replace'])

/** The parts of the platform request the interceptor reads. */
interface HttpRequestLike {
  readonly headers?: Record<string, string | string[] | undefined>
  readonly originalUrl?: string
  readonly url?: string
}

/** Metadata value shape set by @ODataGet() and CRUD decorators */
interface ODataRouteMetadata {
  readonly entitySetName: string
  readonly operation?: string
  readonly isSingleEntity?: boolean
}

/**
 * NestJS interceptor that wraps ODataQueryResult into an OData v4 JSON envelope.
 *
 * Per D-05: only activates on routes that have ODATA_ROUTE_KEY metadata (set by @ODataGet()).
 * Non-OData routes pass through completely unchanged (T-03-09).
 *
 * Response format:
 *   {
 *     '@odata.context': '/odata/$metadata#EntitySet',
 *     '@odata.id': '/odata/EntitySet(key)',     (per RESP-04)
 *     '@odata.type': '#Namespace.EntityType',   (per RESP-05)
 *     '{nav}@odata.navigationLink': '...',      (per RESP-06)
 *     'value': [...],
 *     '@odata.count': N,       (only when present)
 *     '@odata.nextLink': '...' (only when present)
 *   }
 *
 * Per D-08: undefined keys are omitted entirely — not set to null or undefined.
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
@Injectable()
export class ODataResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    private readonly edmRegistry: EdmRegistry,
  ) {}

  /**
   * Resolve the AnnotationContext for an entity set name.
   * Returns null when the entity set or its type is not registered (graceful degradation).
   */
  private resolveAnnotationContext(entitySetName: string): AnnotationContext | null {
    const entitySet = this.edmRegistry.getEntitySet(entitySetName)
    if (!entitySet) return null
    const entityType = this.edmRegistry.getEntityType(entitySet.entityTypeName)
    if (!entityType) return null
    return {
      serviceRoot: this.options.serviceRoot,
      entitySetName,
      entityType,
      namespace: this.options.namespace,
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Check if this route has OData metadata (set by @ODataGet())
    const metadata = this.reflector.get<ODataRouteMetadata | undefined>(
      ODATA_ROUTE_KEY,
      context.getHandler(),
    )

    // If not an OData route, pass through unchanged (D-05, T-03-09)
    if (!metadata) {
      return next.handle()
    }

    const { entitySetName, operation, isSingleEntity } = metadata
    const returnPreference =
      operation && WRITE_OPERATIONS.has(operation) ? this.returnPreference(context) : undefined

    return next.handle().pipe(
      map((result: unknown) => {
        // Handle POST create: set Location header and return entity with $entity context URL
        if (operation === 'create' && result !== null && typeof result === 'object') {
          const createResult = result as { entity?: unknown; locationUrl?: string }
          if (createResult.locationUrl) {
            setResponseHeader(context, 'Location', createResult.locationUrl)
          }
          const entity = applyETag(
            context,
            (createResult.entity ?? result) as Record<string, unknown>,
          )
          if (returnPreference === 'minimal' && createResult.locationUrl) {
            // §11.4.2 / §8.3.4: a 204 create still identifies the entity it created.
            setResponseHeader(context, 'OData-EntityId', createResult.locationUrl)
          }
          applyReturnPreference(context, returnPreference)
          const contextUrl = buildContextUrl(
            this.options.serviceRoot,
            entitySetName,
            undefined,
            true,
          )

          // Annotate the created entity (RESP-04, RESP-05, RESP-06)
          const annotationCtx = this.resolveAnnotationContext(entitySetName)
          const annotatedEntity = annotationCtx ? annotateEntity(entity, annotationCtx) : entity

          return {
            '@odata.context': contextUrl,
            ...annotatedEntity,
          }
        }

        // Handle single-entity response (GET by key, PATCH update) — D-05
        if (isSingleEntity) {
          const entityResult = result as Record<string, unknown>

          // Handle 304 Not Modified — entity unchanged (If-None-Match matched)
          if (entityResult?.['__notModified'] === true) {
            setResponseHeader(context, 'ETag', entityResult['etag'] as string)
            // Nest would send the route's own status (200) for any returned value: the
            // exception filter answers this signal with an empty 304 instead (#77).
            throw new ODataEmptyResponse(304)
          }

          const contextUrl = buildContextUrl(
            this.options.serviceRoot,
            entitySetName,
            undefined,
            true,
          )

          // Annotate the single entity (RESP-04, RESP-05, RESP-06)
          const annotationCtx = this.resolveAnnotationContext(entitySetName)

          const entityToAnnotate = applyETag(context, entityResult)
          applyReturnPreference(context, returnPreference)

          const annotatedEntity = annotationCtx
            ? annotateEntity(entityToAnnotate, annotationCtx)
            : entityToAnnotate

          return {
            '@odata.context': contextUrl,
            ...annotatedEntity,
          }
        }

        // Cast once — shared by aggregated and collection branches
        const queryResult = result as ODataQueryResult

        // Aggregated response ($apply) — no entity annotations, projection context URL
        if (queryResult.isAggregated) {
          const projectedSelect: SelectNode | undefined = queryResult.applyProperties?.length
            ? { items: queryResult.applyProperties.map((p) => ({ path: [p] })) }
            : undefined
          const aggContextUrl = buildContextUrl(
            this.options.serviceRoot,
            entitySetName,
            projectedSelect,
          )
          const aggResponse: Record<string, unknown> = {
            '@odata.context': aggContextUrl,
            value: queryResult.items,
          }
          if (queryResult.count !== undefined) {
            aggResponse['@odata.count'] = queryResult.count
          }
          return aggResponse
        }

        // Collection response (default) — wrap in OData envelope
        const contextUrl = buildContextUrl(
          this.options.serviceRoot,
          entitySetName,
          queryResult.select,
        )

        // Annotate each item in the collection (RESP-04, RESP-05, RESP-06)
        const annotationCtx = this.resolveAnnotationContext(entitySetName)
        // Adapters attach `__etag` to each item of an ETag-enabled entity set (JSON §4.5.10).
        const withETags = (queryResult.items as Record<string, unknown>[]).map(itemETag)
        const items = annotationCtx ? annotateEntities(withETags, annotationCtx) : withETags

        // Build response: only include optional keys when they have values (D-06, D-08)
        const response: Record<string, unknown> = {
          '@odata.context': contextUrl,
          value: items,
        }

        if (queryResult.count !== undefined) {
          response['@odata.count'] = queryResult.count
        }

        if (queryResult.nextLink !== undefined) {
          response['@odata.nextLink'] = queryResult.nextLink
        }

        return response
      }),
    )
  }

  /**
   * The `return` preference to apply and report with `Preference-Applied`; `undefined` when the
   * client expressed none, or asked for `minimal` with `$select`/`$expand` (§11.4.1.5).
   */
  private returnPreference(context: ExecutionContext): 'minimal' | 'representation' | undefined {
    const http = context.switchToHttp()
    const request = http?.getRequest?.<HttpRequestLike | undefined>()
    const prefer = request?.headers?.['prefer']
    const applied = resolveReturnPreference(prefer, request?.originalUrl ?? request?.url)
    // `return=minimal` overridden by $select/$expand: answer with the entity, but do not report
    // a preference the client did not express.
    if (applied === 'representation' && resolveReturnPreference(prefer, undefined) !== applied) {
      return undefined
    }
    return applied
  }
}

function setResponseHeader(context: ExecutionContext, name: string, value: string): void {
  context
    .switchToHttp()
    .getResponse<{ setHeader: (k: string, v: string) => void }>()
    .setHeader(name, value)
}

/**
 * Honour `Prefer: return=minimal` (204 No Content) or `return=representation` on a write, with
 * `Preference-Applied` (OData-Protocol 4.01 §8.2.8.7). Headers already set (`ETag`, `Location`)
 * are kept.
 */
function applyReturnPreference(
  context: ExecutionContext,
  preference: 'minimal' | 'representation' | undefined,
): void {
  if (!preference) return
  setResponseHeader(context, 'Preference-Applied', `return=${preference}`)
  if (preference === 'minimal') throw new ODataEmptyResponse(204)
}

/** A collection item's internal `__etag` as its `@odata.etag` annotation (no `ETag` header). */
function itemETag(item: Record<string, unknown>): Record<string, unknown> {
  if (!item || typeof item !== 'object' || typeof item['__etag'] !== 'string') return item
  const { __etag: etag, ...rest } = item
  return { '@odata.etag': etag, ...rest }
}

/**
 * Turn the internal `__etag` property adapters attach to an entity into the `ETag` response
 * header and the `@odata.etag` annotation. Entities without one are returned unchanged.
 */
function applyETag(
  context: ExecutionContext,
  entity: Record<string, unknown>,
): Record<string, unknown> {
  if (!entity || typeof entity !== 'object' || typeof entity['__etag'] !== 'string') return entity
  const { __etag: etag, ...rest } = entity
  setResponseHeader(context, 'ETag', etag)
  return { '@odata.etag': etag, ...rest }
}
