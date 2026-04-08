# Phase 11: $search and $apply - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Two independent query subsystems: free-text `$search` with pluggable backend, and data-aggregation `$apply` pipelines translated to single SQL queries. Requirements: SRCH-01, SRCH-02, AGG-01, AGG-02, AGG-03.

</domain>

<decisions>
## Implementation Decisions

### $search Backend Strategy

- **D-01:** LIKE fallback + pluggable FTS. Default implementation uses SQL `LIKE %term%` across configurable searchable fields (marked via decorator or config). Users can plug in a custom search provider (e.g., PostgreSQL tsvector, Elasticsearch) via an `ISearchProvider` interface — same adapter pattern as `IETagProvider` from Phase 9. Core defines the interface, TypeORM adapter provides the LIKE default.

### $apply Pipeline Design

- **D-02:** Single SQL query. Translate the entire `$apply` pipeline into one SQL query with `GROUP BY`, aggregate functions (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`), and `WHERE` clauses. Pipeline steps (`filter`/`groupby`/`aggregate`) map directly to SQL clauses. Response is a flat array of aggregated rows (not entity collections) — different response shape from regular GET.

### Parser Architecture

- **D-03:** Extend existing parser. Add `parseSearch()` and `parseApply()` to the existing parser module. `$search` is simple (free-text string, quoted phrases, AND/OR/NOT). `$apply` needs a mini-pipeline parser for the transformation/separator syntax (`filter(...)/groupby((...),aggregate(...))`). Reuse existing AST visitor pattern for translation.

### Claude's Discretion

- Searchable fields decorator design (`@ODataSearchable()` or config-based)
- $apply supported transformation types (start with `filter`, `groupby`, `aggregate` — defer `compute`, `concat`, `expand` to v2)
- How aggregated response differs from entity response in the interceptor (no @odata.id, different @odata.context)
- Whether $search and $apply can be combined in one request

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### $search

- `.planning/REQUIREMENTS.md` — SRCH-01, SRCH-02 requirements
- `packages/core/src/parser/` — Existing parser to extend with parseSearch()
- `packages/core/src/interfaces/etag.interface.ts` — IETagProvider pattern to follow for ISearchProvider

### $apply

- `.planning/REQUIREMENTS.md` — AGG-01, AGG-02, AGG-03 requirements
- `packages/core/src/parser/` — Existing parser to extend with parseApply()
- `packages/typeorm/src/translator/typeorm-query-translator.ts` — Translator to extend with apply visitor

### Query infrastructure

- `packages/core/src/query/odata-query.pipe.ts` — Query pipe to extract $search and $apply
- `packages/core/src/query/odata-query.types.ts` — Query types to extend
- `packages/typeorm/src/translator/filter-visitor.ts` — Existing visitor pattern for reference

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- Parser module with lexer + recursive descent — extend with new parse functions
- AST visitor pattern used by filter-visitor, orderby-visitor — same pattern for search/apply visitors
- `IETagProvider` interface + `ETAG_PROVIDER` token — same adapter pattern for `ISearchProvider`
- `ODataQueryPipe` — already parses $filter, $select, etc. from query string

### Established Patterns

- Core defines interfaces, adapter implements (zero ORM imports in core)
- Visitors produce SQL fragments consumed by TypeOrmQueryTranslator
- Query options parsed into typed AST, visitors translate to TypeORM QueryBuilder calls

### Integration Points

- `ODataQueryPipe` — add $search and $apply extraction
- `ODataQueryResult` — extend for aggregated response shape
- `TypeOrmQueryTranslator.translate()` — add search and apply branches
- `ODataResponseInterceptor` — handle aggregated response format differently

</code_context>

<specifics>
## Specific Ideas

- $apply response should still have @odata.context but with a different format (e.g., `$metadata#Orders(CustomerId,OrderCount)`)
- Start with filter + groupby + aggregate transformations only — compute, concat, expand are v2
- $search should work with $filter (AND'd together)

</specifics>

<deferred>
## Deferred Ideas

- $apply `compute` transformation (calculated properties) — v2
- $apply `concat` transformation (union results) — v2
- $apply `expand` transformation (within aggregation) — v2
- Full-text search integration guides (PostgreSQL tsvector, Elasticsearch) — future docs

</deferred>

---

_Phase: 11-search-and-apply_
_Context gathered: 2026-04-08_
