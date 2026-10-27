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

## Entity URLs

An entity's canonical URL is the entity set followed by the key in parentheses (OData 4.01
URL Conventions §4.3.1): `/odata/Products(1)`, `/odata/Products('abc')`, and for composite keys
`/odata/OrderItems(orderId=1,productId=2)`. The `Location` header and `@odata.id` use this
form, and every key route (`@ODataGetByKey`, `@ODataPatch`, `@ODataPut`, `@ODataDelete`, and your
own routes such as `:key/details`) answers it. The key-as-segment form `/odata/Products/1`
keeps working too.

Nest cannot declare a route as `Products(:key)`, so `ODataModule` rewrites a canonical URL to
`/odata/Products/1` before routing (only when the segment after `serviceRoot` names a registered
entity set). The rewrite is installed on the Express adapter; on other adapters only the
`/Set/{key}` form is routed.

## GET by key

`GET /odata/{EntitySet}({key})` (or `/odata/{EntitySet}/{key}`)

Returns a single entity. Returns `404 Not Found` if the key does not exist.

```bash
curl http://localhost:3000/odata/Products(1)
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
    "code": "NotFound",
    "message": "Entity 'Products' with key '999' not found",
    "details": []
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
Location: /odata/Products(3)
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

### Request bodies

POST, PATCH and PUT bodies follow OData 4.01 Part 1 §11.4.2 and §11.4.3:

- **Computed properties are ignored.** `@CreateDateColumn`, `@UpdateDateColumn`, `@VersionColumn`
  and generated columns (`@Generated`, `asExpression`; not generated primary keys) are computed
  by the database. `$metadata` annotates them with `Core.Computed`, and a value a client sends
  for them is dropped.
- **Key properties are ignored on PATCH and PUT.** The URL key always identifies the entity, so
  a body key can't redirect the write to another row.
- **Unknown properties are refused.** A property that is not in the entity type (including
  properties hidden with `@ODataExclude` or `select: false`) answers `400 Bad Request` with one
  `details` entry per property, and nothing is written: the service must fail when it cannot
  persist a value. Instance annotations (`@odata.type`, `Category@odata.bind`) are ignored.

```json
{
  "error": {
    "code": "BadRequest",
    "message": "Entity type 'Product' has no property 'nope'",
    "details": [
      {
        "code": "UnknownProperty",
        "message": "'nope' is not a property of 'Product'",
        "target": "nope"
      }
    ]
  }
}
```

For clients you cannot fix that send extra fields, `ignoreUnknownProperties: true` in
`ODataModule.forRoot()` drops unknown properties instead of answering 400 (they are still never
persisted). Bodies handed to [write handlers](./write-handlers) are passed as sent.

## PATCH — Update

`PATCH /odata/{EntitySet}({key})`

Updates an entity using merge-patch semantics — only the fields included in the request body are updated. Returns `200 OK` with the updated entity. Returns `404 Not Found` if the key does not exist. Key properties in the body are ignored (OData 4.01 Part 1 §11.4.3), as for PUT.

```bash
curl -X PATCH 'http://localhost:3000/odata/Products(3)' \
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

`DELETE /odata/{EntitySet}({key})`

Deletes an entity. Returns `204 No Content`. Returns `404 Not Found` if the key does not exist.

```bash
curl -X DELETE 'http://localhost:3000/odata/Products(3)'
# HTTP 204 No Content
```

## Error responses

