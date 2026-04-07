import {
  applyDecorators,
  Controller,
  SetMetadata,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common'
import { ODATA_CONTROLLER_KEY } from './metadata-keys.js'
import { ODataResponseInterceptor } from '../response/odata-response.interceptor.js'
import { ODataExceptionFilter } from '../response/odata-exception.filter.js'

export interface ODataControllerOptions {
  /** Override the route path. Defaults to entitySetName. */
  path?: string
}

/**
 * Class decorator for OData controllers.
 *
 * Composes:
 *   1. Controller(path) — NestJS route prefix, defaults to entitySetName
 *   2. SetMetadata(ODATA_CONTROLLER_KEY, entitySetName) — marks as OData controller
 *   3. UseInterceptors(ODataResponseInterceptor) — class-level OData envelope
 *   4. UseFilters(ODataExceptionFilter) — class-level OData error formatting
 *
 * Per D-11: Separate from @Controller() — sets entity context and route prefix.
 * Per D-15: All methods on this controller get OData response formatting.
 * Per D-17: The service root prefix is applied by ODataTypeOrmModule at module init
 *   via Reflect.defineMetadata(PATH_METADATA) — the same pattern used by MetadataController.
 *   The controller is initially registered with just the entitySetName as path;
 *   the module prepends serviceRoot during onModuleInit.
 *
 * @param entitySetName - The OData entity set name (e.g. 'Products')
 * @param options - Optional configuration
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export function ODataController(
  entitySetName: string,
  options?: ODataControllerOptions,
): ClassDecorator {
  return applyDecorators(
    Controller(options?.path ?? entitySetName),
    SetMetadata(ODATA_CONTROLLER_KEY, entitySetName),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  ) as ClassDecorator
}
