---
phase: 03-query-engine-and-response-format
plan: '03'
subsystem: response
tags: [odata, response, interceptor, exception-filter, decorator, nestjs]
dependency_graph:
  requires:
    - packages/core/src/query/odata-query.types.ts
    - packages/core/src/parser/errors.ts
    - packages/core/src/query/odata-validation.error.ts
    - packages/core/src/parser/ast.ts
    - packages/core/src/tokens.ts
    - packages/core/src/odata.module.ts
  provides:
    - buildContextUrl (pure function, OData v4 context URL builder per spec section 10)
    - ODataResponseInterceptor (NestJS interceptor wrapping ODataQueryResult into JSON envelope)
    - ODataExceptionFilter (NestJS exception filter formatting OData v4 error bodies)
    - ODataGet decorator (composite: Get + metadata + interceptor + filter)
    - ODataQueryParam decorator (param decorator extracting req.query with entitySetName)
    - ODATA_ROUTE_KEY (metadata key marking OData routes)
  affects:
    - packages/core/src/decorators/index.ts
    - packages/core/src/index.ts
tech_stack:
  added: []
  patterns:
    - NestJS NestInterceptor with Reflector for route-scoped response transformation
    - NestJS ExceptionFilter with @Catch() for all-exception OData v4 error formatting
    - applyDecorators composite pattern for @ODataGet() route decorator
    - createParamDecorator for @ODataQueryParam() parameter extraction
    - ODATA_ROUTE_KEY Symbol metadata as OData route gate (non-OData routes unaffected)
key_files:
  created:
    - packages/core/src/response/odata-context-url.builder.ts
    - packages/core/src/response/odata-context-url.builder.spec.ts
    - packages/core/src/response/odata-response.interceptor.ts
    - packages/core/src/response/odata-response.interceptor.spec.ts
    - packages/core/src/response/odata-exception.filter.ts
    - packages/core/src/response/odata-exception.filter.spec.ts
    - packages/core/src/response/index.ts
    - packages/core/src/decorators/odata-get.decorator.ts
    - packages/core/src/decorators/odata-get.decorator.spec.ts
    - packages/core/src/decorators/odata-query.decorator.ts
    - packages/core/src/decorators/odata-query.decorator.spec.ts
  modified:
    - packages/core/src/decorators/metadata-keys.ts
    - packages/core/src/decorators/index.ts
    - packages/core/src/index.ts
key-decisions:
  - 'ODataExceptionFilter uses a local HttpResponse interface instead of importing from express — avoids @types/express dependency not in package.json'
  - 'ODATA_ROUTE_KEY metadata value is { entitySetName, autoHandler } object — interceptor reads entitySetName, autoHandler flag reserved for Plan 04 auto-handler mechanism'
  - 'Interceptor uses Reflect.get on ODATA_ROUTE_KEY without the key in metadata-keys.ts initial version — added ODATA_ROUTE_KEY to metadata-keys.ts as part of Task 1 (needed by both interceptor and decorator)'
  - 'Tests use firstValueFrom(Observable) instead of done() callback pattern — Vitest 3 deprecated done() callbacks'
  - 'spec files use eslint-disable-next-line @typescript-eslint/unbound-method for Reflect.getMetadata calls that pass method references for metadata inspection only'

requirements-completed: [RESP-01, RESP-02, QUERY-06, TEST-01]

duration: 12min
completed: '2026-04-07'
---

# Phase 3 Plan 03: Response Layer and Decorators Summary

OData v4 response envelope (ODataResponseInterceptor), error formatter (ODataExceptionFilter), context URL builder, and composite @ODataGet()/@ODataQueryParam() decorators — completing the user-facing NestJS integration layer.

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-07T14:03:00Z
- **Completed:** 2026-04-07T14:11:00Z
- **Tasks:** 2
- **Files modified:** 13 (11 created, 3 modified)

## Accomplishments

- `buildContextUrl` produces correct OData v4 context URLs with optional `$select` projection (per spec section 10)
- `ODataResponseInterceptor` wraps `ODataQueryResult` into `{ @odata.context, value, @odata.count?, @odata.nextLink? }` — only activates on routes with `ODATA_ROUTE_KEY` metadata, leaving all other routes untouched
- `ODataExceptionFilter` catches `ODataParseError`, `ODataValidationError`, `HttpException`, and generic errors — formats all as OData v4 error bodies, never leaks stack traces (T-03-08)
- `@ODataGet()` composes `Get()`, `SetMetadata(ODATA_ROUTE_KEY)`, `UseInterceptors(ODataResponseInterceptor)`, and `UseFilters(ODataExceptionFilter)` via `applyDecorators`
- `@ODataQueryParam()` extracts `req.query` and `entitySetName` for `ODataQueryPipe` consumption

## Task Commits

1. **Task 1: buildContextUrl, ODataResponseInterceptor, ODataExceptionFilter** - `848e37d` (feat)
2. **Task 2: @ODataGet() and @ODataQueryParam() decorators** - `e79b8bb` (feat)

## Files Created/Modified

