---
phase: 05-batch-security-and-v1-hardening
verified: 2026-04-07T19:30:00Z
status: gaps_found
score: 10/12 must-haves verified
gaps:
  - truth: 'pnpm publish --dry-run succeeds for both packages'
    status: partial
    reason: 'publint reports errors for both packages: types field ordering wrong in both; @nestjs-odata/typeorm exports.types points to ./dist/index.d.ts which does not exist (actual files are index.d.cts and index.d.mts)'
    artifacts:
      - path: 'packages/typeorm/package.json'
        issue: 'exports["."].types is ./dist/index.d.ts but file does not exist; correct path should be ./dist/index.d.mts'
      - path: 'packages/core/package.json'
        issue: 'exports["."].types should be first key in exports object (ordering)'
    missing:
      - 'Fix packages/typeorm/package.json: change exports["."].types from ./dist/index.d.ts to ./dist/index.d.mts; also move types key first'
      - 'Fix packages/core/package.json: move types key before import/require in exports["."] object'
  - truth: '@arethetypeswrong/cli reports no entrypoint issues and publint passes for both published packages'
    status: failed
    reason: '@nestjs-odata/typeorm fails attw with "No types" for node10 resolution because exports.types references non-existent ./dist/index.d.ts; @nestjs-odata/core passes attw but fails publint ordering check'
    artifacts:
      - path: 'packages/typeorm/package.json'
        issue: 'exports["."].types = ./dist/index.d.ts but this file is not produced by tsdown (produces index.d.mts and index.d.cts); causes attw UntypedResolution for node10'
    missing:
      - 'Update packages/typeorm/package.json exports to match actual tsdown output: types -> ./dist/index.d.mts'
      - 'Add top-level "types": "./dist/index.d.mts" to packages/typeorm/package.json to match core pattern'
human_verification:
  - test: 'Real npm publish to scoped test registry'
    expected: 'Both packages publish successfully to a test/scoped npm registry with provenance attestation attached'
    why_human: 'Cannot verify actual npm OIDC publish to registry in a CI-free environment; requires live GitHub Actions run against a configured npm OIDC trusted publisher'
---

# Phase 5: $batch, Security, and v1 Hardening Verification Report

**Phase Goal:** The library handles atomic multi-operation batch requests, enforces configurable security limits, and the full CI/CD release pipeline runs end-to-end — from lint through npm publish — producing packages fit for public consumption
**Verified:** 2026-04-07T19:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                               | Status     | Evidence                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | POST /$batch with changeset: operation 3 of 5 fails rolls back operations 1 and 2                   | ✓ VERIFIED | `batch-controller.ts` uses QueryRunner.startTransaction/commitTransaction/rollbackTransaction; Test 9 in `apps/test-app/test/batch.e2e-spec.ts` checks DB count before/after                       |
| 2   | Individual $batch requests outside changesets succeed/fail independently                            | ✓ VERIFIED | Test 10 in `batch.e2e-spec.ts` validates independence; `batch-controller.ts` dispatches non-changeset parts without transaction wrapping                                                           |
| 3   | GET /Products?$top=10000 when maxTop=100 returns HTTP 400 (not silently capped)                     | ✓ VERIFIED | `odata-query.pipe.ts` throws ODataValidationError when `top > effectiveMaxTop`; rejection message: `$top value ${top} exceeds maximum of ${effectiveMaxTop}`                                       |
| 4   | GET with $expand beyond maxExpandDepth returns HTTP 400                                             | ✓ VERIFIED | `expand-visitor.ts` throws ODataValidationError with `$expand depth limit of ${maxExpandDepth} exceeded`; unit tests in expand-visitor.spec.ts Test 4                                              |
| 5   | Full release pipeline runs end-to-end without error (lint -> test -> build -> dry-run publish)      | ✓ VERIFIED | `pnpm turbo build` passes (4/4 tasks); `pnpm publish --dry-run` succeeds for both packages; CI workflow configured with all steps                                                                  |
| 6   | @arethetypeswrong/cli reports no entrypoint issues and publint passes for both packages             | ✗ FAILED   | `attw` shows "No types" for @nestjs-odata/typeorm on node10 (UntypedResolution); publint reports 1-2 errors per package (types ordering; typeorm also has non-existent types path)                 |
| 7   | POST /$batch with multipart/mixed body returns per-operation responses                              | ✓ VERIFIED | `batch-controller.ts` calls `parseBatchBody()` + `buildBatchResponse()`; Test 7 in e2e validates multipart/mixed response                                                                          |
| 8   | Batch response is multipart/mixed with correct boundary markers and per-operation HTTP status codes | ✓ VERIFIED | `batch-response-builder.ts` produces `--{boundary}\r\n...HTTP/1.1 {status}...` format; 5 unit tests in batch-response-builder.spec.ts                                                              |
| 9   | pnpm test --coverage fails if any package drops below 80% statement/branch/function/line coverage   | ✓ VERIFIED | Both `packages/core/vitest.config.ts` and `packages/typeorm/vitest.config.ts` have `thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }`; @vitest/coverage-v8 installed in both |
| 10  | CI workflow runs publint and @arethetypeswrong/cli on every PR                                      | ✓ VERIFIED | `.github/workflows/ci.yml` has validate package exports steps running both tools against both packages                                                                                             |
| 11  | Release workflow publishes to npm with OIDC provenance when changesets PR is merged                 | ✓ VERIFIED | `.github/workflows/release.yml` has `NPM_CONFIG_PROVENANCE: true` on publish step; `id-token: write` permission set; conditional on `steps.changesets.outputs.hasChangesets == 'false'`            |
| 12  | VitePress dev server starts and all v1 features are documented                                      | ✓ VERIFIED | `docs/.vitepress/config.mts` exists with defineConfig + sidebar; `vitepress build` passes (docs build succeeds per SUMMARY); all guide/api pages exist with substantive content (171+ lines each)  |

