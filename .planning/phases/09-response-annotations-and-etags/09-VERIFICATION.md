---
phase: 09-response-annotations-and-etags
verified: 2026-04-08T15:22:25Z
status: gaps_found
score: 8/9 must-haves verified
gaps:
  - truth: 'GET /Products(1) with If-Match stale ETag returns 412 AND GET /Products returns @odata.etag per item with ETag header (ROADMAP SC #2 vs SC #3 scope)'
    status: partial
    reason: "Build artifacts were stale at initial verification. After forcing pnpm --filter @nestjs-odata/core build and pnpm --filter @nestjs-odata/typeorm build, all 161 e2e tests pass including all ETag tests. The stale dist means consumers could hit broken behavior if they pull source without rebuilding. ROADMAP SC #2 says 'GET /Products returns an ETag response header' — collection-level ETag header is not implemented; only single-entity GET adds the ETag header. This may be intentional per OData spec (ETags are per-entity), but creates ambiguity against the ROADMAP wording."
    artifacts:
      - path: 'packages/core/dist/index.cjs'
        issue: 'Dist was stale — did not include ODataETag, getETagProperty, IETagProvider, ETAG_PROVIDER. 3 typeorm unit tests and 4 e2e tests failed before rebuild.'
      - path: 'packages/typeorm/dist/index.cjs'
        issue: 'Dist was stale — TypeOrmETagProvider was missing from the built artifact, causing ETag logic to be silently skipped in e2e tests.'
    missing:
      - 'Run pnpm build at phase completion to ensure dist artifacts reflect the final source code'
      - "Clarify ROADMAP SC #2: 'GET /Products' — does this mean collection-level ETag header (not implemented) or single-entity ETag (implemented and passing)?"
---

# Phase 9: Response Annotations and ETags Verification Report

**Phase Goal:** Every entity response carries OData-required metadata annotations, and the server enforces ETag-based concurrency control so clients can perform optimistic locking
**Verified:** 2026-04-08T15:22:25Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                     | Status                   | Evidence                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GET /Products(1) response body contains @odata.id with canonical URL                      | VERIFIED                 | `annotateEntity()` wired into interceptor; e2e test "GET /odata/Products/:id returns @odata.id, @odata.type annotations" passes                   |
| 2   | GET /Products(1) response body contains @odata.type with #Namespace.EntityType            | VERIFIED                 | `annotateEntity()` builds `#${namespace}.${entityType.name}`; tested in 9 unit tests + e2e                                                        |
| 3   | GET /Products(1) response body contains @odata.navigationLink for each nav property       | VERIFIED                 | `annotateEntity()` adds `${navProp.name}@odata.navigationLink`; unit tests cover nav props                                                        |
| 4   | GET /Products collection items each contain @odata.id, @odata.type, @odata.navigationLink | VERIFIED                 | `annotateEntities()` applied to collection `value[]` in interceptor; e2e "GET /odata/Products returns annotations on each collection item" passes |
| 5   | Non-OData routes remain completely unaffected                                             | VERIFIED                 | `ODataResponseInterceptor` gates on `ODATA_ROUTE_KEY` metadata; route-isolation e2e spec passes (4 tests)                                         |
| 6   | GET /Products(1) response includes ETag header and @odata.etag in body                    | VERIFIED (after rebuild) | `handleGetByKey` attaches `__etag`, interceptor sets ETag header and adds `@odata.etag`; e2e test passes after dist rebuild                       |
| 7   | PATCH /Products(1) with stale If-Match returns 412 Precondition Failed                    | VERIFIED (after rebuild) | `handleUpdate` validates If-Match, throws HttpException 412; e2e test passes after dist rebuild                                                   |
| 8   | PATCH /Products(1) with current If-Match succeeds and returns updated entity              | VERIFIED                 | e2e "PATCH with current If-Match succeeds" passes                                                                                                 |
| 9   | GET /Products(1) with If-None-Match matching current ETag returns 304                     | VERIFIED (after rebuild) | Interceptor handles `__notModified` signal, calls `response.status(304).end()`; e2e test passes after dist rebuild                                |

