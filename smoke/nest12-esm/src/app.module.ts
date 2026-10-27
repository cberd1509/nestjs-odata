import 'reflect-metadata'
import { Body, Get, Header, Module, Param, Req } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataModule,
  ODataPost,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { ODataTypeOrmModule, TypeOrmAutoHandler } from '@nestjs-odata/typeorm'
import { Category, Product } from './entities.js'

@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Products', { path: '' })
  list(@ODataQueryParam('Products') query: ODataQuery, @Req() req: { originalUrl: string }) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @Get('$count')
  @Header('Content-Type', 'text/plain')
  count(@ODataQueryParam('Products') query: ODataQuery) {
    return this.handler.handleCount(query)
  }

  @ODataGetByKey('Products')
  byKey(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Products')
  }

  @ODataPost('Products')
  create(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Products')
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Product, Category],
      synchronize: true,
    }),
    ODataModule.forRoot({ serviceRoot: '/odata' }),
    ODataTypeOrmModule.forFeature([Product, Category], { controllers: [ProductsController] }),
  ],
})
export class AppModule {}
