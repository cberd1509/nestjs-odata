# Phase 5: $batch, Security, and v1 Hardening — Research

**Researched:** 2026-04-07
**Domain:** OData v4 $batch parsing, TypeORM transactions, security limit enforcement, CI/CD release pipeline, VitePress docs, coverage enforcement
**Confidence:** HIGH (all critical decisions are verified; a few discretionary areas are ASSUMED)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Custom multipart/mixed parser built in-house per OData v4 spec. No external multipart library dependency.
- **D-02:** Full changeset rollback — all operations in a changeset wrapped in a TypeORM `QueryRunner` transaction.
- **D-03:** Per-operation status in batch response — each operation gets its own HTTP status code and body.
- **D-04:** $batch controller reuses existing CRUD handlers (`TypeOrmAutoHandler.handleCreate/handleUpdate/handleDelete/handleGetByKey`).
- **D-05:** `maxTop` violations rejected with HTTP 400 and OData error body — NOT silently clamped.
- **D-06:** Query complexity limits configurable with sensible defaults. Exceeding returns HTTP 400.
- **D-07:** Per-entity security overrides via `forFeature()`. Global defaults in `forRoot()`. Per-entity overrides win.
- **D-08:** SEC-03 (parameterized queries) already implemented in Phase 3 FilterVisitor — verify only.
- **D-09:** SEC-02 (`maxExpandDepth`) already enforced by Phase 4 ExpandVisitor — verify, add per-entity support.
- **D-10:** Changesets + GitHub Actions pipeline. Workflow: lint → test → build → `changeset version` → `npm publish` with OIDC provenance.
- **D-11:** `publint` and `@arethetypeswrong/cli` checks in CI. Both must pass before publish.
- **D-12:** VitePress documentation site — getting-started, API reference, examples. Deployed to GitHub Pages.
- **D-13:** Fix `$expand` `$top/$skip` — `expand-pagination.ts` with post-JOIN in-memory slicing. Wire into `TypeOrmQueryTranslator.execute()`.
- **D-14:** Enforce 80%+ code coverage — install `@vitest/coverage-v8`, add thresholds to vitest configs, fail CI below threshold.

### Claude's Discretion

- $batch multipart boundary generation strategy
- Exact query complexity scoring formula and default thresholds
- VitePress site structure and navigation
- How `forFeature()` per-entity config merges with `forRoot()` globals
- Changelog formatting and release note structure
- Whether to add a $batch size limit (max operations per batch)

### Deferred Ideas (OUT OF SCOPE)

- ESLint rule: OData decorators only on @ODataController — post-v1 quality improvement
  </user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                     | Research Support                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| BATCH-01 | `$batch` endpoint accepting multipart/mixed batch requests                                                      | Multipart/mixed wire format, custom parser design, NestJS controller routing  |
| BATCH-02 | Changeset atomicity — all operations in a changeset succeed or all roll back (TypeORM QueryRunner transactions) | TypeORM QueryRunner pattern verified                                          |
| BATCH-03 | Individual requests outside changesets execute independently                                                    | OData v4 spec: independent requests unaffected by others' failures            |
| SEC-01   | `maxTop` configuration to limit maximum page size                                                               | ODataQueryPipe already has maxTop — change clamp to reject with 400           |
| SEC-02   | `$expand` depth limit configuration                                                                             | ExpandVisitor already enforces maxExpandDepth — add per-entity override       |
| SEC-03   | All query-to-SQL translation uses parameterized queries                                                         | FilterVisitor uses named params (:p1, :p2) — already done, verify only        |
| SEC-04   | Query complexity limits to prevent DoS via expensive filter expressions                                         | New: maxFilterDepth limit; track nesting depth during FilterVisitor traversal |

</phase_requirements>

---

## Summary

Phase 5 is the final v1 phase. It is divided into four workstreams: (1) $batch endpoint, (2) security limit hardening, (3) gap closure from Phase 4, and (4) release pipeline and docs.

**$batch** requires a custom multipart/mixed body parser (no external dependency per D-01), a NestJS controller that routes parsed sub-requests through existing `TypeOrmAutoHandler` CRUD methods, and TypeORM `QueryRunner` transactions for changeset atomicity. The wire format is well-specified by OData v4 Part 1 section 11. The existing `ODataExceptionFilter` handles error formatting; the batch controller adapts this for per-operation responses within the multipart response body.

**Security limits** are mostly incremental changes to existing infrastructure: `ODataQueryPipe` maxTop clamping becomes rejection (one method change), `ExpandVisitor` already enforces `maxExpandDepth` but needs per-entity config support, FilterVisitor needs a filter depth counter (SEC-04). The per-entity config mechanism requires extending `ODataModuleOptions` and threading the entity-specific resolved options into the pipe.

**Release pipeline** already has the structural scaffolding (changesets config, CI workflow, GitHub Actions release workflow). The release.yml needs npm OIDC trusted publishing — this requires a specific workflow pattern since the changesets/action doesn't natively support npm OIDC. The CI already runs publint and @arethetypeswrong/cli. Coverage enforcement needs `@vitest/coverage-v8` installed and thresholds added to vitest configs.

