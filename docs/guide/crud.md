# CRUD Operations

`nestjs-odata` provides spec-compliant OData v4 CRUD operations. All responses use the OData JSON format.

## GET collection

`GET /odata/{EntitySet}`

Returns a collection of entities with the OData envelope:

```bash
curl http://localhost:3000/odata/Products
```

Response (`200 OK`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products",
  "value": [
    { "id": 1, "name": "Widget", "price": 9.99, "inStock": true },
    { "id": 2, "name": "Gadget", "price": 49.99, "inStock": false }
  ]
}
```

## GET by key

`GET /odata/{EntitySet}/{key}`

Returns a single entity. Returns `404 Not Found` if the key does not exist.

```bash
curl http://localhost:3000/odata/Products/1
```

Response (`200 OK`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products/$entity",
  "id": 1,
  "name": "Widget",
  "price": 9.99,
  "inStock": true
}
```

**Not found** (`404 Not Found`):

```json
{
  "error": {
    "code": "ResourceNotFound",
    "message": "Entity with key '999' not found in Products"
  }
}
```

## POST — Create

`POST /odata/{EntitySet}`

Creates a new entity. Returns `201 Created` with the created entity and a `Location` header.

```bash
curl -X POST http://localhost:3000/odata/Products \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Sprocket", "price": 14.99, "inStock": true }'
```

Response (`201 Created`):

```
Location: http://localhost:3000/odata/Products/3
```

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products/$entity",
  "id": 3,
  "name": "Sprocket",
  "price": 14.99,
  "inStock": true
}
```

## PATCH — Update

`PATCH /odata/{EntitySet}/{key}`

Updates an entity using merge-patch semantics — only the fields included in the request body are updated. Returns `200 OK` with the updated entity. Returns `404 Not Found` if the key does not exist.

```bash
curl -X PATCH http://localhost:3000/odata/Products/3 \
  -H 'Content-Type: application/json' \
  -d '{ "price": 12.99 }'
```

Response (`200 OK`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products/$entity",
  "id": 3,
  "name": "Sprocket",
  "price": 12.99,
  "inStock": true
}
```

## DELETE — Delete

`DELETE /odata/{EntitySet}/{key}`

Deletes an entity. Returns `204 No Content`. Returns `404 Not Found` if the key does not exist.

```bash
curl -X DELETE http://localhost:3000/odata/Products/3
# HTTP 204 No Content
```

## Error responses

All errors use the OData v4 error format:

```json
{
  "error": {
    "code": "ErrorCode",
    "message": "Human-readable description"
  }
}
```

Common error codes:

| Code                      | Status | Cause                                      |
| ------------------------- | ------ | ------------------------------------------ |
| `ResourceNotFound`        | 404    | Entity key not found                       |
| `InvalidQueryOption`      | 400    | Malformed query option value               |
| `QueryOptionExceedsLimit` | 400    | `$top` exceeds `maxTop`                    |
| `ExpandDepthExceeded`     | 400    | `$expand` nesting exceeds `maxExpandDepth` |
| `FilterDepthExceeded`     | 400    | `$filter` nesting exceeds `maxFilterDepth` |
| `PreconditionFailed`      | 412    | `If-Match` ETag mismatch                   |
| `NotModified`             | 304    | `If-None-Match` ETag matches (no body)     |
| `DeepInsertDepthExceeded` | 400    | Deep insert exceeds `maxDeepInsertDepth`   |

## PUT — Replace

`PUT /odata/{EntitySet}/{key}`

Replaces an entity entirely. All fields not included in the request body are reset to their column defaults (null for nullable columns, default value for columns with defaults). Returns `200 OK` with the replaced entity. Returns `404 Not Found` if the key does not exist.

```bash
curl -X PUT http://localhost:3000/odata/Products/3 \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Sprocket v2", "price": 19.99 }'
```

