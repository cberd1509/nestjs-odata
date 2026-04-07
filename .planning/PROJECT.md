# nestjs-odata

## What This Is

An open-source OData v4 library for NestJS, distributed as a Turborepo monorepo with a core package (`@nestjs-odata/core`) and adapter packages (starting with `@nestjs-odata/typeorm`). It lets NestJS developers expose spec-compliant OData endpoints with minimal boilerplate — auto-deriving the EDM from existing ORM entities — while remaining flexible enough for enterprise consumers who need full OData v4 compliance.

## Core Value

OData query power with zero double-declaration: define your entities once in TypeORM, and the OData layer (EDM, $metadata, query translation, CRUD, batch) derives automatically — while mixing cleanly with regular NestJS routes.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Turborepo monorepo with core package, TypeORM adapter, and test NestJS app
- [ ] Flexible API surface: high-level `@ODataController()` for auto-CRUD + low-level `@ODataGet()`/`@ODataPost()` decorators for custom routes
- [ ] OData and non-OData routes mix seamlessly on the same controller or module — no routing conflicts, no serialization leaking
- [ ] `ODataModule.forRoot()` / `forFeature()` registration following NestJS conventions
- [ ] Auto-derive OData EDM (Entity Data Model) from TypeORM entity metadata (columns, relations, types)
- [ ] `$filter` query support with full OData v4 filter expression parsing
- [ ] `$select` query support for field projection
- [ ] `$expand` query support for related entity expansion (navigation properties)
- [ ] `$orderby` query support for sorting
- [ ] `$top`, `$skip`, `$count` query support for pagination
- [ ] `$metadata` endpoint auto-generated from registered entities — always reflects reality
- [ ] OData-compliant CRUD operations (POST, PATCH, DELETE) with proper response formats
- [ ] `$batch` request support for multi-operation requests
- [ ] OData v4 error response format
- [ ] OData v4 response envelope (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`)
- [ ] TDD approach: comprehensive unit tests and integration tests against the OData spec
- [ ] OData expert sub-agent built from the OData v4 specification

### Out of Scope

- OData v2/v3 support — v4 only for now (folder structure should allow future version packages)
- Prisma adapter — architecture supports it, but not in v1
- Sequelize adapter — same as Prisma
- Authentication/authorization — users wire their own NestJS guards
- GraphQL bridge — different paradigm, not a goal
- Client-side OData SDK — server-side library only

## Context

- The creator has deep experience with OData in .NET and finds entity registration, relationship declaration, $metadata reliability, and route mixing to be the biggest pain points. This library should solve all of them.
- TypeORM's rich metadata (via `reflect-metadata` and decorators) is the key enabler for auto-deriving the EDM — no double declaration needed.
- NestJS module system (`forRoot`/`forFeature`) provides the natural registration pattern.
- The OData v4 spec at https://www.odata.org/ is the source of truth. A dedicated sub-agent should be created that deeply understands the spec and can reference it for implementation tasks.
- The project follows a TDD methodology — since the OData spec is well-defined, tests can be written first against expected behavior.
- Monorepo structure (Turborepo) with `packages/core` (parser, EDM, decorators, module) and `packages/typeorm` (TypeORM-specific query translation and EDM derivation) plus `apps/test-app` (NestJS app for integration testing).

## Constraints

- **Tech stack**: NestJS, TypeScript, Turborepo, TypeORM (for adapter)
- **Spec compliance**: OData v4 (OASIS standard) — responses must pass OData validation
- **Package architecture**: Core must have zero ORM dependencies; adapters import core as a peer
- **Version strategy**: Folder/package structure must accommodate future OData versions without breaking changes
- **Testing**: TDD mandatory — unit tests for parsing/EDM, integration tests for HTTP endpoints against the spec
- **Open source**: MIT license, clean API docs, contributor-friendly setup

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Turborepo monorepo | Separate core from ORM adapters for independent distribution | — Pending |
| Auto-derive EDM from TypeORM | Eliminates the #1 pain point from .NET OData (double declaration) | — Pending |
| Both controller + decorator API | Flexibility to mix OData and non-OData routes — solving the .NET mixing pain | — Pending |
| TDD from day one | OData spec is well-defined, tests can be written against expected behavior first | — Pending |
| OData v4 only | Focus on current standard; folder structure allows future version packages | — Pending |
| Dedicated OData sub-agent | Deep spec knowledge for implementation guidance and doc lookup | — Pending |

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
*Last updated: 2026-04-07 after initialization*
