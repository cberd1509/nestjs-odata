---
'@nestjs-odata/typeorm': minor
---

Query option values are no longer split on an encoded `&` ([kuantia-ai/iustum-crm#281](https://github.com/kuantia-ai/iustum-crm/issues/281)). Requires `@nestjs-odata/core` 2.4.0 or later.

- **Security fix: `batch.entitySets` checks every `$expand`.** The `$batch` allow-list re-joined each decoded `$expand` value into a query string, so a nested literal holding `&` or `%` (`$expand=ticket($filter=subject eq 'A %26 B')`) failed to parse there and the option was skipped, letting the operation expand into an entity set outside the allow-list. The value is now parsed as is (`parseQueryOptions`), and such an operation answers 403.
- `@odata.nextLink` keeps the request's query options intact: they are read with `URLSearchParams` (split on `&` between parameters, `+` read as a space, malformed percent-encoding tolerated) and re-encoded, so an encoded `&` stays inside its value.
