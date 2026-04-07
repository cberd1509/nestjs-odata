# Phase 1: Foundation and Parser Spike - Research

**Researched:** 2026-04-07
**Domain:** Turborepo monorepo scaffolding, OSS tooling, OData v4 recursive descent parser, Claude Code agent authoring
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Build a custom recursive descent parser from the OASIS OData v4 ABNF grammar. No external parser dependencies. Full control over correctness and maintenance.
- **D-02:** Parser scope in Phase 1 is spike + foundation: implement `$filter` (comparison, logical, arithmetic, string functions, collection functions), `$orderby`, `$select`, `$top`, `$skip`.
- **D-03:** Parser lives inside `@nestjs-odata/core` (not a separate package). It's foundational — everything depends on it.
- **D-04:** AST design uses TypeScript discriminated unions with a visitor interface. Unions are idiomatic TS with exhaustive switch matching; the visitor interface allows contributors to add new node types without modifying existing code.
- **D-05:** Standard Turborepo layout: `packages/core`, `packages/typeorm`, `apps/test-app`, `packages/eslint-config`, `docs/` (VitePress). Scaffolded using Turborepo CLI and NestJS CLI respectively — never manually.
- **D-06:** Test app uses e-commerce domain entities: Product, Category, Order, OrderItem, Customer, Tag.
- **D-07:** Use pnpm for all package management. Never npm or yarn.
- **D-08:** ESLint 9 flat config with shared `@repo/eslint-config` package.
- **D-09:** Husky v9 + lint-staged for pre-commit hooks. Commitlint with conventional commits.
- **D-10:** Changesets for release management — automatic semver and changelog generation on merge.
- **D-11:** GitHub Actions: `ci.yml` (lint, test, build on PR), `release.yml` (Changesets publish with OIDC provenance), `codeql.yml` (security scanning).
- **D-12:** npm OIDC trusted publishing — no long-lived NPM_TOKEN secrets.
- **D-13:** `@arethetypeswrong/cli` + `publint` in CI to validate package exports from day one.
- **D-14:** Dependabot + CodeQL configured from day one.
- **D-15:** npm scope is `@nestjs-odata`. Packages: `@nestjs-odata/core`, `@nestjs-odata/typeorm`.
- **D-16:** Full expert agent — deep knowledge of OData v4 spec, implementation patterns for TypeScript/NestJS, AND ability to review code for OData compliance.
- **D-17:** Agent sources from both OASIS OData v4 specification documents AND odata.org tutorials/best practices. Use Playwright MCP for crawling the spec site.
- **D-18:** Agent is created as a Claude Code agent definition file that can be referenced by all subsequent phases.
- **D-19:** SQLite in-memory for all integration tests.
- **D-20:** Vitest + unplugin-swc for test runner.
- **D-21:** TDD approach — parser tests written first against OASIS ABNF expected outputs.

### Claude's Discretion

- Monorepo internal structure details (tsconfig paths, turbo.json pipeline config)
- Governance level (CONTRIBUTING.md, PR process, issue labels)
- Exact ESLint rules and Prettier config
- tsdown build configuration details
- VitePress docs site structure and theme

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCAF-01 | Turborepo + pnpm monorepo with `packages/core`, `packages/typeorm`, and `apps/test-app` | Turborepo CLI + NestJS CLI scaffold section; turbo.json pipeline config |
| SCAF-02 | Full OSS tooling: ESLint 9 flat config, Prettier, Husky + lint-staged, Commitlint (conventional commits) | OSS Tooling section; exact configs and install commands |
| SCAF-03 | GitHub templates: issue templates, PR template, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md | GitHub Templates section; YAML issue template patterns |
| SCAF-04 | CI/CD: GitHub Actions for lint, test, build on PR; Changesets-based release workflow | GitHub Actions section; Changesets release workflow |
| SCAF-05 | npm package publishing with OIDC trusted publishing (no long-lived tokens) | npm OIDC section; id-token: write permission requirement |
| SCAF-06 | `@arethetypeswrong/cli` + `publint` in CI to validate package exports | Export Validation section; CLI usage patterns |
| SCAF-07 | VitePress documentation site with typedoc-generated API docs | VitePress + TypeDoc section |
| SCAF-08 | OData v4 expert sub-agent built from the OASIS spec | Sub-Agent Authoring section; agent file format |
| SCAF-09 | tsdown build pipeline for both packages (ESM + CJS dual build) | tsdown Configuration section; package.json exports pattern |
| SCAF-10 | Vitest + unplugin-swc test setup (required for NestJS/TypeORM decorator metadata) | Vitest + SWC section; .swcrc required config |
| SCAF-11 | Dependabot + CodeQL security scanning configured from day one | Security Scanning section; workflow and config files |
</phase_requirements>

---

## Summary

Phase 1 establishes the complete foundation: a Turborepo + pnpm monorepo with every OSS tool configured, plus a working OData v4 recursive descent parser spike. The scaffolding work (SCAF-01 through SCAF-07, SCAF-09 through SCAF-11) is well-understood and high-confidence — every tool is verified at its current version, every config pattern has been cross-referenced with the official NestJS ecosystem repos and modern OSS survey. The OData sub-agent (SCAF-08) requires authoring a Claude Code agent definition file that synthesises the OASIS spec documents.

