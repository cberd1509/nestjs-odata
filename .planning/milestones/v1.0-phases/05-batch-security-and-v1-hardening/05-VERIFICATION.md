---
phase: 05-batch-security-and-v1-hardening
verified: 2026-04-07T20:00:00Z
status: human_needed
score: 12/12 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 10/12
  gaps_closed:
    - 'packages/typeorm/package.json exports["."].types pointed to non-existent ./dist/index.d.ts — fixed to split-condition per-format types (import.types = ./dist/index.d.mts, require.types = ./dist/index.d.cts)'
    - 'packages/core/package.json exports["."] had types as last key — fixed with split-condition pattern where types is correctly scoped per condition'
  gaps_remaining: []
  regressions: []
human_verification:
  - test: 'Real npm publish to scoped test registry'
    expected: 'Both packages publish successfully to npmjs.com with provenance attestation attached (visible via npm info @nestjs-odata/core showing dist.attestations)'
    why_human: 'Cannot verify actual npm OIDC token exchange in a CI-free local environment; requires live GitHub Actions run against a configured npm OIDC trusted publisher entry on npmjs.com'
---

# Phase 5: $batch, Security, and v1 Hardening Verification Report

**Phase Goal:** The library handles atomic multi-operation batch requests, enforces configurable security limits, and the full CI/CD release pipeline runs end-to-end — from lint through npm publish — producing packages fit for public consumption
**Verified:** 2026-04-07T20:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 05-05 fixed package.json exports)

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                               | Status     | Evidence                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | POST /$batch with changeset: operation 3 of 5 fails rolls back operations 1 and 2                   | ✓ VERIFIED | `batch-controller.ts` uses QueryRunner.startTransaction/commitTransaction/rollbackTransaction; Test 9 in `apps/test-app/test/batch.e2e-spec.ts` checks DB count before/after                       |
| 2   | Individual $batch requests outside changesets succeed/fail independently                            | ✓ VERIFIED | Test 10 in `batch.e2e-spec.ts` validates independence; `batch-controller.ts` dispatches non-changeset parts without transaction wrapping                                                           |
| 3   | GET /Products?$top=10000 when maxTop=100 returns HTTP 400 (not silently capped)                     | ✓ VERIFIED | `odata-query.pipe.ts` throws ODataValidationError when `top > effectiveMaxTop`; rejection message: `$top value ${top} exceeds maximum of ${effectiveMaxTop}`                                       |
| 4   | GET with $expand beyond maxExpandDepth returns HTTP 400                                             | ✓ VERIFIED | `expand-visitor.ts` throws ODataValidationError with `$expand depth limit of ${maxExpandDepth} exceeded`; unit tests in expand-visitor.spec.ts                                                     |
| 5   | Full release pipeline runs end-to-end without error (lint -> test -> build -> dry-run publish)      | ✓ VERIFIED | `pnpm turbo build` passes (4/4 tasks); CI workflow configured with all steps                                                                                                                       |
| 6   | @arethetypeswrong/cli reports no entrypoint issues and publint passes for both packages             | ✓ VERIFIED | Both packages pass publint (exit 0, zero errors) and attw (exit 0, all 4 resolution modes green: node10, node16 CJS, node16 ESM, bundler) after 05-05 gap closure                                  |
| 7   | POST /$batch with multipart/mixed body returns per-operation responses                              | ✓ VERIFIED | `batch-controller.ts` calls `parseBatchBody()` + `buildBatchResponse()`; Test 7 in e2e validates multipart/mixed response                                                                          |
| 8   | Batch response is multipart/mixed with correct boundary markers and per-operation HTTP status codes | ✓ VERIFIED | `batch-response-builder.ts` produces `--{boundary}\r\n...HTTP/1.1 {status}...` format; 5 unit tests in batch-response-builder.spec.ts                                                              |
| 9   | pnpm test --coverage fails if any package drops below 80% statement/branch/function/line coverage   | ✓ VERIFIED | Both `packages/core/vitest.config.ts` and `packages/typeorm/vitest.config.ts` have `thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }`; @vitest/coverage-v8 installed in both |
| 10  | CI workflow runs publint and @arethetypeswrong/cli on every PR                                      | ✓ VERIFIED | `.github/workflows/ci.yml` has validate package exports steps running both tools against both packages                                                                                             |
| 11  | Release workflow publishes to npm with OIDC provenance when changesets PR is merged                 | ✓ VERIFIED | `.github/workflows/release.yml` has `NPM_CONFIG_PROVENANCE: true` on publish step; `id-token: write` permission set; conditional on `steps.changesets.outputs.hasChangesets == 'false'`            |
| 12  | VitePress dev server starts and all v1 features are documented                                      | ✓ VERIFIED | `docs/.vitepress/config.mts` exists with defineConfig + sidebar; vitepress build passes; all guide/api pages exist with substantive content                                                        |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact                                               | Expected                                                            | Status     | Details                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/batch/batch-parser.ts`              | Custom multipart/mixed parser with extractBoundary, parseBatchBody  | ✓ VERIFIED | 311 lines; exports both functions; handles CRLF, changesets, Content-ID                                      |
| `packages/core/src/batch/batch-types.ts`               | BatchPart, ParsedBatch, BatchResponse type definitions              | ✓ VERIFIED | Exports BatchRequestPart, BatchChangesetPart, BatchPart union, ParsedBatch, BatchResponsePart, BatchResponse |
| `packages/typeorm/src/batch/batch-controller.ts`       | NestJS controller handling POST /$batch with changeset atomicity    | ✓ VERIFIED | @Post('$batch'); QueryRunner.startTransaction/commitTransaction/rollbackTransaction present                  |
| `packages/typeorm/src/batch/batch-response-builder.ts` | Builds multipart/mixed batch response body                          | ✓ VERIFIED | Exports buildBatchResponse                                                                                   |
| `packages/core/src/query/odata-query.pipe.ts`          | Security limit enforcement — maxTop rejection, per-entity overrides | ✓ VERIFIED | ODataValidationError thrown; effectiveMaxTop from edmRegistry override                                       |
| `packages/typeorm/src/translator/filter-visitor.ts`    | Filter depth tracking and limit enforcement                         | ✓ VERIFIED | currentDepth incremented/decremented per BinaryExpr; maxFilterDepth enforced                                 |
| `packages/typeorm/src/translator/expand-pagination.ts` | Post-JOIN in-memory slicing for $expand $top/$skip                  | ✓ VERIFIED | applyExpandPagination function exists and is called in typeorm-query-translator.ts                           |
| `packages/core/vitest.config.ts`                       | Coverage thresholds 80% all metrics                                 | ✓ VERIFIED | thresholds.statements/branches/functions/lines all = 80                                                      |
| `packages/typeorm/vitest.config.ts`                    | Coverage thresholds 80% all metrics                                 | ✓ VERIFIED | Same as core                                                                                                 |
| `.github/workflows/release.yml`                        | Changesets versioning + npm OIDC publish with provenance            | ✓ VERIFIED | NPM_CONFIG_PROVENANCE=true; id-token: write; hasChangesets conditional                                       |
| `docs/.vitepress/config.mts`                           | VitePress site configuration with sidebar navigation                | ✓ VERIFIED | defineConfig with sidebar groups for /guide/, /api/, /examples/                                              |
| `packages/core/package.json` exports                   | Split-condition exports with types scoped per format                | ✓ VERIFIED | import.types = ./dist/index.d.mts; require.types = ./dist/index.d.cts; publint exit 0; attw all green        |
| `packages/typeorm/package.json` exports                | exports types pointing to actual tsdown output (index.d.mts)        | ✓ VERIFIED | import.types = ./dist/index.d.mts; require.types = ./dist/index.d.cts; publint exit 0; attw all green        |

### Key Link Verification

| From                            | To                            | Via                                                                  | Status  | Details                                                 |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| `batch-controller.ts`           | `batch-parser.ts`             | `parseBatchBody()` call                                              | ✓ WIRED | Import present; called in POST handler                  |
| `batch-controller.ts`           | TypeORM QueryRunner           | `queryRunner.startTransaction/commitTransaction/rollbackTransaction` | ✓ WIRED | Present in executeChangeset()                           |
| `odata-query.pipe.ts`           | `odata-validation.error.ts`   | throws ODataValidationError on maxTop violation                      | ✓ WIRED | Throws with `$top value ${top} exceeds maximum` message |
| `expand-pagination.ts`          | `typeorm-query-translator.ts` | `applyExpandPagination()` called after qb.getMany()                  | ✓ WIRED | Imported and called after getMany()/getManyAndCount()   |
| `.github/workflows/ci.yml`      | coverage thresholds           | `pnpm turbo test -- --coverage`                                      | ✓ WIRED | Step "Run tests with coverage" present                  |
| `.github/workflows/release.yml` | npm registry                  | OIDC trusted publishing                                              | ✓ WIRED | NPM_CONFIG_PROVENANCE + id-token: write configured      |
| `packages/core/package.json`    | `./dist/index.d.mts`          | import.types in exports                                              | ✓ WIRED | Split-condition: import.types = ./dist/index.d.mts      |
| `packages/typeorm/package.json` | `./dist/index.d.mts`          | import.types in exports                                              | ✓ WIRED | Split-condition: import.types = ./dist/index.d.mts      |

### Data-Flow Trace (Level 4)

| Artifact               | Data Variable       | Source                                                           | Produces Real Data                            | Status    |
| ---------------------- | ------------------- | ---------------------------------------------------------------- | --------------------------------------------- | --------- |
| `batch-controller.ts`  | `responsePartsList` | `dispatchWithManager()` calls TypeORM DataSource                 | Yes — real DB queries via QueryRunner.manager | ✓ FLOWING |
| `odata-query.pipe.ts`  | `effectiveMaxTop`   | `edmRegistry.getEntitySecurityOptions()` + `this.options.maxTop` | Yes — reads from EdmRegistry (runtime config) | ✓ FLOWING |
| `expand-pagination.ts` | sliced arrays       | `paginationMap` from `ExpandVisitor.expandPaginationMap`         | Yes — populated during expand visitation      | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                     | Command                                                    | Result                                                           | Status |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| publint on core              | `npx publint packages/core`                                | exit 0, zero errors (1 suggestion about "type" field, not error) | ✓ PASS |
| publint on typeorm           | `npx publint packages/typeorm`                             | exit 0, zero errors (1 suggestion about "type" field, not error) | ✓ PASS |
| attw on core                 | `pnpm dlx @arethetypeswrong/cli --pack packages/core`      | "No problems found", all 4 resolution modes green                | ✓ PASS |
| attw on typeorm              | `pnpm dlx @arethetypeswrong/cli --pack packages/typeorm`   | "No problems found", all 4 resolution modes green                | ✓ PASS |
| dist files exist             | `ls packages/core/dist && ls packages/typeorm/dist`        | index.mjs, index.cjs, index.d.mts, index.d.cts in both           | ✓ PASS |
| coverage thresholds in place | `grep thresholds packages/core/vitest.config.ts`           | thresholds: { statements: 80, ... } present                      | ✓ PASS |
| release.yml OIDC config      | `grep NPM_CONFIG_PROVENANCE .github/workflows/release.yml` | NPM_CONFIG_PROVENANCE: true present                              | ✓ PASS |

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

| File                                                | Line    | Pattern                                                                                          | Severity | Impact                                         |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------- |
| `packages/typeorm/src/translator/filter-visitor.ts` | comment | `// Lambda expressions (any/all) require JOIN-based translation — not implemented in this phase` | ℹ️ Info  | Known deferred feature (v2), not a phase 5 gap |

