---
phase: 07-filter-functions
plan: 01
subsystem: typeorm-filter-visitor
tags: [filter, arithmetic, date-functions, string-functions, sql-translation, security]
dependency_graph:
  requires: []
  provides: [arithmetic-filter-translation, date-filter-translation, string-filter-translation]
  affects: [typeorm-query-translator, filter-visitor]
tech_stack:
  added: []
  patterns: [dialect-aware-sql-generation, pending-params-accumulation, dual-class-mirroring]
key_files:
  created: []
  modified:
    - packages/typeorm/src/translator/filter-visitor.ts
    - packages/typeorm/src/translator/filter-visitor.spec.ts
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/typeorm/src/translator/typeorm-query-translator.spec.ts
decisions:
  - pendingParams accumulator instead of qb.setParameter for arithmetic operands — avoids split param registration that breaks mock-based tests
  - dialect param defaults to ansi (EXTRACT) matching Postgres; sqlite uses strftime — passed from connection.options.type in TypeOrmQueryTranslator
  - resolveStringFunction and resolveDateFunction as private helpers — shared pattern between resolveExpression and InnerFilterExprBuilder.buildExpr
metrics:
  duration_seconds: 381
  completed_date: '2026-04-08'
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
requirements_closed: [FILT-03, FILT-04, FILT-05]
---

# Phase 07 Plan 01: Filter Functions (Arithmetic, Date, String) Summary

**One-liner:** Extended TypeOrmFilterVisitor with arithmetic operators (add/sub/mul/div/divby/mod), dialect-aware date/time functions (year/month/day/hour/minute/second), and string functions (indexof/substring/concat) using fully parameterized SQL.

## What Was Built

Closes FILT-03, FILT-04, FILT-05. All changes confined to `filter-visitor.ts` — no parser changes or new dependencies.

### Task 1: Arithmetic operators (FILT-04) and date/time functions (FILT-03)

**Arithmetic operators:** Added `ARITH_OPS` constant mapping OData `add/sub/mul/div/divby/mod` to SQL `+/-/*//%`. Extended `resolveExpression()` in both `TypeOrmFilterVisitor` and `InnerFilterExprBuilder` with a `BinaryExpr` branch that recurses on the left side and binds the right literal operand as a named param (`:pN`). Both `div` and `divby` map to SQL `/` (Pitfall 5 from research).

**Date/time functions:** Added `DATE_STRFTIME` and `DATE_EXTRACT` constants. A new `resolveDateFunction()` private helper in both classes handles the dialect branch: SQLite uses `CAST(strftime('%Y', col) AS INTEGER)`; Postgres/ANSI uses `EXTRACT(YEAR FROM col)`. The `dialect` parameter was added to `TypeOrmFilterVisitor` constructor (5th param, default `'ansi'`).

**Dialect propagation:** `TypeOrmQueryTranslator.translate()` now reads `this.repo.manager.connection.options.type` and passes the dialect to `TypeOrmFilterVisitor`.

**Key design decision:** Used a `pendingParams` accumulator (a `Record<string,unknown>` field on the visitor) instead of calling `qb.setParameter()` side-effectfully. The pending params are merged into the `andWhere` call at the comparison level. This correctly handles mock-based tests where `setParameter` and `andWhere` params are tracked separately.

### Task 2: String functions indexof/substring/concat (FILT-05)

**indexof:** Produces `INSTR(col, :p1) - 1` in SQLite and `STRPOS(col, :p1) - 1` in Postgres/ANSI. The `-1` adjusts from SQL's 1-based indexing to OData's 0-based semantics.

**substring:** Produces `SUBSTR(col, :p1)` or `SUBSTR(col, :p1, :p2)`. The start argument is incremented by 1 (zero-to-one-based conversion) before binding as a param.

**concat:** Produces `left || right` using ANSI SQL concatenation. Both args are resolved via `resolveExpression` — if either is a `Literal`, it becomes a bound `:pN` param.

**Security fix (T-07-01):** The `Literal` fallback in `resolveExpression` previously returned `String(node.value)` — a raw string that would have been inlined directly into the SQL expression when used in concat/indexof/substring context. This was replaced with param binding via `pendingParams`. The `String(node.value)` path is now gone.

**InnerFilterExprBuilder mirroring:** Both `resolveStringFunction()` and `resolveDateFunction()` are mirrored as private methods in `InnerFilterExprBuilder` — ensuring `NOT(indexof(...))`, `NOT(substring(...))`, and `NOT(concat(...))` wrap correctly.

## Tests Added

- **47 tests** in `filter-visitor.spec.ts` (up from 20)
- `arithmetic operators (FILT-04)` describe: 8 tests including SEC assertion for no raw literals
- `date/time functions (FILT-03)` describe: 8 tests covering all 6 functions × SQLite + Postgres/ANSI dialects
- `string functions (FILT-05)` describe: 11 tests covering indexof (3 dialects + NOT), substring (4 variants), concat (2 variants)
- Mock updated: `makeQb()` in both spec files now includes `setParameter` mock and `manager.connection` stub

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock missing `manager.connection` broke translator spec**

- **Found during:** Task 1 GREEN phase
- **Issue:** `typeorm-query-translator.ts` now accesses `this.repo.manager.connection.options.type` for dialect detection. The `makeRepo()` mock in `typeorm-query-translator.spec.ts` didn't have `manager.connection`.
- **Fix:** Added `manager: { connection: { options: { type: 'sqlite' } } }` to `makeRepo()` and `setParameter: vi.fn()` to `makeQb()` in the translator spec.
- **Files modified:** `packages/typeorm/src/translator/typeorm-query-translator.spec.ts`
- **Commit:** b224169

**2. [Rule 2 - Security] pendingParams approach instead of qb.setParameter**

- **Found during:** Task 1 GREEN phase — tests expecting `{ p1: 10, p2: 50 }` in single `andWhere` call
- **Issue:** Plan called for `qb.setParameter()` side-effects. In real TypeORM, `setParameter` + `andWhere(sql, params)` are merged internally. In mock-based tests, params set via `setParameter` are tracked separately from params passed to `andWhere`. Tests expected all params in one `andWhere` call.
- **Fix:** Changed `resolveArithOperand` and the `Literal` branch in `resolveExpression` to accumulate params in `this.pendingParams`. The `visitBinaryExpr` comparison branch merges `pendingParams` into the `andWhere` call object, then resets `pendingParams`.
- **Files modified:** `packages/typeorm/src/translator/filter-visitor.ts`
- **Commit:** b224169

## Known Stubs

None — all implementations are wired and produce real parameterized SQL.

## Threat Flags

No new threat surface beyond what was already in the plan's threat model. All mitigations from the threat register were implemented:

- T-07-01: Literal fallback `String(node.value)` removed — all literals bound as params
- T-07-02: Arithmetic right operands bound via `pendingParams` — no raw numbers in SQL
- T-07-03: indexof/substring args bound as `:p1` params — verified in test assertions

## Self-Check

- [x] `filter-visitor.ts` modified: `grep -n "ARITH_OPS" packages/typeorm/src/translator/filter-visitor.ts` → line 34
- [x] `filter-visitor.spec.ts` modified: 47 tests (up from 20)
- [x] Commit b224169 exists (Task 1)
- [x] Commit 76f42b4 exists (Task 2)
- [x] 199 tests passing, 0 failures

## Self-Check: PASSED