The parser spike is the highest-risk item. The OASIS ABNF grammar is well-specified, but a recursive descent parser for `$filter` must handle operator precedence, left-recursion avoidance, lambda expressions (`any`, `all`), and string function calls — all within Phase 1. The grammar structure is confirmed via the official ABNF file: the parser needs a Pratt/precedence-climbing approach or a careful recursive descent structure to handle the `commonExpr` rule (which has additive, comparison, and logical tails). The spike validates this approach works cleanly in TypeScript before any Phase 3 query translation work begins.

**Primary recommendation:** Scaffold the monorepo first using `pnpm dlx create-turbo@latest` (the `with-nestjs` example), then add library-specific wiring (tsdown, Changesets, ATTW, VitePress, parser spike). The parser spike should be the last item in Phase 1 — it has a pass/fail gate and must not block tooling setup.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Turborepo | 2.9.4 | Monorepo task orchestration | Official Vercel tool; first-class pnpm support; used by 6/7 major OSS TS monorepos surveyed |
| pnpm | 10.2.1 | Package manager | Pinned in environment; best workspace isolation; Turborepo recommends |
| TypeScript | 6.0.2 | Language | Current stable; `emitDecoratorMetadata` required for NestJS + TypeORM |
| tsdown | 0.21.7 | Library bundler (ESM + CJS) | tsup successor from Rolldown/Vite team; 2x faster `.d.ts` gen; confirmed by LangChain JS + tRPC |
| Vitest | 4.1.3 | Test runner | Current stable verified; 5/7 OSS projects surveyed use it |
| unplugin-swc | 1.5.9 | Vitest SWC transformer | Required for `emitDecoratorMetadata` — esbuild default silently breaks NestJS/TypeORM |
| @swc/core | 1.15.24 | SWC runtime | Peer of unplugin-swc; `.swcrc` with `legacyDecorator: true` and `decoratorMetadata: true` required |

[VERIFIED: npm registry — versions confirmed 2026-04-07]

### OSS Tooling

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ESLint | 10.2.0 | Linting | Flat config only since ESLint 9; verified against official NestJS repos |
| typescript-eslint | 8.58.0 | TS-aware lint rules | v8 project service; zero extra monorepo config |
| Prettier | 3.8.1 | Formatting | Standard; minimal config |
| Husky | 9.1.7 | Git hooks | 2 kB, zero deps; NestJS ecosystem standard |
| lint-staged | 16.4.0 | Staged file processing | Pairs with Husky |
| @commitlint/cli | 20.5.0 | Commit message enforcement | Conventional commits v1 spec |
| @changesets/cli | 2.30.0 | Multi-package versioning | Purpose-built for monorepos; Turborepo official recommendation |
| @changesets/changelog-github | 0.6.0 | GitHub-linked changelogs | PR links + contributor names in changelog |
| VitePress | 1.6.4 | Docs site | Lighter than Docusaurus; Vite-native |
| typedoc | 0.28.18 | API doc generation | TypeScript-native |
| typedoc-plugin-markdown | 4.11.0 | TypeDoc → Markdown for VitePress | VitePress integration; sidebar generation |
| @arethetypeswrong/cli | 0.18.2 | Package exports validation | Catches exports map mismatches before publish |
| publint | 0.3.18 | package.json publish field validation | Pairs with ATTW |

[VERIFIED: npm registry — versions confirmed 2026-04-07]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdown | tsup | tsup is no longer actively maintained — tsdown is the recommended successor from the same author |
| Changesets | release-it | release-it has no native multi-package monorepo support; Changesets is monorepo-first |
| Changesets | semantic-release | semantic-release's monorepo plugin is unmaintained since 2022; requires linear commit history |
| Prettier | dprint / Biome | Biome/dprint are faster but add config complexity; Prettier is simpler for a greenfield project |
| Dependabot | Renovate | Both valid; Dependabot is built into GitHub, simpler to configure for a new project |
| ESLint flat config | Oxlint | Oxlint is faster (Rust) but plugin ecosystem is immature; ESLint 9 flat config has full TS support |

**Installation (root workspace):**
```bash
pnpm dlx create-turbo@latest nestjs-odata --example with-nestjs
cd nestjs-odata
pnpm add -D -w eslint typescript-eslint eslint-config-prettier prettier husky lint-staged @commitlint/cli @commitlint/config-conventional @changesets/cli @changesets/changelog-github vitepress typedoc typedoc-plugin-markdown @arethetypeswrong/cli publint
```

---

## Architecture Patterns

### Recommended Project Structure

