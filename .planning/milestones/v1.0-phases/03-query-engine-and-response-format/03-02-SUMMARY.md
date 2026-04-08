---
phase: 03-query-engine-and-response-format
plan: '02'
subsystem: query
tags: [odata, query, typeorm, visitor, filter, select, orderby, pagination, security]
dependency_graph:
  requires:
    - packages/core/src/parser/ast.ts
    - packages/core/src/parser/visitor.ts
    - packages/core/src/query/odata-query.types.ts
    - packages/core/src/interfaces/query-translator.interface.ts
    - packages/core/src/edm/edm-entity-type.ts
  provides:
    - TypeOrmFilterVisitor (FilterVisitor<void> over SelectQueryBuilder)
    - TypeOrmSelectVisitor ($select projection with key property guarantee)
    - TypeOrmOrderByVisitor ($orderby via orderBy/addOrderBy)
    - TypeOrmPaginationVisitor ($top/$skip via take/skip)
    - TypeOrmQueryTranslator (IQueryTranslator<SelectQueryBuilder<ObjectLiteral>>)
  affects:
    - packages/typeorm/src/index.ts
tech_stack:
  added: []
  patterns:
    - Visitor pattern for AST traversal (FilterVisitor<void>)
    - Named parameter binding (:p1, :p2) for SQL injection prevention
    - LIKE special-character escaping for wildcard injection prevention
    - Deterministic visitor orchestration order (filter->select->orderby->pagination)
key_files:
  created:
    - packages/typeorm/src/translator/filter-visitor.ts
    - packages/typeorm/src/translator/filter-visitor.spec.ts
    - packages/typeorm/src/translator/select-visitor.ts
    - packages/typeorm/src/translator/select-visitor.spec.ts
    - packages/typeorm/src/translator/orderby-visitor.ts
    - packages/typeorm/src/translator/orderby-visitor.spec.ts
    - packages/typeorm/src/translator/pagination-visitor.ts
    - packages/typeorm/src/translator/pagination-visitor.spec.ts
    - packages/typeorm/src/translator/typeorm-query-translator.ts
    - packages/typeorm/src/translator/typeorm-query-translator.spec.ts
    - packages/typeorm/src/translator/index.ts
  modified:
    - packages/typeorm/src/index.ts
decisions:
  - 'TypeOrmPaginationVisitor method named paginate() (not apply()) to avoid ESLint prefer-spread false positive on .apply() calls'
  - 'All visitor constructors accept SelectQueryBuilder<ObjectLiteral> (not unknown) to satisfy TypeORM generic constraint'
  - 'InnerFilterExprBuilder helper class used for NOT(...) wrapping — avoids recursive andWhere calls that would add extra conditions'
  - 'FilterVisitor<void> pattern: visit methods call qb.andWhere() as a side effect rather than returning SQL strings, keeping paramCount state on the visitor instance'
metrics:
  duration_minutes: 15
  completed_date: '2026-04-07'
  tasks_completed: 2
  files_created: 11
  files_modified: 1
---

# Phase 3 Plan 02: TypeORM Query Translator with Visitor Classes Summary

TypeORM query translation engine — four visitor classes (FilterVisitor, SelectVisitor, OrderByVisitor, PaginationVisitor) plus TypeOrmQueryTranslator orchestrating them in deterministic order, with fully parameterized queries and LIKE-escape for security.

## What Was Built

### Task 1: Failing tests (TDD RED)

All five spec files written before implementation, covering:

- FilterVisitor: 18 tests (comparison ops, logical and/not, string functions, LIKE escaping, scalar functions, parameter uniqueness, security assertion)
- SelectVisitor: 6 tests (projection, key inclusion, dedup, all/empty passthrough)
- OrderByVisitor: 4 tests (single/multi, asc/desc)
- PaginationVisitor: 5 tests (take/skip, top=0, undefined passthrough)
- TypeOrmQueryTranslator: 9 tests (visitor orchestration, execute getMany/getManyAndCount, ordering)

### Task 2: Implementation (TDD GREEN + type-clean)

**`TypeOrmFilterVisitor`** implements `FilterVisitor<void>` from `@nestjs-odata/core`. Maintains a `paramCount` counter for unique `:p1`, `:p2`, ... named parameters.

