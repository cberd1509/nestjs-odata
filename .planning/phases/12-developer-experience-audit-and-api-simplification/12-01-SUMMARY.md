---
phase: 12-developer-experience-audit-and-api-simplification
plan: 01
subsystem: api
tags: [nestjs, decorators, odata, dx, module-system]

# Dependency graph
requires:
  - phase: 04-module-system-crud-and-controller-wiring
    provides: ODataModule.forRoot/forFeature, @ODataController, ODataQueryPipe
provides:
  - registeredServiceRoot static property on ODataModule
  - auto-pipe ODataQueryParam (no @UsePipes needed)
  - serviceRoot inheritance in ODataTypeOrmModule.forFeature
  - controllers array in forRoot() for centralized PATH_METADATA patching
affects: [documentation, developer-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [forRoot-controllers-patching, auto-pipe-param-decorator, static-serviceRoot-inheritance]

key-files:
  created: []
  modified:
    - packages/core/src/odata.module.ts
    - packages/core/src/decorators/odata-query.decorator.ts
    - packages/typeorm/src/odata-typeorm.module.ts
    - apps/test-app/src/app.module.ts
    - apps/test-app/src/products/products.module.ts
    - apps/test-app/src/products/products.controller.ts
    - apps/test-app/src/orders/orders.module.ts
    - apps/test-app/src/orders/orders.controller.ts

key-decisions:
  - 'forRoot() patches PATH_METADATA but does NOT add controllers to ODataModule scope -- controllers stay in feature modules for DI'
  - 'ODataQueryParam wraps createParamDecorator with ODataQueryPipe class ref -- NestJS resolves pipe from DI automatically'
  - 'registeredServiceRoot uses static property set synchronously in forRoot() -- safe because forRoot() always runs before forFeature()'
  - 'controllers type widened to any[] constructor to accept NestJS controllers with typed deps'

patterns-established:
  - 'forRoot({ controllers }) centralized patching: list OData controllers once in AppModule, feature modules stay clean'
  - 'Auto-pipe param decorator: wrap createParamDecorator result with pipe class reference for zero-boilerplate validation'
  - 'Static module property inheritance: use static getter for cross-module config sharing during synchronous module compilation'

requirements-completed: [DX-01, DX-02, DX-03, DX-04, DX-05, DX-06, DX-07, DX-08]

# Metrics
duration: 9min
completed: 2026-04-08
---

# Phase 12 Plan 01: Controller Registration, Auto-Pipe, and serviceRoot Inheritance Summary

**Zero-boilerplate DX: forRoot({ controllers }) centralizes path patching, @ODataQueryParam auto-applies validation pipe, forFeature() inherits serviceRoot**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-08T20:32:31Z
- **Completed:** 2026-04-08T20:41:30Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- ODataModule.forRoot({ controllers }) centralizes PATH_METADATA patching -- feature modules need zero OData boilerplate
- @ODataQueryParam auto-attaches ODataQueryPipe via NestJS class-ref DI resolution -- eliminates silent validation bypass risk
- ODataTypeOrmModule.forFeature() inherits serviceRoot from ODataModule.registeredServiceRoot -- single source of truth
- serviceRoot validated as non-empty string in forRoot() per threat model T-12-01
- All 770 tests pass (324 core + 260 typeorm + 186 e2e) with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED):** `66a1a8c` (test) - Failing tests for registeredServiceRoot, validation, auto-pipe
2. **Task 1 (GREEN):** `dbfa68c` (feat) - Implement registeredServiceRoot, auto-pipe, inherited serviceRoot
3. **Task 1 (FIX):** `5fcf2f0` (fix) - Don't add OData controllers to ODataModule scope
4. **Task 2:** `375764b` (feat) - Simplify test-app with new DX APIs
5. **Task 2 (FIX):** `b0cf582` (fix) - Widen controllers type to accept any constructor

## Files Created/Modified

- `packages/core/src/odata.module.ts` - Added registeredServiceRoot static, serviceRoot validation, widened controllers type
- `packages/core/src/decorators/odata-query.decorator.ts` - Rewrote to auto-attach ODataQueryPipe via RawQuery wrapper
- `packages/typeorm/src/odata-typeorm.module.ts` - forFeature() reads from ODataModule.registeredServiceRoot
- `packages/core/src/decorators/odata-controller.decorator.spec.ts` - Tests for forRoot patching, registeredServiceRoot, validation
- `packages/core/src/decorators/odata-query.decorator.spec.ts` - Test for auto-pipe attachment
- `apps/test-app/src/app.module.ts` - Added controllers array to forRoot, removed serviceRoot from forFeature
- `apps/test-app/src/products/products.module.ts` - Removed PATH_METADATA patching boilerplate
- `apps/test-app/src/products/products.controller.ts` - Removed @UsePipes(ODataQueryPipe) and import
- `apps/test-app/src/orders/orders.module.ts` - Removed PATH_METADATA patching boilerplate
- `apps/test-app/src/orders/orders.controller.ts` - Removed @UsePipes(ODataQueryPipe) and import

## Decisions Made

- **forRoot() patches but does not register controllers:** Controllers listed in `forRoot({ controllers })` have their PATH_METADATA patched with serviceRoot, but are NOT added to ODataModule's controllers array. They remain in feature modules where DI can resolve TypeOrmAutoHandler and other providers. This is the key architectural insight -- patching is global, registration is local.
- **ODataQueryParam as wrapper function:** Changed from direct `createParamDecorator` export to a wrapper that passes `ODataQueryPipe` as the pipe argument. NestJS automatically resolves the pipe class from DI, so all constructor dependencies (EdmRegistry, ODATA_MODULE_OPTIONS) are satisfied.
- **Static property over DI for serviceRoot sharing:** `forFeature()` is a static method called during module compilation when DI is not available. A static property set by `forRoot()` is the only reliable synchronous channel.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] forRoot() was adding controllers to ODataModule scope**

- **Found during:** Task 2 (e2e test verification)
- **Issue:** Original forRoot() code added `...odataControllers` to the returned DynamicModule's controllers array. This caused NestJS to try resolving TypeOrmAutoHandler in ODataModule scope where it doesn't exist.
- **Fix:** Removed `...odataControllers` from the controllers array. forRoot() only patches PATH_METADATA on the classes -- they remain registered in their feature modules.
- **Files modified:** packages/core/src/odata.module.ts
- **Committed in:** 5fcf2f0

**2. [Rule 1 - Bug] controllers type too restrictive for NestJS controllers**

- **Found during:** Task 2 (build verification)
- **Issue:** `(new (...args: unknown[]) => unknown)[]` type rejected controllers with typed constructor params (TypeOrmAutoHandler, DataSource).
- **Fix:** Widened to `(new (...args: any[]) => any)[]` to match NestJS's own controller type patterns.
- **Files modified:** packages/core/src/odata.module.ts
- **Committed in:** b0cf582

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both bugs were discovered during verification and fixed inline. No scope creep.

## Issues Encountered

- Stale build artifacts from pre-change core/typeorm packages caused initial e2e failures. Resolved by running `pnpm build` before e2e tests. Turborepo caching masked the issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DX simplification APIs are ready for documentation in Phase 12 Plan 02 (error message enrichment)
- The simplified API patterns established here should be reflected in any future documentation or getting-started guides

## Self-Check: PASSED

All 10 files verified present. All 5 commits verified in git log.

---

_Phase: 12-developer-experience-audit-and-api-simplification_
_Completed: 2026-04-08_