**Primary recommendation:** Work in parallel tracks — $batch is independent of security limit changes. Gap closure ($expand pagination) and coverage are infrastructure concerns that can proceed alongside both.

---

## Standard Stack

### Core (already installed — no new dependencies needed for most items)

| Library | Version | Purpose                                | Status                                                          |
| ------- | ------- | -------------------------------------- | --------------------------------------------------------------- |
| TypeORM | ^0.3.28 | QueryRunner for changeset transactions | Already installed [VERIFIED: packages/typeorm/package.json]     |
| NestJS  | ^11.x   | Controller for POST /$batch            | Peer dep, already in use [VERIFIED: packages/core/package.json] |
| Vitest  | ^3.2.0  | Test runner                            | Already installed [VERIFIED: packages/core/package.json]        |

### New Dependencies Required

| Library             | Version | Purpose                                     | Install In                                                                  |
| ------------------- | ------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| @vitest/coverage-v8 | ^3.x    | Coverage provider for threshold enforcement | packages/core, packages/typeorm [ASSUMED: version should match vitest ^3.x] |

### Supporting (CI only — already configured via pnpm dlx)

| Tool                  | Version | Purpose                                                 | Status                                                              |
| --------------------- | ------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| @arethetypeswrong/cli | latest  | Validates TypeScript types for dual ESM+CJS packages    | Already in ci.yml via pnpm dlx [VERIFIED: .github/workflows/ci.yml] |
| publint               | latest  | Validates package.json exports, types, and entry points | Already in ci.yml via pnpm dlx [VERIFIED: .github/workflows/ci.yml] |

**Installation (new deps only):**

```bash
pnpm --filter @nestjs-odata/core add -D @vitest/coverage-v8
pnpm --filter @nestjs-odata/typeorm add -D @vitest/coverage-v8
```

**Version verification:**

```bash
npm view @vitest/coverage-v8 version   # verify matches vitest major
```

---

## Architecture Patterns

### $batch: Multipart/Mixed Wire Format

**What:** OData v4 Part 1 section 11 defines a batch request as a `POST /$batch` with `Content-Type: multipart/mixed; boundary=<token>`. [CITED: docs.oasis-open.org/odata/odata/v4.01]

The structure has two kinds of parts:

1. **Individual requests** — read-only operations (GET) or mutations outside a changeset
2. **Changesets** — `Content-Type: multipart/mixed; boundary=changeset_<token>` with nested mutation parts

**Exact wire format:**

```
POST /odata/$batch HTTP/1.1
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http
Content-Transfer-Encoding: binary

GET /odata/Products HTTP/1.1
Accept: application/json

--batch_abc123
Content-Type: multipart/mixed; boundary=changeset_xyz

--changeset_xyz
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 1

POST /odata/Products HTTP/1.1
Content-Type: application/json

{"Name":"Widget","Price":9.99}

--changeset_xyz
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 2

PATCH /odata/Products(1) HTTP/1.1
Content-Type: application/json

{"Price":8.99}

--changeset_xyz--

--batch_abc123--
```

**Response format:** Multipart/mixed with one part per request. Changeset failure: all changeset operations get the error response. Independent requests always get their own status. [CITED: olingo.apache.org/doc/odata4/tutorials/batch/tutorial_batch.html]

### $batch: Custom Multipart/Mixed Parser

**What:** The parser extracts the batch boundary from `Content-Type`, splits the body by boundary markers, identifies changeset vs. individual request parts, and parses each embedded HTTP request (method, URL, headers, body).

**Parser output type (design recommendation):**

```typescript
// Source: OData v4 Part 1 §11.7 + in-house design [ASSUMED: exact interface shape]
type BatchPart =
  | {
      kind: 'request'
      contentId?: string
      method: string
      url: string
      headers: Record<string, string>
      body?: string
    }
  | { kind: 'changeset'; parts: BatchPart[] }

interface ParsedBatch {
  boundary: string
  parts: BatchPart[]
}
```

**Boundary extraction from Content-Type:**

```typescript
// Source: RFC 2046 MIME multipart [ASSUMED: regex approach]
function extractBoundary(contentType: string): string {
  const match = /boundary=([^;]+)/.exec(contentType)
  if (!match) throw new Error('Missing boundary in Content-Type')
  return match[1].trim().replace(/^"|"$/g, '')
}
```

**Pitfall — missing trailing `--`:** MIME terminates a multipart body with `--boundary--` (two trailing dashes). A parser that only looks for `--boundary` without handling the terminal `--boundary--` will hang or throw. [ASSUMED: common multipart parser bug]

**Pitfall — CRLF vs LF:** HTTP headers within batch parts use CRLF (`\r\n`) per RFC 2616. The parser must handle both `\r\n` and `\n` boundary separators when reading Node.js request body buffers. [ASSUMED: cross-platform concern]

### $batch: Routing Sub-Requests to Existing Handlers

**What:** After parsing, each sub-request is dispatched to the appropriate `TypeOrmAutoHandler` method based on HTTP method and URL pattern. This matches D-04.

