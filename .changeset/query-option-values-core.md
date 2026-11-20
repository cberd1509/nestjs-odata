---
'@nestjs-odata/core': minor
---

Parse each system query option from its own value, decoded exactly once ([kuantia-ai/iustum-crm#281](https://github.com/kuantia-ai/iustum-crm/issues/281)).

`ODataQueryPipe` used to join the already-decoded `req.query` values with `&` and split the string again, and decoded only `$search` and `$apply` a second time. A value holding `&` was cut in two (`$filter=contains(title,'A %26 B')` failed with 400, and `$filter=name eq 'x%26$top=1'` even set `$top`), and a literal `%` in `$search` or `$apply` (`$search=100%25`) failed to decode.

- `ODataQueryPipe` parses `$filter`, `$select`, `$expand` (nested options included), `$orderby`, `$top`, `$skip`, `$count`, `$search` and `$apply` from their own values, as NestJS decoded them, in one pass and without decoding again: `&`, `%`, `+`, spaces and quotes (`''`) inside literals reach the parser unchanged. Its input contract (decoded values by parameter name) is documented on the pipe.
- New exports, additive (hence a minor release):
  - `parseQueryOptions(options)`, with the types `ODataQueryOptionValues` and `ParsedQueryOptions`: parses decoded values by name (`req.query`, `URLSearchParams`), `$count`, `$search` and `$apply` included.
  - `parseQueryString(queryString)`: parses a raw, percent-encoded query string. It splits on `&` between parameters only, then decodes each name and value once (`+` as a space). Malformed percent-encoding is an `ODataParseError` (400).
- `parseQuery(queryString)` keeps its 2.3.0 contract: it splits on every `&` and uses the values as written, without decoding; the last of repeated options wins.
- `$orderby` items are split on commas outside string literals and parentheses, so `concat(name,', ')` or `name eq 'a, b'` stay one item (before, they failed to parse).

**Behaviour changes for requests** (each was a silent misreading before):

- A system query option given more than once is refused with 400, whatever the letter case (`$top=1&$top=2`, `$top=1&$TOP=2`; Part 2 §5). Before, an array value was stringified and the case variants were both read, the last one winning.
- A system query option whose value is not a single string (an object such as `$filter[x]=...` from an extended query parser, or any other non-string) is refused with 400. Before, it was stringified or ignored.
