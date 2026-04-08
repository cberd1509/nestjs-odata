# Phase 2: EDM and $metadata — Research

**Researched:** 2026-04-07
**Domain:** OData v4 EDM derivation from TypeORM entity metadata; CSDL XML generation; NestJS module registration
**Confidence:** HIGH

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two separate interfaces in `@nestjs-odata/core`: `IEdmDeriver` and `IQueryTranslator`. Clean separation — each tested independently.
- **D-02:** `IEdmDeriver` accepts generic entity metadata (not TypeORM-specific). TypeORM adapter reads `DataSource.getMetadata()` and transforms to generic format.
- **D-03:** Layered module architecture. Core provides `ODataModule` (ORM-agnostic). TypeORM adapter provides `ODataTypeOrmModule`. Future adapters follow same pattern.
- **D-04:** `ODataModule.forRoot()` accepts: `serviceRoot`, `maxTop`, `maxExpandDepth`, `namespace`, `unmappedTypeStrategy`.
- **D-05:** `ODataModule.forFeature()` accepts entity configurations per module — the ORM-agnostic registration point.
- **D-06:** `ODataTypeOrmModule.forFeature([Product, Category])` is the convenience wrapper TypeORM users call.
- **D-07:** Built using NestJS `ConfigurableModuleBuilder`.
- **D-08:** CSDL XML namespace configurable via `forRoot({ namespace: 'MyApp.Models' })`. Default: `'Default'`.
- **D-09:** EntityContainer name defaults to `'Container'`.
- **D-10:** Unmapped type strategy: `'skip'` (default) | `'string-fallback'` | `'error'`. Set via `forRoot({ unmappedTypeStrategy: 'skip' })`.
- **D-11:** Auto-derive TypeORM column types: `number(int)` → `Edm.Int32`, `number(float/decimal)` → `Edm.Decimal`, `string` → `Edm.String`, `boolean` → `Edm.Boolean`, `Date` → `Edm.DateTimeOffset`, `uuid` → `Edm.Guid`.
- **D-12:** `@EdmType()` decorator for overriding auto-derived type on specific columns. In `@nestjs-odata/core`.
- **D-13:** `@ODataExclude()` decorator to hide specific columns. In `@nestjs-odata/core`.
- **D-14:** Auto-pluralize entity class name for EntitySet name.
- **D-15:** `@ODataEntitySet('CustomName')` decorator to override auto-pluralization. In `@nestjs-odata/core`.
- **D-16:** EDM derivation runs at `onModuleInit`. Derive once, cache forever.
- **D-17:** `$metadata` endpoint serves cached CSDL XML string.
- **D-18:** OData decorators go directly on entity classes, co-located with TypeORM decorators.
- **D-19:** All OData decorators defined in `@nestjs-odata/core`, use `reflect-metadata` only — zero TypeORM imports.
- **D-20:** TypeORM `@ManyToOne` → `NavigationProperty Type="Namespace.Target"`. `@OneToMany`/`@ManyToMany` → `NavigationProperty Type="Collection(Namespace.Target)"`.
- **D-21:** `@ViewEntity()` supported as read-only OData EntitySets. `@ViewColumn()` derived same as `@Column()`.
- **D-22:** Virtual OData views (projections) via `@ODataView()` or forFeature config — expose subset of columns, optional pre-filter.
- **D-23:** Virtual views defined in core. Concept: "same underlying entity, different OData surface."
- **D-24:** Service document at `serviceRoot` URL returns JSON listing all EntitySets.

### Claude's Discretion

- CSDL XML generation implementation details (template engine vs string builder)
- Exact pluralization approach (library vs built-in rules)
- EdmRegistry internal caching structure
- Unit test organization and naming
- Virtual view implementation details (decorator shape, pre-filter expression format)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                    | Research Support                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| EDM-01  | Auto-derive OData EDM from TypeORM entity metadata — columns, types, nullability, relations                    | TypeORM `EntityMetadata.columns` + `EntityMetadata.relations` API documented; `ColumnMetadata.type`, `isNullable`, `precision`, `scale` available |
| EDM-02  | Correct type mapping: TypeORM Date → Edm.DateTimeOffset, string → Edm.String, number → Edm.Int32/Decimal, etc. | Full TypeORM ColumnType → OData EDM mapping table documented in this research                                                                     |
| EDM-03  | Navigation properties auto-derived from TypeORM relations (OneToMany, ManyToOne, ManyToMany)                   | `RelationMetadata.relationType`, `inverseEntityMetadata`, `isManyToMany`, `isOneToMany` properties confirmed                                      |
| EDM-04  | `$metadata` endpoint auto-generated as valid CSDL XML from registered entities                                 | CSDL XML structure documented; minimal valid EDMX structure confirmed from spec                                                                   |
| EDM-05  | `$metadata` always reflects current entity state — no drift                                                    | Auto-derivation at `onModuleInit` from `DataSource.entityMetadatas`; no manual registry                                                           |
| EDM-06  | EDM derivation at `onModuleInit`, never at request time                                                        | NestJS lifecycle hook pattern documented                                                                                                          |
| PKG-01  | `@nestjs-odata/core` has zero ORM dependencies                                                                 | `IEdmDeriver` interface in core; TypeORM adapter in separate package; `publint` + `@arethetypeswrong/cli` validation in CI                        |
| PKG-02  | `@nestjs-odata/typeorm` imports core as peer dependency                                                        | Package structure already in place from Phase 1                                                                                                   |
| PKG-03  | Adapter seam is `IQueryTranslator` and `IEdmDeriver` interfaces                                                | Interface definitions to be written in `packages/core/src/interfaces/`                                                                            |
| PKG-04  | Folder structure accommodates future OData versions                                                            | Current folder structure already designed for this                                                                                                |
| PKG-05  | Peer dependency targeting NestJS ^10.0.0 \|\| ^11.0.0                                                          | Already configured in package.json from Phase 1                                                                                                   |
| TEST-03 | Unit tests for EDM derivation from TypeORM entities                                                            | Vitest + unplugin-swc setup confirmed; test structure documented                                                                                  |
| TEST-05 | odata2ts validator in CI to verify $metadata CSDL correctness                                                  | `@odata2ts/odata2ts` 0.40.1 confirmed; runs against live URL or EDMX file                                                                         |