### Human Verification Required

### 1. Real npm publish to scoped test registry

**Test:** Configure npm OIDC trusted publishing on npmjs.com for the repository, then trigger the release workflow with a merged changesets PR on GitHub
**Expected:** Both `@nestjs-odata/core` and `@nestjs-odata/typeorm` publish to npm with provenance attestation (verifiable via `npm info @nestjs-odata/core` showing `dist.attestations`)
**Why human:** Cannot verify actual npm OIDC token exchange in a CI-free local environment; requires live GitHub Actions run against a configured npm OIDC trusted publisher entry on npmjs.com

### Gaps Summary

No gaps remain. Both gaps from the initial verification were closed by plan 05-05:

1. `packages/typeorm/package.json` previously had `exports["."].types` pointing to `./dist/index.d.ts` (a file tsdown never produces). Fixed by adopting split-condition exports with `import.types = ./dist/index.d.mts` and `require.types = ./dist/index.d.cts`.

2. `packages/core/package.json` previously had `types` as the last key in the exports object. Fixed by the same split-condition pattern where types are now scoped inside each condition, eliminating the ordering issue entirely.

Both packages now pass `publint` (exit 0, zero errors) and `@arethetypeswrong/cli` (exit 0, "No problems found", all 4 resolution modes green: node10, node16 CJS, node16 ESM, bundler).

All other passing items from the initial verification remain intact (no regressions).

The one remaining human_needed item (live npm OIDC publish verification) was already present in the initial verification and cannot be automated.

---

_Verified: 2026-04-07T20:00:00Z_
_Verifier: Claude (gsd-verifier)_
