import {
  ConfigurableModuleBuilder,
  ConfigurableModuleAsyncOptions,
  DynamicModule,
  Global,
  Module,
} from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import type { UnmappedTypeStrategy } from './edm/edm-types.js'
import type { EdmEntityConfig } from './edm/edm-entity-set.js'
import { EdmRegistry } from './edm/edm-registry.js'
import { EdmFeatureInitializer } from './edm/edm-feature-initializer.js'
import { EDM_ENTITY_CONFIGS, ODATA_MODULE_OPTIONS } from './tokens.js'
import { CsdlBuilder } from './metadata/csdl-builder.js'
import { ServiceDocumentBuilder } from './metadata/service-document-builder.js'
import { MetadataController } from './metadata/metadata.controller.js'
import { ODATA_CONTROLLER_KEY } from './decorators/metadata-keys.js'

// Re-export ODATA_MODULE_OPTIONS so consumers can import it from this module
export { ODATA_MODULE_OPTIONS } from './tokens.js'

/**
 * Configuration options for ODataModule.forRoot().
 *
 * Per threat model T-02-03: serviceRoot must be a non-empty string.
 * Per threat model T-02-04: maxTop and maxExpandDepth have safe defaults.
 */
export interface ODataModuleOptions {
  /** Base path for the OData service, e.g. '/odata' */
  serviceRoot: string
  /** EDM namespace for all entity types. Default: 'Default' (per D-08) */
  namespace?: string
  /** Maximum number of entities returned per query. Default: 1000 */
  maxTop?: number
  /** Maximum depth of $expand nesting. Default: 2 */
  maxExpandDepth?: number
  /** Maximum nesting depth of $filter expressions. Default: 10 (per SEC-04) */
  maxFilterDepth?: number
  /** Strategy when a TypeScript type cannot be mapped to an EDM primitive. Default: 'skip' (per D-10) */
  unmappedTypeStrategy?: UnmappedTypeStrategy
  /**
   * OData controller classes decorated with @ODataController().
   * Per D-17: forRoot() patches each controller's PATH_METADATA to prepend serviceRoot synchronously,
   * before NestJS compiles the module. Controllers not listed here will NOT have serviceRoot applied.
   */
  controllers?: (new (...args: unknown[]) => unknown)[]
}

/** Resolved options with all defaults applied */
export interface ODataModuleResolvedOptions {
  serviceRoot: string
  namespace: string
  maxTop: number
  maxExpandDepth: number
  /** Maximum nesting depth of $filter expressions (SEC-04). Default: 10 */
  maxFilterDepth: number
  unmappedTypeStrategy: UnmappedTypeStrategy
}

const DEFAULT_OPTIONS: Omit<ODataModuleResolvedOptions, 'serviceRoot'> = {
  namespace: 'Default',
  maxTop: 1000,
  maxExpandDepth: 2,
  maxFilterDepth: 10,
  unmappedTypeStrategy: 'skip',
}

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<ODataModuleOptions>()
    .setClassMethodName('forRoot')
    .setFactoryMethodName('create')
    .build()

/** Internal raw options token from ConfigurableModuleBuilder — not exported publicly. */
const RAW_OPTIONS_TOKEN = MODULE_OPTIONS_TOKEN

/** Provider that applies defaults to the raw options and exposes them under ODATA_MODULE_OPTIONS */
const resolvedOptionsProvider = {
  provide: ODATA_MODULE_OPTIONS,
  useFactory: (raw: ODataModuleOptions): ODataModuleResolvedOptions => ({
    ...DEFAULT_OPTIONS,
    ...raw,
  }),
  inject: [RAW_OPTIONS_TOKEN],
}

/**
 * Patch the MetadataController's PATH_METADATA to use the given serviceRoot.
 * This allows the controller to serve routes under the correct path without
 * hardcoding the serviceRoot.
 *
 * Uses Reflect.defineMetadata to set the NestJS controller path at module
 * registration time (before the DI container compiles the module).
 */
function createMetadataControllerWithPath(serviceRoot: string): typeof MetadataController {
  // Normalize: remove leading slash to match NestJS path convention
  const path = serviceRoot.startsWith('/') ? serviceRoot.slice(1) : serviceRoot
  Reflect.defineMetadata(PATH_METADATA, path, MetadataController)
  return MetadataController
}

/**
 * Core OData module — ORM-agnostic.
 *
 * Usage:
 *   // Root module:
 *   ODataModule.forRoot({ serviceRoot: '/odata' })
 *   ODataModule.forRootAsync({ useFactory: () => ({ serviceRoot: '/odata' }) })
 *
 *   // Feature modules:
 *   ODataModule.forFeature([myEdmEntityConfig])
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
@Global()
@Module({
  providers: [EdmRegistry],
  exports: [EdmRegistry],
})
export class ODataModule extends ConfigurableModuleClass {
  /** Override forRoot to inject the resolved-options provider into the dynamic module. */
  static override forRoot(options: ODataModuleOptions): DynamicModule {
    const parent = super.forRoot(options)
    const metadataController = createMetadataControllerWithPath(options.serviceRoot)

    // Per D-17: patch @ODataController paths with serviceRoot synchronously before module compilation.
    // NestJS reads PATH_METADATA at compile time, so patching must happen here in forRoot().
    const odataControllers = options.controllers ?? []
    if (odataControllers.length > 0) {
      const root = options.serviceRoot.startsWith('/')
        ? options.serviceRoot.slice(1)
        : options.serviceRoot
      for (const ctrl of odataControllers) {
        const entitySetName = Reflect.getMetadata(ODATA_CONTROLLER_KEY, ctrl) as string | undefined
        if (entitySetName) {
          const fullPath = root ? `${root}/${entitySetName}` : entitySetName
          Reflect.defineMetadata(PATH_METADATA, fullPath, ctrl)
        }
      }
    }

    return {
      ...parent,
      providers: [
        ...(parent.providers ?? []),
        resolvedOptionsProvider,
        CsdlBuilder,
        ServiceDocumentBuilder,
      ],
      controllers: [...(parent.controllers ?? []), metadataController, ...odataControllers],
      exports: [...(parent.exports ?? []), ODATA_MODULE_OPTIONS, CsdlBuilder],
    }
  }

  /** Override forRootAsync to inject the resolved-options provider into the dynamic module. */
  static override forRootAsync(
    options: ConfigurableModuleAsyncOptions<ODataModuleOptions>,
  ): DynamicModule {
    const parent = super.forRootAsync(options)
    // For async, we can't know the serviceRoot at this point.
    // Default to empty prefix; consumers should use forRoot for synchronous config.
    const controller = MetadataController
    return {
      ...parent,
      providers: [
        ...(parent.providers ?? []),
        resolvedOptionsProvider,
        CsdlBuilder,
        ServiceDocumentBuilder,
      ],
      controllers: [...(parent.controllers ?? []), controller],
      exports: [...(parent.exports ?? []), ODATA_MODULE_OPTIONS, CsdlBuilder],
    }
  }

  /**
   * Register EDM entity configurations from a feature module.
   * Entities provided here are available via the EDM_ENTITY_CONFIGS injection token.
   */
  static forFeature(entityConfigs: EdmEntityConfig[]): DynamicModule {
    return {
      module: ODataModule,
      providers: [
        {
          provide: EDM_ENTITY_CONFIGS,
          useValue: entityConfigs,
        },
        EdmFeatureInitializer,
      ],
      exports: [EDM_ENTITY_CONFIGS],
    }
  }
}
