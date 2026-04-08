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
  ODataModuleResolvedOptions,
} from '@nestjs-odata/core'
import {
  EdmRegistry,
  ETAG_PROVIDER,
  ODATA_MODULE_OPTIONS,
  type ODataModuleOptions,
} from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from './deriver/typeorm-edm-deriver.js'
import { TypeOrmQueryTranslator } from './translator/typeorm-query-translator.js'
import { TypeOrmAutoHandler } from './translator/typeorm-auto-handler.js'
import { TypeOrmETagProvider } from './etag/typeorm-etag.provider.js'
import { BatchController } from './batch/batch-controller.js'

/**
 * DI injection token for the array of TypeORM entity classes
 * registered via ODataTypeOrmModule.forFeature().
 */
export const TYPEORM_ODATA_ENTITIES = Symbol('TYPEORM_ODATA_ENTITIES')

/**
 * TypeOrmEdmInitializer — runs at module init to derive EDM from TypeORM entities
 * and register them in the EdmRegistry.
 *
 * Per D-06, D-16, EDM-06: EDM derivation happens after DataSource is ready (onModuleInit).
 */
@Injectable()
export class TypeOrmEdmInitializer implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleOptions,
    @Inject(TYPEORM_ODATA_ENTITIES) private readonly entityClasses: EntityClass[],
  ) {}

  onModuleInit(): void {
    const deriver = new TypeOrmEdmDeriver(
      this.options.namespace ?? 'Default',
      this.options.unmappedTypeStrategy ?? 'skip',
    )
    const metadatas = this.entityClasses.map((cls) => this.dataSource.getMetadata(cls))
    const configs: EdmEntityConfig[] = deriver.deriveEntityTypes(this.entityClasses, metadatas)

    for (const config of configs) {
      const namespace = this.options.namespace ?? 'Default'
      const entityType: EdmEntityType = {
        name: config.entityTypeName,
        namespace,
        properties: config.properties,
        navigationProperties: config.navigationProperties,
        keyProperties: config.keyProperties,
        isReadOnly: config.isReadOnly,
      }
      const entitySet: EdmEntitySet = {
        name: config.entitySetName,
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
    entities: EntityClassOrSchema[],
    options?: { serviceRoot?: string },
  ): DynamicModule {
    // Patch BatchController's PATH_METADATA to include the serviceRoot so
    // POST {serviceRoot}/$batch is registered correctly.
    // This mirrors how ODataModule.forRoot() patches @ODataController paths.
    // Patch BatchController's PATH_METADATA to the serviceRoot prefix.
    // The method decorator @Post('$batch') adds the '$batch' suffix, so the
    // controller prefix must be just the serviceRoot (e.g. 'odata'),
    // resulting in the full route: /odata/$batch.
    const serviceRoot = options?.serviceRoot ?? 'odata'
    const root = serviceRoot.startsWith('/') ? serviceRoot.slice(1) : serviceRoot
    Reflect.defineMetadata(PATH_METADATA, root, BatchController)

    return {
      module: ODataTypeOrmModule,
      imports: [TypeOrmModule.forFeature(entities)],
      controllers: [BatchController],
      providers: [
        {
          provide: TYPEORM_ODATA_ENTITIES,
          useValue: entities,
        },
        TypeOrmEdmInitializer,
        {
          provide: TypeOrmQueryTranslator,
          useFactory: (
            dataSource: DataSource,
            edmRegistry: EdmRegistry,
            options: ODataModuleResolvedOptions,
          ): TypeOrmQueryTranslator => {
            // Use a shared repository for query builder creation.
            // TypeOrmQueryTranslator uses repo.createQueryBuilder() which accepts any entity target.
            // The DataSource repository is typed as ObjectLiteral which satisfies the translator.
            const firstEntity = entities[0]
            if (!firstEntity) {
              throw new Error('ODataTypeOrmModule.forFeature() requires at least one entity class')
            }
            const repo = dataSource.getRepository(firstEntity as new () => ObjectLiteral)
            return new TypeOrmQueryTranslator(repo, edmRegistry, options)
          },
          inject: [DataSource, EdmRegistry, ODATA_MODULE_OPTIONS],
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
            return new TypeOrmAutoHandler(translator, edmRegistry, options, repo, etagProvider)
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
      ],
    }
  }
}
