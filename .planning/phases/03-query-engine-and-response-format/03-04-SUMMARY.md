---
phase: 03-query-engine-and-response-format
plan: '04'
subsystem: integration
tags: [odata, auto-handler, typeorm, e2e, nextlink, count, integration]
dependency_graph:
  requires:
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/core/src/edm/edm-registry.ts
    - packages/core/src/decorators/odata-get.decorator.ts
    - packages/core/src/decorators/odata-query.decorator.ts
    - packages/core/src/query/odata-query.pipe.ts
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/core/src/response/odata-exception.filter.ts
  provides:
    - TypeOrmAutoHandler (handleGet + handleCount + buildNextLink)
    - ProductsController (OData GET + $count route for test-app)
    - odata-query.e2e-spec.ts (10 e2e tests validating all Phase 3 success criteria)
  affects:
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/typeorm/src/translator/index.ts
    - packages/core/src/edm/edm-registry.ts
    - packages/core/src/decorators/odata-get.decorator.ts
    - packages/core/src/decorators/odata-query.decorator.ts
    - apps/test-app/src/app.module.ts
tech_stack:
  added: []
  patterns:
    - next-page detection via top+1 fetch (avoids separate count query per Pitfall 2)
    - EdmRegistry idempotent registration (skip on duplicate, supports forFeature() in multiple modules)
    - ODataQueryPipe applied via @UsePipes() on controller methods
    - EntityType resolved at request time via EdmRegistry (not at module compile time)
key_files:
  created:
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.spec.ts
    - apps/test-app/src/products/products.controller.ts
    - apps/test-app/src/products/products.module.ts
    - apps/test-app/test/odata-query.e2e-spec.ts
  modified:
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/typeorm/src/translator/index.ts
    - packages/core/src/edm/edm-registry.ts
    - packages/core/src/edm/edm-registry.spec.ts
    - packages/core/src/decorators/odata-get.decorator.ts
    - packages/core/src/decorators/odata-query.decorator.ts
    - apps/test-app/src/app.module.ts
decisions:
  - 'TypeOrmAutoHandler resolves EdmEntityType at request time via EdmRegistry (not constructor) so it can be registered during module compile before onModuleInit runs'
  - 'EdmRegistry.register() made idempotent — silently skips duplicate names — allows forFeature() in both root AppModule and feature modules'
  - 'ODataGet decorator uses entitySetName as default route path (Get(entitySetName)) instead of empty string'
  - 'ODataQueryParam decorator returns req.query directly; entitySetName flows via metadata.data to ODataQueryPipe'
  - 'ODataQueryPipe applied via @UsePipes() on controller methods rather than embedded in the @ODataGet() composite'
metrics:
  duration_minutes: 14
  completed_date: '2026-04-07'
  tasks_completed: 2
  files_created: 5
  files_modified: 7
---

# Phase 3 Plan 04: Auto-handler, $count route, and E2E Tests Summary

TypeOrmAutoHandler with next-page detection and $count query stripping, wired into ODataTypeOrmModule; ProductsController demonstrating @ODataGet() + @ODataQueryParam() pattern; 10 e2e tests validating the full Phase 3 query surface against a live SQLite database.

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-07T19:15:16Z
- **Completed:** 2026-04-07T19:29:01Z
- **Tasks:** 2 of 3 (Task 3 is a human-verify checkpoint — not yet approved)
- **Files:** 5 created, 7 modified

## What Was Built

### Task 1: TypeOrmAutoHandler and module wiring (TDD)

**`TypeOrmAutoHandler`** — `@Injectable()` class that handles OData GET and $count requests:

- **`handleGet(query, requestUrl)`**: Resolves `EdmEntityType` via `EdmRegistry`, computes `effectiveTop = min(query.top ?? maxTop, maxTop)`, builds a fetchQuery with `top = effectiveTop + 1`, translates and executes via `TypeOrmQueryTranslator`, detects `hasMore = items.length > effectiveTop`, slices results, and builds `nextLink` with updated `$skip` when more pages exist (Pitfall 2 pattern — avoids second count query).
- **`handleCount(query)`**: Strips `top/skip/orderby/select` from the query before translating — only `filter` and `entitySetName` remain. Returns `qb.getCount()`. Ensures count reflects total matching rows, not just the current page (T-03-12, Pitfall 3).
- **`buildNextLink(requestUrl, newSkip, top)`**: Parses the current URL's query params, updates/adds `$skip` and `$top`, rebuilds the URL without percent-encoding OData `$` prefix.

**`ODataTypeOrmModule.forFeature()` updated** to additionally provide:

- `TypeOrmQueryTranslator` (factory using `DataSource.getRepository(entities[0])`)
- `TypeOrmAutoHandler` (injects translator, EdmRegistry, ODataModuleResolvedOptions)
- Exports both so feature module controllers can inject them

