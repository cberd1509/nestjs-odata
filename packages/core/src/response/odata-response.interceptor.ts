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

    return next.handle().pipe(
      map((result: unknown) => {
        // Handle POST create: set Location header and return entity with $entity context URL
        if (operation === 'create' && result !== null && typeof result === 'object') {
          const createResult = result as { entity?: unknown; locationUrl?: string }
          if (createResult.locationUrl) {
            const httpResponse = context
              .switchToHttp()
              .getResponse<{ setHeader: (k: string, v: string) => void }>()
            httpResponse.setHeader('Location', createResult.locationUrl)
          }
          const entity = (createResult.entity ?? result) as Record<string, unknown>
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
          if (entityResult['__notModified'] === true) {
            const etag = entityResult['etag'] as string
            const httpResponse = context.switchToHttp().getResponse<{
              setHeader: (k: string, v: string) => void
              status: (code: number) => { end: () => void }
            }>()
            httpResponse.setHeader('ETag', etag)
            // Set 304 status and end the response directly — no body for 304
            httpResponse.status(304).end()
            return null
          }

          const contextUrl = buildContextUrl(
            this.options.serviceRoot,
            entitySetName,
            undefined,
            true,
          )

          // Annotate the single entity (RESP-04, RESP-05, RESP-06)
          const annotationCtx = this.resolveAnnotationContext(entitySetName)

          // Handle __etag internal property — set ETag header and add @odata.etag to body
          let entityToAnnotate = entityResult
          if (entityResult['__etag']) {
            const etag = entityResult['__etag'] as string
            const httpResponse = context
              .switchToHttp()
              .getResponse<{ setHeader: (k: string, v: string) => void }>()
            httpResponse.setHeader('ETag', etag)
            // Remove internal property and add @odata.etag
            const rest: Record<string, unknown> = {}
            for (const key of Object.keys(entityResult)) {
              if (key !== '__etag') {
                rest[key] = entityResult[key]
              }
            }
            entityToAnnotate = { '@odata.etag': etag, ...rest }
          }

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
        const items = annotationCtx
          ? annotateEntities(queryResult.items as Record<string, unknown>[], annotationCtx)
          : queryResult.items

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
}