```typescript
// Source: TypeOrmAutoHandler methods from packages/typeorm/src/translator/typeorm-auto-handler.ts [VERIFIED]
// Dispatch table:
// GET   /EntitySet        → handler.handleGet(query, url)
// GET   /EntitySet(key)   → handler.handleGetByKey(key, entitySetName)
// POST  /EntitySet        → handler.handleCreate(body, entitySetName)
// PATCH /EntitySet(key)   → handler.handleUpdate(key, body, entitySetName)
// DELETE /EntitySet(key)  → handler.handleDelete(key, entitySetName)
```

**ODataQueryPipe issue:** `ODataQueryPipe` is a NestJS pipe that expects `ArgumentMetadata` with `data` (entitySetName). The batch handler cannot use it directly since there is no HTTP request context. The batch sub-request processing must call `parseQuery()` and validate manually, OR the batch handler instantiates the pipe directly with the entitySetName. [ASSUMED: may need a utility function that wraps pipe logic without NestJS pipe infrastructure]

### $batch: TypeORM QueryRunner Transaction Pattern

**What:** D-02 requires all operations in a changeset to be atomic. TypeORM's `QueryRunner` provides a single connection with explicit transaction control. [CITED: typeorm.io/docs/advanced-topics/transactions/]

```typescript
// Source: TypeORM 0.3.x official docs [CITED: typeorm.io/docs/advanced-topics/transactions/]
const queryRunner = dataSource.createQueryRunner()
await queryRunner.connect()
await queryRunner.startTransaction()
try {
  // Execute all changeset operations using queryRunner.manager
  await queryRunner.manager.save(entity1)
  await queryRunner.manager.save(entity2)
  await queryRunner.commitTransaction()
} catch (err) {
  await queryRunner.rollbackTransaction()
  throw err // Re-throw so batch controller can record the error
} finally {
  await queryRunner.release()
}
```

**Key:** `TypeOrmAutoHandler` methods use `this.repo` (a Repository). For changeset execution, the batch handler must either: (a) pass the `queryRunner.manager` as a repository substitute, OR (b) extract operation logic from `TypeOrmAutoHandler` into reusable functions that accept a `DataSource | EntityManager` parameter. Option (b) avoids creating new methods while reusing logic. [ASSUMED: exact refactoring strategy]

**DataSource is already injected** in `ODataTypeOrmModule.forFeature()` (line 102, 124 of odata-typeorm.module.ts) — the batch handler can receive `DataSource` from DI. [VERIFIED: packages/typeorm/src/odata-typeorm.module.ts]

### Security: maxTop Rejection (D-05)

**Current behavior** (ODataQueryPipe line 54): clamps to `maxTop` silently.
**Required behavior**: throw `ODataValidationError` when `$top > maxTop`, which the existing `ODataExceptionFilter` will format as HTTP 400 OData error body. [VERIFIED: packages/core/src/query/odata-query.pipe.ts]

**Change:**

```typescript
// Before (line 53-56 of odata-query.pipe.ts):
let top = parsed.top
if (top !== undefined && top > this.options.maxTop) {
  top = this.options.maxTop // CLAMP — remove this
}

// After:
let top = parsed.top
if (top !== undefined && top > this.options.maxTop) {
  throw new ODataValidationError(
    `$top value ${top} exceeds maximum of ${this.options.maxTop}`,
    '',
    '$top',
  )
}
```

**ODataValidationError** is already mapped to HTTP 400 by `ODataExceptionFilter`. [VERIFIED: packages/core/src/response/odata-exception.filter.ts]

### Security: Per-Entity Config Override Pattern (D-07)

**Goal:** `forRoot({ maxTop: 100 })` provides global default; `forFeature([{ entity: Product, maxTop: 500 }])` overrides for Product.

**Current state:** `ODataModuleOptions` has `maxTop` and `maxExpandDepth` as top-level fields. `forFeature()` only accepts `EdmEntityConfig[]`. Per-entity config is not currently modeled. [VERIFIED: packages/core/src/odata.module.ts]

**Required extension:**

```typescript
// Extend EdmEntityConfig or add a new per-entity options type [ASSUMED: interface design]
interface ODataEntitySecurityOptions {
  maxTop?: number
  maxExpandDepth?: number
  maxFilterDepth?: number
}
// The ODataQueryPipe and ExpandVisitor need to resolve: entity-specific options || global options
```

**Resolution pattern:** At pipe transform time, look up the entity set name in a registry of per-entity overrides. If found, apply the override; otherwise use global resolved options. The per-entity map can be stored in `EdmRegistry` or a separate `SecurityOptionsRegistry`. [ASSUMED: registry approach]

### Security: Filter Depth Limit (SEC-04)

**What:** Track AST nesting depth during `FilterVisitor` traversal and throw when depth exceeds `maxFilterDepth`. Depth increments on `BinaryExpr` and `UnaryExpr` nodes.