</phase_requirements>

---

## Summary

Phase 2 establishes the core OData plumbing: the EDM (Entity Data Model) registry, the TypeORM-to-EDM derivation pipeline, the `$metadata` CSDL XML endpoint, and the NestJS module registration API (`ODataModule.forRoot/forFeature` + `ODataTypeOrmModule.forFeature`). All of this must be wired before any query translation can occur — the EDM is the contract that everything else reads from.

The research confirms that TypeORM's `EntityMetadata` API provides everything needed for zero-declaration EDM derivation: `columns` (with `type`, `isNullable`, `precision`, `scale`), `relations` (with `relationType`, `inverseEntityMetadata`), `primaryColumns`, and `name`. `DataSource.entityMetadatas` is the entry point to enumerate all registered entities. The derivation should run at `onModuleInit` after the TypeORM `DataSource` has initialized — the TypeORM connection must be ready before `EntityMetadata` is populated.

CSDL XML generation is well-specified by the OASIS spec. The minimal valid EDMX structure requires `<edmx:Edmx>` root with `Version="4.0"`, a `<edmx:DataServices>` child, and one or more `<Schema>` elements containing `<EntityType>`, `<EntityContainer>`, and `<EntitySet>` elements. The `$metadata` response must set `Content-Type: application/xml`. String-based XML generation (builder pattern) is recommended over template engines for correctness; typed CSDL builder avoids structural mistakes that break OData clients.

**Primary recommendation:** Build in this order — (1) EDM data types and interfaces, (2) OData decorators in core using reflect-metadata, (3) NestJS module with ConfigurableModuleBuilder, (4) TypeORM EDM deriver reading DataSource metadata, (5) CSDL XML builder, (6) $metadata controller + service document. Test each layer independently before wiring.

---

## Standard Stack

### Core

| Library              | Version                   | Purpose                                                                              | Why Standard                                                                       |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `@nestjs/common`     | ^11.0.0 (peer)            | `ConfigurableModuleBuilder`, `Injectable`, `OnModuleInit`                            | NestJS idiom for dynamic modules; already in peer deps                             |
| `reflect-metadata`   | ^0.2.0 (peer)             | Decorator metadata storage/retrieval for `@EdmType`, `@ODataExclude`, etc.           | Already required by NestJS and TypeORM; zero-cost addition                         |
| `typeorm`            | ^0.3.28 (peer in adapter) | `DataSource.entityMetadatas`, `EntityMetadata`, `ColumnMetadata`, `RelationMetadata` | Only in adapter package; core has zero TypeORM imports                             |
| `pluralize`          | 8.0.0                     | Auto-pluralize entity class name → EntitySet name (Product → Products)               | Handles irregular forms (Category → Categories) correctly; 8.0.0 is current stable |
| `@types/pluralize`   | 0.0.33                    | TypeScript types for `pluralize`                                                     | Required since `pluralize` ships no native types                                   |
| `@odata2ts/odata2ts` | 0.40.1                    | CI validation: generates TypeScript from $metadata; zero errors = CSDL valid         | Active project; supports OData v4; can consume live URL or file                    |

[VERIFIED: npm registry — pluralize 8.0.0, @types/pluralize 0.0.33, @odata2ts/odata2ts 0.40.1]

### Supporting

| Library          | Version | Purpose                                                     | When to Use                                                            |
| ---------------- | ------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `vitest`         | ^3.x    | Unit tests for EDM derivation, decorator reads, CSDL output | Already configured in both packages                                    |
| `unplugin-swc`   | ^1.x    | Vitest SWC plugin for decorator metadata in tests           | Required — esbuild breaks `emitDecoratorMetadata`; already in dev deps |
| `better-sqlite3` | ^12.x   | In-memory SQLite for TypeORM integration tests              | Already in `packages/typeorm` dev deps                                 |

### Alternatives Considered

| Instead of                | Could Use                 | Tradeoff                                                                                                         |
| ------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pluralize`               | Custom regex rules        | `pluralize` handles Category → Categories, Index → Indices; regex only handles `-s` suffix; not worth building   |
| String builder (CSDL XML) | Template literal strings  | Template strings are easy to break structurally; typed builder catches attribute ordering errors at compile time |
| String builder (CSDL XML) | `xmlbuilder2` npm library | Extra dependency; the CSDL structure is fixed enough that a custom builder stays small and testable              |

**Installation:**

```bash
pnpm add pluralize
pnpm add -D @types/pluralize @odata2ts/odata2ts
```

(in monorepo root or specific packages as appropriate)

**Version verification:** [VERIFIED: npm registry — confirmed 2026-04-07]

```bash
npm view pluralize version          # 8.0.0
npm view @types/pluralize version   # 0.0.33
npm view @odata2ts/odata2ts version # 0.40.1
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/core/src/
├── decorators/
│   ├── edm-type.decorator.ts        # @EdmType() — column type override
│   ├── odata-exclude.decorator.ts   # @ODataExclude() — hide from OData
│   ├── odata-entity-set.decorator.ts # @ODataEntitySet() — custom EntitySet name
│   └── odata-key.decorator.ts       # @ODataKey() — composite key support
├── edm/
│   ├── edm-types.ts                 # Discriminated union: EdmPrimitiveType, EdmNavigationProperty
│   ├── edm-entity-type.ts           # EdmEntityType data interface
│   ├── edm-entity-set.ts            # EdmEntitySet data interface
│   ├── edm-registry.ts              # @Injectable() EdmRegistry — central store
│   └── index.ts
├── interfaces/
│   ├── edm-deriver.interface.ts     # IEdmDeriver<TEntityMeta>
│   └── query-translator.interface.ts # IQueryTranslator<TQuery>
├── metadata/
│   ├── csdl-builder.ts              # Builds CSDL XML string from EdmRegistry
│   └── service-document-builder.ts  # Builds OData service document JSON
├── odata.module.ts                  # ODataModule with ConfigurableModuleBuilder
└── index.ts                         # Re-exports all public API

