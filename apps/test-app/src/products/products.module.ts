import { Module } from '@nestjs/common'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from '../entities/index.js'
import { ProductsController } from './products.controller.js'

/**
 * ProductsModule — feature module for the Products OData entity set.
 *
 * Imports ODataTypeOrmModule.forFeature([Product]) to register
 * TypeOrmQueryTranslator and TypeOrmAutoHandler providers.
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
