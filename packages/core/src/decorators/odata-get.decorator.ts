import { applyDecorators, Get, SetMetadata, UseFilters, UseInterceptors } from '@nestjs/common'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

/**
 * Options for the @ODataGet() decorator.
 */
export interface ODataGetOptions {
  /** Custom route path. Defaults to '' (empty, NestJS will use the controller prefix). */
  path?: string
  /**
   * When true, signals the auto-handler mechanism (wired in Plan 04 by the typeorm module)
   * to replace the decorated method body with a generated handler.
   * Default: false
   */
  autoHandler?: boolean
}

/**
 * Composite method decorator for OData GET endpoints.
 *
 * Composes:
 *   1. Get(path) — NestJS route decorator
 *   2. SetMetadata(ODATA_ROUTE_KEY, { entitySetName }) — marks the route as OData
 *   3. UseInterceptors(ODataResponseInterceptor) — wraps result in OData JSON envelope
 *   4. UseFilters(ODataExceptionFilter) — formats errors as OData v4 error bodies
 *
 * @param entitySetName - The OData entity set name (e.g. 'Products'). Used to build
 *   the @odata.context URL and for response formatting.
 * @param options - Optional configuration
 *
 * Per D-12, D-13, RESEARCH.md Pattern 5.
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataGet(entitySetName: string, options?: ODataGetOptions): MethodDecorator {
  return applyDecorators(
    Get(options?.path ?? entitySetName),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      autoHandler: options?.autoHandler ?? false,
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