packages/typeorm/src/
├── deriver/
│   ├── typeorm-edm-deriver.ts       # Implements IEdmDeriver — reads DataSource.entityMetadatas
│   └── typeorm-type-mapper.ts       # ColumnMetadata.type → EdmPrimitiveType string
├── odata-typeorm.module.ts          # ODataTypeOrmModule — forFeature([Entity, ...])
└── index.ts
```

### Pattern 1: ConfigurableModuleBuilder for ODataModule

**What:** Use `ConfigurableModuleBuilder` from `@nestjs/common` to generate `forRoot`/`forRootAsync` boilerplate. Extend `ConfigurableModuleClass` to add `forFeature` manually (ConfigurableModuleBuilder only generates one named method; `forFeature` is a different API surface).

**When to use:** `forRoot` once in `AppModule` for global config. `forFeature` in each feature module that registers entities.

**Example:**

```typescript
// Source: NestJS ConfigurableModuleBuilder docs + nest/packages/common source
// packages/core/src/odata.module.ts

import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common'

export interface ODataModuleOptions {
  serviceRoot: string
  namespace?: string // default: 'Default'
  maxTop?: number // default: 1000
  maxExpandDepth?: number // default: 2
  unmappedTypeStrategy?: 'skip' | 'string-fallback' | 'error' // default: 'skip'
}

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<ODataModuleOptions>().setClassMethodName('forRoot').build()

export const ODATA_MODULE_OPTIONS = MODULE_OPTIONS_TOKEN

@Module({
  providers: [EdmRegistry, MetadataController],
  exports: [EdmRegistry, ODATA_MODULE_OPTIONS],
})
export class ODataModule extends ConfigurableModuleClass {
  static forFeature(entityConfigs: EdmEntityConfig[]): DynamicModule {
    return {
      module: ODataModule,
      providers: [
        {
          provide: EDM_ENTITY_CONFIGS_TOKEN,
          useValue: entityConfigs,
        },
        EdmFeatureRegistrar, // OnModuleInit: reads configs, pushes to EdmRegistry
      ],
    }
  }
}
```

[CITED: https://github.com/nestjs/nest/blob/master/packages/common/module-utils/configurable-module.builder.ts]
[CITED: https://nooptoday.com/dynamic-modules-in-nestjs/]

### Pattern 2: EDM Registry as Injectable Singleton

**What:** `EdmRegistry` is an `@Injectable()` singleton in `ODataModule`. It stores a `Map<string, EdmEntityType>` (entity name → EDM type) and a `Map<string, EdmEntitySet>` (entity set name → set definition). All downstream consumers (MetadataBuilder, RouteBuilder, etc.) inject `EdmRegistry`.

**When to use:** Always. The registry is the single source of truth. Never derive EDM twice.

**Example:**

```typescript
// packages/core/src/edm/edm-registry.ts
@Injectable()
export class EdmRegistry {
  private readonly entityTypes = new Map<string, EdmEntityType>()
  private readonly entitySets = new Map<string, EdmEntitySet>()

  register(entityType: EdmEntityType, entitySet: EdmEntitySet): void {
    this.entityTypes.set(entityType.name, entityType)
    this.entitySets.set(entitySet.name, entitySet)
  }

  getEntityTypes(): ReadonlyMap<string, EdmEntityType> {
    return this.entityTypes
  }