**Score:** 10/12 truths verified

### Required Artifacts

| Artifact                                               | Expected                                                            | Status     | Details                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/batch/batch-parser.ts`              | Custom multipart/mixed parser with extractBoundary, parseBatchBody  | ✓ VERIFIED | 311 lines; exports both functions; handles CRLF, changesets, Content-ID                                      |
| `packages/core/src/batch/batch-types.ts`               | BatchPart, ParsedBatch, BatchResponse type definitions              | ✓ VERIFIED | Exports BatchRequestPart, BatchChangesetPart, BatchPart union, ParsedBatch, BatchResponsePart, BatchResponse |
| `packages/typeorm/src/batch/batch-controller.ts`       | NestJS controller handling POST /$batch with changeset atomicity    | ✓ VERIFIED | 630 lines; @Post('$batch'); QueryRunner.startTransaction/commitTransaction/rollbackTransaction present       |
| `packages/typeorm/src/batch/batch-response-builder.ts` | Builds multipart/mixed batch response body                          | ✓ VERIFIED | 87 lines; exports buildBatchResponse                                                                         |
| `packages/core/src/query/odata-query.pipe.ts`          | Security limit enforcement — maxTop rejection, per-entity overrides | ✓ VERIFIED | ODataValidationError thrown; effectiveMaxTop from edmRegistry override                                       |
| `packages/typeorm/src/translator/filter-visitor.ts`    | Filter depth tracking and limit enforcement                         | ✓ VERIFIED | currentDepth incremented/decremented per BinaryExpr; maxFilterDepth enforced                                 |
| `packages/typeorm/src/translator/expand-pagination.ts` | Post-JOIN in-memory slicing for $expand $top/$skip                  | ✓ VERIFIED | applyExpandPagination function exists and is called in typeorm-query-translator.ts                           |
| `packages/core/vitest.config.ts`                       | Coverage thresholds 80% all metrics                                 | ✓ VERIFIED | thresholds.statements/branches/functions/lines all = 80                                                      |
| `packages/typeorm/vitest.config.ts`                    | Coverage thresholds 80% all metrics                                 | ✓ VERIFIED | Same as core                                                                                                 |
| `.github/workflows/release.yml`                        | Changesets versioning + npm OIDC publish with provenance            | ✓ VERIFIED | NPM_CONFIG_PROVENANCE=true; id-token: write; hasChangesets conditional                                       |
| `docs/.vitepress/config.mts`                           | VitePress site configuration with sidebar navigation                | ✓ VERIFIED | defineConfig with sidebar groups for /guide/, /api/, /examples/                                              |
| `packages/typeorm/package.json` exports                | exports["."].types = ./dist/index.d.mts                             | ✗ STUB     | Points to ./dist/index.d.ts (does not exist); should be ./dist/index.d.mts                                   |

### Key Link Verification

| From                            | To                            | Via                                                                  | Status      | Details                                                 |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| `batch-controller.ts`           | `batch-parser.ts`             | `parseBatchBody()` call                                              | ✓ WIRED     | Import on line 43; called on line 182                   |
| `batch-controller.ts`           | TypeORM QueryRunner           | `queryRunner.startTransaction/commitTransaction/rollbackTransaction` | ✓ WIRED     | Lines 257-291                                           |
| `odata-query.pipe.ts`           | `odata-validation.error.ts`   | throws ODataValidationError on maxTop violation                      | ✓ WIRED     | Throws with `$top value ${top} exceeds maximum` message |
| `expand-pagination.ts`          | `typeorm-query-translator.ts` | `applyExpandPagination()` called after qb.getMany()                  | ✓ WIRED     | Imported line 16; called lines 116 and 120              |
| `.github/workflows/ci.yml`      | coverage thresholds           | `pnpm turbo test -- --coverage`                                      | ✓ WIRED     | Step "Run tests with coverage" present                  |
| `.github/workflows/release.yml` | npm registry                  | OIDC trusted publishing                                              | ✓ WIRED     | NPM_CONFIG_PROVENANCE + id-token: write configured      |
| `packages/typeorm/package.json` | `./dist/index.d.mts`          | types field in exports                                               | ✗ NOT_WIRED | Points to non-existent ./dist/index.d.ts                |

### Data-Flow Trace (Level 4)

| Artifact               | Data Variable       | Source                                                           | Produces Real Data                            | Status    |
| ---------------------- | ------------------- | ---------------------------------------------------------------- | --------------------------------------------- | --------- |
| `batch-controller.ts`  | `responsePartsList` | `dispatchWithManager()` calls TypeORM DataSource                 | Yes — real DB queries via QueryRunner.manager | ✓ FLOWING |
| `odata-query.pipe.ts`  | `effectiveMaxTop`   | `edmRegistry.getEntitySecurityOptions()` + `this.options.maxTop` | Yes — reads from EdmRegistry (runtime config) | ✓ FLOWING |
| `expand-pagination.ts` | sliced arrays       | `paginationMap` from `ExpandVisitor.expandPaginationMap`         | Yes — populated during expand visitation      | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                        | Command                                                  | Result                                                    | Status |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | ------ |
| pnpm turbo build passes         | `pnpm turbo build`                                       | 4/4 tasks successful                                      | ✓ PASS |
| core package publish dry-run    | `pnpm --filter @nestjs-odata/core publish --dry-run`     | `+ @nestjs-odata/core@0.0.2` (success)                    | ✓ PASS |
| typeorm package publish dry-run | `pnpm --filter @nestjs-odata/typeorm publish --dry-run`  | `+ @nestjs-odata/typeorm@0.0.1` (success)                 | ✓ PASS |
| attw on core                    | `pnpm dlx @arethetypeswrong/cli --pack packages/core`    | All 4 entrypoints green                                   | ✓ PASS |
| attw on typeorm                 | `pnpm dlx @arethetypeswrong/cli --pack packages/typeorm` | node10 = ❌ No types (UntypedResolution)                  | ✗ FAIL |
| publint on core                 | `pnpm dlx publint packages/core`                         | 1 error: types should be first in exports                 | ✗ FAIL |
| publint on typeorm              | `pnpm dlx publint packages/typeorm`                      | 2 errors: types ordering + non-existent ./dist/index.d.ts | ✗ FAIL |
| VitePress build                 | `pnpm turbo build` (docs package)                        | build complete in 5.82s                                   | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan            | Description                                                                 | Status      | Evidence                                                                                        |
| ----------- | ---------------------- | --------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| BATCH-01    | 05-01-PLAN             | $batch endpoint accepting multipart/mixed batch requests                    | ✓ SATISFIED | BatchController @Post('$batch') with parseBatchBody()                                           |
| BATCH-02    | 05-01-PLAN             | Changeset atomicity — all succeed or roll back via QueryRunner transactions | ✓ SATISFIED | executeChangeset() uses QueryRunner; Test 9 e2e verifies rollback                               |
| BATCH-03    | 05-01-PLAN             | Individual requests outside changesets execute independently                | ✓ SATISFIED | Independent dispatch in batch-controller; Test 10 e2e verifies                                  |
| SEC-01      | 05-02-PLAN, 05-03-PLAN | $maxTop config to limit maximum page size (rejection not clamping)          | ✓ SATISFIED | ODataValidationError thrown in odata-query.pipe.ts; verified by tests                           |
| SEC-02      | 05-02-PLAN, 05-03-PLAN | $expand depth limit config                                                  | ✓ SATISFIED | maxExpandDepth enforced in expand-visitor.ts; per-entity override in EdmRegistry                |
| SEC-03      | 05-02-PLAN             | All query-to-SQL uses parameterized queries — no interpolation              | ✓ SATISFIED | Filter visitor uses named params (:p1, :p2); SEC-03 verification test in filter-visitor.spec.ts |
| SEC-04      | 05-02-PLAN             | Query complexity limits to prevent DoS via expensive filter expressions     | ✓ SATISFIED | maxFilterDepth enforced in filter-visitor.ts with currentDepth tracking                         |

### Anti-Patterns Found

| File                                                | Line    | Pattern                                                                                          | Severity   | Impact                                                                                                                                            |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/typeorm/package.json`                     | exports | `"types": "./dist/index.d.ts"` — file does not exist in dist                                     | ✗ Blocker  | `attw` reports UntypedResolution for node10; consumers using TypeScript without moduleResolution=bundler or node16 will not get type declarations |
| `packages/core/package.json`                        | exports | types key is last in exports object (should be first per publint)                                | ⚠️ Warning | TypeScript may not resolve types in all moduleResolution modes                                                                                    |
| `packages/typeorm/src/translator/filter-visitor.ts` | 153     | `// Lambda expressions (any/all) require JOIN-based translation — not implemented in this phase` | ℹ️ Info    | Known deferred feature, not a phase 5 gap                                                                                                         |

