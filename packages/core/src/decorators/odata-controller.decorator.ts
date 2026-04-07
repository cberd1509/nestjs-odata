import { applyDecorators, Controller, SetMetadata } from '@nestjs/common'
import { ODATA_CONTROLLER_KEY } from './metadata-keys.js'

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
 *      (used by ODataModule.forRoot() to patch PATH_METADATA with serviceRoot)
 *
 * Per D-11: Separate from @Controller() — sets entity context and route prefix.
 * Per D-17: The service root prefix is applied by ODataModule.forRoot({ controllers })
 *   via Reflect.defineMetadata(PATH_METADATA) — the same pattern used by MetadataController.
 *   The controller is initially registered with just the entitySetName as path;
 *   the module prepends serviceRoot during forRoot().
 *
 * Note: ODataResponseInterceptor and ODataExceptionFilter are NOT applied at class level.
 * Each CRUD method decorator (@ODataGet, @ODataPost, @ODataPatch, @ODataDelete, @ODataGetByKey)
 * applies these per-method. This avoids double-wrapping when method and class decorators
 * are both used.
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
  ) as ClassDecorator
}
