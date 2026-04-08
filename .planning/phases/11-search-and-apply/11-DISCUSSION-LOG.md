# Phase 11: $search and $apply - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 11-search-and-apply
**Areas discussed:** $search backend strategy, $apply pipeline design, Parser architecture

---

## $search Backend Strategy

| Option                        | Description                                     | Selected |
| ----------------------------- | ----------------------------------------------- | -------- |
| LIKE fallback + pluggable FTS | Default LIKE, pluggable ISearchProvider for FTS | ✓        |
| LIKE only                     | Always LIKE, no FTS                             |          |
| Database-native FTS required  | Require FTS setup                               |          |

**User's choice:** LIKE fallback + pluggable FTS
**Notes:** Same adapter pattern as IETagProvider

---

## $apply Pipeline Design

| Option              | Description                                               | Selected |
| ------------------- | --------------------------------------------------------- | -------- |
| Single SQL query    | Translate entire pipeline to one GROUP BY + aggregate SQL | ✓        |
| Sequential pipeline | Execute each step separately, multiple DB trips           |          |
| Hybrid              | Single SQL for simple, sequential for complex             |          |

**User's choice:** Single SQL query
**Notes:** Pipeline steps map directly to SQL clauses

---

## Parser Architecture

| Option                  | Description                                                | Selected |
| ----------------------- | ---------------------------------------------------------- | -------- |
| Extend existing parser  | Add parseSearch() and parseApply() to current module       | ✓        |
| Separate parser modules | Standalone parsers, cleaner isolation but duplicates infra |          |

**User's choice:** Extend existing parser
**Notes:** Reuse existing AST visitor pattern

## Claude's Discretion

- Searchable fields decorator design
- Supported $apply transformations (filter, groupby, aggregate for now)
- Aggregated response format in interceptor
- $search + $apply combination support

## Deferred Ideas

- $apply compute, concat, expand transformations — v2
- FTS integration guides — future docs