### Human Verification Required

### 1. Real npm publish to scoped test registry

**Test:** Configure npm OIDC trusted publishing on npmjs.com for the repository, then trigger the release workflow with a merged changesets PR on GitHub
**Expected:** Both `@nestjs-odata/core` and `@nestjs-odata/typeorm` publish to npm with provenance attestation (verifiable via `npm info @nestjs-odata/core` showing `dist.attestations`)
**Why human:** Cannot verify actual npm OIDC token exchange in a CI-free local environment; requires live GitHub Actions run against a configured npm OIDC trusted publisher entry on npmjs.com

### Gaps Summary

Two gaps found, both rooted in the same root cause: the `package.json` files for both packages have incorrect or suboptimally ordered `exports` type declarations.

**Root cause:** The `@nestjs-odata/typeorm` package.json has `exports["."].types` pointing to `./dist/index.d.ts`, but tsdown produces `index.d.mts` and `index.d.cts` (not `index.d.ts`). This causes `@arethetypeswrong/cli` to report "No types" for node10 resolution mode, directly violating ROADMAP Success Criterion 6.

Additionally, both packages have the `types` field listed last in the exports object instead of first — publint treats this as an error because conditions are evaluated in order and TypeScript needs `types` to come first.

These are two-line fixes per package but they are genuine blockers for SC6 ("@arethetypeswrong/cli reports no entrypoint issues and publint passes").

The batch implementation (BATCH-01, BATCH-02, BATCH-03), security hardening (SEC-01 through SEC-04), coverage thresholds, and CI/CD pipeline are all fully implemented and verified. The documentation site builds cleanly. Only the package exports configuration needs correction.

---

_Verified: 2026-04-07T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