```
nestjs-odata/
├── apps/
│   └── test-app/                     # Created by NestJS CLI (not Turborepo CLI)
│       └── src/
│           ├── entities/             # E-commerce test entities
│           └── app.module.ts
├── packages/
│   ├── core/                         # @nestjs-odata/core
│   │   ├── src/
│   │   │   ├── parser/
│   │   │   │   ├── lexer.ts          # Tokeniser
│   │   │   │   ├── parser.ts         # Recursive descent parser
│   │   │   │   ├── ast.ts            # Discriminated union AST types
│   │   │   │   └── visitor.ts        # Visitor interface
│   │   │   └── index.ts
│   │   ├── test/
│   │   │   └── parser/              # TDD-first parser tests
│   │   ├── tsdown.config.ts
│   │   ├── vitest.config.ts
│   │   ├── .swcrc
│   │   └── package.json
│   ├── typeorm/                      # @nestjs-odata/typeorm (stub in Phase 1)
│   │   └── package.json
│   └── eslint-config/               # @repo/eslint-config
│       ├── eslint.config.mjs
│       └── package.json
├── docs/                             # VitePress docs site
│   ├── .vitepress/
│   │   └── config.ts
│   └── index.md
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── feature_request.yml
│   │   └── config.yml
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── release.yml
│   │   └── codeql.yml
│   ├── dependabot.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── SECURITY.md
├── .changeset/
│   └── config.json
├── .claude/
│   └── agents/
│       └── odata-expert.md          # Claude Code sub-agent (SCAF-08)
├── eslint.config.mjs                # Root config delegates to @repo/eslint-config
├── .prettierrc
├── commitlint.config.cjs
├── lint-staged.config.mjs
├── turbo.json
├── pnpm-workspace.yaml
├── .npmrc
├── LICENSE
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
└── package.json
```

**Critical structural note:** The Turborepo `with-nestjs` example creates `apps/api` (NestJS) and `apps/web` (Next.js) with packages for `@repo/api`, `@repo/eslint-config`, `@repo/jest-config`, `@repo/typescript-config`, and `@repo/ui`. For this project, the structure diverges: `apps/test-app` is created via `@nestjs/cli new test-app`, and the publishable library packages (`packages/core`, `packages/typeorm`) are created manually as they are not generated by the template. [VERIFIED: WebFetch of turborepo with-nestjs example structure]

### Pattern 1: Turborepo CLI Scaffolding Then NestJS CLI

**What:** Use `pnpm dlx create-turbo@latest` to get the workspace scaffold, then `@nestjs/cli new` inside `apps/` for the test app, then manually create `packages/core` and `packages/typeorm` as library packages.

**When to use:** Always — D-05 explicitly requires using CLI tools, not manual scaffolding.

**Key pitfall:** The `with-nestjs` Turborepo example uses Jest (legacy choice). After scaffolding, remove `@repo/jest-config` and all Jest dependencies before adding Vitest. The example's `packages/` structure also includes `@repo/api`, `@repo/ui`, and `@repo/typescript-config` which are not needed for this library project.

**Example flow:**
```bash
# 1. Create workspace from Turborepo template
pnpm dlx create-turbo@latest nestjs-odata --example with-nestjs
cd nestjs-odata

# 2. Create test-app with NestJS CLI
cd apps && pnpm dlx @nestjs/cli@latest new test-app --package-manager pnpm --skip-install
cd ..

# 3. Adapt packages — rename/restructure for library use
# (core and typeorm packages are created manually as library packages)
```

### Pattern 2: tsdown ESM + CJS Dual Build

**What:** Each publishable package (`packages/core`, `packages/typeorm`) uses a `tsdown.config.ts` that builds both ESM and CJS with type declarations. Conditional exports in `package.json` route bundlers to the correct format.