- Comparison ops: `eq=`, `ne!=`, `lt<`, `le<=`, `gt>`, `ge>=` mapped to `qb.andWhere('alias.prop OP :pN', { pN: value })`
- `and`: recurses into left and right — each side appends its own `andWhere` call
- `not`: delegates to `InnerFilterExprBuilder` helper that constructs an expression string, then wraps in `NOT (...)`
- `contains/startswith/endswith`: LIKE functions with `escapeLike()` escaping `%` → `\%` and `_` → `\_` before pattern construction (T-03-05)
- Scalar functions `length/tolower/toupper/trim`: resolved to `LENGTH()/LOWER()/UPPER()/TRIM()` SQL expressions via `resolveExpression()`
- Zero string interpolation — all user-supplied values bound as named parameters (T-03-04)

**`TypeOrmSelectVisitor`** applies `$select` via `qb.select(columns)`. Always adds `entityType.keyProperties` to the column list and deduplicates. No-ops on `select.all` or empty items.

**`TypeOrmOrderByVisitor`** maps the first `OrderByItem` to `qb.orderBy()` and subsequent items to `qb.addOrderBy()`.

**`TypeOrmPaginationVisitor`** calls `qb.take(top)` and/or `qb.skip(skip)` only when the values are not undefined. Method named `paginate()` (not `apply()`) to avoid ESLint `prefer-spread` false positive.

**`TypeOrmQueryTranslator`** `@Injectable()` class implementing `IQueryTranslator<SelectQueryBuilder<ObjectLiteral>>`. Orchestrates visitors in order: filter → select → orderby → pagination. `execute()` calls `getMany()` or `getManyAndCount()` depending on `includeCount`.

Commits: `cae2338`

## Tests

| File                                              | Tests   | Status   |
| ------------------------------------------------- | ------- | -------- |
| `src/translator/filter-visitor.spec.ts`           | 18      | PASS     |
| `src/translator/select-visitor.spec.ts`           | 6       | PASS     |
| `src/translator/orderby-visitor.spec.ts`          | 4       | PASS     |
| `src/translator/pagination-visitor.spec.ts`       | 5       | PASS     |
| `src/translator/typeorm-query-translator.spec.ts` | 9       | PASS     |
| **Total (translator)**                            | **42**  | **PASS** |
| **Total (full package)**                          | **105** | **PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeORM SelectQueryBuilder<T> generic constraint**

- **Found during:** Task 2 (type check)
- **Issue:** TypeORM requires `T extends ObjectLiteral` for `SelectQueryBuilder<T>`. Using `unknown` produced 10 type errors.
- **Fix:** Changed all visitor constructors and translator to use `SelectQueryBuilder<ObjectLiteral>` / `Repository<ObjectLiteral>`
- **Files modified:** All 4 visitor files + typeorm-query-translator.ts
- **Commit:** `cae2338`

**2. [Rule 1 - Bug] ESLint prefer-spread false positive on .apply()**

- **Found during:** Pre-commit hook
- **Issue:** ESLint `prefer-spread` rule treats `visitor.apply(args)` as `Function.prototype.apply` and requires spread syntax. This is a false positive for a method named `apply`.
- **Fix:** Renamed `TypeOrmPaginationVisitor.apply()` to `paginate()`. Updated spec and translator call site.
- **Files modified:** pagination-visitor.ts, pagination-visitor.spec.ts, typeorm-query-translator.ts
- **Commit:** `cae2338`

**3. [Rule 2 - Missing] ESLint unbound-method in spec files**

- **Found during:** Pre-commit hook
- **Issue:** `expect(qb.someMethod).toHaveBeenCalled()` triggered `@typescript-eslint/unbound-method` because mock methods were passed as unbound references.
- **Fix:** Typed mock QBs with `MockInstance` types and extracted mock function references to local variables before passing to `expect()`.
- **Files modified:** All 5 spec files
- **Commit:** `cae2338`

## Threat Model Coverage

| Threat                                   | Mitigation                                                                                                                       | Status    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| T-03-04 SQL injection via literal values | All values bound as `:p1`, `:p2`... named params — zero interpolation. Security test asserts SQL fragment contains no raw value. | Mitigated |
| T-03-05 Wildcard injection via LIKE      | `escapeLike()` escapes `%`→`\%` and `_`→`\_` before pattern construction. Tests verify escaped output.                           | Mitigated |
| T-03-06 $select column smuggling         | SelectVisitor uses only `item.path[0]` from already-validated `SelectNode` (validated by ODataQueryPipe in T-03-01).             | Mitigated |
| T-03-07 Deep filter nesting DoS          | Accepted — deep nesting already limited to 50 levels by parser. Filter AST node count limit is Phase 5 scope.                    | Accepted  |

## Known Stubs

None — all visitor classes and the translator are fully implemented and wired.

## Self-Check: PASSED
