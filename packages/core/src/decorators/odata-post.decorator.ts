import {
  applyDecorators,
  HttpCode,
  Post,
  SetMetadata,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common'
import { ODATA_ROUTE_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

export interface ODataPostOptions {
  path?: string
}

/**
 * Composite method decorator for OData POST (create) endpoints.
 *
 * Composes:
 *   1. Post(path) — NestJS route decorator
 *   2. HttpCode(201) — POST returns 201 Created per D-03
 *   3. SetMetadata(ODATA_ROUTE_KEY, { entitySetName, operation: 'create' })
 *   4. UseInterceptors(ODataResponseInterceptor) — wraps result in OData JSON envelope
 *   5. UseFilters(ODataExceptionFilter) — formats errors as OData v4 error bodies
 *
 * Per D-03: POST returns 201. Per D-12: explicit opt-in per operation.
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataPost(entitySetName: string, options?: ODataPostOptions): MethodDecorator {
  return applyDecorators(
    Post(options?.path ?? ''),
    HttpCode(201),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      operation: 'create',
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
