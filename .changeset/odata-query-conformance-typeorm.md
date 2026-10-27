---
'@nestjs-odata/typeorm': minor
---

OData 4.01 query-language conformance (#66, #68, #69, #72, #74):

- `$filter` on single-valued navigation paths (`category/name eq 'Tools'`, `store/region/name`): rendered as a correlated subquery, applying the row-level scope of every entity set on the path (a related row outside its scope reads as `null`). Works inside `or`, `not`, string functions, lambda predicates and nested `$expand` filters.
- Lambdas (`any`/`all`) over many-to-many navigation properties, through the junction table, applying the target's row-level scope like one-to-many lambdas.
- Nested `$expand` `$count=true` (`nav@odata.count`) and `$expand=nav/$count`: one grouped, scoped `COUNT` query per expand item, counting the rows matching the nested `$filter`/`$search` and ignoring `$top`/`$skip`.
- Nested `$expand` `$search`, through the search provider (501 when none is registered).
- Nested `$top`/`$skip` on one-to-many navigations are paged in SQL with `ROW_NUMBER() OVER (PARTITION BY <foreign key> ...)` on SQLite, PostgreSQL, CockroachDB, SQL Server and Oracle; other drivers, many-to-many navigations and composite keys fall back to in-memory slicing. `TranslateResult.expandPaginationMap` (and `applyExpandPagination`) are now keyed by expand path (`store/items`), so two expand paths ending in the same navigation property keep their own options.

Fixes:

- `$filter` with `or` was rendered as `AND` (`a or b` returned the rows matching both). It now renders `(a) OR (b)`.
- A nested `$orderby` inside `$expand` replaced the ordering of the parent rows (`$orderby=id&$expand=items($orderby=qty)`); it is now appended after it.
- `contains`/`startswith`/`endswith` keep the parameters of their property expression.
