import {
  DynamicModule,
  Inject,
  Injectable,
  Module,
  OnApplicationBootstrap,
  OnModuleInit,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
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
import { ODataScopeRegistry } from './scope/scope-registry.js'
import { TypeOrmScopeService } from './scope/typeorm-scope.service.js'
import type { ODataScope, ODataScopeDefinition, ODataScopeFn } from './scope/scope.types.js'
import { ODataWriteRegistry } from './write/write-registry.js'
import { ODATA_CHANGESET_RUNNER } from './write/changeset-runner.js'
import type {
  ODataChangesetRunner,
  ODataETagSource,
  ODataWriteHandlers,
  ODataWriteHandlersDefinition,
} from './write/write.types.js'

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
 * DI injection token for the row-level scopes passed to ODataTypeOrmModule.forFeature():
 * `{ byEntity, defaultScope }`, keyed by entity class.
 */
export const TYPEORM_ODATA_SCOPES = Symbol('TYPEORM_ODATA_SCOPES')

/**
 * DI injection token for the write handlers and ETag sources passed to
 * ODataTypeOrmModule.forFeature().
 */
export const TYPEORM_ODATA_WRITES = Symbol('TYPEORM_ODATA_WRITES')

/** Value provided under {@link TYPEORM_ODATA_WRITES}. */
export interface TypeOrmODataWrites {
  readonly handlers: ReadonlyMap<unknown, ODataWriteHandlersDefinition>
  readonly etags: ReadonlyMap<unknown, ODataETagSource>
}

/** Options of ODataTypeOrmModule.forRoot(): application-wide TypeORM adapter settings. */
export interface ODataTypeOrmRootOptions {
  /**
   * Runs each `$batch` changeset atomically. Default: a TypeORM `QueryRunner` transaction whose
   * entity manager is handed to write handlers as `ctx.manager`. Provide your own to run
   * changesets inside your application's unit of work. See {@link ODataChangesetRunner}.
   */
  readonly changesetRunner?: ODataChangesetRunner
}

/** Value provided under {@link TYPEORM_ODATA_SCOPES}. */
export interface TypeOrmODataScopes {
  readonly byEntity: ReadonlyMap<unknown, ODataScopeDefinition>
  readonly defaultScope?: ODataScopeDefinition
}

/** Options of ODataTypeOrmModule.forFeature(). */
export interface ODataTypeOrmFeatureOptions {
  serviceRoot?: string
  /**
   * OData controllers decorated with @ODataController() that belong to this
   * feature. When provided, forFeature() will:
   *   1. Patch each controller's PATH_METADATA to prepend the serviceRoot
   *      (same job that ODataModule.forRoot({controllers}) does).
   *   2. Register them in this dynamic module's `controllers` array so DI
   *      can resolve `TypeOrmAutoHandler` (which lives in this module).
   */
  controllers?: (new (...args: any[]) => any)[]
  /**
   * Row-level scope for every entity of this feature that has no `scope` of its own.
   * See {@link ODataTypeOrmFeatureConfig.scope}.
   */
  defaultScope?: ODataScopeDefinition
  /**
   * Modules whose exported providers class-based scopes inject (for example the module that
   * provides your access-control service).
   */
  imports?: ModuleMetadata['imports']
}

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
  /**
   * Row-level scope of this entity set: a function `(qb, ctx) => void | Promise<void>` or an
   * injectable class implementing `ODataScope`. It restricts every read and the existence check
   * of every update, replace and delete, including when the entity set is reached through
   * `$expand` or a lambda in `$filter`. See the "Row-level scopes" guide.
   */
  readonly scope?: ODataScopeDefinition
  /**
   * Route POST, PATCH, PUT, DELETE and deep insert of this entity set (also inside `$batch`)
   * through application code instead of the TypeORM repository: an object or an injectable
   * class implementing `ODataWriteHandlers`. See the "Custom write handlers" guide.
   */
  readonly writeHandlers?: ODataWriteHandlersDefinition
  /**
   * Where this entity set's ETag comes from: a property name or a function of the entity.
   * Takes precedence over `@ODataETag` and `@UpdateDateColumn`.
   */
  readonly etag?: ODataETagSource
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
  scopes: Map<EntityClassOrSchema, ODataScopeDefinition>
  writeHandlers: Map<EntityClassOrSchema, ODataWriteHandlersDefinition>
  etags: Map<EntityClassOrSchema, ODataETagSource>
} {
  const entities: EntityClassOrSchema[] = []
  const nameOverrides = new Map<EntityClassOrSchema, string>()
  const scopes = new Map<EntityClassOrSchema, ODataScopeDefinition>()
  const writeHandlers = new Map<EntityClassOrSchema, ODataWriteHandlersDefinition>()
  const etags = new Map<EntityClassOrSchema, ODataETagSource>()
  for (const item of items) {
    if (isFeatureConfig(item)) {
      entities.push(item.entity)
      if (item.name) nameOverrides.set(item.entity, item.name)
      if (item.scope) scopes.set(item.entity, item.scope)
      if (item.writeHandlers) writeHandlers.set(item.entity, item.writeHandlers)
      if (item.etag) etags.set(item.entity, item.etag)
    } else {
      entities.push(item)
    }
  }
  return { entities, nameOverrides, scopes, writeHandlers, etags }
}

