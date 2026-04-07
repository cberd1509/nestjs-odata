# Architecture Research

**Domain:** NestJS OData v4 Library (Turborepo monorepo — core package + TypeORM adapter)
**Researched:** 2026-04-07
**Confidence:** HIGH (NestJS patterns confirmed via official docs + DeepWiki source analysis; OData components confirmed via jaystack/odata-v4-server and OData spec)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Consumer NestJS App                          │
│  ODataModule.forRoot(options)   ODataModule.forFeature([Entities])  │
└───────────────────────────────────────┬─────────────────────────────┘
                                        │ NestJS DI
┌───────────────────────────────────────▼─────────────────────────────┐
│                     @nestjs-odata/core                               │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │  ODataModule    │  │  EDM Registry    │  │  Route Binder      │  │
│  │  (DI wiring,    │  │  (EntityType,    │  │  (@ODataController │  │
│  │   forRoot /     │  │   EntitySet,     │  │   @ODataGet etc.)  │  │
│  │   forFeature)   │  │   NavigationProp)│  │                    │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬───────────┘  │
│           │                   │                      │              │
│  ┌────────▼────────┐  ┌───────▼──────────┐  ┌───────▼───────────┐  │
│  │  Query Parser   │  │  Metadata        │  │  Serializer /     │  │
│  │  (OData URL →   │  │  Builder         │  │  Response         │  │
│  │   QueryAST)     │  │  ($metadata XML) │  │  Formatter        │  │
│  └────────┬────────┘  └──────────────────┘  └───────────────────┘  │
│           │                                                          │
│  ┌────────▼────────────────────────────────────────────────────┐    │
│  │              Adapter Interface (IQueryTranslator)            │    │
│  │  translate(ast: QueryAST, entityMeta: EdmEntityType): Query  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                                        │ implements IQueryTranslator
┌───────────────────────────────────────▼─────────────────────────────┐
│                     @nestjs-odata/typeorm                            │
│                                                                      │
│  ┌───────────────────┐   ┌────────────────────┐                     │
│  │  EDM Deriver      │   │  Query Translator   │                     │
│  │  (TypeORM         │   │  (QueryAST →        │                     │
│  │   EntityMetadata  │   │   TypeORM           │                     │
│  │   → EDM types)    │   │   QueryBuilder)     │                     │
│  └───────────────────┘   └────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Package | Responsibility | Communicates With |
|-----------|---------|----------------|-------------------|
| `ODataModule` | core | DI wiring, `forRoot`/`forFeature` registration, module exports | NestJS DI, EDM Registry |
| `EDM Registry` | core | Maintains the in-memory entity data model: EntityTypes, EntitySets, navigation properties, primitive type mappings | ODataModule, Metadata Builder, Route Binder, Adapter |
| `Query Parser` | core | Parses OData URL segments and query options (`$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip`) into a typed `QueryAST` using `odata-v4-parser` | Route Binder, Adapter Interface |
| `Metadata Builder` | core | Generates the `$metadata` CSDL/XML document and service document from the EDM Registry | HTTP request handler (GET /$metadata) |
| `Route Binder` | core | Registers NestJS route handlers for OData endpoints; enforces OData response envelope via interceptor; skips envelope for non-OData routes | NestJS router, Query Parser, Adapter Interface |
| `Serializer / Response Formatter` | core | Wraps responses in OData envelope (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`); formats OData-compliant error responses | Route Binder (via NestJS interceptor) |
| `Adapter Interface` (IQueryTranslator) | core | Abstract contract adapters must implement: `translate(ast, edmType)` returns a backend query object | Core Route Binder, TypeORM Adapter |
| `EDM Deriver` | typeorm | Reads TypeORM `EntityMetadata` (columns, relations, types) via DataSource and maps them to EDM EntityTypes/EntitySets in the EDM Registry | TypeORM DataSource, EDM Registry |
| `Query Translator` | typeorm | Implements `IQueryTranslator`; converts `QueryAST` nodes into TypeORM `QueryBuilder` calls (WHERE, SELECT, JOIN, ORDER BY, LIMIT/OFFSET) | Core Adapter Interface, TypeORM QueryBuilder |

## Recommended Project Structure

```
nestjs-odata/                         # Turborepo root
├── apps/
│   └── test-app/                     # NestJS integration test app
│       ├── src/
│       │   ├── entities/
│       │   │   ├── product.entity.ts
│       │   │   └── category.entity.ts
│       │   ├── products/
│       │   │   └── products.module.ts
│       │   └── app.module.ts
│       ├── test/
│       │   └── odata.e2e-spec.ts     # HTTP-level OData spec tests
│       └── package.json
│
├── packages/
│   ├── core/                         # @nestjs-odata/core
│   │   ├── src/
│   │   │   ├── decorators/
│   │   │   │   ├── odata-controller.decorator.ts
│   │   │   │   ├── odata-entity.decorator.ts
│   │   │   │   └── odata-route.decorators.ts  # @ODataGet, @ODataPost etc
│   │   │   ├── edm/
│   │   │   │   ├── edm-registry.ts
│   │   │   │   ├── edm-entity-type.ts
│   │   │   │   ├── edm-entity-set.ts
│   │   │   │   ├── edm-primitive-types.ts
│   │   │   │   └── edm-navigation-property.ts
│   │   │   ├── metadata/
│   │   │   │   ├── metadata-builder.ts        # CSDL XML generation
│   │   │   │   └── service-document-builder.ts
│   │   │   ├── parser/
│   │   │   │   ├── odata-query-parser.ts      # wraps odata-v4-parser
│   │   │   │   └── query-ast.types.ts         # typed AST interfaces
│   │   │   ├── routing/
│   │   │   │   ├── odata-route-binder.ts
│   │   │   │   └── odata-metadata-controller.ts
│   │   │   ├── serialization/
│   │   │   │   ├── odata-interceptor.ts       # wraps responses in envelope
│   │   │   │   └── odata-exception-filter.ts  # OData error format
│   │   │   ├── interfaces/
│   │   │   │   ├── query-translator.interface.ts  # IQueryTranslator
│   │   │   │   └── edm-deriver.interface.ts       # IEdmDeriver
│   │   │   ├── odata.module.ts
│   │   │   └── index.ts
│   │   ├── test/
│   │   │   ├── edm/
│   │   │   ├── parser/
│   │   │   └── serialization/
│   │   └── package.json
│   │
│   └── typeorm/                      # @nestjs-odata/typeorm
│       ├── src/
│       │   ├── deriver/
│       │   │   ├── typeorm-edm-deriver.ts    # EntityMetadata → EDM
│       │   │   └── type-mapper.ts            # TypeORM types → Edm.* types
│       │   ├── translator/
│       │   │   ├── typeorm-query-translator.ts
│       │   │   ├── filter-visitor.ts         # AST visitor → WHERE clause
│       │   │   ├── select-visitor.ts         # AST visitor → SELECT columns
│       │   │   └── expand-visitor.ts         # AST visitor → JOIN/relations
│       │   ├── odata-typeorm.module.ts
│       │   └── index.ts
│       ├── test/
│       │   ├── deriver/
│       │   └── translator/
│       └── package.json
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Structure Rationale

- **packages/core vs packages/typeorm:** Core has zero ORM imports; TypeORM adapter imports core as a peer. This means core can be installed alone with a custom adapter (future Prisma, Mongoose, etc.). Adapter version is independent of core.
- **edm/ subfolder in core:** The EDM is the central data structure everything else reads from. Keeping it isolated means the parser, metadata builder, and serializer all depend on one stable model.
- **interfaces/ in core:** `IQueryTranslator` and `IEdmDeriver` are the only contracts the adapter must satisfy. They are the seam between packages.
- **visitor files in typeorm/translator/:** Each query option (`$filter`, `$select`, `$expand`) gets its own visitor class. This is the standard AST visitor pattern — easy to test in isolation and extend.
- **apps/test-app:** The integration test app is the primary consumer and regression harness. It installs both packages as workspace deps.

## Architectural Patterns

### Pattern 1: forRoot / forFeature Module Registration

**What:** `ODataModule.forRoot(options)` in the root module wires global providers (EDM Registry, Metadata Builder, HTTP interceptor). `ODataModule.forFeature([EntityClass, ...])` in feature modules registers entity definitions and triggers EDM derivation.

**When to use:** Always — this is the NestJS convention (same as `@nestjs/typeorm`, `@nestjs/graphql`).

**Trade-offs:** Slightly more setup than a single decorator, but follows NestJS idioms exactly, enabling proper scoping and lazy feature registration.

**Example:**
```typescript
// Root module
@Module({
  imports: [
    ODataModule.forRoot({
      serviceRoot: 'https://api.example.com/odata',
    }),
    TypeOrmModule.forRoot({ ... }),
    ODataTypeOrmModule.forRoot(),  // wires the TypeORM adapter
  ],
})
export class AppModule {}

// Feature module
@Module({
  imports: [
    ODataModule.forFeature([Product, Category]),
    TypeOrmModule.forFeature([Product, Category]),
  ],
})
export class ProductsModule {}
```

**Implementation note:** Use `ConfigurableModuleBuilder` from `@nestjs/common` (available since NestJS v9) to generate `forRoot`/`forRootAsync` boilerplate automatically and avoid manual token management.

### Pattern 2: AST Visitor for Query Translation

**What:** The OData query parser outputs a typed `QueryAST`. The TypeORM adapter implements a visitor that walks the AST and accumulates TypeORM `QueryBuilder` calls.

**When to use:** Any time query AST nodes need to be converted to a backend query language. Visitor pattern isolates each OData construct.

**Trade-offs:** More files than a single switch statement, but each visitor is independently testable and the pattern extends cleanly to new operators.

**Example:**
```typescript
// core: interface contract
export interface IQueryTranslator<TQuery> {
  translate(ast: ODataQueryAST, entityType: EdmEntityType): TQuery;
}

// typeorm: filter visitor
export class FilterVisitor {
  visit(node: FilterNode, qb: SelectQueryBuilder<unknown>): void {
    if (node.type === 'BinaryExpression') {
      this.visitBinary(node, qb);
    } else if (node.type === 'FunctionCall') {
      this.visitFunction(node, qb);
    }
    // ...
  }
}

// typeorm: main translator
export class TypeOrmQueryTranslator implements IQueryTranslator<SelectQueryBuilder<unknown>> {
  translate(ast: ODataQueryAST, edmType: EdmEntityType): SelectQueryBuilder<unknown> {
    const qb = this.dataSource.createQueryBuilder(edmType.targetClass, 'entity');
    if (ast.filter) new FilterVisitor().visit(ast.filter, qb);
    if (ast.select) new SelectVisitor().visit(ast.select, qb);
    if (ast.expand) new ExpandVisitor().visit(ast.expand, qb);
    if (ast.orderby) qb.orderBy(/* ... */);
    if (ast.top)  qb.limit(ast.top);
    if (ast.skip) qb.offset(ast.skip);
    return qb;
  }
}
```

### Pattern 3: Reflect-Metadata Decorator Accumulation (EDM Registry)

**What:** `@ODataEntity()` decorators on NestJS entity classes write metadata via `Reflect.defineMetadata`. At module init, the EDM Deriver reads this metadata (plus TypeORM's `EntityMetadata`) to populate the EDM Registry without requiring any explicit registration call from the user.

**When to use:** For auto-derivation — the key value proposition of the library. Users decorate entities once; the library discovers all structure automatically.

**Trade-offs:** Relies on `reflect-metadata` (already required by both TypeORM and NestJS, so no new dependency). Requires `emitDecoratorMetadata: true` in `tsconfig.json`.

**Example:**
```typescript
// core decorator
export function ODataEntity(options?: ODataEntityOptions) {
  return (target: Function) => {
    Reflect.defineMetadata(ODATA_ENTITY_METADATA, options ?? {}, target);
  };
}

// typeorm deriver reads TypeORM's EntityMetadata
@Injectable()
export class TypeOrmEdmDeriver implements IEdmDeriver {
  constructor(private readonly dataSource: DataSource) {}

  derive(entityClass: Function): EdmEntityType {
    const typeormMeta = this.dataSource.getMetadata(entityClass);
    return {
      name: typeormMeta.name,
      properties: typeormMeta.columns.map(col => ({
        name: col.propertyName,
        type: toEdmPrimitiveType(col.type),
        nullable: col.isNullable,
      })),
      navigationProperties: typeormMeta.relations.map(rel => ({
        name: rel.propertyName,
        type: rel.type,
        multiplicity: rel.isOneToMany || rel.isManyToMany ? 'many' : 'one',
      })),
    };
  }
}
```

### Pattern 4: Route-Scoped OData Interceptor (Selective Envelope)

**What:** A NestJS interceptor is applied only to routes decorated with OData markers. Regular NestJS routes on the same controller pass through untouched. This is the key to solving the route-mixing pain point.

**When to use:** Always, on every OData route. Use `SetMetadata` + `Reflector` to mark routes, and guard the interceptor body behind a metadata check.

**Trade-offs:** Slightly more complexity than a global interceptor, but essential for mixing OData and non-OData routes on the same controller without serialization leakage.

**Example:**
```typescript
// core/decorators
export const ODATA_ROUTE = Symbol('ODATA_ROUTE');
export const ODataRoute = () => SetMetadata(ODATA_ROUTE, true);

// core/serialization
@Injectable()
export class ODataInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isOData = this.reflector.get(ODATA_ROUTE, ctx.getHandler());
    if (!isOData) return next.handle();  // non-OData route: pass through

    return next.handle().pipe(
      map(data => ({
        '@odata.context': this.buildContext(ctx),
        value: Array.isArray(data) ? data : [data],
      })),
    );
  }
}
```

## Data Flow

### OData Request Flow (GET /odata/Products?$filter=Price gt 10)

```
HTTP Request
    ↓
NestJS Router (matches /odata/Products)
    ↓
OData Route Handler (generated by Route Binder or @ODataController)
    ↓
Query Parser  →  QueryAST { filter: BinaryExpr(Price > 10), ... }
    ↓
IQueryTranslator.translate(ast, edmType)
    ↓ (TypeORM adapter)
TypeORM QueryBuilder  →  SELECT * FROM product WHERE price > 10
    ↓
Database result (raw entity array)
    ↓
ODataInterceptor (wraps in { '@odata.context': ..., value: [...] })
    ↓
HTTP Response (OData-compliant JSON)
```

### $metadata Request Flow (GET /odata/$metadata)

```
HTTP Request GET /$metadata
    ↓
ODataMetadataController (registered by ODataModule.forRoot)
    ↓
MetadataBuilder.build(edmRegistry)
    ↓
CSDL XML string (all EntityTypes, EntitySets, NavigationProperties)
    ↓
HTTP Response Content-Type: application/xml
```

### Module Initialization Flow

```
App bootstraps
    ↓
ODataModule.forRoot(options)  →  creates EDM Registry, wires global interceptor
    ↓
ODataModule.forFeature([Product, Category])  in feature module
    ↓
EDM Deriver (IEdmDeriver impl, e.g. TypeOrmEdmDeriver)
    reads TypeORM EntityMetadata for each entity
    ↓
EDM Registry  ← registers EdmEntityType for each entity
    ↓
Route Binder  ← scans @ODataController / @ODataGet decorators
    registers Express/Fastify routes for collection + key endpoints
    ↓
App is ready: $metadata reflects all registered entities
```

### Key Data Flows

1. **EDM → Metadata:** EDM Registry is the single source of truth. Metadata Builder is a pure read from it; no mutation.
2. **Parser → Translator:** The Query Parser produces an immutable `QueryAST`. Translators consume it read-only; they never modify the AST.
3. **Core → Adapter (one direction only):** Core calls into the adapter via `IQueryTranslator` and `IEdmDeriver`. The adapter never imports from core at runtime — it receives interfaces via NestJS DI.
4. **Decorator metadata accumulation:** Entity decorators write metadata at class-definition time (module load). Derivation reads it at module-init time. Never at request time.

## Suggested Build Order (Phase Dependencies)

The component dependency graph dictates build order:

```
1. Types & Interfaces (query-ast.types.ts, interfaces/)
        ↓
2. EDM (edm-entity-type, edm-entity-set, edm-primitive-types, edm-registry)
        ↓
3. Decorators (@ODataEntity, @ODataController, @ODataGet/Post/Patch/Delete)
        ↓
4. Query Parser (wraps odata-v4-parser, outputs QueryAST)
        ↓
5. Metadata Builder ($metadata XML from EDM Registry)
        ↓
6. Serializer / Interceptor (OData envelope, error filter)
        ↓
7. Route Binder + ODataModule (forRoot/forFeature wiring)
        ↓ [core complete — adapter can now be built]
8. TypeORM EDM Deriver (EntityMetadata → EDM types)
        ↓
9. TypeORM Query Translator (QueryAST visitors → QueryBuilder)
        ↓
10. ODataTypeOrmModule (wires deriver + translator into DI)
        ↓
11. test-app integration tests (verifies end-to-end OData spec compliance)
```

**Rationale:** Each layer only depends on layers above it. The EDM is foundational — everything reads from it. The parser is independent of the EDM (pure URL parsing). The adapter cannot be started before the core interfaces are stable.

## Anti-Patterns

### Anti-Pattern 1: Coupling Core to TypeORM

**What people do:** Import TypeORM types (`DataSource`, `Repository`, `EntityMetadata`) directly inside `@nestjs-odata/core`.

**Why it's wrong:** Core becomes un-usable without TypeORM. Future adapters (Prisma, Mongoose) are blocked. Package size grows. Circular dependency risk.

**Do this instead:** Define `IEdmDeriver` and `IQueryTranslator` interfaces in core. Core injects them via DI tokens. Adapters provide the implementations.

### Anti-Pattern 2: Deriving EDM at Request Time

**What people do:** Call `dataSource.getMetadata(entityClass)` inside the request handler or interceptor to derive entity structure on every request.

**Why it's wrong:** TypeORM metadata access involves internal lookups; doing it per-request adds latency and prevents caching. EDM is stable across the app lifetime.

**Do this instead:** Derive and register EDM types during module initialization (`onModuleInit`). Cache the result in the EDM Registry as an in-memory map.

### Anti-Pattern 3: Global OData Interceptor Leaking into Non-OData Routes

**What people do:** Apply `ODataInterceptor` globally (`app.useGlobalInterceptors`), causing all routes to receive the OData JSON envelope.

**Why it's wrong:** Breaks non-OData REST routes; JSON responses get wrapped in `{ value: [...] }` unexpectedly.

**Do this instead:** Use `SetMetadata(ODATA_ROUTE, true)` on OData route handlers. The interceptor checks this metadata before wrapping. Non-OData routes are untouched.

### Anti-Pattern 4: Parsing OData Queries Inside the Translator

**What people do:** Pass the raw OData URL string to the TypeORM translator and parse it there.

**Why it's wrong:** Parser logic leaks into the adapter layer. The same URL must be re-parsed for different adapters. Testing the translator requires constructing raw URL strings.

**Do this instead:** Parse once in core (Query Parser → QueryAST). Pass the typed AST to the translator. Translator only handles AST → backend query conversion.

### Anti-Pattern 5: Building the EDM from TypeScript Class Shapes Alone

**What people do:** Use `reflect-metadata` design-type information (the TypeScript emitted `design:type` metadata) as the sole source for column types.

**Why it's wrong:** TypeScript primitive types (`string`, `number`) do not map 1:1 to OData EDM primitives (`Edm.String`, `Edm.Int32`, `Edm.Decimal`, `Edm.DateTimeOffset`). Column precision, scale, and nullable are lost.

**Do this instead:** Use TypeORM's `EntityMetadata.columns[n].type` and related fields as the source of truth for EDM type derivation. TypeORM already preserves the full column spec from `@Column({ type: 'decimal', precision: 10, scale: 2 })`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| TypeORM DataSource | Injected into `TypeOrmEdmDeriver` and `TypeOrmQueryTranslator` via NestJS DI | DataSource must be initialized before `ODataModule.forFeature` resolves |
| `odata-v4-parser` (npm) | Imported in `ODataQueryParser` inside core | Pure JS parser; no side effects; wrap with typed AST interface to isolate from parser library changes |
| NestJS Reflector | Used in `ODataInterceptor` and `ODataExceptionFilter` to read per-route metadata | Standard NestJS pattern; no extra deps |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| core ↔ typeorm adapter | `IQueryTranslator` and `IEdmDeriver` interfaces via NestJS DI tokens | Core never imports adapter; adapter imports core types only |
| core EDM Registry ↔ Metadata Builder | Direct in-process method call; both in core | Both are singletons in DI; no async needed |
| core Route Binder ↔ Query Parser | Direct method call within same request handler | Parser output (QueryAST) is a plain immutable object |
| core Interceptor ↔ Route Binder | NestJS metadata (`SetMetadata` + `Reflector`) | Decoupled via NestJS reflection API; no direct import |
| test-app ↔ packages | Turborepo workspace dependency (`"@nestjs-odata/core": "workspace:*"`) | Integration tests verify contract between packages |

## Scaling Considerations

This is a library, not a deployed service. Scaling concerns apply to apps using the library:

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Small API (< 50 entity types) | Default configuration; EDM Registry as in-memory Map is fine |
| Large API (50-500 entity types) | EDM derivation at startup may take longer; consider parallel derivation per entity in `onModuleInit`. No request-time impact. |
| High-throughput (> 1000 rps) | Query Translator creates a new QueryBuilder per request (stateless); TypeORM connection pool is the real bottleneck. Library adds < 1ms overhead for parsing. |
| Multi-tenant / multiple data sources | TypeORM adapter supports named data sources. `forFeature([entities], 'tenantDb')` pattern mirrors `@nestjs/typeorm` convention. |

## Sources

- [NestJS TypeOrmModule internals (DeepWiki)](https://deepwiki.com/nestjs/typeorm/2.1-typeormmodule)
- [ConfigurableModuleBuilder pattern (nooptoday 2024)](https://nooptoday.com/dynamic-modules-in-nestjs/)
- [JayStack odata-v4-server (GitHub)](https://github.com/jaystack/odata-v4-server)
- [ts-odata-v4-server (GitHub)](https://github.com/leyton-group/ts-odata-v4-server)
- [TypeORM Entity Metadata docs](https://typeorm.io/docs/)
- [OData v4 CSDL XML Specification (OASIS)](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html)
- [OData v4.01 Protocol (OASIS)](https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html)
- [odata-v4-parser (GitHub)](https://github.com/jaystack/odata-v4-parser)
- [NestJS Interceptors (official docs)](https://docs.nestjs.com/interceptors)

---
*Architecture research for: NestJS OData v4 Library (Turborepo monorepo)*
*Researched: 2026-04-07*
