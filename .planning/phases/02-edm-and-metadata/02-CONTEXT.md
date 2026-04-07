# Phase 2: EDM and $metadata - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Auto-derive OData Entity Data Model from TypeORM entity metadata and serve a spec-compliant `$metadata` CSDL XML endpoint. Establish the adapter interface seam (core/adapter split) and the NestJS module registration API (`ODataModule.forRoot/forFeature`). This phase does NOT include query translation or CRUD — only EDM derivation and $metadata serving.

</domain>

<decisions>
## Implementation Decisions

### Adapter Interface Design

- **D-01:** Two separate interfaces defined in `@nestjs-odata/core`: `IEdmDeriver` (entity metadata → EDM types + navigation properties) and `IQueryTranslator` (query AST → ORM query). Clean separation — each can be tested independently. Future adapter authors (Prisma, Drizzle) implement these two interfaces.
- **D-02:** `IEdmDeriver` accepts generic entity metadata (not TypeORM-specific). The TypeORM adapter reads `DataSource.getMetadata()` and transforms it into the generic format that `IEdmDeriver` expects.

### Module Registration API

- **D-03:** Layered module architecture. Core provides `ODataModule` (ORM-agnostic, accepts `EdmEntityConfig[]`). TypeORM adapter provides `ODataTypeOrmModule` (reads TypeORM metadata, calls `ODataModule.forFeature()` internally). Future Prisma adapter would provide `ODataPrismaModule`.
- **D-04:** `ODataModule.forRoot()` accepts global config: `serviceRoot`, `maxTop`, `maxExpandDepth`, `namespace`, `unmappedTypeStrategy`.
- **D-05:** `ODataModule.forFeature()` accepts entity configurations per module — this is the ORM-agnostic registration point.
- **D-06:** `ODataTypeOrmModule.forFeature([Product, Category])` is the convenience wrapper that TypeORM users actually call — it reads TypeORM metadata and feeds core.
- **D-07:** Built using NestJS `ConfigurableModuleBuilder` for idiomatic async configuration (`forRootAsync`).

### $metadata Format

- **D-08:** CSDL XML namespace is configurable via `forRoot({ namespace: 'MyApp.Models' })`. Default: `'Default'`.
- **D-09:** EntityContainer name defaults to `'Container'` (OData convention).
- **D-10:** Unmapped type strategy is configurable: `'skip'` (default, safest) | `'string-fallback'` (serialize as Edm.String) | `'error'` (fail fast). Set via `forRoot({ unmappedTypeStrategy: 'skip' })`.

### Type Mapping Strategy

- **D-11:** Auto-derive TypeORM column types to OData EDM types. Standard mappings: `number(int)` → `Edm.Int32`, `number(float/decimal)` → `Edm.Decimal`, `string` → `Edm.String`, `boolean` → `Edm.Boolean`, `Date` → `Edm.DateTimeOffset` (NOT Edm.DateTime — removed in v4), `uuid` → `Edm.Guid`.
- **D-12:** `@EdmType()` decorator for overriding auto-derived type on specific columns. Supports precision/scale for decimals. Lives in `@nestjs-odata/core` (ORM-agnostic — just stores reflect-metadata).
- **D-13:** `@ODataExclude()` decorator to hide specific columns from OData exposure.

### EntitySet Naming

- **D-14:** Auto-pluralize entity class name for EntitySet name (Product → Products, Category → Categories). Use a simple pluralization library or built-in rules.
- **D-15:** `@ODataEntitySet('CustomName')` decorator to override auto-pluralization. Defined in `@nestjs-odata/core`.

### EDM Derivation Lifecycle

- **D-16:** EDM derivation runs at `onModuleInit` — derive once, cache forever. No runtime overhead per request. Fail-fast on bad configuration.
- **D-17:** `$metadata` endpoint serves cached CSDL XML string. Regeneration only on app restart.

### Decorator Placement

