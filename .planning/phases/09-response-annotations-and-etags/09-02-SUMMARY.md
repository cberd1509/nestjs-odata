---
phase: 09-response-annotations-and-etags
plan: '02'
subsystem: etag
tags: [etag, concurrency-control, if-match, if-none-match, odata-etag, optimistic-locking]
dependency_graph:
  requires:
    - packages/core/src/response/odata-annotation.builder.ts
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
  provides:
    - packages/core/src/decorators/odata-etag.decorator.ts
    - packages/core/src/interfaces/etag.interface.ts
    - packages/typeorm/src/etag/typeorm-etag.provider.ts
    - apps/test-app/test/odata-etag.e2e-spec.ts
  affects:
    - packages/core/src/decorators/metadata-keys.ts
    - packages/core/src/decorators/index.ts
    - packages/core/src/interfaces/index.ts
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/typeorm/src/index.ts
    - apps/test-app/src/entities/product.entity.ts
    - apps/test-app/src/products/products.controller.ts
tech_stack:
  added: []
  patterns:
    - IETagProvider interface for core-adapter boundary (zero ORM imports in core)
    - Optional NestJS DI injection (@Optional()/@Inject(ETAG_PROVIDER)) for graceful no-etag fallback
    - Weak ETag format W/"base64-encoded-value" — deterministic, no crypto dependency
    - In-interceptor 304 handling via response.status(304).end() — bypasses NestJS serializer
    - TypeORM @UpdateDateColumn auto-discovery via column.isUpdateDate metadata reflection
    - Cache Map for per-entity-set ETag column resolution to avoid repeated reflection
key_files:
  created:
    - packages/core/src/decorators/odata-etag.decorator.ts
    - packages/core/src/decorators/odata-etag.decorator.spec.ts
    - packages/core/src/interfaces/etag.interface.ts
    - packages/typeorm/src/etag/typeorm-etag.provider.ts
    - packages/typeorm/src/etag/typeorm-etag.provider.spec.ts
    - apps/test-app/test/odata-etag.e2e-spec.ts
  modified:
    - packages/core/src/decorators/metadata-keys.ts
    - packages/core/src/decorators/index.ts
    - packages/core/src/interfaces/index.ts
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/core/src/response/odata-response.interceptor.spec.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.spec.ts
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/typeorm/src/odata-typeorm.module.spec.ts
    - packages/typeorm/src/index.ts
    - apps/test-app/src/entities/product.entity.ts
    - apps/test-app/src/products/products.controller.ts
decisions:
  - 'IETagProvider interface lives in core with zero ORM imports — adapter implements it, core only defines the contract'
  - 'ETag computation uses W/"base64(stringValue)" — simple, deterministic, no crypto dependency, changes when column value changes'
  - 'ETAG_PROVIDER token registered via @Optional()/@Inject() in TypeOrmAutoHandler — entities without ETag column silently skip all ETag behavior'
  - '304 handling bypasses NestJS serializer by calling response.status(304).end() directly in the interceptor'
  - 'TypeOrmETagProvider registered as both TypeOrmETagProvider class and ETAG_PROVIDER symbol in ODataTypeOrmModule'
  - 'ODataTypeOrmModule.spec.ts Test 6 updated to filter only entity-requiring factories (TypeOrmQueryTranslator, TypeOrmAutoHandler) since TypeOrmETagProvider factory does not require entities'
metrics:
  duration: '~60 minutes'
  completed: '2026-04-08'
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 12
---

# Phase 09 Plan 02: ETag Concurrency Control Summary

**One-liner:** OData v4 ETag concurrency control via @ODataETag decorator, IETagProvider interface, TypeOrmETagProvider auto-discovering @UpdateDateColumn, If-Match 412 enforcement, and If-None-Match 304 cache validation.

## What Was Built

### Task 1: Core ETag interfaces, @ODataETag decorator, and TypeOrmETagProvider

**Core package additions:**

- `ODATA_ETAG_KEY` symbol added to `metadata-keys.ts`
- `@ODataETag()` property decorator — stores the ETag source property name on the class constructor via reflect-metadata
- `getETagProperty(target)` — reads the ODATA_ETAG_KEY metadata from an entity class
- `IETagProvider` interface in `packages/core/src/interfaces/etag.interface.ts` — defines `getETagColumn()`, `computeETag()`, `validateIfMatch()` with zero ORM imports
- `ETAG_PROVIDER` injection token (Symbol) exported from the same file
- Both exported from `decorators/index.ts` and `interfaces/index.ts`

