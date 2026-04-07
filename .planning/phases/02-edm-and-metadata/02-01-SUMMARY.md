---
phase: 02-edm-and-metadata
plan: '01'
subsystem: core
tags:
  - edm
  - decorators
  - registry
  - interfaces
dependency_graph:
  requires: []
  provides:
    - EdmPrimitiveType
    - EdmEntityType
    - EdmEntitySet
    - EdmEntityConfig
    - EdmVirtualView
    - EdmRegistry
    - IEdmDeriver
    - IQueryTranslator
    - EDM_DERIVER
    - QUERY_TRANSLATOR
    - EdmType
    - ODataExclude
    - ODataEntitySet
    - ODataKey
    - ODataView
  affects:
    - packages/core/src/index.ts
tech_stack:
  added:
    - reflect-metadata (peer dep, already declared)
    - '@nestjs/common @Injectable() used in EdmRegistry'
  patterns:
    - discriminated-union types (consistent with ast.ts)
    - reflect-metadata for decorator storage
    - NestJS injectable singleton registry
    - injection token symbols for adapter seams
key_files:
  created:
    - packages/core/src/edm/edm-types.ts
    - packages/core/src/edm/edm-entity-type.ts
    - packages/core/src/edm/edm-entity-set.ts
    - packages/core/src/edm/edm-registry.ts
    - packages/core/src/edm/edm-registry.spec.ts
    - packages/core/src/edm/index.ts
    - packages/core/src/interfaces/edm-deriver.interface.ts
    - packages/core/src/interfaces/query-translator.interface.ts
    - packages/core/src/interfaces/index.ts
    - packages/core/src/decorators/metadata-keys.ts
    - packages/core/src/decorators/edm-type.decorator.ts
    - packages/core/src/decorators/odata-exclude.decorator.ts
    - packages/core/src/decorators/odata-entity-set.decorator.ts
    - packages/core/src/decorators/odata-key.decorator.ts
    - packages/core/src/decorators/odata-view.decorator.ts
    - packages/core/src/decorators/index.ts
    - packages/core/src/decorators/decorators.spec.ts
  modified:
    - packages/core/src/index.ts
decisions:
  - 'EntityClass = new (...args: unknown[]) => unknown used instead of Function[] to satisfy @typescript-eslint/no-unsafe-function-type rule'
  - 'EdmRegistry @Injectable() imports from @nestjs/common (peer dep) — only safe because @nestjs/common is a declared peer dependency of core'
metrics:
  duration: '~7 minutes'
  completed: '2026-04-07'
  tasks_completed: 2
  files_created: 17
  files_modified: 1
---

# Phase 2 Plan 01: EDM type system, adapter interfaces, and decorators — Summary

**One-liner:** OData v4 EDM type system with all 15 primitive types, IEdmDeriver/IQueryTranslator adapter seams, EdmRegistry NestJS singleton, and 5 reflect-metadata decorators exported from @nestjs-odata/core.

## What Was Built

### Task 1: EDM type system, adapter interfaces, and EdmRegistry

**EDM types** (`packages/core/src/edm/`):

- `EdmPrimitiveType` — string literal union of all 15 OData v4 primitive types. `Edm.DateTimeOffset` included; `Edm.DateTime` (OData v3) explicitly absent.
- `EdmProperty`, `EdmNavigationProperty`, `UnmappedTypeStrategy` — structural building blocks.
- `EdmEntityType`, `EdmEntitySet`, `EdmEntityConfig`, `EdmVirtualView` — complete entity model interfaces.

**EdmRegistry** (`packages/core/src/edm/edm-registry.ts`):

- `@Injectable()` NestJS singleton. Stores entity types and sets in private Maps.
- `register()` throws on duplicate names — implements T-02-01 tamper mitigation.
- `getEntityType()`, `getEntitySet()`, `getEntityTypes()`, `getEntitySets()` — read-only access.

**Adapter interfaces** (`packages/core/src/interfaces/`):

- `IEdmDeriver` with `EDM_DERIVER` injection token — seam for ORM-specific EDM derivation.
- `IQueryTranslator` with `QUERY_TRANSLATOR` injection token — seam for ORM-specific query translation.
- `EntityClass` constructor type used instead of `Function[]` (ESLint rule compliance).

### Task 2: OData decorators with reflect-metadata

**Metadata keys** (`packages/core/src/decorators/metadata-keys.ts`):

- 5 unique `Symbol` keys for isolation: `EDM_TYPE_KEY`, `ODATA_EXCLUDE_KEY`, `ODATA_ENTITY_SET_KEY`, `ODATA_KEY_KEY`, `ODATA_VIEW_KEY`.

**Decorators** (zero typeorm / @nestjs imports; pure reflect-metadata):

