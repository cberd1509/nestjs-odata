import { Module } from '@nestjs/common'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Order } from '../entities/index.js'
import { OrdersController } from './orders.controller.js'

/**
 * OrdersModule — feature module for the Orders OData entity set.
 *
 * Per D-01, D-02, D-03: No PATH_METADATA patching needed here.
 * ODataModule.forRoot({ controllers: [OrdersController] }) in AppModule
 * handles serviceRoot prefixing automatically.
 */
@Module({
  imports: [ODataTypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
})
export class OrdersModule {}
