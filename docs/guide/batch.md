# $batch

`$batch` allows sending multiple OData requests in a single HTTP call. This reduces network round-trips and supports atomic changesets.

## Overview

A batch request is an HTTP `POST` to `{serviceRoot}/$batch` with a `multipart/mixed` body. Each part is a complete HTTP request (with method, URL, headers, and body).

```
POST /odata/$batch
Content-Type: multipart/mixed; boundary=batch_abc123
```

**Every operation is evaluated like the same request sent on its own** (OData 4.01 Part 1
§11.7). The library dispatches each operation, in process, through your application's HTTP
stack: it reaches its route with the same middleware, **guards**, interceptors, pipes, exception
filters and error mapping as a standalone request, and gets the same response (status, headers,
`@odata.context`, `@odata.count`, `@odata.nextLink`, `@odata.etag`, ...). See
[How operations are evaluated](#how-operations-are-evaluated).

## Request format

The body is `multipart/mixed` — standard MIME format:

```
--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET /odata/Products?$filter=price%20gt%2010&$top=5&$count=true HTTP/1.1
Accept: application/json

--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET Products(1) HTTP/1.1
Accept: application/json

--batch_abc123--
```

### Rules

- Each part must have `Content-Type: application/http` and `Content-Transfer-Encoding: binary`
- The boundary is declared in the outer `Content-Type` header
- The terminating boundary has a trailing `--` (e.g. `--batch_abc123--`)
- Maximum 100 operations per batch request (configurable via library defaults)
- An operation URL can be an absolute path (`/odata/Products(1)`), a path relative to the service
  root (`Products(1)`), or an absolute URI (only its path and query are used). Percent-encode
  spaces in the request line (`$filter=price%20gt%2010`).
- A `$batch` operation cannot itself be a `$batch` request (`400`), however its URL is spelled
  (`$BATCH`, `%24batch`); a `$batch` request reached from inside a batch operation is refused too.

## Response format

The response is also `multipart/mixed`, with one part per request part, in the same order:

```
HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_xyz789

--batch_xyz789
Content-Type: application/http
Content-Transfer-Encoding: binary

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"@odata.context":"/odata/$metadata#Products","@odata.count":42,"value":[...],"@odata.nextLink":"..."}
--batch_xyz789
Content-Type: application/http
Content-Transfer-Encoding: binary

HTTP/1.1 200 OK
ETag: W/"..."
Content-Type: application/json; charset=utf-8

{"@odata.context":"/odata/$metadata#Products/$entity","@odata.etag":"W/\"...\"","id":1,...}
--batch_xyz789--
```

Each operation's response carries the status, headers and body its route sent (`Location`,
`ETag`, `Preference-Applied`, `Content-Language`, `Content-Type`, `WWW-Authenticate`,
`Retry-After`, your own headers), unchanged — errors included. Multi-valued headers such as
`Set-Cookie` keep one line per value; binary bodies are kept byte for byte. Connection-level
headers (`Content-Length` of the original response, `Content-Encoding`, `Date`, `X-Powered-By`,
...) are dropped: operations are always asked for an unencoded body (`Accept-Encoding: identity`).
Only an operation that matched no route gets a library-made OData error (`404`).