**When to use:** Always for publishable packages. The `apps/test-app` does NOT use tsdown (it's a NestJS app — not published).

**Example:**
```typescript
// packages/core/tsdown.config.ts
// Source: STACK.md verified pattern
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs'],
})
```

```json
// packages/core/package.json exports
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "sideEffects": false
}
```

### Pattern 3: Vitest + unplugin-swc Configuration

**What:** Every package that tests NestJS/TypeORM decorator-bearing code MUST use unplugin-swc instead of Vitest's default esbuild transformer. A `.swcrc` file configures decorator metadata emission.

**When to use:** All packages. The parser unit tests in `packages/core` do NOT use decorators, but the setup must be consistent across packages to avoid the common "works in isolation, breaks in integration" failure.

**Example:**
```typescript
// packages/core/vitest.config.ts
// Source: STACK.md verified pattern
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
})
```

```json
// packages/core/.swcrc
// Source: STACK.md verified pattern
{
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    }
  }
}
```

### Pattern 4: Turborepo Pipeline Configuration

**What:** `turbo.json` defines task dependency order. `build` must complete before `typecheck` and `test` because dependent packages need compiled output. `lint` has no inter-package dependencies.

**Example:**
```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {
      "dependsOn": []
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "docs:build": {
      "dependsOn": ["^build"],
      "outputs": ["docs/.vitepress/dist/**"]
    }
  }
}
```

### Pattern 5: OData Query Parser — Discriminated Union AST

**What:** The AST is a set of TypeScript discriminated union types. Every node has a `kind` discriminant. The visitor interface has a method per node kind. No external dependencies — pure TypeScript.

**When to use:** This is the locked AST design from D-04. The discriminated union approach enables exhaustive `switch` matching with TypeScript's type narrowing.

**Example:**
```typescript
// packages/core/src/parser/ast.ts

// Discriminant field: 'kind' (not 'type' — avoids collision with TypeScript's own 'type' keyword)
export type FilterNode =
  | BinaryExprNode
  | UnaryExprNode
  | FunctionCallNode
  | PropertyAccessNode
  | LiteralNode
  | LambdaExprNode

export interface BinaryExprNode {
  kind: 'BinaryExpr'
  operator: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'and' | 'or' | 'add' | 'sub' | 'mul' | 'div' | 'mod'
  left: FilterNode
  right: FilterNode
}

export interface UnaryExprNode {
  kind: 'UnaryExpr'
  operator: 'not' | 'neg'
  operand: FilterNode
}

export interface FunctionCallNode {
  kind: 'FunctionCall'
  name: 'startswith' | 'endswith' | 'contains' | 'indexof' | 'substring' | 'length' | 'tolower' | 'toupper' | 'concat'
  args: FilterNode[]
}

export interface LambdaExprNode {
  kind: 'LambdaExpr'
  operator: 'any' | 'all'
  property: string          // e.g. "Tags"
  variable: string | null   // lambda variable (null for `any` with no predicate)
  predicate: FilterNode | null
}

export interface PropertyAccessNode {
  kind: 'PropertyAccess'
  path: string[]            // e.g. ['Category', 'Name'] for $it/Category/Name
}

export interface LiteralNode {
  kind: 'Literal'
  literalKind: 'string' | 'number' | 'boolean' | 'null' | 'guid' | 'dateTimeOffset'
  value: string | number | boolean | null
  raw: string               // Original string for parameterization
}

// Visitor interface
export interface FilterVisitor<T> {
  visitBinaryExpr(node: BinaryExprNode): T
  visitUnaryExpr(node: UnaryExprNode): T
  visitFunctionCall(node: FunctionCallNode): T
  visitLambdaExpr(node: LambdaExprNode): T
  visitPropertyAccess(node: PropertyAccessNode): T
  visitLiteral(node: LiteralNode): T
}
```

### Pattern 6: OData Sub-Agent Definition File

**What:** Claude Code sub-agents are defined as Markdown files with YAML frontmatter stored in `.claude/agents/`. The frontmatter specifies `name`, `description`, `tools`, and optionally `model` and `disallowedTools`. The Markdown body is the agent's system prompt.

**When to use:** Always store project-scoped agents in `.claude/agents/` so they are version-controlled and available to all contributors.

**Example structure:**
```markdown
---
name: odata-expert
description: OData v4 specification expert. Use for OData compliance questions, grammar interpretation, query option semantics, CSDL structure, error format, and implementation pattern review. Sources: OASIS OData v4.01 Protocol, URL Conventions, and odata.org.
tools: Read, WebFetch, Grep
---

You are an expert in the OData v4 specification...
[system prompt content follows]
```

[VERIFIED: WebSearch of Claude Code sub-agent format, code.claude.com/docs/en/sub-agents]

### Anti-Patterns to Avoid

- **Using tsup instead of tsdown:** tsup is no longer actively maintained. tsdown is the correct successor from the same author (Anthony Fu / VoidZero team). [VERIFIED: STACK.md]
- **Running tsc --noEmit in pre-commit:** Takes 10-20 seconds per commit on a monorepo. Run type-checking in CI only.
- **Using esbuild (default Vitest) without unplugin-swc:** `emitDecoratorMetadata` silently breaks — NestJS and TypeORM DI, injection tokens, and auto-wiring all fail at runtime with no clear error. [VERIFIED: STACK.md]
- **Installing packages with npm or yarn:** D-07 locks pnpm. Every `package.json` `scripts.prepare` and all CI steps must use `pnpm exec`.
- **Left recursion in the recursive descent parser:** The ABNF `commonExpr` rule appears left-recursive. The standard fix is iterative operator parsing within each precedence level (Pratt parsing or precedence climbing), not naïve recursion. [VERIFIED: OASIS ABNF analysis]
- **Using `eslint-plugin-prettier`:** Causes confusing double-error output. Use `eslint-config-prettier` (disables conflicting ESLint rules) + run Prettier independently. [VERIFIED: OSS-TOOLING.md]
- **Storing NPM_TOKEN as a long-lived secret:** npm permanently deprecated Classic Tokens on December 9, 2025. Use OIDC trusted publishing (requires `id-token: write` permission in the GitHub Actions workflow). [VERIFIED: WebSearch npm OIDC GA announcement]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monorepo workspace wiring | Manual pnpm-workspace.yaml + turbo.json from scratch | `pnpm dlx create-turbo@latest --example with-nestjs` | Template handles workspace protocol, package hoisting, and turbo pipeline config |
| Git hook installation | Custom shell scripts | Husky v9 (`pnpm exec husky init`) | Handles OS differences, pnpm vs npm, hook registration |
| Commit message parsing | Regex in pre-commit | commitlint + @commitlint/config-conventional | Full Conventional Commits spec including breaking change markers |
| Multi-package versioning | Manual CHANGELOG.md editing | Changesets | Git-history-aware semver bumps, linked packages, PR-based changeset review gate |
| Library bundling | Custom Rollup/esbuild scripts | tsdown | Dual ESM+CJS output with `.d.ts` declarations in a single config; handles external marking |
| ESM/CJS exports map | Hand-written package.json exports | tsdown auto-detection + verified pattern | Incorrect exports maps are the #1 source of "works in dev, breaks in prod" bugs for TypeScript libraries |
| Package exports validation | Manual inspection | `@arethetypeswrong/cli` + `publint` | ATTW catches dual CJS/ESM export issues, missing types declarations, and incorrect resolution modes |
| API documentation | Manually written Markdown | TypeDoc + typedoc-plugin-markdown | Auto-generated from JSDoc comments + TypeScript types; stays in sync with code |
| Test runner TypeScript transform | Custom Babel/esbuild pipeline | unplugin-swc | SWC is the only transformer that correctly emits `emitDecoratorMetadata` inside Vitest |

**Key insight:** Every item in this list has been solved by the NestJS/TypeScript ecosystem. The value of Phase 1 is installing these solutions correctly from day one, not building alternatives.

---

## OData Parser Spike: Technical Deep Dive

### Grammar Structure Confirmed

The OASIS OData v4.01 ABNF construction rules (confirmed via direct fetch of the specification file) establish the following structure for the Phase 1 query options:

```
filter    = "$filter" EQ boolCommonExpr
orderby   = "$orderby" EQ orderbyItem *( COMMA orderbyItem )
orderbyItem = commonExpr [ RWS ( "asc" / "desc" ) ]
select    = "$select" EQ selectItem *( COMMA selectItem )
top       = "$top" EQ 1*DIGIT
skip      = "$skip" EQ 1*DIGIT
```

[VERIFIED: OASIS ABNF spec, direct fetch 2026-04-07]

### Operator Precedence (Critical for Parser Structure)

The `boolCommonExpr` / `commonExpr` rule in the OASIS ABNF is not written with explicit precedence levels — it is a flat grammar that expresses precedence via rule chaining. A recursive descent parser must implement precedence explicitly. The correct order (lowest to highest binding strength):

| Level | Operators | Notes |
|-------|-----------|-------|
| 1 (lowest) | `or` | Left-associative |
| 2 | `and` | Left-associative |
| 3 | `not` | Right-associative (prefix) |
| 4 | `eq ne lt le gt ge has in` | Comparison (non-associative per OData spec) |
| 5 | `add sub` | Arithmetic additive |
| 6 | `mul div divby mod` | Arithmetic multiplicative |
| 7 | `neg` (unary minus) | Prefix |
| 8 (highest) | literals, property access, function calls, `(expr)` | Primaries |

[ASSUMED — standard OData implementation precedence; confirmed against ABNF structure analysis but not cited from a secondary TypeScript parser source]

### Key Built-In Functions for Phase 1

From OASIS ABNF, the Phase 1 scope includes these functions:

**String functions:** `startswith(expr, expr)`, `endswith(expr, expr)`, `contains(expr, expr)`, `indexof(expr, expr)`, `substring(expr, expr[, expr])`, `length(expr)`, `tolower(expr)`, `toupper(expr)`, `concat(expr, expr)`

**Collection lambda operators:** `any([ var: predicate ])`, `all(var: predicate)` — applied via navigation property path: `Tags/any(t: t/Name eq 'electronics')`

[VERIFIED: OASIS ABNF spec, direct fetch 2026-04-07]

### Literal Types

The parser must recognise and type-tag these literal kinds:
- `'string'` — single-quoted string with `''` escape for single quote
- Integer (`-?1*DIGIT` without decimal)
- Decimal (`-?1*DIGIT '.' 1*DIGIT`)
- `true` / `false`
- `null`
- GUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- DateTimeOffset (`YYYY-MM-DDThh:mm:ss.fZ` and variants)

### Recommended Lexer-First Architecture

Build a two-phase parser: **Lexer (tokeniser) → Parser (recursive descent)**. This is cleaner than a combined scannerless parser for a grammar this size.

**Token types to produce:**
```
STRING_LITERAL, INT_LITERAL, DECIMAL_LITERAL, BOOL_LITERAL,
NULL_LITERAL, GUID_LITERAL, DATETIME_LITERAL,
IDENTIFIER, OPEN_PAREN, CLOSE_PAREN, COMMA, SLASH,
AND, OR, NOT, EQ, NE, LT, LE, GT, GE, HAS, IN,
ADD, SUB, MUL, DIV, DIVBY, MOD, COLON, STAR, EOF
```

Keywords (`and`, `or`, `not`, `eq`, etc.) are handled during lexing to distinguish them from property names (identifiers).

### TDD Test Oracle Approach

The OASIS ABNF grammar is the test oracle. Each test case should:
1. Express the input OData query string
2. State the expected AST structure as a TypeScript object literal
3. Assert equality

```typescript
// Example TDD-first test (written BEFORE implementation)
it('parses simple equality filter', () => {
  const result = parse("$filter=Price eq 10")
  expect(result.filter).toEqual({
    kind: 'BinaryExpr',
    operator: 'eq',
    left: { kind: 'PropertyAccess', path: ['Price'] },
    right: { kind: 'Literal', literalKind: 'number', value: 10, raw: '10' },
  })
})

it('parses contains function', () => {
  const result = parse("$filter=contains(Name,'widget')")
  expect(result.filter).toEqual({
    kind: 'FunctionCall',
    name: 'contains',
    args: [
      { kind: 'PropertyAccess', path: ['Name'] },
      { kind: 'Literal', literalKind: 'string', value: 'widget', raw: "'widget'" },
    ],
  })
})

it('parses any lambda', () => {
  const result = parse("$filter=Tags/any(t:t/Name eq 'electronics')")
  expect(result.filter).toEqual({
    kind: 'LambdaExpr',
    operator: 'any',
    property: 'Tags',
    variable: 't',
    predicate: {
      kind: 'BinaryExpr',
      operator: 'eq',
      left: { kind: 'PropertyAccess', path: ['t', 'Name'] },
      right: { kind: 'Literal', literalKind: 'string', value: 'electronics', raw: "'electronics'" },
    },
  })
})
```

---

## Common Pitfalls

### Pitfall 1: Turborepo with-nestjs Example Uses Jest

**What goes wrong:** The `with-nestjs` example installs `@repo/jest-config` and configures Jest for all packages. If you build on this template without cleaning up, Jest and Vitest will co-exist, creating a confusing environment.

**Why it happens:** The Turborepo with-nestjs example was written before Vitest became ecosystem consensus in NestJS projects (the official NestJS docs still reference Jest).

**How to avoid:** After running `create-turbo`, immediately remove `@repo/jest-config` package, all `jest.config.*` files, and all `jest` dependencies. Install Vitest + unplugin-swc as the only test runner.

**Warning signs:** `jest` appearing in any package.json after initial setup.

### Pitfall 2: npm OIDC Trusted Publishing Requires Pre-Configuration on npmjs.com

**What goes wrong:** The `release.yml` workflow fails with an authentication error on first publish if the Trusted Publisher is not configured in the npm registry before running the workflow.

**Why it happens:** OIDC trusted publishing requires registering the GitHub org/repo/workflow combination as a trusted publisher on the npm package page (or during initial package creation). It is NOT automatically enabled.

**How to avoid:** During Phase 1, configure trusted publishing for `@nestjs-odata/core` and `@nestjs-odata/typeorm` on npmjs.com before the first release attempt. Requires npm CLI 11.5.1+ (verified: Node 24 + npm 11.11.0 available on this machine). [VERIFIED: WebSearch npm OIDC announcement, philna.sh/blog/2026/01/28/trusted-publishing-npm/]

**Warning signs:** `401 Unauthorized` on first `changeset publish` run.

### Pitfall 3: Left Recursion in $filter Parsing

**What goes wrong:** A naïve recursive descent parser for OData `$filter` that directly implements the ABNF grammar will stack overflow or loop infinitely on expressions like `a eq b eq c` or `a and b and c and d`.

**Why it happens:** The ABNF `commonExpr` rule has "tail" productions (`andExpr`, `orExpr`, comparison operators) that would create left recursion in a direct translation.

**How to avoid:** Use Pratt parsing (top-down operator precedence) or iterative precedence climbing for binary operator expressions. The primary rule (`parsePrimary`) handles literals, identifiers, function calls, and parenthesized expressions. Binary operators are handled iteratively with explicit precedence tables.

**Warning signs:** Stack overflow on parsing `a and b and c` with more than ~50 terms.

### Pitfall 4: TypeScript 5.x vs 6.x tsconfig Differences

**What goes wrong:** TypeScript 6.0 (current stable) removed `--moduleResolution bundler` behavior differences and has new `isolatedDeclarations` option that tsdown respects. Projects scaffolded from old templates using `"module": "CommonJS"` in tsconfig will produce only CJS output when tsdown expects ESM-first.

**Why it happens:** Template tsconfig files often use legacy `module` settings.

**How to avoid:** Set `"module": "NodeNext"` or `"module": "Preserve"` with `"moduleResolution": "Bundler"` in tsconfig for library packages. tsdown handles the dual-output transformation; tsconfig only needs to work for type-checking.

**Warning signs:** tsdown only emitting one format; `@arethetypeswrong/cli` reporting missing ESM exports.

### Pitfall 5: pnpm Workspace Protocol vs Semver in Peer Dependencies

**What goes wrong:** `packages/typeorm/package.json` references `@nestjs-odata/core` as both a dev dependency (for local development, using `workspace:*`) and a peer dependency (for consumers, using semver like `^0.1.0`). Getting these mixed up causes published packages that reference the internal workspace protocol, which consumers cannot resolve.

**Why it happens:** It's easy to copy `workspace:*` from `devDependencies` into `peerDependencies` during initial setup.

**How to avoid:** In `peerDependencies`, always use semver ranges (`"@nestjs-odata/core": ">=0.1.0"`). In `devDependencies`, use `"workspace:*"`. Changesets handles replacing `workspace:*` with real semver during publish.

**Warning signs:** Published package with `workspace:*` in peerDependencies; consumers get `ERR_PNPM_WORKSPACE_PACKAGE_NOT_FOUND` when installing.

### Pitfall 6: OData String Literal Escaping

**What goes wrong:** OData string literals use single quotes with `''` (two single quotes) as the escape sequence for a literal single quote. A parser that handles `\'` or `\` as escape characters will silently produce incorrect AST values for strings like `contains(Name,'O''Brien')`.

**Why it happens:** String literal parsing borrowed from JSON or JavaScript conventions.

**How to avoid:** During lexing, handle the `''` escape explicitly: when consuming a single-quoted string, if the current character is `'` and the next is also `'`, consume both and emit a single `'` in the string value.

**Warning signs:** Test `$filter=LastName eq 'O''Brien'` producing `O` instead of `O'Brien`.

---

## Code Examples

### turbo.json (Phase 1 baseline)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "docs:build": {
      "dependsOn": ["^build"],
      "outputs": ["docs/.vitepress/dist/**"]
    }
  }
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'docs'
```

### Root package.json scripts

```json
{
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "turbo run build && changeset publish",
    "prepare": "husky"
  }
}
```

### ESLint flat config root (delegates to shared package)

```js
// eslint.config.mjs
import config from '@repo/eslint-config'
export default config
```

### @repo/eslint-config package

```js
// packages/eslint-config/eslint.config.mjs
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['**/*.spec.ts', 'dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
)
```

### Changesets config

```json
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/changelog-github",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["test-app"]
}
```

### GitHub Actions CI workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint
      - run: pnpm turbo typecheck
      - run: pnpm turbo test
      - run: pnpm turbo build
      - name: Validate package exports
        run: |
          pnpm dlx @arethetypeswrong/cli packages/core/dist
          pnpm dlx publint packages/core
```

