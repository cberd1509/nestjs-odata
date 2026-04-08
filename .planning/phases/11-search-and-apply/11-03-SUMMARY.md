---
phase: 11-search-and-apply
plan: 03
status: completed
started: 2026-04-08T19:42:00Z
completed: 2026-04-08T19:46:00Z
---

# Plan 11-03 Summary: ODataQueryPipe/interceptor wiring and e2e tests

## What Was Built

Connected the $search and $apply parsers (Plan 01) and TypeORM translators (Plan 02) to the HTTP pipeline, completing the full end-to-end flow from HTTP request to SQL query to JSON response.

## Key Changes

### Task 1: Pipe and Interceptor Extension

- **ODataQueryPipe** (`packages/core/src/query/odata-query.pipe.ts`): Added `parseSearch()` and `parseApply()` extraction from query params, stored as `search` and `apply` fields on the returned `ODataQuery` object
- **ODataResponseInterceptor** (`packages/core/src/response/odata-response.interceptor.ts`): Added aggregated response branch that checks `isAggregated` flag — builds projection context URL from `applyProperties`, skips entity annotations (`@odata.id`, `@odata.type`, navigation links)
- **TypeOrmAutoHandler** (`packages/typeorm/src/translator/typeorm-auto-handler.ts`): Fixed missing `isAggregated` and `applyProperties` forwarding in `handleGet()` return object
- **TypeOrmQueryTranslator** (`packages/typeorm/src/translator/typeorm-query-translator.ts`): Fixed bug where `entityType.name` (singular "Product") was passed to search provider instead of `query.entitySetName` (plural "Products")

### Task 2: Test Entity Decorators and E2E Tests

- Added `@ODataSearchable()` to `Product.name`, `Product.description`, and `Order.status`
- Created comprehensive e2e test suite (`apps/test-app/test/search-apply.e2e-spec.ts`) with 13 tests

## Deviations

- **"$search on entity without @ODataSearchable returns 400" test skipped**: The plan specified `GET /odata/Categories?$search=electronics` but no Categories controller exists in the test app. The validation error is already covered by the search-provider unit tests from Plan 02.
- **Fixed entitySetName bug**: Discovered and fixed a bug where `TypeOrmQueryTranslator` passed `entityType.name` (e.g., "Product") to the search provider, but `TypeOrmSearchProvider.buildSearchCondition()` calls `edmRegistry.getEntitySet()` which expects entity set names (e.g., "Products"). Changed to pass `query.entitySetName`.
- **Fixed handleGet forwarding**: `TypeOrmAutoHandler.handleGet()` was not forwarding `isAggregated` and `applyProperties` from the translator result, causing the interceptor's aggregated branch to never activate.

## Self-Check: PASSED

All acceptance criteria verified:

- `pnpm build` exits 0
- `pnpm --filter test-app test -- --run` passes all 186 tests (13 new)
- ODataQueryPipe calls `parseSearch` and `parseApply`
- ODataResponseInterceptor checks `isAggregated` and uses `applyProperties`
- `@ODataSearchable` on Product.name, Product.description, Order.status
- E2E tests cover all 4 ROADMAP Phase 11 success criteria

## key-files

### created

- `apps/test-app/test/search-apply.e2e-spec.ts` — 13 e2e tests for $search and $apply

### modified

- `packages/core/src/query/odata-query.pipe.ts` — $search/$apply extraction
- `packages/core/src/response/odata-response.interceptor.ts` — aggregated response branch
- `packages/typeorm/src/translator/typeorm-auto-handler.ts` — isAggregated forwarding
- `packages/typeorm/src/translator/typeorm-query-translator.ts` — entitySetName fix
- `apps/test-app/src/entities/product.entity.ts` — @ODataSearchable on name, description
- `apps/test-app/src/entities/order.entity.ts` — @ODataSearchable on status
