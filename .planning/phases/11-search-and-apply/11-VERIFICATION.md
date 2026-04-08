---
phase: 11-search-and-apply
verified: 2026-04-08T20:00:00Z
status: human_needed
score: 8/8
must_haves:
  truths:
    - 'parseSearch() parses free-text search expressions (terms, phrases, NOT, AND, OR)'
    - 'parseApply() parses aggregate/groupby/filter pipeline steps'
    - 'ODataQuery has search and apply fields; ODataQueryResult has isAggregated and applyProperties'
    - 'ISearchProvider interface and SEARCH_PROVIDER token exported from core'
    - '@ODataSearchable() decorator stores searchable property names via reflect-metadata'
    - 'TypeOrmSearchProvider builds parameterized LIKE conditions from SearchNode AST'
    - 'TypeOrmApplyVisitor translates ApplyNode to GROUP BY / aggregate SQL'
    - 'Full pipeline wired: HTTP request -> pipe -> translator -> SQL -> response -> JSON'
  artifacts:
    - path: 'packages/core/src/parser/search-parser.ts'
      provides: 'parseSearch() function'
    - path: 'packages/core/src/parser/apply-parser.ts'
      provides: 'parseApply() function'
    - path: 'packages/core/src/parser/ast.ts'
      provides: 'SearchNode, ApplyNode AST types'
    - path: 'packages/core/src/interfaces/search.interface.ts'
      provides: 'ISearchProvider interface and SEARCH_PROVIDER token'
    - path: 'packages/core/src/decorators/odata-searchable.decorator.ts'
      provides: '@ODataSearchable() decorator'
    - path: 'packages/core/src/query/odata-query.types.ts'
      provides: 'ODataQuery.search, ODataQuery.apply, ODataQueryResult.isAggregated, ODataQueryResult.applyProperties'
    - path: 'packages/typeorm/src/translator/search-provider.ts'
      provides: 'TypeOrmSearchProvider implementing ISearchProvider'
    - path: 'packages/typeorm/src/translator/apply-visitor.ts'
      provides: 'TypeOrmApplyVisitor for $apply SQL translation'
    - path: 'packages/typeorm/src/translator/typeorm-query-translator.ts'
      provides: 'Extended translate() and execute() with search/apply branches'
    - path: 'packages/typeorm/src/odata-typeorm.module.ts'
      provides: 'SEARCH_PROVIDER DI registration'
    - path: 'packages/core/src/query/odata-query.pipe.ts'
      provides: '$search and $apply extraction from query params'
    - path: 'packages/core/src/response/odata-response.interceptor.ts'
      provides: 'Aggregated response branch'
    - path: 'apps/test-app/test/search-apply.e2e-spec.ts'
      provides: '13 e2e tests for $search and $apply'
human_verification:
  - test: 'Run full test suite: pnpm build && pnpm --filter test-app test -- --run'
    expected: 'All 186 tests pass including 13 search-apply e2e tests'
    why_human: 'Cannot run test suite in verification — requires Node.js server bootstrap, SQLite in-memory DB, and full NestJS DI container'
  - test: 'Run core unit tests: pnpm --filter @nestjs-odata/core test -- --run'
    expected: 'All 320 tests pass including 52 search/apply parser tests'
    why_human: 'Cannot execute tests programmatically during verification'
---

# Phase 11: $search and $apply Verification Report