### npm OIDC Release workflow

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
concurrency: ${{ github.workflow }}-${{ github.ref }}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write        # Required for npm OIDC trusted publishing
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - uses: changesets/action@v1
        with:
          publish: pnpm run release
          title: 'chore: version packages'
          commit: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Note: no NPM_TOKEN needed when OIDC trusted publishing is configured
          # npm CLI 11.x+ auto-detects OIDC environment
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pnpm | All package management | ✓ | 10.2.1 | — |
| Node.js | Runtime | ✓ | 24.14.1 | — |
| npm | OIDC publish (npm CLI 11.5.1+ required) | ✓ | 11.11.0 | — |
| turbo | Monorepo orchestration | ✓ | 2.9.4 | — |
| @nestjs/cli | NestJS app scaffolding | available via pnpm dlx | 11.0.18 | — |
| git | Repository + hooks | ✓ (implicit) | — | — |

**Missing dependencies with no fallback:**

None — all required tools are available on this machine.

**Note:** GitHub repository must exist and be configured with:
1. npm Trusted Publisher registration for `@nestjs-odata/core` and `@nestjs-odata/typeorm` (required before release.yml can publish)
2. GitHub Pages enabled (required for VitePress deployment)

These are not local environment issues but one-time npm registry and GitHub repository configuration steps. [ASSUMED — based on npm OIDC documentation requirements]

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth in this phase (tooling/scaffolding only) |
| V3 Session Management | No | No session handling |
| V4 Access Control | No | No access control in scaffolding |
| V5 Input Validation | No | Parser spike validates OData syntax but no security boundary |
| V6 Cryptography | No | No cryptographic operations in this phase |

