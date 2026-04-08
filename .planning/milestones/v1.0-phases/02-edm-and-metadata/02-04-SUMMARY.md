---
phase: 02-edm-and-metadata
plan: '04'
subsystem: metadata-pipeline
tags: [csdl, metadata, controller, typeorm-wiring, e2e]
dependency_graph:
  requires: [02-01, 02-02, 02-03]
  provides: [metadata-endpoint, service-document-endpoint, typeorm-edm-wiring]
  affects: [packages/core, packages/typeorm, apps/test-app]
tech_stack:
  added: [odata-csdl-xml-builder, reflect-metadata-path-patching]
  patterns: [csdl-builder-caching, dynamic-controller-path, onModuleInit-edm-derivation]
key_files:
  created:
    - packages/core/src/metadata/csdl-builder.ts
    - packages/core/src/metadata/csdl-builder.spec.ts
    - packages/core/src/metadata/service-document-builder.ts
    - packages/core/src/metadata/service-document-builder.spec.ts
    - packages/core/src/metadata/metadata.controller.ts
    - packages/core/src/metadata/index.ts
    - apps/test-app/src/app.module.ts
    - apps/test-app/test/metadata.e2e-spec.ts
  modified:
    - packages/core/src/odata.module.ts
    - packages/core/src/tokens.ts
    - packages/core/src/index.ts
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/typeorm/src/index.ts
    - apps/test-app/vitest.config.ts
    - apps/test-app/package.json
decisions:
  - ODATA_MODULE_OPTIONS moved to tokens.ts to break circular import between odata.module.ts and metadata builders
  - MetadataController path set dynamically via Reflect.defineMetadata(PATH_METADATA) in ODataModule.forRoot — cleanest NestJS approach for library modules with configurable serviceRoot
  - CsdlBuilder and ServiceDocumentBuilder registered in forRoot() dynamic module (not static @Module) so ODATA_MODULE_OPTIONS is always available
  - CSDL XML cached on first build (per D-17) mitigating DoS risk T-02-08
metrics:
  duration_minutes: 35
  completed_date: '2026-04-07'
  tasks_completed: 2
  tasks_total: 2
  files_created: 8
  files_modified: 7
  tests_added: 23
  tests_total_passing: 147
---

# Phase 2 Plan 4: Metadata Pipeline Summary

**One-liner:** OData v4 CSDL XML endpoint with TypeORM entity auto-derivation, cached EDMX builder, and 8-test e2e suite validating the full TypeORM → EDM → $metadata pipeline.

## What Was Built

### Task 1: CSDL XML Builder, Service Document Builder, Metadata Controller

**CsdlBuilder** (`packages/core/src/metadata/csdl-builder.ts`):

- Builds OData v4 EDMX XML from EdmRegistry at first call, caches the result (per D-17 / T-02-08)
- Produces correct `<?xml ...?>`, `<edmx:Edmx Version="4.0">`, `<Schema>`, `<EntityType>`, `<Key>`, `<Property>`, `<NavigationProperty>`, `<EntityContainer>`, `<EntitySet>` elements
- Namespace-qualified entity type references in EntitySet and NavigationProperty
- Precision/Scale/MaxLength attributes on properties when present
- Collection navigation properties omit `Nullable` attribute per OData spec

**ServiceDocumentBuilder** (`packages/core/src/metadata/service-document-builder.ts`):

- Returns `@odata.context` pointing to `{serviceRoot}/$metadata`
- Returns `value` array with `{ name, url, kind: 'EntitySet' }` entries for all registered entity sets

**MetadataController** (`packages/core/src/metadata/metadata.controller.ts`):

- `@Get('$metadata')` → CSDL XML with `Content-Type: application/xml`
- `@Get('')` → Service document JSON with `Content-Type: application/json`
- Controller path set dynamically via `Reflect.defineMetadata(PATH_METADATA, ...)` in `ODataModule.forRoot()`

**ODataModule changes** (`packages/core/src/odata.module.ts`):

- `CsdlBuilder`, `ServiceDocumentBuilder`, `MetadataController` wired into `forRoot()` dynamic module
- `ODATA_MODULE_OPTIONS` moved to `tokens.ts` to break circular import
- `createMetadataControllerWithPath(serviceRoot)` patches controller PATH_METADATA at registration time

### Task 2: TypeOrmEdmDeriver Wiring + E2E Tests

**TypeOrmEdmInitializer** (`packages/typeorm/src/odata-typeorm.module.ts`):

- `@Injectable()` class implementing `OnModuleInit`
- Injects `DataSource`, `EdmRegistry`, `ODATA_MODULE_OPTIONS`, `TYPEORM_ODATA_ENTITIES`
- `onModuleInit()`: instantiates `TypeOrmEdmDeriver`, calls `dataSource.getMetadata(cls)` for each entity class, derives `EdmEntityConfig[]`, registers each as `EdmEntityType` + `EdmEntitySet` in the registry
- Added to `ODataTypeOrmModule.forFeature()` providers

**AppModule** (`apps/test-app/src/app.module.ts`):

- Wires `TypeOrmModule.forRoot` (better-sqlite3 in-memory), `ODataModule.forRoot({ serviceRoot: '/odata' })`, `ODataTypeOrmModule.forFeature([Product, Category, Customer, Order, OrderItem, Tag])`

