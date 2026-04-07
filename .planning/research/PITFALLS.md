# Pitfalls Research

**Domain:** OData v4 server library for NestJS / TypeScript
**Researched:** 2026-04-07
**Confidence:** HIGH — cross-referenced against OData/WebApi GitHub issues, abandoned Node.js library post-mortems, official OASIS spec, and the Microsoft ASP.NET OData security guidance.

---

## Critical Pitfalls

### Pitfall 1: $expand Triggers N+1 Queries by Default

**What goes wrong:**
A `$expand=Orders` on 100 customers issues 101 SQL queries — one for the root collection, then one per row to load the relation. Performance degrades linearly (or worse with multi-level expand). This is the most commonly filed performance bug in OData/WebApi GitHub issues.

**Why it happens:**
TypeORM lazy-loads relations by default. When the OData adapter translates `$expand` without forcing eager loading via `JOIN` or `relations: [...]`, TypeORM defers loading until the property is accessed during serialization — at which point it fires one query per parent entity.

**How to avoid:**
Translate `$expand` clauses into TypeORM `QueryBuilder.leftJoinAndSelect()` calls (or the `relations` option on `find()`) so the entire tree is fetched in a single SQL statement. Never rely on lazy-loading during OData response serialization. For multi-level expand, build the join tree recursively from the parsed AST before executing the query.

**Warning signs:**
- Response times grow linearly with page size (e.g., `$top=100` is 10× slower than `$top=10`)
- Database logs show batches of near-identical SELECT statements after a single HTTP request
- Unit test passes but integration test against a real DB is unusably slow

**Phase to address:** EDM + $expand implementation phase (before any performance benchmarking phase).

---

### Pitfall 2: Filter Parser Mis-handles Operator Precedence and Parentheses

**What goes wrong:**
`$filter=a eq 1 or b eq 2 and c eq 3` must be parsed as `a eq 1 or (b eq 2 and c eq 3)` (AND binds tighter than OR). Hand-rolled or naive parsers flatten this into left-to-right evaluation, silently returning wrong data. Equally, `not` must apply to the full expression in parentheses, not just the next token.

**Why it happens:**
OData filter grammar is a full expression language (OData ABNF grammar, Part 2 §5.1). Developers often write a quick recursive-descent parser without consulting the precedence table in the spec, or they adapt an SQL tokenizer that has different rules.