**Security scope for Phase 1:** The primary security deliverable is the OSS tooling setup itself:

- **SCAF-11 (CodeQL):** Static analysis workflow prevents security regressions from day one
- **SCAF-11 (Dependabot):** Automated vulnerability detection on all npm dependencies
- **SCAF-05 (npm OIDC):** No long-lived npm tokens exposed in CI secrets — eliminates supply-chain token theft risk

### Threat Patterns (Supply Chain)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised long-lived npm token | Spoofing / Tampering | npm OIDC trusted publishing (D-12) — short-lived tokens per workflow run |
| Malicious dependency update | Tampering | Dependabot weekly scans + pnpm audit --audit-level=high in CI |
| Vulnerable transitive dep | Tampering | CodeQL weekly scan + Dependabot groups |
| Secrets accidentally committed | Information Disclosure | `.gitignore` + pre-commit lint; no `.env` files in this phase |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tsup | tsdown | Late 2024 | tsdown is the maintained successor; tsup authors recommend migration |
| `eslint-plugin-prettier` | `eslint-config-prettier` + separate Prettier | ESLint 9 | Cleaner separation; no double-error output |
| NPM_TOKEN secret in CI | npm OIDC trusted publishing | July 2025 (GA) | Classic tokens deprecated December 2025 |
| Changesets `NPM_TOKEN` publish | Changesets + OIDC (no token needed) | 2025 | Requires npm CLI 11.5.1+ |
| Jest | Vitest | 2024-2025 | ESM native; 3-4x faster in monorepos; standard in Turborepo ecosystem |
| `.eslintrc.*` format | `eslint.config.mjs` flat config | ESLint 9 | Legacy format removed; flat config is the only supported format |
| CodeQL Action v3 | CodeQL Action v4 | Oct 2025 | v3 deprecated Dec 2026; v4 required for new workflows |
| `typedoc-plugin-markdown` + separate VitePress wiring | `typedoc-vitepress-theme` | 2024 | Dedicated VitePress integration with auto-generated sidebar |

