# @nestjs-odata/typeorm

## 3.2.0

### Minor Changes

- [#87](https://github.com/cberd1509/nestjs-odata/pull/87) [`46fb9e4`](https://github.com/cberd1509/nestjs-odata/commit/46fb9e42841f1d0624dad9f182f3c473083da68d) Thanks [@cberd1509](https://github.com/cberd1509)! - OData 4.01 `$batch` conformance: operations run through their routes, changeset responses, query options and one endpoint for every feature module ([#64](https://github.com/cberd1509/nestjs-odata/issues/64), [#65](https://github.com/cberd1509/nestjs-odata/issues/65), [#67](https://github.com/cberd1509/nestjs-odata/issues/67), [#73](https://github.com/cberd1509/nestjs-odata/issues/73)).

  **Security fix ([#67](https://github.com/cberd1509/nestjs-odata/issues/67)): `$batch` operations no longer bypass route guards.** Each operation is now dispatched, in process, through the application's HTTP stack (the Express application, or Fastify's `inject()`), so it reaches its route with the same middleware, guards (route and global), interceptors, pipes, exception filters and error mapping as the same request sent on its own (Part 1 §11.7). Before, operations were executed directly against TypeORM and the guards, interceptors and pipes of `@ODataController` routes never ran for them: a `DELETE` protected by a role guard answered 403 over HTTP and 204 inside `$batch`. A guard that denies an operation now answers 403 for it, and fails its whole changeset. Operations inherit the `$batch` request's headers (credentials, `Cookie`, `Accept-Language`, custom headers; not `Content-*`, `Prefer`, `If-Match`/`If-None-Match`, `Accept` or connection headers), with their own headers taking precedence. Changesets stay atomic: the changeset's transaction is propagated to its operations through `AsyncLocalStorage`, and `TypeOrmAutoHandler`, row-level scopes and write handlers (`ctx.manager`) use it; `$<Content-ID>` references keep working.

  **Behaviour changes:**

  - **Operations need a route** ([#67](https://github.com/cberd1509/nestjs-odata/issues/67)): an operation reaches only what a standalone request reaches. An entity set without a controller, or a method without a route (no `@ODataDelete`, …), answers 404 inside `$batch` too; before, `$batch` could read and write any entity set registered with `forFeature()`. Route guards, interceptors and pipes now apply to batch operations (see above).
  - **Operations are confined to the service root**: a URL that resolves outside it (`/auth/login`, `../admin`, an absolute URL to another path) answers 400 without reaching any route.
  - **A failed changeset is answered with a single `application/http` error response** ([#64](https://github.com/cberd1509/nestjs-odata/issues/64), §11.7.7.5): the failing operation's response as its route sent it (status, headers, OData error), with its `Content-ID`, in place of the whole changeset. Before, every request of the changeset got a copy of the error. Operations after the failing one are not executed. Clients that index batch responses by part position must account for it.
  - **A successful changeset is a nested `multipart/mixed` part** (§11.7.7.5: the response matches the request one-to-one) with one response per request, each with its `Content-ID`. Before, its responses were flattened into the top-level multipart body.
  - **GET operations honour their query options** ([#65](https://github.com/cberd1509/nestjs-odata/issues/65)): `$filter`, `$select`, `$expand` (with nested options), `$orderby`, `$top`, `$skip`, `$count`, `$search`, `$apply`, with the same validation, row-level scopes and response envelope (`@odata.context`, `@odata.count`, `@odata.nextLink`, `@odata.etag`, annotations) as the standalone request. Before, a collection GET returned every row up to `maxTop` as a bare `{ value }`. GET by key gets `@odata.context` too, and `$count`, `$metadata` or any other route can be batched.
  - **Operation responses are the route's own, unchanged**: status, headers (`Content-Type`, `ETag`, `Location`, `Preference-Applied`, `WWW-Authenticate`, `Retry-After`, `OData-Version`, your own; `Set-Cookie` one line per value) and body (binary bodies byte for byte), errors included; only an operation that matched no route gets a library-made OData 404. Operations are asked for `Accept-Encoding: identity` (the batch request's `Accept-Encoding` is not inherited) and `Content-Encoding` is dropped; HTTP/2 pseudo-headers are never inherited; `Content-Length` is always recomputed. `buildBatchResponse()` now returns the body as a `Buffer`, and `BatchResponsePart.headers` / `body` accept `string[]` values and `Buffer` bodies.
  - **Operation timeout**: an operation that does not answer within `batch.operationTimeout` (default 30 000 ms) answers 504; inside a changeset that fails and rolls back the changeset.
  - **`$<Content-ID>` references are whole tokens with exact IDs**: the operation URL when it is `$N` or starts with `$N/`, and JSON string values of the body that are `$N` or start with `$N/` (`@odata.bind`). `$1` no longer matches inside `$10` or in text such as `"costs $1"`.
  - **Nested `$batch` is refused however it is spelled** (`$BATCH`, `%24batch`), and a `$batch` reached from inside a batch operation answers 400.
  - **Error mapper context for batch operations** ([#62](https://github.com/cberd1509/nestjs-odata/issues/62) hook): the mapper now runs in the operation's route filter, so `ctx.request` and `ctx.host` are the operation's own request and host (the `$batch` request is `getODataBatchPart()?.batchRequest`); `ctx.batch` still describes the operation. Changeset-level failures keep `ctx.batch.changeset` and the `$batch` request.
  - **Write handler, scope and changeset-runner context**: `ctx.executionContext` / `ctx.request` of write handlers and scopes are the operation's own (they used to be the `$batch` route's). `ctx.batch` and, inside a changeset, `ctx.manager` are still set.
  - **One `BatchController` per application** ([#73](https://github.com/cberd1509/nestjs-odata/issues/73)): `forFeature()` now imports a static `ODataBatchModule` instead of declaring `BatchController` itself, so a single `POST {serviceRoot}/$batch` serves the entity sets of every feature module. Before, each `forFeature()` registered its own controller, the first one won, and parts for another feature's entity sets failed with 500.
  - Code of your own that writes from an OData route (a custom controller transaction, an injected repository) is not part of a changeset unless it uses `getODataChangesetManager()`.

  **Additions:**

  - `ODataTypeOrmModule.forRoot({ batch: { enabled?, entitySets?, operationTimeout? } })`: `enabled: false` turns the endpoint off (404); `entitySets` allow-lists the entity sets operations may reach — the resource path's, navigation targets (`Products(1)/Supplier`) and `$expand` targets, nested ones included and whatever the case of the option name (`$EXPAND`) (403 otherwise, without reaching the route; the service root is taken from the `$batch` URL, so a global prefix equal to the service root works); `operationTimeout` limits each operation. Token `ODATA_BATCH_OPTIONS`, type `ODataBatchOptions`, `DEFAULT_BATCH_OPERATION_TIMEOUT`.
  - The batch operation, with the changeset's entity manager as its `changeset`, is attached to the operation's request (`ODATA_BATCH_PART`) as well as kept in `AsyncLocalStorage`, and read from the request first, so middleware that resumes `next()` from a foreign async context (a session store, callback-based auth) cannot make changeset writes commit outside the transaction (Express adapter; Fastify's `inject()` relies on `AsyncLocalStorage`).
  - typeorm: `getODataChangesetManager(request?)`, `ODataBatchModule`.
  - core: `getODataBatchPart(request?)` / `runWithODataBatchPart()` (the batch operation being handled, for batch-specific policies in guards), `ODATA_BATCH_PART`, `dispatchBatchOperation()` (with `timeoutMs` and the operation's batch part), `BatchOperationTimeoutError`, `inheritedBatchHeaders()`, `batchOperationHeaders()`, `parseBatchUrl()`, `resolveBatchOperationUrl()`, `batchErrorContext()`, `headerValue()`, `resolveNavigationTarget()`, `splitKeyPredicate()`, and the `BatchChangesetResponse` / `BatchResponseItem` types. `buildBatchResponse()` accepts nested changeset responses and keeps each operation's `Content-Type`.
  - Operation URLs may be relative to the service root (`Products(1)`), absolute paths or absolute URIs (§11.7.7.1); a nested `$batch` operation answers 400.
  - core: the default error mapping gives 406, 413, 415 and 504 their OData codes (`NotAcceptable`, `PayloadTooLarge`, `UnsupportedMediaType`, `GatewayTimeout`) instead of `Error`.

- [#84](https://github.com/cberd1509/nestjs-odata/pull/84) [`ee0b8fe`](https://github.com/cberd1509/nestjs-odata/commit/ee0b8feebbfc7a99076d9194be897932738c5566) Thanks [@cberd1509](https://github.com/cberd1509)! - OData 4.01 query-language conformance ([#66](https://github.com/cberd1509/nestjs-odata/issues/66), [#68](https://github.com/cberd1509/nestjs-odata/issues/68), [#69](https://github.com/cberd1509/nestjs-odata/issues/69), [#72](https://github.com/cberd1509/nestjs-odata/issues/72), [#74](https://github.com/cberd1509/nestjs-odata/issues/74)):

  - `$filter` on single-valued navigation paths (`category/name eq 'Tools'`, `store/region/name`): rendered as a correlated subquery, applying the row-level scope of every entity set on the path (a related row outside its scope reads as `null`). Works inside `or`, `not`, string functions, lambda predicates and nested `$expand` filters.
  - Lambdas (`any`/`all`) over many-to-many navigation properties, through the junction table, applying the target's row-level scope like one-to-many lambdas.
  - Nested `$expand` `$count=true` (`nav@odata.count`) and `$expand=nav/$count`: one grouped, scoped `COUNT` query per expand item, counting the rows matching the nested `$filter`/`$search` and ignoring `$top`/`$skip`.
  - Nested `$expand` `$search`, through the search provider (501 when none is registered).
  - Nested `$top`/`$skip` on one-to-many navigations are paged in SQL with `ROW_NUMBER() OVER (PARTITION BY <foreign key> ...)` on SQLite, PostgreSQL, CockroachDB, SQL Server and Oracle; other drivers, many-to-many navigations and composite keys fall back to in-memory slicing. `TranslateResult.expandPaginationMap` (and `applyExpandPagination`) are now keyed by expand path (`store/items`), so two expand paths ending in the same navigation property keep their own options.

  Fixes:

  - `$filter` with `or` was rendered as `AND` (`a or b` returned the rows matching both). It now renders `(a) OR (b)`.
  - A nested `$orderby` inside `$expand` replaced the ordering of the parent rows (`$orderby=id&$expand=items($orderby=qty)`); it is now appended after it.
  - `not` applied to a lambda (`not items/any(...)`) produced invalid SQL; it now negates the `EXISTS`.
  - `eq null` / `ne null` rendered `= NULL` / `!= NULL`, which never match; they now render `IS NULL` / `IS NOT NULL`.
  - Comparing two properties at the top level of `$filter` (`qty gt minQty`) compared against `NULL`; the right-hand expression is now rendered.
  - `contains`/`startswith`/`endswith` keep the parameters of their property expression.

- [#85](https://github.com/cberd1509/nestjs-odata/pull/85) [`d073558`](https://github.com/cberd1509/nestjs-odata/commit/d073558c51bde7445250bcb0fd703d6d3955f9f6) Thanks [@cberd1509](https://github.com/cberd1509)! - OData 4.01 protocol conformance of writes, ETags, routing and errors ([#63](https://github.com/cberd1509/nestjs-odata/issues/63), [#70](https://github.com/cberd1509/nestjs-odata/issues/70), [#71](https://github.com/cberd1509/nestjs-odata/issues/71), [#75](https://github.com/cberd1509/nestjs-odata/issues/75), [#76](https://github.com/cberd1509/nestjs-odata/issues/76), [#77](https://github.com/cberd1509/nestjs-odata/issues/77), [#78](https://github.com/cberd1509/nestjs-odata/issues/78), [#79](https://github.com/cberd1509/nestjs-odata/issues/79), [#80](https://github.com/cberd1509/nestjs-odata/issues/80), [#81](https://github.com/cberd1509/nestjs-odata/issues/81)).

  **Behaviour changes** (spec-mandated, on by default):

  - **Unknown properties in write bodies answer 400** (Part 1 §11.4.2: the service MUST fail when it cannot persist a value). POST, PATCH and PUT (HTTP and `$batch`, repository path) refuse a property that is not in the entity type, including columns hidden with `@ODataExclude` or `select: false`, with one `UnknownProperty` entry per property in `details`. They were silently ignored before (and hidden columns could be written). Escape hatch: `ignoreUnknownProperties: true` in `ODataModule.forRoot()` drops them instead (still never persisted). Bodies handed to write handlers are unchanged.
  - **PUT ignores a body key that differs from the URL key** (§11.4.3) and replaces the entity at the URL, over HTTP and in `$batch`, instead of answering 400 "Key in body does not match URL key".
  - **Computed properties are ignored on POST/PATCH** (§11.4.2): `@CreateDateColumn`, `@UpdateDateColumn`, `@VersionColumn` and generated non-key columns. `$metadata` annotates them with `Core.Computed` and now references the Core vocabulary (`edmx:Reference`) whenever an annotation is used.
  - **`If-None-Match` on PATCH, PUT and DELETE** answers 412 with no change when it matches the current ETag; `*` matches any existing entity (§8.2.5). HTTP and `$batch`.
  - **`If-Match` / `If-None-Match` are read from the request** by `TypeOrmAutoHandler` when the controller doesn't pass them, so controllers that never bound `@Headers('if-match')` now get 412 on a stale `If-Match`. An explicit `ifMatch` argument still wins.
  - **`ETag` on rows without an ETag value**: an entity whose ETag column is absent from the row (e.g. not selected) gets no ETag instead of the ETag of `undefined`.

  **Additions:**

  - **Canonical entity URLs are routed** (URL Conventions §4.3.1): `GET/PATCH/PUT/DELETE /odata/Products(1)` and composite `/odata/OrderItems(orderId=1,productId=2)` reach the key routes, so `Location` and `@odata.id` (unchanged, canonical) are resolvable. `ODataModule` rewrites the URL to `/Set/key` before routing on the Express adapter, only for registered entity sets; `/Set/key` keeps working.
  - **`Content-Language`** on every error response and `$batch` error part (§9.4): an `errorMapper` result's new `language`, else the new `errorLanguage` module option, else `en`. `buildODataErrorResponse()` returns `language` and takes an optional default language. Mappings with an invalid language tag fall back to the default mapping; an invalid `errorLanguage` fails at startup.
  - **`Prefer: return=minimal`** (§8.2.8.7) on POST, PATCH and PUT answers 204 with `Preference-Applied` (POST: `Location` and `OData-EntityId`); `return=representation` is confirmed with `Preference-Applied`; `$select`/`$expand` imply representation. Also per `$batch` part (`$N` references to a 204 create keep working).
  - **`requireIfMatch`** per `forFeature()` item: PATCH, PUT and DELETE without `If-Match` answer 428 with no change (HTTP, `$batch`, write handlers), and `$metadata` annotates the entity set with `Core.OptimisticConcurrency`. Write handlers get `ctx.requireIfMatch` and `ctx.ifNoneMatch`.
  - **`@odata.etag` on each entity of a collection** for entity sets with an ETag (JSON §4.5.10).
  - **304 Not Modified no longer logs "Cannot set headers after they are sent"**: the interceptor signals an empty response that `ODataExceptionFilter` sends (also used for 204).
  - **Express `etag` warning**: a startup warning while Express's `etag` setting is on (its hash ETags on errors, collections and `$metadata` are not OData ETags). The library doesn't change the setting; docs recommend `app.set('etag', false)`.
  - The default error mapping keeps valid `details` of 4xx `HttpException`s with an OData-shaped body, and maps 428 to `PreconditionRequired`.
  - New exports: core `resolveReturnPreference`, `rewriteCanonicalKeyUrl`, `isLanguageTag`, `DEFAULT_ERROR_LANGUAGE`, `EdmProperty.computed`, `EdmEntitySet.optimisticConcurrency`; typeorm `prepareWriteBody`.

### Patch Changes

- Updated dependencies [[`46fb9e4`](https://github.com/cberd1509/nestjs-odata/commit/46fb9e42841f1d0624dad9f182f3c473083da68d), [`ee0b8fe`](https://github.com/cberd1509/nestjs-odata/commit/ee0b8feebbfc7a99076d9194be897932738c5566), [`d073558`](https://github.com/cberd1509/nestjs-odata/commit/d073558c51bde7445250bcb0fd703d6d3955f9f6)]:
  - @nestjs-odata/core@2.3.0

## 3.1.0

### Minor Changes

- [#62](https://github.com/cberd1509/nestjs-odata/pull/62) [`b502a64`](https://github.com/cberd1509/nestjs-odata/commit/b502a642f45c78605b696cef31d0abeb37595fd7) Thanks [@cberd1509](https://github.com/cberd1509)! - Error-mapping hook.
  - **`@nestjs-odata/core`:**
    - New `errorMapper` option on `ODataModule.forRoot()`/`forRootAsync()`: `(exception, ctx) => ODataErrorMapping | undefined`, synchronous. A mapping has `status`, `code`, `message`, and optionally `target`, `details` and `innererror`, and is sent in OData v4 JSON error format. Every field is validated. Returning `undefined` keeps the default mapping, and so do a mapper that throws, returns a Promise or returns an invalid mapping (logged as a warning).
    - It runs on the routes of the OData route decorators, `$metadata` and the service document. Plain Nest routes on an `@ODataController` keep the application's global filters and can opt in with `@UseFilters(ODataExceptionFilter)`.
    - The default mapping keeps the 4xx/5xx status of non-`HttpException` errors carrying a numeric `status`/`statusCode`, and never sends the message of a 5xx error (also for 5xx `HttpException`s, whose message was sent before).
    - Error responses always use `Content-Type: application/json`.
    - `HttpException`s with an OData-shaped body keep their message instead of "Http Exception", and 412 maps to `PreconditionFailed`.
    - New exports: `buildODataErrorResponse`, `httpStatusToODataCode`, `odataErrorBody` and the `ODataErrorMapper*` types.
  - **`@nestjs-odata/typeorm`:** each failing `$batch` operation goes through the mapper, with `ctx.batch = { method, url, contentId }` and the `$batch` request. Its status and body become the part's response. A changeset that fails as a whole gets `ctx.batch = { changeset: true }`.
  - OData conformance (JSON Format 4.01 §21.1): mapper results need non-empty `code` and `message` (also in `details`), and `target` may be `null`. The default `details` of parse and validation errors now carry `code` and `message` too (`QueryOption`, `AvailableProperties`); their `target` and `value` are unchanged.
  - The library's own `$batch` part errors (404, missing key, 412, 405, …) also go through the mapper, and the mapper context's `request` comes from the OData request context. The default mapping follows an error's `cause` chain to a 4xx, over HTTP and in `$batch`.

- [#59](https://github.com/cberd1509/nestjs-odata/pull/59) [`9b4a574`](https://github.com/cberd1509/nestjs-odata/commit/9b4a57402182e1110d1c3ed055ebe08f1c20383f) Thanks [@cberd1509](https://github.com/cberd1509)! - Support NestJS 12 and TypeORM 1.
  - Widen the peer dependencies to `@nestjs/common`, `@nestjs/core` and `@nestjs/typeorm` `^10 || ^11 || ^12`, and `typeorm` `^0.3.0 || ^1.0.0`.
  - `@nestjs-odata/core` now declares `@nestjs/core` as a peer dependency; it already imported `Reflector` from it.
  - `@nestjs-odata/typeorm` no longer deep-imports `@nestjs/typeorm/dist/...` in its published type declarations. `@nestjs/typeorm` 12 only exports its root entry, so that import did not resolve for consumers. The type is now exported as `EntityClassOrSchema`.
  - `@nestjs-odata/typeorm` now requires `@nestjs-odata/core` `>=2.2.0` (the first core release with NestJS 12 peers).
  - The workspace develops and tests on NestJS 12.3, `@nestjs/typeorm` 12.0 and TypeORM 1.1, so every existing suite (unit and e2e) runs on them.
  - SQLite-based drivers other than `sqlite` (`better-sqlite3`, `sqljs`, `capacitor`, `expo`, …) now get the SQLite dialect for date (`year()`, …) and `indexof()` filters. Before, they fell back to ANSI SQL that SQLite cannot run.
  - The query translator reads the driver type from `EntityManager.dataSource` instead of the deprecated `connection` alias.
  - `EntityClassOrSchema` is derived from `TypeOrmModule.forFeature()`'s parameter type, so it always matches what `@nestjs/typeorm` accepts.

- [#60](https://github.com/cberd1509/nestjs-odata/pull/60) [`8fd7f75`](https://github.com/cberd1509/nestjs-odata/commit/8fd7f754791535760ff9eacf4032444426ee5c98) Thanks [@cberd1509](https://github.com/cberd1509)! - Row-level scopes.
  - **`@nestjs-odata/typeorm`:** `ODataTypeOrmModule.forFeature()` items accept a `scope`, and the options accept `defaultScope` and `imports`. A scope is `(qb, ctx) => void | Promise<void>` or an injectable `ODataScope` class. `ctx` carries the entity set, the EDM type, the TypeORM metadata, the alias, the operation, the navigation path, the Nest `ExecutionContext` and the request. The scope restricts collection reads, `$count`, `$apply`, by-key reads, every `$expand` path (in the JOIN condition, at any depth), lambdas (`any`/`all`) in `$filter`, `$batch`, and the existence checks of `PATCH`/`PUT`/`DELETE` in `TypeOrmAutoHandler` and `$batch`. New `TypeOrmScopeService` for custom controllers; `TypeOrmQueryTranslator.translate()` takes an optional scope plan.
  - **`@nestjs-odata/core`:** new `requireScope` option fails closed: the app refuses to start while an entity set has no scope, and requests that reach one fail. New `getODataRequestContext()` / `runWithODataRequestContext()` and a global `ODataRequestContextInterceptor`, registered by `forRoot()`, that exposes the current `ExecutionContext` and request to hooks.
  - **Fixes:**
    - Nested query options inside `$expand(...)` are applied. They were ignored, because the target type was looked up by its qualified name.
    - A nested `$filter` now restricts the expanded rows (in the JOIN), not the parent rows.
    - A nested `$select` no longer replaces the root selection.
    - Lambda predicates such as `items/any(i: i/quantity gt 1)` work: the pipe validates `i/quantity` against the collection's entity type, and the translator maps it to the lambda alias.
  - **Hardening:**
    - Options inside `$expand(...)` are validated against the related type; unknown or excluded properties give 400 instead of 500.
    - TypeORM `select: false` columns are excluded from the EDM, like `@ODataExclude`.
    - Key properties in a `PATCH` body are ignored, over HTTP and in `$batch` (OData 4.01 Part 1 §11.4.3), so a body key can no longer redirect the update to another row.
    - Scoped writes run the scope check and the write in one transaction, with a row lock where the driver supports it.
    - Scoped by-key reads load eager relations.
    - Each scope runs once per entity set and operation for a request.
    - Under `requireScope`, a missing `$expand` or lambda lookup fails.
    - Inside a lambda, properties without the range variable refer to the outer entity, and predicates can use `and`, `or` and `not`.
  - **`@nestjs-odata/typeorm` peers:** `@nestjs-odata/core >=2.2.0` (the core release with request context and `requireScope`) and `@nestjs/core`.
  - **`navigationTargetTypeName`:** now exported from `@nestjs-odata/core`.
  - **`@nestjs-odata/core`:** new `EdmRegistry.getEntitySetByTypeName()`.

- [#61](https://github.com/cberd1509/nestjs-odata/pull/61) [`5159ce4`](https://github.com/cberd1509/nestjs-odata/commit/5159ce4dd7946263ed49907acc4faeb348cc01fa) Thanks [@cberd1509](https://github.com/cberd1509)! - Custom write handlers.
  - **`@nestjs-odata/typeorm`:**
    - `ODataTypeOrmModule.forFeature()` items accept `writeHandlers`: an `ODataWriteHandlers` object or an injectable class with `create`, `deepInsert`, `update` (PATCH), `replace` (PUT) and `delete`. They route the entity set's writes, including `$batch`, through application code instead of the repository. A missing handler answers 405.
    - Handlers receive the parsed body, the parsed key, and an `ODataWriteContext`: entity set, EDM type, operation, raw key, `If-Match`, Nest `ExecutionContext`, request, and in a changeset the transaction's `EntityManager` and the batch info. They return the entity to serialize.
    - New `etag` item option (a property name or a function) sets the entity set's ETag source. It overrides `@ODataETag`/`@UpdateDateColumn`, is sent on by-key reads and handler-written responses, and `etagMatches()` / `formatWeakETag()` are exported.
    - New `ODataTypeOrmModule.forRoot({ changesetRunner })` runs `$batch` changesets inside the application's own unit of work (or provide the new `ODATA_CHANGESET_RUNNER` token). The default is a `QueryRunner` transaction exposed to handlers as `ctx.manager`. A runner that wraps errors no longer hides the failing part's status.
    - `$batch` response parts now carry their `Location` and `ETag` headers, and entity bodies their `@odata.etag`, for every ETag source (also `@ODataETag` / `@UpdateDateColumn`) and on GET by key. Before, part headers were dropped.
    - `If-Match: *` and ETag lists are accepted for every ETag source.
    - A handler that returns no entity fails with 500 (HTTP and `$batch`); deep inserts whose nested entities belong to a handler-backed entity set are refused with 400; `null` navigation values no longer count as a deep insert.
    - `$batch` keeps the status of an `HttpException` found in an error's `cause` chain.
    - Scoped writes only take a row lock inside a transaction (PostgreSQL refuses `FOR UPDATE` outside one).
  - **`@nestjs-odata/core`:** POST responses whose entity carries an adapter-provided ETag get the `ETag` header and `@odata.etag`.
    - `TypeOrmETagProvider.validateIfMatch()` now uses the same comparison as the write paths (`*`, lists), and `computeETag()` the same format as `formatWeakETag()`. New `hasEntityETag()` helper.
    - OData conformance: a 405 from write handlers carries an `Allow` header (Part 1 §9.2.2); repository creates send the entity's ETag and `@odata.etag` (instead of none); `$batch` repository writes check `If-Match` like the HTTP routes (412).

### Patch Changes

- Updated dependencies [[`b502a64`](https://github.com/cberd1509/nestjs-odata/commit/b502a642f45c78605b696cef31d0abeb37595fd7), [`9b4a574`](https://github.com/cberd1509/nestjs-odata/commit/9b4a57402182e1110d1c3ed055ebe08f1c20383f), [`8fd7f75`](https://github.com/cberd1509/nestjs-odata/commit/8fd7f754791535760ff9eacf4032444426ee5c98), [`5159ce4`](https://github.com/cberd1509/nestjs-odata/commit/5159ce4dd7946263ed49907acc4faeb348cc01fa)]:
  - @nestjs-odata/core@2.2.0

## 3.0.0

### Minor Changes

- [#35](https://github.com/cberd1509/nestjs-odata/pull/35) [`d204ea2`](https://github.com/cberd1509/nestjs-odata/commit/d204ea2ef65128a3dc9d7ea6675542e64ffeeaba) Thanks [@cberd1509](https://github.com/cberd1509)! - Dependency bumps to the latest safe versions, plus a focused round of fixes
  and DX improvements surfaced by a real-world multi-entity integration.

  ### Bug fixes
  - **`@nestjs-odata/typeorm`**: `TypeOrmAutoHandler` no longer mis-routes
    requests to the first-registered entity when `forFeature([A, B, ...])` is
    called with multiple entities. The handler now resolves the correct
    `Repository` per request from the entity-set name via `DataSource` +
    `EdmRegistry`. `TypeOrmQueryTranslator.translate()` accepts an optional
    per-request repo override (backwards compatible for single-entity callers).
    Eliminates the downstream "column does not exist" 500 that hit any filter
    referencing a column unique to the second-registered entity.

  ### New features / DX improvements
  - **`@nestjs-odata/typeorm`**: `ODataTypeOrmModule.forFeature()` now accepts a
    mixed array of entity classes and `{ entity, name }` config objects so you
    can override the OData entity-set name without touching the entity class.
    Avoids the `/odata/UserEntities` ugliness that comes from the `Entity`
    suffix convention — pass `{ entity: UserEntity, name: 'Users' }` to expose
    `/odata/Users` instead. Override wins over `@ODataEntitySet` decorator and
    default pluralization.
  - **`@nestjs-odata/typeorm`**: `forFeature()` accepts a new
    `options.controllers` array. When provided, controllers are both
    PATH_METADATA-patched with `serviceRoot` AND registered in the dynamic
    module — eliminating the "declare in two places" papercut (`ODataModule
.forRoot({controllers})` + `@Module({controllers})`). Single declaration
    in `forFeature` is now sufficient for DI resolution.
  - **`@nestjs-odata/typeorm`**: `@odata.nextLink` is now built from `serviceRoot
    - entitySetName`(not`req.originalUrl`), so it's prefix-consistent with
`@odata.context`and`@odata.id`. OData v4 clients (Excel, Olingo,
odata2ts) can now navigate paginated responses when the app is mounted
under a Nest `setGlobalPrefix`.
  - **`@nestjs-odata/core`**: New `ODataModule.globalPrefixExclude(serviceRoot?)`
    static helper returning the Express 5 splat-style exclude patterns for
    `app.setGlobalPrefix()`. Replaces hand-crafted `'api/odata{/*splat}'`
    snippets — call `app.setGlobalPrefix('api', { exclude: ODataModule
.globalPrefixExclude() })`.

  ### Tests
  - New e2e regression suite `apps/test-app/test/multi-entity-disambiguation
.e2e-spec.ts` (16 tests) covering: multi-entity routing for list /
    get-by-key / $count / POST / PATCH / DELETE / multi-word `$filter`literal /
    entity registration-order swap, the`{ entity, name }`override, the
    single-declaration`forFeature({ controllers })`pattern, the prefix-
    consistent`@odata.nextLink`, and the `globalPrefixExclude` helper.

  ### Docs
  - `docs/guide/getting-started.md`: new sections on multi-entity registration
    - custom set names, and `setGlobalPrefix()` integration.
  - `docs/guide/configuration.md`: documents the `{ entity, name }` form, the
    `controllers` option on `forFeature`, and the global-prefix workflow.
  - `docs/api/module.md`: full reference for `ODataModule.globalPrefixExclude()`
    and the expanded `ODataTypeOrmModule.forFeature()` signature including
    the new `ODataTypeOrmFeatureItem` type.
  - `docs/guide/troubleshooting.md`: three new entries for the common gotchas
    (double-prefixed routes, ugly `Entities` URL suffix, multi-entity wrong-
    row symptom).

  ### Backwards compatibility

  All changes are additive. Existing `forFeature([Product, Order])` calls and
  `forRoot({ controllers })` + `@Module({ controllers })` setups continue to
  work unchanged. The test-app's existing 197 e2e tests pass without
  modification.

### Patch Changes

- Updated dependencies [[`d204ea2`](https://github.com/cberd1509/nestjs-odata/commit/d204ea2ef65128a3dc9d7ea6675542e64ffeeaba)]:
  - @nestjs-odata/core@2.1.0

## 2.0.0

### Major Changes

- [`0966a8c`](https://github.com/cberd1509/nestjs-odata/commit/0966a8c4d999d2465f5692732350b9fc9c2b4909) Thanks [@cberd1509](https://github.com/cberd1509)! - Initial v1.0.0 release — OData v4 for NestJS with TypeORM integration

  Features:
  - Auto-derive OData EDM from TypeORM entities (zero double-declaration)
  - Full query surface: $filter, $select, $orderby, $top, $skip, $count, $expand
  - Filter functions: string, date/time, arithmetic, lambda (any/all)
  - CRUD operations with PATCH, PUT (full replace), and deep inserts
  - $batch with multipart/mixed and Content-ID cross-references
  - $search with pluggable search providers
  - $apply aggregation pipelines (groupby, aggregate, filter, compute)
  - Response annotations (@odata.id, @odata.type, @odata.etag)
  - ETag-based optimistic concurrency control
  - Configurable security limits and validation
  - $metadata endpoint with CSDL XML
  - Zero-boilerplate module API (forRoot/forFeature)

### Patch Changes

- Updated dependencies [[`0966a8c`](https://github.com/cberd1509/nestjs-odata/commit/0966a8c4d999d2465f5692732350b9fc9c2b4909)]:
  - @nestjs-odata/core@2.0.0