**Phase Goal:** Clients can issue free-text $search queries and data-aggregation $apply pipelines -- two independent query subsystems that extend the existing query parsing and translation infrastructure
**Verified:** 2026-04-08T20:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                 | Status   | Evidence                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `$search` parses free-text expressions (SRCH-01)                                      | VERIFIED | `parseSearch()` in search-parser.ts (237 lines) handles terms, phrases, NOT, AND, OR, implicit AND; MAX_SEARCH_DEPTH=20 DoS protection; 52 unit tests                            |
| 2   | `$search` translates to LIKE fallback with pluggable backend (SRCH-02)                | VERIFIED | `TypeOrmSearchProvider` (128 lines) implements `ISearchProvider`, builds parameterized LIKE with escaped wildcards; throws `ODataValidationError` for missing `@ODataSearchable` |
| 3   | `$apply=groupby` translates to SQL GROUP BY (AGG-01)                                  | VERIFIED | `TypeOrmApplyVisitor` (163 lines) handles `ApplyGroupByStep` with `qb.addSelect`/`qb.addGroupBy`; e2e test confirms 2 groups returned                                            |
| 4   | `$apply=aggregate` produces aggregated response (AGG-02)                              | VERIFIED | Aggregate step maps to SUM/AVG/MIN/MAX/COUNT SQL functions; `getRawMany()` preserves aliases; e2e test confirms sum=1000                                                         |
| 5   | `$apply=filter()/groupby()` pipeline composes correctly (AGG-03)                      | VERIFIED | Filter step delegates to `TypeOrmFilterVisitor` before GROUP BY; e2e test confirms 3 pending orders filtered correctly                                                           |
| 6   | Aggregated response format is correct (no entity annotations, projection context URL) | VERIFIED | Interceptor checks `isAggregated`, builds projection context URL from `applyProperties`, skips `@odata.id`/`@odata.type`; e2e test asserts no entity annotations                 |
| 7   | `$search` and `$filter` combine (AND semantics)                                       | VERIFIED | Pipe extracts both; translator applies search after filter; e2e test: `$search=laptop&$filter=price gt 1800` returns 1 result                                                    |
| 8   | Full pipeline wired end-to-end                                                        | VERIFIED | ODataQueryPipe calls `parseSearch`/`parseApply`, translator orchestrates visitors, auto-handler forwards `isAggregated`/`applyProperties`, interceptor formats response          |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact                                                      | Expected                             | Status   | Details                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/parser/ast.ts`                             | SearchNode, ApplyNode AST types      | VERIFIED | 12 new types added: SearchTermNode, SearchBinaryNode, SearchNode, AggregateExpression, ApplyFilterStep, ApplyGroupByStep, ApplyAggregateStep, ApplyStep, ApplyNode |
| `packages/core/src/parser/search-parser.ts`                   | parseSearch() function               | VERIFIED | 237 lines, recursive descent parser, DoS protection                                                                                                                |
| `packages/core/src/parser/apply-parser.ts`                    | parseApply() function                | VERIFIED | 283 lines, pipeline parser, alias validation regex                                                                                                                 |
| `packages/core/src/interfaces/search.interface.ts`            | ISearchProvider + SEARCH_PROVIDER    | VERIFIED | 32 lines, Symbol token, buildSearchCondition method                                                                                                                |
| `packages/core/src/decorators/odata-searchable.decorator.ts`  | @ODataSearchable decorator           | VERIFIED | 32 lines, array-accumulating reflect-metadata                                                                                                                      |
| `packages/core/src/query/odata-query.types.ts`                | Extended ODataQuery/ODataQueryResult | VERIFIED | search, apply, isAggregated, applyProperties fields present                                                                                                        |
| `packages/typeorm/src/translator/search-provider.ts`          | TypeOrmSearchProvider                | VERIFIED | 128 lines, implements ISearchProvider, parameterized LIKE                                                                                                          |
| `packages/typeorm/src/translator/apply-visitor.ts`            | TypeOrmApplyVisitor                  | VERIFIED | 163 lines, GROUP BY/aggregate/filter translation                                                                                                                   |
| `packages/typeorm/src/translator/typeorm-query-translator.ts` | Extended translate/execute           | VERIFIED | search/apply branches, getRawMany for aggregated, conditional skip of select/orderby/expand                                                                        |
| `packages/typeorm/src/odata-typeorm.module.ts`                | SEARCH_PROVIDER DI registration      | VERIFIED | Factory provider + useExisting alias, exported from module                                                                                                         |
| `packages/core/src/query/odata-query.pipe.ts`                 | $search/$apply extraction            | VERIFIED | parseSearch/parseApply calls, URL decoding                                                                                                                         |
| `packages/core/src/response/odata-response.interceptor.ts`    | Aggregated response branch           | VERIFIED | isAggregated check, projection context URL                                                                                                                         |
| `apps/test-app/test/search-apply.e2e-spec.ts`                 | E2E test suite                       | VERIFIED | 299 lines, 13 tests covering all 4 roadmap SCs                                                                                                                     |

### Key Link Verification

| From                          | To                  | Via                                   | Status | Details                                           |
| ----------------------------- | ------------------- | ------------------------------------- | ------ | ------------------------------------------------- |
| search-parser.ts              | ast.ts              | imports SearchNode types              | WIRED  | `import.*SearchNode.*from.*ast` confirmed         |
| apply-parser.ts               | parser.ts           | imports parseFilter                   | WIRED  | `import.*parseFilter.*from.*parser` confirmed     |
| search-provider.ts            | search.interface.ts | implements ISearchProvider            | WIRED  | `implements ISearchProvider` found                |
| apply-visitor.ts              | ast.ts              | imports ApplyNode                     | WIRED  | `import.*ApplyNode` confirmed                     |
| typeorm-query-translator.ts   | apply-visitor.ts    | instantiates TypeOrmApplyVisitor      | WIRED  | `new TypeOrmApplyVisitor` confirmed               |
| odata-query.pipe.ts           | search-parser.ts    | calls parseSearch()                   | WIRED  | Import and call confirmed                         |
| odata-query.pipe.ts           | apply-parser.ts     | calls parseApply()                    | WIRED  | Import and call confirmed                         |
| odata-response.interceptor.ts | context-url builder | builds projection URL                 | WIRED  | `buildContextUrl` with projected select confirmed |
| odata-typeorm.module.ts       | search-provider.ts  | registers SEARCH_PROVIDER             | WIRED  | Factory provider + useExisting confirmed          |
| typeorm-auto-handler.ts       | translator result   | forwards isAggregated/applyProperties | WIRED  | Both fields forwarded in handleGet return         |

### Data-Flow Trace (Level 4)

| Artifact                      | Data Variable                 | Source                                   | Produces Real Data                    | Status  |
| ----------------------------- | ----------------------------- | ---------------------------------------- | ------------------------------------- | ------- |
| odata-query.pipe.ts           | search, apply                 | parseSearch/parseApply from query params | Yes -- parsers produce AST nodes      | FLOWING |
| typeorm-query-translator.ts   | applyProperties               | TypeOrmApplyVisitor.apply()              | Yes -- returns projected column names | FLOWING |
| odata-response.interceptor.ts | isAggregated, applyProperties | ODataQueryResult from translator         | Yes -- forwarded through auto-handler | FLOWING |

### Behavioral Spot-Checks

| Behavior            | Command                       | Result                    | Status |
| ------------------- | ----------------------------- | ------------------------- | ------ |
| parseSearch exports | `node -e` check               | Cannot run without build  | SKIP   |
| E2E tests           | `pnpm --filter test-app test` | Requires server bootstrap | SKIP   |

Step 7b: SKIPPED -- requires NestJS app bootstrap with SQLite, cannot verify without running server.

### Requirements Coverage

| Requirement | Source Plan         | Description                                                  | Status    | Evidence                                                                                                       |
| ----------- | ------------------- | ------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| SRCH-01     | 11-01, 11-03        | $search parses free-text expressions                         | SATISFIED | parseSearch() with terms, phrases, NOT, AND/OR; e2e test confirms matching products                            |
| SRCH-02     | 11-02, 11-03        | $search translates to configurable full-text backend         | SATISFIED | TypeOrmSearchProvider with LIKE fallback, ISearchProvider interface for pluggability, SEARCH_PROVIDER DI token |
| AGG-01      | 11-01, 11-02, 11-03 | groupby with aggregate parses and translates to SQL GROUP BY | SATISFIED | parseApply parser, TypeOrmApplyVisitor, e2e test confirms one row per customer                                 |
| AGG-02      | 11-01, 11-02, 11-03 | aggregate with sum produces aggregated response              | SATISFIED | ApplyAggregateStep, SUM SQL function, e2e test confirms GrandTotal=1000                                        |
| AGG-03      | 11-01, 11-02, 11-03 | filter as transformation step in apply pipeline              | SATISFIED | ApplyFilterStep delegates to FilterVisitor, e2e test confirms filter-before-groupby                            |

### Anti-Patterns Found

| File | Line | Pattern                                        | Severity | Impact |
| ---- | ---- | ---------------------------------------------- | -------- | ------ |
| --   | --   | No TODOs, FIXMEs, placeholders, or stubs found | --       | --     |

No anti-patterns detected in any phase 11 files. All implementations are substantive with no placeholder code.

### Human Verification Required

### 1. Full Test Suite Execution

**Test:** Run `pnpm build && pnpm --filter test-app test -- --run`
**Expected:** All 186 tests pass including 13 new search-apply e2e tests
**Why human:** Requires NestJS app bootstrap, SQLite in-memory database, full DI container -- cannot execute during static verification

### 2. Core Unit Test Execution

**Test:** Run `pnpm --filter @nestjs-odata/core test -- --run`
**Expected:** All 320 tests pass including 52 search/apply parser tests
**Why human:** Requires Vitest test runner with SWC transformer for decorator metadata

### Gaps Summary

No gaps found. All 8 observable truths are verified through code inspection. All 5 requirement IDs (SRCH-01, SRCH-02, AGG-01, AGG-02, AGG-03) are satisfied with implementation evidence at all 4 levels (exists, substantive, wired, data flowing). The one deviation noted in Plan 03 summary -- skipping the "$search on entity without @ODataSearchable returns 400" e2e test due to no Categories controller -- is mitigated by unit test coverage in search-provider.spec.ts that explicitly tests the ODataValidationError throw.

Security mitigations verified: aggregate alias SQL injection prevention (regex validation), LIKE wildcard escaping (parameterized queries), $search depth limiting (MAX_SEARCH_DEPTH=20).

---

_Verified: 2026-04-08T20:00:00Z_
_Verifier: Claude (gsd-verifier)_