**Score:** 9/9 truths verified (but stale dist was a blocking issue requiring manual rebuild)

**Critical Build Issue:** 4 e2e tests and 3 unit tests FAILED at initial verification because the core and typeorm dist artifacts were stale — source had the ETag implementation but dist did not. Tests only passed after running:

- `pnpm --filter @nestjs-odata/core build`
- `pnpm --filter @nestjs-odata/typeorm build`

This means the phase was not self-consistently delivered: someone checking out and running `pnpm test` without a fresh build would see failures.

### Deferred Items

No items identified as deferred to later phases.

### Required Artifacts

| Artifact                                                      | Expected                                        | Status   | Details                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `packages/core/src/response/odata-annotation.builder.ts`      | Pure function adding OData annotations          | VERIFIED | Exports `annotateEntity`, `annotateEntities`, `AnnotationContext`; 113 lines, substantive |
| `packages/core/src/response/odata-annotation.builder.spec.ts` | Unit tests for annotation builder               | VERIFIED | 9 test cases covering all key formats, nav links, collection, immutability                |
| `packages/core/src/decorators/odata-etag.decorator.ts`        | @ODataETag decorator with getETagProperty       | VERIFIED | Exports `ODataETag`, `getETagProperty`; uses reflect-metadata                             |
| `packages/core/src/interfaces/etag.interface.ts`              | IETagProvider interface and ETAG_PROVIDER token | VERIFIED | Exports `IETagProvider`, `ETAG_PROVIDER`; zero ORM imports                                |
| `packages/typeorm/src/etag/typeorm-etag.provider.ts`          | TypeORM implementation of IETagProvider         | VERIFIED | Exports `TypeOrmETagProvider`; discovers @UpdateDateColumn, caches results                |
| `apps/test-app/test/odata-etag.e2e-spec.ts`                   | E2E tests for ETag concurrency control          | VERIFIED | 10 test cases; all pass after dist rebuild                                                |

### Key Link Verification

| From                                       | To                            | Via                                               | Status | Details                                                                                       |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `odata-response.interceptor.ts`            | `odata-annotation.builder.ts` | `import annotateEntity, annotateEntities`         | WIRED  | Import at line 9-10; called in map() for single, create, and collection responses             |
| `odata-response.interceptor.ts`            | `edm/edm-registry.ts`         | EdmRegistry injected as 3rd constructor param     | WIRED  | Constructor at line 44-48 injects EdmRegistry; resolveAnnotationContext() uses it             |
| `odata-response.interceptor.ts`            | `etag.interface.ts`           | IETagProvider via ETAG_PROVIDER token (@Optional) | WIRED  | Line 116-153 handles `__notModified` and `__etag` signals                                     |
| `typeorm-auto-handler.ts`                  | `etag.interface.ts`           | `@Optional() @Inject(ETAG_PROVIDER)`              | WIRED  | Line 35 — etagProvider optional injection; used in handleGetByKey, handleUpdate, handleDelete |
| `typeorm-etag.provider.ts`                 | TypeORM DataSource metadata   | `meta.columns.find(c => c.isUpdateDate)`          | WIRED  | Line 100 — reflects real TypeORM metadata                                                     |
| `packages/core/src/response/index.ts`      | `odata-annotation.builder.ts` | export annotateEntity, annotateEntities           | WIRED  | Lines 2-3 of index.ts                                                                         |
| `packages/core/src/decorators/index.ts`    | `odata-etag.decorator.ts`     | export ODataETag, getETagProperty                 | WIRED  | Line 14 of decorators/index.ts                                                                |
| `packages/core/src/interfaces/index.ts`    | `etag.interface.ts`           | export IETagProvider, ETAG_PROVIDER               | WIRED  | Lines 5-6 of interfaces/index.ts                                                              |
| `odata-typeorm.module.ts`                  | `TypeOrmETagProvider`         | registers as ETAG_PROVIDER symbol                 | WIRED  | Lines 142-150 — provides TypeOrmETagProvider and aliases to ETAG_PROVIDER token               |
| `packages/typeorm/src/index.ts`            | `typeorm-etag.provider.ts`    | export TypeOrmETagProvider                        | WIRED  | Line 6: `export * from './etag/typeorm-etag.provider.js'`                                     |
| `apps/test-app/entities/product.entity.ts` | TypeORM UpdateDateColumn      | `@UpdateDateColumn() updatedAt: Date`             | WIRED  | Line 35-36 — enables ETag on Product entity                                                   |

