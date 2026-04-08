# nestjs-odata

[![npm version](https://img.shields.io/npm/v/@nestjs-odata/core)](https://www.npmjs.com/package/@nestjs-odata/core)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-odata/core)](https://www.npmjs.com/package/@nestjs-odata/core)
[![CI](https://img.shields.io/github/actions/workflow/status/nestjs-odata/nestjs-odata/ci.yml)](https://github.com/nestjs-odata/nestjs-odata/actions)
[![license](https://img.shields.io/github/license/nestjs-odata/nestjs-odata)](https://github.com/nestjs-odata/nestjs-odata/blob/main/LICENSE)

OData v4 for NestJS with zero double-declaration. Define your entities once in TypeORM and get spec-compliant OData endpoints automatically — `$metadata`, `$filter`, `$select`, `$orderby`, `$expand`, `$batch`, and more.

[Documentation](https://nestjs-odata.github.io/nestjs-odata/)

## Features

- **Zero double-declaration** — Auto-derive the EDM from TypeORM entities. No manual OData schema maintenance.
- **Spec compliant** — Built from the OASIS OData v4 ABNF grammar. Responses pass OData validation.
- **NestJS native** — Works with NestJS decorators, guards, pipes, and interceptors. Mix OData and REST routes freely.
- **Rich query support** — `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`, `$expand`, lambda `any`/`all`, arithmetic, date/time and string functions.
- **$batch support** — Multi-operation batch requests with atomic changesets.
- **Security built-in** — `maxTop`, `maxExpandDepth`, `maxFilterDepth` limits enforced server-side. Parameterized queries prevent SQL injection.

## Quick start

```bash
pnpm add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata
```

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
}
```

```typescript
// app.module.ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from './product.entity'
import { ProductsController } from './products.controller'

@Module({
  imports: [
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

Then query your data:

```bash
curl 'http://localhost:3000/odata/Products?$filter=price lt 100&$orderby=name&$top=10'
```

See the [Getting Started](https://nestjs-odata.github.io/nestjs-odata/guide/getting-started) guide for the full walkthrough.

## Packages

| Package                                       | Description                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| [`@nestjs-odata/core`](./packages/core)       | OData decorators, query parsing, EDM, metadata, batch         |
| [`@nestjs-odata/typeorm`](./packages/typeorm) | TypeORM adapter — auto-derives EDM, translates queries to SQL |

## License

[MIT](./LICENSE)
