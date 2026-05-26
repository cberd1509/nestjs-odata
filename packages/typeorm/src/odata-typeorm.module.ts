import { DynamicModule, Inject, Injectable, Module, OnModuleInit } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource, type ObjectLiteral } from 'typeorm'
import type { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type.js'
import type {
  EdmEntityConfig,
  EdmEntitySet,
  EdmEntityType,
  EntityClass,
  ISearchProvider,
  ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import {
  EdmRegistry,
  ETAG_PROVIDER,
  ODataModule,
  ODATA_CONTROLLER_KEY,
  ODATA_MODULE_OPTIONS,
  SEARCH_PROVIDER,
  type ODataModuleOptions,
} from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from './deriver/typeorm-edm-deriver.js'
import { TypeOrmQueryTranslator } from './translator/typeorm-query-translator.js'
import { TypeOrmAutoHandler } from './translator/typeorm-auto-handler.js'
import { TypeOrmETagProvider } from './etag/typeorm-etag.provider.js'
import { TypeOrmSearchProvider } from './translator/search-provider.js'
import { BatchController } from './batch/batch-controller.js'

/**
 * DI injection token for the array of TypeORM entity classes
 * registered via ODataTypeOrmModule.forFeature().
 */
export const TYPEORM_ODATA_ENTITIES = Symbol('TYPEORM_ODATA_ENTITIES')

/**
 * DI injection token for the per-entity OData entity-set name overrides
 * passed to ODataTypeOrmModule.forFeature() in the object-config form
 * `{ entity, name }`. Maps entity-type-name (TypeORM's `meta.name`) → desired
 * OData entity-set name. Empty when callers passed plain entity classes.
 */
export const TYPEORM_ODATA_SET_NAME_OVERRIDES = Symbol('TYPEORM_ODATA_SET_NAME_OVERRIDES')

/**
 * Object-config form accepted by ODataTypeOrmModule.forFeature() that lets
 * callers override the OData entity-set name without touching the entity
 * class (avoids the `/odata/UserEntities` ugliness that comes from the
 * `Entity` suffix convention).
 *
 * Example:
 *   ODataTypeOrmModule.forFeature([
 *     { entity: UserEntity, name: 'Users' },
 *     { entity: ClaudeSessionEntity, name: 'Sessions' },
 *   ])
 */
export interface ODataTypeOrmFeatureConfig {
  /** TypeORM entity class (decorated with @Entity()) */
  readonly entity: EntityClassOrSchema
  /** Custom OData entity-set name. Takes precedence over @ODataEntitySet decorator and pluralization. */
  readonly name?: string
}

/** Anything accepted by ODataTypeOrmModule.forFeature() — bare entity class or config object. */
export type ODataTypeOrmFeatureItem = EntityClassOrSchema | ODataTypeOrmFeatureConfig

/** Type guard for the object-config form. */
function isFeatureConfig(item: ODataTypeOrmFeatureItem): item is ODataTypeOrmFeatureConfig {
  return typeof item === 'object' && item !== null && 'entity' in item && item.entity !== undefined
}

/** Split a mixed feature-item array into its raw entity classes and the name-override map. */
function normalizeFeatureItems(items: ODataTypeOrmFeatureItem[]): {
  entities: EntityClassOrSchema[]
  nameOverrides: Map<EntityClassOrSchema, string>
} {
  const entities: EntityClassOrSchema[] = []
  const nameOverrides = new Map<EntityClassOrSchema, string>()
  for (const item of items) {
    if (isFeatureConfig(item)) {
      entities.push(item.entity)
      if (item.name) nameOverrides.set(item.entity, item.name)
    } else {
      entities.push(item)
    }
  }
  return { entities, nameOverrides }
}

/**
 * TypeOrmEdmInitializer — runs at module init to derive EDM from TypeORM entities
 * and register them in the EdmRegistry.
 *
 * Per D-06, D-16, EDM-06: EDM derivation happens after DataSource is ready (onModuleInit).
 *
 * If the feature module was configured with object-form `{ entity, name }` items,
 * the per-entity-set name override is applied here, after derivation but before
 * registration in the EdmRegistry.
 */
@Injectable()
export class TypeOrmEdmInitializer implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleOptions,
    @Inject(TYPEORM_ODATA_ENTITIES) private readonly entityClasses: EntityClass[],
    @Inject(TYPEORM_ODATA_SET_NAME_OVERRIDES)
    private readonly setNameOverrides: ReadonlyMap<unknown, string>,
  ) {}

  onModuleInit(): void {
    const deriver = new TypeOrmEdmDeriver(
      this.options.namespace ?? 'Default',
      this.options.unmappedTypeStrategy ?? 'skip',
    )
    const metadatas = this.entityClasses.map((cls) => this.dataSource.getMetadata(cls))
    const configs: EdmEntityConfig[] = deriver.deriveEntityTypes(this.entityClasses, metadatas)

    // Build entity-class → entityTypeName lookup so we can map the override map
    // (keyed by entity class) onto the derived configs (keyed by typeName).
    const typeNameByEntityClass = new Map<unknown, string>()
    for (let i = 0; i < this.entityClasses.length; i++) {
      typeNameByEntityClass.set(this.entityClasses[i], metadatas[i].name)
    }
    const overrideByTypeName = new Map<string, string>()
    for (const [entityClass, setName] of this.setNameOverrides.entries()) {
      const typeName = typeNameByEntityClass.get(entityClass)
      if (typeName) overrideByTypeName.set(typeName, setName)
    }

    for (const config of configs) {
      const namespace = this.options.namespace ?? 'Default'
      // Apply forFeature() name override (takes precedence over @ODataEntitySet and pluralization).
      const entitySetName = overrideByTypeName.get(config.entityTypeName) ?? config.entitySetName
      const entityType: EdmEntityType = {
        name: config.entityTypeName,
        namespace,
        properties: config.properties,
        navigationProperties: config.navigationProperties,
        keyProperties: config.keyProperties,
        isReadOnly: config.isReadOnly,
      }
      const entitySet: EdmEntitySet = {
        name: entitySetName,
        entityTypeName: config.entityTypeName,
        namespace,
        isReadOnly: config.isReadOnly,
      }
      this.edmRegistry.register(entityType, entitySet)
    }
  }
}