Response (`200 OK`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products/$entity",
  "id": 3,
  "name": "Sprocket v2",
  "price": 19.99,
  "inStock": true
}
```

::: tip PATCH vs PUT
Use `PATCH` for partial updates (only provided fields change). Use `PUT` for full replacement (unspecified fields reset to defaults). Most clients prefer `PATCH`.
:::

## Deep insert

`POST /odata/{EntitySet}` with nested navigation property arrays creates parent and children atomically in a single transaction.

```bash
curl -X POST http://localhost:3000/odata/Orders \
  -H 'Content-Type: application/json' \
  -d '{
    "orderDate": "2025-06-15T10:30:00Z",
    "totalAmount": 149.97,
    "status": "pending",
    "customerId": 1,
    "items": [
      { "quantity": 3, "unitPrice": 49.99, "productId": 1 }
    ]
  }'
```

Response (`201 Created`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Orders/$entity",
  "id": 1,
  "orderDate": "2025-06-15T10:30:00.000Z",
  "totalAmount": 149.97,
  "status": "pending",
  "customerId": 1,
  "items": [{ "id": 1, "quantity": 3, "unitPrice": 49.99, "orderId": 1, "productId": 1 }]
}
```

The maximum nesting depth is controlled by `maxDeepInsertDepth` (default: 5). See [Configuration](./configuration.md).

## ETag concurrency control

Entities with an `@ODataETag()` property support optimistic concurrency via HTTP ETag headers.

### Setup

```typescript
import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm'
import { ODataETag } from '@nestjs-odata/core'

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  @UpdateDateColumn()
  @ODataETag()
  updatedAt: Date
}
```

### GET with ETag

`GET /odata/Products/1` returns an `ETag` response header and `@odata.etag` in the body:

```
ETag: W/"2025-06-15T10:30:00.000Z"
```

```json
{
  "@odata.context": "...",
  "@odata.etag": "W/\"2025-06-15T10:30:00.000Z\"",
  "id": 1,
  "name": "Widget",
  "updatedAt": "2025-06-15T10:30:00.000Z"
}
```

### Conditional GET (If-None-Match)

```bash
curl http://localhost:3000/odata/Products/1 \
  -H 'If-None-Match: W/"2025-06-15T10:30:00.000Z"'
# Returns 304 Not Modified if unchanged
```

### Conditional update/delete (If-Match)

`PATCH`, `PUT`, and `DELETE` enforce `If-Match` on ETag-enabled entities:

```bash
curl -X PATCH http://localhost:3000/odata/Products/1 \
  -H 'Content-Type: application/json' \
  -H 'If-Match: W/"2025-06-15T10:30:00.000Z"' \
  -d '{ "price": 12.99 }'
```

If the ETag does not match (another client modified the entity), the server returns `412 Precondition Failed`:

```json
{
  "error": {
    "code": "PreconditionFailed",
    "message": "ETag mismatch — the entity has been modified"
  }
}
```

## Using TypeOrmAutoHandler

The `TypeOrmAutoHandler` provides zero-boilerplate handlers for all operations:

```typescript
@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  // GET collection
  @ODataGet('Products', { path: '' })
  async getProducts(
    @ODataQueryParam('Products') query: ODataQuery,
    @Req() req: { originalUrl: string },
  ) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  // GET by key (with If-None-Match support)
  @ODataGetByKey('Products')
  async getProduct(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Products', ifNoneMatch)
  }

  // POST (supports deep insert automatically)
  @ODataPost('Products')
  async createProduct(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Products')
  }

  // PATCH (with If-Match ETag support)
  @ODataPatch('Products')
  async updateProduct(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Products', ifMatch)
  }

  // PUT — full replacement (with If-Match ETag support)
  @ODataPut('Products')
  async replaceProduct(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleReplace(key, body, 'Products', ifMatch)
  }

  // DELETE (with If-Match ETag support)
  @ODataDelete('Products')
  async deleteProduct(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Products', ifMatch)
  }
}
```

## Custom business logic

Override individual operations to add business logic:

```typescript
@ODataPost('Products')
async createProduct(@Body() body: Record<string, unknown>) {
  // Custom validation before create
  if (!body.name) {
    throw new BadRequestException('Product name is required')
  }

  // Enrich before persisting
  const enriched = { ...body, createdAt: new Date().toISOString() }
  return this.handler.handleCreate(enriched, 'Products')
}
```

Regular NestJS guards, pipes, and interceptors work as-is on OData controllers.
