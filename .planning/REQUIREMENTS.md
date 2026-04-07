# Requirements: nestjs-odata

**Defined:** 2026-04-07
**Core Value:** OData query power with zero double-declaration — define entities once in TypeORM, get spec-compliant OData v4 automatically, mixing cleanly with regular NestJS routes.

## v1 Requirements

### Project Scaffolding

- [ ] **SCAF-01**: Turborepo + pnpm monorepo with `packages/core`, `packages/typeorm`, and `apps/test-app`
- [ ] **SCAF-02**: Full OSS tooling: ESLint 9 flat config, Prettier, Husky + lint-staged, Commitlint (conventional commits)
- [ ] **SCAF-03**: GitHub templates: issue templates (bug report, feature request), PR template, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- [ ] **SCAF-04**: CI/CD: GitHub Actions for lint, test, build on PR; Changesets-based release workflow with automatic semver and changelog generation
- [ ] **SCAF-05**: npm package publishing with OIDC trusted publishing (no long-lived tokens)
- [ ] **SCAF-06**: `@arethetypeswrong/cli` + `publint` in CI to validate package exports
- [ ] **SCAF-07**: VitePress documentation site with typedoc-generated API docs
- [ ] **SCAF-08**: OData v4 expert sub-agent built from the OASIS spec for implementation guidance
- [ ] **SCAF-09**: tsdown build pipeline for both packages (ESM + CJS dual build)
- [ ] **SCAF-10**: Vitest + unplugin-swc test setup (required for NestJS/TypeORM decorator metadata)
- [ ] **SCAF-11**: Dependabot + CodeQL security scanning configured from day one

### EDM & Metadata

- [ ] **EDM-01**: Auto-derive OData EDM (Entity Data Model) from TypeORM entity metadata — columns, types, nullability, relations
- [ ] **EDM-02**: Correct type mapping: TypeORM Date → Edm.DateTimeOffset, string → Edm.String, number → Edm.Int32/Decimal, etc.
- [ ] **EDM-03**: Navigation properties auto-derived from TypeORM relations (OneToMany, ManyToOne, ManyToMany)
- [ ] **EDM-04**: `$metadata` endpoint auto-generated as valid CSDL XML from registered entities
- [ ] **EDM-05**: `$metadata` always reflects current entity state — no drift from actual TypeORM entities
- [ ] **EDM-06**: EDM derivation happens at module initialization (`onModuleInit`), never at request time

### Query Options

- [ ] **QUERY-01**: Custom OData v4 query parser built from OASIS ABNF grammar
- [ ] **QUERY-02**: `$filter` support with full OData v4 filter expression parsing (comparison, logical, arithmetic, string functions, collection functions)
- [ ] **QUERY-03**: `$select` support for field projection — only requested fields returned
- [ ] **QUERY-04**: `$orderby` support for sorting by one or more fields (asc/desc)
- [ ] **QUERY-05**: `$top` and `$skip` support for pagination
- [ ] **QUERY-06**: `$count` support — both inline (`$count=true`) and `/$count` path segment
- [ ] **QUERY-07**: `$expand` support for related entity expansion via navigation properties
- [ ] **QUERY-08**: `$expand` must use JOINs (not lazy loading) to prevent N+1 queries
- [ ] **QUERY-09**: All filter literals are SQL-parameterized — zero string interpolation (injection prevention)

### Response Format

- [ ] **RESP-01**: OData v4 JSON response envelope: `@odata.context`, `value` array, `@odata.count`, `@odata.nextLink`
- [ ] **RESP-02**: OData v4 error format: `error.code`, `error.message`, `error.details`
- [ ] **RESP-03**: Response serialization is route-scoped — non-OData routes on the same controller are unaffected

### CRUD Operations

- [ ] **CRUD-01**: POST — create entity with OData-compliant response (201 + Location header + created entity)
- [ ] **CRUD-02**: PATCH — partial update with OData-compliant response
- [ ] **CRUD-03**: DELETE — delete entity with 204 No Content response
- [ ] **CRUD-04**: GET by key — single entity retrieval by primary key (including composite keys)

### Batch Operations

- [ ] **BATCH-01**: `$batch` endpoint accepting multipart/mixed batch requests
- [ ] **BATCH-02**: Changeset atomicity — all operations in a changeset succeed or all roll back (TypeORM QueryRunner transactions)
- [ ] **BATCH-03**: Individual requests outside changesets execute independently

### Module & Decorators

- [ ] **MOD-01**: `ODataModule.forRoot()` for global OData configuration (service root, global query limits, etc.)
- [ ] **MOD-02**: `ODataModule.forFeature([entities])` for registering OData-enabled entities per module
- [ ] **MOD-03**: `@ODataController(Entity)` class decorator for auto-CRUD with full query support
- [ ] **MOD-04**: `@ODataGet()`, `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()` route decorators for custom endpoints
- [ ] **MOD-05**: OData and non-OData routes coexist on the same controller without routing conflicts or serialization leaking
- [ ] **MOD-06**: Built using NestJS `ConfigurableModuleBuilder` for idiomatic async configuration

### Security

- [ ] **SEC-01**: `$maxTop` configuration to limit maximum page size
- [ ] **SEC-02**: `$expand` depth limit configuration to prevent deep traversal attacks
- [ ] **SEC-03**: All query-to-SQL translation uses parameterized queries — no interpolation
- [ ] **SEC-04**: Query complexity limits to prevent DoS via expensive filter expressions

### Testing

