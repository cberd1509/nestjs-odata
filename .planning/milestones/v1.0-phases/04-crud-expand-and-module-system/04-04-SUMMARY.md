---
phase: 04-crud-expand-and-module-system
plan: 04
subsystem: api
tags: [nestjs, odata, module-system, decorators, path-patching, typescript]

requires:
  - phase: 04-02
    provides: '@ODataController decorator with ODATA_CONTROLLER_KEY metadata symbol'

provides:
  - 'controllers? field on ODataModuleOptions for registering @ODataController classes'
  - 'forRoot() patches PATH_METADATA of each registered @ODataController with serviceRoot prefix synchronously'
  - "@ODataController('Products') + forRoot({ serviceRoot: '/odata', controllers: [ProductsController] }) routes at /odata/Products"

affects:
  - future-crud-auto (any plan that auto-wires ODataController with module system)

tech-stack:
  added: []
  patterns:
    - 'PATH_METADATA synchronous patching in forRoot() for @ODataController — same pattern as MetadataController'
    - 'ODATA_CONTROLLER_KEY Reflect.getMetadata() to discover entity set name on controller class'
    - 'Controllers list threaded through DynamicModule.controllers array after path patching'

key-files:
  created: []
  modified:
    - packages/core/src/odata.module.ts

key-decisions:
  - 'Path patching is synchronous in forRoot(), not in onModuleInit — NestJS reads PATH_METADATA at module compile time, before lifecycle hooks fire'
  - 'controllers field on ODataModuleOptions is optional; omitting it leaves existing behavior unchanged'
  - 'Controllers not registered via forRoot() controllers array will NOT have serviceRoot applied — by design (T-04-12: spoofing mitigation)'
  - 'forRootAsync() left without controller path patching — serviceRoot unavailable synchronously in async config path; consumers should use forRoot() for synchronous config'

patterns-established:
  - 'Module-level path patching pattern: read ODATA_CONTROLLER_KEY, compute full path, Reflect.defineMetadata(PATH_METADATA) in forRoot()'

requirements-completed:
  - MOD-01
  - MOD-02
  - MOD-06

duration: 8min
completed: 2026-04-07
---

# Phase 4 Plan 04: Module System @ODataController Path Wiring Summary

**ODataModule.forRoot() now patches PATH_METADATA for @ODataController classes with the serviceRoot prefix synchronously at module registration time, per D-17**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-07T16:15:00Z
- **Completed:** 2026-04-07T16:23:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `controllers?` field to `ODataModuleOptions` — optional array of classes decorated with `@ODataController()`
- `forRoot()` reads `ODATA_CONTROLLER_KEY` metadata from each controller to discover its entitySetName, then patches `PATH_METADATA` to `${serviceRoot}/${entitySetName}` synchronously before NestJS compiles the module
- All patched controllers are added to the returned `DynamicModule.controllers` array so NestJS registers their routes
- All 216 core tests pass; both core and typeorm packages type-check clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire @ODataController path patching with serviceRoot in forRoot()** - `99750ed` (feat)

## Files Created/Modified

- `packages/core/src/odata.module.ts` - Added ODATA_CONTROLLER_KEY import, controllers? to ODataModuleOptions, and synchronous PATH_METADATA patching loop in forRoot()

## Decisions Made

- Patching in `forRoot()` (synchronous) rather than `onModuleInit()` (async lifecycle): NestJS reads route metadata during module compilation, which happens before `onModuleInit`. The same pattern is used by `createMetadataControllerWithPath()` for `MetadataController`.
- `forRootAsync()` does not support controller path patching — the serviceRoot is not available synchronously in the async config path. Consumers needing this feature must use `forRoot()`.
- Controllers not passed in `options.controllers` intentionally do NOT receive the serviceRoot prefix, per threat model T-04-12 (spoofing mitigation).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Pre-commit hook used `pnpm exec lint-staged` but `lint-staged` was not installed in the worktree's node_modules. Ran `pnpm install` at root to resolve. Expected for a fresh worktree.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `ODataModule.forRoot({ serviceRoot: '/odata', controllers: [ProductsController] })` is fully functional
- `@ODataController('Products')` combined with forRoot registration routes at `/odata/Products`
- Module system (forRoot / forFeature / forRootAsync / ConfigurableModuleBuilder) all maintained and working
- All 216 tests passing; zero type errors

---

_Phase: 04-crud-expand-and-module-system_
_Completed: 2026-04-07_