**TypeORM adapter:**

- `TypeOrmETagProvider` in `packages/typeorm/src/etag/typeorm-etag.provider.ts`:
  - `getETagColumn(entitySetName)` — resolves entity class from EdmRegistry, checks @ODataETag first (explicit opt-in), falls back to TypeORM `column.isUpdateDate` (@UpdateDateColumn), returns `undefined` for entities with neither
  - Results cached in a `Map<string, string | null>` to avoid repeated metadata reflection (T-09-06 mitigated)
  - `computeETag(entity, etagColumn)` — produces `W/"base64(value)"` weak ETag (Date → ISO string, others → String)
  - `validateIfMatch(ifMatch, entity, etagColumn)` — normalizes both sides (strip W/, quotes) and compares

2 decorator tests, 10 provider tests — all pass.

### Task 2: If-Match/If-None-Match enforcement and @odata.etag annotation

**TypeOrmAutoHandler changes:**

- `@Optional() @Inject(ETAG_PROVIDER)` 5th constructor parameter (`etagProvider?: IETagProvider`)
- `handleGetByKey(keyStr, entitySetName, ifNoneMatchHeader?)` — attaches `__etag` to entity when ETag column exists; returns `{ __notModified: true, etag }` signal when If-None-Match header matches
- `handleUpdate(keyStr, body, entitySetName, ifMatchHeader?)` — fetches current entity, validates If-Match if provided, throws `HttpException({error:{code:'412',...}}, 412)` on mismatch
- `handleDelete(keyStr, entitySetName, ifMatchHeader?)` — same If-Match validation pattern

**ODataResponseInterceptor changes:**

- Handles `__notModified` signal: calls `response.setHeader('ETag', etag).status(304).end()` and returns `null`
- Handles `__etag` internal property: calls `response.setHeader('ETag', etag)`, adds `@odata.etag` to body, removes `__etag` from the spread
- Entities without ETag column pass through completely unchanged (no `__etag` property → no header, no annotation)

3 new interceptor tests (E1-E3), 6 new auto-handler tests (E1-E6) — all pass.

### Task 3: E2E tests and test-app entity update

- `Product` entity: added `@UpdateDateColumn() updatedAt: Date` — makes Product ETag-enabled
- `ProductsController`: updated `getProduct` to accept `@Headers('if-none-match')`, `updateProduct` to accept `@Headers('if-match')`, `deleteProduct` to accept `@Headers('if-match')`
- `ODataTypeOrmModule.forFeature()`: registers `TypeOrmETagProvider` as both class and `ETAG_PROVIDER` token; injects it into `TypeOrmAutoHandler` factory
- Fixed `odata-typeorm.module.spec.ts` Test 6 to filter only entity-requiring factories
- Created `apps/test-app/test/odata-etag.e2e-spec.ts` with 9 tests:
  - GET returns @odata.id, @odata.type annotations ✓
  - GET returns ETag header and @odata.etag in body ✓
  - GET collection returns annotations on items ✓
  - PATCH with current If-Match succeeds (200) ✓
  - PATCH with stale If-Match returns 412 ✓
  - DELETE with stale If-Match returns 412 ✓
  - GET with matching If-None-Match returns 304 ✓
  - GET with non-matching If-None-Match returns 200 ✓
  - Collection response has no @odata.etag at root level ✓

## Test Results

- 262 core package tests pass (including 2 decorator + 3 interceptor ETag tests)
- 218 typeorm tests pass (including 10 provider + 6 auto-handler ETag tests)
- 161 test-app e2e tests pass (including 9 ETag e2e tests)
- Build succeeds for both core and typeorm packages

## Decisions Made

1. **IETagProvider in core** — The interface lives in `@nestjs-odata/core` with zero ORM dependencies, honoring the PKG-01 architecture constraint. Adapters provide the implementation.

2. **Weak ETag format** — `W/"base64(stringValue)"` chosen over a hash function. It is deterministic, changes when the column value changes, doesn't require crypto, and is simple to debug (the original value is recoverable from base64).