```typescript
// Source: existing FilterVisitor pattern [ASSUMED: implementation sketch]
// Track depth via a counter passed through recursive calls
private validateFilterDepth(node: FilterNode, depth: number, maxDepth: number): void {
  if (depth > maxDepth) {
    throw new ODataValidationError(
      `$filter nesting depth ${depth} exceeds maximum of ${maxDepth}`,
      this.entityType.name,
      '$filter',
    )
  }
  if (node.kind === 'BinaryExpr') {
    this.validateFilterDepth(node.left, depth + 1, maxDepth)
    this.validateFilterDepth(node.right, depth + 1, maxDepth)
  }
  // ... other node kinds
}
```

**Default recommended:** `maxFilterDepth: 10` (D-06). This allows complex but not pathological queries. [ASSUMED: default value based on common practice]

### Gap Closure: $expand Pagination

**Problem:** `ExpandVisitor` explicitly defers `$top/$skip` per expand item (comment at line 90-91). Phase 4 verification confirmed `expand-pagination.ts` does not exist. [VERIFIED: .planning/phases/04-crud-expand-and-module-system/04-VERIFICATION.md]

**Solution (D-13):** Post-JOIN in-memory slicing. TypeORM returns fully hydrated entities with expanded relations as JavaScript arrays. After `qb.getMany()`, slice each expanded collection by the per-expand-item `$top`/`$skip` values.

**ExpandVisitor change:** During visitation, if an expand item has `top` or `skip`, record it in an `expandPaginationMap: Map<string, { skip?: number; top?: number }>` keyed by join alias.

**QueryTranslator.execute() change:** After calling `qb.getMany()`, call `applyExpandPagination(items, expandPaginationMap)` to slice.

```typescript
// Source: D-13 decision + Phase 4 VERIFICATION.md gaps [VERIFIED reference, ASSUMED implementation]
function applyExpandPagination(
  items: ObjectLiteral[],
  paginationMap: Map<string, { skip?: number; top?: number }>,
  rootAlias: string,
): void {
  for (const [alias, { skip = 0, top }] of paginationMap.entries()) {
    // Derive nav prop name from alias: 'entity_category' -> 'category'
    const navProp = alias.replace(`${rootAlias}_`, '')
    for (const item of items) {
      const related = item[navProp]
      if (Array.isArray(related)) {
        item[navProp] = related.slice(skip, top !== undefined ? skip + top : undefined)
      }
    }
  }
}
```

**Limitation:** In-memory slicing is approximate for deep nested expansions when the same nav prop appears at multiple tree paths. For v1, single-level expand pagination is the target. [ASSUMED: acceptable scope limitation]

### Coverage Enforcement (D-14)

**Current state:** Both `vitest.config.ts` files have `coverage.reporter` set but no `thresholds`. `@vitest/coverage-v8` is not installed. [VERIFIED: packages/core/vitest.config.ts, packages/typeorm/vitest.config.ts]

**Required config change:**

```typescript
// Source: Vitest v3 docs [CITED: vitest.dev/config/coverage]
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
},
```

**CI change:** The `pnpm turbo test` command needs `-- --coverage` flag, OR add a separate `coverage` turbo task. Vitest fails the process with exit code 1 when thresholds are not met. [CITED: vitest.dev/config/coverage]

### Release Pipeline: npm OIDC Trusted Publishing

**Current state:** `release.yml` uses `changesets/action@v1` with `publish: pnpm run release` and has `id-token: write` permission and `registry-url: 'https://registry.npmjs.org'`. However, there is no `NODE_AUTH_TOKEN` secret and no `--provenance` flag. [VERIFIED: .github/workflows/release.yml]

**npm OIDC trusted publishing (2025):** npm v11.5.1+ supports OIDC without long-lived tokens. When a GitHub Actions workflow has `id-token: write` and the package is configured for trusted publishing on npmjs.com, npm auto-publishes provenance attestations. The `--provenance` flag is no longer needed. [CITED: docs.npmjs.com/trusted-publishers/]

**Changesets + OIDC limitation:** `changesets/action` creates an `.npmrc` file that can interfere with npm's OIDC auto-detection. The recommended workaround is to separate versioning (changesets PR) from publishing (a separate step that runs after the PR is merged). [CITED: github.com/changesets/action/issues/515]

**Recommended release.yml pattern:**

```yaml
# Source: changesets/action OIDC workaround pattern [CITED: github.com/changesets/action/issues/515]
- uses: changesets/action@v1
  id: changesets
  with:
    title: 'chore: version packages'
    commit: 'chore: version packages'
    # No 'publish' param here — let changesets handle only versioning/PR
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
- name: Publish to npm (OIDC)
  if: steps.changesets.outputs.hasChangesets == 'false'
  run: pnpm run release
  env:
    NPM_CONFIG_PROVENANCE: true
```

**Changeset config:** `access: "public"` already set in `.changeset/config.json`. [VERIFIED: .changeset/config.json]

**Prerequisite:** Each package's `package.json` must have `publishConfig.access: "public"` or be scoped public. The `.changeset/config.json` already sets `access: "public"` globally. [VERIFIED]

### VitePress Documentation Site

**Current state:** `docs/` directory has: `index.md` (homepage with hero section), `package.json` with VitePress 1.6.0, no `.vitepress/` config directory yet. [VERIFIED: /repos/nestjs-odata/docs/]

