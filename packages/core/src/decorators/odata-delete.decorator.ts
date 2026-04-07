import { applyDecorators, Delete, HttpCode, SetMetadata, UseFilters } from '@nestjs/common'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

export interface ODataDeleteOptions {
  path?: string
}

/**
 * Composite method decorator for OData DELETE endpoints.
 *
 * Composes:
 *   1. Delete(path) — NestJS route decorator, defaults to ':key'
 *   2. HttpCode(204) — DELETE returns 204 No Content per D-04
 *   3. SetMetadata(ODATA_ROUTE_KEY, { entitySetName, operation: 'delete' })
 *   4. UseFilters(ODataExceptionFilter) — formats errors as OData v4 error bodies
 *
 * Per D-04: DELETE returns 204 with no body. No ODataResponseInterceptor — no body.
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataDelete(entitySetName: string, options?: ODataDeleteOptions): MethodDecorator {
  return applyDecorators(
    Delete(options?.path ?? ':key'),
    HttpCode(204),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      operation: 'delete',
    }),
    UseFilters(ODataExceptionFilter),
  )
}
