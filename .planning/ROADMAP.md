# Roadmap: nestjs-odata

## Overview

Starting from an empty repo, this roadmap delivers a spec-compliant OData v4 NestJS library in five phases. Phase 1 lays the monorepo foundation and validates the highest-risk decision — the custom OData parser — before any other code is written. Phase 2 builds the EDM Registry, the central data structure that every subsequent component reads from. Phase 3 delivers the full read-only query surface. Phase 4 wires in CRUD, $expand, and the NestJS module API that library consumers actually touch. Phase 5 adds $batch atomicity and hardens the library for v1 release, including end-to-end validation of the full CI/CD release pipeline.

**v1.1 milestone (Phases 7-11)** closes the OData v4 spec gaps — bringing the library from ~65% to ~90% spec coverage. Phase 8 establishes the documentation site so every subsequent phase ships with docs. Phases 9-11 add response annotations, ETags, advanced write operations, and $search/$apply.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and Parser Spike** - Monorepo scaffolding, OSS tooling, OData sub-agent, and query parser spike
- [x] **Phase 2: EDM and $metadata** - Auto-derive entity data model from TypeORM and serve $metadata (completed 2026-04-07)
- [ ] **Phase 3: Query Engine and Response Format** - Full OData query surface and JSON envelope
- [x] **Phase 4: CRUD, $expand, and Module System** - Write operations, relation expansion, and NestJS consumer API (completed 2026-04-07)
- [x] **Phase 5: $batch, Security, and v1 Hardening** - Batch atomicity, security guards, full release pipeline, and CI compliance checks (completed 2026-04-07)
- [ ] **Phase 6: v1 Polish and Config Wiring** - Close all audit gaps: config wiring, peer dep fix, changeset fix, adapter seam, sub-agent validation
- [ ] **Phase 7: Filter Functions** - Lambda expressions and date/time, arithmetic, string functions translate to SQL
- [ ] **Phase 8: Documentation, GitHub Pages, and llms.txt** - VitePress docs site, API reference, GitHub Pages deployment, llms.txt for LLM discoverability
- [ ] **Phase 9: Response Annotations and ETags** - @odata.\* metadata annotations on every response plus ETag concurrency control
- [x] **Phase 10: Advanced Write Operations** - PUT full replace, deep inserts, and Content-ID batch references (completed 2026-04-08)
- [x] **Phase 11: $search and $apply** - Full-text search and data aggregation query subsystems (completed 2026-04-08)
- [ ] **Phase 12: Developer Experience Audit and API Simplification** - Eliminate API friction, simplify module wiring, full DX audit

## Phase Details

### Phase 1: Foundation and Parser Spike

**Goal**: The monorepo is running, all OSS tooling is wired, and the OData query parser approach is validated against the OASIS ABNF grammar
**Depends on**: Nothing (first phase)
**Requirements**: SCAF-01, SCAF-02, SCAF-03, SCAF-04, SCAF-05, SCAF-06, SCAF-07, SCAF-08, SCAF-09, SCAF-10, SCAF-11
**Success Criteria** (what must be TRUE):

1. `pnpm install && pnpm build` passes across all workspace packages with no errors
2. `pnpm lint` and `pnpm test` run in CI on every PR and pass against the current code
3. The OData sub-agent exists and can correctly answer questions about OData v4 filter expression syntax
4. A `$filter` parser spike correctly parses representative OASIS ABNF test vectors (e.g., `Price gt 5`, `contains(Name,'Alice')`, `Year eq 2024 and Active eq true`)
5. Running `changeset version` produces a correct semver bump and changelog entry
   **Plans:** 4 plans
   Plans:

- [x] 01-01-PLAN.md — Scaffold Turborepo monorepo, tsdown dual-build, Vitest + unplugin-swc, e-commerce test entities
- [x] 01-02-PLAN.md — ESLint 9 flat config, Prettier, Husky, commitlint, Changesets, VitePress docs
- [x] 01-03-PLAN.md — GitHub Actions CI/CD, Dependabot, CodeQL, GitHub templates, OData sub-agent
- [x] 01-04-PLAN.md — OData v4 query parser spike (TDD: lexer, recursive descent parser, AST, visitor)

### Phase 2: EDM and $metadata

**Goal**: TypeORM entities are automatically reflected into a valid OData EDM, and the `$metadata` endpoint serves correct CSDL XML that enterprise OData clients can consume
**Depends on**: Phase 1
**Requirements**: EDM-01, EDM-02, EDM-03, EDM-04, EDM-05, EDM-06, PKG-01, PKG-02, PKG-03, PKG-04, PKG-05, TEST-03, TEST-05
**Success Criteria** (what must be TRUE):

