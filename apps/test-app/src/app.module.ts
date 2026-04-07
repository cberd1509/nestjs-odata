import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product, Category, Customer, Order, OrderItem, Tag } from './entities/index.js'
import { ProductsModule } from './products/products.module.js'

/**
 * Test application module that wires ODataModule + ODataTypeOrmModule
 * with an in-memory SQLite database using all 6 test entities.
 *
 * Used for e2e tests that validate the $metadata endpoint and OData query surface.
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
    ODataTypeOrmModule.forFeature([Product, Category, Customer, Order, OrderItem, Tag]),
    ProductsModule,
  ],
})
export class AppModule {}
