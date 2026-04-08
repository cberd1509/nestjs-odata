# Phase 8: Response Annotations and ETags - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Add OData-required metadata annotations (`@odata.id`, `@odata.type`, `@odata.navigationLink`) to every entity response, plus ETag-based concurrency control (`If-Match`, `If-None-Match`). This phase covers requirements RESP-04, RESP-05, RESP-06, ETAG-01, ETAG-02, ETAG-03.

</domain>

<decisions>
## Implementation Decisions

### Annotation Placement

- **D-01:** Extend the existing `ODataResponseInterceptor` to generate `@odata.id`, `@odata.type`, and `@odata.navigationLink` annotations. The interceptor already wraps every response with `@odata.context` — adding annotations there keeps everything in core with zero adapter coupling. Use EDM registry metadata to resolve entity types and navigation properties.

### ETag Source Column

- **D-02:** Use TypeORM's `@UpdateDateColumn` as the ETag source. ETag value = hash of the timestamp. Most entities already have `updatedAt` columns, so no schema migration is needed. The adapter discovers the column via TypeORM metadata reflection (same pattern as EDM derivation).

### ETag Enforcement Scope

- **D-03:** Opt-in per entity. Only entities that have an `@UpdateDateColumn` (or an explicit `@ODataETag()` decorator) get ETag headers and `If-Match`/`If-None-Match` enforcement. Entities without a suitable column skip silently. This lets users adopt incrementally without breaking existing setups.

### Namespace Convention

- **D-04:** Auto-derive from module config. `ODataModule.forRoot({ namespace: 'MyApp' })` sets the namespace once. `@odata.type` becomes `#MyApp.Product`. Falls back to `'Default'` if not configured. Per-entity override is not needed — most apps use one namespace.

### Claude's Discretion

- ETag hash algorithm (MD5 vs SHA-256 vs simpler approach)
- Whether `@odata.editLink` is included alongside `@odata.id` (spec says optional)
- Exact format of `@odata.navigationLink` URLs (relative vs absolute)
- How annotations render in `$expand` nested entities

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Response format

- `.planning/REQUIREMENTS.md` -- RESP-04, RESP-05, RESP-06 requirements
- `packages/core/src/response/odata-response.interceptor.ts` -- Current interceptor to extend
- `packages/core/src/response/odata-context-url.builder.ts` -- URL builder pattern to reuse

### ETag concurrency

- `.planning/REQUIREMENTS.md` -- ETAG-01, ETAG-02, ETAG-03 requirements
- `packages/typeorm/src/translator/typeorm-auto-handler.ts` -- CRUD handler where If-Match must be enforced

### EDM metadata

- `packages/core/src/edm/edm-registry.ts` -- Entity type and navigation property metadata
- `packages/typeorm/src/deriver/typeorm-edm-deriver.ts` -- TypeORM metadata reflection pattern

### Test fixtures

- `apps/test-app/test/odata-compliance.e2e-spec.ts` -- Existing e2e tests to extend
- `apps/test-app/src/products/products.controller.ts` -- Test controller to add ETag column

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `ODataResponseInterceptor` (core): Already wraps all responses — natural injection point for annotations
- `buildContextUrl()` (core): URL generation logic reusable for `@odata.id` canonical URLs
- `EdmRegistry` (core): Has entity type names and navigation property lists
- `TypeOrmEdmDeriver` (typeorm): Reflects TypeORM metadata — same pattern for discovering @UpdateDateColumn

### Established Patterns

- Response wrapping via NestJS interceptor + Reflector metadata
- EDM metadata reflection via TypeORM `DataSource.getMetadata()`
- Core-adapter boundary: core defines interfaces, adapter implements (zero TypeORM imports in core)

### Integration Points

- `ODataResponseInterceptor.intercept()` — add annotation fields to response objects
- `typeorm-auto-handler.handlePatch()` / `handleDelete()` — check If-Match before mutation
- `ODataModuleResolvedOptions` — add `namespace` config field
- Test entities (Product, Category, OrderItem) — add @UpdateDateColumn for ETag testing

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 08-response-annotations-and-etags_
_Context gathered: 2026-04-08_
