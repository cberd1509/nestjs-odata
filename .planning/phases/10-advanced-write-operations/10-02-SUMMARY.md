---
phase: '10'
plan: '02'
subsystem: typeorm-adapter
tags: [deep-insert, content-id, batch, write-operations, odata-v4]
dependency_graph:
  requires: [10-01]
  provides: [WRITE-02, WRITE-03]
  affects: [batch-controller, typeorm-auto-handler, odata-module]
tech_stack:
  added: []
  patterns:
    - QueryRunner transaction wrapping for atomic deep insert
    - Content-ID map scoped per changeset (Map<string, string>)
    - Private method tested via index-signature accessor pattern
key_files:
  created:
    - apps/test-app/test/deep-insert.e2e-spec.ts
    - apps/test-app/test/content-id.e2e-spec.ts
    - apps/test-app/test/debug-cid.e2e-spec.ts
  modified:
    - packages/core/src/odata.module.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.ts
    - packages/typeorm/src/translator/typeorm-auto-handler.spec.ts
    - packages/typeorm/src/odata-typeorm.module.ts
    - packages/typeorm/src/batch/batch-controller.ts
    - packages/typeorm/src/batch/batch-controller.spec.ts
    - apps/test-app/src/orders/orders.controller.ts
decisions:
  - 'Collection nav prop types are formatted as Collection(Default.EntityName) — strip wrapper before splitting on dot to extract class name'
  - 'contentIdMap is a local Map per changeset call, not stored on instance — changeset isolation is structural, not conditional'
  - 'handleDeepCreate() is on TypeOrmAutoHandler so consumers control transaction lifetime; the handler itself does not create QueryRunners'
  - 'resolveContentIdReferences() is private; tested via Record<string, fn> index-signature cast to avoid unsafe-any ESLint errors'
  - "Deep insert rollback relies on QueryRunner.rollbackTransaction() in the controller's catch block — handler just throws on child failure"
metrics:
  duration: 'approx 90 minutes (continued from previous session)'
  completed: '2026-04-08'
  tasks_completed: 2
  files_changed: 11
---

# Phase 10 Plan 02: Deep Insert and Content-ID Batch References Summary

Deep insert (WRITE-02) and Content-ID reference resolution (WRITE-03) for the `@nestjs-odata/typeorm` adapter, enabling atomic parent+child creation and intra-changeset URL substitution in OData `$batch` requests.

## What Was Built

### Task 1 — Deep Insert (WRITE-02)

**`maxDeepInsertDepth` config option** added to `ODataModuleOptions`, `ODataModuleResolvedOptions`, and `DEFAULT_OPTIONS` (default: 5) in `packages/core/src/odata.module.ts`.

**`handleDeepCreate(body, entitySetName, manager, depth)`** added to `TypeOrmAutoHandler`:

- Separates scalar fields from navigation property arrays in the request body
- Saves the parent entity via the provided `EntityManager` (caller controls the QueryRunner transaction)
- Resolves child entity class from EDM registry using the nav prop type (`Collection(Default.OrderItem)` → `OrderItem`)
- Injects the parent FK into each child body, recurses for nested nav props, catches child errors and rethrows with path context
- Throws 400 `HttpException` if `depth >= maxDeepInsertDepth`

**`apps/test-app/src/orders/orders.controller.ts`** updated:

- Detects nav prop arrays in the POST body
- If found: creates a QueryRunner, wraps `handleDeepCreate()` in a transaction, commits on success, rolls back on failure

**Unit tests** (4 tests, D1–D4) added to `typeorm-auto-handler.spec.ts`:

- D1: creates parent and child using EntityManager
- D2: rolls back on child save failure (mock throws)
- D3: rejects when depth exceeds maxDeepInsertDepth
- D4: ignores scalar-only body (no nav props)

**E2E tests** (3 tests) in `deep-insert.e2e-spec.ts`:

- Creates order with 2 items atomically; verifies both `OrderItem` rows exist
- Verifies full rollback when a child fails (missing productId FK)
- Verifies normal POST without nav props still returns 201

### Task 2 — Content-ID Reference Resolution (WRITE-03)

**`resolveContentIdReferences(part, contentIdMap)`** added as a private method on `BatchController`:

- Fast path: returns same `part` reference when map is empty
- Replaces `$N` in the request URL using `(?=[/?#]|$)` lookahead
- Replaces `$N` in the request body using `(?=\D|$)` (non-digit lookahead) to avoid matching e.g. `$10` when resolving `$1`
- Returns a new object only when a substitution occurs (reference equality preserved otherwise)

**`executeChangeset()`** modified to:

- Create a `contentIdMap = new Map<string, string>()` local to each changeset call
- Call `resolveContentIdReferences()` on each part before dispatch
- After a 201 response, store `part.contentId → location header` in the map

**Unit tests** (5 tests, ContentID-1 through ContentID-5) in `batch-controller.spec.ts`:

- Empty map returns same object reference
- `$1` in URL is substituted
- `$1/SubPath` in URL is substituted
- `$1` in JSON body is substituted
- No matching pattern returns same object reference

**E2E tests** (2 tests) in `content-id.e2e-spec.ts`:

- POST with Content-ID 1 then PATCH `$1` → both succeed, status confirmed via follow-up GET
- `$1` from changeset A does NOT resolve in changeset B (map is reset per changeset)

## Test Results

```
packages/typeorm:    233 tests, 15 files — all pass
apps/test-app:       173 tests, 14 files — all pass
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Collection nav prop type parsing**

- **Found during:** Task 1 e2e (deep-insert.e2e-spec.ts)
- **Issue:** `Collection(Default.OrderItem)`.split('.').pop() returns `OrderItem)` (trailing paren), causing entity class lookup to fail with 400
- **Fix:** Strip the `Collection(...)` wrapper before splitting on `.`
- **Files modified:** `packages/typeorm/src/translator/typeorm-auto-handler.ts`
- **Commit:** ba2e4e0

**2. [Rule 1 - Bug] Content-ID body substitution regex**

- **Found during:** Task 2 unit test ContentID-4
- **Issue:** URL pattern `(?=[/?#]|$)` doesn't match `$1"` inside a JSON string
- **Fix:** Use separate body pattern `(?=\D|$)` (non-digit lookahead) for body substitution
- **Files modified:** `packages/typeorm/src/batch/batch-controller.ts`
- **Commit:** 58e4c4d

**3. [Rule 1 - Bug] Content-ID e2e test location extraction**

- **Found during:** Task 2 e2e (content-id.e2e-spec.ts Test 1)
- **Issue:** Test looked for `location:` header in multipart response body, but `buildBatchResponse` only emits Content-Type/Content-Length/Content-ID headers — not Location
- **Fix:** Extract orderId from the JSON body of the 201 response part using `/"id":(\d+),"orderDate"/`
- **Files modified:** `apps/test-app/test/content-id.e2e-spec.ts`
- **Commit:** 58e4c4d

**4. [Rule 1 - Bug] lint-staged eslint-disable comment misalignment**

- **Found during:** Commit of Task 2
- **Issue:** Prettier reformatted `app.use((require(...)).text(...))` into multi-line form, pushing `require` to line N+2; the `eslint-disable-next-line` comment on line N only covered line N+1
- **Fix:** Changed to block-style `/* eslint-disable */ ... /* eslint-enable */` around the multi-line expression
- **Files modified:** `apps/test-app/test/debug-cid.e2e-spec.ts`
- **Commit:** 58e4c4d

**5. [Rule 2 - Missing] ESLint-safe private method accessor pattern**

- **Found during:** Commit of Task 2
- **Issue:** `(controller as any).resolveContentIdReferences(...)` triggered `no-unsafe-call` and `no-unsafe-member-access` in lint-staged
- **Fix:** Used `(c as unknown as Record<string, (...args: unknown[]) => unknown>)['resolveContentIdReferences'].bind(c)` — index-signature access is type-safe without `any`
- **Files modified:** `packages/typeorm/src/batch/batch-controller.spec.ts`
- **Commit:** 58e4c4d

## Known Stubs

None — all features are fully wired. Deep insert reads real EDM metadata; Content-ID map is populated from actual 201 responses.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Deep insert and Content-ID operate within existing `$batch` and entity-create surfaces.

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Task 1 commit ba2e4e0: FOUND
- Task 2 commit 58e4c4d: FOUND
- All 173 e2e tests: PASS
- All 233 unit tests: PASS
- pnpm build (core + typeorm): PASS
