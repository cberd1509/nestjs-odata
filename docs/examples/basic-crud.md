# Basic CRUD Example

A complete working example showing a `Product` entity with full OData CRUD support.

## Project structure

```
src/
├── app.module.ts
├── main.ts
├── product.entity.ts
├── products/
│   ├── products.module.ts
│   └── products.controller.ts
```

## Entity

```typescript
// product.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ length: 200 })
  name: string

  @Column('decimal', { precision: 10, scale: 2 })
  price: number

  @Column({ default: true })
  inStock: boolean
}
```

## Controller

```typescript
// products/products.controller.ts
import { Body, Get, Header, Param, Req, Headers } from '@nestjs/common'
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

@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

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
}
```

## Feature module

```typescript
// products/products.module.ts
import { Module } from '@nestjs/common'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from '../product.entity'
import { ProductsController } from './products.controller'

@Module({
  imports: [ODataTypeOrmModule.forFeature([Product])],
  controllers: [ProductsController],
})
export class ProductsModule {}
```

## App module

```typescript
// app.module.ts
import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { Product } from './product.entity'
import { ProductsController } from './products/products.controller'
import { ProductsModule } from './products/products.module'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'products_db',
      entities: [Product],
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      namespace: 'Default',
      controllers: [ProductsController],
    }),
    ProductsModule,
  ],
})
export class AppModule {}
```

## Bootstrap

```typescript
// main.ts
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  await app.listen(3000)
  console.log('OData service running at http://localhost:3000/odata')
}
bootstrap()
```

## Sample requests

```bash
# Get service document
curl http://localhost:3000/odata/

# Get $metadata
curl http://localhost:3000/odata/$metadata

# Create a product
curl -X POST http://localhost:3000/odata/Products \
  -H 'Content-Type: application/json' \
  -d '{"name":"Widget","price":9.99,"inStock":true}'

# List products with filter and select
curl 'http://localhost:3000/odata/Products?$filter=inStock eq true&$select=id,name,price&$orderby=price asc'

# Get count of in-stock products
curl 'http://localhost:3000/odata/Products/$count?$filter=inStock eq true'

# Get single product
curl http://localhost:3000/odata/Products/1

# Update price
curl -X PATCH http://localhost:3000/odata/Products/1 \
  -H 'Content-Type: application/json' \
  -d '{"price":7.99}'

# Delete product
curl -X DELETE http://localhost:3000/odata/Products/1
```

## Expected responses

**Service document** (`GET /odata/`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata",
  "value": [{ "name": "Products", "url": "Products" }]
}
```

**Create** (`POST /odata/Products` → `201 Created`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products/$entity",
  "id": 1,
  "name": "Widget",
  "price": 9.99,
  "inStock": true
}
```

**Collection with filter** (`GET /odata/Products?$filter=inStock eq true`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products",
  "value": [{ "id": 1, "name": "Widget", "price": 9.99, "inStock": true }]
}
```
