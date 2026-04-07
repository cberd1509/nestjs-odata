---
phase: "01"
plan: "01"
subsystem: "monorepo-scaffold"
tags: [turborepo, pnpm, tsdown, vitest, swc, typeorm, scaffold]
dependency_graph:
  requires: []
  provides:
    - "pnpm workspace with packages/core, packages/typeorm, apps/test-app"
    - "tsdown ESM+CJS dual build for @nestjs-odata/core and @nestjs-odata/typeorm"
    - "Vitest + unplugin-swc test infrastructure with decorator metadata support"
    - "6 TypeORM e-commerce test entities with full relation coverage"
  affects:
    - "All subsequent plans — every plan builds on this foundation"
tech_stack:
  added:
    - "Turborepo 2.9.4"
    - "pnpm 10.2.1"
    - "tsdown 0.21.7"
    - "Vitest 3.2.4"
    - "unplugin-swc 1.5.9"
    - "@swc/core 1.15.24"
    - "TypeScript 5.9.3"
    - "TypeORM 0.3.28"
    - "better-sqlite3 12.8.0"
  patterns:
    - "tsdown defineConfig with ESM+CJS dual format and external peer deps"
    - "Vitest + swc.vite() plugin for decorator metadata support"
    - ".swcrc with legacyDecorator and decoratorMetadata enabled"
    - "pnpm.onlyBuiltDependencies for native module build approvals"
key_files:
  created:
    - "package.json — root workspace with turbo scripts and onlyBuiltDependencies"
    - "pnpm-workspace.yaml — packages/* and apps/* globs"
    - "turbo.json — build/test/lint/typecheck tasks with dependsOn"
    - "tsconfig.json — root TypeScript config with experimentalDecorators + emitDecoratorMetadata"
    - ".npmrc — shamefully-hoist=false"
    - "packages/core/package.json — @nestjs-odata/core with exports map"
    - "packages/core/tsdown.config.ts — ESM+CJS dual build config"
    - "packages/core/vitest.config.ts — Vitest with SWC plugin"
    - "packages/core/.swcrc — decorator metadata config"
    - "packages/core/src/index.ts — VERSION placeholder export"
    - "packages/core/test/smoke.test.ts — passing smoke test"
    - "packages/typeorm/package.json — @nestjs-odata/typeorm with workspace:* dep on core"
    - "packages/typeorm/tsdown.config.ts — ESM+CJS dual build config"
    - "packages/typeorm/vitest.config.ts — Vitest with SWC plugin"
    - "packages/typeorm/.swcrc — decorator metadata config"
    - "packages/typeorm/src/index.ts — VERSION placeholder export"
    - "apps/test-app/package.json — NestJS integration test app"
    - "apps/test-app/tsconfig.json — strictPropertyInitialization=false for TypeORM entities"
    - "apps/test-app/vitest.config.ts — Vitest with SWC plugin"
    - "apps/test-app/.swcrc — decorator metadata config"
    - "apps/test-app/src/entities/product.entity.ts — ManyToOne(Category), OneToMany(OrderItem), ManyToMany(Tag)"
    - "apps/test-app/src/entities/category.entity.ts — OneToMany(Product)"
    - "apps/test-app/src/entities/customer.entity.ts — OneToMany(Order)"
    - "apps/test-app/src/entities/order.entity.ts — ManyToOne(Customer), OneToMany(OrderItem)"
    - "apps/test-app/src/entities/order-item.entity.ts — ManyToOne(Order), ManyToOne(Product)"
    - "apps/test-app/src/entities/tag.entity.ts — ManyToMany(Product)"
    - "apps/test-app/src/entities/index.ts — barrel export"
    - "LICENSE — MIT, nestjs-odata contributors"
decisions:
  - "Used better-sqlite3@12.8.0 instead of @9.6.0 — Node.js v24 requires v12+ for native compilation"
  - "Added strictPropertyInitialization=false to apps/test-app tsconfig — TypeORM entity properties cannot be initialized in constructors"
  - "Added --passWithNoTests to vitest run for packages without tests yet (typeorm, test-app) — prevents false failures"
  - "Used pnpm.onlyBuiltDependencies in root package.json to approve native module builds (@swc/core, better-sqlite3, esbuild)"
