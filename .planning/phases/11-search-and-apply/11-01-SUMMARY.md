---
phase: 11-search-and-apply
plan: 01
subsystem: parser
tags: [search, apply, ast, parser, decorator, interfaces]
dependency_graph:
  requires: []
  provides:
    - SearchNode (SearchTermNode | SearchBinaryNode)
    - ApplyNode (ApplyStep pipeline)
    - parseSearch()
    - parseApply()
    - ISearchProvider + SEARCH_PROVIDER
    - ODataSearchable decorator + getSearchableProperties()
    - ODataQuery.search / ODataQuery.apply
    - ODataQueryResult.isAggregated / ODataQueryResult.applyProperties
  affects:
    - packages/core/src/parser/ast.ts
    - packages/core/src/query/odata-query.types.ts
    - packages/core/src/interfaces/index.ts
    - packages/core/src/decorators/index.ts
tech_stack:
  added: []
  patterns:
    - Discriminated union AST nodes with readonly kind field
    - Standalone string tokenizer for $search (not reusing OData filter tokenizer)
    - Depth-tracking pipeline splitter for $apply
    - Reflect.metadata array accumulation pattern for multi-property decorators
key_files:
  created:
    - packages/core/src/parser/search-parser.ts
    - packages/core/src/parser/apply-parser.ts
    - packages/core/src/parser/search-parser.spec.ts
    - packages/core/src/parser/apply-parser.spec.ts
    - packages/core/src/parser/search-apply-ast.spec.ts
    - packages/core/src/interfaces/search.interface.ts
    - packages/core/src/decorators/odata-searchable.decorator.ts
  modified:
    - packages/core/src/parser/ast.ts
    - packages/core/src/parser/index.ts
    - packages/core/src/query/odata-query.types.ts
    - packages/core/src/interfaces/index.ts
    - packages/core/src/decorators/metadata-keys.ts
    - packages/core/src/decorators/index.ts
decisions:
  - MAX_SEARCH_DEPTH=20 operators (not 20 recursion levels) — counted upfront on token list for O(n) check
  - Search uses standalone tokenizer (not OData filter lexer) — $search is free-text, not OData filter syntax
  - ODataSearchable accumulates string[] (not single string) — multiple properties can be searchable per entity
  - Post-groupby filter rejected at parse time — HAVING translation deferred to future version per A5
metrics:
  duration_seconds: 519
  completed_date: '2026-04-08'
  tasks_completed: 2
  tasks_total: 2
  files_created: 7
  files_modified: 6
  tests_added: 52
  tests_total_after: 320
---

# Phase 11 Plan 01: Search/Apply AST, Parsers, and Interfaces Summary

**One-liner:** Standalone $search and $apply parsers with AST nodes, ISearchProvider interface, @ODataSearchable decorator, and ODataQuery extensions — all type-safe and SQL-injection-protected.

## Tasks Completed

| Task | Name                                                                | Commit  | Files                                                                                                                                        |
| ---- | ------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | AST nodes, ISearchProvider, @ODataSearchable, ODataQuery extensions | a46cde4 | ast.ts, odata-query.types.ts, search.interface.ts, odata-searchable.decorator.ts, metadata-keys.ts, decorators/index.ts, interfaces/index.ts |
| 2    | parseSearch() and parseApply() parser functions                     | bb52845 | search-parser.ts, apply-parser.ts, search-parser.spec.ts, apply-parser.spec.ts, parser/index.ts                                              |

## What Was Built

### AST Nodes (ast.ts)

New discriminated union types appended after existing `QueryOptions`:

- `SearchTermNode` — single search term with optional `negated` flag
- `SearchBinaryNode` — binary AND/OR node combining two `SearchNode` children
- `SearchNode` — union type for $search expressions
- `AggregateExpression` — `property`, `method`, `alias` for aggregate computations
- `ApplyFilterStep` / `ApplyGroupByStep` / `ApplyAggregateStep` — $apply pipeline steps
- `ApplyStep` — union of the three step types
- `ApplyNode` — root node with `steps: readonly ApplyStep[]`

