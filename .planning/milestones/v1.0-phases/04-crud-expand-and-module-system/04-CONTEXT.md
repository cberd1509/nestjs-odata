# Phase 4: CRUD, $expand, and Module System - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Library consumers can add `@ODataController(Entity)` to a NestJS controller, explicitly define CRUD operations via `@ODataGet()`, `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()` decorators, get `$expand` support for navigation properties, and keep OData routes cleanly separated from non-OData routes. Does NOT include `$batch` (Phase 5) or security guards/limits (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### CRUD Operation Design

- **D-01:** Merge-patch semantics for PATCH — send only changed fields, server merges with existing entity. Missing fields remain untouched. Standard OData v4 approach.
- **D-02:** Parenthetical key format in URLs: `/Products(42)`, `/OrderItems(OrderId=1,ItemId=3)` for composite keys. Follows OData URL conventions.
- **D-03:** POST returns HTTP 201 + `Location` header (entity URL) + full created entity in OData JSON format.
- **D-04:** DELETE returns HTTP 204 No Content.
- **D-05:** GET by key: `/Products(42)` returns a single entity (not wrapped in `value` array). Returns 404 if not found.
- **D-06:** Auth/validation via NestJS guards and interceptors — standard NestJS patterns (`@UseGuards()`, `@UsePipes()`). No custom lifecycle callback API in v1. For entity-level hooks (password hashing, timestamps), TypeORM's `@BeforeInsert()`/`@BeforeUpdate()` subscribers already cover this. Users who need handler-level business logic override the auto-handler method body.

### $expand Implementation

- **D-07:** Full nested `$expand` support from the start, with configurable `maxExpandDepth` (from `forRoot()` config, already defined in Phase 2). Recursive implementation — same visitor pattern used for N levels.
- **D-08:** Full nested query options on expanded entities: `$expand=Orders($filter=Amount gt 100;$top=5;$orderby=Date desc;$select=Id,Amount)`. Maximizes query power.
- **D-09:** `$expand` uses TypeORM JOINs (leftJoinAndSelect) — NOT lazy loading. One SQL query regardless of result count. Prevents N+1 (QUERY-08 requirement).
- **D-10:** Only relations exposed as NavigationProperties in the EDM are expandable. `@ODataExclude()` on a relation hides it from `$expand`. Attempting to expand a non-EDM relation returns 400.

### @ODataController and Route Design

- **D-11:** `@ODataController(Entity)` is a class decorator that sets entity context and route prefix at `{serviceRoot}/{EntitySetName}`. It is separate from NestJS `@Controller()` — they are not mixed on the same class.
- **D-12:** Resolver-discovery pattern (like GraphQL): user explicitly defines each operation they want using `@ODataGet()`, `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()` decorators. If a decorator is not present, that operation is not registered. Nothing auto-created.
- **D-13:** Method override for custom logic — each decorated method calls the auto-handler explicitly: `return this.handler.handleGet(query)`. Users can add custom logic before/after the handler call, or replace it entirely with custom implementation.
- **D-14:** Auto-handler (`TypeOrmAutoHandler`) is injected into controllers via NestJS DI. Provides `handleGet()`, `handleGetByKey()`, `handleCreate()`, `handleUpdate()`, `handleDelete()`, `handleCount()` methods. Already partially exists from Phase 3.

### Route Isolation and Service Root

- **D-15:** `@ODataController(Entity)` IS the OData scope — all methods on it get OData response formatting (interceptor + exception filter). No per-method opt-in needed since the controller is OData-only.
- **D-16:** Non-OData endpoints go on separate `@Controller()` classes. Clean separation: OData controllers for OData routes, NestJS controllers for everything else.
- **D-17:** Service root is a configurable prefix from `forRoot({ serviceRoot: '/odata' })`. OData routes are at `{serviceRoot}/{EntitySetName}` (e.g., `/odata/Products`). The service root is applied by the `@ODataController` decorator, not as a NestJS global prefix.

### Claude's Discretion

