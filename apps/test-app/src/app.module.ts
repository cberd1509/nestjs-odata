import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product, Category, Customer, Order, OrderItem, Tag } from './entities/index.js'
import { ProductsModule } from './products/products.module.js'
import { OrdersModule } from './orders/orders.module.js'
import { HealthModule } from './health/health.module.js'

/**
 * Test application module that wires ODataModule + ODataTypeOrmModule
 * with an in-memory SQLite database using all 6 test entities.
 *
 * ProductsController is registered in ProductsModule (which imports
 * ODataTypeOrmModule.forFeature providing TypeOrmAutoHandler).
 * ODataModule.forRoot patches PATH_METADATA for @ODataController classes
 * listed in controllers — ProductsController's path is patched here too
 * via the same mechanism used by ODataModule.forRoot.
 *
 * HealthModule provides a plain NestJS controller at /api/health for
 * route isolation testing (RESP-03, MOD-05, T-04-14).
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Product, Category, Customer, Order, OrderItem, Tag],
      synchronize: true,
    }),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      namespace: 'Default',
    }),
    ODataTypeOrmModule.forFeature([Product, Category, Customer, Order, OrderItem, Tag], {
      serviceRoot: '/odata',
    }),
    ProductsModule,
    OrdersModule,
    HealthModule,
  ],
})
export class AppModule {}
