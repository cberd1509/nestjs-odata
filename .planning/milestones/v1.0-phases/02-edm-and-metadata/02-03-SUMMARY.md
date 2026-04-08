---
phase: 02-edm-and-metadata
plan: 03
subsystem: typeorm-adapter
tags: [edm, typeorm, type-mapping, pluralization, tdd]
dependency_graph:
  requires: [02-01]
  provides: [typeorm-edm-deriver, typeorm-type-mapper, pluralizer]
  affects: [03-metadata-endpoint, 04-query-translation]
tech_stack:
  added: [pluralize, '@types/pluralize']
  patterns: [tdd-red-green-refactor, record-lookup-table, overload-signatures]
key_files:
  created:
    - packages/typeorm/src/deriver/typeorm-type-mapper.ts
    - packages/typeorm/src/deriver/typeorm-type-mapper.spec.ts
    - packages/typeorm/src/deriver/typeorm-edm-deriver.ts
    - packages/typeorm/src/deriver/typeorm-edm-deriver.spec.ts
    - packages/typeorm/src/deriver/index.ts
    - packages/core/src/edm/pluralize.ts
    - packages/core/src/edm/pluralize.spec.ts
  modified:
    - packages/core/src/edm/index.ts
    - packages/core/package.json
    - pnpm-lock.yaml
decisions:
  - 'applyUnmappedStrategy returns EdmPrimitiveType | undefined (not string | undefined) to satisfy ESLint no-redundant-type-constituents'
  - 'TypeOrmEdmDeriver uses method overloads to satisfy IEdmDeriver while accepting optional entityMetadatas for direct test usage'
  - 'designType fallback removed from deriveProperties — TypeORM EntityMetadata does not expose design-time types; mapColumnTypeToEdm called with undefined for designType'
  - 'Core package must be built before ESLint runs — EdmPrimitiveType resolves to any without dist/'
metrics:
  duration: ~9 minutes
  completed: 2026-04-07T16:14:29Z
  tasks_completed: 2
  files_changed: 9
---

# Phase 02 Plan 03: TypeORM EDM Derivation Pipeline Summary

TypeORM column type mapper, EDM entity deriver, and entity name pluralizer — the core intelligence translating TypeORM metadata into OData v4 EDM types without manual declaration.

## What Was Built

**Task 1: Type Mapper + Pluralizer (TDD)**

`mapColumnTypeToEdm(columnType, designType, unmappedTypeStrategy)` — maps TypeORM column type strings to OData v4 EDM primitive types using a static `Record<string, EdmPrimitiveType>` lookup table covering 80+ column types across all TypeORM-supported databases.

Key correctness guarantee: `Edm.DateTime` does not appear anywhere in the codebase. All datetime-like column types (`datetime`, `timestamp`, `timestamptz`, `datetime2`, `datetimeoffset`) produce `Edm.DateTimeOffset` per the OData v4 OASIS specification.

Unmapped types (`json`, `jsonb`, `enum`, etc.) are handled via the `UnmappedTypeStrategy`: skip (omit), string-fallback (expose as string), or error (fail fast). This directly implements threat T-02-06 (Tampering via silent wrong-type exposure).

`pluralizeEntityName(name)` wraps the `pluralize` library to handle irregular English plurals (Person→People, Category→Categories, Index→Indices).

**Task 2: TypeOrmEdmDeriver (TDD)**

`TypeOrmEdmDeriver` implements `IEdmDeriver` and translates TypeORM `EntityMetadata` into `EdmEntityConfig[]`:

- Reads `@ODataExclude` to strip sensitive columns (threat T-02-05: prevents password hash exposure)
- Reads `@EdmType` overrides for precision/scale/maxLength control
- Reads `@ODataEntitySet` for custom entity set names; falls back to `pluralizeEntityName()`
- Maps all 3 TypeORM relation types: ManyToOne → single nav, OneToMany → collection nav, ManyToMany → collection nav
- All navigation property types are namespace-qualified (`Default.Category`, `Collection(Default.Tag)`)
- Detects `@ViewEntity` via `meta.tableType === 'view'` → `isReadOnly: true`
- Key properties from `meta.primaryColumns`

## Test Coverage

| File                        | Tests | Status      |
| --------------------------- | ----- | ----------- |
| typeorm-type-mapper.spec.ts | 47    | Passing     |
| typeorm-edm-deriver.spec.ts | 13    | Passing     |
| pluralize.spec.ts           | 5     | Passing     |
| Total new                   | 65    | All passing |

Tests use real `DataSource` with `better-sqlite3` in-memory — no mocks, real TypeORM metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint no-redundant-type-constituents on EdmPrimitiveType**

- **Found during:** Task 1 commit
- **Issue:** `applyUnmappedStrategy` returning `string | undefined` caused ESLint to flag `EdmPrimitiveType | undefined` on the outer function as redundant when core package was not built (EdmPrimitiveType resolved to `any`)
- **Fix:** Changed `applyUnmappedStrategy` return type to `EdmPrimitiveType | undefined`; built `@nestjs-odata/core` before ESLint runs
- **Files modified:** `typeorm-type-mapper.ts`
- **Commit:** ce67cb2

**2. [Rule 1 - Bug] ESLint no-unsafe-return on .toThrow() arrow callbacks**

- **Found during:** Task 1 commit
- **Issue:** `expect(() => mapColumnTypeToEdm(...)).toThrow()` flagged as unsafe return because the arrow function returns `EdmPrimitiveType | undefined`
- **Fix:** Changed arrow functions to block-body `() => { mapColumnTypeToEdm(...) }` so they return `void`
- **Files modified:** `typeorm-type-mapper.spec.ts`
- **Commit:** ce67cb2

**3. [Rule 2 - Missing functionality] designType not available from EntityMetadata**

- **Found during:** Task 2 implementation
- **Issue:** Plan said to pass `designType` to `mapColumnTypeToEdm` from column metadata, but TypeORM `ColumnMetadata` does not expose the TypeScript design-time type constructor
- **Fix:** Pass `undefined` for `designType` in `deriveProperties()` — the column type string lookup covers all cases; JS design type fallback is only relevant when the column type string is entirely unknown
- **Files modified:** `typeorm-edm-deriver.ts`

**4. [Rule 3 - Blocking] commit-msg hook enforces lowercase subject**

- **Found during:** Task 1 commit attempt
- **Issue:** commitlint rejected `TypeORM` and line > 100 chars in subject
- **Fix:** Lowercased subject, shortened body lines
- **Commits:** Corrected on second attempt

## Threat Mitigations Applied

| Threat                                             | Mitigation                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| T-02-05 (Information Disclosure — column exposure) | `@ODataExclude` respected in `deriveProperties()` — excluded properties absent from EdmEntityConfig |
| T-02-06 (Tampering — wrong type silent exposure)   | `'error'` unmappedTypeStrategy throws rather than silently producing wrong EDM types                |

## Commits

| Hash    | Message                                                                        |
| ------- | ------------------------------------------------------------------------------ |
| ce67cb2 | feat(02-03): typeorm column type to EDM type mapper and entity name pluralizer |
| 7298629 | feat(02-03): typeorm EDM deriver translating EntityMetadata to EdmEntityConfig |

## Self-Check: PASSED

- typeorm-type-mapper.ts: FOUND
- typeorm-edm-deriver.ts: FOUND
- pluralize.ts: FOUND
- commit ce67cb2: FOUND
- commit 7298629: FOUND
