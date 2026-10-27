---
'@nestjs-odata/core': minor
---

OData 4.01 query-language conformance (#66, #68, #69):

- `$filter` accepts paths through single-valued navigation properties (`category/name eq 'Tools'`, also after a lambda range variable and in nested `$expand` filters). Collection-valued navigation properties still require `any`/`all`; using one in a path is a 400 that says so.
- Lambda operators are case-insensitive (`items/ANY(...)`), and `$it/<path>` refers to the entity being filtered, also inside lambda predicates (`items/any(d: d/quantity gt $it/totalAmount)`).
- Nested `$expand` options `$count=true`, `$search` and `$levels` (a number or `max`, for recursive navigation properties) are parsed, and `$expand=nav/$count` (optionally with `$filter`/`$search`) is accepted. `ODataQueryPipe` replaces `$levels` by the equivalent nested `$expand`s.
- New `ODataNotImplementedError`, answered with `501 Not Implemented` (code `NotImplemented`, the message is kept) per OData 4.01 Part 1 §9.3.1.
- Nested `$expand` options containing `;` inside parentheses (a nested `$expand` with several options, or a `;` in a string literal) are no longer split apart.

Behaviour changes (the spec mandates them):

- Nested `$expand` options that were silently ignored now fail: `$compute`/`$apply` inside `$expand`, `nav/$ref`, `$it` inside `$expand` options, `$root`, and `$it`/`$count`/`$this` path segments answer 501; unknown nested options (`items($foo=1)`) answer 400.
- `$count` and `/$count` on a single-valued navigation property answer 400.
- A lambda over something that is not a collection-valued navigation property (`category/any(...)`, an unknown name) answers 400 instead of being ignored.
- Navigation paths in `$orderby` answer 501 (they were a 400).
