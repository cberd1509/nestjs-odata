# nestjs-odata

## What This Is

An open-source OData v4 library for NestJS, distributed as a Turborepo monorepo with a core package (`@nestjs-odata/core`) and adapter packages (starting with `@nestjs-odata/typeorm`). It lets NestJS developers expose spec-compliant OData endpoints with minimal boilerplate — auto-deriving the EDM from existing ORM entities — while remaining flexible enough for enterprise consumers who need full OData v4 compliance.

## Core Value

OData query power with zero double-declaration: define your entities once in TypeORM, and the OData layer (EDM, $metadata, query translation, CRUD, batch) derives automatically — while mixing cleanly with regular NestJS routes.

## Requirements

### Validated

- [x] Turborepo monorepo with core package, TypeORM adapter, and test NestJS app — Validated in Phases 1-5
- [x] Auto-derive OData EDM from TypeORM entity metadata — Validated in Phase 2
- [x] `$metadata` endpoint auto-generated from registered entities — Validated in Phase 2
- [x] `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count` query support — Validated in Phase 3
- [x] OData v4 response envelope and error format — Validated in Phase 3
- [x] `$expand` query support for navigation properties — Validated in Phase 4
- [x] OData-compliant CRUD operations (POST, PATCH, DELETE) — Validated in Phase 4
- [x] `ODataModule.forRoot()` / `forFeature()` registration — Validated in Phase 4
- [x] Flexible API surface: `@ODataController()` + `@ODataGet()`/`@ODataPost()` decorators — Validated in Phase 4
- [x] `$batch` request support for multi-operation requests — Validated in Phase 5
- [x] TDD approach with comprehensive tests — Validated in Phase 5 (80%+ coverage enforced)

- [x] OData and non-OData routes mix seamlessly — Validated in Phase 4 (route isolation tests)
- [x] OData expert sub-agent built from the OASIS spec — Validated in Phase 6 (5/6 spec questions passed)
- [x] Security: maxTop, expand depth, filter depth, parameterized queries — Validated in Phases 5-6
- [x] Package exports pass publint + @arethetypeswrong/cli — Validated in Phase 5

### Active

(v1.0 shipped — next milestone requirements TBD via `/gsd-new-milestone`)

### Out of Scope

- OData v2/v3 support — v4 only for now (folder structure should allow future version packages)
- Prisma adapter — architecture supports it, but not in v1
- Sequelize adapter — same as Prisma
- Authentication/authorization — users wire their own NestJS guards
- GraphQL bridge — different paradigm, not a goal
- Client-side OData SDK — server-side library only

## Context

### Current State (v1.0 shipped)

- 9,350 lines TypeScript source + 9,365 lines test code
- 568 tests passing (243 core + 173 typeorm + 152 e2e)
- 90%+ code coverage on both packages
- Tech stack: NestJS 11, TypeScript 5.7, TypeORM 0.3, Turborepo 2, pnpm 9, Vitest 3, tsdown 0.21

### Background

- The creator has deep experience with OData in .NET and finds entity registration, relationship declaration, $metadata reliability, and route mixing to be the biggest pain points. This library solves all of them.
- TypeORM's rich metadata (via `reflect-metadata` and decorators) is the key enabler for auto-deriving the EDM — no double declaration needed.
- NestJS module system (`forRoot`/`forFeature`) provides the natural registration pattern.
- Monorepo structure (Turborepo) with `packages/core` (parser, EDM, decorators, module) and `packages/typeorm` (TypeORM-specific query translation and EDM derivation) plus `apps/test-app` (NestJS app for integration testing).

### Known Limitations (v1.0)

- Lambda expressions (`any`/`all`) parsed but not translated to SQL
- Date/time functions parsed but not translated
- `$search`, `$apply` (aggregation) not implemented
- No PUT (full replace) — only PATCH
- No deep inserts (nested entity creation)
- `$expand` pagination is in-memory post-JOIN (not SQL subquery)

## Constraints

- **Tech stack**: NestJS, TypeScript, Turborepo, TypeORM (for adapter)
- **Spec compliance**: OData v4 (OASIS standard) — responses must pass OData validation
- **Package architecture**: Core must have zero ORM dependencies; adapters import core as a peer
- **Version strategy**: Folder/package structure must accommodate future OData versions without breaking changes
- **Testing**: TDD mandatory — unit tests for parsing/EDM, integration tests for HTTP endpoints against the spec
- **Open source**: MIT license, clean API docs, contributor-friendly setup

## Key Decisions

| Decision                           | Rationale                                                                        | Outcome    |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| Turborepo monorepo                 | Separate core from ORM adapters for independent distribution                     | ✓ Good     |
| Auto-derive EDM from TypeORM       | Eliminates the #1 pain point from .NET OData (double declaration)                | ✓ Good     |
| Both controller + decorator API    | Flexibility to mix OData and non-OData routes — solving the .NET mixing pain     | ✓ Good     |
| TDD from day one                   | OData spec is well-defined, tests can be written against expected behavior first | ✓ Good     |
| OData v4 only                      | Focus on current standard; folder structure allows future version packages       | ✓ Good     |
| Dedicated OData sub-agent          | Deep spec knowledge for implementation guidance and doc lookup                   | ✓ Good     |
| Custom parser over odata-v4-parser | Abandoned 8yr-old package; custom parser gives full control over AST             | ✓ Good     |
| tsdown over tsup                   | tsup unmaintained; tsdown is the successor from the Rolldown/Vite team           | ✓ Good     |
| In-memory expand pagination        | $top/$skip on $expand sliced post-JOIN in memory (simpler than subqueries)       | ⚠️ Revisit |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-04-07 after v1.0 milestone_