metrics:
  duration_seconds: 558
  completed_date: "2026-04-07"
  tasks_total: 2
  tasks_completed: 2
  files_created: 28
  files_modified: 0
---

# Phase 01 Plan 01: Monorepo Scaffold and Test Infrastructure Summary

Turborepo + pnpm monorepo scaffolded with tsdown ESM+CJS dual build for both library packages and Vitest + unplugin-swc test infrastructure supporting TypeORM/NestJS decorator metadata. Six e-commerce TypeORM entities cover all relation types needed for subsequent phases.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Scaffold Turborepo monorepo | 6f3b0ee | package.json, pnpm-workspace.yaml, turbo.json, packages/core, packages/typeorm, apps/test-app |
| 2 | Configure Vitest + unplugin-swc + entities | df16d49 | vitest.config.ts (x3), .swcrc (x3), 6 entity files, smoke test |
| - | Fix: strictPropertyInitialization | 619d149 | apps/test-app/tsconfig.json |

## Verification

- `pnpm install` exits 0 — all workspace packages linked, better-sqlite3 native build succeeded
- `pnpm build` exits 0 — packages/core and packages/typeorm each produce `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.mts`, `dist/index.d.cts`
- `pnpm test` exits 0 — 5/5 turbo tasks pass; smoke test in packages/core verifies VERSION export
- `grep typeorm packages/core/package.json` — no matches in dependencies or peerDependencies (PKG-01 compliant)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] better-sqlite3 v9 incompatible with Node.js v24**
- **Found during:** Task 1, pnpm install
- **Issue:** `better-sqlite3@9.6.0` fails to compile with Node.js v24 (`cppgc/macros.h` errors, undeclared `requires` identifier). Node 24 requires better-sqlite3 v12+.
- **Fix:** Updated to `better-sqlite3@^12.8.0` in both packages/typeorm and apps/test-app.
- **Files modified:** `packages/typeorm/package.json`, `apps/test-app/package.json`, `pnpm-lock.yaml`
- **Commit:** df16d49

**2. [Rule 1 - Bug] TypeScript TS2564 errors on TypeORM entity properties**
- **Found during:** Task 2, pnpm build
- **Issue:** Root tsconfig has `strict: true` which enables `strictPropertyInitialization`. TypeORM entities cannot initialize decorated properties in constructors — this is standard TypeORM practice.
- **Fix:** Added `"strictPropertyInitialization": false` to apps/test-app/tsconfig.json. Library packages (core, typeorm) are unaffected since they contain no entity classes.
- **Files modified:** `apps/test-app/tsconfig.json`
- **Commit:** 619d149

**3. [Rule 1 - Bug] Vitest exits code 1 when no test files found**
- **Found during:** Task 2, pnpm test
- **Issue:** packages/typeorm and apps/test-app have no test files at this stage. Vitest exits with code 1 when no tests are found, causing turbo test to fail.
- **Fix:** Added `--passWithNoTests` flag to test scripts in both packages. packages/core's smoke test still runs normally.
- **Files modified:** `packages/typeorm/package.json`, `apps/test-app/package.json`
- **Commit:** df16d49

## Known Stubs

| File | Stub | Reason |
|------|------|--------|
| `packages/core/src/index.ts` | `export const VERSION = '0.0.1'` | Placeholder — real exports (parser, decorators, module) added in plans 02-03 |
| `packages/typeorm/src/index.ts` | `export const VERSION = '0.0.1'` | Placeholder — real exports (TypeORM adapter) added in plan 04+ |
| `apps/test-app/src/main.ts` | Minimal stub with comment | test-app is for integration testing, no real app bootstrap needed |

These stubs are intentional scaffolding — each will be replaced as the corresponding feature plans execute.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan is pure build tooling — no runtime security surface.

## Self-Check: PASSED

- packages/core/dist/index.mjs: FOUND
- packages/core/dist/index.cjs: FOUND
- packages/typeorm/dist/index.mjs: FOUND
- packages/typeorm/dist/index.cjs: FOUND
- apps/test-app/src/entities/product.entity.ts: FOUND
- packages/core/test/smoke.test.ts: FOUND
- Commit 6f3b0ee: FOUND
- Commit df16d49: FOUND
- Commit 619d149: FOUND