All errors use the OData v4 error format, with a `Content-Language` header naming the language
of `message` (`en` by default; see [Error mapping](./error-mapping#content-language)):

```json
{
  "error": {
    "code": "ErrorCode",
    "message": "Human-readable description",
    "details": []
  }
}
```

Common responses:

| Code                   | Status | Cause                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `NotFound`             | 404    | Entity key not found                                                |
| `BadRequest`           | 400    | Malformed query option, limits exceeded, unknown property in a body |
| `PreconditionFailed`   | 412    | `If-Match` does not match, or `If-None-Match` matches, on a write   |
| `PreconditionRequired` | 428    | Write without `If-Match` on an entity set with `requireIfMatch`     |
| —                      | 304    | `If-None-Match` matches on a GET (no body)                          |

## PUT — Replace

`PUT /odata/{EntitySet}({key})`

Replaces an entity entirely. All fields not included in the request body are reset to their column defaults (null for nullable columns, default value for columns with defaults). Returns `200 OK` with the replaced entity. Returns `404 Not Found` if the key does not exist. A key property in the body is ignored, even when it differs from the URL key: the entity at the URL is replaced (§11.4.3).

```bash
curl -X PUT 'http://localhost:3000/odata/Products(3)' \
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

## `Prefer: return=minimal`

A client that doesn't need the written entity back sends `Prefer: return=minimal` (OData 4.01
Part 1 §8.2.8.7). POST, PATCH and PUT then answer `204 No Content` with
`Preference-Applied: return=minimal` and the entity's new `ETag`. A create also carries
`Location` and `OData-EntityId` with the new entity's URL:

```bash
curl -i -X POST http://localhost:3000/odata/Products \
  -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
  -d '{ "name": "Sprocket", "price": 14.99 }'
# HTTP/1.1 204 No Content
# Location: /odata/Products(3)
# OData-EntityId: /odata/Products(3)
# Preference-Applied: return=minimal
```

`Prefer: return=representation` keeps the default (the entity in the body) and is confirmed
with `Preference-Applied`. `$select` or `$expand` on the request imply `return=representation`
(§11.4.1.5). The preference works for write handlers too, and per part inside `$batch`.

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
An `etag` option on the `forFeature()` item (a property name or a function of the entity)
overrides it; see [Custom write handlers](./write-handlers#etags-and-if-match).

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

`GET /odata/Products(1)` returns an `ETag` response header and `@odata.etag` in the body:

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

Collections carry `@odata.etag` on each entity too (OData JSON §4.5.10), so a client can send a
conditional write without reading the entity first:

```json
{
  "@odata.context": "/odata/$metadata#Products",
  "value": [{ "@odata.etag": "W/\"MjAyNS0wNi0xNVQxMDozMDowMC4wMDBa\"", "id": 1, "name": "Widget" }]
}
```

An entity whose ETag value isn't in the response (for example `$select` leaves the ETag
property out) gets no `@odata.etag`.

### Conditional GET (If-None-Match)

```bash
curl 'http://localhost:3000/odata/Products(1)' \
  -H 'If-None-Match: W/"2025-06-15T10:30:00.000Z"'
# Returns 304 Not Modified (no body) if unchanged
```

### Conditional update/delete (If-Match, If-None-Match)

`PATCH`, `PUT`, and `DELETE` enforce `If-Match` on ETag-enabled entities:

```bash
curl -X PATCH 'http://localhost:3000/odata/Products(1)' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: W/"2025-06-15T10:30:00.000Z"' \
  -d '{ "price": 12.99 }'
```

If the ETag does not match (another client modified the entity), the server returns `412 Precondition Failed`:

```json
{
  "error": {
    "code": "PreconditionFailed",
    "message": "The ETag value does not match the current version of the entity",
    "details": []
  }
}
```

`If-None-Match` on a write answers `412 Precondition Failed`, with no change, when it matches
the current ETag; `If-None-Match: *` matches any existing entity (§8.2.5). Both headers are read
from the request, so controllers don't need to bind them (an `ifMatch` argument passed to the
handler takes precedence). Inside `$batch`, each part's headers apply the same way.

### Requiring If-Match

By default a write without `If-Match` is allowed. To require optimistic concurrency on an entity
set, set `requireIfMatch` on its `forFeature()` item:

```typescript
ODataTypeOrmModule.forFeature([{ entity: Account, etag: 'version', requireIfMatch: true }])
```

`PATCH`, `PUT` and `DELETE` without `If-Match` (also in `$batch`, and also with write handlers)
then answer `428 Precondition Required` with no change, and `$metadata` advertises the
requirement on the entity set (§8.2.4, §11.4.1.1):

```xml
<EntitySet Name="Accounts" EntityType="Default.Account">
  <Annotation Term="Core.OptimisticConcurrency">
    <Collection>
      <PropertyPath>version</PropertyPath>
    </Collection>
  </Annotation>
</EntitySet>
```

The entity set needs an ETag (`etag` option, `@ODataETag` or `@UpdateDateColumn`); without one
a warning is logged at startup and clients can only send `If-Match: *`.

::: warning Express's own ETags
Express adds a hash `ETag` (`W/"<len>-<hash>"`) to every response by default, including errors,
collections and `$metadata`. It is not an OData ETag: a client that echoes it in `If-Match` gets
`412`. Disable it for OData services (the library logs a warning at startup while it is on, but
never changes the setting itself):

```typescript
const app = await NestFactory.create<NestExpressApplication>(AppModule)
app.set('etag', false)
```

:::

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

  // GET by key (If-None-Match → 304). Binding the conditional headers is optional:
  // the handler reads If-Match / If-None-Match from the request when they aren't passed.
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

To route all writes of an entity set through your own services (including `$batch`), register
[custom write handlers](./write-handlers) instead of overriding each controller method.