3. **Optional injection** — `@Optional() @Inject(ETAG_PROVIDER)` in TypeOrmAutoHandler means the entire ETag subsystem is opt-in. Registering `ODataTypeOrmModule.forFeature()` with entities that have `@UpdateDateColumn` automatically enables ETag; entities without it skip silently.

4. **304 response via direct `response.status(304).end()`** — NestJS interceptors return values to be serialized, but 304 must have no body. Calling `response.status(304).end()` directly in the RxJS `map()` bypasses the NestJS serializer and sends the correct HTTP response. The interceptor returns `null` which NestJS would normally serialize, but the response is already sent so it's a no-op.

5. **Cache Map for ETag column resolution** — Per T-09-06 mitigation, `TypeOrmETagProvider` caches column name results in a `Map` to avoid repeated TypeORM metadata reflection on every request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript `Function` type rejected by ESLint**

- **Found during:** Task 1 commit
- **Issue:** `getETagProperty(target: Function)` and `meta.target as Function` triggered `@typescript-eslint/no-unsafe-function-type` linting errors
- **Fix:** Changed to `new (...args: unknown[]) => unknown` constructor signature
- **Files modified:** `odata-etag.decorator.ts`, `typeorm-etag.provider.ts`
- **Commit:** Part of 75efe65

**2. [Rule 1 - Bug] `__etag` destructuring triggered unused-vars ESLint error**

- **Found during:** Task 2 commit
- **Issue:** `const { __etag, ...rest } = entityResult` — `__etag` considered unused
- **Fix:** Changed to explicit `for...of` key iteration that skips `__etag`, avoiding destructuring
- **Files modified:** `odata-response.interceptor.ts`
- **Commit:** Part of 4efbd50

**3. [Rule 1 - Bug] `odata-typeorm.module.spec.ts` Test 6 broke when TypeOrmETagProvider added**

- **Found during:** Task 3 final test run
- **Issue:** Test 6 iterated over all factory providers expecting each to throw "requires at least one entity class". TypeOrmETagProvider factory doesn't require entities so it didn't throw
- **Fix:** Updated Test 6 to filter factories by specific `provide` tokens (TypeOrmQueryTranslator, TypeOrmAutoHandler) rather than all factories
- **Files modified:** `packages/typeorm/src/odata-typeorm.module.spec.ts`
- **Commit:** 0d7038b

**4. [Rule 1 - Bug] E2E tests used OData parenthesis key format `/Products(1)` instead of route param format `/Products/1`**

- **Found during:** Task 3 e2e test run
- **Issue:** All single-entity e2e tests returned 404 because the NestJS route pattern is `:key` (matching `/Products/1`), not the OData parenthesis format
- **Fix:** Updated all e2e test URLs to use `/Products/${id}` format consistent with existing crud.e2e-spec.ts
- **Files modified:** `apps/test-app/test/odata-etag.e2e-spec.ts`
- **Commit:** 0d7038b

**5. [Rule 1 - Bug] E2E test checking Tags endpoint (no Tags OData controller exists)**

- **Found during:** Task 3 e2e test run
- **Issue:** Test expected `/odata/Tags` to exist but Tags entity has no controller, returning 404
- **Fix:** Replaced with a test verifying collection response doesn't include `@odata.etag` at root level (valid OData spec behavior)
- **Files modified:** `apps/test-app/test/odata-etag.e2e-spec.ts`
- **Commit:** 0d7038b

## Known Stubs

None — all ETag functionality is fully wired from real TypeORM metadata.

## Threat Flags

No new security surface introduced beyond what was in the plan's threat model.

- T-09-04 mitigated: Server always recomputes ETag from current DB state before comparing — `validateIfMatch` calls `computeETag` internally, never trusts the client-provided value
- T-09-06 mitigated: `computeETag` uses base64 encoding (no expensive crypto), column name resolution cached per entity set

## Self-Check

Verified:

- `packages/core/src/decorators/odata-etag.decorator.ts` — FOUND
- `packages/core/src/interfaces/etag.interface.ts` — FOUND
- `packages/typeorm/src/etag/typeorm-etag.provider.ts` — FOUND
- `apps/test-app/test/odata-etag.e2e-spec.ts` — FOUND
- Commit `75efe65` — FOUND (Task 1)
- Commit `4efbd50` — FOUND (Task 2)
- Commit `0d7038b` — FOUND (Task 3)

## Self-Check: PASSED
