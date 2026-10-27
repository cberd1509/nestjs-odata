---
'@nestjs-odata/core': minor
'@nestjs-odata/typeorm': minor
---

OData 4.01 `$batch` conformance: operations run through their routes, changeset responses, query options and one endpoint for every feature module (#64, #65, #67, #73).

**Security fix (#67): `$batch` operations no longer bypass route guards.** Each operation is now dispatched, in process, through the application's HTTP stack (the Express application, or Fastify's `inject()`), so it reaches its route with the same middleware, guards (route and global), interceptors, pipes, exception filters and error mapping as the same request sent on its own (Part 1 §11.7). Before, operations were executed directly against TypeORM and the guards, interceptors and pipes of `@ODataController` routes never ran for them: a `DELETE` protected by a role guard answered 403 over HTTP and 204 inside `$batch`. A guard that denies an operation now answers 403 for it, and fails its whole changeset. Operations inherit the `$batch` request's headers (credentials, `Cookie`, `Accept-Language`, custom headers; not `Content-*`, `Prefer`, `If-Match`/`If-None-Match`, `Accept` or connection headers), with their own headers taking precedence. Changesets stay atomic: the changeset's transaction is propagated to its operations through `AsyncLocalStorage`, and `TypeOrmAutoHandler`, row-level scopes and write handlers (`ctx.manager`) use it; `$<Content-ID>` references keep working.

**Behaviour changes:**

- **Operations need a route** (#67): an operation reaches only what a standalone request reaches. An entity set without a controller, or a method without a route (no `@ODataDelete`, …), answers 404 inside `$batch` too; before, `$batch` could read and write any entity set registered with `forFeature()`. Route guards, interceptors and pipes now apply to batch operations (see above).
- **A failed changeset is answered with a single `application/http` error response** (#64, §11.7.7.5): the failing operation's status and OData error, with its `Content-ID` and `Content-Language`, in place of the whole changeset. Before, every request of the changeset got a copy of the error. Operations after the failing one are not executed. Clients that index batch responses by part position must account for it.
- **A successful changeset is a nested `multipart/mixed` part** (§11.7.7.5: the response matches the request one-to-one) with one response per request, each with its `Content-ID`. Before, its responses were flattened into the top-level multipart body.
- **GET operations honour their query options** (#65): `$filter`, `$select`, `$expand` (with nested options), `$orderby`, `$top`, `$skip`, `$count`, `$search`, `$apply`, with the same validation, row-level scopes and response envelope (`@odata.context`, `@odata.count`, `@odata.nextLink`, `@odata.etag`, annotations) as the standalone request. Before, a collection GET returned every row up to `maxTop` as a bare `{ value }`. GET by key gets `@odata.context` too, and `$count`, `$metadata` or any other route can be batched.
- **Operation responses carry the route's headers** (`Content-Type`, `ETag`, `Location`, `Preference-Applied`, `OData-Version`, your own) and the route's body as is; a non-OData error (no route) is turned into an OData error.
- **Error mapper context for batch operations** (#62 hook): the mapper now runs in the operation's route filter, so `ctx.request` and `ctx.host` are the operation's own request and host (the `$batch` request is `getODataBatchPart()?.batchRequest`); `ctx.batch` still describes the operation. Changeset-level failures keep `ctx.batch.changeset` and the `$batch` request.
- **Write handler, scope and changeset-runner context**: `ctx.executionContext` / `ctx.request` of write handlers and scopes are the operation's own (they used to be the `$batch` route's). `ctx.batch` and, inside a changeset, `ctx.manager` are still set.
- **One `BatchController` per application** (#73): `forFeature()` now imports a static `ODataBatchModule` instead of declaring `BatchController` itself, so a single `POST {serviceRoot}/$batch` serves the entity sets of every feature module. Before, each `forFeature()` registered its own controller, the first one won, and parts for another feature's entity sets failed with 500.
- Code of your own that writes from an OData route (a custom controller transaction, an injected repository) is not part of a changeset unless it uses `getODataChangesetManager()`.

**Additions:**

- `ODataTypeOrmModule.forRoot({ batch: { enabled?, entitySets? } })`: `enabled: false` turns the endpoint off (404); `entitySets` allow-lists the entity sets operations may target (403 otherwise, without reaching the route). Token `ODATA_BATCH_OPTIONS`, type `ODataBatchOptions`.
- typeorm: `getODataChangesetManager()`, `runInODataChangeset()`, `ODataBatchModule`.
- core: `getODataBatchPart()` / `runWithODataBatchPart()` (the batch operation being handled, for batch-specific policies in guards), `dispatchBatchOperation()`, `batchOperationHeaders()`, `resolveBatchOperationUrl()`, and the `BatchChangesetResponse` / `BatchResponseItem` types. `buildBatchResponse()` accepts nested changeset responses and keeps each operation's `Content-Type`.
- Operation URLs may be relative to the service root (`Products(1)`), absolute paths or absolute URIs (§11.7.7.1); a nested `$batch` operation answers 400.
