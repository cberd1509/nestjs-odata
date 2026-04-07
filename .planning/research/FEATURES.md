# Feature Research

**Domain:** OData v4 server library for NestJS (npm open-source package)
**Researched:** 2026-04-07
**Confidence:** HIGH (OData v4 is an OASIS standard with exhaustive public specification; cross-referenced against .NET, Java/Olingo, and Node.js implementations)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or non-compliant.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `$filter` query option | Core OData capability; every consumer relies on it for data filtering | HIGH | Must support comparison, logical, arithmetic, string, date, and lambda operators per spec. The OData v4 filter grammar is a full expression language. |
| `$select` query option | Standard field projection; required for bandwidth efficiency | MEDIUM | Translates to column projection in SQL; must respect navigation property boundaries |
| `$orderby` query option | Required for deterministic pagination and sorted results | LOW | Multi-field, ASC/DESC; must compose with $filter |
| `$top` and `$skip` | Required for pagination; without these collections are unusable at scale | LOW | Must interoperate with `$count` and `@odata.nextLink` |
| `$count` query option | Required for pagination UI (total pages, total records) | LOW | `?$count=true` inlines count; standalone `/$count` endpoint is also spec-required |
| `$expand` query option | Navigation properties are fundamental to relational data access | HIGH | Must support nested $expand, $select inside $expand, and $filter inside $expand |
| `$metadata` endpoint | Machine-readable service description; required by OData spec and all client tooling | MEDIUM | Must be auto-generated and always reflect the actual registered entities; stale metadata is a serious trust issue |
| OData JSON response envelope | `@odata.context`, `value`, `@odata.count`, `@odata.nextLink` are required by the JSON format spec | MEDIUM | Must set the correct OData-Version response header; `@odata.context` must be the first key in the payload |
| OData error response format | Consumers expect `error.code` and `error.message` structure, not raw NestJS exceptions | LOW | Standard format; must not leak stack traces |
| CRUD operations (POST, PATCH, DELETE) | Any useful OData service exposes write operations | MEDIUM | POST → 201 Created with Location header; PATCH → 204 No Content; DELETE → 204 No Content; must reject PUT on collections |
| EDM (Entity Data Model) registration | Every OData server requires a model; how it is registered defines the DX | MEDIUM | The key differentiator is how easy registration is (see Differentiators), but the EDM itself is non-negotiable |
| `$batch` request support | Required by enterprise clients (SAP, Microsoft Power Platform) that issue all mutations as batch | HIGH | Multipart MIME format; changeset atomicity (all-or-nothing); can contain queries and mutations mixed |
| OData v4 spec compliance (response codes, headers) | Validators exist; enterprise integrations will break on non-compliant responses | MEDIUM | ETag/If-Match for optimistic concurrency is expected by enterprise consumers |

### Differentiators (Competitive Advantage)

