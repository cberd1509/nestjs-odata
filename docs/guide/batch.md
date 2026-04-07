# $batch

`$batch` allows sending multiple OData requests in a single HTTP call. This reduces network round-trips and supports atomic changesets.

## Overview

A batch request is an HTTP `POST` to `{serviceRoot}/$batch` with a `multipart/mixed` body. Each part is a complete HTTP request (with method, URL, headers, and body).

```
POST /odata/$batch
Content-Type: multipart/mixed; boundary=batch_abc123
```

## Request format

The body is `multipart/mixed` — standard MIME format:

```
--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET /odata/Products HTTP/1.1
Accept: application/json

--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET /odata/Products/1 HTTP/1.1
Accept: application/json

--batch_abc123--
```

### Rules

- Each part must have `Content-Type: application/http` and `Content-Transfer-Encoding: binary`
- The boundary is declared in the outer `Content-Type` header
- The terminating boundary has a trailing `--` (e.g. `--batch_abc123--`)
- Maximum 100 operations per batch request (configurable via library defaults)

## Response format

The response is also `multipart/mixed`:

```
HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batchresp_xyz789

--batchresp_xyz789
Content-Type: application/http

HTTP/1.1 200 OK
Content-Type: application/json

{"@odata.context":"...","value":[...]}
--batchresp_xyz789
Content-Type: application/http

HTTP/1.1 200 OK
Content-Type: application/json

{"@odata.context":"...","id":1,"name":"Widget",...}
--batchresp_xyz789--
```

Each response part corresponds positionally to the request part at the same index.

## Changesets — atomic operations

A changeset groups data modification requests (POST, PATCH, DELETE) that must succeed or fail atomically. Changesets are wrapped in their own `multipart/mixed` sub-body:

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

PATCH /odata/Products/5 HTTP/1.1
Content-Type: application/json

{"price":9.99}
--changeset_def456--

--batch_abc123--
```

**Atomicity**: If any operation within a changeset fails (returns 4xx or 5xx), the entire changeset is rolled back. Operations outside changesets are independent — a failure in one does not affect others.

### Changeset constraints

- Changesets cannot contain `GET` requests (reads are never transactional per OData spec)
- `Content-ID` headers allow referencing the result of one changeset operation in a subsequent one

## Complete curl example

```bash
BATCH_BODY='--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET /odata/Products HTTP/1.1
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
  --data-raw "$BATCH_BODY"
```

## Enabling $batch

`$batch` is automatically enabled when you register `ODataTypeOrmModule.forFeature()`. No additional configuration is required.

```typescript
@Module({
  imports: [
    ODataModule.forRoot({ serviceRoot: '/odata' }),
    ODataTypeOrmModule.forFeature(
      [Product, Category],
      { serviceRoot: '/odata' }, // Routes POST /odata/$batch
    ),
  ],
})
export class AppModule {}
```

## Error handling

**Individual request failure** (outside changeset): The failed operation returns its error status in the response. Other operations continue normally.

**Changeset failure**: The entire changeset is rolled back. The response part for the failing operation contains the error. All changeset parts return a `400`/`500` status indicating rollback.

**Malformed batch body**: Returns `400 Bad Request` with an OData error response:

```json
{
  "error": {
    "code": "BadRequest",
    "message": "Missing boundary in Content-Type header"
  }
}
```