- ExpandVisitor implementation details (recursive AST walk + JOIN generation)
- How `@ODataController()` decorator internally applies interceptors and filters
- PATCH merge implementation strategy (deep merge vs shallow)
- Key parsing from parenthetical URL segments
- How auto-handler resolves the TypeORM repository for the entity
- Test structure and e2e test organization

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OData Entity Operations

- `.planning/REQUIREMENTS.md` — CRUD-01 through CRUD-04, QUERY-07, QUERY-08, RESP-03, MOD-01 through MOD-06

### Existing Implementation (Phase 3 foundation)

- `packages/core/src/decorators/odata-get.decorator.ts` — Existing @ODataGet() composite decorator pattern to extend
- `packages/core/src/response/odata-response.interceptor.ts` — Existing interceptor to reuse/extend
- `packages/core/src/response/odata-exception.filter.ts` — Existing exception filter
- `packages/typeorm/src/translator/typeorm-auto-handler.ts` — Existing auto-handler to extend with CRUD methods
- `packages/typeorm/src/translator/typeorm-query-translator.ts` — Existing query translator to extend with $expand
- `packages/core/src/query/odata-query.types.ts` — ODataQuery type to extend with $expand field

### Module System

- `packages/core/src/odata.module.ts` — Existing ODataModule (forRoot/forFeature)
- `packages/typeorm/src/odata-typeorm.module.ts` — Existing ODataTypeOrmModule

### Prior Phase Context

- `.planning/phases/02-edm-and-metadata/02-CONTEXT.md` — Module architecture decisions (D-03 through D-07)
- `.planning/phases/03-query-engine-and-response-format/03-CONTEXT.md` — Decorator and response patterns (D-05 through D-15)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `TypeOrmAutoHandler` (Phase 3): Already has `handleGet()` and `handleCount()`. Extend with `handleGetByKey()`, `handleCreate()`, `handleUpdate()`, `handleDelete()`.
- `@ODataGet()` decorator (Phase 3): Composite decorator using `applyDecorators()`. Same pattern for `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()`.
- `ODataResponseInterceptor` (Phase 3): Wraps results in OData JSON envelope. Reuse for CRUD responses.
- `ODataExceptionFilter` (Phase 3): Formats errors as OData error bodies. Reuse for CRUD errors.
- `TypeOrmQueryTranslator` (Phase 3): Visitor-based query translation. Extend with `ExpandVisitor` for `$expand`.
- `EdmRegistry` (Phase 2): Contains NavigationProperty metadata needed for $expand validation.

### Established Patterns

- Visitor pattern for query translation (Phase 3): `FilterVisitor`, `SelectVisitor`, etc. — add `ExpandVisitor` in the same pattern.
- Composite decorator pattern (Phase 3): `applyDecorators(Get(), SetMetadata(), UseInterceptors(), UseFilters())`.
- `reflect-metadata` for OData decorator storage (Phase 2): `@ODataEntitySet()`, `@EdmType()`, `@ODataExclude()`.

### Integration Points

- `ODataTypeOrmModule.forFeature()` — registration point for new entity controllers
- `EdmRegistry` — source of truth for NavigationProperties, entity types, and entity sets
- Parser AST — needs `$expand` node type support (parser may already partially handle `$expand`)

</code_context>

<specifics>
## Specific Ideas

- "More like GraphQL — the library discovers the existing resolvers" — user wants explicit opt-in per operation, not magic auto-CRUD
- "If a user wants to have both [OData and non-OData], they create two controllers" — clean separation, no mixing
- TypeORM entity subscribers (`@BeforeInsert`, `@BeforeUpdate`) cover entity-level hooks — no need for custom lifecycle API

</specifics>

<deferred>
## Deferred Ideas

- Custom lifecycle callbacks (beforeCreate/afterCreate hooks at handler level) — consider for post-v1 if demand surfaces
- `Prefer` header support (`return=minimal` / `return=representation`) — Phase 5+ spec compliance enhancement
- PUT (full replacement) alongside PATCH — deferred, merge-patch covers most use cases

</deferred>

---

_Phase: 04-crud-expand-and-module-system_
_Context gathered: 2026-04-07_