**VitePress 1.6.0 config needed** (`.vitepress/config.ts`):

```typescript
// Source: VitePress docs [CITED: vitepress.dev/guide/deploy]
import { defineConfig } from 'vitepress'
export default defineConfig({
  title: 'nestjs-odata',
  description: 'OData v4 for NestJS',
  base: '/nestjs-odata/', // For GitHub Pages user.github.io/nestjs-odata/
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API Reference', link: '/api/' },
    ],
    sidebar: {
      '/guide/': [
        /* ... */
      ],
      '/api/': [
        /* ... */
      ],
    },
  },
})
```

**GitHub Pages deploy workflow** (`.github/workflows/docs.yml`):

```yaml
# Source: VitePress official deploy guide [CITED: vitepress.dev/guide/deploy]
name: Deploy VitePress site to Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - uses: actions/configure-pages@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run docs:build # turbo task
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**turbo.json already has** `docs:build` task defined. [VERIFIED: /repos/nestjs-odata/turbo.json]

---

## Don't Hand-Roll

| Problem                         | Don't Build                    | Use Instead                               | Why                                                                               |
| ------------------------------- | ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Changeset transactions          | Custom transaction coordinator | TypeORM `QueryRunner`                     | Already provides startTransaction/rollback/release/commit with connection pooling |
| Coverage provider               | Custom coverage collector      | `@vitest/coverage-v8`                     | Native V8 coverage — zero instrumentation overhead                                |
| MIME boundary generation        | Random string generator        | `crypto.randomUUID()` (Node built-in)     | UUID is a valid MIME boundary token, no deps needed                               |
| HTTP response building in batch | Custom HTTP serializer         | Template literal with known OData headers | OData batch responses have fixed format; no framework needed                      |
| Package quality checks          | Custom export validation       | `publint` + `@arethetypeswrong/cli`       | These tools know every edge case in ESM+CJS dual exports                          |
| npm token rotation              | Long-lived token in secrets    | npm OIDC trusted publishing               | No token ever stored; auto-renewed by GitHub Actions                              |

---

## Common Pitfalls

### Pitfall 1: Batch Boundary in Content-Type vs. Body Mismatch

**What goes wrong:** Parser uses hardcoded or wrong boundary string — `--batch_foo` in body but Content-Type says `boundary=batch_bar`.
**Why it happens:** Boundary is generated per-request by the client and announced in Content-Type; must be read from the header, not assumed.
**How to avoid:** Always extract boundary from the `Content-Type` header of the incoming POST /$batch request.
**Warning signs:** "No parts found" or "boundary not matched" errors.

### Pitfall 2: CRLF/LF Boundary Splitting

**What goes wrong:** Splitting by `--<boundary>` finds no matches on Windows-style bodies or certain HTTP clients that use `\r\n`.
**Why it happens:** RFC 2046 specifies CRLF-prefixed boundaries, but real-world bodies vary.
**How to avoid:** Split by both `\r\n--<boundary>` and `\n--<boundary>`. Alternatively, normalize the body to LF before parsing.
**Warning signs:** Batch parser returns zero parts even when body is non-empty.

### Pitfall 3: QueryRunner Not Released on Error

**What goes wrong:** Connection pool exhaustion after repeated failed batch requests.
**Why it happens:** If `rollbackTransaction()` throws, the `release()` call in `finally` still must execute.
**How to avoid:** Always call `queryRunner.release()` in a `finally` block. [CITED: typeorm.io/docs/advanced-topics/transactions/]
**Warning signs:** New DB connections fail after a certain number of batch requests; connection pool limit hit.

### Pitfall 4: TypeOrmAutoHandler Repo vs. QueryRunner.manager

**What goes wrong:** Changeset operations use `TypeOrmAutoHandler.handleCreate()` which calls `this.repo.save()`. This bypasses the `QueryRunner` transaction — the operation commits immediately outside the transaction.
**Why it happens:** `Repository.save()` opens its own connection by default.
**How to avoid:** For changeset operations, use `queryRunner.manager.save(entity)` directly, NOT the `TypeOrmAutoHandler` instance. The batch handler must either inline the create/update/delete logic or accept a `queryRunner.manager` override parameter.
**Warning signs:** Changeset rollback does not revert previously executed operations.

### Pitfall 5: maxTop Rejection Breaks Existing Tests

**What goes wrong:** Changing clamp to reject in `ODataQueryPipe` breaks any tests that send `$top` above `maxTop` expecting the clamped result.
**Why it happens:** Phase 3/4 test-app may use a low `maxTop` default with high `$top` values in tests.
**How to avoid:** Audit all existing tests for `$top` values before changing the pipe behavior. Update test-app `maxTop` config or adjust test $top values.
**Warning signs:** Existing integration tests start returning 400 after the pipe change.

### Pitfall 6: Per-Entity Config Leaking Across Entity Sets

**What goes wrong:** Product entity's `maxTop: 500` also applies to Category entity because the override lookup is keyed incorrectly.
**Why it happens:** Entity set name vs. entity type name confusion; both must be considered.
**How to avoid:** Key the per-entity security options map by entity set name (the same key used in `ODataQueryPipe` via `metadata.data`).
**Warning signs:** Security tests show wrong entity getting the override.

### Pitfall 7: VitePress `base` Misconfiguration for GitHub Pages

**What goes wrong:** All internal links and assets 404 on GitHub Pages because the site is served from `user.github.io/nestjs-odata/` but `base` is not set.
**Why it happens:** GitHub Pages for non-root repos uses a subdirectory path.
**How to avoid:** Set `base: '/nestjs-odata/'` in `.vitepress/config.ts`.
**Warning signs:** Homepage loads but navigation links are broken.

### Pitfall 8: changesets/action Writing .npmrc Blocks OIDC

**What goes wrong:** npm publish fails with authentication errors even though `id-token: write` is set.
**Why it happens:** `changesets/action` writes a `.npmrc` that specifies `//registry.npmjs.org/:_authToken=undefined`, interfering with OIDC token exchange.
**How to avoid:** Use the separate versioning/publishing workflow pattern (do not pass `publish` to changesets/action; run `pnpm release` as a separate conditional step). [CITED: github.com/changesets/action/issues/515]
**Warning signs:** "npm error code ENEEDAUTH" in release job despite OIDC being configured.