### Data-Flow Trace (Level 4)

| Artifact                        | Data Variable            | Source                             | Produces Real Data                    | Status  |
| ------------------------------- | ------------------------ | ---------------------------------- | ------------------------------------- | ------- |
| `odata-annotation.builder.ts`   | `entity` (input)         | Passed from interceptor            | Yes — entity from DB via TypeORM      | FLOWING |
| `typeorm-etag.provider.ts`      | `etagColumn`             | TypeORM `meta.columns` reflection  | Yes — reads actual DB column metadata | FLOWING |
| `typeorm-etag.provider.ts`      | `etag` via `computeETag` | Entity's `updatedAt` value from DB | Yes — base64 of real timestamp        | FLOWING |
| `odata-response.interceptor.ts` | `__etag` → `@odata.etag` | `handleGetByKey` attaches `__etag` | Yes — flows from real DB entity       | FLOWING |

### Behavioral Spot-Checks

| Behavior                                        | Command                                               | Result                             | Status |
| ----------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | ------ |
| annotateEntity() produces @odata.id             | `pnpm --filter @nestjs-odata/core exec vitest run`    | 9/9 annotation builder tests pass  | PASS   |
| ODataETag decorator stores metadata             | `pnpm --filter @nestjs-odata/core exec vitest run`    | 2/2 decorator tests pass           | PASS   |
| TypeOrmETagProvider discovers @UpdateDateColumn | `pnpm --filter @nestjs-odata/typeorm exec vitest run` | 218/218 pass (after core rebuild)  | PASS   |
| If-Match 412 enforcement (e2e)                  | `pnpm --filter test-app exec vitest run`              | 161/161 pass (after both rebuilds) | PASS   |
| If-None-Match 304 response (e2e)                | same                                                  | same                               | PASS   |
| Full test suite no regressions                  | `pnpm --filter test-app exec vitest run`              | All 161 e2e tests pass             | PASS   |

**Note:** All behavioral spot-checks require running builds first. Without `pnpm build`, unit tests fail in the typeorm package and e2e tests fail in test-app.

### Requirements Coverage

| Requirement | Source Plan   | Description                                                            | Status    | Evidence                                                                                                  |
| ----------- | ------------- | ---------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| RESP-04     | 09-01-PLAN.md | `@odata.id` annotation on every entity response (canonical URL)        | SATISFIED | `annotateEntity()` adds `@odata.id`; wired in interceptor for single, create, and collection responses    |
| RESP-05     | 09-01-PLAN.md | `@odata.type` annotation on entity responses (`#Namespace.EntityType`) | SATISFIED | `annotateEntity()` adds `@odata.type`; uses `options.namespace` from ODataModuleResolvedOptions           |
| RESP-06     | 09-01-PLAN.md | `@odata.navigationLink` for each navigation property                   | SATISFIED | `annotateEntity()` iterates `entityType.navigationProperties`, adds `{navProp.name}@odata.navigationLink` |
| ETAG-01     | 09-02-PLAN.md | ETag generation from entity version/timestamp column                   | SATISFIED | `TypeOrmETagProvider.computeETag()` generates `W/"base64(value)"`; auto-discovers @UpdateDateColumn       |
| ETAG-02     | 09-02-PLAN.md | `If-Match` header enforcement on PATCH/PUT/DELETE (412 on mismatch)    | SATISFIED | `handleUpdate()` and `handleDelete()` validate If-Match, throw HttpException 412 on mismatch              |
| ETAG-03     | 09-02-PLAN.md | `If-None-Match` header on GET (304 Not Modified for cache validation)  | SATISFIED | `handleGetByKey()` returns `{ __notModified: true }` signal; interceptor sends 304                        |

