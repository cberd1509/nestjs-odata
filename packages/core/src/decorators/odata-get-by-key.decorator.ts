import { applyDecorators, Get, SetMetadata, UseFilters, UseInterceptors } from '@nestjs/common'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

export interface ODataGetByKeyOptions {
  path?: string
}

/**
 * Composite method decorator for OData GET-by-key (single entity) endpoints.
 *
 * Composes:
 *   1. Get(path) — NestJS route decorator, defaults to ':key'
 *   2. SetMetadata(ODATA_ROUTE_KEY, { entitySetName, operation: 'getByKey', isSingleEntity: true })
 *   3. UseInterceptors(ODataResponseInterceptor) — returns entity directly (not wrapped in value array)
 *   4. UseFilters(ODataExceptionFilter) — formats errors as OData v4 error bodies
 *
 * Per D-05: Returns single entity, not wrapped in value array.
 * Context URL uses /$entity suffix for single-entity responses.
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataGetByKey(
  entitySetName: string,
  options?: ODataGetByKeyOptions,
): MethodDecorator {
  return applyDecorators(
    Get(options?.path ?? ':key'),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      operation: 'getByKey',
      isSingleEntity: true,
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