Features that set this library apart. Not universally expected, but highly valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-derive EDM from TypeORM entity metadata | The #1 pain point in every other OData ecosystem (double declaration); zero-config EDM means entities added to TypeORM automatically appear in OData | HIGH | TypeORM's `reflect-metadata` decorators carry all the information needed: column types, relations, nullable flags, primary keys. No manual EDM registration. |
| NestJS-native module system (`ODataModule.forRoot()` / `forFeature()`) | Matches idiomatic NestJS patterns developers already know; avoids friction with the DI container | MEDIUM | `forFeature()` per-module entity registration mirrors `TypeOrmModule.forFeature()` — feels native, not bolted on |
| Route mixing: OData and non-OData routes on the same controller | In .NET OData, mixing regular controllers with OData controllers causes routing nightmares; solving this is a genuine differentiator | HIGH | Must avoid serialization leak (OData envelope applied only to OData routes), middleware scope isolation, and no `ODataRoute` conflicts with `@Controller` routes |
| Two-level API surface: high-level `@ODataController()` + low-level `@ODataGet()` / `@ODataPost()` decorators | Covers both the "auto-CRUD" use case and the "I need custom logic" use case without forcing one model | MEDIUM | High-level generates all CRUD routes automatically; low-level lets developers intercept and customize specific operations |
| TypeScript-first with full type inference | Most Node.js OData libraries are JavaScript-first with loose types; a fully typed library catches spec violations at compile time | MEDIUM | Decorator-based EDM descriptors, typed query option objects in handler signatures, typed response builders |
| `$expand` with automatic JOIN translation | Most Node.js OData-to-SQL translators handle `$filter` well but fall short on nested `$expand` with filter/select | HIGH | Translating deeply nested `$expand` with per-level `$filter` and `$select` into efficient SQL JOINs is the hardest part of the TypeORM adapter |
| OData expert sub-agent for implementation guidance | Spec-grounded AI assistance for contributors; unusual for OSS libraries but reduces spec interpretation errors | LOW | Built as a Claude sub-agent seeded with the OData v4 spec; relevant for maintainability and contributor experience |
| TDD with spec-driven integration tests | Most OData libraries have thin test coverage; a spec-driven test suite is a trust signal for enterprise adopters | HIGH | Tests should validate against the OData conformance requirements, not just happy-path scenarios |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| OData v2/v3 support | Existing enterprise systems still run v2 | Fundamentally different wire format, EDM model, and URL conventions; adds unbounded maintenance surface; v4 is the OASIS standard | Keep folder/package structure version-namespaced so a `@nestjs-odata/v2` package can be added later without breaking v4 |
| `$search` full-text search | OData spec includes it; consumers expect it | The spec explicitly says the implementation is free-form; no standard mapping to SQL exists; implementations silently differ; it creates false expectations about cross-service portability | Document clearly that `$search` is not implemented in v1; provide an escape hatch via custom route decorators for teams that want full-text with their own logic |
| Built-in authentication/authorization | "Why doesn't the OData decorator handle `@Roles`?" | Auth is NestJS's job (Guards); mixing it into OData decorators creates a leaky abstraction and forces every consumer into a specific auth model | Document the standard NestJS guard composition pattern; show examples of applying `@UseGuards()` to OData controllers |
| Automatic Prisma adapter | Prisma is popular; users will ask for it immediately | Prisma does not expose entity metadata at the reflect-metadata layer the way TypeORM does; auto-derivation would require a Prisma-specific reflection mechanism that is fundamentally different work | Accept community PRs for a `@nestjs-odata/prisma` package; keep the adapter contract documented in `core` |
| GraphQL bridge / OData-to-GraphQL translation | Some teams want to expose a single endpoint for both | Different pagination models (cursor vs. skip/top), different type systems (SDL vs. EDM), different error formats; bridging them produces a lowest-common-denominator API that satisfies neither | Out of scope by design; recommend separate GraphQL and OData controllers if both are needed |
| Client-side OData SDK generation | "Can I generate TypeScript clients from `$metadata`?" | Generating client SDKs is a different domain (OpenAPI generators, OData Connected Service); building it into the server library bloats scope and duplicates existing tools | Point to `odata2ts` or Microsoft's OData Connected Service for client generation |
| Real-time/WebSocket OData | OData 4.01 has delta queries (`$deltaToken`, `@odata.deltaLink`) but not WebSocket push | Streaming requires a completely different transport model; the OData delta spec is complex and rarely needed by v1 adopters | Implement `@odata.deltaLink` in a later version if proven necessary |
| Query complexity / cost estimation limits | Enterprise teams sometimes ask for built-in query cost controls | This belongs to application-level middleware or a NestJS interceptor, not the OData layer; hardcoding limits breaks consumer contracts | Provide documentation patterns for wrapping OData endpoints with NestJS rate-limiting and query depth guards |

---

## Feature Dependencies

```
$metadata endpoint
    └──requires──> EDM registration
                       └──requires──> TypeORM entity reflection (for auto-derive)

CRUD operations (POST/PATCH/DELETE)
    └──requires──> EDM registration
    └──enhances──> ETag / optimistic concurrency

$expand
    └──requires──> EDM (navigation properties must be in the model)
    └──requires──> TypeORM relation metadata (for JOIN translation)
    └──enhances──> $select (per-level field projection inside expand)
    └──enhances──> $filter (per-level filter inside expand)

$batch
    └──requires──> CRUD operations
    └──requires──> $filter / $expand / $select (batch can contain GET requests too)
    └──requires──> Changeset atomicity (database transaction support)

OData JSON response envelope
    └──requires──> $count (to inline @odata.count)
    └──requires──> $top/$skip (to generate @odata.nextLink)

@ODataController() (high-level)
    └──requires──> EDM registration
    └──requires──> CRUD operations
    └──enhances──> all query options (auto-wires $filter, $select, $expand, etc.)

@ODataGet() / @ODataPost() (low-level)
    └──requires──> EDM registration (for $metadata accuracy)
    └──conflicts──> None — intentionally composable with @ODataController()

Route mixing (OData + non-OData)
    └──requires──> Serialization isolation (OData envelope must not leak to non-OData routes)
    └──requires──> Middleware scoping (OData query parsing must only run on OData routes)
```