  getEntitySets(): ReadonlyMap<string, EdmEntitySet> {
    return this.entitySets
  }
}
```

### Pattern 3: TypeORM EDM Deriver — onModuleInit Lifecycle

**What:** `ODataTypeOrmModule` reads TypeORM `EntityMetadata` via `DataSource.entityMetadatas` in `onModuleInit`. This runs after all modules are initialized (including TypeORM's own module), so `DataSource` is ready.

**Critical ordering concern:** TypeORM's `DataSource` is only fully initialized (all entity metadata built) after `TypeOrmModule` has completed its own `onModuleInit`. NestJS initializes modules in dependency order, so `ODataTypeOrmModule` must list `TypeOrmModule` as an import to ensure ordering.

**Example:**

```typescript
// packages/typeorm/src/deriver/typeorm-edm-deriver.ts
@Injectable()
export class TypeOrmEdmDeriver implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly edmRegistry: EdmRegistry,
    @Inject(EDM_ENTITY_CONFIGS_TOKEN) private readonly entityClasses: Function[],
  ) {}

  async onModuleInit(): Promise<void> {
    for (const entityClass of this.entityClasses) {
      const meta = this.dataSource.getMetadata(entityClass)
      const edmType = this.deriveEntityType(meta)
      const edmSet = this.deriveEntitySet(meta, edmType)
      this.edmRegistry.register(edmType, edmSet)
    }
  }

  private deriveEntityType(meta: EntityMetadata): EdmEntityType {
    return {
      name: meta.name,
      namespace: this.namespace,
      properties: meta.columns
        .filter((col) => !this.isExcluded(meta.target, col.propertyName))
        .map((col) => this.deriveProperty(meta.target, col)),
      navigationProperties: meta.relations.map((rel) => this.deriveNavProp(rel)),
      keyProperties: meta.primaryColumns.map((col) => col.propertyName),
    }
  }
}
```

[VERIFIED: TypeORM DataSource.entityMetadatas — confirmed public property, populated after DataSource.initialize()]

### Pattern 4: CSDL XML Builder (Typed String Builder)

**What:** Build the CSDL XML string programmatically from the `EdmRegistry`. No template strings — use method calls to append elements. This catches structural mistakes at TypeScript level.

**Why not template strings:** One missing attribute or wrong element nesting breaks all OData clients silently. Enterprise clients (Power BI, odata2ts, SAP UI5) parse the EDMX strictly.

**Minimal valid EDMX structure:**

```typescript
// Source: OASIS OData CSDL XML v4.01 spec
// https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html
function buildCsdlXml(registry: EdmRegistry, options: ODataModuleOptions): string {
  const namespace = options.namespace ?? 'Default'
  const containerName = 'Container'

  const entityTypeXml = [...registry.getEntityTypes().values()]
    .map((et) => buildEntityTypeXml(et, namespace))
    .join('\n  ')

  const entitySetXml = [...registry.getEntitySets().values()]
    .map((es) => buildEntitySetXml(es, namespace))
    .join('\n    ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"
           Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm"
            Namespace="${namespace}">
      ${entityTypeXml}
      <EntityContainer Name="${containerName}">
        ${entitySetXml}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}
```

**Required HTTP header:** `Content-Type: application/xml` [CITED: OASIS OData v4.01 Protocol §11.1.2]

### Pattern 5: Reflect-Metadata Decorator Keys

**What:** All OData decorators use a consistent `Symbol` key pattern to write/read metadata. The `METADATA_KEY` symbols are defined in `packages/core/src/decorators/metadata-keys.ts` and shared across all decorator files.

**Example:**

```typescript
// packages/core/src/decorators/metadata-keys.ts
export const EDM_TYPE_KEY = Symbol('nestjs-odata:edm-type')
export const ODATA_EXCLUDE_KEY = Symbol('nestjs-odata:odata-exclude')
export const ODATA_ENTITY_SET_KEY = Symbol('nestjs-odata:entity-set')
export const ODATA_KEY_KEY = Symbol('nestjs-odata:odata-key')

// packages/core/src/decorators/edm-type.decorator.ts
export interface EdmTypeOptions {
  type: string // e.g. 'Edm.Decimal'
  precision?: number
  scale?: number
}

export function EdmType(options: EdmTypeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    // Store per-property metadata on the constructor
    const existing = Reflect.getMetadata(EDM_TYPE_KEY, target.constructor) ?? {}
    Reflect.defineMetadata(
      EDM_TYPE_KEY,
      { ...existing, [propertyKey]: options },
      target.constructor,
    )
  }
}

// Reading in the deriver:
const overrides: Record<string, EdmTypeOptions> =
  Reflect.getMetadata(EDM_TYPE_KEY, entityClass) ?? {}
const override = overrides[col.propertyName]
```

[CITED: reflect-metadata API — Reflect.defineMetadata / getMetadata on constructor target]

### Pattern 6: TypeORM Column Type → EDM Type Mapping

**What:** `typeorm-type-mapper.ts` is a pure function (no DI) that maps `ColumnMetadata.type` (a `ColumnType` string) to an `EdmPrimitiveType` string. Uses a lookup table plus fallback to `unmappedTypeStrategy`.

**Complete mapping table (from TypeORM ColumnTypes + OData v4 spec):**

| TypeORM Column Type(s)                                                                                                                                    | EDM Type             | Notes                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
| `int`, `int2`, `int4`, `integer`, `tinyint`, `smallint`, `mediumint`                                                                                      | `Edm.Int32`          |                                                      |
| `int8`, `int64`, `bigint`, `unsigned big int`                                                                                                             | `Edm.Int64`          |                                                      |
| `float`, `float4`, `float8`, `float64`, `double`, `real`, `double precision`                                                                              | `Edm.Double`         |                                                      |
| `decimal`, `numeric`, `money`, `smallmoney`                                                                                                               | `Edm.Decimal`        | Use `precision`/`scale` from `ColumnMetadata`        |
| `varchar`, `nvarchar`, `char`, `nchar`, `text`, `ntext`, `tinytext`, `mediumtext`, `longtext`, `clob`, `nclob`, `citext`, `shorttext`, `alphanum`, `long` | `Edm.String`         |                                                      |
| `boolean`, `bool`                                                                                                                                         | `Edm.Boolean`        |                                                      |
| `date`                                                                                                                                                    | `Edm.Date`           | Date-only, no time                                   |
| `datetime`, `timestamp`, `timestamptz`, `datetime2`, `datetimeoffset`, `timestamp with local time zone`, `smalldatetime`                                  | `Edm.DateTimeOffset` | **NEVER** `Edm.DateTime` — removed in OData v4       |
| `time`, `timetz`                                                                                                                                          | `Edm.TimeOfDay`      |                                                      |
| `uuid`, `uniqueidentifier`                                                                                                                                | `Edm.Guid`           |                                                      |
| `blob`, `tinyblob`, `mediumblob`, `longblob`, `bytea`, `bytes`, `binary`, `varbinary`, `image`, `bfile`, `raw`, `long raw`                                | `Edm.Binary`         |                                                      |
| `json`, `jsonb`, `simple-json`                                                                                                                            | `Edm.String` or skip | Configurable; JSON has no OData primitive equivalent |
| `simple-array`, `simple-enum`, `enum`, `set`                                                                                                              | `Edm.String` or skip | Per `unmappedTypeStrategy`                           |
| JavaScript `Number` type (reflect-metadata `design:type`)                                                                                                 | `Edm.Int32`          | Fallback when column type not in map                 |
| JavaScript `String` type                                                                                                                                  | `Edm.String`         | Fallback                                             |
| JavaScript `Boolean` type                                                                                                                                 | `Edm.Boolean`        | Fallback                                             |
| JavaScript `Date` type                                                                                                                                    | `Edm.DateTimeOffset` | Fallback                                             |

[CITED: https://github.com/typeorm/typeorm/blob/master/src/driver/types/ColumnTypes.ts]
[CITED: .claude/agents/odata-expert.md — EDM Primitive Type Mapping table]
[CITED: https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html]

### Pattern 7: Navigation Property Derivation

**What:** Map `RelationMetadata.relationType` to `NavigationProperty` CSDL element. Use `inverseEntityMetadata.name` for the target type name. Namespace-qualify the target type.

```typescript
function deriveNavProp(rel: RelationMetadata, namespace: string): EdmNavigationProperty {
  const targetTypeName = `${namespace}.${rel.inverseEntityMetadata.name}`
  const isCollection = rel.isOneToMany || rel.isManyToMany

  return {
    name: rel.propertyName,
    type: isCollection ? `Collection(${targetTypeName})` : targetTypeName,
    nullable: rel.isNullable,
  }
}
```

**CSDL XML output:**

```xml
<!-- @ManyToOne -->
<NavigationProperty Name="category" Type="Default.Category" Nullable="true"/>

