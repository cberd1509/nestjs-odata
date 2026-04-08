# Request Body Validation

`nestjs-odata` accepts request bodies as `Record<string, unknown>` by default, giving you full control over validation. This page shows how to integrate NestJS's standard validation pipeline with your OData endpoints.

## Overview

OData POST and PATCH handlers receive the raw request body via `@Body()`. Validation is opt-in — you choose the validation strategy that fits your application. The recommended approach uses `class-validator` and `class-transformer`, which are the NestJS standard.

## Setup

Install the validation packages:

```bash
pnpm add class-validator class-transformer
```

## Define a DTO with validation decorators

Create a DTO (Data Transfer Object) class with `class-validator` decorators:

```typescript
// create-product.dto.ts
import { IsString, IsNumber, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator'

export class CreateProductDto {
  @IsString()
  @MaxLength(255)
  name: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number

  @IsBoolean()
  @IsOptional()
  inStock?: boolean
}
```

For PATCH (partial updates), create a separate DTO where all fields are optional:

```typescript
// update-product.dto.ts
import { IsString, IsNumber, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator'

export class UpdateProductDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  price?: number

  @IsBoolean()
  @IsOptional()
  inStock?: boolean
}
```

## Apply ValidationPipe to OData handlers

Use NestJS's `ValidationPipe` on individual handlers or apply it globally.

### Per-handler validation

```typescript
// products.controller.ts
import { Body, Param, UsePipes, ValidationPipe } from '@nestjs/common'
import { ODataController, ODataPost, ODataPatch } from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'
import { CreateProductDto } from './create-product.dto'
import { UpdateProductDto } from './update-product.dto'

@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataPost('Products')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createProduct(@Body() body: CreateProductDto) {
    return this.handler.handleCreate(body, 'Products')
  }

  @ODataPatch('Products')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async updateProduct(@Param('key') key: string, @Body() body: UpdateProductDto) {
    return this.handler.handleUpdate(key, body, 'Products')
  }
}
```

### Global validation

Apply the `ValidationPipe` globally in `main.ts` so it covers all endpoints:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  await app.listen(3000)
}
bootstrap()
```

### ValidationPipe options explained

| Option                       | Effect                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `whitelist: true`            | Strips properties not defined in the DTO                                         |
| `transform: true`            | Converts plain objects to DTO class instances (required for `class-transformer`) |
| `forbidNonWhitelisted: true` | Returns 400 if the request contains unknown properties                           |

## Error response

When validation fails, NestJS returns a `400 Bad Request` with details about each violation:

```json
{
  "statusCode": 400,
  "message": [
    "name must be shorter than or equal to 255 characters",
    "price must not be less than 0",
    "price must be a number conforming to the specified constraints"
  ],
  "error": "Bad Request"
}
```

::: tip OData error format
The default NestJS error response does not follow the OData error format (`{ "error": { "code": "...", "message": "..." } }`). If you need OData-compliant error responses, use a NestJS exception filter to transform validation errors into the OData format.
:::

## Validation without class-validator

If you prefer schema-based validation (e.g., with Zod), you can validate manually in the handler:

```typescript
import { z } from 'zod'
import { BadRequestException } from '@nestjs/common'

const createProductSchema = z.object({
  name: z.string().max(255),
  price: z.number().nonnegative(),
  inStock: z.boolean().optional(),
})

@ODataPost('Products')
async createProduct(@Body() body: Record<string, unknown>) {
  const result = createProductSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException(result.error.flatten().fieldErrors)
  }
  return this.handler.handleCreate(result.data, 'Products')
}
```

## Next steps

- [CRUD Operations](./crud.md) — Request and response shapes for create, update, delete
- [Security](./security.md) — Server-side query limits
- [Troubleshooting](./troubleshooting.md) — Common issues and solutions
