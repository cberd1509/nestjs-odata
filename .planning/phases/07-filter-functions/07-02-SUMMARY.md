---
phase: '07'
plan: '02'
subsystem: typeorm-filter-visitor
tags:
  - lambda
  - exists-subquery
  - odata-filter
  - typeorm
  - integration-test
dependency_graph:
  requires:
    - '07-01'
  provides:
    - visitLambdaExpr-exists-subquery
  affects:
    - packages/typeorm/src/translator/filter-visitor.ts
    - packages/typeorm/src/translator/typeorm-query-translator.ts
tech_stack:
  added: []
  patterns:
    - EXISTS/NOT EXISTS correlated subquery via TypeORM relation metadata
    - InnerFilterExprBuilder reused for EXISTS predicate body
    - Integration test with in-memory better-sqlite3 DataSource
key_files:
  created:
    - packages/typeorm/src/translator/filter-visitor-lambda.spec.ts
  modified:
    - packages/typeorm/src/translator/filter-visitor.ts
    - packages/typeorm/src/translator/typeorm-query-translator.ts
decisions:
  - 'Use better-sqlite3 (not sqlite3) for integration test DataSource — already in devDependencies'
  - 'Quote table names in EXISTS SQL with double-quotes for SQLite safety'
  - 'Increment paramCount once before building subAlias to prevent alias collision across multiple lambda expressions in the same filter'
  - 'ManyToMany lambda throws ODataValidationError — scoped to OneToMany only per plan'
  - 'Pass repo through or-branch sub-visitors to propagate relation metadata'
metrics:
  duration: '~12 minutes'
  completed: '2026-04-08'
  tasks: 1
  files: 3
requirements:
  - FILT-01
  - FILT-02
---

# Phase 07 Plan 02: Lambda any/all EXISTS Subqueries Summary

One-liner: Lambda any/all translated to EXISTS/NOT EXISTS correlated subqueries using TypeORM relation metadata for FK/table resolution.

## What Was Built

Implemented `visitLambdaExpr` in `TypeOrmFilterVisitor` to translate OData lambda expressions (`any`/`all`) into SQL EXISTS/NOT EXISTS correlated subqueries.

### Implementation

**`filter-visitor.ts`** — `TypeOrmFilterVisitor`:

- Added optional `repo?: Repository<ObjectLiteral>` as 6th constructor parameter
- Implemented `visitLambdaExpr` that:
  1. Guards on missing `repo` (returns early — test isolation)
  2. Looks up the relation by case-insensitive property name match against `repo.metadata.relations`
  3. Throws `ODataValidationError` for ManyToMany relations (not supported)
  4. Handles vacuous truth: `all()` with no predicate adds no WHERE condition
  5. Delegates to `buildAnyClause` / `buildAllClause` private methods (refactored for line limit)
- `buildAnyClause`: generates `EXISTS (SELECT 1 FROM "table" alias WHERE alias.fkCol = outer.pkCol [AND predicate])` — uses `InnerFilterExprBuilder` for parameterized predicate
- `buildAllClause`: generates `NOT EXISTS (SELECT 1 FROM "table" alias WHERE alias.fkCol = outer.pkCol AND NOT (predicate))` — also uses `InnerFilterExprBuilder`
- FK column resolved via `relation.inverseRelation?.joinColumns[0]?.databaseName` (OneToMany: FK is on the related side)
- Also passes `this.repo` to sub-visitors created inside `or` branches

**`typeorm-query-translator.ts`**: passes `this.repo` as 6th arg to `TypeOrmFilterVisitor`.

**`filter-visitor-lambda.spec.ts`**: 5 integration tests using real in-memory better-sqlite3 DataSource with inline `ParentEntity`/`ChildEntity` definitions (no test-app dependency).

### Test Coverage

| Test   | Scenario                                                  | Result                                     |
| ------ | --------------------------------------------------------- | ------------------------------------------ |
| Test 1 | `any()` with predicate — value gt 100                     | Returns only parent with qualifying child  |
| Test 2 | `all()` with predicate — value gt 40                      | Returns parents where ALL children qualify |
| Test 3 | `any()` no predicate — non-empty collection               | Returns only parents with children         |
| Test 4 | `all()` no predicate — vacuous truth                      | Returns all parents (no WHERE added)       |
| Test 5 | Parameterization security — injection string in predicate | SQL contains `:pN`, not raw value          |

### Requirements Closed

- **FILT-01**: `any()` with predicate → EXISTS subquery, verified by integration test
- **FILT-02**: `all()` with predicate → NOT EXISTS subquery, verified by integration test

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Class hoisting issue with entity order**

- **Found during:** RED phase — `ReferenceError: Cannot access 'ParentEntity' before initialization`
- **Issue:** `ChildEntity` referenced `ParentEntity` in its `@ManyToOne` arrow function. When `ChildEntity` was declared first in the file, the constant `entityType` at module scope triggered the hoisting error.
- **Fix:** Reordered class declarations so `ParentEntity` comes before `ChildEntity`.
- **Files modified:** `filter-visitor-lambda.spec.ts`

**2. [Rule 1 - Bug] Wrong SQLite driver type**

- **Found during:** RED phase — `DriverPackageNotInstalledError: SQLite package has not been found installed`
- **Issue:** Used `type: 'sqlite'` in DataSource config but the project uses `better-sqlite3` driver.
- **Fix:** Changed to `type: 'better-sqlite3'` — matching the `better-sqlite3` devDependency already present in `packages/typeorm/package.json`.
- **Files modified:** `filter-visitor-lambda.spec.ts`

**3. [Rule 2 - ESLint] TypeScript unsafe-any in test file**

- **Found during:** First commit attempt — ESLint pre-commit hook flagged `@typescript-eslint/no-unsafe-argument` and `@typescript-eslint/no-unsafe-return`
- **Issue:** Used `parentRepo as any` casts and `p.id` on `ObjectLiteral` (implicit `any`)
- **Fix:** Changed to proper type assertions (`as Repository<ObjectLiteral>`, `as ParentEntity`) and typed the mock `andWhere` return correctly
- **Files modified:** `filter-visitor-lambda.spec.ts`

## Known Stubs

None — all lambda translation paths are fully implemented.

## Threat Flags

None — the implementation follows the threat model from the plan exactly:

- T-07-05 mitigated: `InnerFilterExprBuilder` allocates `:pN` params for all literals in EXISTS body
- T-07-06 accepted: subAlias constructed from `node.variable` (safe — aliases don't appear in data position)
- T-07-07 accepted: collection name used for case-insensitive `find()` against TypeORM metadata only

## Self-Check

- [x] `filter-visitor-lambda.spec.ts` exists
- [x] `visitLambdaExpr` implemented (not no-op)
- [x] EXISTS and NOT EXISTS both present in `filter-visitor.ts`
- [x] `repo` is a private member of `TypeOrmFilterVisitor`
- [x] `DataSource` referenced in spec file
- [x] `describe('lambda` present in spec file
- [x] `this.repo` passed in `TypeOrmQueryTranslator`
- [x] All 204 tests pass
- [x] Build succeeds
- [x] Commit `6832c32` exists