---

## Code Examples

### TypeORM QueryRunner Changeset Transaction

```typescript
// Source: TypeORM 0.3.x docs [CITED: typeorm.io/docs/advanced-topics/transactions/]
const queryRunner = dataSource.createQueryRunner()
await queryRunner.connect()
await queryRunner.startTransaction()
try {
  // Use queryRunner.manager, NOT repo.save() — repo.save() bypasses the transaction
  const result1 = await queryRunner.manager.save(EntityClass, data1)
  const result2 = await queryRunner.manager.save(EntityClass, data2)
  await queryRunner.commitTransaction()
  return [result1, result2]
} catch (err) {
  await queryRunner.rollbackTransaction()
  throw err // Re-throw for batch error response assembly
} finally {
  await queryRunner.release() // Always release — even if commit/rollback throws
}
```

### Vitest Coverage Thresholds

```typescript
// Source: Vitest 3.x docs [CITED: vitest.dev/config/coverage]
// vitest.config.ts (both packages/core and packages/typeorm)
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
```

### maxTop Rejection in ODataQueryPipe

```typescript
// Source: packages/core/src/query/odata-query.pipe.ts (change lines 53-56) [VERIFIED]
// Replace clamp with rejection:
if (top !== undefined && top > this.options.maxTop) {
  throw new ODataValidationError(
    `$top value ${top} exceeds maximum of ${this.options.maxTop}`,
    entitySetName,
    '$top',
  )
}
```

### Multipart Boundary Extraction

```typescript
// Source: RFC 2046 MIME spec [ASSUMED: implementation pattern]
function extractBoundary(contentType: string): string {
  const match = /;\s*boundary=([^;]+)/i.exec(contentType)
  if (!match?.[1]) throw new Error('Missing boundary parameter in Content-Type')
  return match[1].trim().replace(/^["']|["']$/g, '')
}
```

---

## Runtime State Inventory

> Phase 5 is not a rename/refactor phase. No runtime state migration required.

None — this is a greenfield feature addition phase. No stored keys, service configs, or OS-registered state uses names that change.

---

## Environment Availability

| Dependency             | Required By                | Available                                | Version                                           | Fallback             |
| ---------------------- | -------------------------- | ---------------------------------------- | ------------------------------------------------- | -------------------- |
| Node.js                | All builds and tests       | Yes (CI: 24, local varies)               | 24 in CI                                          | —                    |
| pnpm                   | Package management         | Yes                                      | 10 in CI [VERIFIED: .github/workflows/ci.yml]     | —                    |
| better-sqlite3         | Test-app integration tests | Yes (dev dep)                            | ^12.8.0 [VERIFIED: packages/typeorm/package.json] | —                    |
| @vitest/coverage-v8    | Coverage enforcement       | Not installed                            | —                                                 | Install in Wave 0    |
| npm trusted publishing | OIDC publish               | Requires npm package config on npmjs.com | n/a                                               | Manual token publish |

**Missing dependencies with no fallback:**

- `@vitest/coverage-v8` is not installed — must be added as devDependency in Wave 0 before coverage tasks run.

**Missing dependencies with fallback:**

- npm trusted publishing (OIDC) — if not configured on npmjs.com, the release can fall back to `NODE_AUTH_TOKEN` secret, but D-10 explicitly requires OIDC.

---

## Validation Architecture

### Test Framework

| Property           | Value                                                             |
| ------------------ | ----------------------------------------------------------------- |
| Framework          | Vitest ^3.2.0 with unplugin-swc                                   |
| Config file        | packages/core/vitest.config.ts, packages/typeorm/vitest.config.ts |
| Quick run command  | `pnpm --filter @nestjs-odata/core test`                           |
| Full suite command | `pnpm turbo test -- --coverage`                                   |

### Phase Requirements → Test Map

