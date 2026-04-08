# Custom Controller

Mix OData and non-OData routes on the same controller or module without conflicts.

## Mixing OData and REST routes

OData routes and regular NestJS routes coexist cleanly. Use `@ODataController` for OData operations and standard NestJS decorators for custom REST endpoints:

```typescript
// products/products.controller.ts
import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Req } from '@nestjs/common'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataPost,
  ODataPatch,
  ODataDelete,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'
import { ProductsService } from './products.service'

@ODataController('Products')
export class ProductsController {
  constructor(
    private readonly handler: TypeOrmAutoHandler,
    private readonly productsService: ProductsService,
  ) {}

  // --- OData routes ---

  @ODataGet('Products', { path: '' })
  async getProducts(
    @ODataQueryParam('Products') query: ODataQuery,
    @Req() req: { originalUrl: string },
  ) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @Get('$count')
  @Header('Content-Type', 'text/plain')
  async count(@ODataQueryParam('Products') query: ODataQuery): Promise<number> {
    return this.handler.handleCount(query)
  }

  @ODataGetByKey('Products')
  async getProduct(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Products', ifNoneMatch)
  }

  @ODataPost('Products')
  async createProduct(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Products')
  }

  @ODataPatch('Products')
  async updateProduct(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Products', ifMatch)
  }

  @ODataDelete('Products')
  async deleteProduct(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Products', ifMatch)
  }

  // --- Custom non-OData routes ---
  // These are registered at the same controller path prefix (/odata/Products)
  // but NestJS resolves them correctly before the OData wildcard routes.

  /**
   * Custom action: POST /odata/Products/bulk-import
   * Imports products from a CSV payload — no OData equivalent.
   */
  @Post('bulk-import')
  @HttpCode(202)
  async bulkImport(@Body() payload: { csv: string }) {
    const count = await this.productsService.importFromCsv(payload.csv)
    return { imported: count, status: 'accepted' }
  }

  /**
   * Custom read: GET /odata/Products/featured
   * Returns a curated list without OData query options.
   */
  @Get('featured')
  async getFeatured() {
    return this.productsService.getFeaturedProducts()
  }
}
```

## Separate controller for non-OData routes

For cleaner separation, use a completely separate NestJS controller for non-OData routes:

```typescript
// health/health.controller.ts
import { Controller, Get } from '@nestjs/common'

@Controller('api')
export class HealthController {
  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }
}
```

This controller lives at `/api/health` — completely separate from the OData service at `/odata/`.

## Module setup

```typescript
// app.module.ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from './product.entity'
import { ProductsController } from './products/products.controller'
import { ProductsModule } from './products/products.module'
import { HealthModule } from './health/health.module'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      /* ... */
    }),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      namespace: 'Default',
      controllers: [ProductsController],
    }),
    ODataTypeOrmModule.forFeature([Product]),
    ProductsModule,
    HealthModule, // Plain NestJS module — no OData involvement
  ],
})
export class AppModule {}
```

## Route isolation

Routes are completely isolated:

| Route                              | Source               | Description                         |
| ---------------------------------- | -------------------- | ----------------------------------- |
| `GET /odata/$metadata`             | Auto-generated       | CSDL XML                            |
| `GET /odata/Products`              | `@ODataGet`          | OData collection with query options |
| `GET /odata/Products/:key`         | `@ODataGetByKey`     | Single entity                       |
| `POST /odata/Products`             | `@ODataPost`         | OData create                        |
| `POST /odata/Products/bulk-import` | `@Post`              | Custom REST endpoint                |
| `GET /odata/Products/featured`     | `@Get`               | Custom REST endpoint                |
| `GET /api/health`                  | `@Controller('api')` | Plain NestJS controller             |

OData response serialization does not leak into non-OData routes. Regular NestJS routes return plain JSON using the default Express/Fastify serializer.

## Using guards on mixed controllers

NestJS guards apply at the controller, method, or route level regardless of whether the route is OData or not:

```typescript
import { UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

// All routes in this controller require JWT
@ODataController('Products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  // OData routes inherit the guard

  // Custom route also gets the guard
  @Post('bulk-import')
  @HttpCode(202)
  async bulkImport(@Body() payload: { csv: string }) {
    // ...
  }
}
```
