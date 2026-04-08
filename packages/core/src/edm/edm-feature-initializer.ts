import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { EdmRegistry } from './edm-registry.js'
import type { EdmEntityConfig, EdmEntitySet } from './edm-entity-set.js'
import type { EdmEntityType } from './edm-entity-type.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import { EDM_ENTITY_CONFIGS, ODATA_MODULE_OPTIONS } from '../tokens.js'

/**
 * EdmFeatureInitializer — consumes pre-built EdmEntityConfig[] from the
 * EDM_ENTITY_CONFIGS token and registers them into EdmRegistry at module init.
 *
 * This closes the MOD-02 gap: ODataModule.forFeature() provides the token but
 * nothing consumed it, making core-only entity registration inert.
 *
 * Pattern mirrors TypeOrmEdmInitializer in @nestjs-odata/typeorm but operates
 * on already-derived EdmEntityConfig[] (no TypeORM derivation step needed).
 */
@Injectable()
export class EdmFeatureInitializer implements OnModuleInit {
  constructor(
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Inject(EDM_ENTITY_CONFIGS) private readonly entityConfigs: EdmEntityConfig[],
  ) {}

  onModuleInit(): void {
    const namespace = this.options.namespace
    for (const config of this.entityConfigs) {
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
