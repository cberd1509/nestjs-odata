---
phase: '05'
plan: '01'
subsystem: 'batch'
tags: ['odata-batch', 'multipart-mixed', 'typeorm-queryrunner', 'changeset-atomicity']
dependency_graph:
  requires: ['04-01', '04-02']
  provides: ['BATCH-01', 'BATCH-02', 'BATCH-03']
  affects: ['packages/core', 'packages/typeorm', 'apps/test-app']
tech_stack:
  added:
    - 'OData v4 $batch multipart/mixed wire format (Part 1 §11)'
    - 'TypeORM QueryRunner for changeset transactions'
    - 'Custom supertest .parse() helper for multipart/mixed response reading'
  patterns:
    - 'BatchRequest/BatchResponse local interfaces avoid @types/express direct dep'
    - 'manager.findOne + manager.merge + manager.save for transactional PATCH'
    - 'ChangesetOperationError sentinel for transaction rollback trigger'
    - 'postBatch supertest helper with custom parser for multipart response bodies'
key_files:
  created:
    - 'packages/core/src/batch/batch-types.ts'
    - 'packages/core/src/batch/batch-parser.ts'
    - 'packages/core/src/batch/batch-parser.spec.ts'
    - 'packages/core/src/batch/index.ts'
    - 'packages/typeorm/src/batch/batch-controller.ts'
    - 'packages/typeorm/src/batch/batch-controller.spec.ts'
    - 'packages/typeorm/src/batch/batch-response-builder.ts'
    - 'packages/typeorm/src/batch/batch-response-builder.spec.ts'
    - 'packages/typeorm/src/batch/index.ts'
    - 'apps/test-app/test/batch.e2e-spec.ts'
  modified:
    - 'packages/core/src/index.ts'
    - 'packages/typeorm/src/index.ts'
    - 'packages/typeorm/src/odata-typeorm.module.ts'
    - 'apps/test-app/src/app.module.ts'
decisions:
  - 'Used manager.findOne + manager.merge + manager.save instead of repo.preload — preload does not always work correctly with transactional managers'
  - 'BatchRequest/BatchResponse local interfaces defined instead of importing @types/express — adapter package must not require express type dep directly'
  - 'postBatch supertest helper uses .parse() callback to collect raw multipart bytes — supertest does not set res.text for multipart/mixed content-types'
  - "forFeature() patches BatchController PATH_METADATA to serviceRoot only — @Post('$batch') adds the $batch suffix, so double-patching was avoided"
  - 'e2e verification uses slash-key format /odata/Products/id — parenthetical format /odata/Products(id) does not match NestJS :key route param'
metrics:
  duration: '~3 hours (including cross-session context)'
  completed: '2026-04-07'
  tasks_completed: 2
  files_modified: 14
---

# Phase 05 Plan 01: OData $batch Endpoint Summary

OData v4 `$batch` endpoint with multipart/mixed parsing in core, TypeORM QueryRunner-backed changeset atomicity in adapter, and full e2e validation (Tests 7-10).

## Tasks Completed

### Task 1: Core batch types and parser (commit c048b84)

Created `packages/core/src/batch/`:

- `batch-types.ts`: `BatchRequestPart`, `BatchChangesetPart`, `BatchPart` (discriminated union), `ParsedBatch`, `BatchResponsePart`, `BatchResponse`
- `batch-parser.ts`: `extractBoundary()` (regex, throws `ODataValidationError` if missing), `parseBatchBody()` (CRLF normalization, recursive changeset parsing, `MAX_BATCH_OPERATIONS=100` limit)
- `batch-parser.spec.ts`: 13 tests — 5 for `extractBoundary`, 8 for `parseBatchBody`
- Exported from `packages/core/src/index.ts`

### Task 2: TypeORM batch controller and e2e tests (commit ce87fad)

Created `packages/typeorm/src/batch/`:

- `batch-controller.ts`: `BatchController` with `@Post('$batch')` handler, `executeChangeset()` with QueryRunner transactions, `dispatchWithManager()` for GET/POST/PATCH/DELETE routing, `ChangesetOperationError` for rollback signaling
- `batch-controller.spec.ts`: 4 unit tests (Tests 3-6) for GET collection, POST create, PATCH update, DELETE dispatch
- `batch-response-builder.ts`: `buildBatchResponse()` producing multipart/mixed with per-request status lines and unique boundary per response
- `batch-response-builder.spec.ts`: 5 unit tests for format, error status, Content-ID, CRLF, unique boundaries

Updated:

- `packages/typeorm/src/odata-typeorm.module.ts`: `forFeature()` patches `BatchController` PATH_METADATA, registers controller
- `apps/test-app/src/app.module.ts`: passes `serviceRoot` option to `forFeature()`
- `apps/test-app/test/batch.e2e-spec.ts`: Tests 7-10 covering individual GET, changeset success, rollback, and request isolation

## Verification Results

All tests pass:

- `@nestjs-odata/core`: 233 unit tests pass (22 test files)
- `@nestjs-odata/typeorm`: 137 unit tests pass (12 test files)
- `apps/test-app`: 38 e2e tests pass (7 test files)
  - Test 7: POST /$batch individual GET returns multipart response with entity data
  - Test 8: POST /$batch changeset POST+PATCH succeeds and DB reflects changes
  - Test 9: POST /$batch failing changeset rolls back — DB count unchanged
  - Test 10: POST /$batch independent request failure does not affect other requests
