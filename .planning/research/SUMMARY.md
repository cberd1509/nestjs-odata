# Project Research Summary

**Project:** nestjs-odata
**Domain:** Open-source NestJS OData v4 library (Turborepo monorepo, published to npm)
**Researched:** 2026-04-07
**Confidence:** MEDIUM-HIGH (stack HIGH; OData parser strategy MEDIUM; features HIGH)

## Executive Summary

This project builds an open-source, NestJS-native OData v4 server library — a gap that is genuinely unaddressed in the Node.js ecosystem. Both major Node.js OData v4 libraries are abandoned (jaystack's `odata-v4-server` last published 8 years ago; Soontao's fork effectively dead) and neither offered NestJS integration, TypeScript-first design, or automatic EDM derivation from ORM metadata. The library is structured as a Turborepo monorepo publishing two packages: `@nestjs-odata/core` (framework-agnostic OData engine) and `@nestjs-odata/typeorm` (TypeORM adapter). The core value proposition is zero-declaration EDM: TypeORM entities decorated once automatically produce a fully compliant `$metadata` endpoint, all query options, and CRUD routes — no double-registration required.

The recommended technical approach uses Turborepo + pnpm for monorepo orchestration, tsdown for library bundling, Vitest + unplugin-swc for testing (the only correct pairing for NestJS decorator metadata in Vitest), and Changesets for versioning. The highest-risk technical decision is the OData query parser: no production-grade, actively maintained parser exists for TypeScript, so the parser must be built internally using the OASIS ABNF grammar as the test oracle. This is bounded and testable work, but it must be validated early via a Phase 1 spike before other query translation work begins. The OSS tooling layer (GitHub Actions, Changesets, ESLint 9 flat config, Husky, `@arethetypeswrong/cli`) follows the 2025 consensus stack confirmed across LangChain JS, tRPC, Effect, and Turborepo itself.

The critical risks are: (1) N+1 query explosion on `$expand` if TypeORM lazy loading is not defeated via `leftJoinAndSelect`; (2) `$batch` changeset atomicity breaking without explicit `QueryRunner` transaction scoping; (3) OData query injection / SQL injection if filter literals are not parameterized; and (4) CSDL structural errors in `$metadata` that silently break enterprise client tooling. All four require active countermeasures baked into implementation — they cannot be retrofitted after the fact.

## Key Findings

### Recommended Stack