<!-- @OneToMany / @ManyToMany -->
<NavigationProperty Name="orderItems" Type="Collection(Default.OrderItem)" Nullable="false"/>
```

[CITED: OASIS OData CSDL XML v4.01 §7 Navigation Properties]
[CITED: TypeORM RelationMetadata — isOneToMany, isManyToMany, inverseEntityMetadata verified]

### Pattern 8: Service Document

**What:** `GET /odata/` returns an OData service document listing all registered EntitySets.

```json
{
  "@odata.context": "https://api.example.com/odata/$metadata",
  "value": [
    { "name": "Products", "url": "Products" },
    { "name": "Categories", "url": "Categories" }
  ]
}
```

**When:** Serve at the `serviceRoot` URL. Reads from `EdmRegistry.getEntitySets()`. No caching needed — same data as the $metadata endpoint, just different format.

[CITED: OASIS OData v4.01 Protocol §11.1.1 — Service Document]

### Anti-Patterns to Avoid

- **Importing TypeORM in `@nestjs-odata/core`:** Core must have zero ORM imports. Any TypeORM type in core breaks PKG-01. The `IEdmDeriver` interface uses only generic types.
- **Deriving EDM at request time:** `dataSource.getMetadata()` inside a request handler. EDM must be derived once in `onModuleInit`.
- **Template string CSDL:** Even one missing attribute breaks Power BI, odata2ts, SAP UI5. Use typed builder methods.
- **Using `Edm.DateTime`:** Does not exist in OData v4. Always use `Edm.DateTimeOffset`. [CITED: .claude/agents/odata-expert.md]
- **Using `design:type` reflect-metadata as the sole type source:** TypeScript reflects `String`, `Number`, `Boolean` — loses precision, scale, nullability. Always prefer `ColumnMetadata.type` from TypeORM. [CITED: ARCHITECTURE.md Anti-Pattern 5]
- **Not qualifying type names in NavigationProperty:** `Type="Category"` is wrong; must be `Type="Default.Category"` (namespace-qualified).

---

## Don't Hand-Roll

| Problem                         | Don't Build                | Use Instead                                       | Why                                                                                                    |
| ------------------------------- | -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Entity name pluralization       | Custom regex `name + 's'`  | `pluralize` library (v8.0.0)                      | `Category` → `Categories`, `Index` → `Indices`, `Person` → `People` all fail with simple regex         |
| EDMX XML validation in CI       | Custom schema validator    | `@odata2ts/odata2ts` (v0.40.1)                    | Catches namespace errors, missing attributes, wrong version; used by major OData ecosystem             |
| Module option injection pattern | Custom DI token management | `ConfigurableModuleBuilder` from `@nestjs/common` | Generates `forRoot`/`forRootAsync`, options token, and async factory boilerplate with zero manual code |

**Key insight:** The TypeORM `EntityMetadata` API already does all the heavy lifting for column introspection. Do not re-implement what TypeORM already exposes.

---

## Common Pitfalls

### Pitfall 1: DataSource Not Initialized at Derivation Time

**What goes wrong:** `TypeOrmEdmDeriver.onModuleInit()` calls `dataSource.getMetadata(entityClass)` before `TypeOrmModule` has finished initializing — `entityMetadatas` is empty.

**Why it happens:** NestJS resolves module dependencies, but if `ODataTypeOrmModule` doesn't declare `TypeOrmModule` in its imports, NestJS may initialize it before TypeORM is ready.

**How to avoid:** `ODataTypeOrmModule` must import `TypeOrmModule` (or have `DataSource` available via injection). NestJS ensures providers are available before calling `onModuleInit` on dependents. Use `@Inject(getDataSourceToken())` to inject the correct DataSource instance.

**Warning signs:** `EntityMetadataNotFoundError` thrown in `onModuleInit`.

### Pitfall 2: Edm.DateTime in Generated CSDL

**What goes wrong:** TypeORM `datetime` / `Date` columns map to `Edm.DateTime` in the generated CSDL. OData v4 removed `Edm.DateTime`. odata2ts CI step fails. Power BI throws "unknown primitive type".

**Why it happens:** Developer uses training knowledge or v3 references. The mapping table in this research explicitly marks this.

**How to avoid:** All date/time types → `Edm.DateTimeOffset`. Only `date`-only columns → `Edm.Date`. Check the type mapper unit tests include a `datetime` column case asserting `Edm.DateTimeOffset`.

**Warning signs:** `odata2ts` CI step exits non-zero.

### Pitfall 3: NavigationProperty Type Not Namespace-Qualified

**What goes wrong:** Generated CSDL has `Type="Product"` instead of `Type="Default.Product"`. Strict OData clients reject this. odata2ts may partially parse it but generate incorrect code.

**Why it happens:** Type name is taken from `rel.inverseEntityMetadata.name` without prepending the namespace.

**How to avoid:** The CSDL builder must always prepend namespace: `${namespace}.${typeName}` for both regular property types and navigation property types.

**Warning signs:** odata2ts generates code with broken type references.

### Pitfall 4: reflect-metadata Import Missing in Tests

**What goes wrong:** Unit tests for decorators (`@EdmType`, `@ODataExclude`) fail because `Reflect.defineMetadata` is undefined.

**Why it happens:** `reflect-metadata` must be imported before any decorator code runs. In tests, there is no `main.ts` entry point that does this import.

**How to avoid:** Add `import 'reflect-metadata'` to the test setup file or at the top of each decorator test file. The existing `.swcrc` already enables `decoratorMetadata: true` — but the polyfill still needs to be imported at runtime.

**Warning signs:** `TypeError: Reflect.defineMetadata is not a function` in vitest output.

### Pitfall 5: ManyToMany Junction Table Appearing as EntityType

**What goes wrong:** TypeORM's `DataSource.entityMetadatas` includes junction table metadata (the implicit join table for `@ManyToMany`). These junction entities appear in the generated CSDL as EntityTypes, which is incorrect — they are implementation details, not OData entities.

**Why it happens:** `entityMetadatas` includes ALL registered entity metadata, including junction tables. Junction tables have `isJunction: true` on their `EntityMetadata`.

**How to avoid:** Filter out junction table entities before deriving the EDM: `meta.entityMetadatas.filter(m => !m.isJunction)`.

**Warning signs:** `ProductTag` or `product_tag` appearing as an EntityType in `$metadata`.

### Pitfall 6: @ODataExclude Columns Leaking into CSDL

**What goes wrong:** A column decorated with `@ODataExclude()` still appears in the generated `$metadata` because the deriver reads `meta.columns` without checking for the exclusion metadata.

**Why it happens:** The deriver must actively check `Reflect.getMetadata(ODATA_EXCLUDE_KEY, entityClass, propertyName)` for each column, but it is easy to forget during the column map loop.

**How to avoid:** Build a helper `isExcluded(entityClass, propertyName): boolean` and call it in the column filter before EDM property derivation.

**Warning signs:** Sensitive fields (password hashes, internal flags) visible in `$metadata`.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### EDMX Minimal Valid Structure

```xml
<!-- Source: OASIS OData CSDL XML v4.01 spec -->
<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"
           Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm"
            Namespace="Default">
      <EntityType Name="Product">
        <Key>
          <PropertyRef Name="id"/>
        </Key>
        <Property Name="id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="name" Type="Edm.String" Nullable="false"/>
        <Property Name="price" Type="Edm.Decimal" Nullable="false"/>
        <Property Name="description" Type="Edm.String" Nullable="true"/>
        <NavigationProperty Name="category" Type="Default.Category" Nullable="true"/>
        <NavigationProperty Name="orderItems" Type="Collection(Default.OrderItem)" Nullable="false"/>
        <NavigationProperty Name="tags" Type="Collection(Default.Tag)" Nullable="false"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Products" EntityType="Default.Product"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
