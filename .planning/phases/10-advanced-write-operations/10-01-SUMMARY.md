---
phase: 10-advanced-write-operations
plan: '01'
subsystem: write-operations
tags:
  - put
  - full-replacement
  - odata-v4
  - typeorm
  - decorator
dependency_graph:
  requires:
    - packages/core/src/decorators/odata-patch.decorator.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - apps/test-app/src/products/products.module.ts
  provides:
    - ODataPut decorator (packages/core)
    - handleReplace() (packages/typeorm)
    - OrdersController + OrdersModule (apps/test-app)
    - dispatchReplace() in BatchController (packages/typeorm)
  affects:
    - packages/typeorm/src/batch/batch-controller.ts
    - apps/test-app/src/app.module.ts
tech_stack:
  added: []
  patterns:
    - column-metadata-driven default construction via repo.metadata.columns
    - separate decorator per OData operation (ODataPut vs ODataPatch flag)
key_files:
  created:
    - packages/core/src/decorators/odata-put.decorator.ts
    - packages/core/src/decorators/odata-put.decorator.spec.ts
    - apps/test-app/src/orders/orders.controller.ts
    - apps/test-app/src/orders/orders.module.ts
    - apps/test-app/test/put-replace.e2e-spec.ts
  modified:
    - packages/core/src/decorators/index.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.spec.ts
    - packages/typeorm/src/batch/batch-controller.ts
    - apps/test-app/src/app.module.ts
decisions:
  - New @ODataPut decorator (not a flag on @ODataPatch) — cleaner per-operation separation, mirrors odata-patch.decorator.ts exactly but uses Put() and operation='replace'
  - repo.metadata.columns used instead of dataSource.getMetadata() — Repository already holds its EntityMetadata reference; no DataSource injection needed in TypeOrmAutoHandler
  - dispatchReplace() added to BatchController — PUT in $batch now uses full-replacement semantics (previously shared PATCH merge branch)
metrics:
  duration: '~40 minutes'
  completed: '2026-04-08'
  tasks: 2
  files: 10
requirements:
  - WRITE-01
---

# Phase 10 Plan 01: PUT Full Entity Replacement Summary

OData v4 PUT full entity replacement implemented: `@ODataPut` decorator in core, `handleReplace()` in TypeOrmAutoHandler using metadata-driven default construction, `dispatchReplace()` in BatchController, and 6 e2e tests proving field reset behavior against the Orders entity set.

## Tasks Completed

| Task | Description                                              | Commit  | Files |
| ---- | -------------------------------------------------------- | ------- | ----- |
| 1    | @ODataPut decorator + handleReplace() unit tests (TDD)   | 4a619a8 | 5     |
| 2    | PUT e2e tests + OrdersController wiring + batch dispatch | b140300 | 5     |

## What Was Built

### @ODataPut decorator (packages/core)

Mirrors `odata-patch.decorator.ts` exactly but uses `Put()` from `@nestjs/common` and sets `operation: 'replace'` in `ODATA_ROUTE_KEY` metadata. Exported from `packages/core/src/decorators/index.ts`.

### handleReplace() (packages/typeorm)

Full OData v4 PUT semantics using `repo.metadata.columns` for column introspection:

- Validates body key matches URL key → 400 on mismatch (T-10-01)
- Finds existing entity → 404 if not found
- Validates ETag If-Match → 412 on mismatch (T-10-04)
- Builds replacement object: body value > column default > null (nullable) > absent (DB default)
- Skips isPrimary, isCreateDate, isUpdateDate, isVersion columns (T-10-03)
- Calls `repo.create(replacement)` + `repo.save()` — TypeORM mass-assignment safe (T-10-02)

Key assumption validated: `ColumnMetadata.default` correctly reflects the TypeScript-side `@Column({ default: 'pending' })` value. Test R2 confirms `status` resets to `'pending'` when omitted from the PUT body.

### OrdersController + OrdersModule (apps/test-app)

Feature module following the ProductsModule pattern. Registers `@ODataPut('Orders')` alongside GET, POST, PATCH, DELETE endpoints. PATH_METADATA patched to `/odata/Orders`.

### dispatchReplace() in BatchController (packages/typeorm)

Previously, `dispatchWithManager` handled `PUT` using `dispatchUpdate()` (merge semantics). Now differentiates: PATCH → `dispatchUpdate()`, PUT → `dispatchReplace()`. The replacement uses `dataSource.getMetadata(entityClass)` for column introspection (DataSource already injected in BatchController).

## Test Results

| Suite                                        | Tests   | Status |
| -------------------------------------------- | ------- | ------ |
| odata-put.decorator.spec.ts                  | 6       | PASS   |
| typeorm-auto-handler.spec.ts (handleReplace) | 6 of 31 | PASS   |
| put-replace.e2e-spec.ts                      | 6       | PASS   |

All 43 tests pass. Build succeeds with no type errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] E2E URL format used parenthetical OData key notation**

- **Found during:** Task 2 e2e test execution
- **Issue:** Tests used `/odata/Orders(1)` URL format; NestJS `:key` route pattern matches `/odata/Orders/1` (slash separator). The parenthetical format is an OData client convention but the NestJS route only handles the slash format for direct HTTP.
- **Fix:** Updated all direct HTTP PUT/GET calls in e2e tests to use slash format (`/odata/Orders/${id}`). The $batch sub-request URL still uses parenthetical format since `parseEntityUrl()` in BatchController parses it with regex.
- **Files modified:** `apps/test-app/test/put-replace.e2e-spec.ts`
- **Commit:** b140300

**2. [Rule 2 - Missing functionality] BatchController PUT used merge semantics**

- **Found during:** Task 2 — reading batch-controller.ts
- **Issue:** `dispatchWithManager` handled `method === 'PATCH' || method === 'PUT'` in the same branch calling `dispatchUpdate()` (merge semantics). PUT in `$batch` would not reset unspecified fields.
- **Fix:** Separated PATCH and PUT branches. Added `dispatchReplace()` for PUT using full-replacement logic with `dataSource.getMetadata()`.
- **Files modified:** `packages/typeorm/src/batch/batch-controller.ts`
- **Commit:** b140300

## Known Stubs

None — all PUT replacement paths are fully wired. The `status` default reset is verified end-to-end by Test 2.

## Threat Flags

No new trust boundaries introduced. All T-10-01 through T-10-04 mitigations implemented as planned.

## Self-Check: PASSED

All created files exist on disk. Both task commits (4a619a8, b140300) exist in git log.
All plan acceptance criteria verified:

- `operation: 'replace'` in odata-put.decorator.ts
- `ODataPut` exported from decorators/index.ts
- `handleReplace` in typeorm-auto-handler.ts
- `metadata.columns` in typeorm-auto-handler.ts
- `@ODataPut` in orders.controller.ts
- `handleReplace` called in orders.controller.ts
- 6 e2e tests in put-replace.e2e-spec.ts, all pass