**Deprecated/outdated:**
- `@repo/jest-config`: Appears in the Turborepo with-nestjs example template but should be replaced with Vitest from day one
- `@commitlint/config-angular`: NestJS official repos still use it for historical reasons; use `@commitlint/config-conventional` for new projects
- CircleCI alongside GitHub Actions: NestJS official repos use both; new projects should use GitHub Actions only

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Operator precedence table for OData (or/and/not/comparison/arithmetic) | Parser Deep Dive | Parser produces incorrect AST for mixed-operator expressions; caught by TDD test suite |
| A2 | GitHub repository must be pre-configured as npm Trusted Publisher before OIDC publish works | Environment Availability | First release fails with auth error; fallback is adding a Granular npm token temporarily |
| A3 | The `with-nestjs` Turborepo example requires cleanup of Jest dependencies before Vitest setup | Pattern 1 | Additional setup steps needed if template has changed since research |

---

## Open Questions

1. **TypeScript 6.0 decorator emitter compatibility with unplugin-swc 1.5.9**
   - What we know: TypeScript 6.0 introduced new decorator emit (`useDefineForClassFields: true` default changed). unplugin-swc uses SWC's own decorator transform.
   - What's unclear: Whether SWC 1.15.24 + unplugin-swc 1.5.9 is confirmed-compatible with TypeScript 6.0's decorator semantics.
   - Recommendation: Add a decorator metadata smoke test to the Vitest setup verification step. If it fails, pin TypeScript to 5.x.