```

### NavigationPropertyBinding in EntitySet

```xml
<!-- Required for $expand to work — maps nav prop to target entity set -->
<EntitySet Name="Products" EntityType="Default.Product">
  <NavigationPropertyBinding Path="category" Target="Categories"/>
  <NavigationPropertyBinding Path="orderItems" Target="OrderItems"/>
  <NavigationPropertyBinding Path="tags" Target="Tags"/>
</EntitySet>
```

[CITED: OASIS OData CSDL XML v4.01 §13.4 NavigationPropertyBinding]

### Decorator Metadata Key Pattern (from existing codebase pattern)

```typescript
// Follows the same pattern as packages/core/src/parser/ast.ts discriminated unions
// Source: packages/core/src/parser/visitor.ts — visitor pattern to follow

// Per-property metadata stored as object keyed by propertyName on the constructor
export const EDM_TYPE_KEY = Symbol('nestjs-odata:edm-type')

export function EdmType(options: EdmTypeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const constructor = (target as { constructor: Function }).constructor
    const existing: Record<string, EdmTypeOptions> =
      Reflect.getMetadata(EDM_TYPE_KEY, constructor) ?? {}
    Reflect.defineMetadata(
      EDM_TYPE_KEY,
      { ...existing, [String(propertyKey)]: options },
      constructor,
    )
  }
}
```

### odata2ts CI Validation Command

```bash
# In CI: start the NestJS test app, run odata2ts against it, check exit code
# Source: @odata2ts/odata2ts documentation
pnpm odata2ts --source http://localhost:3000/odata/$metadata --output /tmp/odata-types
# Exit code 0 = valid CSDL; non-zero = structural error
```

---

## State of the Art

| Old Approach                      | Current Approach            | When Changed                          | Impact                                                          |
| --------------------------------- | --------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `Edm.DateTime`                    | `Edm.DateTimeOffset`        | OData v4 (2013)                       | `Edm.DateTime` is removed; using it breaks all v4 clients       |
| Manual EDMX XML strings           | Typed CSDL builder          | Best practice since OData v4 adoption | Template strings cause structural errors caught only at runtime |
| `odata-v4-server` (JayStack)      | Build custom                | 2016 (abandoned)                      | No maintained alternative; custom is the correct choice         |
| `forRoot` with plain object token | `ConfigurableModuleBuilder` | NestJS v9 (2022)                      | Generates async variant, types, and token automatically         |

**Deprecated/outdated:**

- `Edm.DateTime`: Removed in OData v4. Use `Edm.DateTimeOffset` for timestamps, `Edm.Date` for date-only columns.
- `jaystack/odata-v4-server`: Abandoned. Do not use or fork.
- `odata-v4-parser` as runtime dependency: Verify against current spec before any use; consider parser-only for reference.

---

## Assumptions Log

| #   | Claim                                                                                                                            | Section                           | Risk if Wrong                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A1  | `NavigationPropertyBinding` is required for `$expand` to resolve correctly in strict OData clients                               | Code Examples                     | Navigation properties may work without bindings in some clients but spec requires them for conformance |
| A2  | `@ViewEntity()` entities are distinguishable from regular entities via `EntityMetadata.tableType` or `EntityMetadata.expression` | Architecture Patterns (Pattern 3) | If no reliable flag exists, view detection needs a different approach                                  |
| A3  | `pluralize('Category')` returns `'Categories'`                                                                                   | Standard Stack                    | Test in Phase 2 Wave 0 before writing entity set naming code                                           |

**If this table is empty it would mean:** All claims were verified — but A2 and A3 are worth confirming with a quick code test in Wave 0.

---

## Open Questions

1. **ViewEntity detection flag**
   - What we know: TypeORM has `@ViewEntity()` and the metadata for views has an `expression` property
   - What's unclear: Is there an explicit `isView` boolean on `EntityMetadata`, or do we check `meta.tableType === 'view'`?
   - Recommendation: Check `EntityMetadata.tableType` in Wave 0 setup against a `@ViewEntity()` entity in the test app

2. **DataSource token injection pattern**
   - What we know: TypeORM provides `getDataSourceToken(connectionName?)` for injecting named DataSources
   - What's unclear: Does `ODataTypeOrmModule.forFeature()` need to accept an optional connection name to support multi-tenant scenarios?
   - Recommendation: Implement with optional connection name in `forFeature` — mirrors `TypeOrmModule.forFeature([Entity], 'secondary')` pattern

3. **NavigationPropertyBinding — auto-generate or defer?**
   - What we know: `NavigationPropertyBinding` maps nav prop paths to target EntitySet names; needed for full $expand compliance
   - What's unclear: Can it be deferred to Phase 4 ($expand) without breaking Phase 2's odata2ts CI test?
   - Recommendation: Generate `NavigationPropertyBinding` elements in Phase 2 — odata2ts may warn without them; easier to include now while building the CSDL builder

---

## Environment Availability

| Dependency           | Required By               | Available         | Version              | Fallback |
| -------------------- | ------------------------- | ----------------- | -------------------- | -------- |
| Node.js              | All packages              | ✓                 | 20+ (via nvm/system) | —        |
| pnpm                 | Monorepo                  | ✓                 | ^9.x                 | —        |
| TypeScript           | Build                     | ✓                 | ^5.7.3               | —        |
| Vitest               | Testing                   | ✓                 | ^3.x (in dev deps)   | —        |
| better-sqlite3       | TypeORM integration tests | ✓                 | ^12.x (in dev deps)  | —        |
| `pluralize`          | EntitySet naming          | NOT YET INSTALLED | 8.0.0 available      | —        |
| `@odata2ts/odata2ts` | CI validation             | NOT YET INSTALLED | 0.40.1 available     | —        |

**Missing dependencies requiring installation before Wave 1:**

- `pluralize` + `@types/pluralize`: `pnpm add pluralize && pnpm add -D @types/pluralize` (in `packages/typeorm` or monorepo root)
- `@odata2ts/odata2ts`: `pnpm add -D @odata2ts/odata2ts` (in `apps/test-app` for CI validation against running app)

---

## Validation Architecture

### Test Framework

| Property           | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Framework          | Vitest 3.x                                                            |
| Config file        | `packages/core/vitest.config.ts`, `packages/typeorm/vitest.config.ts` |
| Quick run command  | `pnpm --filter @nestjs-odata/core test`                               |
| Full suite command | `pnpm turbo test`                                                     |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                                                 | Test Type   | Automated Command                                                | File Exists? |
| ------- | ---------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- | ------------ |
| EDM-01  | `Product` entity → `EdmEntityType` with all columns                                      | unit        | `pnpm --filter @nestjs-odata/typeorm test`                       | ❌ Wave 0    |
| EDM-02  | `datetime` column → `Edm.DateTimeOffset`, `decimal` → `Edm.Decimal`, `uuid` → `Edm.Guid` | unit        | `pnpm --filter @nestjs-odata/typeorm test -- --reporter=verbose` | ❌ Wave 0    |
| EDM-03  | `ManyToOne` → single nav prop, `OneToMany` → collection nav prop in CSDL                 | unit        | `pnpm --filter @nestjs-odata/typeorm test`                       | ❌ Wave 0    |
| EDM-04  | `$metadata` HTTP response is valid XML with `Content-Type: application/xml`              | integration | `pnpm --filter test-app test`                                    | ❌ Wave 0    |
| EDM-05  | $metadata reflects `@ODataExclude` applied columns (absent from output)                  | unit        | `pnpm --filter @nestjs-odata/typeorm test`                       | ❌ Wave 0    |
| EDM-06  | `TypeOrmEdmDeriver.onModuleInit()` is called once; no derivation in request handler      | unit        | `pnpm --filter @nestjs-odata/typeorm test`                       | ❌ Wave 0    |
| PKG-01  | `packages/core` imports contain zero TypeORM references                                  | CI lint     | `pnpm turbo build && pnpm publint packages/core`                 | ❌ Wave 0    |
| TEST-05 | odata2ts generates without errors from running test-app $metadata                        | integration | `pnpm odata2ts` in `apps/test-app`                               | ❌ Wave 0    |

### Sampling Rate

- **Per task commit:** `pnpm --filter @nestjs-odata/core test && pnpm --filter @nestjs-odata/typeorm test`
- **Per wave merge:** `pnpm turbo test && pnpm turbo build`
- **Phase gate:** Full suite green + odata2ts validation green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/test/edm/edm-registry.test.ts` — covers EDM-01, EDM-05
- [ ] `packages/core/test/decorators/edm-type.test.ts` — covers `@EdmType` decorator reads
- [ ] `packages/core/test/decorators/odata-exclude.test.ts` — covers `@ODataExclude` decorator reads
- [ ] `packages/typeorm/test/deriver/type-mapper.test.ts` — covers EDM-02 (full type mapping table)
- [ ] `packages/typeorm/test/deriver/typeorm-edm-deriver.test.ts` — covers EDM-01, EDM-03, EDM-06
- [ ] `packages/core/test/metadata/csdl-builder.test.ts` — covers EDM-04 (CSDL XML output snapshot)
- [ ] `apps/test-app` odata2ts integration test — covers TEST-05

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                   |
| --------------------- | ------- | ------------------------------------------------------------------ |
| V2 Authentication     | no      | N/A — EDM endpoint is metadata, not auth                           |
| V3 Session Management | no      | N/A                                                                |
| V4 Access Control     | partial | `@ODataExclude()` ensures sensitive columns are not exposed in EDM |
| V5 Input Validation   | no      | $metadata has no user input                                        |
| V6 Cryptography       | no      | N/A                                                                |

