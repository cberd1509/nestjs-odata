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
 * Per D-01, D-02, D-03: No PATH_METADATA patching needed here.
 * ODataModule.forRoot({ controllers: [ProductsController] }) in AppModule
 * handles serviceRoot prefixing automatically.
 *
 * ProductsController is registered here for DI scoping so NestJS can
 * resolve TypeOrmAutoHandler from this module's provider scope.
 */
@Module({
  imports: [ODataTypeOrmModule.forFeature([Product])],
  controllers: [ProductsController],
})
export class ProductsModule {}
