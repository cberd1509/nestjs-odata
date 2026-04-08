---
phase: 04-crud-expand-and-module-system
plan: 03
subsystem: api
tags: [odata, typeorm, expand, crud, typescript]

requires:
  - phase: 04-crud-expand-and-module-system
    plan: 01
    provides: ExpandNode/ExpandItem AST types, parseODataKey utility
  - phase: 04-crud-expand-and-module-system
    plan: 02
    provides: CRUD decorators, ODataController, interceptor single-entity support

provides:
  - TypeOrmExpandVisitor translating $expand to leftJoinAndSelect with unique aliases
  - $expand validation in ODataQueryPipe against EdmEntityType.navigationProperties
  - TypeOrmQueryTranslator wired with ExpandVisitor in translate()
  - TypeOrmAutoHandler.handleGetByKey (repo.findOne + NotFoundException)
  - TypeOrmAutoHandler.handleCreate (repo.create + repo.save + locationUrl)
  - TypeOrmAutoHandler.handleUpdate (repo.preload + repo.save + NotFoundException)
  - TypeOrmAutoHandler.handleDelete (repo.delete + NotFoundException when affected=0)

affects:
  - 04-04 (auto-CRUD controller will use these handler methods)
  - 04-05 (module system)

tech-stack:
  added: []
  patterns:
    - 'ExpandVisitor alias convention: parentAlias_navigationProperty for collision-free TypeORM aliases'
    - 'Depth-first recursive expand with maxExpandDepth guard (ODataValidationError on exceed)'
    - 'EDM validation of navigation property names in both ODataQueryPipe and TypeOrmExpandVisitor'
    - 'CRUD merge-patch via repo.preload() — TypeORM merges body onto loaded entity'
    - 'top+1 nextLink detection pattern extended — repo injected alongside translator'

key-files:
  created:
    - packages/typeorm/src/translator/expand-visitor.ts
    - packages/typeorm/src/translator/expand-visitor.spec.ts
  modified:
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/typeorm/src/translator/typeorm-query-translator.spec.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.spec.ts
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/core/src/query/odata-query.pipe.ts
    - packages/core/src/query/odata-query.pipe.spec.ts

key-decisions:
  - 'TypeOrmExpandVisitor alias format parentAlias_nav avoids TypeORM alias collision for same nav at different tree paths'
  - 'ODataQueryPipe validates top-level $expand only — nested expand validated by TypeOrmExpandVisitor at translation time with full EdmRegistry'
  - 'repo injected into TypeOrmAutoHandler (4th constructor arg) to enable direct CRUD without going through SelectQueryBuilder'
  - 'handleDelete checks affected===0 (not just falsy) — some drivers return null for affected on no-op deletes'

requirements-completed:
  - CRUD-01
  - CRUD-02
  - CRUD-03
  - QUERY-07
  - QUERY-08

duration: 18min
completed: 2026-04-07
---

# Phase 4 Plan 03: ExpandVisitor, CRUD Handler Methods, and $expand Validation Summary

**TypeOrmExpandVisitor (recursive JOINs), four CRUD methods on TypeOrmAutoHandler, and $expand validation in ODataQueryPipe — 348 total tests passing**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-04-07
- **Tasks:** 2
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- Created `TypeOrmExpandVisitor` that translates `$expand` AST nodes into TypeORM `leftJoinAndSelect` calls with unique aliases (`parentAlias_navProp`), recursive depth tracking, and EDM validation
- Wired `TypeOrmExpandVisitor` into `TypeOrmQueryTranslator.translate()` as visitor step 5
- Updated `TypeOrmQueryTranslator` constructor to accept `EdmRegistry` and `ODataModuleResolvedOptions` needed by `TypeOrmExpandVisitor`
- Added `validateExpandNode()` to `ODataQueryPipe` that validates top-level navigation property names against `EdmEntityType.navigationProperties` before any DB query is constructed
- Implemented four CRUD methods on `TypeOrmAutoHandler`:
  - `handleGetByKey()`: `parseODataKey` → `repo.findOne` → `NotFoundException` if null
  - `handleCreate()`: `repo.create` + `repo.save` → `{ entity, locationUrl }` with `{serviceRoot}/{entitySet}({key})` format
  - `handleUpdate()`: `parseODataKey` → `repo.preload` (merge-patch) + `repo.save` → `NotFoundException` if preload returns undefined
  - `handleDelete()`: `parseODataKey` → `repo.delete` → `NotFoundException` if `affected===0`
