# Phase 5: $batch, Security, and v1 Hardening - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Atomic multi-operation `$batch` requests, configurable security limits (maxTop, expand depth, query complexity), the full CI/CD release pipeline (lint → test → build → publish with OIDC provenance), VitePress documentation site, package quality checks (`publint`, `@arethetypeswrong/cli`), and gap closure from Phase 4 ($expand pagination, 80%+ coverage enforcement).

</domain>

<decisions>
## Implementation Decisions

### $batch Request Handling

- **D-01:** Custom multipart/mixed parser built in-house per OData v4 spec. No external multipart library dependency. Parser extracts individual requests and changesets from the `POST /$batch` body.
- **D-02:** Full changeset rollback — all operations in a changeset wrapped in a TypeORM `QueryRunner` transaction. If any operation fails, all roll back. Independent requests outside changesets execute independently and are unaffected by other failures.
- **D-03:** Per-operation status in batch response — each operation in the multipart response gets its own HTTP status code and body. Failed changeset operations all receive the error from the failing operation.
- **D-04:** $batch controller reuses existing CRUD handlers (`TypeOrmAutoHandler.handleCreate/handleUpdate/handleDelete/handleGetByKey`) internally. Each sub-request is routed to the appropriate handler based on the HTTP method and URL parsed from the multipart body.

### Security Limits & Query Complexity

- **D-05:** `maxTop` violations are rejected with HTTP 400 and OData error body — NOT silently clamped. `GET /Products?$top=10000` when `maxTop=100` returns `{ error: { code: 'BadRequest', message: '$top exceeds maximum of 100' } }`. Update ODataQueryPipe to reject instead of clamp.
- **D-06:** Query complexity limits are configurable with sensible defaults. Filter expression nesting depth, $expand depth, and other complexity dimensions each have a configurable max with a default value. Exceeding any limit returns HTTP 400.
- **D-07:** Per-entity security overrides via `forFeature()`. Global defaults set in `forRoot({ maxTop: 100, maxExpandDepth: 3, maxFilterDepth: 10 })`. Per-entity overrides in `forFeature([{ entity: Product, maxTop: 500 }])`. Per-entity values override global for that entity only.
- **D-08:** SEC-03 (parameterized queries) already implemented in Phase 3's FilterVisitor — verify it's complete, no new work needed.
- **D-09:** SEC-02 (`maxExpandDepth`) already enforced by Phase 4's ExpandVisitor — verify, adjust to support per-entity overrides.

### Release Pipeline & Package Quality

- **D-10:** Changesets + GitHub Actions pipeline completing Phase 1 scaffolding. Workflow: `pnpm lint` → `pnpm test` → `pnpm build` → `changeset version` → `npm publish` with OIDC provenance. Dry-run publish in CI on every PR.
- **D-11:** `publint` and `@arethetypeswrong/cli` checks added to CI pipeline. Both packages must pass with zero issues before publish.
- **D-12:** VitePress documentation site for v1 — getting-started guide, API reference (decorators, module config, query options), examples (basic CRUD, $expand, $batch, custom controllers). Deployed to GitHub Pages.

### Gap Closure from Phase 4

- **D-13:** Fix `$expand` `$top/$skip` — implement `expand-pagination.ts` with post-JOIN in-memory slicing. `applyExpandPagination()` slices expanded collection arrays after TypeORM hydration. Wire into `TypeOrmQueryTranslator.execute()`.
- **D-14:** Enforce 80%+ code coverage — install `@vitest/coverage-v8` in both packages, add coverage thresholds to vitest config (`statements: 80, branches: 80`), fail CI below threshold.

### Claude's Discretion

- $batch multipart boundary generation strategy
- Exact query complexity scoring formula and default thresholds
- VitePress site structure and navigation
- How `forFeature()` per-entity config merges with `forRoot()` globals
- Changelog formatting and release note structure
- Whether to add a $batch size limit (max operations per batch)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### $batch Specification

- `.planning/REQUIREMENTS.md` — BATCH-01, BATCH-02, BATCH-03, SEC-01 through SEC-04

### Security Infrastructure

- `packages/core/src/query/odata-query.pipe.ts` — Existing maxTop clamping (needs change to rejection)
- `packages/typeorm/src/translator/expand-visitor.ts` — Existing maxExpandDepth enforcement
- `packages/typeorm/src/translator/filter-visitor.ts` — Existing parameterized query implementation (SEC-03)

### Release Pipeline

- `.github/workflows/` — Existing CI scaffolding from Phase 1
- `.changeset/` — Existing Changesets configuration from Phase 1
- `docs/` — VitePress scaffolding from Phase 1 (if exists)

### Gap Closure

- `.planning/phases/04-crud-expand-and-module-system/04-VERIFICATION.md` — Documents $expand $top/$skip gap
- `packages/typeorm/src/translator/typeorm-query-translator.ts` — Where expand-pagination wires in

### Module System (per-entity config)

- `packages/core/src/odata.module.ts` — forRoot/forFeature pattern for security config extension
- `packages/typeorm/src/odata-typeorm.module.ts` — TypeORM adapter module

### Prior Phase Context

- `.planning/phases/03-query-engine-and-response-format/03-CONTEXT.md` — Query translation decisions
- `.planning/phases/04-crud-expand-and-module-system/04-CONTEXT.md` — CRUD and module system decisions

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `TypeOrmAutoHandler` (Phase 4): Has all CRUD handlers — $batch reuses these for sub-request execution
- `ODataExceptionFilter` (Phase 3): Error formatting — $batch adapts this for per-operation error responses
- `ODataQueryPipe` (Phase 3): Query validation — extend with rejection (not clamping) for security limits
- `ODataResponseInterceptor` (Phase 3): Response wrapping — $batch builds its own multipart response but reuses envelope logic
- Changesets config (Phase 1): Already set up for versioning
- GitHub Actions (Phase 1): CI workflows to extend

### Established Patterns

- Visitor pattern for query translation — filter depth can be tracked during visitation
- `forRoot()`/`forFeature()` module pattern — extend for per-entity security config
- Composite decorator pattern — no new decorators needed for $batch (it's a controller endpoint)
- TDD with Vitest — continue for all new code

### Integration Points

- `POST /$batch` endpoint — new controller method on the OData module
- `QueryRunner` — TypeORM's transaction mechanism for changeset atomicity
- `ODataQueryPipe` — security limit enforcement point
- `forRoot()` options — extend with security config fields
- CI workflow — extend with publish step and package quality checks

</code_context>

<specifics>
## Specific Ideas

- Query complexity should be "configurable with default values" — user wants knobs, not just fixed limits
- Per-entity overrides are important — Products may allow $top=500 while Orders caps at 50
- VitePress docs are essential for v1 open-source adoption

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)

- ESLint rule: OData decorators only on @ODataController — deferred because Phase 5 is already large with $batch + security + release pipeline. Post-v1 quality improvement.

</deferred>

---

_Phase: 05-batch-security-and-v1-hardening_
_Context gathered: 2026-04-07_