**E2E tests** (`apps/test-app/test/metadata.e2e-spec.ts`):

- 8 tests using `@nestjs/testing` + `supertest`
- Tests 1-2: `GET /odata/$metadata` → 200, `application/xml`, contains `<edmx:Edmx Version="4.0">`
- Tests 3-4: Contains `<EntityType Name="Product">` and `<EntitySet Name="Products" EntityType="Default.Product"/>`
- Tests 5-6: Navigation properties correctly typed (`Default.Category`, `Collection(Default.OrderItem)`)
- Test 7: No `Edm.DateTime` (without Offset) in output
- Test 8: Service document lists all 6 EntitySets

## Test Results

| Suite                                                       | Tests   | Status       |
| ----------------------------------------------------------- | ------- | ------------ |
| packages/core/src/metadata/csdl-builder.spec.ts             | 12      | PASS         |
| packages/core/src/metadata/service-document-builder.spec.ts | 3       | PASS         |
| packages/core/src/odata.module.spec.ts                      | 5       | PASS         |
| apps/test-app/test/metadata.e2e-spec.ts                     | 8       | PASS         |
| All other core tests                                        | 119     | PASS         |
| **Total**                                                   | **147** | **ALL PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Circular import broke DI Symbol identity**

- **Found during:** Task 1 — `odata.module.spec.ts` tests failed after adding CsdlBuilder
- **Issue:** `csdl-builder.ts` imported `ODATA_MODULE_OPTIONS` from `odata.module.ts`, which imported `csdl-builder.ts`, creating a circular dependency. The Symbol resolved to `undefined` at decorator evaluation time.
- **Fix:** Moved `ODATA_MODULE_OPTIONS` to `tokens.ts`. Both `odata.module.ts` and metadata builders import from there. Re-exported from `odata.module.ts` for backward compatibility.
- **Files modified:** `packages/core/src/tokens.ts`, `packages/core/src/odata.module.ts`, `packages/core/src/metadata/csdl-builder.ts`, `packages/core/src/metadata/service-document-builder.ts`, `packages/core/src/metadata/metadata.controller.ts`
- **Commit:** bbb191d

**2. [Rule 1 - Bug] CsdlBuilder/ServiceDocumentBuilder in static @Module couldn't resolve ODATA_MODULE_OPTIONS**

- **Found during:** Task 1 — NestJS couldn't find ODATA_MODULE_OPTIONS for CsdlBuilder in static module metadata
- **Issue:** `@Module({providers: [CsdlBuilder]})` registers providers in the static module, but `ODATA_MODULE_OPTIONS` is only added by `forRoot()` dynamic module providers
- **Fix:** Moved `CsdlBuilder`, `ServiceDocumentBuilder`, `MetadataController` from static `@Module` into `forRoot()` dynamic module providers list
- **Files modified:** `packages/core/src/odata.module.ts`
- **Commit:** bbb191d

**3. [Rule 1 - Bug] MetadataController routes at wrong paths (/ and /$metadata instead of /odata and /odata/$metadata)**

- **Found during:** Task 2 — E2E tests returned 404 for `/odata/$metadata`
- **Issue:** `@Controller()` with `@Get('$metadata')` registers routes at root level, not under serviceRoot
- **Fix:** Used `Reflect.defineMetadata(PATH_METADATA, normalizedPath, MetadataController)` in `ODataModule.forRoot()` to patch the controller path before NestJS compiles the module. This is a well-established pattern for library modules with configurable route prefixes.
- **Files modified:** `packages/core/src/odata.module.ts`
- **Commit:** 7edb6ae

**4. [Rule 3 - Blocker] test-app vitest not finding e2e spec files**

- **Found during:** Task 2 — `pnpm test` reported "No test files found"
- **Issue:** Default vitest include pattern didn't pick up `test/metadata.e2e-spec.ts` due to the `e2e-spec` naming
- **Fix:** Added explicit `include` array to `apps/test-app/vitest.config.ts`
- **Files modified:** `apps/test-app/vitest.config.ts`
- **Commit:** 7edb6ae

## Commits

| Hash    | Message                                                                      |
| ------- | ---------------------------------------------------------------------------- |
| bbb191d | feat(02-04): csdl builder, service document builder, and metadata controller |
| 7edb6ae | feat(02-04): wire TypeOrmEdmDeriver into module and add e2e metadata tests   |

## Known Stubs

None — all data flows from actual TypeORM entity metadata through the EDM registry to the CSDL output.

## Threat Flags

None — `$metadata` endpoint is intentionally public per OData spec (T-02-07 accepted). CSDL is cached mitigating DoS (T-02-08 mitigated). No new security surface beyond what was modeled.

## Self-Check: PASSED

All key files confirmed present. Both task commits confirmed in git log.

| Check                                                  | Result |
| ------------------------------------------------------ | ------ |
| packages/core/src/metadata/csdl-builder.ts             | FOUND  |
| packages/core/src/metadata/service-document-builder.ts | FOUND  |
| packages/core/src/metadata/metadata.controller.ts      | FOUND  |
| packages/core/src/metadata/index.ts                    | FOUND  |
| apps/test-app/src/app.module.ts                        | FOUND  |
| apps/test-app/test/metadata.e2e-spec.ts                | FOUND  |
| commit bbb191d                                         | FOUND  |
| commit 7edb6ae                                         | FOUND  |