The stack is structured as a Turborepo monorepo with pnpm workspaces. `@nestjs-odata/core` has zero ORM dependencies; `@nestjs-odata/typeorm` imports core as a peer. This hard boundary enables future Prisma/Mongoose adapters. Build tooling uses tsdown (the tsup successor, powered by Rolldown) for dual ESM+CJS output. Testing uses Vitest 3.x with unplugin-swc because esbuild (Vitest's default transformer) does not support `emitDecoratorMetadata` — a requirement for NestJS and TypeORM decorators. The OData parser is built internally; the ecosystem has no viable production-grade alternative.

**Core technologies:**
- **NestJS 11** (peer dep): Application framework target — Express v5 default, Node 20+ required
- **TypeScript 5.7**: Required for `experimentalDecorators` + `emitDecoratorMetadata`
- **TypeORM 0.3.28** (peer dep in adapter): EDM auto-derivation source via `EntityMetadata` reflection
- **Turborepo 2.x + pnpm 9.x**: Monorepo orchestration — first-class NestJS example, workspace isolation
- **tsdown 0.21.x**: Library bundler (tsup successor) — 2x faster, ESM-first, API-compatible with tsup config
- **Vitest 3.x + unplugin-swc**: Test runner — only correct approach for NestJS decorator metadata in Vitest
- **Changesets**: Multi-package versioning — purpose-built for monorepos, first-class Turborepo support
- **ESLint 9 flat config + Prettier 3.x**: Code quality — confirmed across all surveyed OSS NestJS repos

**Avoid:**
- tsup (no longer actively maintained; migrate to tsdown)
- odata-v4-parser / @odata/parser (abandoned or too low-adoption to trust)
- esbuild alone in Vitest (breaks decorator metadata silently)
- `@nestjs/typeorm` as a direct dep in core (violates adapter isolation)

### Expected Features

The OData v4 spec is an OASIS standard with exhaustive documentation, making feature research HIGH confidence. The MVP is well-defined by cross-referencing .NET AspNetCoreOData, Apache Olingo, and the OASIS spec directly.

**Must have (table stakes — v1 launch):**
- `$filter` with full expression support (comparison, logical, string, date, lambda operators)
- `$select`, `$orderby`, `$top`, `$skip`, `$count` — pagination and projection primitives
- `$expand` with navigation property JOIN translation (single level minimum; multi-level in v1.x)
- `$metadata` CSDL/XML endpoint — machine-readable service description, auto-generated
- OData JSON response envelope (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`)
- OData error response format (not NestJS default exception shape)
- CRUD operations (POST/PATCH/DELETE) with correct status codes and Location header
- EDM auto-derivation from TypeORM entity metadata — the core value proposition
- `ODataModule.forRoot()` / `forFeature()` NestJS-native module registration
- `@ODataController()` high-level decorator for auto-CRUD
- `@ODataGet()` / `@ODataPost()` low-level decorators for custom routes
- Route mixing: OData and non-OData on the same controller without serialization leakage
- `$batch` with changeset atomicity — required by SAP, Microsoft Power Platform enterprise clients

**Should have (v1.x after validation):**
- ETag / optimistic concurrency (`If-Match`, `If-None-Match`, TypeORM `@VersionColumn()`)
- Nested `$expand` (multi-level, per-level `$filter`/`$select`)
- OData Actions and Functions (bound and unbound)

**Defer (v2+):**
- `$apply` aggregation extension
- `$search` free-text (spec is implementation-defined; no standard SQL mapping)
- `@odata.deltaLink` / delta queries
- OData v2/v3 support (separate versioned packages if demand materializes)
- Prisma adapter (fundamentally different reflection mechanism)

### Architecture Approach

The architecture has two clear layers separated by interface boundaries. Core owns the OData engine: EDM Registry (in-memory entity data model), Query Parser (OData URL to typed QueryAST), Metadata Builder (CSDL XML from EDM Registry), Route Binder, and Serializer/Interceptor. The TypeORM adapter implements two interfaces — `IEdmDeriver` (TypeORM EntityMetadata to EDM types, run once at module init) and `IQueryTranslator` (QueryAST to TypeORM QueryBuilder, per-request). Core never imports from the adapter; adapters receive interfaces via NestJS DI. The AST visitor pattern isolates each query option (`$filter`, `$select`, `$expand`) into independently testable visitor classes.

**Major components:**
1. **EDM Registry** (core) — in-memory entity data model; single source of truth read by parser, metadata builder, serializer, and adapter
2. **Query Parser** (core) — parses OData URL segments and query options into a typed, immutable `QueryAST`
3. **Metadata Builder** (core) — generates CSDL/XML `$metadata` from EDM Registry; pure read, no mutation
4. **Route Binder + ODataModule** (core) — registers NestJS routes; applies selective OData envelope via metadata-scoped interceptor
5. **EDM Deriver** (typeorm adapter) — reads TypeORM `EntityMetadata` at module init, populates EDM Registry once
6. **Query Translator + Visitors** (typeorm adapter) — walks QueryAST at request time, produces TypeORM `QueryBuilder`

**Build order dictated by dependency graph:** Types/interfaces > EDM > Decorators > Query Parser > Metadata Builder > Serializer > Route Binder > ODataModule > TypeORM EDM Deriver > TypeORM Query Translator > integration tests.

### Critical Pitfalls

1. **N+1 queries on $expand** — TypeORM lazy-loads relations by default; accessing navigation properties during serialization fires one query per parent row. Prevention: translate every `$expand` clause into `QueryBuilder.leftJoinAndSelect()` before query execution. Verify with: exactly 1 SQL query for `$expand=Orders` on 100-row table.

2. **$batch changeset atomicity** — Without explicit transaction scoping, partial commits happen silently when a mid-changeset operation fails. Prevention: acquire a dedicated `QueryRunner` per changeset, wrap in `startTransaction()`/`commitTransaction()`/`rollbackTransaction()`. Verify with: integration test where operation 3 of 5 fails and operations 1+2 are rolled back.

3. **SQL/OData query injection** — Filter literals interpolated into SQL strings enable injection (CVE-2024-21793 class of bug). Prevention: all filter literal values MUST be SQL-parameterized via TypeORM QueryBuilder `.setParameter()`. Add `MaxTop` and `maxExpansionDepth` guards (default: 1000 and 2 respectively).

4. **$metadata CSDL structural errors** — Hand-written XML templates silently produce broken metadata that causes odata2ts, Power BI, and Excel OData connectors to fail. Prevention: use a typed CSDL builder (not template strings); run `odata2ts` against `$metadata` endpoint in CI from day one.

5. **Route serialization leakage** — Applying `ODataInterceptor` globally wraps non-OData routes in the OData envelope. Prevention: use `SetMetadata(ODATA_ROUTE, true)` on OData route handlers; interceptor checks this flag before wrapping. Verify: `GET /api/health` returns plain JSON after `ODataModule.forRoot()` is registered.

6. **EDM diverging from schema** — Manual EDM registration drifts from TypeORM column definitions (nullable/type/precision). Prevention: derive EDM deterministically from TypeORM `EntityMetadata` at module bootstrap; never maintain a manually-declared EDM list.

## Implications for Roadmap

Based on research, the component dependency graph directly maps to a phase structure. Core interfaces must exist before the EDM; the EDM before the parser/metadata; everything in core before the TypeORM adapter; the adapter before integration tests can run.

### Phase 1: Monorepo Scaffolding and OData Parser Spike

**Rationale:** All subsequent work depends on the monorepo structure being in place and the parser strategy being validated. The parser is the highest-risk decision in the stack — if the custom parser is unworkable, the approach must change before any other code is written. This is the only phase where "build vs. borrow" can be cheaply decided.

**Delivers:** Turborepo monorepo with `packages/core`, `packages/typeorm`, `apps/test-app`; full CI pipeline; a working `$filter` expression parser that passes OASIS ABNF test vectors.

**Addresses:** Parser strategy risk, monorepo tooling setup, OSS hygiene (Changesets, GitHub templates, commitlint, Husky, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md)

**Avoids:** Adopting abandoned `odata-v4-parser` or `@odata/parser`; choosing the wrong parser strategy before investing in query translation

**Stack:** Turborepo 2.x, pnpm 9.x, tsdown, Vitest + unplugin-swc, ESLint 9, Changesets, GitHub Actions CI/CD

**Research flag:** Spike needed — validate parser correctness against official OASIS ABNF grammar before committing to implementation approach

### Phase 2: EDM Foundation and $metadata Endpoint

**Rationale:** The EDM Registry is the single source of truth every other component reads from. Nothing else can be built until the EDM data model is stable. `$metadata` validates EDM correctness against real OData client tooling (odata2ts, Power BI) before any query logic is written.

**Delivers:** `@ODataEntity()` decorator, EDM Registry, EDM type system (EntityType, EntitySet, NavigationProperty, primitive types), `$metadata` CSDL/XML endpoint, TypeORM EDM Deriver (`EntityMetadata` to EDM types), CI validation via `odata2ts`.

**Addresses:** EDM auto-derivation (core value proposition), `$metadata` endpoint (required by all OData clients), DateTime/timezone type mapping

**Avoids:** CSDL structural errors (typed builder, not template strings), EDM schema divergence (derive from TypeORM, not manual list), Pitfall 4 and Pitfall 9

**Research flag:** Standard patterns well-documented in OASIS CSDL spec and .NET reference implementation — research-phase optional

### Phase 3: Query Options and OData JSON Envelope

**Rationale:** With the EDM stable, the parser and query translator can be built. This phase implements the read-only query surface that most OData consumers use first. All query options are interdependent (pagination requires `$count`; `@odata.nextLink` requires `$top`/`$skip`), so they ship together.

**Delivers:** Full query option support (`$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`), TypeORM Query Translator with AST visitor pattern, OData JSON response envelope (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`), OData error response format.

**Addresses:** All P1 query options, OData JSON format compliance, correct pagination with `@odata.nextLink` semantics

**Avoids:** Filter operator precedence bugs (spec-driven tests), pagination spec violations (Pitfall 10), SQL injection via parameterized queries (Pitfall 8)

**Research flag:** Filter AST visitor to TypeORM QueryBuilder translation may benefit from targeted research into TypeORM QueryBuilder API edge cases

### Phase 4: $expand, CRUD, and NestJS Module System

**Rationale:** `$expand` requires JOIN translation (N+1 pitfall prevention is built in from day one). CRUD operations complete the write surface. The NestJS module system (`ODataModule.forRoot/forFeature`, `@ODataController`, `@ODataGet/@ODataPost`) ties everything together into the consumer-facing API. Route mixing isolation is critical here.

**Delivers:** `$expand` with `leftJoinAndSelect` JOIN translation, CRUD operations (POST/PATCH/DELETE with correct status codes), `ODataModule.forRoot()`/`forFeature()`, `@ODataController()` auto-CRUD decorator, `@ODataGet()`/`@ODataPost()` low-level decorators, `ODataInterceptor` with selective envelope (no leakage to non-OData routes), Prefer header support.

**Addresses:** Route mixing (FEATURES.md differentiator), NestJS-native DX (differentiator), `$expand` with JOIN (Pitfall 1), serialization leakage (Pitfall 6), Prefer: return=representation (Pitfall 12)

**Avoids:** Global interceptor leakage, N+1 queries, coupling core to TypeORM

**Research flag:** ConfigurableModuleBuilder pattern for `forRoot`/`forRootAsync` is well-documented — standard NestJS pattern, no research needed

### Phase 5: $batch, Security, and v1 Hardening

**Rationale:** `$batch` is required for enterprise Microsoft/SAP clients but is independent of the query surface — it wraps CRUD operations, so it must come after Phase 4. Security hardening (`MaxTop`, `maxExpansionDepth`, `@ODataExclude()`) and spec compliance verification complete the v1 feature set.

**Delivers:** `$batch` with multipart MIME parsing, changeset atomicity via TypeORM `QueryRunner` transactions, `MaxTop`/`maxExpansionDepth` configuration, `@ODataExclude()` decorator, comprehensive integration test suite in `apps/test-app` covering OData spec compliance, composite key routing, `@arethetypeswrong/cli` validation in CI.

**Addresses:** `$batch` atomicity (Pitfall 3), security guards (Pitfall 8 — DoS/injection), composite key routing (Pitfall 11), published package export validation

**Avoids:** Partial commits on changeset failure, DoS via unbounded queries, broken published package exports

**Research flag:** `$batch` multipart MIME parsing and JSON batch format are complex spec areas — targeted research into OASIS batch spec (Part 1 section 11) and Microsoft OData batch documentation recommended before implementation

### Phase 6: v1.x Enhancements

**Rationale:** After v1 ships and consumer feedback arrives, add ETag/optimistic concurrency and multi-level `$expand`. These are P2 features — valuable for enterprise consumers but not required for initial adoption.

**Delivers:** ETag via TypeORM `@VersionColumn()` mapped to `@odata.etag`, `If-Match`/`If-None-Match` headers with 412 responses, multi-level nested `$expand` with per-level `$filter`/`$select`, OData Actions and Functions (bound/unbound).

**Addresses:** ETag / optimistic concurrency (Pitfall 12 partial), multi-level expand (P2 from FEATURES.md)

**Research flag:** OData Actions/Functions binding semantics benefit from targeted research — not immediately needed

### Phase Ordering Rationale

- Phase 1 before everything: parser spike is the highest-risk decision; if it fails, the approach changes before any investment is made
- Phase 2 before Phase 3: the EDM is the central data structure — parser, metadata builder, and serializer all read from it; building them before the EDM is stable means rebuilding
- Phase 3 before Phase 4: query options are read-only; CRUD/module wiring builds on top of working query infrastructure
- Phase 4 before Phase 5: `$batch` wraps CRUD operations; changeset atomicity requires working POST/PATCH/DELETE
- Phase 6 after v1 ship: ETag and multi-level expand are v1.x features; consumer feedback should prioritize ordering

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Parser Spike):** OData ABNF grammar is well-specified but implementing a correct recursive-descent parser for the full expression language is non-trivial. Validate the spike against official test vectors before committing.
- **Phase 5 ($batch):** OData batch request format (multipart MIME + JSON batch format) has subtle spec requirements around changeset boundaries, atomicityGroup, and response ordering. Read OASIS Part 1 section 11 and Microsoft JSON batch format docs before implementation.

