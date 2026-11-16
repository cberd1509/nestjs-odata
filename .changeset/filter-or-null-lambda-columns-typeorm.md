---
'@nestjs-odata/typeorm': patch
---

`$filter` translation (#101):

- Lambda predicates (`notes/any(n: n/isPinned eq true)`, `all`) now render the range variable's properties with their database column names (`@Column({ name })`, naming strategies), as top-level properties already were. Before, the property name was used as the column name, so a property with a different column name failed with a 500.
- `null eq prop` / `null ne prop` (operands reversed) render `IS NULL` / `IS NOT NULL` like `prop eq null` / `prop ne null`. Before, they rendered `NULL = prop`, which never matches.
