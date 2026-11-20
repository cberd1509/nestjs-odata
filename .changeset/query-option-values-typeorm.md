---
'@nestjs-odata/typeorm': minor
---

Query option values are no longer split on an encoded `&` ([kuantia-ai/iustum-crm#281](https://github.com/kuantia-ai/iustum-crm/issues/281)). Requires `@nestjs-odata/core` 2.4.0 or later (`parseQueryOptions`).

- **Security fix: the `batch.entitySets` allow-list checks every `$expand` and fails closed.** It re-joined each decoded `$expand` value into a query string, so a nested literal holding `&` (`$expand=ticket($filter=subject eq 'A %26 B')`) failed to parse there, and the option was skipped, letting the operation expand into an entity set outside the allow-list. The value is now parsed as is, and an `$expand` the allow-list cannot parse is refused with 403 instead of being skipped (before, the route answered it with 400).
- `@odata.nextLink` keeps the request's query intact: it is read with `URLSearchParams` (split on `&` between parameters, `+` read as a space, malformed percent-encoding tolerated); every value of a repeated custom parameter is kept; names and values are percent-encoded (a leading `$` stays as is); existing `$skip`/`$top` entries are replaced whatever their letter case.