A **successful changeset** is answered with a nested `multipart/mixed` part (its own boundary)
holding one response per changeset request, each with its request's `Content-ID`. A **failed
changeset** is answered with a single `application/http` error response in its place (see
[Error handling](#error-handling)).

## Changesets — atomic operations

A changeset groups data modification requests (POST, PATCH, PUT, DELETE) that must succeed or fail atomically. Changesets are wrapped in their own `multipart/mixed` sub-body:

```
--batch_abc123
Content-Type: multipart/mixed; boundary=changeset_def456

--changeset_def456
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 1

POST /odata/Products HTTP/1.1
Content-Type: application/json

{"name":"New Widget","price":14.99,"inStock":true}
--changeset_def456
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 2

PATCH /odata/Products(5) HTTP/1.1
Content-Type: application/json

{"price":9.99}
--changeset_def456--

--batch_abc123--
```

**Atomicity**: the operations of a changeset run in order, in one database transaction (a
TypeORM `QueryRunner` transaction, or your `changesetRunner`). If one fails (4xx or 5xx), the
transaction is rolled back and the remaining operations do not run. Operations outside
changesets are independent — a failure in one does not affect others.

The changeset's `EntityManager` is propagated to every operation of the changeset: it is
attached to the operation's request object, and kept in an `AsyncLocalStorage` as a fallback
(the request is read first, so middleware that resumes `next()` from another async context — a
session store, a callback-based auth library — cannot detach an operation from its changeset).
`TypeOrmAutoHandler`, row-level scopes and write handlers (`ctx.manager`) use it automatically. **Code of your own that writes to the database from an OData route** (a
custom controller method, a service it calls) must use it too, or its writes are not part of the
changeset:

```typescript
import { getODataChangesetManager } from '@nestjs-odata/typeorm'

@ODataPost('Orders')
async create(@Body() body: Record<string, unknown>) {
  // Inside a $batch changeset: join its transaction. Otherwise: open your own.
  const changeset = getODataChangesetManager()
  if (changeset) return this.handler.handleDeepCreate(body, 'Orders', changeset)
  return this.dataSource.transaction((manager) =>
    this.handler.handleDeepCreate(body, 'Orders', manager),
  )
}
```

### Changeset constraints

- Changesets cannot contain `GET` requests (reads are never transactional per OData spec)
- `Content-ID` headers allow referencing the result of one changeset operation in a subsequent one
- Every operation URL must resolve inside the service root (relative URLs resolve against the `$batch` URL); other URLs and nested `$batch` operations answer `400`

### Content-ID references

Use `Content-ID` to reference the entity created by a previous operation of the same changeset.
A `$<Content-ID>` reference is replaced by the created entity's URL (its `Location`, e.g.
`/odata/Orders(42)`) where it stands for a whole URL: as the operation URL or its first segment
(`$1`, `$1/Items`), and as a JSON string value of the body that is `$1` or starts with `$1/`
(for example `"Customer@odata.bind": "$1"`). IDs match exactly (`$1` is not part of `$10`), and
text such as `"costs $1"` is left alone:

```
--changeset_def456
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 1

POST /odata/Orders HTTP/1.1
Content-Type: application/json

{"orderDate":"2025-06-15T10:30:00Z","totalAmount":149.97,"status":"pending","customerId":1}
--changeset_def456
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 2

PATCH $1 HTTP/1.1
Content-Type: application/json

{"status":"confirmed"}
--changeset_def456--
```

References work within one changeset only (a reference to another changeset's `Content-ID` is
left as is). They also work when the create answered `204` under `Prefer: return=minimal`.

## Complete curl example

```bash
BATCH_BODY='--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET /odata/Products?$top=2 HTTP/1.1
Accept: application/json

--batch_abc123
Content-Type: multipart/mixed; boundary=changeset_def

--changeset_def
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 1

POST /odata/Products HTTP/1.1
Content-Type: application/json

{"name":"Batch Widget","price":7.99,"inStock":true}
--changeset_def--

--batch_abc123--'

curl -X POST http://localhost:3000/odata/$batch \
  -H 'Content-Type: multipart/mixed; boundary=batch_abc123' \
  -H 'Authorization: Bearer <token>' \
  --data-raw "$BATCH_BODY"
```

## Enabling $batch

`$batch` is automatically enabled when you register `ODataTypeOrmModule.forFeature()`. No
additional configuration is required. One `$batch` endpoint serves the entity sets of **every**
`forFeature()` module, however many feature modules the application has.

```typescript
@Module({
  imports: [
    ODataModule.forRoot({ serviceRoot: '/odata' }),
    ODataTypeOrmModule.forFeature([Product, Category]), // $batch route inherits serviceRoot automatically
  ],
})
export class AppModule {}
```

An operation can only reach what a standalone request can: an entity set without a route for
that method (no controller, or no `@ODataDelete` on it) answers `404` inside `$batch` too.

### Turning $batch off or restricting it

`ODataTypeOrmModule.forRoot({ batch })` (imported once in the root module) controls the endpoint:

```typescript
ODataTypeOrmModule.forRoot({
  batch: {
    // enabled: false,             // POST /odata/$batch answers 404
    entitySets: ['Products', 'Orders'], // other targets answer 403 without reaching their route
    operationTimeout: 10_000, // ms per operation (default 30 000); then 504
  },
})
```

| Option             | Default          | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `true`           | `false` answers `404 Not Found` for `POST {serviceRoot}/$batch`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `entitySets`       | every entity set | Allow-list of entity sets operations may target. Every entity set the operation reaches must be listed: the resource path's (`Products(1)`), navigation targets (`Products(1)/Supplier` needs `Suppliers`) and `$expand` targets, nested ones too. Any other target (another entity set, `$metadata`, an unknown segment) answers `403`; inside a changeset that fails the changeset. Navigation paths inside `$filter`/`$orderby` are not checked (row-level scopes still apply). |
| `operationTimeout` | `30000`          | Milliseconds one operation may take. Then it answers `504 Gateway Timeout`; inside a changeset that fails and rolls back the changeset, so a stuck route (or a query blocked behind the changeset's own row locks) cannot hold the transaction. The route itself is not cancelled. `0` disables the limit.                                                                                                                                                                         |

## How operations are evaluated

Each operation is injected into the platform's request handler (the Express application, or
Fastify's `inject()`), inside the `$batch` request's async context, without opening a socket:

- **Headers**: the operation inherits the `$batch` request's headers — credentials
  (`Authorization`, `Cookie`; OData forbids authentication headers on parts, §11.7.7.1),
  `Accept-Language`, `OData-MaxVersion`, your custom headers (`X-Tenant`) — and its own headers
  win. Not inherited: `Content-*`, `Transfer-Encoding`, `Accept`, `Accept-Encoding` (operations
  always send `Accept-Encoding: identity`), `Prefer` (batch-level, e.g.
  `odata.continue-on-error`), `If-Match` / `If-None-Match` / `If-(Un)Modified-Since`, `Range`,
  `Expect`, connection headers and HTTP/2 pseudo-headers (`:path`, ...). A part with a body and
  no `Content-Type` is sent as `application/json`; `Content-Length` is always recomputed. The
  client address is the `$batch` request's.
- **Routing**: the operation goes through global middleware (including the canonical
  `Products(1)` → `Products/1` rewrite), then the matching route. An operation with no matching
  route answers `404` as an OData error.
- **Guards, interceptors, pipes, filters** of the route (and global ones) run exactly as for a
  standalone request. A guard that denies the operation answers `403` for that operation — and
  fails its changeset.
- **Query options** (`$filter`, `$select`, `$expand` with nested options, `$orderby`, `$top`,
  `$skip`, `$count`, `$search`, `$apply`) are parsed and validated by the route's
  `@ODataQueryParam` pipe and applied through row-level scopes, with the same response envelope.
- **Request context**: `getODataRequestContext()` (and so row-level scopes, write handlers and
  the error mapper) sees the operation's own request and execution context. The `$batch` request
  is available as `getODataBatchPart()?.batchRequest`.

`getODataBatchPart(request?)` (from `@nestjs-odata/core`) describes the operation being
handled — `{ method, url, contentId, inChangeset, batchRequest }` — and is `undefined` for
requests that are not part of a batch. The description is attached to the operation's request
(`request[ODATA_BATCH_PART]`) and kept in an `AsyncLocalStorage`; pass the request from guards
and middleware (they run before the OData request context is set). Use it for a batch-specific
policy:

```typescript
import { getODataBatchPart } from '@nestjs-odata/core'

@Injectable()
export class NoBulkDeleteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Deletes are allowed one at a time, not inside $batch.
    return getODataBatchPart(context.switchToHttp().getRequest()) === undefined
  }
}
```

On Fastify, operations are injected with `fastify.inject()`, which cannot carry these request
properties: there they rely on the `AsyncLocalStorage` alone.

Each operation counts as a request for global guards such as rate limiters.

### Per-operation headers

Because each operation is a standalone request, every protocol rule of the route applies:

- `If-Match` that doesn't match, or `If-None-Match` that does (`*` matches any existing entity),
  answers `412` for PATCH, PUT and DELETE, with no change. On a GET by key, a matching
  `If-None-Match` answers `304`.
- On an entity set with `requireIfMatch`, PATCH, PUT and DELETE without `If-Match` answer `428`.
- `Prefer: return=minimal` on a POST, PATCH or PUT operation answers `204` with
  `Preference-Applied: return=minimal` (a created entity keeps its `Location` and gets
  `OData-EntityId`, and `$N` references to it keep working); `Prefer: return=representation`
  is confirmed with `Preference-Applied`. A `Prefer` header on the `$batch` request itself is
  not applied to its operations.
- POST, PATCH and PUT bodies ignore computed properties (and, on PATCH/PUT, key properties: a
  PUT body key that differs from the URL key is ignored), and refuse unknown properties with
  `400` (see [CRUD: request bodies](./crud#request-bodies)).
- Error responses carry `Content-Language` (see [Error mapping](./error-mapping#content-language)).

### Write handlers and custom transactions

Entity sets with [custom write handlers](./write-handlers) reach those handlers through their
routes, with the changeset transaction's `EntityManager` as `ctx.manager` and
`ctx.batch = { contentId, inChangeset }`. To run changesets inside your own unit of work instead
of the default `QueryRunner` transaction, pass a `changesetRunner` to
`ODataTypeOrmModule.forRoot()`. See
[$batch changesets and atomicity](./write-handlers#batch-changesets-and-atomicity).

## Error handling

**Individual request failure** (outside changeset): the failed operation returns its route's
error response (status, headers, body) in its response part. Other operations continue normally.

**Timeout**: an operation that does not answer within `batch.operationTimeout` (default 30 s)
answers `504 Gateway Timeout`.

**Changeset failure**: the changeset is rolled back and answered with a **single**
`application/http` error response in place of the changeset (OData 4.01 Part 1 §11.7.7.5): the
failing operation's status and OData error body, with its `Content-ID` and `Content-Language`.
Operations after the failing one are not executed. Your `changesetRunner` may wrap or replace
the error it sees; the client still gets the failing operation's status. When the transaction
itself fails (for example at commit), the response is the mapped error with no `Content-ID`.

```
--batch_xyz789
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 2

HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8
Content-Language: en

{"error":{"code":"Forbidden","message":"Forbidden resource","details":[]}}
--batch_xyz789--
```

**Malformed batch body**: Returns `400 Bad Request` (with `Content-Language`) and an OData error response:

```json
{
  "error": {
    "code": "BadRequest",
    "message": "Missing boundary in Content-Type header"
  }
}
```

## Security

Before this behaviour, `$batch` operations were executed directly against TypeORM and **did not
run the guards, interceptors or pipes of your `@ODataController` routes** (only row-level
scopes and write handlers applied). They now run through the route, so a guard that protects
`DELETE /odata/Products/1` also protects a `DELETE Products(1)` inside `$batch`. See
[Security: $batch](./security#batch).