### Known Threat Patterns for $metadata Endpoint

| Pattern                                            | STRIDE                 | Standard Mitigation                                                          |
| -------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Sensitive column exposure (passwords, tokens, PII) | Information Disclosure | `@ODataExclude()` decorator; verify excluded columns absent in CSDL output   |
| Schema enumeration                                 | Information Disclosure | This is by design for OData; document as acceptable; no mitigation required  |
| Response caching with stale EDM                    | Tampering              | EDM cached at startup; regenerated only on restart; no request-time mutation |

---

## Sources

### Primary (HIGH confidence)

- [OASIS OData CSDL XML v4.01](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html) — EDMX structure, EntityType, NavigationProperty, EntityContainer elements
- [OASIS OData v4.01 Protocol Part 1](https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html) — $metadata endpoint behavior, Content-Type header
- [TypeORM DataSource.ts (GitHub)](https://github.com/typeorm/typeorm/blob/master/src/data-source/DataSource.ts) — `entityMetadatas`, `getMetadata()` API
- [TypeORM EntityMetadata.ts (GitHub)](https://github.com/typeorm/typeorm/blob/master/src/metadata/EntityMetadata.ts) — `columns`, `relations`, `primaryColumns`, `isJunction`
- [TypeORM RelationMetadata.ts (GitHub)](https://github.com/typeorm/typeorm/blob/master/src/metadata/RelationMetadata.ts) — `relationType`, `inverseEntityMetadata`, `isOneToMany`, `isManyToMany`
- [TypeORM ColumnTypes.ts (GitHub)](https://github.com/typeorm/typeorm/blob/master/src/driver/types/ColumnTypes.ts) — Complete `SimpleColumnType` string literal union
- [NestJS ConfigurableModuleBuilder (GitHub)](https://github.com/nestjs/nest/blob/master/packages/common/module-utils/configurable-module.builder.ts) — `setClassMethodName`, `build()`, generated tokens
- `.claude/agents/odata-expert.md` — EDM Primitive Type Mapping table (verified against OASIS spec)
- `.planning/research/ARCHITECTURE.md` — Component boundaries, adapter seam design (Phase 1 research)
- `.planning/research/PITFALLS.md` — DateTime removal in v4, EDM drift, CSDL structural errors

### Secondary (MEDIUM confidence)

- [nooptoday.com — Dynamic Modules in NestJS](https://nooptoday.com/dynamic-modules-in-nestjs/) — `ConfigurableModuleBuilder` usage patterns, verified against nest source
- [odata2ts.github.io — Setup and Usage](https://odata2ts.github.io/docs/generator/setup-and-usage/) — CI validation approach
- [npm: pluralize 8.0.0](https://www.npmjs.com/package/pluralize) — entity name pluralization
- [npm: @odata2ts/odata2ts 0.40.1](https://www.npmjs.com/package/@odata2ts/odata2ts) — CSDL validator

### Tertiary (LOW confidence)

- None in this research

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versions verified against npm registry
- Architecture patterns: HIGH — TypeORM API verified against source; CSDL structure verified against OASIS spec
- Type mapping table: HIGH — TypeORM ColumnTypes.ts source verified; OData v4 primitive types from spec
- EDM derivation lifecycle: HIGH — NestJS `onModuleInit` ordering with `TypeOrmModule` dependency confirmed
- Pitfalls: HIGH — drawn from Phase 1 PITFALLS.md research + TypeORM/OData source analysis

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable spec + stable library versions)
