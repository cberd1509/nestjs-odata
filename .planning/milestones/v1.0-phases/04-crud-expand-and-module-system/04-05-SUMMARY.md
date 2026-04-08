---
phase: 04-crud-expand-and-module-system
plan: 05
subsystem: testing
tags: [nestjs, odata, e2e, crud, expand, route-isolation, typeorm, vitest]

requires:
  - phase: 04-crud-expand-and-module-system
    plan: 03
    provides: TypeOrmAutoHandler CRUD methods, ExpandVisitor, $expand validation
  - phase: 04-crud-expand-and-module-system
    plan: 04
    provides: ODataModule.forRoot controller path patching with serviceRoot

provides:
  - 'ProductsController using @ODataController(Products) + full CRUD decorator pattern'
  - 'HealthController at /api/health for non-OData route isolation testing'
  - 'crud.e2e-spec.ts: 7 tests for POST 201+Location, GET by key, PATCH merge, DELETE 204, 404 cases'
  - 'expand.e2e-spec.ts: 4 tests for $expand=category with seeded relation data, invalid nav prop 400'
  - 'route-isolation.e2e-spec.ts: 4 tests verifying /api/health has no @odata.context (T-04-14)'
  - 'Fix: @ODataController no longer applies class-level interceptors (prevents double-wrapping)'

affects:
  - future CRUD controllers that use @ODataController pattern
  - any plan testing route isolation with non-OData controllers

tech-stack:
  added: []
  patterns:
    - '@ODataController pattern: class sets path prefix + ODATA_CONTROLLER_KEY, method decorators handle interceptors'
    - 'PATH_METADATA patching at import time in feature module for DI-safe controller registration'
    - '$count endpoint registered BEFORE :key wildcard to avoid NestJS route conflict'
    - 'E2e seed pattern: dataSource.getRepository() in beforeAll for deterministic test state'

key-files:
  created:
    - apps/test-app/src/health/health.controller.ts
    - apps/test-app/src/health/health.module.ts
    - apps/test-app/test/crud.e2e-spec.ts
    - apps/test-app/test/expand.e2e-spec.ts
    - apps/test-app/test/route-isolation.e2e-spec.ts
  modified:
    - apps/test-app/src/products/products.controller.ts
    - apps/test-app/src/products/products.module.ts
    - apps/test-app/src/app.module.ts
    - packages/core/src/decorators/odata-controller.decorator.ts
    - packages/core/src/decorators/odata-controller.decorator.spec.ts

key-decisions:
  - '@ODataController drops class-level UseInterceptors/UseFilters: each method decorator (@ODataGet etc) already applies them, so class-level application caused double-wrapping and produced @odata.context without value array'
  - 'ProductsController registered in ProductsModule (not ODataModule.forRoot) so TypeOrmAutoHandler DI resolves correctly — PATH_METADATA patched manually in module file at import time'
  - '$count method must appear before @ODataGetByKey in controller class to avoid NestJS wildcard :key matching $count first'

patterns-established:
  - '@ODataController usage: set class path prefix + ODATA_CONTROLLER_KEY; rely on per-method decorators for response interceptors'
  - 'Manual PATH_METADATA patching at module file top-level is equivalent to ODataModule.forRoot controllers patching, but keeps controller in the correct DI scope'

requirements-completed:
  - CRUD-01
  - CRUD-02
  - CRUD-03
  - CRUD-04
  - QUERY-07
  - QUERY-08
  - RESP-03
  - MOD-03
  - MOD-04
  - MOD-05
  - TEST-04
  - TEST-06

duration: 25min
completed: 2026-04-07
---

# Phase 4 Plan 05: Test-App Integration, E2E Tests, Route Isolation Summary

