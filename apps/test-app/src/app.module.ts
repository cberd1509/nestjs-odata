import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product, Category, Customer, Order, OrderItem, Tag } from './entities/index.js'
import { ProductsController } from './products/products.controller.js'
import { OrdersController } from './orders/orders.controller.js'
import { ProductsModule } from './products/products.module.js'
import { OrdersModule } from './orders/orders.module.js'
import { HealthModule } from './health/health.module.js'

/**
 * Test application module that wires ODataModule + ODataTypeOrmModule
 * with an in-memory SQLite database using all 6 test entities.
 *
 * Per D-01, D-02: ODataModule.forRoot({ controllers }) centralizes
 * serviceRoot PATH_METADATA patching. Feature modules (ProductsModule,
 * OrdersModule) are plain @Module declarations with zero OData boilerplate.
 *
 * Per D-07, D-08: ODataTypeOrmModule.forFeature() inherits serviceRoot
 * from ODataModule.registeredServiceRoot — no serviceRoot param needed.
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
      controllers: [ProductsController, OrdersController],
    }),
    ODataTypeOrmModule.forFeature([Product, Category, Customer, Order, OrderItem, Tag]),
    ProductsModule,
    OrdersModule,
    HealthModule,
  ],
})
export class AppModule {}
