---
phase: 04-crud-expand-and-module-system
verified: 2026-04-07T17:10:00Z
status: human_needed
score: 4/5 roadmap success criteria verified (SC5 requires human)
gaps:
  - truth: 'ExpandVisitor records $top/$skip per expand item and applyExpandPagination slices expanded collections (plan 03 must-have)'
    status: failed
    reason: "expand-pagination.ts does not exist, expandPaginationMap is not in expand-visitor.ts, applyExpandPagination is not called from translator. A comment in expand-visitor.ts line 90-91 explicitly says '$top/$skip on $expand items require subqueries — complex for v1. These are intentionally deferred to a later phase.' No later phase in the roadmap claims this feature."
    artifacts:
      - path: 'packages/typeorm/src/translator/expand-visitor.ts'
        issue: 'No expandPaginationMap field; $top/$skip on expand items silently ignored'
      - path: 'packages/typeorm/src/translator/expand-pagination.ts'
        issue: 'File does not exist'
      - path: 'packages/typeorm/src/translator/typeorm-query-translator.ts'
        issue: 'No applyExpandPagination call in execute()'
    missing:
      - 'ExpandPaginationEntry interface and expandPaginationMap field in TypeOrmExpandVisitor'
      - 'expand-pagination.ts with applyExpandPagination function'
      - 'applyExpandPagination wired into TypeOrmQueryTranslator.execute()'
      - 'Tests for expandPaginationMap recording and slicing behavior (expand-visitor.spec.ts currently has 7 tests, plan required 8+ including pagination recording tests)'
  - truth: '@ODataController(Entity) applies Controller prefix, interceptor, and exception filter at class level (plan 02 must-have)'
    status: partial
    reason: 'This was intentionally changed during plan 05 execution to fix a double-wrapping bug. @ODataController now only applies Controller(path) and SetMetadata(ODATA_CONTROLLER_KEY). Interceptors and filters are applied per-method by @ODataGet/@ODataPost/etc. The fix is correct and documented in 04-05-SUMMARY.md, but the plan 02 must-have truth no longer matches the code.'
    artifacts:
      - path: 'packages/core/src/decorators/odata-controller.decorator.ts'
        issue: 'Does not apply UseInterceptors or UseFilters at class level (intentional fix)'
    missing:
      - 'Update plan 02 must-have documentation to reflect actual implemented behavior (informational only — behavior is correct)'
human_verification:
  - test: 'Verify 80%+ code coverage across packages/core and packages/typeorm'
    expected: 'Both packages report >= 80% statement and branch coverage'
    why_human: '@vitest/coverage-v8 is not installed in the workspace. Running pnpm install && pnpm --filter @nestjs-odata/core test -- --coverage && pnpm --filter @nestjs-odata/typeorm test -- --coverage is needed.'
---

# Phase 4: CRUD, $expand, and Module System Verification Report

**Phase Goal:** Library consumers can add @ODataController() to a NestJS module, get full CRUD plus $expand, and mix OData and non-OData routes on the same controller without any serialization leaking
**Verified:** 2026-04-07T17:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| #   | Truth                                                                                                          | Status       | Evidence                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC1 | POST /Products creates entity and returns 201 + Location header + OData JSON body                              | VERIFIED     | crud.e2e-spec.ts line 38: "POST /odata/Products returns 201 + Location header + OData JSON body"; TypeOrmAutoHandler.handleCreate returns {entity, locationUrl}; interceptor sets Location header |
| SC2 | GET /Orders?$expand=Customer returns inlined related entity — exactly one SQL query (no N+1)                   | VERIFIED     | TypeOrmExpandVisitor calls leftJoinAndSelect (one JOIN, one query builder); expand.e2e-spec.ts tests confirm inlined category; no lazy loading                                                    |
| SC3 | GET /api/health returns plain JSON — not wrapped in OData envelope — after ODataModule.forRoot() is registered | VERIFIED     | route-isolation.e2e-spec.ts 4 tests; ODataResponseInterceptor returns next.handle() immediately when ODATA_ROUTE_KEY metadata absent                                                              |
| SC4 | @ODataController + ODataModule.forFeature auto-wires GET/POST/PATCH/DELETE routes                              | VERIFIED     | products.controller.ts uses @ODataController('Products') + all CRUD decorators; PATH_METADATA patched in products.module.ts; 34 e2e tests pass                                                    |
| SC5 | 80%+ code coverage across packages/core and packages/typeorm in CI                                             | HUMAN NEEDED | @vitest/coverage-v8 not installed; cannot verify programmatically                                                                                                                                 |