**End-to-end validation of Phase 4 CRUD, $expand, and route isolation: 34 e2e tests pass across CRUD operations, $expand with TypeORM JOINs, and non-OData route isolation**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-07T16:30:00Z
- **Completed:** 2026-04-07T16:55:00Z
- **Tasks:** 2 (Task 3 is checkpoint:human-verify — awaiting human approval)
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- Replaced the existing `ProductsController` with a new implementation using `@ODataController('Products')` and the full CRUD decorator set, proving the complete decorator consumer API
- Created `HealthController` at `/api/health` as a plain NestJS controller demonstrating OData formatting does NOT leak to non-OData routes (T-04-14 mitigation verified by test)
- Wrote 15 new e2e tests (crud: 7, expand: 4, route-isolation: 4) validating all Phase 4 CRUD requirements, $expand correctness, and route isolation
- Discovered and fixed a double-wrapping bug in `@ODataController`: it was applying `UseInterceptors` at class level AND the method decorators also applied it, causing the OData envelope to be wrapped twice, stripping the `value` array

## Task Commits

Each task was committed atomically:

1. **Task 1: Create OData Products controller, health controller, and wire modules** - `82450d5` (feat)
2. **Task 2: Write e2e tests for CRUD, $expand, route isolation** - `d4a4d41` (feat)

## Files Created/Modified

- `apps/test-app/src/products/products.controller.ts` - Replaced with @ODataController + CRUD decorators; $count before :key
- `apps/test-app/src/products/products.module.ts` - Removed controller from controllers array; patches PATH_METADATA at import time
- `apps/test-app/src/app.module.ts` - Added HealthModule import
- `apps/test-app/src/health/health.controller.ts` - Plain @Controller('api') with GET health endpoint
- `apps/test-app/src/health/health.module.ts` - HealthModule registering HealthController
- `apps/test-app/test/crud.e2e-spec.ts` - 7 CRUD tests: POST 201+Location, GET by key, PATCH merge, DELETE 204, 404 cases
- `apps/test-app/test/expand.e2e-spec.ts` - 4 $expand tests: category expansion, OData envelope, invalid nav prop 400, combined with $filter
- `apps/test-app/test/route-isolation.e2e-spec.ts` - 4 isolation tests: /api/health plain JSON, /odata/Products OData envelope
- `packages/core/src/decorators/odata-controller.decorator.ts` - Removed class-level UseInterceptors/UseFilters
- `packages/core/src/decorators/odata-controller.decorator.spec.ts` - Updated 2 tests to reflect new behavior

## Decisions Made

- `@ODataController` no longer applies `UseInterceptors(ODataResponseInterceptor)` or `UseFilters(ODataExceptionFilter)` at class level. The original design assumed class-level application for convenience, but when each CRUD method decorator also applies the same interceptor, NestJS runs it twice. The first run wraps `ODataQueryResult` into `{ '@odata.context', value }`. The second run processes the already-wrapped response as an `ODataQueryResult`, reading `queryResult.items` which is `undefined`, producing `{ '@odata.context', value: undefined }`. The fix is intentional: per-method decorators own their interceptors.

- `ProductsController` is registered in `ProductsModule` (not `ODataModule.forRoot`) so that `TypeOrmAutoHandler` (provided by `ODataTypeOrmModule.forFeature`) is in scope for DI resolution. The serviceRoot path prefix is applied by patching `PATH_METADATA` at the top of `products.module.ts` before the `@Module` decorator, replicating what `ODataModule.forRoot({ controllers })` would do.

- `$count` method is placed first among route handlers because NestJS matches routes in registration order, and the `:key` wildcard (`@ODataGetByKey`) would otherwise intercept `GET /odata/Products/$count` before the explicit `$count` route.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @ODataController double-wrapping interceptor**

- **Found during:** Task 2 (running e2e tests for the first time)
- **Issue:** `@ODataController` applied `UseInterceptors(ODataResponseInterceptor)` at class level. Each CRUD method decorator also applied it at method level. NestJS ran the interceptor twice: first run correctly produced `{ '@odata.context', value: [...] }`, second run consumed that as an `ODataQueryResult` and produced `{ '@odata.context', value: undefined }`. The existing collection tests in `odata-query.e2e-spec.ts` started failing with "expected false to be true" on `Array.isArray(body.value)`.
- **Fix:** Removed `UseInterceptors(ODataResponseInterceptor)` and `UseFilters(ODataExceptionFilter)` from `@ODataController`. Updated the decorator spec (2 tests) to reflect the new intended behavior.
- **Files modified:** `packages/core/src/decorators/odata-controller.decorator.ts`, `packages/core/src/decorators/odata-controller.decorator.spec.ts`
- **Verification:** All 382 tests pass (220 core, 128 typeorm, 34 e2e)
- **Committed in:** `d4a4d41` (Task 2 commit)