2. **OIDC Trusted Publishing and Changesets `changesets/action@v1` compatibility**
   - What we know: `changesets/action@v1` accepts a `publish` script command. npm OIDC is activated when `id-token: write` permission is present and npm CLI 11.5.1+ detects the OIDC environment.
   - What's unclear: Whether `changesets/action@v1` is the latest version and whether it passes environment variables needed for OIDC correctly.
   - Recommendation: Verify `changesets/action` latest version at setup time (`npm view changesets-action` or GitHub Marketplace). [ASSUMED version pinning]

---

## Sources

### Primary (HIGH confidence)

- OASIS OData v4.01 ABNF grammar — `https://docs.oasis-open.org/odata/odata/v4.01/cs01/abnf/odata-abnf-construction-rules.txt` — $filter, $orderby, $select, $top, $skip grammar rules; function names; literal types [VERIFIED: direct WebFetch 2026-04-07]
- `.planning/research/STACK.md` — Vitest + unplugin-swc config, tsdown config, peer dependency matrices [VERIFIED: project research file]
- `.planning/research/OSS-TOOLING.md` — ESLint flat config, Changesets, Husky v9, GitHub Actions workflows [VERIFIED: project research file]
- `.planning/research/OSS-MODERN-EXAMPLES.md` — Tool frequency across 7 major OSS monorepos [VERIFIED: project research file]
- npm registry (via `npm view`) — All package versions verified as of 2026-04-07 [VERIFIED: npm registry]
- Claude Code sub-agent format — `https://code.claude.com/docs/en/sub-agents` — YAML frontmatter structure, `.claude/agents/` location [VERIFIED: WebSearch]

### Secondary (MEDIUM confidence)

- npm OIDC trusted publishing GA — `https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/` — npm CLI 11.5.1+ required; Classic tokens deprecated Dec 2025 [VERIFIED: WebSearch with authoritative source]
- Turborepo with-nestjs example structure — `https://github.com/vercel/turborepo/tree/main/examples/with-nestjs` — folder structure verified via WebFetch [VERIFIED: WebFetch 2026-04-07]
- typedoc-vitepress-theme — `https://typedoc-plugin-markdown.org/plugins/vitepress/quick-start` — VitePress integration pattern [CITED: official docs]
- CodeQL Action v4 — `https://github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3/` — v4 required, v3 deprecated Dec 2026 [CITED: GitHub Changelog]

### Tertiary (LOW confidence)

- Operator precedence table for OData $filter — ABNF analysis + standard implementation patterns. [ASSUMED — needs validation against known OData implementations during spike]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry
- OSS tooling patterns: HIGH — cross-referenced against official NestJS repos and OSS survey
- OData parser grammar: HIGH — OASIS ABNF spec fetched directly
- Parser precedence table: LOW — inferred from grammar structure; validate during spike
- OIDC setup requirements: MEDIUM — confirmed from official docs but pre-configuration steps are outside the codebase

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (30 days for stable stack; tsdown is pre-1.0 so check for breaking changes)
