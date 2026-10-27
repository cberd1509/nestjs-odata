# @nestjs-odata/typeorm

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