/** True for an injectable class (as opposed to a handlers object). */
function isHandlersClass(
  def: ODataWriteHandlersDefinition,
): def is new (...args: any[]) => ODataWriteHandlers<any> {
  return typeof def === 'function'
}

/** True for a class implementing `ODataScope` (as opposed to a scope function). */
function isScopeClass(def: ODataScopeDefinition): def is new (...args: any[]) => ODataScope {
  const proto = (def as { prototype?: { apply?: unknown } }).prototype
  return typeof proto?.apply === 'function'
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
export class TypeOrmEdmInitializer implements OnModuleInit, OnApplicationBootstrap {
  /** Entity sets this feature registered, checked against `requireScope` at bootstrap. */
  private readonly entitySetNames: string[] = []

  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleOptions,
    @Inject(TYPEORM_ODATA_ENTITIES) private readonly entityClasses: EntityClass[],
    @Inject(TYPEORM_ODATA_SET_NAME_OVERRIDES)
    private readonly setNameOverrides: ReadonlyMap<unknown, string>,
    @Inject(TYPEORM_ODATA_SCOPES) private readonly scopes?: TypeOrmODataScopes,
    @Inject(ODataScopeRegistry) private readonly scopeRegistry?: ODataScopeRegistry,
    @Inject(ModuleRef) private readonly moduleRef?: ModuleRef,
    @Inject(TYPEORM_ODATA_WRITES) private readonly writes?: TypeOrmODataWrites,
    @Inject(ODataWriteRegistry) private readonly writeRegistry?: ODataWriteRegistry,
  ) {}

  /** Fail at startup when `requireScope` is on and an entity set of this feature has no scope. */
  onApplicationBootstrap(): void {
    if (!this.options.requireScope || !this.scopeRegistry) return
    const missing = this.entitySetNames.filter((name) => !this.scopeRegistry!.has(name))
    if (missing.length > 0) {
      throw new Error(
        `ODataTypeOrmModule: requireScope is enabled but these entity sets have no row-level ` +
          `scope: ${missing.join(', ')}. Pass a \`scope\` per entity or a \`defaultScope\` to forFeature().`,
      )
    }
  }

  /** Turn a scope definition into a function (resolving class scopes from this module). */
  private toScopeFn(def: ODataScopeDefinition): ODataScopeFn {
    if (!isScopeClass(def)) return def
    const instance = this.moduleRef!.get(def, { strict: true })
    return (qb, ctx) => instance.apply(qb, ctx)
  }

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

      // The registry keeps the first registration of a type, so look the set name up again.
      const registeredSet =
        this.edmRegistry.getEntitySetByTypeName(config.entityTypeName)?.name ?? entitySetName
      this.entitySetNames.push(registeredSet)

      const entityClass =
        this.entityClasses[metadatas.findIndex((m) => m.name === config.entityTypeName)]
      const scopeDef = this.scopes?.byEntity.get(entityClass) ?? this.scopes?.defaultScope
      if (scopeDef && this.scopeRegistry) {
        this.scopeRegistry.register(registeredSet, this.toScopeFn(scopeDef), scopeDef)
      }

      const handlersDef = this.writes?.handlers.get(entityClass)
      if (handlersDef && this.writeRegistry) {
        const handlers = isHandlersClass(handlersDef)
          ? this.moduleRef!.get(handlersDef, { strict: true })
          : handlersDef
        this.writeRegistry.registerHandlers(registeredSet, handlers, handlersDef)
      }
      const etagSource = this.writes?.etags.get(entityClass)
      if (etagSource && this.writeRegistry) {
        this.writeRegistry.registerETag(registeredSet, etagSource)
      }
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
   * Application-wide adapter settings, imported once in the root module (optional). Today it
   * sets the `$batch` changeset runner, which applies to every entity set of the app.
   */
  static forRoot(options: ODataTypeOrmRootOptions = {}): DynamicModule {
    return {
      module: ODataTypeOrmModule,
      global: true,
      providers: [{ provide: ODATA_CHANGESET_RUNNER, useValue: options.changesetRunner }],
      exports: [ODATA_CHANGESET_RUNNER],
    }
  }

  /**
   * Register TypeORM entity classes for OData auto-derivation.
   *
   * @param entities - Array of TypeORM entity classes (decorated with @Entity())
   * @returns DynamicModule that imports TypeOrmModule.forFeature, provides TYPEORM_ODATA_ENTITIES,
   *          and wires TypeOrmEdmInitializer to populate the EdmRegistry at onModuleInit
   */
  static forFeature(
    items: ODataTypeOrmFeatureItem[],
    options?: ODataTypeOrmFeatureOptions,
  ): DynamicModule {
    // Normalize: accept either plain entity classes or { entity, name } config
    // objects in the same array. The name override is applied at EDM-registration
    // time in TypeOrmEdmInitializer.
    const { entities, nameOverrides, scopes, writeHandlers, etags } = normalizeFeatureItems(items)
    const handlerClassProviders: Provider[] = [
      ...new Set([...writeHandlers.values()].filter(isHandlersClass)),
    ]
    const scopeClassProviders: Provider[] = [
      ...new Set(
        [...scopes.values(), ...(options?.defaultScope ? [options.defaultScope] : [])].filter(
          isScopeClass,
        ),
      ),
    ]

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
      imports: [TypeOrmModule.forFeature(entities), ...(options?.imports ?? [])],
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
        {
          provide: TYPEORM_ODATA_SCOPES,
          useValue: {
            byEntity: scopes,
            defaultScope: options?.defaultScope,
          } satisfies TypeOrmODataScopes,
        },
        ...scopeClassProviders,
        ...handlerClassProviders,
        {
          provide: TYPEORM_ODATA_WRITES,
          useValue: {
            handlers: writeHandlers,
            etags,
          } satisfies TypeOrmODataWrites,
        },
        {
          // One registry per application, shared by every forFeature() import.
          provide: ODataWriteRegistry,
          useFactory: (edmRegistry: EdmRegistry) => ODataWriteRegistry.for(edmRegistry),
          inject: [EdmRegistry],
        },
        {
          // One registry per application, shared by every forFeature() import.
          provide: ODataScopeRegistry,
          useFactory: (edmRegistry: EdmRegistry) => ODataScopeRegistry.for(edmRegistry),
          inject: [EdmRegistry],
        },
        TypeOrmScopeService,
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
            scopeService: TypeOrmScopeService,
            writeRegistry: ODataWriteRegistry,
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
              scopeService,
              writeRegistry,
            )
          },
          inject: [
            TypeOrmQueryTranslator,
            EdmRegistry,
            ODATA_MODULE_OPTIONS,
            DataSource,
            TypeOrmETagProvider,
            TypeOrmScopeService,
            ODataWriteRegistry,
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
        TypeOrmScopeService,
        ODataScopeRegistry,
        ODataWriteRegistry,
      ],
    }
  }
}
