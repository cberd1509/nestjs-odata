---
phase: 05-batch-security-and-v1-hardening
plan: 03
subsystem: infra
tags: [vitest, coverage, v8, github-actions, changesets, npm-oidc, provenance, ci-cd]

# Dependency graph
requires:
  - phase: 05-batch-security-and-v1-hardening
    provides: batch security and hardening work that this plan enforces via coverage gates
provides:
  - 80% coverage thresholds enforced in both packages via @vitest/coverage-v8
  - CI workflow runs coverage, publint, attw, and dry-run publish on every PR
  - Release workflow publishes to npm with OIDC provenance when changesets PR is merged
affects:
  - any future plan adding new source files (must maintain 80%+ coverage)
  - npm publishing process (OIDC, no long-lived tokens required)

# Tech tracking
tech-stack:
  added:
    - '@vitest/coverage-v8@^3.2.0 (both packages)'
  patterns:
    - 'v8 coverage provider with 80% threshold enforcement in vitest config'
    - 'OIDC trusted publishing with NPM_CONFIG_PROVENANCE=true'
    - 'changesets separate version-pr from publish step'

key-files:
  created: []
  modified:
    - packages/core/vitest.config.ts
    - packages/typeorm/vitest.config.ts
    - packages/core/package.json
    - packages/typeorm/package.json
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - packages/typeorm/src/batch/batch-controller.spec.ts
    - packages/typeorm/src/odata-typeorm.module.spec.ts
    - packages/typeorm/src/translator/expand-visitor.spec.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.spec.ts
    - pnpm-lock.yaml

key-decisions:
  - 'Install @vitest/coverage-v8@^3.2.0 (matching vitest@3.2.x) instead of latest @4.x to avoid peer dep mismatch'
  - 'Tests added to cover uncovered branches in batch-controller, odata-typeorm.module, expand-visitor, and typeorm-auto-handler to reach 80% branch coverage in typeorm package'
  - 'pre-existing test-app lint/build failures are out of scope (not caused by this plan)'
  - 'release.yml: removed publish script from changesets/action, uses standalone step with NPM_CONFIG_PROVENANCE'

patterns-established:
  - 'coverage: provider v8 with include/exclude in vitest configs — template for future packages'
  - "OIDC npm publish: steps.changesets.outputs.hasChangesets == 'false' conditional pattern"

requirements-completed:
  - SEC-01
  - SEC-02

# Metrics
duration: 35min
completed: 2026-04-07
---

# Phase 05 Plan 03: Coverage Enforcement and CI/CD Release Pipeline Summary

**80% coverage thresholds enforced via @vitest/coverage-v8 and CI pipeline finalized with npm OIDC provenance publishing triggered on merged changesets PRs**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-07T18:18:00Z
- **Completed:** 2026-04-07T18:35:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Installed `@vitest/coverage-v8@^3.2.0` in both packages; added 80% thresholds for statements, branches, functions, and lines — any future code drop below threshold fails the test suite
- Added 13 new tests to the typeorm package to bring branch coverage from 74% to 82%, covering error paths in BatchController (GET by key, 404/405/500, changeset rollback, stream body), module factory functions, expand-visitor orderBy/pagination branches, and buildNextLink with existing query params
- CI workflow now runs coverage (with thresholds), publint, @arethetypeswrong/cli, and publish dry-run on every PR
- Release workflow publishes to npm with OIDC provenance (NPM_CONFIG_PROVENANCE=true) when the changesets version PR is merged — no long-lived npm tokens required

## Task Commits

1. **Task 1: Coverage enforcement with @vitest/coverage-v8 and thresholds** - `247352d` (feat)
2. **Task 2: CI/CD release pipeline with npm OIDC provenance** - `22f3009` (feat)

## Files Created/Modified

