---
phase: quick
plan: oqc
status: complete
subsystem: query
tags: [odata, conformance, filter, expand, typeorm]
metrics:
  completed: 2026-10-27
---

# Quick task 261027-oqc summary

- #66: `$filter` on single-valued navigation paths, rendered as correlated scalar subqueries
  with every target's row-level scope (a related row outside its scope reads as `null`). Works
  in `or`, `not`, functions, lambda predicates and nested `$expand` filters. Navigation paths
  in `$orderby` answer 501.
- #68: lambda operators are case-insensitive; `$it/<path>` binds to the filtered entity.
  `$root` and `$it` inside `$expand` options answer 501 (in `$expand` it means the parent).
- #69: nested `$count=true`, `nav/$count`, `$search` and `$levels` (implemented, not 501;
  `max` = remaining `maxExpandDepth`). `$compute`/`$apply`/`/$ref`/aliases in `$expand` answer
  501, unknown nested options 400.
- #72: `any`/`all` over many-to-many navigations through the junction table, scoped.
- #74: nested `$top`/`$skip` paged in SQL with `ROW_NUMBER()` on one-to-many navigations
  (SQLite, PostgreSQL, CockroachDB, SQL Server, Oracle); in-memory fallback keyed by path.
- Pre-existing bugs found and fixed: `or` rendered as `AND`; `not <lambda>` produced invalid
  SQL; `eq null` rendered `= NULL`; top-level property-vs-property comparisons compared to
  NULL; a nested `$orderby` replaced the parent ORDER BY.
