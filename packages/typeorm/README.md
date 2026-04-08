# @nestjs-odata/typeorm

TypeORM adapter for [@nestjs-odata/core](https://www.npmjs.com/package/@nestjs-odata/core) — auto-derives OData EDM from TypeORM entity metadata with zero double-declaration.

[![npm version](https://img.shields.io/npm/v/@nestjs-odata/typeorm.svg)](https://www.npmjs.com/package/@nestjs-odata/typeorm)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-odata/typeorm.svg)](https://www.npmjs.com/package/@nestjs-odata/typeorm)
[![license](https://img.shields.io/npm/l/@nestjs-odata/typeorm.svg)](https://github.com/cberd1509/nestjs-odata/blob/main/LICENSE)

## Features

- Auto-derives OData EDM from TypeORM `@Entity` / `@Column` decorators — no separate OData schema
- Translates OData `$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip` to TypeORM QueryBuilder
- Built-in CRUD operations via `TypeOrmODataController`
- Works alongside regular NestJS/TypeORM routes — no lock-in

## Installation

```bash
pnpm add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata
```

## Quick Start

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'
import { ODataEntity } from '@nestjs-odata/core'
import { TypeOrmODataController } from '@nestjs-odata/typeorm'

@ODataEntity()
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  @Column('decimal')
  price: number
}

// Controller — inherits GET /odata/Products, $filter, $top, $skip, etc.
@Controller()
export class ProductsController extends TypeOrmODataController(Product) {}
```

## Documentation

Full documentation, guides, and API reference:
**https://cberd1509.github.io/nestjs-odata/**

## Repository

https://github.com/cberd1509/nestjs-odata

## License

MIT
