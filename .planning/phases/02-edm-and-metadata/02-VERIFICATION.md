---
phase: 02-edm-and-metadata
verified: 2026-04-07T12:10:00Z
status: passed
score: 5/5 roadmap success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - 'The generated CSDL XML passes odata2ts validation in CI with zero errors (TEST-05)'
  gaps_remaining: []
  regressions: []
---

# Phase 2: EDM and $metadata Verification Report

**Phase Goal:** TypeORM entities are automatically reflected into a valid OData EDM, and the `$metadata` endpoint serves correct CSDL XML that enterprise OData clients can consume
**Verified:** 2026-04-07T12:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plan 02-05 executed)

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                     | Status     | Evidence                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A TypeORM entity registered via `ODataModule.forFeature()` produces a `$metadata` response without manual EDM declaration | ✓ VERIFIED | E2E tests 1-6 pass: `GET /odata/$metadata` returns 200 with correct `<EntityType Name="Product">`, `<EntitySet Name="Products" .../>`, and navigation properties    |
| 2   | The generated CSDL XML passes `odata2ts` validation in CI with zero errors                                                | ✓ VERIFIED | New e2e test `odata2ts-validation.e2e-spec.ts` fetches $metadata, writes to temp file, runs `npx odata2ts`, exits 0 — confirmed in live test run (1962ms, passed)   |
| 3   | TypeORM `Date` columns map to `Edm.DateTimeOffset` — verified by unit tests                                               | ✓ VERIFIED | 47 type-mapper unit tests including `datetime → Edm.DateTimeOffset`; `grep -r "Edm\.DateTime[^O]"` across source returns only comment/documentation lines           |
| 4   | `OneToMany`, `ManyToOne`, and `ManyToMany` relations appear as navigation properties in CSDL                              | ✓ VERIFIED | E2E tests 5-6 verify `<NavigationProperty Name="category" Type="Default.Category"` and `<NavigationProperty Name="orderItems" Type="Collection(Default.OrderItem)"` |
| 5   | `@nestjs-odata/core` has zero imports from `typeorm`                                                                      | ✓ VERIFIED | `grep -r "from 'typeorm'" packages/core/src/` returns zero matches; all decorators use reflect-metadata only                                                        |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                     | Expected                                                     | Status     | Details                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/edm/edm-types.ts`                         | EdmPrimitiveType union, EdmProperty, EdmNavigationProperty   | ✓ VERIFIED | 15 OData v4 primitive types; no Edm.DateTime                                                                                                                               |
| `packages/core/src/interfaces/edm-deriver.interface.ts`      | IEdmDeriver adapter interface                                | ✓ VERIFIED | `export interface IEdmDeriver`, `export const EDM_DERIVER`                                                                                                                 |
| `packages/core/src/interfaces/query-translator.interface.ts` | IQueryTranslator adapter interface                           | ✓ VERIFIED | `export interface IQueryTranslator`, `export const QUERY_TRANSLATOR`                                                                                                       |
| `packages/core/src/edm/edm-registry.ts`                      | EdmRegistry injectable singleton                             | ✓ VERIFIED | `@Injectable()` class, throws on duplicate registration                                                                                                                    |
| `packages/core/src/decorators/edm-type.decorator.ts`         | @EdmType() property decorator                                | ✓ VERIFIED | `export function EdmType(`, uses reflect-metadata only                                                                                                                     |
| `packages/core/src/decorators/odata-exclude.decorator.ts`    | @ODataExclude() property decorator                           | ✓ VERIFIED | `export function ODataExclude(`                                                                                                                                            |
| `packages/core/src/decorators/odata-entity-set.decorator.ts` | @ODataEntitySet() class decorator                            | ✓ VERIFIED | `export function ODataEntitySet(`                                                                                                                                          |
| `packages/core/src/odata.module.ts`                          | ODataModule with forRoot/forRootAsync/forFeature             | ✓ VERIFIED | `ConfigurableModuleBuilder`, `@Global()`, `static forFeature(`                                                                                                             |
| `packages/core/src/tokens.ts`                                | DI injection tokens                                          | ✓ VERIFIED | `ODATA_MODULE_OPTIONS`, `EDM_ENTITY_CONFIGS`                                                                                                                               |
| `packages/typeorm/src/odata-typeorm.module.ts`               | ODataTypeOrmModule with forFeature and TypeOrmEdmInitializer | ✓ VERIFIED | `TypeOrmEdmInitializer implements OnModuleInit`, `onModuleInit()` derives and registers entities                                                                           |
| `packages/typeorm/src/deriver/typeorm-type-mapper.ts`        | TypeORM ColumnType → EdmPrimitiveType mapping                | ✓ VERIFIED | 80+ column type mappings in lookup table; `export function mapColumnTypeToEdm(`                                                                                            |
| `packages/typeorm/src/deriver/typeorm-edm-deriver.ts`        | TypeOrmEdmDeriver implementing IEdmDeriver                   | ✓ VERIFIED | Bug fixed: JS-constructor column types (e.g. `PrimaryGeneratedColumn()`) now correctly pass the constructor as `designType`; `id` properties correctly emit as `Edm.Int32` |
| `packages/core/src/edm/pluralize.ts`                         | Entity name pluralization utility                            | ✓ VERIFIED | `export function pluralizeEntityName(`                                                                                                                                     |
| `packages/core/src/metadata/csdl-builder.ts`                 | CSDL XML builder from EdmRegistry                            | ✓ VERIFIED | `@Injectable()`, `buildCsdlXml(): string`, `cachedXml` caching                                                                                                             |
| `packages/core/src/metadata/service-document-builder.ts`     | OData service document builder                               | ✓ VERIFIED | `@odata.context`, `value` array with EntitySet entries                                                                                                                     |
| `packages/core/src/metadata/metadata.controller.ts`          | $metadata and service document endpoints                     | ✓ VERIFIED | `@Get('$metadata')`, `application/xml`, `@Get('')`                                                                                                                         |
| `apps/test-app/test/metadata.e2e-spec.ts`                    | E2E test for $metadata and service document                  | ✓ VERIFIED | 8 tests; all pass                                                                                                                                                          |
| `apps/test-app/test/odata2ts-validation.e2e-spec.ts`         | E2E test that runs odata2ts against $metadata XML            | ✓ VERIFIED | 54 lines; fetches /odata/$metadata, writes to tmpdir, runs `npx odata2ts -s ... -o ...` via execSync, asserts exit 0                                                       |
| `apps/test-app/package.json`                                 | @odata2ts/odata2ts devDependency                             | ✓ VERIFIED | `"@odata2ts/odata2ts": "^0.40.1"` present (note: duplicate key in JSON — cosmetic issue, no functional impact)                                                             |

### Key Link Verification

| From                                                 | To                                                    | Via                                          | Status  | Details                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`                         | `packages/core/src/edm/index.ts`                      | re-export                                    | ✓ WIRED | `export * from './edm/index.js'`                                                                  |
| `packages/core/src/index.ts`                         | `packages/core/src/interfaces/index.ts`               | re-export                                    | ✓ WIRED | `export * from './interfaces/index.js'`                                                           |
| `packages/core/src/index.ts`                         | `packages/core/src/decorators/index.ts`               | re-export                                    | ✓ WIRED | `export * from './decorators/index.js'`                                                           |
| `packages/typeorm/src/odata-typeorm.module.ts`       | `packages/core/src/odata.module.ts`                   | imports core types                           | ✓ WIRED | `import { EdmRegistry, ODATA_MODULE_OPTIONS, type ODataModuleOptions } from '@nestjs-odata/core'` |
| `packages/core/src/metadata/csdl-builder.ts`         | `packages/core/src/edm/edm-registry.ts`               | reads EdmRegistry                            | ✓ WIRED | Constructor injects `EdmRegistry`; calls `getEntityTypes()`, `getEntitySets()`                    |
| `packages/core/src/metadata/metadata.controller.ts`  | `packages/core/src/metadata/csdl-builder.ts`          | injects CsdlBuilder                          | ✓ WIRED | Constructor injects `CsdlBuilder`; calls `buildCsdlXml()`                                         |
| `packages/typeorm/src/odata-typeorm.module.ts`       | `packages/typeorm/src/deriver/typeorm-edm-deriver.ts` | provides TypeOrmEdmDeriver                   | ✓ WIRED | `TypeOrmEdmInitializer` instantiates `TypeOrmEdmDeriver` in `onModuleInit()`                      |
| `apps/test-app/src/app.module.ts`                    | `ODataModule.forRoot`                                 | root module wires OData                      | ✓ WIRED | `ODataModule.forRoot({ serviceRoot: '/odata', namespace: 'Default' })`                            |
| `apps/test-app/src/app.module.ts`                    | `ODataTypeOrmModule.forFeature`                       | all 6 entities registered                    | ✓ WIRED | `ODataTypeOrmModule.forFeature([Product, Category, Customer, Order, OrderItem, Tag])`             |
| `apps/test-app/test/odata2ts-validation.e2e-spec.ts` | `/odata/$metadata`                                    | supertest GET request captures CSDL XML      | ✓ WIRED | `request.get('/odata/$metadata')` — pattern matches plan key link                                 |
| `apps/test-app/test/odata2ts-validation.e2e-spec.ts` | `@odata2ts/odata2ts`                                  | execSync runs odata2ts CLI against temp file | ✓ WIRED | `execSync('npx odata2ts -s ${tmpXmlFile} -o ${tmpOutputDir}')`                                    |

### Data-Flow Trace (Level 4)

| Artifact                                                                   | Data Variable | Source                                              | Produces Real Data                                                                                      | Status    |
| -------------------------------------------------------------------------- | ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| `metadata.controller.ts` → `csdlBuilder.buildCsdlXml()`                    | `cachedXml`   | `edmRegistry.getEntityTypes()` / `getEntitySets()`  | Yes — populated via `TypeOrmEdmInitializer.onModuleInit()` from real TypeORM `DataSource.getMetadata()` | ✓ FLOWING |
| `metadata.controller.ts` → `serviceDocumentBuilder.buildServiceDocument()` | `value` array | `edmRegistry.getEntitySets()`                       | Yes — same registry populated by TypeOrmEdmInitializer                                                  | ✓ FLOWING |
| `TypeOrmEdmInitializer.onModuleInit()`                                     | `configs`     | `dataSource.getMetadata(cls)` for each entity class | Yes — real TypeORM entity metadata from in-memory SQLite DataSource                                     | ✓ FLOWING |
| `odata2ts-validation.e2e-spec.ts`                                          | `xmlContent`  | `res.text` from supertest GET /odata/$metadata      | Yes — live CSDL XML from the running NestJS app                                                         | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                             | Command                                                         | Result                                                      | Status |
| ---------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| Core package tests all pass                          | `pnpm --filter @nestjs-odata/core test`                         | 139 tests passed (10 suites)                                | ✓ PASS |
| TypeORM adapter tests all pass                       | `pnpm --filter @nestjs-odata/typeorm test`                      | 63 tests passed (3 suites)                                  | ✓ PASS |
| `GET /odata/$metadata` returns 200 + application/xml | `pnpm --filter test-app test` Test 1                            | 200, content-type: application/xml                          | ✓ PASS |
| CSDL contains `<EntityType Name="Product">`          | `pnpm --filter test-app test` Test 3                            | present                                                     | ✓ PASS |
| CSDL contains namespace-qualified EntitySet          | `pnpm --filter test-app test` Test 4                            | `<EntitySet Name="Products" EntityType="Default.Product"/>` | ✓ PASS |
| Navigation properties namespace-qualified            | `pnpm --filter test-app test` Tests 5-6                         | `Default.Category`, `Collection(Default.OrderItem)`         | ✓ PASS |
| No Edm.DateTime (without Offset) in output           | `pnpm --filter test-app test` Test 7                            | Response does not match `/Edm\.DateTime[^O]/`               | ✓ PASS |
| Service document lists all 6 EntitySets              | `pnpm --filter test-app test` Test 8                            | Products, Categories, Customers, Orders, OrderItems, Tags   | ✓ PASS |
| odata2ts validates $metadata CSDL XML without errors | `pnpm --filter test-app test` (odata2ts-validation.e2e-spec.ts) | exit 0, 1962ms                                              | ✓ PASS |
| Core typecheck clean                                 | `pnpm --filter @nestjs-odata/core typecheck`                    | exit 0, no errors                                           | ✓ PASS |
| TypeORM typecheck clean                              | `pnpm --filter @nestjs-odata/typeorm typecheck`                 | exit 0, no errors                                           | ✓ PASS |
| All test-app tests (2 files, 9 tests)                | `pnpm --filter test-app test`                                   | 2 passed (2), 9 passed (9), duration 2.76s                  | ✓ PASS |

**Build note:** Packages must be built before the test-app e2e suite runs (`pnpm --filter @nestjs-odata/core build && pnpm --filter @nestjs-odata/typeorm build`). This is a CI ordering concern already accounted for in the workflow.

### Requirements Coverage

| Requirement | Source Plan  | Description                                                   | Status      | Evidence                                                                                                                                                                                     |
| ----------- | ------------ | ------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EDM-01      | 02-03        | Auto-derive EDM from TypeORM entity metadata                  | ✓ SATISFIED | `TypeOrmEdmDeriver` reads `EntityMetadata`; 13 unit tests; e2e validates Product entity                                                                                                      |
| EDM-02      | 02-03        | Correct type mapping (Date → Edm.DateTimeOffset, etc.)        | ✓ SATISFIED | 47 mapper unit tests; `datetime → Edm.DateTimeOffset` verified; zero `Edm.DateTime` without Offset                                                                                           |
| EDM-03      | 02-03        | Navigation properties auto-derived from relations             | ✓ SATISFIED | ManyToOne, OneToMany, ManyToMany all handled; e2e tests 5-6; 3 nav property tests in edm-deriver spec                                                                                        |
| EDM-04      | 02-04        | `$metadata` endpoint auto-generated as valid CSDL XML         | ✓ SATISFIED | `MetadataController @Get('$metadata')` returns CsdlBuilder output; e2e tests 1-6 pass                                                                                                        |
| EDM-05      | 02-04        | `$metadata` reflects current entity state — no drift          | ✓ SATISFIED | CSDL is built from live `EdmRegistry` populated by `TypeOrmEdmInitializer` reading the actual `DataSource` at init                                                                           |
| EDM-06      | 02-03, 02-04 | EDM derivation at module init, never at request time          | ✓ SATISFIED | `TypeOrmEdmInitializer implements OnModuleInit`; `onModuleInit()` runs once; CSDL cached per D-17                                                                                            |
| PKG-01      | 02-01, 02-02 | `@nestjs-odata/core` has zero ORM dependencies                | ✓ SATISFIED | `grep -r "from 'typeorm'" packages/core/src/` returns zero matches                                                                                                                           |
| PKG-02      | 02-02        | `@nestjs-odata/typeorm` imports core as peer dependency       | ✓ SATISFIED | `"@nestjs-odata/core": ">=0.1.0"` in peerDependencies of typeorm package                                                                                                                     |
| PKG-03      | 02-01        | Adapter seam: IQueryTranslator and IEdmDeriver in core        | ✓ SATISFIED | Both interfaces exported from `packages/core/src/interfaces/index.ts` with injection tokens                                                                                                  |
| PKG-04      | 02-01        | Folder structure accommodates future OData versions           | ✓ SATISFIED | `packages/core`, `packages/typeorm` structure; no version-locked paths                                                                                                                       |
| PKG-05      | 02-02        | Peer dep targets NestJS ^10.0.0 \|\| ^11.0.0                  | ✓ SATISFIED | Both core and typeorm peerDeps: `"@nestjs/common": "^10.0.0 \|\| ^11.0.0"`                                                                                                                   |
| TEST-03     | 02-03        | Unit tests for EDM derivation from TypeORM entities           | ✓ SATISFIED | 47 type-mapper tests + 13 deriver tests; uses real DataSource with better-sqlite3                                                                                                            |
| TEST-05     | 02-05        | odata2ts validator in CI to verify $metadata CSDL correctness | ✓ SATISFIED | `apps/test-app/test/odata2ts-validation.e2e-spec.ts` added; `@odata2ts/odata2ts@^0.40.1` installed; test runs odata2ts CLI and exits 0; runs automatically via `pnpm --filter test-app test` |

**All 13 requirement IDs (EDM-01 through EDM-06, PKG-01 through PKG-05, TEST-03, TEST-05) are satisfied.**

### Anti-Patterns Found

| File                         | Line   | Pattern                              | Severity | Impact                                                                                                                                                                      |
| ---------------------------- | ------ | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/test-app/package.json` | 26, 28 | Duplicate key `"@odata2ts/odata2ts"` | ℹ️ Info  | Both entries are identical (`^0.40.1`); JSON parsers use the last value so there is no functional impact. The duplicate is cosmetic and can be cleaned up in a future pass. |

No TODO, FIXME, PLACEHOLDER, or stub anti-patterns found in production code paths.

### Human Verification Required

None. All verification was possible programmatically.

### Gaps Summary

No gaps. All 5 roadmap success criteria are verified. The single gap from initial verification (TEST-05 — odata2ts CSDL validation) has been closed by plan 02-05:

- `@odata2ts/odata2ts@^0.40.1` installed as a devDependency in `apps/test-app`
- `apps/test-app/test/odata2ts-validation.e2e-spec.ts` created (54 lines, substantive, fully wired)
- Bug fixed in `packages/typeorm/src/deriver/typeorm-edm-deriver.ts`: `PrimaryGeneratedColumn()` columns (where `col.type` is a JS constructor function) now correctly pass the constructor as the `designType` argument to `mapColumnTypeToEdm`, producing valid `Edm.Int32` properties instead of silently omitting them
- All 9 tests (2 files) pass in 2.76s total
- The CSDL XML produced by the library is confirmed valid by an enterprise OData toolchain (odata2ts)

---

_Verified: 2026-04-07T12:10:00Z_
_Verifier: Claude (gsd-verifier)_
