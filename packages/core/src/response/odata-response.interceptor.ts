import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { ODataQueryResult } from '../query/odata-query.types.js'
import { buildContextUrl } from './odata-context-url.builder.js'
import { ODATA_ROUTE_KEY } from '../decorators/metadata-keys.js'

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
  ) {}

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
          const entity = createResult.entity ?? result
          const contextUrl = buildContextUrl(
            this.options.serviceRoot,
            entitySetName,
            undefined,
            true,
          )
          return {
            '@odata.context': contextUrl,
            ...(entity as Record<string, unknown>),
          }
        }

        // Handle single-entity response (GET by key, PATCH update) — D-05
        if (isSingleEntity) {
          const contextUrl = buildContextUrl(
            this.options.serviceRoot,
            entitySetName,
            undefined,
            true,
          )
          return {
            '@odata.context': contextUrl,
            ...(result as Record<string, unknown>),
          }
        }

        // Collection response (default) — wrap in OData envelope
        const queryResult = result as ODataQueryResult
        const contextUrl = buildContextUrl(
          this.options.serviceRoot,
          entitySetName,
          queryResult.select,
        )

        // Build response: only include optional keys when they have values (D-06, D-08)
        const response: Record<string, unknown> = {
          '@odata.context': contextUrl,
          value: queryResult.items,
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
