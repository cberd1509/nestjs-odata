# Phase 3: Query Engine and Response Format - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Translate parsed OData query AST into TypeORM `SelectQueryBuilder` calls and return spec-compliant OData v4 JSON responses. Covers `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count` (both query option and path segment). Does NOT include `$expand` (Phase 4) or CRUD operations (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### AST-to-QueryBuilder Translation Strategy

- **D-01:** Separate visitor classes per query option: `FilterVisitor`, `SelectVisitor`, `OrderByVisitor`, `PaginationVisitor`. Each walks its AST subtree and appends to the same `SelectQueryBuilder`. Follows the visitor pattern established in Phase 1's parser.
- **D-02:** `$filter` string functions (`contains`, `startsWith`, `endsWith`) map to TypeORM-native LIKE/ILIKE where possible. Raw SQL fragments only for functions TypeORM can't express (e.g., `length()`, `indexof()`). Maximizes database portability.
- **D-03:** `$select` uses `QueryBuilder.select()` for real SQL projection — only requested columns fetched from the database. Requires mapping OData property names back to TypeORM column names via EdmEntityType metadata.
- **D-04:** Parameter binding uses TypeORM's built-in parameterization: `.where('price > :p1', { p1: value })`. Generate unique parameter names (`:p1`, `:p2`, ...) to avoid collisions in complex filters. QUERY-09 mandates zero string interpolation.

### OData JSON Response Envelope

- **D-05:** A `ODataResponseInterceptor` (NestJS interceptor) wraps raw query results into the OData envelope: `{ @odata.context, value, @odata.count, @odata.nextLink }`. Applied only to OData routes via decorator. Non-OData routes are unaffected.
- **D-06:** `@odata.nextLink` uses offset-based pagination with `$skip`/`$top`. nextLink = same URL with `$skip` incremented by `$top`. Honors `maxTop` config from Phase 2. nextLink is omitted (not null) when there are no more pages.
- **D-07:** `@odata.context` includes `$select` projection: e.g., `/odata/$metadata#Products(Name,Price)` when `$select` is used, `/odata/$metadata#Products` when no `$select`. Follows OData v4 spec section 10.
- **D-08:** `$count=true` as query param adds `@odata.count` to the JSON response alongside the `value` array. `GET /:entitySet/$count` returns the count as a plain integer (`text/plain`). Both behaviors required by QUERY-06.

### Error Handling and Validation

- **D-09:** A custom `ODataExceptionFilter` catches errors on OData routes and formats them as OData v4 error bodies: `{ error: { code, message, details } }`. Applied via `@UseFilters()` on OData controllers. Non-OData routes keep NestJS default error shape.
- **D-10:** Field validation happens at parse time with EDM context — after parsing the query AST, validate field names and types against the `EdmRegistry` BEFORE hitting the database. Unknown field → 400 with "Property X not found on entity Y". Type mismatch → 400.
- **D-11:** The existing parser throws structured `ODataParseError` with position and expected token info. The `ODataExceptionFilter` maps this to an OData 400 error with a helpful message. Zero leakage of internal stack traces.

### Controller and Routing Design

- **D-12:** User-defined controllers with method-level decorators. User creates a standard NestJS controller and applies `@ODataGet()` on specific methods. Example: `@Controller('products') class ProductController { @ODataGet() findAll(@ODataQuery() query) { ... } }`. Maximum flexibility — user controls routing, can add custom endpoints alongside.
- **D-13:** A default query handler is auto-provided with opt-in override. The `@ODataGet()` decorator auto-provides a default handler that translates the query and returns results. User can override by defining their own method body (e.g., to add authorization or custom filtering). Zero boilerplate for the common case.
- **D-14:** A custom `ODataQueryPipe` parses the raw query string using the Phase 1 parser and injects a typed `ODataQuery` object (with filter AST, select list, orderby list, top, skip, count flag). The controller handler receives the already-parsed query.
- **D-15:** `GET /:entitySet/$count` registered as a separate route returning a plain integer. Required by QUERY-06 and the phase success criteria.