- `@EdmType(options)` — overrides EDM type mapping with precision/scale/maxLength.
- `@ODataExclude()` — marks properties to exclude from EDM and responses.
- `@ODataEntitySet(name)` — custom entity set name override (auto-pluralize fallback if absent).
- `@ODataKey()` — marks key properties, supports composite keys via multiple uses.
- `@ODataView(options)` — virtual view with `sourceEntity`, `exposedProperties`, optional `entitySetName`.

**Helper functions** exported alongside each decorator for metadata reading.

**`packages/core/src/index.ts`** — updated to re-export `./edm/index.js`, `./interfaces/index.js`, `./decorators/index.js`.

## Test Results

| Suite                   | Tests   | Status       |
| ----------------------- | ------- | ------------ |
| edm-registry.spec.ts    | 5       | PASS         |
| decorators.spec.ts      | 7       | PASS         |
| parser tests (existing) | 102     | PASS         |
| **Total**               | **114** | **ALL PASS** |

Typecheck: `tsc --noEmit` — clean, zero errors.

## Acceptance Criteria Verification

- [x] `packages/core/src/edm/edm-types.ts` contains `export type EdmPrimitiveType =`
- [x] `edm-types.ts` contains `Edm.DateTimeOffset` (NOT `Edm.DateTime`)
- [x] `edm-entity-type.ts` contains `export interface EdmEntityType`
- [x] `edm-entity-set.ts` contains `export interface EdmEntityConfig`
- [x] `edm-entity-set.ts` contains `export interface EdmVirtualView`
- [x] `edm-registry.ts` contains `@Injectable()` and `export class EdmRegistry`
- [x] `edm-deriver.interface.ts` contains `export interface IEdmDeriver`
- [x] `query-translator.interface.ts` contains `export interface IQueryTranslator`
- [x] `grep -r "from 'typeorm'"` returns zero matches in `packages/core/src/`
- [x] `packages/core/src/decorators/metadata-keys.ts` contains `export const EDM_TYPE_KEY = Symbol(`
- [x] `edm-type.decorator.ts` contains `export function EdmType(`
- [x] `odata-exclude.decorator.ts` contains `export function ODataExclude(`
- [x] `odata-entity-set.decorator.ts` contains `export function ODataEntitySet(`
- [x] `odata-key.decorator.ts` contains `export function ODataKey(`
- [x] `odata-view.decorator.ts` contains `export function ODataView(`
- [x] `packages/core/src/index.ts` contains `export * from './decorators/index.js'`
- [x] `packages/core/src/index.ts` contains `export * from './edm/index.js'`
- [x] `packages/core/src/index.ts` contains `export * from './interfaces/index.js'`
- [x] `grep -r "from '@nestjs'"` returns zero matches in `packages/core/src/decorators/`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced `Function[]` with `EntityClass` constructor type**

- **Found during:** Task 1 commit (ESLint pre-commit hook)
- **Issue:** `@typescript-eslint/no-unsafe-function-type` rule bans the `Function` type in `IEdmDeriver.deriveEntityTypes(entityClasses: Function[])`
- **Fix:** Introduced `export type EntityClass = new (...args: unknown[]) => unknown` and updated the interface signature
- **Files modified:** `packages/core/src/interfaces/edm-deriver.interface.ts`, `packages/core/src/interfaces/index.ts`
- **Commit:** d53ff5d (included in Task 1 commit)

**2. [Rule 1 - Bug] Removed unused imports in decorators.spec.ts**

- **Found during:** Task 2 commit (ESLint pre-commit hook)
- **Issue:** `EDM_TYPE_KEY` imported but unused; `rawMeta` variable assigned but unused
- **Fix:** Removed unused `EDM_TYPE_KEY` import and `rawMeta` variable from spec
- **Files modified:** `packages/core/src/decorators/decorators.spec.ts`
- **Commit:** 72599ec (included in Task 2 commit)

## Known Stubs

None. All interfaces and implementations are complete for this plan's scope. `IQueryTranslator.translate()` uses `unknown` types intentionally — full signature will be defined in Phase 3 query builder work (documented in the interface JSDoc).

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes were introduced. Decorator metadata is internal to the server process (T-02-02: accepted per plan threat model).

## Self-Check

### Files exist:

- packages/core/src/edm/edm-types.ts — FOUND
- packages/core/src/edm/edm-registry.ts — FOUND
- packages/core/src/interfaces/edm-deriver.interface.ts — FOUND
- packages/core/src/decorators/metadata-keys.ts — FOUND
- packages/core/src/decorators/edm-type.decorator.ts — FOUND

### Commits exist:

- d53ff5d — FOUND (feat(02-01): add EDM type system...)
- 72599ec — FOUND (feat(02-01): add OData decorators...)

## Self-Check: PASSED
