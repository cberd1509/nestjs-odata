# Phase 1: Foundation and Parser Spike - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Monorepo scaffolding with Turborepo + pnpm, full OSS tooling (ESLint, Husky, Changesets, CI/CD, GitHub templates), OData v4 expert sub-agent, and a query parser spike that validates the custom recursive descent parser against the OASIS ABNF grammar. The parser spike goes beyond minimal validation — it covers $filter, $orderby, $select, $top/$skip to establish a solid foundation for Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Parser Strategy

- **D-01:** Build a custom recursive descent parser from the OASIS OData v4 ABNF grammar. No external parser dependencies. Full control over correctness and maintenance.
- **D-02:** Parser scope in Phase 1 is spike + foundation: implement `$filter` (comparison, logical, arithmetic, string functions, collection functions), `$orderby`, `$select`, `$top`, `$skip`. This covers ~80% of the query grammar so Phase 3 builds on solid ground rather than starting from scratch.
- **D-03:** Parser lives inside `@nestjs-odata/core` (not a separate package). It's foundational — everything depends on it.
- **D-04:** AST design uses TypeScript discriminated unions with a visitor interface. Unions are idiomatic TS with exhaustive switch matching; the visitor interface allows contributors to add new node types without modifying existing code. Optimized for extensibility and contributor-friendliness.

### Monorepo Structure

- **D-05:** Standard Turborepo layout: `packages/core`, `packages/typeorm`, `apps/test-app`, `packages/eslint-config`, `docs/` (VitePress). Scaffolded using Turborepo CLI and NestJS CLI respectively — never manually.
- **D-06:** Test app uses e-commerce domain entities: Product, Category, Order, OrderItem, Customer, Tag. Covers all TypeORM relation types (ManyToOne, OneToMany, ManyToMany) and common OData patterns (filtering, sorting, expand, composite keys, navigation properties).
- **D-07:** Use pnpm for all package management. Never npm or yarn.

### OSS Tooling

- **D-08:** ESLint 9 flat config with shared `@repo/eslint-config` package. No overrides — research recommendations accepted as-is.
- **D-09:** Husky v9 + lint-staged for pre-commit hooks. Commitlint with conventional commits.
- **D-10:** Changesets for release management — automatic semver and changelog generation on merge.
- **D-11:** GitHub Actions: `ci.yml` (lint, test, build on PR), `release.yml` (Changesets publish with OIDC provenance), `codeql.yml` (security scanning).
- **D-12:** npm OIDC trusted publishing — no long-lived NPM_TOKEN secrets.
- **D-13:** `@arethetypeswrong/cli` + `publint` in CI to validate package exports from day one.
- **D-14:** Dependabot + CodeQL configured from day one.
- **D-15:** npm scope is `@nestjs-odata`. Packages: `@nestjs-odata/core`, `@nestjs-odata/typeorm`.

### OData Sub-Agent

- **D-16:** Full expert agent — deep knowledge of OData v4 spec (types, query options, CSDL, error format), implementation patterns for TypeScript/NestJS, AND ability to review code for OData compliance.
- **D-17:** Agent sources from both OASIS OData v4 specification documents AND odata.org tutorials/best practices. Use Playwright MCP for crawling the spec site.
- **D-18:** Agent is created as a Claude Code agent definition file that can be referenced by all subsequent phases.

### Testing

- **D-19:** SQLite in-memory for all integration tests. Zero setup, fast CI, no Docker required. TypeORM supports it natively.
- **D-20:** Vitest + unplugin-swc for test runner (required for NestJS/TypeORM decorator metadata).
- **D-21:** TDD approach — parser tests written first against OASIS ABNF expected outputs.

### Claude's Discretion

- Monorepo internal structure details (tsconfig paths, turbo.json pipeline config)
- Governance level (CONTRIBUTING.md, PR process, issue labels) — pick appropriate level for a new OSS library
- Exact ESLint rules and Prettier config
- tsdown build configuration details
- VitePress docs site structure and theme

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OData v4 Specification

- `https://www.odata.org/` — OData v4 main site (tutorials, best practices)
- `https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html` — OData v4.01 Protocol
- `https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html` — URL Conventions (ABNF grammar for query options)
- `https://docs.oasis-open.org/odata/odata/v4.01/cs01/abnf/odata-abnf-construction-rules.txt` — OASIS ABNF grammar file

### Project Research

- `.planning/research/STACK.md` — Technology stack decisions and rationale
- `.planning/research/FEATURES.md` — OData v4 feature landscape (table stakes, differentiators)
- `.planning/research/ARCHITECTURE.md` — Component boundaries, data flow, build order
- `.planning/research/PITFALLS.md` — Common OData implementation mistakes to avoid
- `.planning/research/OSS-TOOLING.md` — NestJS ecosystem OSS tooling patterns
- `.planning/research/OSS-MODERN-EXAMPLES.md` — Modern TypeScript OSS repo comparison matrix

### NestJS Ecosystem Reference

- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — v1 requirements with REQ-IDs (SCAF-01 through SCAF-11 for this phase)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- None — greenfield project, empty repo

### Established Patterns

- None yet — this phase establishes all patterns

### Integration Points

- Turborepo CLI creates the base workspace
- NestJS CLI creates the test-app
- All packages must integrate via pnpm workspace protocol

</code_context>

<specifics>
## Specific Ideas

- Parser should feel like a first-class TypeScript library — discriminated unions, exhaustive matching, well-typed visitor interface
- The project is meant to attract contributors and forks — extensibility and code organization matter from day one
- Test entities follow e-commerce domain (Product, Category, Order, OrderItem, Customer, Tag) for realistic OData testing
- Playwright MCP available for crawling OData spec when building the sub-agent

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 01-foundation-and-parser-spike_
_Context gathered: 2026-04-07_
