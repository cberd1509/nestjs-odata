# Milestones

## v1.0 MVP (Shipped: 2026-04-08)

**Phases completed:** 6 phases, 25 plans, 34 tasks

**Key accomplishments:**

- 1. [Rule 1 - Bug] better-sqlite3 v9 incompatible with Node.js v24
- One-liner:
- One-liner:
- RED phase:
- One-liner:
- One-liner:
- Task 1: Type Mapper + Pluralizer (TDD)
- One-liner:
- One-liner:
- `TypeOrmFilterVisitor`
- 1. [Rule 1 - Bug] Vitest done() callback deprecated in Vitest 3
- `TypeOrmAutoHandler`
- $expand AST types (ExpandNode/ExpandItem) with recursive nested option parsing, plus a typed OData parenthetical key parser utility
- Five composite NestJS decorators (@ODataPost, @ODataPatch, @ODataDelete, @ODataGetByKey, @ODataController) with interceptor extended to handle single-entity responses and POST Location headers
- TypeOrmExpandVisitor (recursive JOINs), four CRUD methods on TypeOrmAutoHandler, and $expand validation in ODataQueryPipe — 348 total tests passing
- ODataModule.forRoot() now patches PATH_METADATA for @ODataController classes with the serviceRoot prefix synchronously at module registration time, per D-17
- End-to-end validation of Phase 4 CRUD, $expand, and route isolation: 34 e2e tests pass across CRUD operations, $expand with TypeORM JOINs, and non-OData route isolation
- 1. [Rule 1 - Bug] Double segment in splitByBoundary
- maxTop violations now return HTTP 400 with per-entity override support, filter depth enforced at 10 levels by default, and $expand $top/$skip works via post-JOIN in-memory slicing
- 80% coverage thresholds enforced via @vitest/coverage-v8 and CI pipeline finalized with npm OIDC provenance publishing triggered on merged changesets PRs
- Site configuration
- Task 1 — Fix package.json exports for both packages
- One-liner:
- Problem:

---
