import { DynamicModule, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type.js'

/**
 * DI injection token for the array of TypeORM entity classes
 * registered via ODataTypeOrmModule.forFeature().
 */
export const TYPEORM_ODATA_ENTITIES = Symbol('TYPEORM_ODATA_ENTITIES')

/**
 * TypeORM adapter module for @nestjs-odata/core.
 *
 * Wraps TypeOrmModule.forFeature() and registers the entity classes
 * under the TYPEORM_ODATA_ENTITIES token so that TypeOrmEdmDeriver
 * (Plan 03) can auto-derive OData EDM metadata from TypeORM entity metadata.
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
   * @returns DynamicModule that imports TypeOrmModule.forFeature and exposes TYPEORM_ODATA_ENTITIES
   */
  static forFeature(entities: EntityClassOrSchema[]): DynamicModule {
    return {
      module: ODataTypeOrmModule,
      imports: [TypeOrmModule.forFeature(entities)],
      providers: [
        {
          provide: TYPEORM_ODATA_ENTITIES,
          useValue: entities,
        },
        // TypeOrmEdmDeriver will be added in Plan 03 when the deriver is implemented.
      ],
      exports: [TYPEORM_ODATA_ENTITIES],
    }
  }
}