**Score:** 4/5 roadmap success criteria verified (SC5 human)

### Plan-Level Must-Have Truths

| #   | Truth                                                                                        | Source Plan | Status         | Evidence                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------- | ----------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | $expand=Customer parses into ExpandNode with one ExpandItem                                  | 04-01       | VERIFIED       | parser.ts has parseExpand(); parser.spec.ts 8 tests pass                                                                                                                                                  |
| 2   | parseODataKey('42', ['Id']) returns { Id: 42 }                                               | 04-01       | VERIFIED       | odata-key-parser.ts exported; 8 spec tests pass                                                                                                                                                           |
| 3   | @ODataPost/Patch/Delete/GetByKey compose correct HTTP verb + metadata + interceptor + filter | 04-02       | VERIFIED       | 18 tests in odata-crud-decorators.spec.ts; 5 tests in odata-controller.decorator.spec.ts                                                                                                                  |
| 4   | @ODataController applies Controller prefix, interceptor, exception filter at class level     | 04-02       | DEVIATED (fix) | Interceptor/filter NOT applied at class level — intentional fix to prevent double-wrapping (documented in 04-05-SUMMARY.md). @ODataController only applies Controller(path) + SetMetadata                 |
| 5   | ODataResponseInterceptor returns single entity for isSingleEntity=true                       | 04-02       | VERIFIED       | odata-response.interceptor.ts lines 82-95; interceptor.spec.ts 10 tests pass                                                                                                                              |
| 6   | Non-OData routes pass through interceptor unchanged                                          | 04-02       | VERIFIED       | interceptor line 51: if (!metadata) return next.handle()                                                                                                                                                  |
| 7   | ExpandVisitor calls leftJoinAndSelect for each nav property                                  | 04-03       | VERIFIED       | expand-visitor.ts line 75; expand-visitor.spec.ts 7 tests pass                                                                                                                                            |
| 8   | ExpandVisitor enforces maxExpandDepth and throws ODataValidationError when exceeded          | 04-03       | VERIFIED       | expand-visitor.ts lines 42-48; spec test 4                                                                                                                                                                |
| 9   | ExpandVisitor records $top/$skip per expand item; applyExpandPagination slices results       | 04-03       | FAILED         | expandPaginationMap not present in expand-visitor.ts; expand-pagination.ts does not exist; translator does not call applyExpandPagination                                                                 |
| 10  | handleCreate/Update/Delete/GetByKey CRUD methods on TypeOrmAutoHandler                       | 04-03       | VERIFIED       | All 4 methods present; 16 spec tests pass (tests 8-16)                                                                                                                                                    |
| 11  | ODataQueryPipe validates $expand navigation property names                                   | 04-03       | VERIFIED       | odata-query.pipe.ts has validateExpandNode(); pipe.spec.ts 4 $expand tests                                                                                                                                |
| 12  | ODataTypeOrmModule.forFeature patches @ODataController path with serviceRoot                 | 04-04       | PARTIAL        | Patching implemented in ODataModule.forRoot() — products.controller.ts uses manual Reflect.defineMetadata patching in module file; forRoot controllers array approach works but DI scope issue documented |
| 13  | All e2e CRUD tests pass                                                                      | 04-05       | VERIFIED       | 7 CRUD tests, 4 expand tests, 4 route isolation tests = 34 total e2e tests pass                                                                                                                           |
| 14  | 80%+ coverage (TEST-06)                                                                      | 04-05       | HUMAN NEEDED   | coverage-v8 not installed                                                                                                                                                                                 |

### Required Artifacts

