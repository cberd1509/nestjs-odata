# Getting Started

`nestjs-odata` gives you spec-compliant OData v4 endpoints in NestJS with zero double-declaration. Define your TypeORM entities once — the library auto-derives the EDM, `$metadata`, query translation, CRUD, and `$batch`.

## Installation

```bash
# Core package (ORM-agnostic)
npm install @nestjs-odata/core reflect-metadata

# TypeORM adapter
npm install @nestjs-odata/typeorm

# Required peer dependencies (if not already installed)
npm install @nestjs/common @nestjs/core typeorm @nestjs/typeorm
```

::: tip pnpm / yarn

```bash
# pnpm
pnpm add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata

# yarn
yarn add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata
```

:::

## TypeScript configuration

Enable decorator metadata in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Step 1 — Define a TypeORM entity

```typescript
// product.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  @Column('decimal', { precision: 10, scale: 2 })
  price: number

  @Column({ default: true })
  inStock: boolean
}
```

No OData-specific decorators required. The library reads TypeORM metadata automatically.

## Step 2 — Create a controller

```typescript
// products.controller.ts
import { Body, Param, Req, UsePipes } from '@nestjs/common'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataPost,
  ODataPatch,
  ODataDelete,
  ODataQueryParam,
  ODataQueryPipe,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Products', { path: '' })
  @UsePipes(ODataQueryPipe)
  async getProducts(
    @ODataQueryParam('Products') query: ODataQuery,
    @Req() req: { originalUrl: string },
  ) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @ODataGetByKey('Products')
  async getProduct(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Products')
  }

  @ODataPost('Products')
  async createProduct(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Products')
  }

  @ODataPatch('Products')
  async updateProduct(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.handler.handleUpdate(key, body, 'Products')
  }

  @ODataDelete('Products')
  async deleteProduct(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Products')
  }
}
```

## Step 3 — Register the modules

```typescript
// app.module.ts
import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from './product.entity'
import { ProductsController } from './products.controller'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'user',
      password: 'pass',
      database: 'mydb',
      entities: [Product],
      synchronize: true,
    }),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      controllers: [ProductsController],
    }),
    ODataTypeOrmModule.forFeature([Product], { serviceRoot: '/odata' }),
  ],
})
export class AppModule {}
```

## Step 4 — Query your endpoint

Your OData service is ready. Try these requests:

```bash
# List all products
curl http://localhost:3000/odata/Products

# Filter by price
curl 'http://localhost:3000/odata/Products?$filter=price lt 100'

# Select specific fields with count
curl 'http://localhost:3000/odata/Products?$select=name,price&$count=true'

# Get entity metadata
curl http://localhost:3000/odata/$metadata
```

**Response envelope** (OData JSON format):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products",
  "value": [
    { "id": 1, "name": "Widget", "price": 9.99, "inStock": true },
    { "id": 2, "name": "Gadget", "price": 49.99, "inStock": false }
  ]
}
```

## What's auto-generated

- **`GET /odata/$metadata`** — CSDL XML describing all entity types and sets
- **`GET /odata/`** — OData service document listing all entity sets
- **`POST /odata/$batch`** — Multi-operation batch endpoint (requires `ODataTypeOrmModule`)
- **Query options** — `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`, `$expand`

## Next steps

- [Configuration](./configuration.md) — Global limits, namespace, async setup
- [Query Options](./query-options.md) — Full `$filter`, `$select`, `$orderby`, pagination reference
- [CRUD Operations](./crud.md) — Create, update, delete request/response shapes
- [Security](./security.md) — `maxTop`, `maxExpandDepth`, `maxFilterDepth`, per-entity overrides
