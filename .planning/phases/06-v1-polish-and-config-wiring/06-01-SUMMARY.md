---
phase: 06-v1-polish-and-config-wiring
plan: 01
subsystem: core-typeorm
tags: [sec-04, mod-02, filter-depth, edm-registration, config-wiring]
dependency_graph:
  requires: []
  provides: [maxFilterDepth-enforcement, EdmFeatureInitializer]
  affects: [packages/typeorm/src/translator, packages/core/src/edm, packages/core/src/odata.module]
tech_stack:
  added: []
  patterns: [OnModuleInit lifecycle hook, TDD red-green cycle]
key_files:
  created:
    - packages/core/src/edm/edm-feature-initializer.ts
    - packages/core/src/edm/edm-feature-initializer.spec.ts
  modified:
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/typeorm/src/translator/typeorm-query-translator.spec.ts
    - packages/core/src/odata.module.ts
    - packages/core/src/odata.module.spec.ts
decisions:
  - 'Use as never cast for mock registry to avoid @typescript-eslint/unbound-method lint errors'
  - 'Store mock fn in local registerFn variable for safe assertion access'
metrics:
  duration: ~15min
  completed: 2026-04-07
  tasks_completed: 2
  files_changed: 6
requirements:
  - SEC-04
  - MOD-02
---

# Phase 06 Plan 01: SEC-04 Config Wiring and MOD-02 forFeature Fix Summary

**One-liner:** Wire `maxFilterDepth` from `ODataModuleResolvedOptions` to `TypeOrmFilterVisitor` constructor, and add `EdmFeatureInitializer` service to make `ODataModule.forFeature()` register entities into `EdmRegistry` at module init.

## Tasks Completed

| #   | Name                                                                   | Commit    | Files                                                                                              |
| --- | ---------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| 1   | Wire maxFilterDepth to TypeOrmFilterVisitor (SEC-04)                   | `0cd9be2` | typeorm-query-translator.ts, typeorm-query-translator.spec.ts                                      |
| 2   | Add EdmFeatureInitializer to wire forFeature() to EdmRegistry (MOD-02) | `c9404bb` | edm-feature-initializer.ts, edm-feature-initializer.spec.ts, odata.module.ts, odata.module.spec.ts |

## What Was Built

### SEC-04: maxFilterDepth Forwarding

The `TypeOrmQueryTranslator.translate()` method was constructing `TypeOrmFilterVisitor` without the 4th `maxFilterDepth` argument, meaning the hardcoded default of 10 was always used regardless of `ODataModuleOptions.maxFilterDepth`. One argument addition fixes it:

```typescript
// Before (broken):
new TypeOrmFilterVisitor(qb, alias, entityType).visit(query.filter)

// After (correct):
new TypeOrmFilterVisitor(qb, alias, entityType, this.options.maxFilterDepth).visit(query.filter)
```

Two new tests verify the behavior: depth exceeding the configured limit throws `ODataValidationError`, and depth within the limit passes cleanly.

### MOD-02: EdmFeatureInitializer

Created `EdmFeatureInitializer` — a NestJS `@Injectable()` service implementing `OnModuleInit`. On module init it iterates the injected `EDM_ENTITY_CONFIGS` array and calls `edmRegistry.register()` for each config, building `EdmEntityType` and `EdmEntitySet` objects using the namespace from `ODATA_MODULE_OPTIONS`.

Updated `ODataModule.forFeature()` to include `EdmFeatureInitializer` as a provider, closing the gap where the token was provided but never consumed.

## Test Coverage

| Suite                        | Tests   | Delta                       |
| ---------------------------- | ------- | --------------------------- |
| @nestjs-odata/core           | 243     | +5 (4 unit + 1 integration) |
| @nestjs-odata/typeorm        | 173     | +2 (SEC-04 describe block)  |
| @nestjs-odata/test-app (e2e) | 152     | 0 (no regression)           |
| **Total**                    | **568** | **+7**                      |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint `@typescript-eslint/unbound-method` in spec**

- **Found during:** Task 2 commit (pre-commit hook)
- **Issue:** Spec used `as unknown as EdmRegistry` cast which made ESLint aware of class method access in `expect()` calls, triggering `unbound-method` rule
- **Fix:** Extracted `registerFn = vi.fn()` as a local variable and used `as never` cast (matching existing codebase pattern from `odata-typeorm.module.spec.ts`)
- **Files modified:** `packages/core/src/edm/edm-feature-initializer.spec.ts`
- **Commit:** `c9404bb`

**2. [Rule 3 - Blocking] Dependencies not installed in worktree**

- **Found during:** Task 1 first test run
- **Issue:** Worktree had no `node_modules` — `pnpm install --frozen-lockfile` required before tests could run
- **Fix:** Ran `pnpm install`, then built `@nestjs-odata/core` before running typeorm tests
- **Impact:** None on code; one-time setup step

## Self-Check: PASSED

- `edm-feature-initializer.ts` — FOUND
- `edm-feature-initializer.spec.ts` — FOUND
- Commit `0cd9be2` (SEC-04 fix) — FOUND
- Commit `c9404bb` (MOD-02 fix) — FOUND
- `this.options.maxFilterDepth` in translator — FOUND
- `EdmFeatureInitializer` import + provider in `odata.module.ts` — FOUND