| Req ID   | Behavior                                           | Test Type   | Automated Command                                                   | File Exists?                |
| -------- | -------------------------------------------------- | ----------- | ------------------------------------------------------------------- | --------------------------- |
| BATCH-01 | POST /$batch parses multipart/mixed body           | unit        | `vitest run packages/typeorm/src/batch/batch-parser.spec.ts`        | ❌ Wave 0                   |
| BATCH-02 | Changeset failure rolls back all operations        | integration | `vitest run apps/test-app/test/batch.e2e-spec.ts`                   | ❌ Wave 0                   |
| BATCH-03 | Independent request failure does not affect others | integration | `vitest run apps/test-app/test/batch.e2e-spec.ts`                   | ❌ Wave 0                   |
| SEC-01   | $top > maxTop returns 400 OData error              | unit        | `vitest run packages/core/src/query/odata-query.pipe.spec.ts`       | ✅ (needs new test cases)   |
| SEC-02   | $expand depth > maxExpandDepth returns 400         | unit        | `vitest run packages/typeorm/src/translator/expand-visitor.spec.ts` | ✅ (needs per-entity tests) |
| SEC-03   | No SQL interpolation in filter queries             | unit        | `vitest run packages/typeorm/src/translator/filter-visitor.spec.ts` | ✅ (verify existing)        |
| SEC-04   | Deep filter nesting > maxFilterDepth returns 400   | unit        | `vitest run packages/typeorm/src/translator/filter-visitor.spec.ts` | ✅ (needs new test cases)   |

### Wave 0 Gaps

- [ ] `packages/typeorm/src/batch/batch-parser.spec.ts` — covers BATCH-01 multipart parsing
- [ ] `packages/typeorm/src/batch/batch-controller.spec.ts` — covers BATCH-01, BATCH-02, BATCH-03
- [ ] `apps/test-app/test/batch.e2e-spec.ts` — covers BATCH-02, BATCH-03 integration
- [ ] `@vitest/coverage-v8` devDependency in both packages — enables threshold enforcement (D-14)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                             |
| --------------------- | ------- | ---------------------------------------------------------------------------- |
| V2 Authentication     | No      | N/A — library delegates to NestJS Guards                                     |
| V3 Session Management | No      | N/A — stateless OData protocol                                               |
| V4 Access Control     | No      | N/A — delegate to NestJS Guards                                              |
| V5 Input Validation   | Yes     | ODataQueryPipe (maxTop, maxExpandDepth, maxFilterDepth) — throw on violation |
| V6 Cryptography       | No      | N/A — no encryption in this phase                                            |

### Known Threat Patterns for OData Batch + Security Limits