**2. [Rule 1 - Bug] $count route shadowed by :key wildcard**

- **Found during:** Task 2 (odata-query.e2e-spec.ts Test 7 failing with 404)
- **Issue:** `@ODataGetByKey` (`Get(':key')`) was registered before `@Get('$count')` in the controller class. NestJS matched `GET /odata/Products/$count` as `key='$count'`, attempted to find entity with that key, and returned 404.
- **Fix:** Moved the `count` method to appear before `getProduct` in the controller class so the explicit `$count` path is registered first.
- **Files modified:** `apps/test-app/src/products/products.controller.ts`
- **Verification:** Test 7 in odata-query.e2e-spec.ts now passes with 200 + text/plain
- **Committed in:** `d4a4d41` (Task 2 commit)

**3. [Rule 1 - Bug] DI scope: ProductsController cannot be in ODataModule.forRoot**

- **Found during:** Task 1 (structural analysis before writing code)
- **Issue:** The plan suggested passing `ProductsController` to `ODataModule.forRoot({ controllers })`. This registers the controller in `ODataModule`'s DI scope, but `TypeOrmAutoHandler` is provided by `ODataTypeOrmModule.forFeature` which is in `AppModule`'s scope — not visible to `ODataModule`. Would cause a runtime DI error.
- **Fix:** Kept `ProductsController` in `ProductsModule` (which imports `ODataTypeOrmModule.forFeature([Product])`). Applied the PATH_METADATA patching manually at the top of `products.module.ts` using `Reflect.defineMetadata(PATH_METADATA, 'odata/Products', ProductsController)` — equivalent to what `forRoot` would do.
- **Files modified:** `apps/test-app/src/products/products.module.ts`
- **Verification:** All e2e tests pass; controller routes at /odata/Products correctly
- **Committed in:** `82450d5` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All fixes necessary for correctness. The @ODataController fix is the most significant — it changes the intended design of the decorator but aligns it with the actual NestJS interceptor execution model. No scope creep.

## Issues Encountered

- The `pnpm --filter test-app test` command when run from the main repo root uses the main repo's test files (not the worktree). Running from the worktree root (`/Users/carlosber/repos/nestjs-odata/.claude/worktrees/agent-af20d8c4`) ensures the new e2e files are discovered by Vitest.

## Threat Surface Scan

No new network endpoints introduced beyond what the plan specified. All threat model items verified:

| Threat ID | Mitigation Applied                                                                              |
| --------- | ----------------------------------------------------------------------------------------------- |
| T-04-14   | /api/health returns no @odata.context — verified by route-isolation.e2e-spec.ts test            |
| T-04-15   | TypeORM repo.create() as field whitelist — verified by POST test accepting only declared fields |
| T-04-16   | parseODataKey used in CRUD handlers — parameterized queries verified by CRUD test suite         |

## Known Stubs

None — all CRUD operations fully wired to TypeORM. No hardcoded empty values or placeholders.

## Self-Check

- [x] `apps/test-app/src/health/health.controller.ts` — FOUND
- [x] `apps/test-app/src/health/health.module.ts` — FOUND
- [x] `apps/test-app/test/crud.e2e-spec.ts` — FOUND (7 tests)
- [x] `apps/test-app/test/expand.e2e-spec.ts` — FOUND (4 tests)
- [x] `apps/test-app/test/route-isolation.e2e-spec.ts` — FOUND (4 tests)
- [x] `packages/core/src/decorators/odata-controller.decorator.ts` — FOUND (no class-level interceptors)
- [x] Commit `82450d5` — FOUND
- [x] Commit `d4a4d41` — FOUND
- [x] 220 core + 128 typeorm + 34 e2e = 382 total tests pass

## Self-Check: PASSED

---

_Phase: 04-crud-expand-and-module-system_
_Completed: 2026-04-07_
