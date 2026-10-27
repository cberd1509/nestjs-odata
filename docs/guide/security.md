# Security

`nestjs-odata` includes built-in protections against common DoS and resource exhaustion attacks from unbounded OData queries. All limits are enforced server-side — clients cannot bypass them.

## Query limits

### maxTop — result size limit

Limits the number of entities a client can request in a single query.

**Default:** `1000`

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  maxTop: 500, // No more than 500 entities per request
})
```

::: warning Rejection, not clamping
`nestjs-odata` **rejects** `$top` values that exceed `maxTop` with HTTP 400. It does not silently adjust the value. This ensures clients know exactly what they are receiving and prevents silent data truncation.

```
GET /odata/Products?$top=10000

HTTP/1.1 400 Bad Request
{
  "error": {
    "code": "QueryOptionExceedsLimit",
    "message": "$top value 10000 exceeds maximum allowed value 500"
  }
}
```

:::

### maxExpandDepth — $expand nesting limit

Limits the depth of `$expand` nesting. Each additional level multiplies the number of JOIN operations and result size.

**Default:** `2`

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  maxExpandDepth: 3, // Allow: A($expand=B($expand=C)) — but not deeper
})
```

Exceeding the limit:

```
GET /odata/Customers?$expand=orders($expand=items($expand=product))
// With maxExpandDepth=2:

HTTP/1.1 400 Bad Request
{
  "error": {
    "code": "ExpandDepthExceeded",
    "message": "$expand depth 3 exceeds maximum allowed depth 2"
  }
}
```

`$levels` counts against the same limit: each level is one more level of `$expand`, a
`$levels` value that goes past `maxExpandDepth` is rejected with 400 before any query is built,
and `$levels=max` stops at `maxExpandDepth`.

### maxFilterDepth — $filter expression nesting limit

Limits the depth of nested logical expressions in `$filter`. Deeply nested filters can cause exponential parse tree growth.

**Default:** `10`

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  maxFilterDepth: 15, // Allow up to 15 levels of nesting
})
```

Exceeding the limit:

```
GET /odata/Products?$filter=((((((((((((name eq 'x'))))))))))))))
// With maxFilterDepth=10:

HTTP/1.1 400 Bad Request
{
  "error": {
    "code": "FilterDepthExceeded",
    "message": "$filter expression exceeds maximum nesting depth of 10"
  }
}
```

## Per-entity overrides

Override global limits for specific entity sets. Per-entity overrides take precedence over global options.

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common'
import { EdmRegistry } from '@nestjs-odata/core'

@Injectable()
export class SecurityConfigService implements OnModuleInit {
  constructor(private readonly edmRegistry: EdmRegistry) {}

  onModuleInit(): void {
    // Expensive entity: restrict to 50 items
    this.edmRegistry.setEntitySecurityOptions('Orders', {
      maxTop: 50,
      maxExpandDepth: 1,
    })

    // Read-heavy entity: allow larger pages
    this.edmRegistry.setEntitySecurityOptions('Products', {
      maxTop: 2000,
    })

    // Sensitive entity: very tight filter nesting
    this.edmRegistry.setEntitySecurityOptions('Customers', {
      maxTop: 100,
      maxFilterDepth: 5,
    })
  }
}
```

Register the service in your module:

```typescript
@Module({
  providers: [SecurityConfigService],
})
export class AppModule {}
```

### Override precedence

1. Per-entity override (highest priority)
2. Global `ODataModuleOptions`
3. Built-in defaults (lowest priority)

## ETag concurrency control

Entities decorated with `@ODataETag()` get automatic optimistic concurrency control:

- **Write protection**: when a `PATCH`, `PUT` or `DELETE` (also inside `$batch`) carries an `If-Match` header that does not match the current ETag (another client modified the entity), the server returns `412 Precondition Failed` and changes nothing. A request **without** `If-Match` is not refused: the library does not require optimistic concurrency (no `428 Precondition Required`), so clients that want the protection must send the header.
- **Read optimization**: `GET` single entity supports `If-None-Match`. If the ETag matches (entity unchanged), the server returns `304 Not Modified` with no body.

