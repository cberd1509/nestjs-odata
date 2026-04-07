# Stack Research

**Domain:** Open-source NestJS library (Turborepo monorepo, published to npm)
**Researched:** 2026-04-07
**Confidence:** MEDIUM-HIGH (core stack HIGH; OData parser decision MEDIUM due to ecosystem fragmentation)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| NestJS | ^11.1.17 | Application framework (peer dep) | Current stable; Express v5 default; required Node 20+. Library targets NestJS consumers so this is a peer dependency, not a direct dep. |
| TypeScript | ^5.7 | Language | Required for `emitDecoratorMetadata` + `experimentalDecorators`, which TypeORM and NestJS DI depend on. |
| TypeORM | ^0.3.28 | ORM integration (peer dep in adapter) | Only in `@nestjs-odata/typeorm`. Latest stable 0.3.x. Provides the rich metadata reflection that makes auto-EDM derivation possible. |
| Turborepo | ^2.x | Monorepo build orchestration | Official Vercel-backed tool; first-class pnpm support; build caching; `turbo.json` per-package pipelines. The with-nestjs example is maintained in the official repo. |
| pnpm | ^9.x | Package manager | Best workspace support for monorepos; hoisting control keeps peer dep isolation clean; faster installs than npm/yarn. Standard choice for Turborepo repos in 2025. |

### Build Tooling

| Tool | Version | Purpose | Why Recommended |
|------|---------|---------|-----------------|
| tsdown | ^0.21.x | Library bundler (packages/core, packages/typeorm) | Spiritual successor to tsup; powered by Rolldown (Rust-based). ESM-first; 2x faster than tsup for standard builds, up to 8x faster for `.d.ts` generation; API-compatible with tsup config. tsup is no longer actively maintained. |
| tsc | ^5.7 | Type checking (CI + pre-publish) | tsdown handles bundling, but running `tsc --noEmit` separately in CI gives clean type error output. Do not use tsc as the primary bundler — it is too slow and requires manual output wiring. |
| reflect-metadata | ^0.2.2 | Decorator metadata polyfill | Required by NestJS and TypeORM decorators. Import once at the app entry; must be a peer dep of `@nestjs-odata/core`. |

### Testing Framework