1. A TypeORM entity with columns and relations registered via `ODataModule.forFeature()` produces a `$metadata` response without any manual EDM declaration
2. The generated CSDL XML passes `odata2ts` validation in CI with zero errors
3. TypeORM `Date` columns map to `Edm.DateTimeOffset`, `number` to `Edm.Int32` or `Edm.Decimal`, `string` to `Edm.String` — verified by unit tests
4. `OneToMany`, `ManyToOne`, and `ManyToMany` TypeORM relations appear as navigation properties in the CSDL output
5. `@nestjs-odata/core` has zero imports from `typeorm` — verified by `publint` and `@arethetypeswrong/cli` in CI
   **Plans:** 5/5 plans complete
   Plans:

- [x] 02-01-PLAN.md — EDM types, adapter interfaces (IEdmDeriver, IQueryTranslator), OData decorators, EdmRegistry
- [x] 02-02-PLAN.md — NestJS module system (ODataModule.forRoot/forFeature, ODataTypeOrmModule.forFeature)
- [x] 02-03-PLAN.md — TypeORM-to-EDM type mapper and entity deriver (TDD)
- [x] 02-04-PLAN.md — CSDL XML builder, $metadata controller, service document, test-app e2e + odata2ts validation
- [x] 02-05-PLAN.md — Gap closure: odata2ts validation of $metadata CSDL (TEST-05)

### Phase 3: Query Engine and Response Format

**Goal**: A consumer can issue GET requests with any combination of `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count` and receive spec-compliant OData JSON responses
**Depends on**: Phase 2
**Requirements**: QUERY-01, QUERY-02, QUERY-03, QUERY-04, QUERY-05, QUERY-06, QUERY-09, RESP-01, RESP-02, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):