- [ ] **TEST-01**: TDD approach — tests written first against OData v4 spec expected behavior
- [ ] **TEST-02**: Unit tests for OData query parser against OASIS ABNF grammar
- [ ] **TEST-03**: Unit tests for EDM derivation from TypeORM entities
- [ ] **TEST-04**: Integration tests for full HTTP request/response cycle against test-app
- [ ] **TEST-05**: odata2ts validator in CI to verify $metadata CSDL correctness
- [ ] **TEST-06**: 80%+ code coverage across both packages

### Package Architecture

- [ ] **PKG-01**: `@nestjs-odata/core` has zero ORM dependencies — pure OData logic
- [ ] **PKG-02**: `@nestjs-odata/typeorm` imports core as peer dependency — implements adapter interfaces
- [ ] **PKG-03**: Adapter seam is two interfaces: `IQueryTranslator` and `IEdmDeriver` — core defines, adapters implement
- [ ] **PKG-04**: Folder structure accommodates future OData versions without breaking changes
- [ ] **PKG-05**: Peer dependency targeting NestJS ^10.0.0 || ^11.0.0 for broad compatibility

## v2 Requirements

### Advanced Query

- **QUERY-V2-01**: Multi-level `$expand` (expand within expand)
- **QUERY-V2-02**: `$apply` aggregation support (groupby, aggregate)
- **QUERY-V2-03**: `$search` free-text search (implementation-defined semantics)
- **QUERY-V2-04**: JSON batch format (OData v4.01 addition alongside multipart MIME)

### Advanced Features

- **ADV-01**: ETag / concurrency control (If-Match, If-None-Match headers)
- **ADV-02**: OData Actions and Functions (custom operations beyond CRUD)
- **ADV-03**: Delta responses (`@odata.deltaLink` for incremental sync)
- **ADV-04**: Singleton entities (non-collection endpoints)

### Ecosystem

- **ECO-01**: Prisma adapter package (`@nestjs-odata/prisma`)
- **ECO-02**: Drizzle adapter package (`@nestjs-odata/drizzle`)
- **ECO-03**: MikroORM adapter package (`@nestjs-odata/mikro-orm`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| OData v2/v3 support | v4 only — folder structure allows future version packages |
| Client-side OData SDK | Server-side library only |
| GraphQL bridge | Different paradigm, not a goal |
| Built-in authentication/authorization | NestJS Guards handle this — not the library's job |
| Sequelize adapter | Low demand, TypeORM covers the primary use case |
| Custom media entities (streaming) | High complexity, niche use case, defer to v2+ |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCAF-01 | Phase 1 | Pending |
| SCAF-02 | Phase 1 | Pending |
| SCAF-03 | Phase 1 | Pending |
| SCAF-04 | Phase 1 | Pending |
| SCAF-05 | Phase 1 | Pending |
| SCAF-06 | Phase 1 | Pending |
| SCAF-07 | Phase 1 | Pending |
| SCAF-08 | Phase 1 | Pending |
| SCAF-09 | Phase 1 | Pending |
| SCAF-10 | Phase 1 | Pending |
| SCAF-11 | Phase 1 | Pending |
| EDM-01 | Phase 2 | Pending |
| EDM-02 | Phase 2 | Pending |
| EDM-03 | Phase 2 | Pending |
| EDM-04 | Phase 2 | Pending |
| EDM-05 | Phase 2 | Pending |
| EDM-06 | Phase 2 | Pending |
| QUERY-01 | Phase 3 | Pending |
| QUERY-02 | Phase 3 | Pending |
| QUERY-03 | Phase 3 | Pending |
| QUERY-04 | Phase 3 | Pending |
| QUERY-05 | Phase 3 | Pending |
| QUERY-06 | Phase 3 | Pending |
| QUERY-07 | Phase 4 | Pending |
| QUERY-08 | Phase 4 | Pending |
| QUERY-09 | Phase 3 | Pending |
| RESP-01 | Phase 3 | Pending |
| RESP-02 | Phase 3 | Pending |
| RESP-03 | Phase 4 | Pending |
| CRUD-01 | Phase 4 | Pending |
| CRUD-02 | Phase 4 | Pending |
| CRUD-03 | Phase 4 | Pending |
| CRUD-04 | Phase 4 | Pending |
| BATCH-01 | Phase 5 | Pending |
| BATCH-02 | Phase 5 | Pending |
| BATCH-03 | Phase 5 | Pending |
| MOD-01 | Phase 4 | Pending |
| MOD-02 | Phase 4 | Pending |
| MOD-03 | Phase 4 | Pending |
| MOD-04 | Phase 4 | Pending |
| MOD-05 | Phase 4 | Pending |
| MOD-06 | Phase 4 | Pending |
| SEC-01 | Phase 5 | Pending |
| SEC-02 | Phase 5 | Pending |
| SEC-03 | Phase 5 | Pending |
| SEC-04 | Phase 5 | Pending |
| TEST-01 | Phase 3 | Pending |
| TEST-02 | Phase 3 | Pending |
| TEST-03 | Phase 2 | Pending |
| TEST-04 | Phase 4 | Pending |
| TEST-05 | Phase 2 | Pending |
| TEST-06 | Phase 4 | Pending |
| PKG-01 | Phase 2 | Pending |
| PKG-02 | Phase 2 | Pending |
| PKG-03 | Phase 2 | Pending |
| PKG-04 | Phase 2 | Pending |
| PKG-05 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 50 total
- Mapped to phases: 50/50
- Unmapped: 0

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after roadmap creation*