### Dependency Notes

- **`$expand` requires navigation properties in EDM:** Without relations registered in the EDM, `$expand` has nothing to traverse. The auto-derive path reads TypeORM `@OneToMany` / `@ManyToOne` etc. to populate navigation properties automatically.
- **`$batch` requires transaction support:** Changeset atomicity mandates that all mutations in a changeset succeed or all roll back. The TypeORM adapter must wrap changesets in a `QueryRunner` transaction.
- **Route mixing requires serialization isolation:** The OData response envelope (`@odata.context`, `value` wrapper) must only be applied to routes handled by the OData layer. A regular `@Get()` on the same controller should return plain JSON.
- **`$top`/`$skip` and `@odata.nextLink` are coupled:** The library must generate `@odata.nextLink` when a `$top` constraint is applied and the collection has more results. This requires knowing the total count, which means `$count` logic is entangled with pagination.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what the first stable release must cover to be taken seriously by OData consumers.

- [ ] EDM auto-derivation from TypeORM entity metadata — the core value proposition
- [ ] `$metadata` endpoint — machine-readable service description; all client tooling requires it
- [ ] `$filter` with full expression support — without this no data querying is possible
- [ ] `$select` — field projection; required for bandwidth efficiency
- [ ] `$orderby` — required for deterministic results
- [ ] `$top`, `$skip`, `$count` — pagination; collections without pagination are unusable
- [ ] `$expand` with at least one level of depth — navigation properties are fundamental to relational OData
- [ ] OData JSON response envelope (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`)
- [ ] OData error response format
- [ ] CRUD operations (POST, PATCH, DELETE) with correct response codes
- [ ] `ODataModule.forRoot()` / `forFeature()` NestJS registration
- [ ] `@ODataController()` high-level decorator for auto-CRUD
- [ ] `@ODataGet()` / `@ODataPost()` low-level decorators for custom routes
- [ ] Route mixing without serialization leaking
- [ ] `$batch` with changeset atomicity — required by enterprise Microsoft/SAP clients

### Add After Validation (v1.x)

Features to add once the core is working and consumer feedback arrives.

- [ ] ETag / optimistic concurrency (`If-Match`, `If-None-Match`) — needed for enterprise concurrent updates
- [ ] Nested `$expand` (multi-level, with per-level `$filter`/`$select`) — v1 can support one level; deep nesting is a follow-up
- [ ] OData Actions and Functions (bound and unbound) — custom server-side operations beyond CRUD
- [ ] `$compute` — computed properties in queries; useful but adds parser complexity
- [ ] Prisma adapter (`@nestjs-odata/prisma`) — community demand will drive priority

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] `$apply` aggregation extension — powerful but complex; needed only by analytics consumers
- [ ] `@odata.deltaLink` / delta queries — real-time sync patterns; niche use case
- [ ] `$search` — free-text search; spec is intentionally implementation-defined, so semantics vary per backend
- [ ] OData v2/v3 packages — separate versioned packages if demand materializes
- [ ] OpenTelemetry / tracing integration for OData query spans

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| EDM auto-derivation from TypeORM | HIGH | HIGH | P1 |
| `$metadata` endpoint | HIGH | MEDIUM | P1 |
| `$filter` | HIGH | HIGH | P1 |
| `$select` | HIGH | LOW | P1 |
| `$orderby` | HIGH | LOW | P1 |
| `$top` / `$skip` / `$count` | HIGH | LOW | P1 |
| OData JSON envelope | HIGH | MEDIUM | P1 |
| OData error format | HIGH | LOW | P1 |
| CRUD operations | HIGH | MEDIUM | P1 |
| `$expand` (single level) | HIGH | HIGH | P1 |
| `ODataModule.forRoot/forFeature` | HIGH | MEDIUM | P1 |
| `@ODataController()` | HIGH | MEDIUM | P1 |
| `@ODataGet()` / `@ODataPost()` | HIGH | MEDIUM | P1 |
| Route mixing isolation | HIGH | HIGH | P1 |
| `$batch` with changesets | HIGH | HIGH | P1 |
| ETag / optimistic concurrency | MEDIUM | MEDIUM | P2 |
| Nested `$expand` (multi-level) | MEDIUM | HIGH | P2 |
| OData Actions and Functions | MEDIUM | HIGH | P2 |
| `$compute` | LOW | HIGH | P3 |
| `$apply` aggregation | LOW | HIGH | P3 |
| `$search` | LOW | MEDIUM | P3 |
| Delta queries / `@odata.deltaLink` | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: Should have; add in v1.x after core validates
- P3: Nice to have; defer to v2+

---

## Competitor Feature Analysis

| Feature | .NET (AspNetCoreOData 9) | Java (Apache Olingo 5) | Node.js (odata-v4-server, abandoned) | ts-odata-v4-server (active, 2024) | Our Approach |
|---------|--------------------------|------------------------|--------------------------------------|-----------------------------------|--------------|
| EDM declaration | Manual builder API (double-declaration from EF entities is a pain point) | Manual provider classes | Decorator-based but manual | Decorator-based but manual | Auto-derive from TypeORM metadata — zero double-declaration |
| `$filter` | Full expression support | Full expression support | Full via odata-v4-parser | Partial | Full via spec-compliant parser |
| `$expand` | Full with nested options | Full | Basic | Basic | Full, translated to TypeORM JOIN |
| `$batch` | Full with multipart and JSON batch | Full | Partial | Not documented | Full with changeset atomicity via TypeORM transaction |
| Framework integration | ASP.NET Core native | Jakarta EE servlet | Express-compatible; no NestJS adapter | Express-compatible | NestJS native (modules, DI, decorators) |
| Route mixing | Painful — OData routes conflict with MVC routes | N/A | Not supported | Not supported | First-class; OData and non-OData on same controller |
| TypeScript support | C# native | Java native | Loose types | TypeScript | Full TypeScript with inference |
| OData Actions/Functions | Full | Full | Supported | Partial | v1.x |
| ETag / concurrency | Full | Full | Not supported | Not documented | v1.x |
| Test coverage | Good | Good | Minimal | Minimal | TDD from day one; spec-driven integration tests |
| Last active | 2024 (OData 9) | 2023 (5.0.0) | 2017 (abandoned) | 2024 | Active |

---

## Sources

- OData v4.01 OASIS Protocol Specification: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html
- OData JSON Format v4.01: https://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html
- OData Data Aggregation Extension v4.0: https://docs.oasis-open.org/odata/odata-data-aggregation-ext/v4.0/odata-data-aggregation-ext-v4.0.html
- Microsoft Learn — ASP.NET Core OData 8 Overview: https://learn.microsoft.com/en-us/odata/webapi-8/overview
- Microsoft Learn — Query Options Overview: https://learn.microsoft.com/en-us/odata/concepts/queryoptions-overview
- Microsoft Learn — OData Actions and Functions: https://learn.microsoft.com/en-us/odata/webapi-8/fundamentals/actions-functions
- Microsoft Learn — OData Batch Support: https://learn.microsoft.com/en-us/odata/webapi/batch
- Microsoft Learn — OData JSON Batch Format: https://learn.microsoft.com/en-us/odata/odatalib/json-batch
- ASP.NET Core OData 9 release (2024): https://devblogs.microsoft.com/odata/announcing-asp-net-core-odata-9-official-release/
- Apache Olingo OData4 Overview: https://olingo.apache.org/doc/odata4/overview.html
- Apache Olingo — Batch Tutorial: https://olingo.apache.org/doc/odata4/tutorials/batch/tutorial_batch.html
- Apache Olingo — Actions and Functions: https://olingo.apache.org/doc/odata4/tutorials/action/tutorial_action.html
- odata-v4-server (JayStack, abandoned): https://github.com/jaystack/odata-v4-server
- ts-odata-v4-server (active): https://github.com/leyton-group/ts-odata-v4-server
- odata-v4-typeorm connector: https://github.com/andryuha49/odata-v4-typeorm
- NestJS GitHub issue — OData Wrapper discussion: https://github.com/nestjs/nest/issues/14382
- OData $compute and $search in ASP.NET Core OData 8: https://devblogs.microsoft.com/odata/compute-and-search-in-asp-net-core-odata-8/

---
*Feature research for: OData v4 NestJS server library*
*Researched: 2026-04-07*