### ODataQuery / ODataQueryResult Extensions

- `ODataQuery.search?: SearchNode` — parsed $search expression
- `ODataQuery.apply?: ApplyNode` — parsed $apply pipeline
- `ODataQueryResult.isAggregated?: boolean` — signals aggregated result to controller
- `ODataQueryResult.applyProperties?: string[]` — property names for context URL

### parseSearch() (search-parser.ts)

Standalone string tokenizer + recursive builder:

- Handles bare words, double-quoted phrases, NOT prefix, explicit AND/OR, implicit AND
- OR has lower precedence than AND
- Left-associative tree building for multiple terms
- `MAX_SEARCH_DEPTH = 20` binary operator limit enforced upfront on token count (O(n) check)
- Throws `ODataParseError` for empty input and depth-exceeded input

### parseApply() (apply-parser.ts)

Pipeline parser using depth-tracked '/' splitter:

- `filter(...)` steps parsed via existing `parseFilter()` from parser.ts
- `aggregate(...)` steps with comma-separated `property with method as alias` expressions
- `groupby((...), aggregate(...))` steps with property list + optional aggregate
- `$count as alias` shorthand for record count
- Alias validation: `/^[A-Za-z_][A-Za-z0-9_]*$/` prevents SQL injection (T-11-01)
- Post-groupby `filter()` rejected with clear error (HAVING not supported, A5)
- Throws `ODataParseError` for empty input, unrecognized steps, invalid aliases

### ISearchProvider + SEARCH_PROVIDER (search.interface.ts)

Follows the exact `IETagProvider` pattern:

- `SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER')` injection token
- `buildSearchCondition(searchNode, entitySetName, alias)` returns `{ condition, params } | null`

### @ODataSearchable decorator (odata-searchable.decorator.ts)

Array-accumulating reflect-metadata pattern:

- Each `@ODataSearchable()` on a property appends the property name to the stored array
- `getSearchableProperties(EntityClass)` returns `string[]` (empty if none decorated)
- `ODATA_SEARCHABLE_KEY = Symbol('nestjs-odata:odata-searchable')` in metadata-keys.ts

## Test Results

- 52 new unit tests across 3 new spec files
- All 320 tests in the package pass (29 test files)
- 0 failures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DoS depth check used `>` instead of `>=`**

- **Found during:** Task 2 test run
- **Issue:** `MAX_SEARCH_DEPTH=20` with `> 20` check allowed exactly 20 operators (21 terms), but the test expected 20 AND operators (21 terms) to trigger the limit
- **Fix:** Changed to `>= MAX_SEARCH_DEPTH` so exactly 20 operators triggers the error, keeping the semantic "max 19 binary operators = max 20 terms"
- **Files modified:** packages/core/src/parser/search-parser.ts

**2. [Rule 2 - Lint] Unused SearchTermNode import in spec**

- **Found during:** Task 2 commit (pre-commit ESLint hook)
- **Fix:** Removed unused `SearchTermNode` type import from search-parser.spec.ts (kept `SearchBinaryNode` which is used for type narrowing)
- **Files modified:** packages/core/src/parser/search-parser.spec.ts

## Threat Flags

| Flag                         | File             | Description                                                                                                 |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| threat_flag: alias-injection | apply-parser.ts  | Aggregate aliases validated with /^[A-Za-z\_][A-Za-z0-9_]\*$/ before reaching SQL layer (T-11-01 mitigated) |
| threat_flag: dos-search      | search-parser.ts | MAX_SEARCH_DEPTH=20 enforced upfront on token count (T-11-02 mitigated)                                     |

## Known Stubs

None — all interfaces and types are fully defined. No placeholder implementations.

## Self-Check: PASSED

All required files exist, all commits verified, all 320 tests pass.
