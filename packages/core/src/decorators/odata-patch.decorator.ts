import { applyDecorators, Patch, SetMetadata, UseFilters, UseInterceptors } from '@nestjs/common'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

export interface ODataPatchOptions {
  path?: string
}

/**
 * Composite method decorator for OData PATCH (update) endpoints.
 *
 * Composes:
 *   1. Patch(path) — NestJS route decorator, defaults to ':key'
 *   2. SetMetadata(ODATA_ROUTE_KEY, { entitySetName, operation: 'update', isSingleEntity: true })
 *   3. UseInterceptors(ODataResponseInterceptor) — wraps result in single-entity OData envelope
 *   4. UseFilters(ODataExceptionFilter) — formats errors as OData v4 error bodies
 *
 * Per D-01: merge-patch semantics. Per D-02: parenthetical key via ':key' param.
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataPatch(entitySetName: string, options?: ODataPatchOptions): MethodDecorator {
  return applyDecorators(
    Patch(options?.path ?? ':key'),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      operation: 'update',
      isSingleEntity: true,
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
