import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from '../entities/index.js'
import { ProductsController } from './products.controller.js'

// Patch PATH_METADATA so NestJS routes ProductsController at /odata/Products.
// This replicates the same mechanism used by ODataModule.forRoot({ controllers })
// but keeps ProductsController in ProductsModule where TypeOrmAutoHandler is
// provided by ODataTypeOrmModule.forFeature (satisfying the DI graph).
Reflect.defineMetadata(PATH_METADATA, 'odata/Products', ProductsController)

/**
 * ProductsModule — feature module for the Products OData entity set.
 *
 * Imports ODataTypeOrmModule.forFeature([Product]) to register
 * TypeOrmQueryTranslator and TypeOrmAutoHandler providers.
 *
 * ProductsController is registered here (not via ODataModule.forRoot) so that
 * NestJS can resolve TypeOrmAutoHandler from this module's provider scope.
 * PATH_METADATA is patched above at import time to route at /odata/Products
 * (matching what ODataModule.forRoot would do for serviceRoot='/odata').
 *
 * EdmRegistry.register() is idempotent: if Product is already registered
 * (e.g. from the root AppModule's forFeature call), the second registration
 * is silently skipped — no duplicate error.
 */
@Module({
  imports: [ODataTypeOrmModule.forFeature([Product])],
  controllers: [ProductsController],
})
export class ProductsModule {}