All 6 phase requirements are satisfied. No orphaned requirements found (REQUIREMENTS.md maps RESP-04, RESP-05, RESP-06, ETAG-01, ETAG-02, ETAG-03 to Phase 9, all claimed by the two plans).

### Anti-Patterns Found

| File                              | Line | Pattern                                                         | Severity | Impact                                                             |
| --------------------------------- | ---- | --------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `packages/core/dist/index.cjs`    | —    | Stale build artifact — ETag exports absent until rebuild        | WARNING  | 3 typeorm unit tests and 4 e2e tests fail without explicit rebuild |
| `packages/typeorm/dist/index.cjs` | —    | Stale build artifact — TypeOrmETagProvider absent until rebuild | WARNING  | ETag logic silently disabled in e2e tests without rebuild          |

No TODO/FIXME/placeholder comments found. No empty implementations. No hardcoded empty data. No console.log in production code paths.

### Human Verification Required

#### 1. ROADMAP SC #2 — Scope Ambiguity

**Test:** GET /odata/Products (collection) and inspect HTTP response headers.
**Expected (per ROADMAP):** Response should include `ETag` header.
**Expected (per OData spec):** Collection responses typically do NOT carry a single ETag header — only individual entity responses do. ETags on collection responses would represent the collection state, which is not implemented.
**Why human:** The ROADMAP SC says "GET /Products returns an ETag response header" but the implementation only sets ETag on GET by single-key (`GET /Products/:id`). The e2e tests verify single-entity ETag. The collection response e2e test explicitly asserts `@odata.etag` is NOT present at root level. Determining whether the ROADMAP SC intended collection-level or single-entity-level ETag requires product decision.

#### 2. Per-Item @odata.etag in Collection Responses

**Test:** GET /odata/Products, inspect each item in `value[]` for `@odata.etag` property.
**Expected (ambiguous):** OData v4 spec allows `@odata.etag` on each entity in a collection response. The current implementation does NOT add `@odata.etag` to collection items (only `@odata.id`, `@odata.type`, `@odata.navigationLink`).
**Why human:** This is a spec interpretation question — whether collection items should carry `@odata.etag`. The current implementation is coherent but may not be fully spec-compliant for collection ETags.

### Gaps Summary

**One critical build issue:** The phase was completed with source code but both `packages/core` and `packages/typeorm` dist artifacts were not rebuilt. This caused:

- 3 unit test failures in typeorm (functions not exported from stale core dist)
- 4 e2e test failures in test-app (ETag logic silently skipped because stale typeorm dist had no TypeOrmETagProvider)

After running `pnpm --filter @nestjs-odata/core build && pnpm --filter @nestjs-odata/typeorm build`, all 262 core tests, 218 typeorm tests, and 161 e2e tests pass.

**Action required:** The SUMMARY.md claims "262 core package tests pass, 218 typeorm tests pass, 161 test-app e2e tests pass" but at the time of verification the dist was stale. Either the build step was run and then the dist was somehow not committed/updated, or the SUMMARY counts were recorded from a previous build. The phase should include an explicit build step at completion.

**Structural question:** ROADMAP SC #2 mentions "GET /Products returns ETag response header" — the implementation adds ETag only on single-entity GET, not on collection GET. This may be intentional (correct per OData spec) or a gap. Human verification needed.

---

_Verified: 2026-04-08T15:22:25Z_
_Verifier: Claude (gsd-verifier)_