**7 unit tests, all passing.** TDD RED phase confirmed failure before implementation.

Commit: `f0ccc25`

### Task 2: ProductsController, e2e test, and integration fixes

**`ProductsController`** — test-app controller using `@ODataGet('Products')` and `@Get('Products/$count')`:

- `findAll()`: decorated with `@ODataGet('Products')` and `@UsePipes(ODataQueryPipe)`, calls `autoHandler.handleGet(query, '/odata/Products')`
- `count()`: decorated with `@Get('Products/$count')`, `@Header('Content-Type', 'text/plain')`, and `@UsePipes(ODataQueryPipe)`, calls `autoHandler.handleCount(query)`

**`ProductsModule`** — imports `ODataTypeOrmModule.forFeature([Product])` to get `TypeOrmAutoHandler` in scope.

**`odata-query.e2e-spec.ts`** — 10 e2e tests against a live SQLite database seeded with 7 Products:

1. Basic collection returns OData JSON envelope with `@odata.context`
2. Full query ($filter+$select+$orderby+$top+$skip) returns filtered, sorted, paginated results (SC-1)
3. $select projection returns only selected + key fields
4. Invalid field returns HTTP 400 with OData error body (SC-2)
5. Malformed $filter returns HTTP 400 with OData error body (SC-2)
6. `$count=true` adds `@odata.count` to response (SC-4)
7. `/$count` path returns plain integer as `text/plain` (SC-4)
8. `$top=2` with 7 products returns `@odata.nextLink` containing `$skip=2`
9. `$top=1000` with 7 products returns no `@odata.nextLink`
10. Various filter expressions (contains, boolean, numeric) execute without SQL errors (SC-3)

Commit: `94196cb`

## Tests

| Scope                        | Tests   | Status   |
| ---------------------------- | ------- | -------- |
| typeorm-auto-handler.spec.ts | 7       | PASS     |
| @nestjs-odata/core (full)    | 173     | PASS     |
| @nestjs-odata/typeorm (full) | 112     | PASS     |
| test-app e2e (full)          | 19      | PASS     |
| **Total**                    | **304** | **PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ODataGet decorator used empty string as default path**

- **Found during:** Task 2 (e2e tests returned 404)
- **Issue:** `@ODataGet('Products')` called `Get('')` — route was `GET /odata/` not `GET /odata/Products`
- **Fix:** Changed `Get(options?.path ?? '')` to `Get(options?.path ?? entitySetName)`
- **Files modified:** `packages/core/src/decorators/odata-get.decorator.ts`
- **Commit:** `94196cb`

**2. [Rule 1 - Bug] ODataQueryParam returned wrapped object instead of req.query**

- **Found during:** Task 2 (integration analysis of pipe+decorator contract)
- **Issue:** Decorator returned `{ query: req.query, entitySetName: data }` but ODataQueryPipe expected `Record<string, string>` (raw req.query). The pipe reads entitySetName from `metadata.data`, not from the value.
- **Fix:** Updated decorator to return `request.query` directly; `_data` prefix added to unused factory parameter
- **Files modified:** `packages/core/src/decorators/odata-query.decorator.ts`
- **Commit:** `94196cb`

**3. [Rule 2 - Missing] EdmRegistry threw on duplicate entity registration**

- **Found during:** Task 2 (ProductsModule + AppModule both registering Product via forFeature)
- **Issue:** `EdmRegistry.register()` threw on duplicate entity type names. But the idiomatic NestJS pattern is to call `forFeature([Product])` in the feature module that owns the entity, AND the root module may also register all entities for metadata endpoints. Both calls would hit the registry.
- **Fix:** Made `register()` idempotent — silently skip if entity type name already exists. Original registration preserved. Updated spec (Test 4) to reflect the new behavior.
- **Files modified:** `packages/core/src/edm/edm-registry.ts`, `packages/core/src/edm/edm-registry.spec.ts`
- **Commit:** `94196cb`

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 missing behavior)
**Impact:** All fixes were necessary for the integration to work correctly. No scope creep.

## Checkpoint Status

**Task 3 (human-verify)** is a blocking checkpoint. The automated tasks are complete with all tests passing. Manual verification is required before the checkpoint can be marked approved.

## Threat Model Coverage

| Threat                                | Mitigation                                                      | Status    |
| ------------------------------------- | --------------------------------------------------------------- | --------- |
| T-03-11 DoS via nextLink              | effectiveTop clamped to maxTop from ODataModuleResolvedOptions  | Mitigated |
| T-03-12 Tampering via $count          | handleCount() strips top/skip/orderby/select before count query | Mitigated |
| T-03-13 Info Disclosure via test data | Synthetic product entities; not deployed to production          | Accepted  |

## Known Stubs

None — all components are fully implemented and tested.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced beyond what was planned.

## Self-Check: PASSED
