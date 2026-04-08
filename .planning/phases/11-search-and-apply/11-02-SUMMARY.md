---
phase: 11-search-and-apply
plan: 02
subsystem: typeorm-adapter
tags: [search, apply, typeorm, sql, search-provider, apply-visitor, group-by, aggregate]
dependency_graph:
  requires:
    - 11-01
  provides:
    - TypeOrmSearchProvider implementing ISearchProvider
    - TypeOrmApplyVisitor for $apply SQL translation
    - Extended TypeOrmQueryTranslator with search/apply branches
    - SEARCH_PROVIDER DI registration in ODataTypeOrmModule
  affects:
    - packages/typeorm/src/translator/search-provider.ts
    - packages/typeorm/src/translator/search-provider.spec.ts
    - packages/typeorm/src/translator/apply-visitor.ts
    - packages/typeorm/src/translator/apply-visitor.spec.ts
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/typeorm/src/translator/index.ts
    - packages/typeorm/src/odata-typeorm.module.ts
tech_stack:
  added: []
  patterns:
    - LIKE-parameterized search with escaped wildcards (T-11-04)
    - Recursive SearchNode tree walking via private methods (discriminated union narrowing)
    - Pipeline-ordered ApplyStep processing (filter before group-by)
    - getRawMany() for aggregated queries (preserves aggregate aliases)
    - Optional DI injection (@Optional @Inject) for pluggable search provider
key_files:
  created:
    - packages/typeorm/src/translator/search-provider.ts
    - packages/typeorm/src/translator/search-provider.spec.ts
    - packages/typeorm/src/translator/apply-visitor.ts
    - packages/typeorm/src/translator/apply-visitor.spec.ts
  modified:
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/typeorm/src/translator/index.ts
    - packages/typeorm/src/odata-typeorm.module.ts
decisions:
  - getRawMany() used for all $apply queries — getMany() drops aggregate aliases (TypeORM entity hydration strips unknown columns)
  - TypeOrmQueryTranslator typed as IQueryTranslator<TranslateResult> rather than IQueryTranslator<SelectQueryBuilder> — TranslateResult is the actual return type
  - SEARCH_PROVIDER injected as @Optional() — translator works without search support if provider not registered
  - select/orderby/expand visitors skipped when $apply present — per OData Data Aggregation Extension spec
  - search uses entityType.name (not entitySetName) as entity set name for EdmRegistry lookup
metrics:
  duration_seconds: 420
  completed_date: '2026-04-08'
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 3
  tests_added: 27
  tests_total_after: 260
---

# Phase 11 Plan 02: TypeORM Search and Apply Adapter Summary

**One-liner:** TypeOrmSearchProvider with LIKE-based $search and TypeOrmApplyVisitor for GROUP BY/$apply translation, wired into TypeOrmQueryTranslator with getRawMany() for aggregated results.

## Tasks Completed

| Task | Name                                                       | Commit  | Files                                                                                                     |
| ---- | ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| 1    | TypeOrmSearchProvider and TypeOrmApplyVisitor              | ef1a0e4 | search-provider.ts, search-provider.spec.ts, apply-visitor.ts, apply-visitor.spec.ts, translator/index.ts |
| 2    | Extend TypeOrmQueryTranslator and register SEARCH_PROVIDER | 5f457fc | typeorm-query-translator.ts, odata-typeorm.module.ts                                                      |

## What Was Built

### TypeOrmSearchProvider (search-provider.ts)

Implements `ISearchProvider` following the `TypeOrmETagProvider` pattern:

- `buildSearchCondition(searchNode, entitySetName, alias)` walks the `SearchNode` discriminated union tree
- Resolves entity class from `EdmRegistry.getEntitySet()` + `DataSource.entityMetadatas`
- Calls `getSearchableProperties(entityClass)` from Plan 01's decorator
- Throws `ODataValidationError` if no `@ODataSearchable()` fields found — clear developer message
- `SearchTermNode`: OR-chains `alias.field LIKE :search_N` across all searchable fields; negated terms wrapped in `NOT (...)`
- `SearchBinaryNode`: recursively builds `(leftCondition AND/OR rightCondition)`
- LIKE special characters (`%`, `_`) escaped with backslash — T-11-04 mitigation

### TypeOrmApplyVisitor (apply-visitor.ts)

Translates `ApplyNode` pipeline steps to TypeORM QueryBuilder calls:

- `apply(applyNode)` iterates steps in order, returns projected column names for `@odata.context`
- `ApplyFilter`: delegates to `TypeOrmFilterVisitor` (adds `WHERE` clause via existing infrastructure)
- `ApplyGroupBy`: clears entity.\* select → `addSelect(alias.prop, prop)` per groupby property → `addGroupBy(alias.prop)` → aggregate expressions
- `ApplyAggregate`: clears select → aggregate expressions only (no `GROUP BY`)
- `buildAggregateSql()` method maps aggregate methods to SQL functions:
  - `count/$count` → `COUNT(*)`; `count/field` → `COUNT(alias.field)`
  - `sum` → `SUM`, `avg` → `AVG`, `min` → `MIN`, `max` → `MAX`
  - `countdistinct` → `COUNT(DISTINCT alias.field)`

### Extended TypeOrmQueryTranslator (typeorm-query-translator.ts)

Two new branches added to `translate()`:

1. **Search (step 1.5):** After filter, if `query.search` and `searchProvider` present, calls `buildSearchCondition()` and `qb.andWhere()`
2. **Apply (step 2):** If `query.apply`, instantiates `TypeOrmApplyVisitor` and calls `.apply()`, captures `applyProperties`
3. **Conditional skip:** When `$apply` present, select/orderby/expand visitors are skipped
4. **`execute()` branch:** When `applyProperties` is defined (i.e., `$apply` was used), calls `qb.getRawMany()` instead of `qb.getMany()`/`getManyAndCount()` — preserves aggregate column aliases
5. **`TranslateResult` extended** with `applyProperties?: string[]`
6. **Typed as `IQueryTranslator<TranslateResult>`** (corrected from `IQueryTranslator<SelectQueryBuilder>`)

### SEARCH_PROVIDER Registration (odata-typeorm.module.ts)

Follows `ETAG_PROVIDER` pattern exactly:

- `TypeOrmSearchProvider` factory provider with `DataSource + EdmRegistry` injection
- `SEARCH_PROVIDER` aliased via `useExisting: TypeOrmSearchProvider`
- `TypeOrmQueryTranslator` factory updated to inject `SEARCH_PROVIDER` as optional
- Both `TypeOrmSearchProvider` and `SEARCH_PROVIDER` exported from module

## Test Results

- 27 new unit tests across 2 new spec files
- All 260 tests in the typeorm package pass (17 test files)
- 0 failures
- TypeScript type check (`tsc --noEmit`) passes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IQueryTranslator generic type mismatch**

- **Found during:** Task 2 type check (`tsc --noEmit`)
- **Issue:** `TypeOrmQueryTranslator` was declared as `IQueryTranslator<SelectQueryBuilder<ObjectLiteral>>` but `translate()` returns `TranslateResult` — this caused a TS2416 type assignability error
- **Fix:** Changed generic parameter to `IQueryTranslator<TranslateResult>` which correctly reflects the actual return type
- **Files modified:** packages/typeorm/src/translator/typeorm-query-translator.ts

**2. [Rule 2 - Lint] Unbound method lint errors in apply-visitor.spec.ts**

- **Found during:** Task 1 commit (pre-commit ESLint hook)
- **Issue:** `expect(qb.select).toHaveBeenCalledWith(...)` triggered `@typescript-eslint/unbound-method` — mock methods typed as plain functions, not `MockInstance`
- **Fix:** Introduced typed `MockQb` type extending `SelectQueryBuilder<ObjectLiteral>` with `MockInstance`-typed properties, following the same pattern as `filter-visitor.spec.ts`
- **Files modified:** packages/typeorm/src/translator/apply-visitor.spec.ts

**3. [Rule 2 - Lint] Unused variable and unnecessary type cast in search-provider.ts**

- **Found during:** Task 1 commit (pre-commit ESLint hook)
- **Issue:** (a) `SearchBinaryNode` used with explicit cast `as SearchBinaryNode` — ESLint flagged both the unnecessary cast and an unsafe argument from the missing import; (b) Recursive closure used direct cast instead of type-safe private method
- **Fix:** Refactored `buildCondition` closure to call private methods (`buildTermCondition`, `buildBinaryCondition`) — TypeScript discriminated union narrowing handles the `SearchTermNode` branch; the `else` branch is handled by the private method with proper `SearchBinaryNode` parameter type
- **Files modified:** packages/typeorm/src/translator/search-provider.ts

**4. [Rule 3 - Build] Core package dist stale — worktree had no compiled output**

- **Found during:** Task 1 test run (spec files not being collected)
- **Issue:** The `@nestjs-odata/core` package dist at `/packages/core/dist/` did not include Plan 01's new exports (`ODataSearchable`, `getSearchableProperties`, `SEARCH_PROVIDER`, etc.)
- **Fix:** Rebuilt core package: `pnpm --filter @nestjs-odata/core build`
- **Note:** This was a one-time setup step for the worktree environment

**5. [Rule 3 - Build] Worktree missing node_modules — tests not found**

- **Found during:** Task 1 test run (vitest not found in worktree)
- **Issue:** Git worktree has separate working directory but no `node_modules`; `pnpm --filter` resolved to the main repo's package, not the worktree
- **Fix:** Created symlinks from worktree to main repo: `node_modules -> /repos/nestjs-odata/node_modules` and `packages/typeorm/node_modules -> /repos/nestjs-odata/packages/typeorm/node_modules`; ran vitest directly via `packages/typeorm/node_modules/.bin/vitest run --root packages/typeorm`

## Known Stubs

None — all search and apply translation paths are fully implemented. No placeholder implementations.

## Threat Flags

No new security-relevant surfaces beyond what was in the plan's threat model.

All threat mitigations from the plan are implemented:

- **T-11-04** (LIKE injection): LIKE values parameterized via `:search_N` params, `%` and `_` escaped with `\`
- **T-11-05** (aggregate property injection): Property names and aliases come from the validated AST (parser-level regex validation from Plan 01); only aggregate method is an enum switch
- **T-11-07** (info disclosure via getRawMany): `applyProperties` from `TypeOrmApplyVisitor.apply()` controls which column names are in `@odata.context` — aggregate aliases are explicit, not inferred from raw column names

## Self-Check: PASSED

All required files exist and all commits verified.