### Claude's Discretion

- Exact visitor class internal implementation details
- TypeORM QueryBuilder chaining order and optimization
- ODataQuery type shape (beyond the agreed fields)
- Internal naming conventions for parameter generation
- How the auto-provided handler discovers the correct TypeORM repository
- Interceptor/filter registration mechanics (module-level vs route-level)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OData v4 Specification

- `https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html` — URL Conventions (§5 for query options, §4 for resource paths)
- `https://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html` — JSON Format (§10 for context URL, §12 for collection responses)
- `.claude/agents/odata-expert.md` — OData expert agent with spec knowledge

### Project Files

- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — QUERY-01 through QUERY-09, RESP-01, RESP-02, TEST-01, TEST-02
- `.planning/research/ARCHITECTURE.md` — Component boundaries, adapter seam design
- `.planning/research/PITFALLS.md` — N+1 on $expand, parameterization requirements

### Existing Code (Phase 1-2 outputs)

- `packages/core/src/parser/ast.ts` — Discriminated union AST nodes (FilterNode, SelectItem, OrderByItem, etc.)
- `packages/core/src/parser/parser.ts` — OData query parser
- `packages/core/src/parser/visitor.ts` — Visitor interface for AST traversal
- `packages/core/src/parser/errors.ts` — ODataParseError with position info
- `packages/core/src/interfaces/query-translator.interface.ts` — IQueryTranslator placeholder (refine in this phase)
- `packages/core/src/edm/edm-registry.ts` — EdmRegistry for field validation
- `packages/core/src/edm/edm-entity-type.ts` — EdmEntityType with properties and navigation
- `packages/core/src/odata.module.ts` — ODataModule with forRoot/forFeature
- `packages/core/src/metadata/metadata.controller.ts` — Existing MetadataController pattern
- `packages/typeorm/src/odata-typeorm.module.ts` — ODataTypeOrmModule with TypeOrmEdmInitializer

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `packages/core/src/parser/` — Full OData query parser with discriminated union AST. Parser outputs are the direct input to this phase's translation layer.
- `packages/core/src/parser/visitor.ts` — Visitor interface pattern to follow for the query option visitors.
- `packages/core/src/edm/edm-registry.ts` — EdmRegistry injectable singleton. Use for field validation (D-10) — check property names and types before querying.
- `packages/core/src/metadata/metadata.controller.ts` — Pattern for NestJS controller with dynamic path. Reference for routing integration.
- `packages/core/src/odata.module.ts` — ConfigurableModuleBuilder pattern with `forRoot`/`forFeature`.

### Established Patterns

- TypeScript discriminated unions for type-safe data structures (AST nodes)
- Visitor interface for extensibility (parser visitor)
- pnpm workspace with tsdown dual-build (ESM+CJS)
- Vitest + unplugin-swc for testing with decorator metadata
- NestJS DI with injection tokens (Symbol-based)
- Core/adapter split: all ORM-specific code in `@nestjs-odata/typeorm`

### Integration Points

- `IQueryTranslator.translate()` — needs signature refinement. Currently `(query: unknown, entityType: EdmEntityType): unknown`. Should take typed `ODataQuery` and return TypeORM `SelectQueryBuilder`.
- `ODataTypeOrmModule` — needs to register the TypeORM translator implementation and expose it via DI.
- `EdmRegistry` — field validation reads entity type properties to verify $filter/$select/$orderby field references.
- `ODataModule.forFeature()` — may need extension to register controller metadata alongside entity configs.

</code_context>

<specifics>
## Specific Ideas

- The user-defined controller pattern with method decorators (`@ODataGet()`) was specifically chosen over auto-generated controllers. This gives NestJS developers maximum flexibility to mix OData endpoints with regular REST endpoints in the same controller.
- The auto-provided handler with opt-in override means zero boilerplate for simple CRUD but full control when needed (auth, custom filtering, etc.).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 03-query-engine-and-response-format_
_Context gathered: 2026-04-07_
