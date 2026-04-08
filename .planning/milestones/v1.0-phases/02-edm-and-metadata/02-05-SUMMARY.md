---
phase: 02-edm-and-metadata
plan: 05
subsystem: test-app/metadata-validation
tags: [odata2ts, csdl, validation, e2e, gap-closure, bug-fix]
dependency_graph:
  requires: [02-04]
  provides: [TEST-05]
  affects: [packages/typeorm/src/deriver]
tech_stack:
  added: ['@odata2ts/odata2ts@^0.40.1']
  patterns: ['execSync child process in e2e test', 'temp file lifecycle in afterAll']
key_files:
  created:
    - apps/test-app/test/odata2ts-validation.e2e-spec.ts
  modified:
    - apps/test-app/package.json
    - packages/typeorm/src/deriver/typeorm-edm-deriver.ts
    - pnpm-lock.yaml
decisions:
  - 'Pass JS constructor as designType to mapColumnTypeToEdm when col.type is a function'
  - 'Use execSync with 30s timeout for odata2ts CLI; overall test timeout 60s'
  - 'Temp file cleanup in afterAll using rmSync with force:true'
metrics:
  duration: ~20min
  completed: 2026-04-07
  tasks_completed: 1
  files_modified: 4
---

# Phase 02 Plan 05: odata2ts CSDL Validation (TEST-05 Gap Closure) Summary

**One-liner:** E2e test validates $metadata CSDL XML through odata2ts CLI after fixing JS-constructor column type mapping in the TypeORM EDM deriver.

## What Was Built

Added `@odata2ts/odata2ts@^0.40.1` to `apps/test-app` devDependencies and created `apps/test-app/test/odata2ts-validation.e2e-spec.ts`. The test:

1. Boots the NestJS test app (same `beforeAll`/`afterAll` pattern as `metadata.e2e-spec.ts`)
2. `GET /odata/$metadata` via supertest, captures CSDL XML
3. Writes XML to `os.tmpdir()` temp file
4. Runs `npx odata2ts -s <tmpFile> -o <tmpOutputDir>` via `execSync` with 30s timeout
5. Asserts exit 0 (any non-zero exit from odata2ts throws and fails the test)
6. Cleans up temp file and output dir in `afterAll`

This closes TEST-05: the ROADMAP success criterion "generated CSDL XML passes odata2ts validation in CI with zero errors" is now enforced automatically since `pnpm --filter test-app test` already runs in CI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed JS-constructor column type mapping in TypeOrmEdmDeriver**

- **Found during:** Task 1 verification — odata2ts exited non-zero with `Error: Key with name [id] not found in props!`
- **Issue:** TypeORM `PrimaryGeneratedColumn()` sets `col.type` to the JS `Number` constructor function (not a string). The deriver extracted `col.type.name` as the columnType string (`"Number"` capitalized) and passed `undefined` as the `designType` to `mapColumnTypeToEdm`. `"Number"` is not in `COLUMN_TYPE_MAP`, no designType fallback triggered, and the `'skip'` strategy returned `undefined` — silently omitting the `id` property from all entity types. The `<Key><PropertyRef Name="id"/></Key>` referenced a property that did not exist in the properties list, producing invalid CSDL XML.
- **Fix:** When `col.type` is a function (constructor), pass it as the `designType` argument and use empty string as the `columnType`. `mapColumnTypeToEdm` already has the `if (designType === Number) return 'Edm.Int32'` fallback — it just wasn't being reached.
- **Files modified:** `packages/typeorm/src/deriver/typeorm-edm-deriver.ts`
- **Commit:** bcc97ba

**Impact of the bug fix:** All 6 entity types now correctly emit their `id` property as `Edm.Int32`, FK columns like `categoryId`, `customerId`, `orderId`, `productId` also appear correctly. The CSDL XML is now complete and odata2ts validates it with zero errors.

## Test Results

```
Test Files  2 passed (2)
     Tests  9 passed (9)
  Start at  12:05:02
  Duration  2.72s
```

- `test/metadata.e2e-spec.ts` — 8 tests (pre-existing, still pass)
- `test/odata2ts-validation.e2e-spec.ts` — 1 test (new, passes)

## Known Stubs

None — all data flows correctly.

## Threat Flags

No new security surface introduced. The `execSync` runs a locally installed devDependency (`npx odata2ts`) against a temp file containing generated CSDL XML (no secrets, no user input). Accepted per T-02-05-02 in plan threat model.

## Self-Check

- [x] `apps/test-app/test/odata2ts-validation.e2e-spec.ts` exists
- [x] `grep "@odata2ts/odata2ts" apps/test-app/package.json` returns `"@odata2ts/odata2ts": "^0.40.1"`
- [x] Commit bcc97ba exists
- [x] All 9 tests pass

## Self-Check: PASSED