- `packages/core/src/response/odata-context-url.builder.ts` - Pure function building `@odata.context` URL
- `packages/core/src/response/odata-response.interceptor.ts` - NestJS interceptor wrapping results in OData JSON envelope
- `packages/core/src/response/odata-exception.filter.ts` - NestJS exception filter formatting OData v4 error bodies
- `packages/core/src/response/index.ts` - Barrel export for response module
- `packages/core/src/decorators/odata-get.decorator.ts` - Composite `@ODataGet()` method decorator
- `packages/core/src/decorators/odata-query.decorator.ts` - `@ODataQueryParam()` parameter decorator
- `packages/core/src/decorators/metadata-keys.ts` - Added `ODATA_ROUTE_KEY` Symbol
- `packages/core/src/decorators/index.ts` - Updated exports: ODATA_ROUTE_KEY, ODataGet, ODataQueryParam
- `packages/core/src/index.ts` - Added `export * from './response/index.js'`

## Decisions Made

- `ODataExceptionFilter` uses a local `HttpResponse` interface instead of importing `express.Response` — avoids adding `@types/express` to the package devDependencies.
- `ODATA_ROUTE_KEY` metadata value is `{ entitySetName, autoHandler }` — interceptor uses `entitySetName` for context URL; `autoHandler` flag is reserved for Plan 04's auto-handler mechanism.
- Tests use `firstValueFrom()` from rxjs instead of `done()` callbacks — Vitest 3 deprecated the `done()` callback pattern.
- `eslint-disable-next-line @typescript-eslint/unbound-method` used in decorator specs where `Reflect.getMetadata` takes a method reference for metadata inspection (not for calling).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vitest done() callback deprecated in Vitest 3**

- **Found during:** Task 1 (interceptor spec)
- **Issue:** Initial interceptor tests used `done()` callback pattern — Vitest 3 deprecated it, producing 6 uncaught exceptions
- **Fix:** Rewrote all interceptor tests to use `async/await` with `firstValueFrom()` from rxjs
- **Files modified:** `packages/core/src/response/odata-response.interceptor.spec.ts`
- **Verification:** 6 tests pass with zero errors
- **Committed in:** `848e37d` (Task 1 commit)

**2. [Rule 2 - Missing] @types/express not available — removed express import**

- **Found during:** Task 1 (type check)
- **Issue:** `import type { Response } from 'express'` failed — `@types/express` is not in devDependencies
- **Fix:** Replaced with a local `HttpResponse` interface (`status(code): this; json(body): this`) — Express and Fastify both satisfy this shape
- **Files modified:** `packages/core/src/response/odata-exception.filter.ts`
- **Verification:** `tsc --noEmit` exits 0
- **Committed in:** `848e37d` (Task 1 commit)

**3. [Rule 1 - Bug] ESLint unbound-method in spec files**

- **Found during:** Task 1 and Task 2 pre-commit hooks
- **Issue:** `vi.mocked(handler.handle)` and `Reflect.getMetadata(..., TestController.prototype.method)` triggered `@typescript-eslint/unbound-method`
- **Fix:** Extracted mock instances to typed `MockCallHandler` interface; used `eslint-disable-next-line` for `Reflect.getMetadata` prototype calls (false positive — no `this` binding involved)
- **Files modified:** Interceptor spec, decorator spec
- **Verification:** ESLint passes on all 5 spec files
- **Committed in:** `848e37d`, `e79b8bb`

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing dependency, 1 ESLint false positive)
**Impact on plan:** All auto-fixes necessary for correctness and tooling compatibility. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## Known Stubs

None — all components are fully implemented. `ODataResponseInterceptor` reads real `ODATA_MODULE_OPTIONS` via DI. `ODataExceptionFilter` handles all exception types. `buildContextUrl` handles all select cases.

## Threat Model Coverage

| Threat                                           | Mitigation                                                                                                          | Status    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------- |
| T-03-08 Info Disclosure via ODataExceptionFilter | Generic errors return fixed "An unexpected error occurred." — no stack traces, no internal paths, no SQL details    | Mitigated |
| T-03-09 Spoofing via ODataResponseInterceptor    | Interceptor only activates on routes with ODATA_ROUTE_KEY metadata (set at decoration time, not request time)       | Mitigated |
| T-03-10 Info Disclosure via buildContextUrl      | Context URL reveals serviceRoot and entity set name — intentional per OData v4 spec, same info client already knows | Accepted  |

## Next Phase Readiness

- Response layer complete — all OData routes decorated with `@ODataGet()` will get spec-compliant envelopes
- `ODataQueryPipe` (Plan 01) + `ODataResponseInterceptor` (this plan) form the complete request→response pipeline
- Plan 04 can use `autoHandler: true` option in `@ODataGet()` options for auto-handler wiring
- Zero TypeORM imports in any file — PKG-01 architecture constraint maintained

## Self-Check: PASSED

All 11 created files verified on disk. Both commits (848e37d, e79b8bb) verified in git log.

---

_Phase: 03-query-engine-and-response-format_
_Completed: 2026-04-07_
