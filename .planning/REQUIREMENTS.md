# Requirements: nestjs-odata

**Defined:** 2026-04-07
**Core Value:** OData query power with zero double-declaration — define entities once in TypeORM, get spec-compliant OData v4 automatically, mixing cleanly with regular NestJS routes.

## v1.1 Requirements

### Filter Functions

- [ ] **FILT-01**: Lambda `any()` translates to SQL EXISTS subquery for collection navigation filtering
- [ ] **FILT-02**: Lambda `all()` translates to SQL NOT EXISTS with negated predicate
- [ ] **FILT-03**: Date/time functions (`year`, `month`, `day`, `hour`, `minute`, `second`) translate to SQL extraction functions
- [ ] **FILT-04**: Arithmetic operators (`add`, `sub`, `mul`, `div`, `mod`) translate to SQL arithmetic in `$filter`
- [ ] **FILT-05**: `indexof()`, `substring()`, `concat()` string functions translate to SQL

### Full-Text Search

- [ ] **SRCH-01**: `$search` query option parses free-text expressions
- [ ] **SRCH-02**: `$search` translates to configurable full-text backend (LIKE fallback, FTS extension when available)

### Write Operations

- [ ] **WRITE-01**: PUT replaces entire entity (all unspecified fields reset to defaults)
- [ ] **WRITE-02**: Deep insert — POST with nested navigation properties creates related entities atomically
- [ ] **WRITE-03**: Content-ID reference resolution in `$batch` — `$1` in URLs substitutes the created entity key from a prior changeset operation

### Response Format

- [ ] **RESP-04**: `@odata.id` annotation on every entity response (canonical URL)
- [ ] **RESP-05**: `@odata.type` annotation on entity responses (`#Namespace.EntityType`)
- [ ] **RESP-06**: `@odata.navigationLink` for each navigation property

### Concurrency Control

- [ ] **ETAG-01**: ETag generation from entity version/timestamp column
- [ ] **ETAG-02**: `If-Match` header enforcement on PATCH/PUT/DELETE (412 Precondition Failed on mismatch)
- [ ] **ETAG-03**: `If-None-Match` header on GET (304 Not Modified for cache validation)

### Data Aggregation

- [ ] **AGG-01**: `$apply=groupby((field),aggregate(count as Total))` parses and translates to SQL GROUP BY
- [ ] **AGG-02**: `$apply=aggregate(field with sum as Total)` produces aggregated response
- [ ] **AGG-03**: `$apply=filter(...)` as transformation step in the apply pipeline

## v2 Requirements

### Advanced Features

- **ADV-01**: OData Actions and Functions (custom operations beyond CRUD)
- **ADV-02**: Delta responses (`@odata.deltaLink` for incremental sync)
- **ADV-03**: Singleton entities (non-collection endpoints like `Me`)
- **ADV-04**: ComplexType support (nested structures within entities)
- **ADV-05**: Enum type definitions with `has` operator filtering

### Ecosystem

- **ECO-01**: Prisma adapter package (`@nestjs-odata/prisma`)
- **ECO-02**: Drizzle adapter package (`@nestjs-odata/drizzle`)
- **ECO-03**: JSON batch format (OData v4.01 addition alongside multipart MIME)

## Out of Scope

| Feature                                    | Reason                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| OData v2/v3 support                        | v4 only — folder structure allows future version packages |
| Client-side OData SDK                      | Server-side library only                                  |
| GraphQL bridge                             | Different paradigm, not a goal                            |
| Built-in authentication/authorization      | NestJS Guards handle this — not the library's job         |
| Geo-spatial functions (geo.distance, etc.) | Requires PostGIS/spatial extensions — niche use case      |
| Media entities (Edm.Stream)                | High complexity, defer to v2+                             |
| `$format` content negotiation              | JSON-only for now; XML responses not planned              |

## Traceability

| Requirement | Phase | Status  |
| ----------- | ----- | ------- |
| FILT-01     | TBD   | Pending |
| FILT-02     | TBD   | Pending |
| FILT-03     | TBD   | Pending |
| FILT-04     | TBD   | Pending |
| FILT-05     | TBD   | Pending |
| SRCH-01     | TBD   | Pending |
| SRCH-02     | TBD   | Pending |
| WRITE-01    | TBD   | Pending |
| WRITE-02    | TBD   | Pending |
| WRITE-03    | TBD   | Pending |
| RESP-04     | TBD   | Pending |
| RESP-05     | TBD   | Pending |
| RESP-06     | TBD   | Pending |
| ETAG-01     | TBD   | Pending |
| ETAG-02     | TBD   | Pending |
| ETAG-03     | TBD   | Pending |
| AGG-01      | TBD   | Pending |
| AGG-02      | TBD   | Pending |
| AGG-03      | TBD   | Pending |

**Coverage:**

- v1.1 requirements: 19 total
- Mapped to phases: 0/19
- Unmapped: 19

---

_Requirements defined: 2026-04-07_
_Last updated: 2026-04-07 after milestone v1.1 definition_