1. `GET /Products?$filter=Price gt 10&$select=Name,Price&$orderby=Name asc&$top=5&$skip=0` returns a valid OData JSON envelope (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`) with only the matching, projected fields
2. Invalid filter expressions (unknown fields, type mismatches) return an OData v4 error body (`error.code`, `error.message`) with HTTP 400 — not a NestJS default exception shape
3. All SQL generated by filter translation uses parameterized queries — no string interpolation — verified by a unit test that asserts `.getQuery()` contains `?` placeholders and no raw literal values
4. `$count=true` adds `@odata.count` to the response; `/$count` returns a plain integer
   **Plans:** 4 plans
   Plans:

- [x] 03-01-PLAN.md — Core query types (ODataQuery, ODataQueryResult, ODataValidationError), refined IQueryTranslator, ODataQueryPipe
- [x] 03-02-PLAN.md — TypeORM visitor classes TDD (FilterVisitor, SelectVisitor, OrderByVisitor, PaginationVisitor, TypeOrmQueryTranslator)
- [x] 03-03-PLAN.md — ODataResponseInterceptor, ODataExceptionFilter, buildContextUrl, @ODataGet and @ODataQuery decorators
- [x] 03-04-PLAN.md — TypeOrmAutoHandler, $count route, module wiring, Products controller e2e test

### Phase 4: CRUD, $expand, and Module System

**Goal**: Library consumers can add `@ODataController()` to a NestJS module, get full CRUD plus `$expand`, and mix OData and non-OData routes on the same controller without any serialization leaking
**Depends on**: Phase 3
**Requirements**: CRUD-01, CRUD-02, CRUD-03, CRUD-04, QUERY-07, QUERY-08, RESP-03, MOD-01, MOD-02, MOD-03, MOD-04, MOD-05, MOD-06, TEST-04, TEST-06
**Success Criteria** (what must be TRUE):

1. `POST /Products` creates an entity and returns HTTP 201 with a `Location` header and the created entity body in OData JSON format
2. `GET /Orders?$expand=Customer` returns order rows with the related customer object inlined — exactly one SQL query is executed regardless of the number of returned rows (no N+1)
3. `GET /api/health` on the same NestJS app returns plain JSON, not wrapped in an OData envelope, after `ODataModule.forRoot()` is registered
4. Adding `@ODataController(Product)` to a module auto-wires GET, POST, PATCH, DELETE routes with no additional configuration beyond `ODataModule.forFeature([Product])`
5. 80%+ code coverage across `packages/core` and `packages/typeorm` is reported in CI
   **Plans:** 5/5 plans complete
   Plans:

- [x] 04-01-PLAN.md — $expand AST types (ExpandNode/ExpandItem), parser extension, ODataQuery expand field, key parser utility
- [x] 04-02-PLAN.md — CRUD decorators (@ODataPost, @ODataPatch, @ODataDelete, @ODataGetByKey), @ODataController class decorator, interceptor single-entity support
- [x] 04-03-PLAN.md — TypeOrmExpandVisitor (JOIN translation), CRUD handlers in TypeOrmAutoHandler, $expand validation in ODataQueryPipe
- [x] 04-04-PLAN.md — Module system wiring (@ODataController path patching with serviceRoot in forRoot)
- [x] 04-05-PLAN.md — Test-app OData controller, health controller, e2e tests (CRUD, $expand, route isolation), coverage verification

### Phase 5: $batch, Security, and v1 Hardening

**Goal**: The library handles atomic multi-operation batch requests, enforces configurable security limits, and the full CI/CD release pipeline runs end-to-end — from lint through npm publish — producing packages fit for public consumption
**Depends on**: Phase 4
**Requirements**: BATCH-01, BATCH-02, BATCH-03, SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):

1. A `$batch` request where operation 3 of 5 fails rolls back operations 1 and 2 within the same changeset — verified by an integration test that checks the database state after the failed batch
2. Individual `$batch` requests outside a changeset succeed or fail independently — a failed request does not affect adjacent requests
3. `GET /Products?$top=10000` when `maxTop=100` is configured returns HTTP 400 with an OData error body — the oversized page request is rejected, not silently capped
4. `GET /Products?$expand=Orders($expand=Items($expand=Details))` beyond the configured `maxExpansionDepth` returns HTTP 400
5. The full release pipeline runs end-to-end without error: `pnpm lint` -> `pnpm test` -> `pnpm build` -> `changeset version` -> `npm publish` with OIDC provenance — verified by a successful dry-run in CI (`pnpm publish --dry-run`) and a real publish to a scoped test registry
6. `@arethetypeswrong/cli` reports no entrypoint issues and `publint` passes for both published packages after the release pipeline completes
   **Plans:** 4/4 plans complete
   Plans:

- [x] 05-01-PLAN.md — Custom multipart/mixed batch parser (core), batch controller with changeset atomicity and e2e tests (typeorm)
- [x] 05-02-PLAN.md — Security limit hardening (maxTop rejection, filter depth, per-entity overrides) and $expand pagination gap closure
- [x] 05-03-PLAN.md — Coverage enforcement (@vitest/coverage-v8 thresholds) and CI/CD release pipeline with npm OIDC provenance
- [x] 05-04-PLAN.md — VitePress documentation site (getting-started, API reference, examples for all v1 features)

### Phase 6: v1 Polish and Config Wiring

**Goal**: Close all gaps from the v1.0 milestone audit — wire disconnected config, fix packaging issues, and complete the adapter seam
**Depends on**: Phase 5
**Requirements**: SEC-04, MOD-02, SCAF-08
**Gap Closure**: Closes all gaps from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):

1. `ODataModule.forRoot({ maxFilterDepth: 5 })` causes `TypeOrmFilterVisitor` to reject filters with depth > 5 — verified by unit test
2. `pnpm changeset version` succeeds without validation errors (changeset config + peer dep version fixed)
3. `ODataModule.forFeature([entity])` triggers EDM registration via `EDM_ENTITY_CONFIGS` token consumer — verified by integration test
4. OData sub-agent answers 3 representative OData v4 spec questions correctly

**Plans:** 2 plans
Plans:

- [x] 06-01-PLAN.md — Wire maxFilterDepth to TypeOrmFilterVisitor (SEC-04) and add EdmFeatureInitializer to forFeature() (MOD-02)
- [x] 06-02-PLAN.md — Fix peer dep version mismatch and validate odata-expert sub-agent (SCAF-08)

### Phase 7: Filter Functions

**Goal**: Lambda expressions (`any`/`all`) and date/time, arithmetic, and string functions in `$filter` translate to correct SQL — completing the filter translator surface
**Depends on**: Phase 6
**Requirements**: FILT-01, FILT-02, FILT-03, FILT-04, FILT-05
**Success Criteria** (what must be TRUE):

1. `GET /Orders?$filter=Items/any(i: i/Price gt 100)` returns only orders that have at least one item with Price > 100 — translated to an EXISTS subquery, not post-fetch filtering
2. `GET /Orders?$filter=Items/all(i: i/Shipped eq true)` returns only orders where every item is shipped — translated to a NOT EXISTS subquery
3. `GET /Products?$filter=year(CreatedAt) eq 2024` returns products created in 2024 — date extraction runs in SQL, not application memory
4. `GET /Products?$filter=Price add Tax gt 50` returns products whose sum of Price and Tax exceeds 50 — arithmetic evaluated in SQL
5. `GET /Products?$filter=indexof(Name,'Pro') ge 0` and `contains`, `substring`, `concat` string function variants return correct results — translated to SQL LIKE or equivalent database functions

**Plans:** 2 plans
Plans:

- [x] 07-01-PLAN.md — Arithmetic operators (FILT-04), date/time functions (FILT-03), string functions indexof/substring/concat (FILT-05)
- [x] 07-02-PLAN.md — Lambda any/all EXISTS/NOT EXISTS subqueries (FILT-01, FILT-02)

### Phase 8: Documentation, GitHub Pages, and llms.txt

**Goal:** VitePress documentation site deployed to GitHub Pages, covering everything built so far (Phases 1-7): installation/setup guide, getting started tutorial, decorator API reference (auto-generated from TypeScript source), query options guide ($filter, $select, $orderby, $top, $skip, $count, $expand), CRUD operations guide, $batch usage, configuration reference, security/limits guide, and migration/upgrade notes. Plus llms.txt/llms-full.txt for LLM discoverability, and optionally an auto-generated MCP server. Also: create a project-level documentation sub-agent (or skill) that evaluates whether code changes require doc updates and applies them automatically — ensuring docs never drift from implementation in future phases.
**Depends on**: Phase 7
**Requirements**: DOC-INFRA, DOC-TYPEDOC, DOC-LLMS, DOC-DEPLOY, DOC-AUDIT, DOC-FILTER, DOC-SKILL
**Success Criteria** (what must be TRUE):

1. `pnpm build` in docs/ runs TypeDoc then VitePress and completes without errors
2. `llms.txt` and `llms-full.txt` are present in the VitePress build output
3. All 11 existing doc files have been audited against the real codebase and corrected
4. A new filter-functions guide documents lambda any/all, arithmetic operators, date/time functions, and string functions
5. TypeDoc auto-generates API reference markdown from `packages/core/src/index.ts`
6. GitHub Pages deployment workflow exists and is syntactically valid
7. Doc-guardian skill in `.claude/skills/doc-guardian/` maps source files to affected docs

**Plans:** 3 plans
Plans:

- [x] 08-01-PLAN.md — Documentation infrastructure: TypeDoc, vitepress-plugin-llms, VitePress theme, GitHub Pages workflow
- [x] 08-02-PLAN.md — Audit and rewrite all 11 doc files, create filter-functions guide
- [x] 08-03-PLAN.md — Doc-guardian skill creation and full build verification

### Phase 9: Response Annotations and ETags

**Goal**: Every entity response carries OData-required metadata annotations, and the server enforces ETag-based concurrency control so clients can perform optimistic locking
**Depends on**: Phase 8
**Requirements**: RESP-04, RESP-05, RESP-06, ETAG-01, ETAG-02, ETAG-03
**Success Criteria** (what must be TRUE):

1. `GET /Products(1)` returns a response body that includes `@odata.id`, `@odata.type`, and `@odata.navigationLink` annotations alongside entity fields — an OData v4 validator accepts the response as spec-compliant
2. `GET /Products` returns an `ETag` response header derived from the entity's version/timestamp column; the same value appears as `@odata.etag` in the entity body
3. `PATCH /Products(1)` with a stale `If-Match` header value returns HTTP 412 Precondition Failed with an OData error body — the update is not applied
4. `GET /Products(1)` with `If-None-Match` matching the current ETag returns HTTP 304 Not Modified with no body

**Plans:** 2 plans
Plans:

- [x] 09-01-PLAN.md — Response annotations (@odata.id, @odata.type, @odata.navigationLink) in ODataResponseInterceptor
- [x] 09-02-PLAN.md — ETag concurrency control (@ODataETag decorator, If-Match/If-None-Match enforcement, @odata.etag annotation)

### Phase 10: Advanced Write Operations

**Goal**: PUT replaces entire entities, POST can atomically create a resource and its related entities in one request, and `$batch` changesets support Content-ID cross-references
**Depends on**: Phase 6
**Requirements**: WRITE-01, WRITE-02, WRITE-03
**Success Criteria** (what must be TRUE):

1. `PUT /Products(1)` with a partial body resets unspecified fields to their column defaults — a subsequent GET confirms no residual values from the previous state
2. `POST /Orders` with a nested `Items` array in the body creates the order and all items in a single database transaction — if any item fails validation, neither the order nor any item is persisted
3. A `$batch` changeset that POSTs an entity in request `r1` and then references `$1` in a subsequent request URL resolves `$1` to the created entity's key — the second operation succeeds without the client knowing the server-assigned key in advance

**Plans:** 2/2 plans complete
Plans:

- [x] 10-01-PLAN.md — @ODataPut decorator, handleReplace() with metadata-driven default construction, PUT e2e tests
- [x] 10-02-PLAN.md — Deep insert (handleDeepCreate with maxDeepInsertDepth), Content-ID batch reference resolution

### Phase 11: $search and $apply

**Goal**: Clients can issue free-text `$search` queries and data-aggregation `$apply` pipelines — two independent query subsystems that extend the existing query parsing and translation infrastructure
**Depends on**: Phase 6
**Requirements**: SRCH-01, SRCH-02, AGG-01, AGG-02, AGG-03
**Success Criteria** (what must be TRUE):

1. `GET /Products?$search=laptop` returns products matching "laptop" across configured searchable fields — falling back to SQL LIKE when full-text search is not configured, with the backend pluggable via the existing translator interface
2. `GET /Orders?$apply=groupby((CustomerId),aggregate($count as OrderCount))` returns one row per customer with a count — translated to a SQL GROUP BY query
3. `GET /Orders?$apply=aggregate(Total with sum as GrandTotal)` returns a single aggregated row with the sum — not a collection of raw entities
4. `GET /Orders?$apply=filter(Status eq 'open')/groupby((CustomerId),aggregate($count as OpenOrders))` executes the filter transformation before grouping — pipeline steps compose correctly

**Plans:** 3/3 plans complete
Plans:

- [x] 11-01-PLAN.md — AST types, parsers (parseSearch/parseApply), ISearchProvider interface, @ODataSearchable decorator
- [x] 11-02-PLAN.md — TypeOrmSearchProvider, TypeOrmApplyVisitor, translator extension, SEARCH_PROVIDER DI registration
- [x] 11-03-PLAN.md — ODataQueryPipe/interceptor wiring, @ODataSearchable on test entities, e2e tests

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12

| Phase                                                 | Plans Complete | Status            | Completed  |
| ----------------------------------------------------- | -------------- | ----------------- | ---------- |
| 1. Foundation and Parser Spike                        | 0/4            | Planning complete | -          |
| 2. EDM and $metadata                                  | 5/5            | Complete          | 2026-04-07 |
| 3. Query Engine and Response Format                   | 0/4            | Planning complete | -          |
| 4. CRUD, $expand, and Module System                   | 5/5            | Complete          | 2026-04-07 |
| 5. $batch, Security, and v1 Hardening                 | 5/5            | Complete          | 2026-04-07 |
| 6. v1 Polish and Config Wiring                        | 0/2            | Planning complete | -          |
| 7. Filter Functions                                   | 2/2            | Complete          | 2026-04-08 |
| 8. Documentation, GitHub Pages, and llms.txt          | 3/3            | Complete          | 2026-04-08 |
| 9. Response Annotations and ETags                     | 0/2            | Planning complete | -          |
| 10. Advanced Write Operations                         | 2/2            | Complete          | 2026-04-08 |
| 11. $search and $apply                                | 3/3            | Complete          | 2026-04-08 |
| 12. Developer Experience Audit and API Simplification | 1/2            | In Progress       |            |

### Phase 12: Developer Experience Audit and API Simplification

**Goal:** Full audit of the library's developer experience from first install to production deployment. Eliminate API friction identified during docs review: remove dual controller registration (forRoot controllers + @Module controllers), auto-apply ODataQueryPipe inside @ODataQueryParam (remove @UsePipes coupling), make forFeature inherit serviceRoot from forRoot. Plus a broader DX audit covering error messages, type inference, IDE autocompletion, and any other paper cuts discovered during a fresh-eyes walkthrough.
**Requirements**: DX-01, DX-02, DX-03, DX-04, DX-05, DX-06, DX-07, DX-08, DX-09, DX-10, DX-11
**Depends on:** Phase 11
**Plans:** 1/2 plans executed

Plans:

- [x] 12-01-PLAN.md — Controller registration simplification, auto-pipe, serviceRoot inheritance
- [ ] 12-02-PLAN.md — Error message enrichment and public API export audit