- `pnpm build`: 4/4 tasks successful

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Double segment in splitByBoundary**

- **Found during:** Task 1 — RED phase, parser tests failing
- **Issue:** When terminator boundary found, `inSegment` was still `true` after pushing segment, causing post-loop guard to push the same segment again
- **Fix:** Reset `inSegment = false; currentSegment = []` before `break` in terminator branch
- **Files modified:** `packages/core/src/batch/batch-parser.ts`
- **Commit:** c048b84

**2. [Rule 2 - Missing functionality] BatchRequest/BatchResponse local interfaces**

- **Found during:** Task 2 — pre-commit ESLint hook failure
- **Issue:** `import type { Request, Response } from 'express'` resolved as `error` type because `@types/express` is not a direct dependency of the typeorm adapter package
- **Fix:** Defined `BatchRequest` (extends `IncomingMessage`) and `BatchResponse` local interfaces covering only the subset of methods used
- **Files modified:** `packages/typeorm/src/batch/batch-controller.ts`, `packages/typeorm/src/batch/batch-controller.spec.ts`
- **Commit:** ce87fad

**3. [Rule 1 - Bug] PATH_METADATA double-patching**

- **Found during:** Task 2 — route resolving to `/odata/$batch/$batch`
- **Issue:** `forFeature()` patched `BatchController` path to `odata/$batch`, but `@Post('$batch')` also adds `$batch`, resulting in double suffix
- **Fix:** Patch to `root` only (e.g. `'odata'`), letting `@Post('$batch')` add the suffix
- **Files modified:** `packages/typeorm/src/odata-typeorm.module.ts`
- **Commit:** ce87fad

**4. [Rule 1 - Bug] Changeset rollback not triggered**

- **Found during:** Task 2 — Test 9 failing
- **Issue:** `dispatchWithManager` returns `BatchResponsePart` (never throws), so the `try/catch` in `executeChangeset` never caught a failure to trigger rollback
- **Fix:** Added `ChangesetOperationError` class, check `result.statusCode >= 400` inside changeset loop and throw it
- **Files modified:** `packages/typeorm/src/batch/batch-controller.ts`
- **Commit:** ce87fad

**5. [Rule 1 - Bug] Supertest multipart/mixed response body empty**

- **Found during:** Task 2 — all e2e tests failing with `res.text = undefined`, `res.body = {}`
- **Issue:** Supertest parses `multipart/mixed` content-type as JSON, producing `{}`. `res.text` is not set for non-text content types
- **Fix:** Added `postBatch()` helper using `.parse()` callback to collect raw response bytes as a string, and updated `getResponseText()` to handle `res.body` as string
- **Files modified:** `apps/test-app/test/batch.e2e-spec.ts`
- **Commit:** ce87fad

**6. [Rule 1 - Bug] PATCH verification returning 404**

- **Found during:** Task 2 — Test 8 failing on post-batch verification GET
- **Issue:** Test 8 used `/odata/Products(${existingId})` parenthetical format for the verification GET. NestJS route is `/odata/Products/:key` which requires slash format `/odata/Products/2`
- **Fix:** Changed verification GET to use `/odata/Products/${existingId}` slash format
- **Files modified:** `apps/test-app/test/batch.e2e-spec.ts`
- **Commit:** ce87fad

**7. [Rule 1 - Bug] dispatchUpdate using repo.preload on transaction manager**

- **Found during:** Task 2 — investigated PATCH behavior with QueryRunner manager
- **Issue:** `repo.preload()` obtained via `manager.getRepository()` had inconsistent behavior; switching to `manager.findOne()` + `manager.merge()` + `manager.save()` is more explicit and reliable for transactional contexts
- **Fix:** Replaced `repo.preload` + `repo.save` with `manager.findOne` + `manager.merge` + `manager.save`
- **Files modified:** `packages/typeorm/src/batch/batch-controller.ts`, `packages/typeorm/src/batch/batch-controller.spec.ts`
- **Commit:** ce87fad

## Known Stubs

None — all batch operations are fully wired to the TypeORM DataSource.

## Threat Flags

None — all security mitigations from the plan's threat model were applied:

- T-05-01: Boundary validation in `extractBoundary()` throws on missing/invalid boundary
- T-05-02: `MAX_BATCH_OPERATIONS = 100` enforced in `parseBatchBody()`
- T-05-03: URL parsing via regex only in `parseEntityUrl()`, never shell/eval
- T-05-05: All error responses use OData error format via `buildODataError()`, no stack traces

## Self-Check: PASSED

Files verified:

- `packages/core/src/batch/batch-types.ts` — FOUND
- `packages/core/src/batch/batch-parser.ts` — FOUND
- `packages/typeorm/src/batch/batch-controller.ts` — FOUND
- `packages/typeorm/src/batch/batch-response-builder.ts` — FOUND
- `apps/test-app/test/batch.e2e-spec.ts` — FOUND

Commits verified:

- `c048b84` feat(05-01): batch types and multipart/mixed parser for core package — FOUND
- `ce87fad` feat(05-01): batch controller, response builder, and e2e tests for typeorm adapter — FOUND