**How to avoid:**
Use an existing spec-validated parser such as `odata-v4-parser` (JayStack's parser component, which is described as "feature complete" for the query language even if the server layer around it was abandoned) or implement using the official ABNF grammar as the source of truth. Write property-based tests covering precedence, negation, nested parentheses, and string literal escaping (single-quote doubling: `'O''Brien'`).

**Warning signs:**
- Filter `$filter=price gt 10 or price lt 5 and inStock eq true` returns unexpected rows
- String values containing `'` cause 500 errors instead of matching correctly
- No test coverage for precedence edge cases

**Phase to address:** Filter expression parsing phase; must be verified with spec-level test fixtures before any ORM translation work.

---

### Pitfall 3: $batch Changeset Atomicity is Broken Without Explicit Transaction Scoping

**What goes wrong:**
A batch changeset must be atomic: if operation 3 of 5 fails, operations 1 and 2 must roll back. Without explicit transaction management, each operation commits independently, leaving the database in a partially-updated state. This is a documented real-world issue in `OData/odata.net` and `codestudy.net` post-mortems.

**Why it happens:**
NestJS TypeORM's default request-scoped `DataSource` or `EntityManager` does not automatically wrap batch changesets in a transaction. If each sub-request re-uses the same connection but without `BEGIN`/`ROLLBACK`, partial commits happen silently.

**How to avoid:**
For each changeset, acquire a dedicated `QueryRunner` from the TypeORM `DataSource`, call `queryRunner.startTransaction()`, execute all sub-requests through that runner, and only call `queryRunner.commitTransaction()` if all succeed — otherwise `queryRunner.rollbackTransaction()`. Individual requests outside a changeset do not require this (they are non-atomic by spec). Also isolate changesets from one another; do not share a `QueryRunner` across multiple changesets.

**Warning signs:**
- Integration test that sends a batch with a deliberately failing operation finds earlier operations persisted
- No `BEGIN TRANSACTION` visible in DB query logs during batch processing
- $batch tests pass with mocks but fail against a real database

**Phase to address:** $batch implementation phase; write an integration test with a failing mid-changeset operation before implementing.

---

### Pitfall 4: EDM / $metadata Diverges from Actual Database Schema

**What goes wrong:**
The $metadata endpoint returns a schema that does not match runtime behavior: nullable fields are listed as required, navigation properties point to non-existent entity sets, or enum types are missing. OData clients (Power BI, Excel, SAP UI5, odata2ts) generate incorrect code or throw at runtime.

**Why it happens:**
If the EDM is built once at startup from TypeORM metadata and then cached, any subsequent entity change that is not reflected in the EDM registration goes unnoticed. Similarly, TypeORM `@Column({ nullable: true })` annotations are often not consulted, so all properties appear as required in the generated CSDL.

**How to avoid:**
Build the EDM deterministically from TypeORM's `EntityMetadata` at module bootstrap, not from a manually-maintained list. Map `nullable`, `type`, `length`, `precision`, and `scale` from `ColumnMetadata`. Add an integration test that POSTs a request with a missing required field and asserts a 400 with an OData error body, verifying the nullable/required mapping is correct. Regenerate $metadata on every app start (no file-based cache between restarts).

**Warning signs:**
- Power BI or odata2ts generates TypeScript models with all fields required
- POST with a missing field returns 500 instead of 400
- $metadata XML has `Nullable="false"` on fields that DB allows null for

**Phase to address:** EDM auto-derivation phase; validate $metadata output against the CSDL schema before proceeding to query translation.

---

### Pitfall 5: Abandoned Libraries Leave Filter-to-SQL Translation Gaps

**What goes wrong:**
Both major Node.js OData v4 server libraries are effectively dead: `odata-v4-server` (JayStack, last published 8 years ago) and `@odata/server` (Soontao fork, last published 5 years ago). Teams that fork or depend on these inherit known unfixed bugs: `$expand` not working (issue #29 in jaystack/odata-v4-server), duplicate query parameters (issue #33), and missing aggregation operators (issue #30).

**Why it happens:**
OData v4 is a large spec; implementing it fully is a multi-year effort. Single-developer OSS projects stall when the author moves on. The ecosystem gap is precisely why this project exists — but it also means there are no turnkey building blocks to copy.

**How to avoid:**
Do not fork or vendor either dead library. Treat `odata-v4-parser` (the standalone parser from JayStack) as potentially reusable for AST generation only, but verify it against the current spec before adoption. Write the ORM translation layer from scratch against TypeORM's QueryBuilder API, guided by the spec's ABNF grammar. Document which spec sections each component covers.

**Warning signs:**
- Dependency on `odata-v4-server`, `odata-v4-sql`, or `@odata/server` in package.json
- Filter behavior not covered by tests (gaps silently deferred)

**Phase to address:** Foundation / architecture phase — choose parser strategy before any implementation begins.

---

### Pitfall 6: Route Conflicts Between OData and Non-OData Handlers

**What goes wrong:**
OData routes intercept requests meant for regular NestJS controllers (or vice versa). In the worst case, OData's wildcard route matches a REST endpoint and serializes its response in OData format, corrupting the response for non-OData clients. This is a well-documented problem in ASP.NET OData and the exact same trap exists in any framework.

**Why it happens:**
OData endpoints use a pattern like `/odata/EntitySet(Key)` and `/odata/$metadata`. If the OData router middleware is mounted too broadly (e.g., `forRoutes('*')`) or the prefix is not isolated, NestJS route resolution can match both a custom controller action and an OData handler.

**How to avoid:**
Mount all OData routes under a dedicated prefix (default: `/odata`). The `ODataModule` must register its router before NestJS's global route handler and must not interfere with routes outside the prefix. Use NestJS `RouterModule` or module-scoped `forRoutes()` to restrict OData middleware to the prefix. Add an integration test that confirms a non-OData endpoint at `/api/health` returns plain JSON even after `ODataModule.forRoot()` is registered.

**Warning signs:**
- `/api/users` returns `{ "@odata.context": "...", "value": [...] }` instead of plain JSON
- NestJS `@Get('/')` inside an ODataController returns OData-wrapped response
- `$filter` query parameter affects non-OData endpoints

**Phase to address:** Module bootstrap and routing phase (before any feature implementation).

---

### Pitfall 7: DateTime / Timezone Handling Causes Silent Data Corruption

**What goes wrong:**
OData v4 removed `Edm.DateTime` — all date-time values must be `Edm.DateTimeOffset` (with explicit timezone) or `Edm.Date` (date-only). Converting TypeORM `Date` columns to `Edm.DateTimeOffset` without preserving the timezone silently normalizes values to UTC, causing `hour()`, `year()`, `month()`, and `day()` filter functions to return wrong results for users in non-UTC timezones. The spec (Part 2, §6.1.1) explicitly states that services unable to preserve offset MUST fail these function evaluations.

**Why it happens:**
JavaScript's `Date` object is always UTC internally. TypeORM returns `Date` instances. Naive serialization calls `.toISOString()` which strips the original offset. Additionally, developers often map TypeORM `timestamp` columns to `Edm.DateTime` (not available in v4) rather than `Edm.DateTimeOffset`.

**How to avoid:**
Map TypeORM `timestamp with time zone` columns → `Edm.DateTimeOffset`. Map `date` columns → `Edm.Date`. Map `time` columns → `Edm.TimeOfDay`. Never map any column to `Edm.DateTime` (v3 only). During filter translation, when comparing `Edm.Date` with a `DateTimeOffset` column, the spec requires range comparison (start of day to end of day), not direct equality — implement this in the translator. Write tests with explicit timezone offsets in filter strings.

**Warning signs:**
- `$filter=birthDate eq 2024-01-15` returns 0 results for a row stored as `2024-01-15T00:00:00Z`
- EDM shows `Edm.DateTime` in $metadata (v3 type, not valid in v4)
- GitHub issue: `No coercion operator defined between Edm.Date and DateTimeOffset` equivalent error at runtime

**Phase to address:** EDM type mapping phase; write type-coercion tests before implementing filter translation.

---

### Pitfall 8: Unrestricted Query Surface Enables DoS

**What goes wrong:**
A malicious or naive client sends `$filter=contains(Description, 'a') and contains(Description, 'b') and ...` (100+ clauses), `$expand=A($expand=B($expand=C($expand=D($expand=E))))`, or `$orderby=unindexed_column` — each causing full table scans or Cartesian joins that exhaust DB resources and take down the service.

**Why it happens:**
The spec says services SHOULD support these features; it says nothing about rate limiting or complexity budgets. Developers implement the feature, test the happy path, and ship without guard rails. CVE-2024-21793 (F5 BIG-IP Next Central Manager) was an OData injection that leaked admin password hashes — OData's filter surface is an injection vector if query construction concatenates strings rather than using parameterized queries.

**How to avoid:**
- **Max expansion depth:** Default to 2, configurable per entity set. Reject deeper $expand with 400.
- **Max filter node count:** Reject $filter ASTs with more than a configurable node limit (default: 50).
- **Max $top:** Cap at a configurable page size (default: 1000) regardless of what the client requests.
- **Parameterized queries only:** All filter literal values MUST be bound as SQL parameters — never string-interpolated into the query. This prevents OData injection → SQL injection.
- **$orderby allowlist:** Optionally restrict $orderby to indexed columns via a per-entity configuration.

**Warning signs:**
- No `MaxTop` or `MaxExpansionDepth` configuration option exists in the library API
- Filter literals are interpolated into SQL strings rather than bound as parameters
- No integration test that sends a deliberately large/deep query and expects a 400

**Phase to address:** Query translation phase; security properties must be built in, not bolted on.

---

### Pitfall 9: $metadata Namespace and CSDL Structural Errors Break Clients

**What goes wrong:**
Generated EDMX uses wrong namespace, missing `edmx:Edmx` root element, incorrect `edmx:DataServices` child structure, or enums/entities sharing the same name. Tooling like odata2ts, Power BI, and Excel's OData connector fail to parse the metadata and display cryptic errors.

**Why it happens:**
Developers generate XML by hand-writing templates or using `JSON.stringify` on an ad-hoc object. The CSDL spec (Part 3) has precise structural requirements — wrong attribute casing, wrong element order, or a missing `$Version` attribute all cause schema validation failures.

**How to avoid:**
Generate EDMX from a typed CSDL builder (not template strings). Validate the output against the OData CSDL JSON schema or the EDMX XSD before shipping. Run `odata2ts` against the generated $metadata endpoint as part of CI — if it fails to generate types, the metadata is broken.

**Warning signs:**
- `odata2ts` or Power BI throws "unexpected root element" or "missing namespace"
- $metadata contains `Edm.DateTime` (v3) instead of `Edm.DateTimeOffset`
- Entity and enum share the same qualified name

**Phase to address:** $metadata generation phase; validate with odata2ts in CI from the start.

---

### Pitfall 10: $nextLink / Pagination Implementation Violates the Spec

**What goes wrong:**
Three common mistakes: (1) including a `@odata.nextLink` when `$top` is less than the total count but the entire requested page was returned (spec says: no nextLink if the result is complete); (2) generating nextLink with `$skip` offset instead of `$skiptoken` (offset pagination is vulnerable to duplicates/skips when rows are inserted/deleted during pagination); (3) wrong `$top` value in generated nextLink when both server-driven pageSize and client `$top` are active.

**Why it happens:**
Pagination logic is subtle. Developers copy the pattern `if (results.length === pageSize) { addNextLink() }` without accounting for the case where `$top < pageSize` and the client only wanted that exact count. The OData spec requires cursor-based (`$skiptoken`) for server-driven paging, but offset-based (`$skip`) is simpler to implement.

**How to avoid:**
For server-driven paging: use `$skiptoken` with a deterministic cursor (e.g., the last entity's key value plus the $orderby values). Only include `@odata.nextLink` if there are more results than the current page. If client sends `$top=5` and page size is 100, return exactly 5 results with no nextLink. Write a test that verifies nextLink is absent when `$top` equals or is less than total results.

**Warning signs:**
- `@odata.nextLink` present even when the response contains all matching records
- nextLink contains `$skip=100` instead of `$skiptoken=...`
- Paginating through a mutating dataset returns duplicate or skipped rows

**Phase to address:** Pagination / $count phase.

---

### Pitfall 11: Composite Keys and Key Predicate Routing Is Broken

**What goes wrong:**
Entities with composite primary keys generate URL patterns like `/EntitySet(Key1=1,Key2='abc')`. Standard NestJS route parameters (`/:id`) don't parse this format. Developers patch it by treating the entire parenthesized string as a single route param, which breaks URL encoding and fails entirely for single-key entities that use the shorthand `EntitySet(1)` form.

**Why it happens:**
OData key predicates are not standard REST path parameters. The spec allows both positional (`/EntitySet(1)`) and named (`/EntitySet(Id=1)`) forms for single-key entities, and requires named form for composite keys. This requires a custom route matching layer, not NestJS's built-in `@Param()`.

**How to avoid:**
Implement a custom OData path parser that extracts entity set name and key predicate from the raw URL before NestJS route resolution. Build composite key support from day one — retrofitting it later requires touching every controller handler. Test with entities that have 1, 2, and 3 key properties.

**Warning signs:**
- Composite key entities are not in initial scope but entity set routing uses `:id` pattern
- GET `/Orders(CustomerId=1,OrderId=42)` returns 404
- Routing layer cannot distinguish `/Customers(1)` from `/Customers(Key=1)`

**Phase to address:** Core routing / path parser phase (foundational; must be correct before CRUD is built).

---

### Pitfall 12: Prefer Header and ETag Concurrency Not Implemented

**What goes wrong:**
Clients (SAP UI5, Microsoft Power Apps, Dynamics integrations) send `Prefer: return=representation` on POST/PATCH and expect the modified entity in the response body. Without this, they make a second GET request. Clients also send `If-Match: "etag-value"` for optimistic concurrency; without proper 412 responses, concurrent updates silently overwrite each other.

**Why it happens:**
These features are often deferred as "nice to have" and never added. The Prefer header is misimplemented: some libraries apply it to GET requests (spec says it MUST NOT be applied to GET), others ignore it entirely on PATCH. ETag requires storing a version column or computing a hash, which adds schema coupling.

**How to avoid:**
Implement `Prefer: return=minimal` (204 No Content) and `return=representation` (201/200 with body) for POST/PATCH from the start — they are required for enterprise clients. For ETag: map TypeORM `@VersionColumn()` to `Edm.Int32` and expose it as `@odata.etag` in the response. On PATCH/DELETE with `If-Match`, compare version, return 412 if mismatch. Document that `If-Match: *` bypasses version check (upsert semantics).

**Warning signs:**
- SAP UI5 ODataModel reports 200 response but still makes a follow-up GET
- PATCH response body is empty even when client sends `Prefer: return=representation`
- Two concurrent PATCHes to the same entity both succeed (last write silently wins)

**Phase to address:** CRUD operations phase; ETag can be in a subsequent phase but Prefer header is day-one.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode filter→SQL translation for only `eq`, `ne`, `lt`, `gt` | Unblocks demo quickly | Clients using `contains()`, `startswith()`, `in`, `any()` all fail — major enterprise blocker | Never for a library |
| Use `$skip/$top` offset pagination instead of `$skiptoken` cursor | Much simpler to implement | Duplicate/missing rows when underlying data mutates during pagination; fails OData conformance | MVP only, must be replaced before v1 |
| Generate EDMX as a hand-written string template | Quick to prototype | One structural mistake breaks all OData clients; hard to maintain as entity list grows | Never for a library |
| Store EDM as a singleton built once at app start from a manual list | Simple registration API | EDM diverges from TypeORM schema; nullable/type/relation mismatches not caught | Never — EDM must derive from TypeORM metadata |
| Implement $batch without transaction support | Passes basic batch tests | Violates atomicity; enterprise clients that rely on changeset rollback will corrupt data | Never |
| Skip `MaxTop` / expansion depth limits | Simpler API surface | Library enables DoS by default; adopters face security review failure | Never for a library |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| TypeORM `@ManyToOne` / `@OneToMany` | Navigating the relation triggers lazy load during JSON serialization | Always use `QueryBuilder.leftJoinAndSelect()` when $expand is present; disable lazy loading for OData responses |
| TypeORM `@VersionColumn()` and ETags | Not mapping version column to `@odata.etag` annotation | Include version in response envelope as `@odata.etag` value; check it on mutating requests |
| `reflect-metadata` version | Library and consuming app import different versions of reflect-metadata, causing TypeORM metadata to be invisible | Declare `reflect-metadata` as a peerDependency; document that it must be imported once at app entry point |
| NestJS `ValidationPipe` | Pipe rejects OData query strings as unexpected body properties | Only apply ValidationPipe to POST/PATCH/PUT body, not to OData query parameters |
| NestJS serialization interceptors (`ClassSerializerInterceptor`) | Strips `@odata.context` and other OData control properties from response | Exclude OData response objects from ClassSerializerInterceptor or return plain objects |
| TypeORM `DataSource` scoping in $batch | Sharing one `DataSource` instance across all changeset operations | Acquire a dedicated `QueryRunner` per changeset for transaction isolation |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 on $expand | Response time ∝ page size; DB logs show repeated SELECTs | Eager-load via JOIN in QueryBuilder | Any $expand call on a table with > ~20 rows |
| In-memory pagination after $expand | `$top=10 $expand=Orders` loads ALL Orders for ALL customers, then slices | Apply LIMIT/OFFSET at the outer query level before expanding | Pages > 100 rows |
| Unindexed $orderby | Full table scan for every page request | Document that $orderby columns should be indexed; optionally emit a warning | Tables > 10k rows |
| $filter `any()` / `all()` on unindexed navigation | Correlated subquery per row | Allow caller to restrict allowed filter functions via options; warn in docs | Collections > 1k rows |
| EDM rebuild on every request | $metadata endpoint response latency grows with entity count | Build EDM once at module bootstrap, cache immutably | > 50 entities registered |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Filter literals interpolated into SQL string | SQL injection via `$filter=Name eq 'a'; DROP TABLE--` (CVE-2024-21793 was this class of bug against BIG-IP) | All filter literal values MUST be SQL-parameterized via TypeORM QueryBuilder `.setParameter()` |
| $expand without depth limit | Resource exhaustion / DoS via deeply-nested expand tree | Enforce configurable `maxExpansionDepth` (default: 2), return 400 on violation |
| Exposing all entity properties in EDM by default | Sensitive fields (password hash, internal flags) queryable and selectable by clients | Provide `@ODataExclude()` decorator to remove properties from EDM; excluded properties MUST NOT appear in $select or $filter |
| $top without server-side maximum | Client requests `$top=1000000`, triggers full table scan and OOM | Enforce `maxTop` at the module level; return error or silently cap — document which behavior |
| OData error responses leaking stack traces | Stack traces expose internal paths, library versions, SQL fragments | Return only `code` + `message` in OData error format; log full details server-side only |

---

## "Looks Done But Isn't" Checklist

- [ ] **$expand:** Verify there is exactly 1 SQL query for `$expand=Orders` on 100 customers — not 101.
- [ ] **$filter string escaping:** Test `$filter=Name eq 'O''Brien'` (doubled single quote) returns correct result, not 500.
- [ ] **$batch rollback:** Send a changeset where operation 3 fails — verify operations 1 and 2 are rolled back in the DB.
- [ ] **$metadata nullable:** Verify a TypeORM `@Column({ nullable: true })` field appears as `Nullable="true"` in EDMX.
- [ ] **$nextLink completeness:** `$top=5` on a 5-row table returns no `@odata.nextLink` in the response.
- [ ] **OData error format:** A 400 response body matches `{ error: { code: '...', message: '...' } }`, not a NestJS default exception shape.
- [ ] **Non-OData route isolation:** `GET /api/health` returns plain JSON, not OData envelope, after `ODataModule.forRoot()` is registered.
- [ ] **Composite key routing:** `GET /odata/OrderItems(OrderId=1,ProductId=42)` returns 200, not 404.
- [ ] **Prefer header:** `POST /odata/Customers` with `Prefer: return=representation` returns 201 with the created entity body.
- [ ] **SQL injection guard:** `$filter=Name eq 'x''; DROP TABLE Customers;--'` returns 400 or empty results — not a DB error.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| N+1 on $expand discovered in production | MEDIUM | Add `leftJoinAndSelect` to affected entity expand paths; no API change needed |
| $batch atomicity missing | HIGH | Retrofit `QueryRunner` transaction scoping; requires refactoring request dispatch loop; test each changeset path |
| EDM/schema divergence | MEDIUM | Switch to auto-derivation from TypeORM metadata; existing manually-declared EDM entries become overrides |
| SQL injection via filter | CRITICAL | Audit all `QueryBuilder` calls; replace string interpolation with `.setParameter()`; rotate DB credentials; patch immediately |
| Broken $metadata CSDL structure | MEDIUM | Switch from string templates to typed CSDL builder; validate with odata2ts in CI |
| Missing max-depth / max-top guards | LOW | Add configurable guards at module level with sensible defaults; non-breaking change |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| N+1 on $expand | $expand / navigation property phase | Integration test: 1 SQL query for $expand on 100-row table |
| Filter operator precedence | Filter parsing phase | Unit tests against OData ABNF grammar test vectors |
| $batch changeset atomicity | $batch phase | Integration test: failing mid-changeset rolls back prior operations |
| EDM diverges from schema | EDM auto-derivation phase | Assert $metadata nullable matches TypeORM column definition |
| Abandoned library dependency | Foundation / stack selection phase | No `odata-v4-server` / `@odata/server` in package.json |
| OData / non-OData route conflict | Module bootstrap phase | Integration test: non-OData route unaffected by ODataModule |
| DateTime / timezone corruption | EDM type mapping phase | Filter test with explicit timezone offsets |
| Unrestricted query surface (DoS / injection) | Query translation phase | Security test: oversized filter returns 400; filter literal is parameterized |
| $metadata CSDL structural errors | $metadata generation phase | `odata2ts` parses $metadata in CI without error |
| $nextLink pagination errors | Pagination phase | Test: $top=N on N-row table yields no nextLink |
| Composite key routing | Core routing / path parser phase | Test: GET with composite key predicate resolves correctly |
| Prefer header / ETag missing | CRUD operations phase | Test: POST with Prefer:return=representation returns entity body |

---

## Sources

- [OData/WebApi Issue #1463 — expand causes N+1 query problem](https://github.com/OData/WebApi/issues/1463)
- [OData/WebApi PR #1653 — Fixing N+1 query bug on expands](https://github.com/OData/WebApi/pull/1653)
- [jaystack/odata-v4-server Issue #29 — $expand does not work properly](https://github.com/jaystack/odata-v4-server/issues/29)
- [jaystack/odata-v4-server Issue #30 — Unsupported features](https://github.com/jaystack/odata-v4-server/issues/30)
- [jaystack/odata-v4-server Issue #33 — Issues with $filter, $select and other QueryOperations](https://github.com/jaystack/odata-v4-server/issues/33)
- [codestudy.net — Transactional Batch Processing in OData Web API](https://www.codestudy.net/blog/transactional-batch-processing-with-odata/)
- [OData/odata.net Issue #1822 — atomicityGroup as dependsOn bug](https://github.com/OData/odata.net/issues/1822)
- [Microsoft ASP.NET OData Security Guidance](https://learn.microsoft.com/en-us/aspnet/web-api/overview/odata-support-in-aspnet-web-api/odata-security-guidance)
- [CVE-2024-21793 — OData injection in F5 BIG-IP Next Central Manager](https://www.cvedetails.com/cve/CVE-2024-21793/)
- [OData/AspNetCoreOData Discussion #886 — @odata.nextLink inconsistent with spec](https://github.com/OData/AspNetCoreOData/discussions/886)
- [OData/WebApi Issue #1638 — Incorrect $top in nextLink](https://github.com/OData/WebApi/issues/1638)
- [OData/WebApi Issue #1725 — No coercion between Edm.Date and DateTimeOffset](https://github.com/OData/WebApi/issues/1725)
- [Why was DateTime removed from OData v4 — Codementor](https://www.codementor.io/@chrisschaller/why-was-datetime-removed-from-odata-v4-1o5b3f5qup)
- [OData/WebApi Issue #608 — non-compliant streaming behavior](https://github.com/OData/WebApi/issues/608)
- [OASIS OData v4.0 Part 2: URL Conventions (filter grammar)](https://docs.oasis-open.org/odata/odata/v4.0/odata-v4.0-part2-url-conventions.html)
- [OASIS OData v4.0 Part 3: CSDL](https://docs.oasis-open.org/odata/odata/v4.0/odata-v4.0-part3-csdl.html)
- [OData/AspNetCoreOData Issue #595 — composite key drops from routing](https://github.com/OData/AspNetCoreOData/issues/595)
- [OData/WebApi Issue #816 — V6 No non-OData Http route Registered](https://github.com/OData/WebApi/issues/816)
- [OData Medium article — OData Query Injection Guide](https://medium.com/@kalireddipalli/odata-query-injection-detection-exploitation-and-mitigation-guide-d586b3694636)

---
*Pitfalls research for: NestJS OData v4 server library*
*Researched: 2026-04-07*
