---
'@nestjs-odata/core': minor
---

Parse each system query option from its own value, decoded exactly once ([kuantia-ai/iustum-crm#281](https://github.com/kuantia-ai/iustum-crm/issues/281)).

`ODataQueryPipe` used to join the already-decoded `req.query` values with `&` and split the string again, and decoded only `$search` and `$apply` a second time. A value holding `&` was cut in two (`$filter=contains(title,'A %26 B')` failed with 400, and `$filter=name eq 'x&$top=1'` even set `$top`), and a literal `%` in `$search` or `$apply` (`$search=100%25`) failed to decode.

- `ODataQueryPipe` now parses `$filter`, `$select`, `$expand` (nested options included), `$orderby`, `$top`, `$skip`, `$count`, `$search` and `$apply` from their own values, as NestJS decoded them, without decoding again: `&`, `%`, `+`, spaces and quotes (`''`) inside literals reach the parser unchanged. Its input contract (decoded values, one per option name) is documented on the pipe.
- New `parseQueryOptions(options)` (and type `ODataQueryOptionValues`): parses decoded values by option name, for code that already has them (`req.query`, `URLSearchParams`).
- `parseQuery(queryString)` now treats its input as a raw query string, as documented: it splits on `&` between parameters only, then decodes each name and value once (`+` as a space, then percent-decoding). Malformed percent-encoding is an `ODataParseError` (400). Callers that passed already-decoded text holding `%` or `+` should use `parseQueryOptions` instead.
- `$orderby` items are split on commas outside string literals and parentheses, so `concat(name,', ')` or `name eq 'a, b'` stay one item.
- A system query option given more than once (`$top=1&$top=2`, an array in `req.query`) is refused with 400 (Part 2 §5).
