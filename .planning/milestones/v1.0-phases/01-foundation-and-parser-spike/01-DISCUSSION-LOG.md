# Phase 1: Foundation and Parser Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 01-foundation-and-parser-spike
**Areas discussed:** Parser Strategy, Monorepo Structure, OSS Tooling, OData Sub-Agent, Database for Tests, npm Scope/Naming, Governance

---

## Parser Strategy

### Parser Approach

| Option             | Description                                                                        | Selected |
| ------------------ | ---------------------------------------------------------------------------------- | -------- |
| Custom from ABNF   | Build from OASIS ABNF grammar. Full control, correctness, no dead dependency risk. | ✓        |
| Fork @odata/parser | Fork Soontao's maintained fork. Head start but inherit tech debt.                  |          |
| Hybrid approach    | Use @odata/parser as test oracle, build own parser.                                |          |

**User's choice:** Custom from ABNF
**Notes:** Highest initial effort but correct long-term. No external dependency risk.

### Parser Scope

| Option                 | Description                                                          | Selected |
| ---------------------- | -------------------------------------------------------------------- | -------- |
| Spike + foundation     | Parse $filter, $orderby, $select, $top/$skip. Covers 80% of grammar. | ✓        |
| Minimal spike only     | Just $filter. Enough to prove it works.                              |          |
| Full parser in Phase 1 | Complete parser now.                                                 |          |

**User's choice:** Spike + foundation
**Notes:** Builds solid ground for Phase 3.

### Parser Location

| Option           | Description                                               | Selected |
| ---------------- | --------------------------------------------------------- | -------- |
| Inside core      | Part of @nestjs-odata/core. Simpler dependency graph.     | ✓        |
| Separate package | Standalone @nestjs-odata/parser. Reusable outside NestJS. |          |

**User's choice:** Inside core

### AST Design

| Option               | Description                                             | Selected         |
| -------------------- | ------------------------------------------------------- | ---------------- |
| Discriminated unions | Typed unions with `type` discriminant. Idiomatic TS.    | ✓ (with visitor) |
| Class hierarchy      | OOP-style AST with visitor pattern via method dispatch. |                  |

**User's choice:** Discriminated unions + visitor interface for extensibility
**Notes:** User emphasized this should be organized for contributors and forks.

---

## Monorepo Structure

### Layout

| Option                | Description                                    | Selected |
| --------------------- | ---------------------------------------------- | -------- |
| Standard Turborepo    | packages/core, packages/typeorm, apps/test-app | ✓        |
| With shared types pkg | Same + packages/common for shared types        |          |

**User's choice:** You decide → Claude chose standard layout
**Notes:** No need for shared types package; core exports the interfaces.

### Test App Entities

| Option         | Description                                        | Selected |
| -------------- | -------------------------------------------------- | -------- |
| E-commerce     | Product, Category, Order, OrderItem, Customer, Tag | ✓        |
| Minimal (Blog) | Post, Author, Comment                              |          |

**User's choice:** E-commerce
**Notes:** Covers all relation types: ManyToOne, OneToMany, ManyToMany.

---

## OSS Tooling

| Option                       | Description                             | Selected |
| ---------------------------- | --------------------------------------- | -------- |
| All research recommendations | ESLint 9, Husky, Changesets, full CI/CD | ✓        |
| Override some choices        | User picks alternatives                 |          |

**User's choice:** All good, no overrides

---

## OData Sub-Agent

### Agent Depth

| Option                    | Description                                        | Selected |
| ------------------------- | -------------------------------------------------- | -------- |
| Full expert               | Spec + patterns + code review for OData compliance | ✓        |
| Spec reference + patterns | Deep spec knowledge + implementation guidance      |          |
| Spec reference only       | Just answers "what does the spec say?"             |          |

**User's choice:** Full expert

### Agent Sources

| Option                 | Description                                    | Selected |
| ---------------------- | ---------------------------------------------- | -------- |
| OASIS spec + odata.org | Both formal spec and tutorials/best practices  | ✓        |
| OASIS spec only        | Formal specification as single source of truth |          |

**User's choice:** OASIS spec + odata.org
**Notes:** Playwright MCP available for crawling.

---

## Database for Tests

| Option           | Description                               | Selected |
| ---------------- | ----------------------------------------- | -------- |
| SQLite in-memory | Zero setup, fast, CI-friendly             | ✓        |
| PostgreSQL       | Production-realistic, needs Docker        |          |
| Both             | SQLite for fast, Postgres for integration |          |

**User's choice:** SQLite in-memory

---

## npm Scope/Naming

| Option        | Description                               | Selected |
| ------------- | ----------------------------------------- | -------- |
| @nestjs-odata | @nestjs-odata/core, @nestjs-odata/typeorm | ✓        |
| @odata-nestjs | OData-first naming                        |          |
| Unscoped      | No scope                                  |          |

**User's choice:** @nestjs-odata

---

## Governance

| Option      | Description                             | Selected |
| ----------- | --------------------------------------- | -------- |
| Lightweight | CONTRIBUTING.md, PR template, basic CoC |          |
| Structured  | Full governance with RFC process        |          |
| You decide  | Claude picks appropriate level          | ✓        |

**User's choice:** You decide

## Claude's Discretion

- Monorepo internal structure details
- Governance level
- ESLint/Prettier config specifics
- tsdown build config
- VitePress docs structure

## Deferred Ideas

None
