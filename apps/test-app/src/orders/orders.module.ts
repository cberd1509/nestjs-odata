import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Order } from '../entities/index.js'
import { OrdersController } from './orders.controller.js'

// Patch PATH_METADATA so NestJS routes OrdersController at /odata/Orders.
// This replicates the same mechanism used by ODataModule.forRoot({ controllers })
// but keeps OrdersController in OrdersModule where TypeOrmAutoHandler is
// provided by ODataTypeOrmModule.forFeature (satisfying the DI graph).
Reflect.defineMetadata(PATH_METADATA, 'odata/Orders', OrdersController)

/**
 * OrdersModule — feature module for the Orders OData entity set.
 *
 * Imports ODataTypeOrmModule.forFeature([Order]) to register
 * TypeOrmQueryTranslator and TypeOrmAutoHandler providers.
 *
 * OrdersController is registered here so that NestJS can resolve
 * TypeOrmAutoHandler from this module's provider scope.
 * PATH_METADATA is patched above at import time to route at /odata/Orders.
 */
@Module({
  imports: [ODataTypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
})
export class OrdersModule {}
