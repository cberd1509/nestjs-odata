# Getting Started

[OData](https://www.odata.org/) (Open Data Protocol) is a standardized REST protocol for queryable APIs, backed by OASIS and used by Microsoft, SAP, and enterprise clients. It defines conventions for filtering, sorting, pagination, and metadata — so clients and servers speak the same language.

`nestjs-odata` gives you spec-compliant OData v4 endpoints in NestJS with zero double-declaration. Define your TypeORM entities once — the library auto-derives the EDM, `$metadata`, query translation, CRUD, and `$batch`.

## Installation

```bash
# pnpm (recommended)
pnpm add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata

# npm
npm install @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata

# yarn
yarn add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata
```

Required peer dependencies (if not already installed):

```bash
pnpm add @nestjs/common @nestjs/core typeorm @nestjs/typeorm
```

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

**Why `req.originalUrl`?** The `handleGet` method needs the full request URL (including query string) to build the `@odata.context` URL in the response envelope. NestJS's `@Req()` provides the Express/Fastify request object, and `originalUrl` contains the unmodified path + query string (e.g. `/odata/Products?$top=10`).

> **Auto-provided handler:** `TypeOrmAutoHandler` is automatically registered as an injectable provider by `ODataTypeOrmModule.forFeature()`. You do not need to add it to any `providers` array — just inject it in your controller constructor.

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
    // SQLite in-memory for zero-friction setup — no external DB required
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
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

> **Switching databases:** The SQLite in-memory setup requires no external services — perfect for getting started and running tests. For production, swap in PostgreSQL, MySQL, or any [TypeORM-supported driver](https://typeorm.io/data-source-options) by changing the `TypeOrmModule.forRoot()` options (e.g. `type: 'postgres'`, `host`, `port`, `username`, `password`, `database`).

## Step 3b — Bootstrap the application

```typescript
// main.ts
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  await app.listen(3000)
}
bootstrap()
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
- **`GET /odata/Products/$count`** — Plain-text count of entities (automatic with `TypeOrmAutoHandler`)
- **Query options** — `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`, `$expand`

## Next steps

- [Configuration](./configuration.md) — Global limits, namespace, async setup
- [Query Options](./query-options.md) — Full `$filter`, `$select`, `$orderby`, pagination reference
- [Filter Functions](./filter-functions.md) — Lambda `any`/`all`, arithmetic, date/time, string functions
- [CRUD Operations](./crud.md) — Create, update, delete request/response shapes
- [Security](./security.md) — `maxTop`, `maxExpandDepth`, `maxFilterDepth`, per-entity overrides