| Artifact                                                     | Status              | Details                                                                                                              |
| ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/parser/ast.ts`                            | VERIFIED            | Contains ExpandItem (line 147) and ExpandNode (line 158) interfaces                                                  |
| `packages/core/src/parser/parser.ts`                         | VERIFIED            | Contains parseExpand function (line 622), $expand= branch (line 525)                                                 |
| `packages/core/src/query/odata-query.types.ts`               | VERIFIED            | expand?: ExpandNode on ODataQuery (line 30)                                                                          |
| `packages/core/src/utils/odata-key-parser.ts`                | VERIFIED            | parseODataKey function exported                                                                                      |
| `packages/core/src/decorators/odata-post.decorator.ts`       | VERIFIED            | ODataPost function exported                                                                                          |
| `packages/core/src/decorators/odata-patch.decorator.ts`      | VERIFIED            | ODataPatch function exported                                                                                         |
| `packages/core/src/decorators/odata-delete.decorator.ts`     | VERIFIED            | ODataDelete function exported                                                                                        |
| `packages/core/src/decorators/odata-get-by-key.decorator.ts` | VERIFIED            | ODataGetByKey function exported                                                                                      |
| `packages/core/src/decorators/odata-controller.decorator.ts` | VERIFIED (deviated) | ODataController exists; does NOT apply class-level interceptor/filter (intentional fix)                              |
| `packages/core/src/decorators/metadata-keys.ts`              | VERIFIED            | ODATA_CONTROLLER_KEY symbol present (line 20)                                                                        |
| `packages/core/src/response/odata-response.interceptor.ts`   | VERIFIED            | isSingleEntity check at line 82; create operation at line 60                                                         |
| `packages/core/src/response/odata-context-url.builder.ts`    | VERIFIED            | isSingleEntity parameter appends /$entity (line 29)                                                                  |
| `packages/typeorm/src/translator/expand-visitor.ts`          | PARTIAL             | TypeOrmExpandVisitor exists with leftJoinAndSelect, depth enforcement, EDM validation; MISSING expandPaginationMap   |
| `packages/typeorm/src/translator/expand-pagination.ts`       | MISSING             | File does not exist; applyExpandPagination not implemented                                                           |
| `packages/typeorm/src/translator/typeorm-auto-handler.ts`    | VERIFIED            | handleGetByKey, handleCreate, handleUpdate, handleDelete all present                                                 |
| `packages/core/src/query/odata-query.pipe.ts`                | VERIFIED            | validateExpandNode method present; expand: parsed.expand in returned ODataQuery                                      |
| `packages/core/src/odata.module.ts`                          | VERIFIED            | ODATA_CONTROLLER_KEY import; PATH_METADATA patching in forRoot() (lines 121-131); controllers array in DynamicModule |
| `apps/test-app/src/health/health.controller.ts`              | VERIFIED            | @Controller('api') with @Get('health')                                                                               |
| `apps/test-app/src/health/health.module.ts`                  | VERIFIED            | HealthModule registering HealthController                                                                            |
| `apps/test-app/test/crud.e2e-spec.ts`                        | VERIFIED            | 7 CRUD tests covering POST/GET/PATCH/DELETE + 404 cases                                                              |
| `apps/test-app/test/expand.e2e-spec.ts`                      | VERIFIED            | 4 $expand tests including invalid nav prop 400                                                                       |
| `apps/test-app/test/route-isolation.e2e-spec.ts`             | VERIFIED            | 4 tests verifying health endpoint has no @odata.context                                                              |

### Key Link Verification

| From                          | To                            | Via                                           | Status    | Details                                                                              |
| ----------------------------- | ----------------------------- | --------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| parser.ts                     | ast.ts                        | import ExpandNode, ExpandItem                 | VERIFIED  | Line 1 of parser.ts imports from ast.ts                                              |
| odata-query.types.ts          | ast.ts                        | import ExpandNode                             | VERIFIED  | expand?: ExpandNode on ODataQuery                                                    |
| odata-controller.decorator.ts | metadata-keys.ts              | ODATA_CONTROLLER_KEY                          | VERIFIED  | Line 2 imports ODATA_CONTROLLER_KEY                                                  |
| typeorm-query-translator.ts   | expand-visitor.ts             | new TypeOrmExpandVisitor()                    | VERIFIED  | Line 67 instantiates TypeOrmExpandVisitor in translate()                             |
| typeorm-query-translator.ts   | expand-pagination.ts          | applyExpandPagination()                       | NOT WIRED | expand-pagination.ts does not exist; translator has no call to applyExpandPagination |
| odata.module.ts               | metadata-keys.ts              | ODATA_CONTROLLER_KEY                          | VERIFIED  | Line 16 imports ODATA_CONTROLLER_KEY for path patching                               |
| products.controller.ts        | @nestjs-odata/core decorators | @ODataController, @ODataGet, @ODataPost, etc. | VERIFIED  | All 6 OData decorators imported and used                                             |
| crud.e2e-spec.ts              | products.controller.ts        | supertest HTTP requests                       | VERIFIED  | Tests hit /odata/Products endpoints                                                  |

### Data-Flow Trace (Level 4)

| Artifact               | Data Variable              | Source                                                     | Produces Real Data                     | Status  |
| ---------------------- | -------------------------- | ---------------------------------------------------------- | -------------------------------------- | ------- |
| products.controller.ts | result from handleCreate   | TypeOrmAutoHandler.handleCreate → repo.create + repo.save  | Yes — TypeORM persists to DB           | FLOWING |
| products.controller.ts | result from handleGetByKey | TypeOrmAutoHandler.handleGetByKey → repo.findOne           | Yes — DB query                         | FLOWING |
| products.controller.ts | result from handleUpdate   | TypeOrmAutoHandler.handleUpdate → repo.preload + repo.save | Yes — DB read+write                    | FLOWING |
| expand-visitor.ts      | leftJoinAndSelect          | TypeORM query builder                                      | Yes — generates SQL JOIN               | FLOWING |
| health.controller.ts   | { status, timestamp }      | Inline static values                                       | Intentionally static (health endpoint) | FLOWING |

### Behavioral Spot-Checks

| Behavior                                                  | Result                                                           | Status |
| --------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| All unit tests pass (220 core + 128 typeorm)              | Both test suites exit 0                                          | PASS   |
| All e2e tests pass (34 tests)                             | All 6 test files pass                                            | PASS   |
| expand-visitor applies leftJoinAndSelect                  | Verified by 7 unit tests + e2e expand tests                      | PASS   |
| CRUD handlers throw NotFoundException on missing entities | Verified by spec tests 9, 14, 16                                 | PASS   |
| intercept passes through non-OData routes                 | Route isolation tests pass; if (!metadata) early return verified | PASS   |
| 80%+ code coverage                                        | Cannot run — @vitest/coverage-v8 not installed                   | SKIP   |

### Requirements Coverage

| Requirement | Source Plan                | Description                                                    | Status      | Evidence                                                                                       |
| ----------- | -------------------------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| CRUD-01     | 04-03, 04-05               | POST — create entity with 201 + Location + created entity      | SATISFIED   | handleCreate returns {entity, locationUrl}; interceptor sets Location; crud.e2e-spec.ts        |
| CRUD-02     | 04-03, 04-05               | PATCH — partial update with OData response                     | SATISFIED   | handleUpdate uses repo.preload (merge-patch) + repo.save; crud.e2e-spec.ts                     |
| CRUD-03     | 04-03, 04-05               | DELETE — 204 No Content                                        | SATISFIED   | handleDelete + HttpCode(204) on @ODataDelete; crud.e2e-spec.ts                                 |
| CRUD-04     | 04-01, 04-02, 04-03, 04-05 | GET by key — single entity by primary key                      | SATISFIED   | handleGetByKey; @ODataGetByKey; isSingleEntity response; crud.e2e-spec.ts                      |
| QUERY-07    | 04-01, 04-03, 04-05        | $expand support for navigation properties                      | SATISFIED   | ExpandNode/ExpandItem AST; TypeOrmExpandVisitor; expand.e2e-spec.ts                            |
| QUERY-08    | 04-03, 04-05               | $expand must use JOINs (no N+1)                                | SATISFIED   | TypeOrmExpandVisitor uses leftJoinAndSelect only; single query verified                        |
| RESP-03     | 04-02, 04-05               | Route-scoped serialization — non-OData routes unaffected       | SATISFIED   | Interceptor checks ODATA_ROUTE_KEY metadata; route-isolation.e2e-spec.ts                       |
| MOD-01      | 04-04                      | ODataModule.forRoot() for global config                        | SATISFIED   | forRoot() extended with controllers array + PATH_METADATA patching                             |
| MOD-02      | 04-04                      | ODataModule.forFeature() for entity registration               | SATISFIED   | Existing forFeature unchanged; verified by e2e tests                                           |
| MOD-03      | 04-02                      | @ODataController class decorator                               | SATISFIED   | odata-controller.decorator.ts exists; note: class-level interceptors removed (intentional fix) |
| MOD-04      | 04-02                      | @ODataGet/@ODataPost/@ODataPatch/@ODataDelete route decorators | SATISFIED   | All 5 CRUD method decorators implemented                                                       |
| MOD-05      | 04-02, 04-05               | OData and non-OData routes coexist without leaking             | SATISFIED   | route-isolation.e2e-spec.ts 4 tests                                                            |
| MOD-06      | 04-04                      | ConfigurableModuleBuilder pattern maintained                   | SATISFIED   | odata.module.ts preserves forRoot/forFeature/forRootAsync                                      |
| TEST-04     | 04-05                      | Integration tests for full HTTP request/response cycle         | SATISFIED   | 34 e2e tests across crud, expand, route-isolation                                              |
| TEST-06     | 04-05                      | 80%+ code coverage                                             | NEEDS HUMAN | @vitest/coverage-v8 not installed — cannot verify                                              |

### Anti-Patterns Found

| File                                              | Line  | Pattern                                                                                                                                 | Severity | Impact                                                                                           |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| packages/typeorm/src/translator/expand-visitor.ts | 90-91 | Deferral comment: "$top/$skip on $expand items require subqueries — complex for v1. These are intentionally deferred to a later phase." | Warning  | $top/$skip within $expand silently ignored; not a runtime error but a silent data truncation gap |

### Human Verification Required

#### 1. Code Coverage Verification (TEST-06 / SC5)

**Test:** Install @vitest/coverage-v8 and run:

```
pnpm add -D @vitest/coverage-v8 --filter @nestjs-odata/core
pnpm add -D @vitest/coverage-v8 --filter @nestjs-odata/typeorm
pnpm --filter @nestjs-odata/core test -- --coverage
pnpm --filter @nestjs-odata/typeorm test -- --coverage
```

**Expected:** Both packages report >= 80% statement coverage and >= 80% branch coverage
**Why human:** @vitest/coverage-v8 is not in the workspace devDependencies. Cannot install or run coverage without modifying the project.

### Gaps Summary

**Two gaps found:**

1. **$top/$skip within $expand (plan 03 must-have):** The plan explicitly required `expandPaginationMap`, `applyExpandPagination`, and a post-query slicer for honoring `$top`/`$skip` on individual `$expand` items. None of these were implemented. The expand-visitor.ts has a comment explicitly deferring this to "a later phase" but no later milestone phase claims ownership. This means `GET /Products?$expand=Orders($top=3)` will return ALL orders rather than only 3. This is a silent data truncation bug — no error, just wrong data — affecting D-08 compliance.

2. **@ODataController class-level interceptor (plan 02 must-have deviated):** The must-have stated @ODataController would apply interceptors at class level. This was intentionally changed to per-method during plan 05 to fix a double-wrapping bug. The fix was correct and documented, but the plan-level must-have is now stale. The behavior is correct; the documentation discrepancy is informational.

The expand pagination gap does not block Phase 4's roadmap success criteria (none of the 5 SC explicitly mention $top/$skip within $expand). However it means library consumers using nested $top/$skip within $expand will silently get wrong results. This should be addressed in Phase 5 or a targeted gap-closure plan.

---

_Verified: 2026-04-07T17:10:00Z_
_Verifier: Claude (gsd-verifier)_