| Pattern                                                | STRIDE    | Standard Mitigation                                                             |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------- |
| Oversized $top causing full table scans                | DoS       | maxTop rejection with 400 (D-05)                                                |
| Deep $expand chains causing N-level JOINs              | DoS       | maxExpandDepth rejection (D-09)                                                 |
| Exponentially deep filter expressions                  | DoS       | maxFilterDepth tracking in FilterVisitor (SEC-04)                               |
| Malformed multipart body causing parser hang           | DoS       | Max body size limit (NestJS built-in body parser limit) + timeout in parser     |
| Large batch (1000 operations) consuming DB connections | DoS       | Optional $batch operation count limit (Claude's discretion)                     |
| SQL injection via batch sub-request body               | Tampering | Already mitigated — FilterVisitor uses parameterized queries (SEC-03, verified) |
| Batch changeset referencing unauthorized entity sets   | Elevation | Validate entity set names against EdmRegistry before dispatch                   |

---

## Assumptions Log

| #   | Claim                                                              | Section                 | Risk if Wrong                                                                                         |
| --- | ------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| A1  | `@vitest/coverage-v8` version follows vitest major (^3.x)          | Standard Stack          | Wrong version may break coverage collection; check npm before installing                              |
| A2  | Batch parser can use `crypto.randomUUID()` for boundary generation | Don't Hand-Roll         | UUID contains hyphens which are valid in MIME boundaries per RFC 2046 — verify with a test client     |
| A3  | Default `maxFilterDepth: 10` is appropriate                        | Architecture Patterns   | Too low = rejects legitimate complex filters; too high = allows DoS. Adjust if needed                 |
| A4  | In-memory slicing for $expand pagination is acceptable for v1      | Architecture Patterns   | For very large related collections (>10k), this may be slow. Acceptable for v1 scope                  |
| A5  | Per-entity security map keyed by entity set name is correct        | Architecture Patterns   | Entity set name matches `metadata.data` in pipe; verify via ODataQueryPipe transform                  |
| A6  | changesets/action + separate publish step avoids OIDC interference | Release Pipeline        | May need custom fork if separate step still inherits the .npmrc. Verify during release setup          |
| A7  | Vitest `-- --coverage` flag propagates through turbo pipeline      | Validation Architecture | Turbo may not pass extra flags to nested commands; check turbo docs or add a separate `coverage` task |

---

## Open Questions (RESOLVED)

1. **How to share QueryRunner with TypeOrmAutoHandler for changeset operations**
   - What we know: `TypeOrmAutoHandler` uses `this.repo.save()` which bypasses `QueryRunner`
   - What's unclear: Should batch handler inline the logic (copy-paste risk), or refactor `TypeOrmAutoHandler` to accept an optional `EntityManager` parameter?
   - Recommendation: Refactor `handleCreate/handleUpdate/handleDelete` to accept an optional `EntityManager` as a third parameter, defaulting to `this.repo.manager`. This avoids duplication.
   - **RESOLVED:** Use option (a) — private dispatchCreate/Update/Delete methods with queryRunner.manager directly (per 05-01 Task 2 action).

2. **$batch size limit**
   - What we know: Context.md lists this as Claude's discretion
   - What's unclear: What is a reasonable default? (50? 100? unlimited?)
   - Recommendation: Default to 100 operations per batch. Configurable via `ODataModuleOptions.maxBatchSize`. No spec requirement — this is a DoS protection measure.
   - **RESOLVED:** Default 100 per T-05-02 threat model in Plan 05-01.

3. **VitePress .vitepress/config.ts — does it exist?**
   - What we know: `docs/` only has `index.md`, `package.json`, and `node_modules/`. No `.vitepress/` directory found.
   - What's unclear: Does VitePress run without a config file (it should, with defaults)?
   - Recommendation: Create `.vitepress/config.ts` as part of Wave 0. VitePress 1.x requires it for sidebar/nav config.
   - **RESOLVED:** Created in Plan 05-04 Task 1 action step 1.

4. **Does the existing release.yml already satisfy D-10 or does it need changes?**
   - What we know: `release.yml` has `id-token: write`, uses `changesets/action@v1` with `publish: pnpm run release`. Missing: `NPM_CONFIG_PROVENANCE: true` env var; OIDC trusted publishing requires npm package registration on npmjs.com.
   - What's unclear: Whether the package is already registered on npmjs.com for trusted publishing.
   - Recommendation: Update release.yml to use the separate versioning/publishing pattern. Add `NPM_CONFIG_PROVENANCE: true`. Document that npmjs.com trusted publisher setup requires a human step outside CI.
   - **RESOLVED:** Updated in Plan 05-03 Task 2 with NPM_CONFIG_PROVENANCE pattern.

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: packages/core/src/query/odata-query.pipe.ts] — Confirmed maxTop clamp behavior at lines 53-56
- [VERIFIED: packages/typeorm/src/translator/expand-visitor.ts] — Confirmed maxExpandDepth enforcement; $top/$skip deferred comment at lines 90-91
- [VERIFIED: packages/typeorm/src/translator/filter-visitor.ts] — Confirmed parameterized query implementation
- [VERIFIED: packages/typeorm/src/translator/typeorm-auto-handler.ts] — All CRUD handler methods confirmed
- [VERIFIED: packages/core/src/odata.module.ts] — forRoot/forFeature module pattern confirmed
- [VERIFIED: packages/typeorm/src/odata-typeorm.module.ts] — DataSource injection points confirmed (lines 102, 124)
- [VERIFIED: .github/workflows/ci.yml] — publint + @arethetypeswrong/cli already in CI
- [VERIFIED: .github/workflows/release.yml] — Changesets action structure confirmed; OIDC partially configured
- [VERIFIED: .changeset/config.json] — access: "public" confirmed
- [VERIFIED: packages/core/vitest.config.ts, packages/typeorm/vitest.config.ts] — Coverage reporters set, no thresholds yet
- [VERIFIED: .planning/phases/04-crud-expand-and-module-system/04-VERIFICATION.md] — expand-pagination.ts gap documented
- [VERIFIED: turbo.json] — docs:build task defined
- [CITED: docs.oasis-open.org/odata/odata/v4.01] — OData v4.01 batch spec section 11
- [CITED: olingo.apache.org/doc/odata4/tutorials/batch/tutorial_batch.html] — Batch wire format examples
- [CITED: typeorm.io/docs/advanced-topics/transactions/] — QueryRunner transaction pattern
- [CITED: vitest.dev/config/coverage] — Coverage threshold configuration
- [CITED: vitepress.dev/guide/deploy] — VitePress GitHub Pages workflow

### Secondary (MEDIUM confidence)

- [CITED: docs.npmjs.com/trusted-publishers/] — npm OIDC trusted publishing requirements
- [CITED: github.com/changesets/action/issues/515] — Changesets + OIDC workaround pattern

### Tertiary (LOW confidence)

- Exact query complexity scoring formula for SEC-04 — pattern is standard but default thresholds (maxFilterDepth: 10) are assumed

---

## Metadata

**Confidence breakdown:**

- $batch wire format: HIGH — cited from OASIS spec and Apache Olingo tutorial
- TypeORM QueryRunner pattern: HIGH — cited from TypeORM official docs
- Security limit changes: HIGH — verified against existing code; changes are minimal and targeted
- Per-entity config design: MEDIUM — interface design is assumed; base pattern is verified from existing module code
- Release pipeline (OIDC): MEDIUM — npm OIDC is GA; changesets workaround is documented in the official issue tracker
- VitePress deploy: HIGH — cited from official VitePress deploy docs
- Coverage thresholds: HIGH — cited from Vitest v3 docs

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable libraries; VitePress and changesets APIs unlikely to change)
