---
phase: 03-query-engine-and-response-format
plan: '01'
subsystem: query
tags: [odata, query, types, pipe, validation, edm]
dependency_graph:
  requires:
    - packages/core/src/parser/ast.ts
    - packages/core/src/parser/parser.ts
    - packages/core/src/parser/errors.ts
    - packages/core/src/edm/edm-registry.ts
    - packages/core/src/edm/edm-entity-type.ts
    - packages/core/src/edm/edm-types.ts
    - packages/core/src/tokens.ts
    - packages/core/src/odata.module.ts
  provides:
    - ODataQuery interface (typed query AST + metadata)
    - ODataQueryResult interface (structured execution results)
    - ODataValidationError class (semantic field validation errors)
    - ODataQueryPipe (NestJS PipeTransform for request parsing)
    - IQueryTranslator (refined with typed signatures)
  affects:
    - packages/core/src/interfaces/query-translator.interface.ts
    - packages/core/src/index.ts
tech_stack:
  added: []
  patterns:
    - NestJS PipeTransform for OData query parsing
    - Discriminated union recursion for FilterNode AST validation
    - Object.setPrototypeOf for correct instanceof behavior in transpiled Error subclasses
key_files:
  created:
    - packages/core/src/query/odata-query.types.ts
    - packages/core/src/query/odata-validation.error.ts
    - packages/core/src/query/odata-validation.error.spec.ts
    - packages/core/src/query/odata-query.pipe.ts
    - packages/core/src/query/odata-query.pipe.spec.ts
    - packages/core/src/query/index.ts
  modified:
    - packages/core/src/interfaces/query-translator.interface.ts
    - packages/core/src/interfaces/index.ts
    - packages/core/src/index.ts
decisions:
  - 'ODataQuery extends QueryOptions with count (boolean) and entitySetName (string) — both absent from parser output, injected by the pipe'
  - 'IQueryTranslator refined to typed generic interface IQueryTranslator<TQuery> with separate translate() and execute() methods for testability'
  - 'ODataQueryPipe validates all $filter/$select/$orderby PropertyAccessNode path[0] values against EdmRegistry before returning ODataQuery'
  - '$top clamped to options.maxTop (default 1000) at pipe level — never reaches the translator unchecked'
metrics:
  duration_minutes: 6
  completed_date: '2026-04-07'
  tasks_completed: 2
  files_created: 6
  files_modified: 3
---

# Phase 3 Plan 01: Query Types, Validation Error, and ODataQueryPipe Summary

ODataQuery/ODataQueryResult interfaces, ODataValidationError, refined IQueryTranslator<TQuery>, and ODataQueryPipe with EdmRegistry field validation and maxTop clamping.

## What Was Built

### Task 1: Core query types, validation error, and refined IQueryTranslator

- **`ODataQuery`** interface extending the parser's `QueryOptions` with `count: boolean` (from `$count=true`) and `entitySetName: string` (for context URL and validation). These two fields are absent from the parser output and are injected by the pipe.
- **`ODataQueryResult<T>`** interface with `items`, `count`, `nextLink`, and `select` for controller-level response construction.
- **`ODataValidationError`** error class with `entityTypeName` and `propertyName` fields — semantically distinct from `ODataParseError` (syntax vs field validation). Uses `Object.setPrototypeOf` for correct `instanceof` in transpiled ES5 output.
- **`IQueryTranslator<TQuery>`** refined from `unknown` to typed: `translate(query: ODataQuery, entityType: EdmEntityType): TQuery` and `execute(translatedQuery: TQuery, includeCount: boolean): Promise<ODataQueryResult>`. The two-method split separates translation from execution for independent unit testing.

Commits: `81eb342`

### Task 2: ODataQueryPipe — parse, validate, and clamp

- **`ODataQueryPipe`** implements NestJS `PipeTransform<Record<string, string>, ODataQuery>`.
- Receives Express `req.query` as a `Record<string, string>`, reconstructs the query string, delegates to `parseQuery()`.
- Extracts `$count=true` separately (the parser does not handle `$count`).
- Reads `entitySetName` from `metadata.data` (populated by `@ODataQuery(entitySetName)` param decorator).
- Validates all `PropertyAccessNode` references in `$filter`, `$select` items, and `$orderby` expressions against `EdmRegistry.getEntityType()` — throws `ODataValidationError` for any unknown property (T-03-01).
- Clamps `$top` to `options.maxTop` from `ODataModuleResolvedOptions` (T-03-03).

Commits: `07dac6a`

## Tests

| File                                       | Tests  | Status   |
| ------------------------------------------ | ------ | -------- |
| `src/query/odata-validation.error.spec.ts` | 3      | PASS     |
| `src/query/odata-query.pipe.spec.ts`       | 10     | PASS     |
| **Total**                                  | **13** | **PASS** |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

| Threat                                         | Mitigation                                                                                                                           | Status    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| T-03-01 Tampering via $filter/$select/$orderby | `validateFilterNode()` and `validateSelectItem()` throw `ODataValidationError` for unknown properties                                | Mitigated |
| T-03-02 Info Disclosure via error messages     | `ODataValidationError` includes only property name and entity type name (user's own query input) — no stack traces or internal paths | Mitigated |
| T-03-03 DoS via unbounded $top                 | `top` clamped to `options.maxTop` at pipe level before any translator sees it                                                        | Mitigated |

## Known Stubs

None — all interfaces and implementations are fully functional.

## Self-Check: PASSED

All 8 expected files found on disk. Both commits (81eb342, 07dac6a) verified in git log.