- Updated `ODataTypeOrmModule.forFeature()` factory providers to inject `EdmRegistry`, options, and `Repository` into the new constructors

## Task Commits

1. **Task 1: typeorm expand visitor, $expand validation in query pipe, translator wired** — `6b7b9cd`
2. **Task 2: add CRUD methods to TypeOrmAutoHandler** — `5e8b7e3`

## Files Created/Modified

- `packages/typeorm/src/translator/expand-visitor.ts` — `TypeOrmExpandVisitor` with `apply()`, depth enforcement, EDM validation, recursive nested expand
- `packages/typeorm/src/translator/expand-visitor.spec.ts` — 7 tests covering single/multi/nested expand, depth limit, invalid nav prop
- `packages/typeorm/src/translator/typeorm-query-translator.ts` — Added `EdmRegistry` + `ODataModuleResolvedOptions` constructor params; step 5 expand wiring
- `packages/typeorm/src/translator/typeorm-query-translator.spec.ts` — Updated constructor call with new params
- `packages/typeorm/src/translator/typeorm-auto-handler.ts` — Added `repo` constructor param; `handleGetByKey`, `handleCreate`, `handleUpdate`, `handleDelete` methods
- `packages/typeorm/src/translator/typeorm-auto-handler.spec.ts` — 9 new CRUD tests (16 total)
- `packages/typeorm/src/odata-typeorm.module.ts` — Updated both factories to inject `EdmRegistry`, `ODATA_MODULE_OPTIONS`, `DataSource` repo
- `packages/core/src/query/odata-query.pipe.ts` — `validateExpandNode()` method; `expand: parsed.expand` in returned `ODataQuery`
- `packages/core/src/query/odata-query.pipe.spec.ts` — 4 new `$expand` validation tests; added nav props to mock entity type

## Decisions Made

- `TypeOrmExpandVisitor` alias convention is `parentAlias_navigationProperty` — this ensures uniqueness even when the same nav property name appears at different levels of the tree
- `ODataQueryPipe` only validates top-level `$expand` navigation property names; nested expand validation is deferred to `TypeOrmExpandVisitor` at translation time because it has access to `EdmRegistry` for resolving target entity types
- `repo` is injected as a 4th constructor parameter on `TypeOrmAutoHandler` (not accessed via translator) — CRUD operations need direct repository access, distinct from query building
- `handleDelete` checks `affected === 0` strictly rather than falsy — some TypeORM drivers return `null` for `affected` on operations where affected row count is unavailable, which should not be treated as "not found"

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all four CRUD methods are fully wired to TypeORM repository operations. No hardcoded empty values or placeholders.

## Threat Surface Scan

No new network endpoints introduced in this plan. All threat model items from the plan's `<threat_model>` have been mitigated:

| Threat ID | Mitigation Applied                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| T-04-07   | `repo.create()` and `repo.preload()` map only declared entity columns — unknown fields silently ignored                        |
| T-04-08   | `parseODataKey` returns typed values used in parameterized `where` clauses — no SQL interpolation                              |
| T-04-09   | Navigation property names validated in both `ODataQueryPipe.validateExpandNode()` and `TypeOrmExpandVisitor.applyExpandItem()` |
| T-04-10   | `maxExpandDepth` enforced recursively in `TypeOrmExpandVisitor.apply()` — throws `ODataValidationError` (400)                  |
| T-04-11   | TypeORM entity class acts as whitelist — only declared columns mapped by `repo.create()`                                       |

## Self-Check

- [x] `packages/typeorm/src/translator/expand-visitor.ts` — FOUND
- [x] `packages/typeorm/src/translator/expand-visitor.spec.ts` — FOUND
- [x] `packages/typeorm/src/translator/typeorm-auto-handler.ts` — FOUND (contains `handleCreate`, `handleGetByKey`, `handleUpdate`, `handleDelete`)
- [x] `packages/typeorm/src/query/odata-query.pipe.ts` — FOUND (contains `validateExpandNode`, `expand: parsed.expand`)
- [x] Commit `6b7b9cd` — FOUND
- [x] Commit `5e8b7e3` — FOUND
- [x] 220 core tests pass, 128 typeorm tests pass (348 total)

## Self-Check: PASSED

---

_Phase: 04-crud-expand-and-module-system_
_Completed: 2026-04-07_