- `packages/core/vitest.config.ts` - Added v8 coverage provider with 80% thresholds
- `packages/typeorm/vitest.config.ts` - Same as core
- `packages/core/package.json` - Added @vitest/coverage-v8 dev dep
- `packages/typeorm/package.json` - Same as core
- `.github/workflows/ci.yml` - Added coverage step and publish dry-run step
- `.github/workflows/release.yml` - Added OIDC publish step with NPM_CONFIG_PROVENANCE
- `packages/typeorm/src/batch/batch-controller.spec.ts` - Added 14 error-path and edge-case tests
- `packages/typeorm/src/odata-typeorm.module.spec.ts` - Added 5 tests for factory functions and TypeOrmEdmInitializer
- `packages/typeorm/src/translator/expand-visitor.spec.ts` - Added 2 tests for orderBy and pagination branches
- `packages/typeorm/src/translator/typeorm-auto-handler.spec.ts` - Added 3 tests for buildNextLink with query string

## Decisions Made

- Installed `@vitest/coverage-v8@^3.2.0` instead of latest `@4.x` to match existing `vitest@3.2.x` peer requirement — avoids peer dep warnings and ensures version compatibility
- Added targeted tests to cover typeorm package branch gaps rather than lowering thresholds — correctness of error paths is validated
- Removed the `publish` script from `changesets/action` in release.yml; instead use a standalone step with `NPM_CONFIG_PROVENANCE=true` env var — this is the correct pattern for OIDC provenance as the changesets action's built-in publish doesn't support OIDC env injection properly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added tests to meet 80% branch coverage threshold in typeorm package**

- **Found during:** Task 1 (Coverage enforcement)
- **Issue:** typeorm package was at 74.68% branch coverage after adding thresholds, failing the 80% requirement
- **Fix:** Added 13+ tests covering BatchController error dispatch paths, module factory functions, expand-visitor orderBy/pagination, and auto-handler buildNextLink with query params
- **Files modified:** 4 spec files in packages/typeorm/src/
- **Verification:** `pnpm --filter @nestjs-odata/typeorm exec vitest run --coverage` exits 0 with 82.06% branch coverage
- **Committed in:** 247352d (Task 1 commit)

**2. [Rule 1 - Bug] Fixed test isolation issue in batch-controller spec**

- **Found during:** Task 1 (test iteration)
- **Issue:** Test 18b used `mockImplementation` which leaked into subsequent tests; `vi.clearAllMocks()` only clears call history not implementations
- **Fix:** Changed to `mockImplementationOnce` so the mock reverts after one call
- **Files modified:** packages/typeorm/src/batch/batch-controller.spec.ts
- **Verification:** All 171 tests pass in typeorm package
- **Committed in:** 247352d (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both fixes necessary to achieve plan goals. No scope creep.

## Issues Encountered

- `@vitest/coverage-v8@latest` (v4.x) has a peer dep mismatch with `vitest@3.2.x` — resolved by pinning to `@^3.2.0`
- typeorm package was below 80% branch coverage without additional tests — resolved by targeting the actual uncovered branches
- ESLint commitlint subject-case rule rejects uppercase abbreviations in subject line — resolved by lowercasing all subject text

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. YAML workflow changes implement mitigations T-05-11 and T-05-12 from the plan's threat register (OIDC provenance).

## User Setup Required

For OIDC publishing to work in production, the GitHub repository needs npm OIDC trusted publishing configured on npmjs.com:

1. Go to https://www.npmjs.com → package → Settings → Publishing access
2. Add Granular Access Token with OIDC from GitHub Actions (repo: your-org/nestjs-odata)

This is a one-time npm registry configuration, not a code change.

## Next Phase Readiness

- Coverage enforcement is in place — any new code must maintain 80%+ coverage
- Release pipeline is ready for v1 publishing once packages are at v1.0.0
- CI validates publishability on every PR via dry-run

---

_Phase: 05-batch-security-and-v1-hardening_
_Completed: 2026-04-07_

## Self-Check: PASSED

- packages/core/vitest.config.ts: FOUND with thresholds
- packages/typeorm/vitest.config.ts: FOUND with thresholds
- .github/workflows/ci.yml: FOUND with coverage and dry-run steps
- .github/workflows/release.yml: FOUND with NPM_CONFIG_PROVENANCE and hasChangesets conditional
- Commit 247352d: FOUND (Task 1)
- Commit 22f3009: FOUND (Task 2)
