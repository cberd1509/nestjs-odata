---
phase: quick
plan: oqc
type: execute
---

# Quick task 261027-oqc: OData 4.01 query-language conformance

Fix issues #66, #68, #69, #72 and #74 on branch `fix/odata-query-conformance`. TDD:
failing parser, pipe, translator and e2e tests first.

1. Core parser: case-insensitive `any`/`all`, `$it` path prefix (`$root` → 501), nested
   `$expand` options `$count`, `$search`, `$levels`, `nav/$count`; 501 for valid but
   unimplemented options, 400 for unknown ones; semicolon splitting that respects
   parentheses and string literals. `ODataNotImplementedError` → 501.
2. Query pipe: validate navigation paths in `$filter` against each target; `$levels`
   replaced by nested `$expand`s bounded by `maxExpandDepth`; `$count` only on collections.
3. TypeORM: navigation paths as correlated subqueries with each target's row-level scope;
   many-to-many lambdas through the junction table; nested counts (grouped COUNT queries);
   nested `$search`; nested `$top`/`$skip` with `ROW_NUMBER()` in SQL, keyed by expand path.
4. Docs (guide + API + README), changesets, doc-guardian, full verification.
