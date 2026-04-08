# Roadmap: nestjs-odata

## Overview

Starting from an empty repo, this roadmap delivers a spec-compliant OData v4 NestJS library in five phases. Phase 1 lays the monorepo foundation and validates the highest-risk decision — the custom OData parser — before any other code is written. Phase 2 builds the EDM Registry, the central data structure that every subsequent component reads from. Phase 3 delivers the full read-only query surface. Phase 4 wires in CRUD, $expand, and the NestJS module API that library consumers actually touch. Phase 5 adds $batch atomicity and hardens the library for v1 release, including end-to-end validation of the full CI/CD release pipeline.

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

**Plans:** 0 plans (awaiting planning)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase                                 | Plans Complete | Status            | Completed  |
| ------------------------------------- | -------------- | ----------------- | ---------- |
| 1. Foundation and Parser Spike        | 0/4            | Planning complete | -          |
| 2. EDM and $metadata                  | 5/5            | Complete          | 2026-04-07 |
| 3. Query Engine and Response Format   | 0/4            | Planning complete | -          |
| 4. CRUD, $expand, and Module System   | 5/5            | Complete          | 2026-04-07 |
| 5. $batch, Security, and v1 Hardening | 5/5            | Complete          | 2026-04-07 |
| 6. v1 Polish and Config Wiring        | 0/0            | Not started       | -          |
