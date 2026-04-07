---
phase: 04-crud-expand-and-module-system
plan: 01
subsystem: api
tags: [odata, parser, expand, ast, typescript]

requires:
  - phase: 03-query-pipeline
    provides: parseQuery, QueryOptions, ODataQuery types, parser infrastructure

provides:
  - ExpandItem and ExpandNode AST types in ast.ts
  - $expand parsing in parseQuery() with nested options and recursive expand
  - expand field on ODataQuery and QueryOptions interfaces
  - parseODataKey utility for OData parenthetical key parsing
  - utils/index.ts barrel export from @nestjs-odata/core

affects:
  - 04-02 (CRUD operations will use parseODataKey for entity key extraction)
  - 04-03+ (any plan using $expand-aware query translation)

tech-stack:
  added: []
  patterns:
    - 'Top-level comma splitting with paren-depth tracking for $expand value parsing'
    - 'Semicolon-to-ampersand conversion for nested OData query options in $expand'
    - 'Recursive parseQuery() call for nested expand options (D-07, D-08)'
    - 'TDD: spec files co-located with source in src/ directory'

key-files:
  created:
    - packages/core/src/parser/parser.spec.ts
    - packages/core/src/utils/odata-key-parser.ts
    - packages/core/src/utils/odata-key-parser.spec.ts
    - packages/core/src/utils/index.ts
  modified:
    - packages/core/src/parser/ast.ts
    - packages/core/src/parser/parser.ts
    - packages/core/src/query/odata-query.types.ts
    - packages/core/src/index.ts

key-decisions:
  - 'Recursive parseExpand uses parseQuery() internally, inheriting max nesting depth (50) for DoS protection per T-04-01'
  - 'Semicolons in nested expand options replaced with & before passing to parseQuery() per D-08'
  - 'Top-level comma split tracks paren depth to handle Items($filter=x),Customer correctly per T-04-03'
  - 'coerceKeyValue returns typed JS values (number/boolean/string) for safe parameterized ORM use per T-04-02'

patterns-established:
  - 'Parser extension pattern: add types to ast.ts, update QueryOptions, add parse function, add $xxx= branch in parseQuery()'
  - 'Utility functions go in packages/core/src/utils/ with barrel export via utils/index.ts'

requirements-completed:
  - QUERY-07
  - CRUD-04

duration: 12min
completed: 2026-04-07
---

# Phase 4 Plan 01: $expand Parsing and OData Key Parser Summary

**$expand AST types (ExpandNode/ExpandItem) with recursive nested option parsing, plus a typed OData parenthetical key parser utility**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-07T16:08:00Z
- **Completed:** 2026-04-07T16:12:30Z
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- Extended the OData AST with `ExpandItem` and `ExpandNode` types supporting recursive nested expand
- Implemented `parseExpand()` in parser.ts with parenthesis-depth-aware comma splitting, handling `Items($filter=x;$top=5)` syntax per D-08
- Added `parseODataKey()` utility in `packages/core/src/utils/` for parsing simple and composite OData key segments from URL path parameters
- All 189 tests pass with 0 TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ExpandNode/ExpandItem AST types, extend ODataQuery, implement $expand parsing** - `f9ef84d` (feat)
2. **Task 2: Create OData parenthetical key parsing utility** - `0fa26f3` (feat)

## Files Created/Modified

- `packages/core/src/parser/ast.ts` - Added ExpandItem, ExpandNode interfaces; added expand to QueryOptions
- `packages/core/src/parser/parser.ts` - Added parseExpand(), splitTopLevelCommas(), $expand= branch in parseQuery()
- `packages/core/src/query/odata-query.types.ts` - Added expand?: ExpandNode to ODataQuery
- `packages/core/src/parser/parser.spec.ts` - 8 tests for $expand parsing (simple, multi, nested, recursive, combined)
- `packages/core/src/utils/odata-key-parser.ts` - parseODataKey() with coerceKeyValue() for typed key coercion
- `packages/core/src/utils/odata-key-parser.spec.ts` - 8 tests for key parsing (numeric, string, boolean, composite, error)
- `packages/core/src/utils/index.ts` - Barrel export for utils
- `packages/core/src/index.ts` - Added export \* from './utils/index.js'

## Decisions Made

- Used recursive `parseQuery()` call inside `parseExpand()` for nested options — inherits the existing 50-level nesting depth guard for DoS protection per T-04-01
- Semicolons in nested expand options (per OData spec D-08) are replaced with `&` before passing to `parseQuery()`, reusing the existing parser without modification
- `coerceKeyValue()` returns typed JS primitives (never raw strings for numbers/booleans) to ensure safe parameterized ORM query use per T-04-02

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Worktree did not have node_modules installed; ran `pnpm install` to set up dependencies before tests could run. Expected for a fresh worktree.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `parseODataKey` is ready for use in CRUD route handlers (plan 04-02+)
- `ExpandNode` type is ready for query translator implementations that need to join/expand navigation properties
- All core package tests pass; type-checking clean

---

_Phase: 04-crud-expand-and-module-system_
_Completed: 2026-04-07_
