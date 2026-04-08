---
phase: 09-response-annotations-and-etags
plan: "01"
subsystem: response
tags: [odata-annotations, odata-id, odata-type, navigation-links, interceptor]
dependency_graph:
  requires:
    - packages/core/src/edm/edm-registry.ts
    - packages/core/src/edm/edm-entity-type.ts
    - packages/core/src/response/odata-response.interceptor.ts
  provides:
    - packages/core/src/response/odata-annotation.builder.ts
    - packages/core/src/response/odata-annotation.builder.spec.ts
  affects:
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/core/src/response/odata-response.interceptor.spec.ts
    - packages/core/src/response/index.ts
tech_stack:
  added: []
  patterns:
    - Pure function annotation builder (annotateEntity/annotateEntities)
    - Graceful degradation when entity set not registered
    - Immutable entity annotation via object spread
key_files:
  created:
    - packages/core/src/response/odata-annotation.builder.ts
    - packages/core/src/response/odata-annotation.builder.spec.ts
  modified:
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/core/src/response/odata-response.interceptor.spec.ts
    - packages/core/src/response/index.ts
decisions:
  - "Annotation builder is a pure function module (not a class), matching the odata-context-url.builder pattern already in the codebase"
  - "ODataResponseInterceptor receives EdmRegistry as a 3rd constructor arg — EdmRegistry is already a global NestJS provider exported by ODataModule, so no module changes required"
  - "Graceful degradation: if entity set not in registry, annotations are silently skipped and the response is still valid (just without annotations)"
metrics:
  duration: "~20 minutes"
  completed: "2026-04-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 3
---

# Phase 09 Plan 01: Response Annotations Summary

**One-liner:** OData v4 entity metadata annotations (@odata.id, @odata.type, @odata.navigationLink) via pure `annotateEntity()` function integrated into `ODataResponseInterceptor`.

## What Was Built

### Task 1: `annotateEntity()` pure function

Created `packages/core/src/response/odata-annotation.builder.ts` with:

- `annotateEntity(entity, ctx)` — adds `@odata.id`, `@odata.type`, and `{navProp}@odata.navigationLink` to a single entity object
- `annotateEntities(items, ctx)` — maps over a collection calling `annotateEntity`
- `AnnotationContext` interface — carries serviceRoot, entitySetName, entityType, namespace
- Key format support: single integer key `(1)`, single string key `('abc')`, composite key `(orderId=1,productId=2)`
- Immutable: always returns a new object via spread, never mutates input
- Null/undefined safety: returns input unchanged without crashing

9 unit tests covering all key formats, navigation links, collection annotation, immutability, and namespace configuration.

### Task 2: ODataResponseInterceptor integration

Modified `packages/core/src/response/odata-response.interceptor.ts`:

- Added `EdmRegistry` as a 3rd constructor dependency (already a global NestJS provider)
- Added `resolveAnnotationContext(entitySetName)` private helper method
- Applied `annotateEntity()` to single-entity responses (GET by key, PATCH)
- Applied `annotateEntity()` to POST create responses (entity extracted from result)
- Applied `annotateEntities()` to collection response `value[]` items
- Graceful degradation: when entity set not in registry, annotations are skipped and response still has `@odata.context`
- Non-OData routes remain completely unaffected (passes through unchanged)

Updated `odata-response.interceptor.spec.ts` with 5 new annotation tests (15 total). Updated `response/index.ts` to export `annotateEntity`, `annotateEntities`, and `AnnotationContext`.

## Test Results

- All 257 core package tests pass
- 9 annotation builder tests
- 15 interceptor tests (5 new annotation tests + 10 existing)
- Build: `tsdown` produces ESM + CJS bundles without errors

## Decisions Made

1. **Pure function module pattern** — `annotateEntity` follows the same pattern as `buildContextUrl` (pure function, not a class), keeping annotation logic stateless and easily testable.

2. **EdmRegistry injection** — `ODataResponseInterceptor` receives `EdmRegistry` as a 3rd constructor arg. Since `EdmRegistry` is already exported as a global provider by `ODataModule`, no module changes were needed.

3. **Graceful degradation** — when `resolveAnnotationContext()` returns null (entity set not registered), annotations are silently omitted. This prevents crashes during testing or in mixed-route scenarios where not all entity sets are registered.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all annotation fields are wired from real EDM metadata.

## Threat Flags

No new security surface introduced. All annotations use server-generated data (serviceRoot from config, entitySetName from server metadata, key values from the entity response). No user input is used in URL construction (T-09-03 mitigated as documented in plan threat model).

## Self-Check

Verified:
- `packages/core/src/response/odata-annotation.builder.ts` — FOUND
- `packages/core/src/response/odata-annotation.builder.spec.ts` — FOUND
- Commit `c4fc2b4` — FOUND (Task 1)
- Commit `70bbbf8` — FOUND (Task 2)