Phases with standard patterns (skip research-phase):
- **Phase 2 (EDM + $metadata):** CSDL spec is precise and .NET reference implementation is well-documented. TypeORM EntityMetadata API is stable.
- **Phase 3 (Query options):** AST visitor pattern is well-understood; TypeORM QueryBuilder API is documented.
- **Phase 4 (Module system):** `ConfigurableModuleBuilder` pattern is documented in NestJS official docs; route isolation via `SetMetadata`/`Reflector` is standard NestJS.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core tooling (Turborepo, pnpm, Vitest+unplugin-swc, tsdown, Changesets) verified against official docs and OSS project survey across 7 major repos. tsdown pre-1.0 is the only caveat. |
| Features | HIGH | OData v4 is an OASIS standard with exhaustive public spec. Cross-referenced against .NET AspNetCoreOData, Apache Olingo, and two Node.js implementations. |
| Architecture | HIGH | Component boundaries and patterns confirmed via NestJS TypeORM module internals (DeepWiki), jaystack/odata-v4-server source analysis, and official NestJS docs. |
| Pitfalls | HIGH | 12 pitfalls cross-referenced against OData/WebApi GitHub issues, abandoned library post-mortems, official OASIS spec, and CVE database. |
| OSS Tooling | HIGH | Verified against official NestJS repos and 7-project OSS survey (LangChain JS, Effect, tRPC, Drizzle, Hono, Crawlee, Turborepo). |
| OData Parser Strategy | MEDIUM | Decision to build internally is correct given ecosystem state, but it adds scope. Needs Phase 1 spike to confirm feasibility before investment. |

