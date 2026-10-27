---
'@nestjs-odata/typeorm': minor
'@nestjs-odata/core': patch
---

Custom write handlers.

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