| Tool | Version | Purpose | Why Recommended |
|------|---------|---------|-----------------|
| Vitest | ^3.x | Unit + integration test runner | 2025 standard for TypeScript monorepos in the pnpm/Turborepo ecosystem. Native ESM; workspace-aware; per-package caching works cleanly with `turbo test`. Significantly faster than Jest (CI: 15 min → 4 min in real-world migrations). |
| unplugin-swc | ^1.x | Vitest SWC plugin | NestJS + TypeORM rely on `emitDecoratorMetadata`, which esbuild (Vitest's default transformer) does not support. This plugin swaps in SWC as the transformer inside Vitest — the only reliable approach for decorator metadata in Vitest. |
| @swc/core | ^1.x | SWC runtime for unplugin-swc | Peer of unplugin-swc. Requires `.swcrc` with `legacyDecorator: true` and `decoratorMetadata: true`. |
| supertest | ^7.x | HTTP integration testing | For testing actual HTTP endpoints in the `apps/test-app` integration suite. Standard in NestJS projects. |

### OData Parsing

This is the most fragmented part of the ecosystem. The situation as of 2026:

| Package | Weekly Downloads | Last Publish | Status | Verdict |
|---------|-----------------|-------------|--------|---------|
| `odata-v4-parser` (jaystack) | ~23,000 | 8 years ago | Abandoned | Do NOT use — unmaintained, uses TSLint, no releases ever published |
| `@odata/parser` (Soontao) | ~1,300 | Active (< 1 yr) | Fork of jaystack, maintained | Usable but low adoption |
| `odata-filter-parser` | — | — | Partial V4 support | Only filter expressions, not full query |

**Recommendation: Write the parser internally.** The ecosystem has no production-grade, actively maintained, full-coverage OData v4 parser for TypeScript. The jaystack library (highest downloads at 23k/week) is 8 years stale. `@odata/parser` is a maintained fork but has only 1,300 weekly downloads and 22 stars — not a dependency you want your library's correctness to rest on.

The OData v4 ABNF grammar is well-specified by OASIS. Building a parser for the query options (`$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip`, `$count`) that this library needs is a bounded, testable problem. Use the OASIS grammar as the test oracle. Reference `@odata/parser` source for grammar patterns but own the implementation.

**Confidence: MEDIUM** — the decision to build vs. borrow is the highest-risk call in this stack. Validate early in Phase 1 by spiking the $filter parser.

### Code Quality

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| ESLint | ^9.x | Linting | Use flat config (`eslint.config.mjs`). Shared `@repo/eslint-config` package in `packages/` following Turborepo convention. ESLint 9 flat config eliminates per-package `.eslintrc` complexity in monorepos. |
| typescript-eslint | ^8.x | TypeScript-aware linting | v8's "project service" requires zero extra monorepo config — just works. |
| Prettier | ^3.x | Formatting | Single root `.prettierrc` shared across all packages. No per-package config needed. |

---

## Package Architecture

```
packages/
  core/              → @nestjs-odata/core
  typeorm/           → @nestjs-odata/typeorm
apps/
  test-app/          → NestJS app used for integration tests only (never published)
```

**`@nestjs-odata/core` peer dependencies:**
```json
{
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.2.0"
  }
}
```

**`@nestjs-odata/typeorm` peer dependencies:**
```json
{
  "peerDependencies": {
    "@nestjs-odata/core": "workspace:*",
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "typeorm": "^0.3.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0"
  }
}
```

Core must have zero ORM dependencies. TypeORM is only referenced in the adapter package.

---

## tsdown Configuration Pattern

```typescript
// packages/core/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs'],
})
```

Use `package.json` conditional exports:

```json
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
  "types": "./dist/index.d.ts"
}
```

---

## Vitest Configuration Pattern

```typescript
// packages/core/vitest.config.ts
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
  },
})
```

Required `.swcrc` in each package root:
```json
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

---

## Installation

```bash
# Root workspace tools
pnpm add -D turborepo typescript prettier eslint @eslint/js typescript-eslint -w

# Per-package: build
pnpm add -D tsdown --filter @nestjs-odata/core
pnpm add -D tsdown --filter @nestjs-odata/typeorm

# Per-package: testing
pnpm add -D vitest unplugin-swc @swc/core supertest @types/supertest --filter @nestjs-odata/core
pnpm add -D vitest unplugin-swc @swc/core --filter @nestjs-odata/typeorm

# test-app (integration)
pnpm add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs typeorm --filter test-app
pnpm add -D vitest unplugin-swc @swc/core supertest @types/supertest --filter test-app
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| tsdown | tsup | tsup is no longer actively maintained; tsdown is the official successor from the Rolldown/Vite team |
| tsdown | tsc only | tsc is slow and requires manual dual-format (ESM+CJS) wiring; no tree-shaking |
| tsdown | Rollup directly | High config overhead; tsdown sits on top of Rolldown and gives you the same output with zero config |
| Vitest | Jest | Jest requires more setup for ESM; slower; Vitest is the standard in pnpm/Turborepo monorepos as of 2025 |
| Vitest | Jest | NestJS still documents Jest but the community has migrated; Turborepo has first-class Vitest docs |
| Custom parser | odata-v4-parser | Abandoned 8 years ago; TSLint; no releases |
| Custom parser | @odata/parser | 1,300 weekly downloads, 22 stars — too low adoption for a correctness-critical dependency |
| pnpm | npm/yarn | Better workspace isolation; faster; Turborepo recommends pnpm |
| NestJS 11 | NestJS 10 | NestJS 11 is current stable (Jan 2025); Express v5 default; no reason to target older version |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| tsup | No longer actively maintained; creators recommend migrating to tsdown | tsdown |
| odata-v4-parser (jaystack) | Last published 8 years ago; uses TSLint; 0 releases; abandoned | Custom parser or @odata/parser as reference only |
| esbuild alone (in Vitest) | Does not support `emitDecoratorMetadata` — NestJS and TypeORM decorators silently break | unplugin-swc inside Vitest |
| `tsc` as primary bundler | Slow; doesn't tree-shake; complex dual-format setup | tsdown |
| `@nestjs/typeorm` as a direct dep in core | Core must have zero ORM dependencies per the architecture constraint | Only import TypeORM in the adapter package |
| webpack (NestJS CLI builder) | NestJS CLI webpack is for apps, not library packages; produces wrong output format | tsdown |
| Nx | Heavier orchestration layer on top of Turborepo concepts; not needed for 2-package monorepo | Turborepo alone |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| NestJS 11.x | Node.js ≥ 20 | Node 16 dropped in NestJS 11 |
| NestJS 11.x | TypeORM ^0.3.0 via @nestjs/typeorm 11.0.0 | Confirmed in @nestjs/typeorm 11.0.0 peer deps |
| TypeScript 5.7 | experimentalDecorators + emitDecoratorMetadata | Required for NestJS + TypeORM decorator metadata |
| reflect-metadata 0.2.x | NestJS 10 + 11 | Tested against ^0.1.13 || ^0.2.0 per @nestjs/typeorm peer deps |
| Vitest 3.x | unplugin-swc 1.x | Must pair; esbuild default breaks decorator metadata |
| tsdown 0.21.x | Pre-1.0 | Not yet 1.0; API is stable enough for library builds but watch for breaking changes |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Monorepo tooling (Turborepo + pnpm) | HIGH | Verified against official Turborepo docs and NestJS examples |
| Build tooling (tsdown) | MEDIUM | tsdown is pre-1.0 (0.21.x); tsup deprecation confirmed; migration path is clear but tsdown is not fully stable |
| Testing (Vitest + unplugin-swc) | HIGH | Multiple sources confirm this is the correct setup for NestJS + TypeORM decorator metadata in Vitest |
| OData parser (custom) | MEDIUM | The recommendation to build internally is the right call given ecosystem state, but it adds scope. Spike in Phase 1 to validate. |
| NestJS/TypeORM versions | HIGH | Verified against npm and official release announcements |

---

## Sources

- [Turborepo official NestJS example](https://github.com/vercel/turborepo/tree/main/examples/with-nestjs) — monorepo structure patterns
- [Turborepo Vitest guide](https://turborepo.dev/repo/docs/guides/tools/vitest) — per-package caching setup
- [tsdown documentation](https://tsdown.dev/guide/) — version 0.21.7, tsup successor confirmation
- [tsdown migration from tsup](https://tsdown.dev/guide/migrate-from-tsup) — compatibility confirmation
- [NestJS SWC docs](https://docs.nestjs.com/recipes/swc) — official SWC integration
- [unplugin-swc + Vitest NestJS](https://blog.ablo.ai/jest-to-vitest-in-nestjs) — decorator metadata solution
- [NestJS 11 announcement](https://trilon.io/blog/announcing-nestjs-11-whats-new) — version 11 stable, Jan 2025
- [TypeORM 0.3.28 on npm](https://www.npmjs.com/package/typeorm) — current stable
- [@nestjs/typeorm peer deps](https://github.com/nestjs/typeorm/blob/master/package.json) — compatibility matrix
- [jaystack/odata-v4-parser](https://github.com/jaystack/odata-v4-parser) — abandoned status confirmed (8 years, no releases)
- [Soontao/@odata/parser](https://github.com/Soontao/odata-v4-parser) — fork with 22 stars, low adoption
- [odata-v4-parser weekly downloads ~23k](https://www.npmjs.com/package/odata-v4-parser) — popular but abandoned
- [ESLint 9 flat config monorepo](https://typescript-eslint.io/troubleshooting/typed-linting/monorepos/) — typescript-eslint v8 project service
- [Building TypeScript library 2025](https://dev.to/arsyadyaseen/building-a-typescript-library-in-2025-2h0i) — tsdown guidance

---
*Stack research for: nestjs-odata (NestJS OData v4 library, Turborepo monorepo)*
*Researched: 2026-04-07*