**Overall confidence:** HIGH (with parser strategy as the one MEDIUM area requiring early validation)

### Gaps to Address

- **Custom parser scope:** The internal OData v4 query parser is the highest-risk deliverable. Scope is bounded to query options only (`$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip`) — not a full OData URL parser. Validate in Phase 1 spike.
- **tsdown pre-1.0 stability:** tsdown 0.21.x is pre-1.0. Pin to a specific minor version and monitor the tsdown GitHub releases during development.
- **Multi-level $expand performance at scale:** Single-level JOIN is well-understood; deeply nested `$expand` with per-level `$filter` may require recursive QueryBuilder composition that is not yet validated against TypeORM query generation. Defer to Phase 6 with integration tests as the oracle.
- **$batch format decision:** OData 4.01 adds a JSON batch format alongside the original multipart MIME format. Recommendation: implement multipart MIME first (broader tool support); add JSON batch in v1.x.

## Sources

### Primary (HIGH confidence)

- Turborepo official NestJS example: https://github.com/vercel/turborepo/tree/main/examples/with-nestjs
- tsdown documentation v0.21.7: https://tsdown.dev/guide/
- NestJS 11 announcement: https://trilon.io/blog/announcing-nestjs-11-whats-new
- @nestjs/typeorm peer deps: https://github.com/nestjs/typeorm/blob/master/package.json
- OData v4.01 OASIS Protocol Specification: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html
- OData JSON Format v4.01: https://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html
- NestJS TypeORM module internals (DeepWiki): https://deepwiki.com/nestjs/typeorm/2.1-typeormmodule
- OData CSDL XML Specification (OASIS): https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html
- OData/WebApi Issue 1463 (N+1 expand): https://github.com/OData/WebApi/issues/1463
- CVE-2024-21793 OData injection F5 BIG-IP: https://www.cvedetails.com/cve/CVE-2024-21793/
- Microsoft ASP.NET OData Security Guidance: https://learn.microsoft.com/en-us/aspnet/web-api/overview/odata-support-in-aspnet-web-api/odata-security-guidance
- NestJS TypeORM repo (tooling reference): https://github.com/nestjs/typeorm
- Changesets GitHub repo: https://github.com/changesets/changesets
- Turborepo publishing libraries guide: https://turborepo.dev/docs/guides/publishing-libraries
- OSS survey: LangChain JS, Effect, tRPC, Drizzle, Hono, Crawlee, Turborepo repos

### Secondary (MEDIUM confidence)

- ts-odata-v4-server (active, 2024): https://github.com/leyton-group/ts-odata-v4-server
- odata-v4-typeorm connector: https://github.com/andryuha49/odata-v4-typeorm
- NestJS GitHub issue OData Wrapper: https://github.com/nestjs/nest/issues/14382
- codestudy.net Transactional Batch Processing in OData: https://www.codestudy.net/blog/transactional-batch-processing-with-odata/

### Tertiary (LOW confidence)

- @odata/parser (Soontao fork, 22 stars): https://github.com/Soontao/odata-v4-parser — grammar reference only, not a dependency
- odata-v4-parser (jaystack, ~23k weekly downloads but 8 years abandoned): https://www.npmjs.com/package/odata-v4-parser — grammar reference only

---
*Research completed: 2026-04-07*
*Ready for roadmap: yes*
