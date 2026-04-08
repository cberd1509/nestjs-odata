import { applyDecorators, Put, SetMetadata, UseFilters, UseInterceptors } from '@nestjs/common'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

export interface ODataPutOptions {
  path?: string
}

/**
 * Composite method decorator for OData PUT (full entity replacement) endpoints.
 *
 * Composes:
 *   1. Put(path) — NestJS route decorator, defaults to ':key'
 *   2. SetMetadata(ODATA_ROUTE_KEY, { entitySetName, operation: 'replace', isSingleEntity: true })
 *   3. UseInterceptors(ODataResponseInterceptor) — wraps result in single-entity OData envelope
 *   4. UseFilters(ODataExceptionFilter) — formats errors as OData v4 error bodies
 *
 * Per D-01: PUT semantics — full entity replacement. All unspecified fields reset to
 * column defaults (null for nullable, default value for columns with defaults).
 * Per D-02: parenthetical key via ':key' param.
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataPut(entitySetName: string, options?: ODataPutOptions): MethodDecorator {
  return applyDecorators(
    Put(options?.path ?? ':key'),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      operation: 'replace',
      isSingleEntity: true,
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