This prevents lost-update scenarios in concurrent environments without pessimistic locking.

`If-Match: *` matches any existing entity, and a comma-separated list matches when any entry
does. The `etag` option of `ODataTypeOrmModule.forFeature()` items sets the ETag source per
entity set (a version column, a function); with [write handlers](./write-handlers), the handler
receives `If-Match` and must check it in the same transaction as its write.

```typescript
import { ODataETag } from '@nestjs-odata/core'

@Entity()
export class Product {
  @UpdateDateColumn()
  @ODataETag()
  updatedAt: Date
}
```

## Enriched error details

Validation and parse errors include additional context to help developers diagnose issues:

- **`availableProperties`**: When a `$select` or `$filter` references an unknown property, the error response includes the list of valid property names for the entity set.
- **`queryContext`**: When a `$filter` or other query option has a parse error, the error response includes a snippet of the query around the error position.

```json
{
  "error": {
    "code": "BadRequest",
    "message": "Property 'naem' not found on entity 'Product'",
    "details": [
      {
        "code": "AvailableProperties",
        "message": "Available properties: id, name, price, inStock",
        "target": "availableProperties",
        "value": ["id", "name", "price", "inStock"]
      }
    ]
  }
}
```

Every entry of `details` has a `code` and a `message` (OData JSON Format 4.01 §21.1); `value`
is an extra, service-defined member. A parse error's detail is
`{ "code": "QueryOption", "message": "Error near: …", "target": "…" }`.

### Mapping your own errors

Unknown exceptions become a generic 500, and the message of every 5xx error (including a
`ServiceUnavailableException`'s) is replaced by a generic one, so internal details never leak.
This holds for `$batch` parts too. To give clients
meaningful errors for your own exception types (or for database errors such as unique
violations), use the [`errorMapper`](./error-mapping) option. Whatever it returns is sent to the
client as is.

## Parameterized queries

All `$filter` values are translated to **parameterized TypeORM queries** — never string interpolation. This prevents SQL injection.

```
$filter=name eq 'O''Malley'   →   WHERE name = $1   params: ["O'Malley"]
$filter=price lt 100          →   WHERE price < $1   params: [100]
```

Single quotes in string literals are properly escaped before parameterization.

## Authentication and authorization

`nestjs-odata` does not provide authentication. Use standard NestJS guards:

```typescript
import { UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@ODataController('Products')
@UseGuards(AuthGuard('jwt')) // Apply to all routes in the controller
export class ProductsController {
  // ...
}
```

Or apply guards to specific operations:

```typescript
@ODataDelete('Products')
@UseGuards(AuthGuard('jwt'), AdminGuard)
async deleteProduct(@Param('key') key: string) {
  return this.handler.handleDelete(key, 'Products')
}
```

### Row-level access

Guards decide whether a request may call a route. To restrict _which rows_ it sees, register a
[row-level scope](./row-level-scopes) per entity set. Scopes apply to collections, `$count`,
by-key reads, every `$expand` path, lambdas in `$filter`, `$apply`, `$batch` and the existence
checks of writes. Set `requireScope: true` so an entity set without a scope fails closed.

[Write handlers](./write-handlers) receive the raw parsed body: there is no repository column
whitelist, so validate it there. Deep inserts never write nested entities of a handler-backed
entity set through the repository (400).

## Recommended production configuration

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  namespace: 'MyApp',
  maxTop: 500,          // Conservative limit
  maxExpandDepth: 2,    // Default — do not increase without profiling
  maxFilterDepth: 10,   // Default — sufficient for most use cases
  controllers: [...],
})
```

Apply rate limiting at the infrastructure layer (reverse proxy, API gateway, or `@nestjs/throttler`) — the OData library does not duplicate this concern.
