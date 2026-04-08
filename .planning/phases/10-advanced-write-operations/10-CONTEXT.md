# Phase 10: Advanced Write Operations - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

PUT full entity replacement, deep inserts (POST with nested navigation properties creates related entities atomically at any depth), and Content-ID reference resolution in $batch changesets. Requirements: WRITE-01, WRITE-02, WRITE-03.

</domain>

<decisions>
## Implementation Decisions

### PUT Semantics

- **D-01:** Strict OData spec compliance. PUT replaces ALL properties — unspecified fields reset to column defaults (NULL for nullable, default value otherwise). Navigation properties in the body are ignored per OData spec. Reject if key in URL doesn't match body key. If-Match required when ETag is enabled (integrates with Phase 9's ETag infrastructure).

### Deep Insert Strategy

- **D-02:** Recursive nesting with configurable depth limit. Build a recursive approach that handles arbitrary nesting depth (Order → Items → ItemDetails). Use TypeORM transactions — if any entity fails validation, everything rolls back. Add a `maxDeepInsertDepth` config option (default: 5) to cap nesting via `ODataModule.forRoot()`. The recursive approach handles all depths — one implementation serves all use cases.

### Content-ID Resolution

- **D-03:** Resolve `$N` references in `batch-controller.ts` during changeset execution. After each operation in a changeset, store the created entity's key in a `contentIdMap`. Before the next operation, scan the URL and body for `$N` patterns and substitute with the resolved key. Keeps the parser clean — resolution happens close to execution where the created keys are available.

### Claude's Discretion

- Whether PUT needs a new `@ODataPut()` decorator or reuses `@ODataPatch()` with a flag
- Deep insert error message format (which nested entity failed, at what depth)
- Content-ID pattern matching regex (`$` followed by digits)
- Whether Content-ID resolution also applies to request bodies (not just URLs)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### PUT operation

- `.planning/REQUIREMENTS.md` — WRITE-01 requirement
- `packages/typeorm/src/translator/typeorm-auto-handler.ts` — Existing CRUD handler to extend with handleReplace
- `packages/core/src/decorators/odata-crud-decorators.spec.ts` — Existing CRUD decorator patterns

### Deep insert

- `.planning/REQUIREMENTS.md` — WRITE-02 requirement
- `packages/typeorm/src/translator/typeorm-auto-handler.ts` — handleCreate to extend for nested entities
- `packages/core/src/edm/edm-registry.ts` — Navigation property metadata for resolving nested types

### Content-ID batch references

- `.planning/REQUIREMENTS.md` — WRITE-03 requirement
- `packages/typeorm/src/batch/batch-controller.ts` — Changeset execution loop to add Content-ID resolution
- `packages/core/src/batch/batch-parser.ts` — Batch parsing (Content-ID extraction)
- `packages/core/src/batch/batch-types.ts` — Batch request types

### ETag integration (Phase 9)

- `packages/core/src/interfaces/etag.interface.ts` — IETagProvider interface for PUT If-Match enforcement
- `packages/typeorm/src/etag/typeorm-etag.provider.ts` — ETag provider implementation

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `TypeOrmAutoHandler` — has handleCreate, handleUpdate, handleDelete; PUT adds handleReplace following same pattern
- `batch-controller.ts` — changeset execution loop with QueryRunner transaction; Content-ID resolution hooks into this loop
- `@ODataPost`, `@ODataPatch`, `@ODataDelete` decorators — pattern for `@ODataPut`
- `IETagProvider` — PUT must enforce If-Match same as PATCH (Phase 9 infrastructure)

### Established Patterns

- CRUD handlers return `{ entity, locationUrl? }` for interceptor wrapping
- Batch operations dispatch to the same auto-handler methods
- Transactions via TypeORM QueryRunner with manual commit/rollback

### Integration Points

- `TypeOrmAutoHandler` — add `handleReplace()` and extend `handleCreate()` for deep insert
- `batch-controller.ts` — add `contentIdMap` tracking in changeset execution
- `ODataModuleResolvedOptions` — add `maxDeepInsertDepth` config option
- Test entities (Order, OrderItem) — need to verify cascade relations for deep insert testing

</code_context>

<specifics>
## Specific Ideas

- Recursive deep insert should use a single TypeORM transaction wrapping all nested saves
- Config limit `maxDeepInsertDepth` prevents unbounded recursion from malicious payloads
- Content-ID resolution should work in both URL paths and request body $N references

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 10-advanced-write-operations_
_Context gathered: 2026-04-08_