/**
 * TypeORM adapter module for @nestjs-odata/core.
 *
 * Wraps TypeOrmModule.forFeature() and registers the entity classes
 * under the TYPEORM_ODATA_ENTITIES token. TypeOrmEdmInitializer runs
 * at onModuleInit to derive and register OData EDM metadata from TypeORM.
 *
 * ODataModule.forRoot() must be imported in the application root module —
 * EdmRegistry is @Global() so it is available here without an explicit import.
 *
 * Usage:
 *   ODataTypeOrmModule.forFeature([Product, Category])
 */
@Module({})
export class ODataTypeOrmModule {
  /**
   * Register TypeORM entity classes for OData auto-derivation.
   *
   * @param entities - Array of TypeORM entity classes (decorated with @Entity())
   * @returns DynamicModule that imports TypeOrmModule.forFeature, provides TYPEORM_ODATA_ENTITIES,
   *          and wires TypeOrmEdmInitializer to populate the EdmRegistry at onModuleInit
   */
  static forFeature(
    items: ODataTypeOrmFeatureItem[],
    options?: {
      serviceRoot?: string
      /**
       * OData controllers decorated with @ODataController() that belong to this
       * feature. When provided, forFeature() will:
       *   1. Patch each controller's PATH_METADATA to prepend the serviceRoot
       *      (same job that ODataModule.forRoot({controllers}) does).
       *   2. Register them in this dynamic module's `controllers` array so DI
       *      can resolve `TypeOrmAutoHandler` (which lives in this module).
       *
       * This eliminates the previous "declare in two places" papercut: callers
       * no longer need to list controllers in BOTH `ODataModule.forRoot({controllers})`
       * and `@Module({controllers})` to get routes working.
       */
      controllers?: (new (...args: any[]) => any)[]
    },
  ): DynamicModule {
    // Normalize: accept either plain entity classes or { entity, name } config
    // objects in the same array. The name override is applied at EDM-registration
    // time in TypeOrmEdmInitializer.
    const { entities, nameOverrides } = normalizeFeatureItems(items)

    // Patch BatchController's PATH_METADATA to include the serviceRoot so
    // POST {serviceRoot}/$batch is registered correctly.
    // Per D-07, D-08: inherit serviceRoot from ODataModule.registeredServiceRoot
    // when not explicitly provided. Single source of truth from forRoot().
    const serviceRoot: string = options?.serviceRoot ?? ODataModule.registeredServiceRoot ?? 'odata'
    const root = serviceRoot.startsWith('/') ? serviceRoot.slice(1) : serviceRoot
    Reflect.defineMetadata(PATH_METADATA, root, BatchController)

    // Patch each feature controller's PATH_METADATA with the serviceRoot prefix
    // — same logic forRoot uses, but co-located with the providers the
    // controllers depend on. Resolves the dual-declaration UX papercut.
    const featureControllers = options?.controllers ?? []
    for (const ctrl of featureControllers) {
      const entitySetName = Reflect.getMetadata(ODATA_CONTROLLER_KEY, ctrl) as string | undefined
      if (entitySetName) {
        const fullPath = root ? `${root}/${entitySetName}` : entitySetName
        Reflect.defineMetadata(PATH_METADATA, fullPath, ctrl)
      }
    }

    return {
      module: ODataTypeOrmModule,
      imports: [TypeOrmModule.forFeature(entities)],
      controllers: [BatchController, ...featureControllers],
      providers: [
        {
          provide: TYPEORM_ODATA_ENTITIES,
          useValue: entities,
        },
        {
          provide: TYPEORM_ODATA_SET_NAME_OVERRIDES,
          useValue: nameOverrides,
        },
        TypeOrmEdmInitializer,
        {
          provide: TypeOrmSearchProvider,
          useFactory: (dataSource: DataSource, edmRegistry: EdmRegistry): TypeOrmSearchProvider => {
            return new TypeOrmSearchProvider(dataSource, edmRegistry)
          },
          inject: [DataSource, EdmRegistry],
        },
        {
          provide: SEARCH_PROVIDER,
          useExisting: TypeOrmSearchProvider,
        },
        {
          provide: TypeOrmQueryTranslator,
          useFactory: (
            dataSource: DataSource,
            edmRegistry: EdmRegistry,
            options: ODataModuleResolvedOptions,
            searchProvider: ISearchProvider,
          ): TypeOrmQueryTranslator => {
            // Use a shared repository for query builder creation.
            // TypeOrmQueryTranslator uses repo.createQueryBuilder() which accepts any entity target.
            // The DataSource repository is typed as ObjectLiteral which satisfies the translator.
            const firstEntity = entities[0]
            if (!firstEntity) {
              throw new Error('ODataTypeOrmModule.forFeature() requires at least one entity class')
            }
            const repo = dataSource.getRepository(firstEntity as new () => ObjectLiteral)
            return new TypeOrmQueryTranslator(repo, edmRegistry, options, searchProvider)
          },
          inject: [
            DataSource,
            EdmRegistry,
            ODATA_MODULE_OPTIONS,
            { token: SEARCH_PROVIDER, optional: true },
          ],
        },
        {
          provide: TypeOrmETagProvider,
          useFactory: (dataSource: DataSource, edmRegistry: EdmRegistry): TypeOrmETagProvider => {
            return new TypeOrmETagProvider(dataSource, edmRegistry)
          },
          inject: [DataSource, EdmRegistry],
        },
        {
          provide: ETAG_PROVIDER,
          useExisting: TypeOrmETagProvider,
        },
        {
          provide: TypeOrmAutoHandler,
          useFactory: (
            translator: TypeOrmQueryTranslator,
            edmRegistry: EdmRegistry,
            options: ODataModuleResolvedOptions,
            dataSource: DataSource,
            etagProvider: TypeOrmETagProvider,
          ): TypeOrmAutoHandler => {
            const firstEntity = entities[0]
            if (!firstEntity) {
              throw new Error('ODataTypeOrmModule.forFeature() requires at least one entity class')
            }
            const repo = dataSource.getRepository(firstEntity as new () => ObjectLiteral)
            return new TypeOrmAutoHandler(
              translator,
              edmRegistry,
              options,
              repo,
              etagProvider,
              dataSource,
            )
          },
          inject: [
            TypeOrmQueryTranslator,
            EdmRegistry,
            ODATA_MODULE_OPTIONS,
            DataSource,
            TypeOrmETagProvider,
          ],
        },
      ],
      exports: [
        TYPEORM_ODATA_ENTITIES,
        TypeOrmQueryTranslator,
        TypeOrmAutoHandler,
        TypeOrmETagProvider,
        ETAG_PROVIDER,
        TypeOrmSearchProvider,
        SEARCH_PROVIDER,
      ],
    }
  }
}