- **D-18:** OData decorators (`@EdmType`, `@ODataExclude`, `@ODataKey`, `@ODataEntitySet`) go directly on entity classes. Co-located with TypeORM decorators for readability.
- **D-19:** All OData decorators are defined in `@nestjs-odata/core` and use `reflect-metadata` only — zero TypeORM imports. Core stays ORM-agnostic; decorators are pure metadata annotations.

### Navigation Properties

- **D-20:** TypeORM `@ManyToOne` → `NavigationProperty Type="Namespace.Target"`. `@OneToMany` and `@ManyToMany` → `NavigationProperty Type="Collection(Namespace.Target)"`. Auto-derived from TypeORM relation metadata.

### View Support

- **D-21:** Support TypeORM `@ViewEntity()` as read-only OData EntitySets. Auto-detect view entities and mark them as read-only in the EDM — no POST/PATCH/DELETE routes generated. `@ViewColumn()` columns are derived the same way as regular `@Column()`.
- **D-22:** Support virtual OData views (projections) of regular entities via `@ODataView()` decorator or forFeature config. A virtual view exposes a subset of columns and/or applies a default pre-filter — without requiring a database view. Appears as a separate EntitySet in $metadata.
- **D-23:** Virtual views are defined in `@nestjs-odata/core` (ORM-agnostic). The concept is: "same underlying entity, different OData surface." Example: `ProductSummary` view that only exposes `Id`, `Name`, `Price` from `Product`.

### Claude's Discretion

- CSDL XML generation implementation details (template engine vs string builder)
- Exact pluralization approach (library vs built-in rules)
- EdmRegistry internal caching structure
- Unit test organization and naming
- Virtual view implementation details (decorator shape, pre-filter expression format)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OData v4 Specification

- `https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html` — CSDL XML format (Entity Types, Navigation Properties, EntityContainer, Schema)
- `https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html` — Protocol Part 1 (§11 for $metadata endpoint behavior)
- `.claude/agents/odata-expert.md` — OData expert agent with full EDM type mapping table

### Project Files

- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — EDM-01 through EDM-06, PKG-01 through PKG-05, TEST-03, TEST-05
- `.planning/research/ARCHITECTURE.md` — Component boundaries, adapter seam design
- `.planning/research/PITFALLS.md` — DateTime removal in v4, N+1 on $expand, entity registration drift

### Existing Code

- `packages/core/src/parser/ast.ts` — Discriminated union pattern to follow for EDM types
- `packages/core/src/parser/visitor.ts` — Visitor interface pattern to follow
- `apps/test-app/src/entities/` — All 6 e-commerce entities to test EDM derivation against

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `packages/core/src/parser/ast.ts` — Discriminated union + visitor pattern already established. EDM types should follow the same pattern.
- `packages/core/src/parser/visitor.ts` — Visitor interface template.
- `apps/test-app/src/entities/` — Product (ManyToOne/OneToMany/ManyToMany), Category, Customer, Order, OrderItem, Tag. Full e-commerce domain with all relation types.

### Established Patterns

- TypeScript discriminated unions for type-safe data structures
- Visitor interface for extensibility
- pnpm workspace with tsdown dual-build (ESM+CJS)
- Vitest + unplugin-swc for testing with decorator metadata

### Integration Points

- `packages/core/src/index.ts` — Currently exports parser. Will also export EDM types, decorators, and ODataModule.
- `packages/typeorm/src/index.ts` — Currently empty. Will export ODataTypeOrmModule and TypeORM-specific IEdmDeriver implementation.
- `apps/test-app/` — Will register ODataTypeOrmModule.forFeature() with existing entities for integration testing.

</code_context>

<specifics>
## Specific Ideas

- The layered module pattern (core ODataModule + adapter ODataTypeOrmModule) is critical for future extensibility. Every design decision should ask: "Would this still work if the ORM is Prisma instead of TypeORM?"
- Decorator approach: `@EdmType()`, `@ODataExclude()`, `@ODataKey()`, `@ODataEntitySet()` all live in core and only use reflect-metadata. No ORM coupling.
- The unmapped type strategy being configurable was specifically requested — not hardcoded.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 02-edm-and-metadata_
_Context gathered: 2026-04-07_
