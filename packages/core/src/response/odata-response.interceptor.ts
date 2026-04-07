import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import type { ODataQueryResult } from '../query/odata-query.types.js'
import { buildContextUrl } from './odata-context-url.builder.js'
import { ODATA_ROUTE_KEY } from '../decorators/metadata-keys.js'

/** Metadata value shape set by @ODataGet() decorator */
interface ODataRouteMetadata {
  readonly entitySetName: string
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

    const { entitySetName } = metadata

    return next.handle().pipe(
      map((result: ODataQueryResult) => {
        // Build the @odata.context URL (includes select projection if applicable)
        const contextUrl = buildContextUrl(this.options.serviceRoot, entitySetName, result.select)

        // Build response: only include optional keys when they have values (D-06, D-08)
        const response: Record<string, unknown> = {
          '@odata.context': contextUrl,
          value: result.items,
        }

        if (result.count !== undefined) {
          response['@odata.count'] = result.count
        }

        if (result.nextLink !== undefined) {
          response['@odata.nextLink'] = result.nextLink
        }

        return response
      }),
    )
  }
}
