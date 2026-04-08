---
'@nestjs-odata/core': major
'@nestjs-odata/typeorm': major
---

Initial v1.0.0 release — OData v4 for NestJS with TypeORM integration

Features:
- Auto-derive OData EDM from TypeORM entities (zero double-declaration)
- Full query surface: $filter, $select, $orderby, $top, $skip, $count, $expand
- Filter functions: string, date/time, arithmetic, lambda (any/all)
- CRUD operations with PATCH, PUT (full replace), and deep inserts
- $batch with multipart/mixed and Content-ID cross-references
- $search with pluggable search providers
- $apply aggregation pipelines (groupby, aggregate, filter, compute)
- Response annotations (@odata.id, @odata.type, @odata.etag)
- ETag-based optimistic concurrency control
- Configurable security limits and validation
- $metadata endpoint with CSDL XML
- Zero-boilerplate module API (forRoot/forFeature)
