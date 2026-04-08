# @nestjs-odata/core

Core OData v4 library for NestJS — parser, EDM, decorators, interceptors, and batch support.

[![npm version](https://img.shields.io/npm/v/@nestjs-odata/core.svg)](https://www.npmjs.com/package/@nestjs-odata/core)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-odata/core.svg)](https://www.npmjs.com/package/@nestjs-odata/core)
[![license](https://img.shields.io/npm/l/@nestjs-odata/core.svg)](https://github.com/cberd1509/nestjs-odata/blob/main/LICENSE)

## Features

- OData v4 query parser (`$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip`, `$count`)
- EDM (Entity Data Model) auto-derivation via decorators
- `ODataModule` — drop-in NestJS module with zero boilerplate
- Request/response interceptors for spec-compliant OData envelopes
- `$batch` multi-operation support
- Decorator-first API — annotate once, get OData for free

## Installation

```bash
pnpm add @nestjs-odata/core @nestjs-odata/typeorm reflect-metadata
```

## Quick Start

```typescript
import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { ODataModule } from '@nestjs-odata/core'
import { TypeOrmODataModule } from '@nestjs-odata/typeorm'
import { Product } from './product.entity'

@Module({
  imports: [
    ODataModule.forRoot({ serviceRoot: '/odata' }),
    TypeOrmODataModule.forFeature([Product]),
  ],
})
export class AppModule {}
```

Visit `GET /odata/$metadata` to see the auto-generated EDM.

## Documentation

Full documentation, guides, and API reference:
**https://cberd1509.github.io/nestjs-odata/**

## Repository

https://github.com/cberd1509/nestjs-odata

## License

MIT
