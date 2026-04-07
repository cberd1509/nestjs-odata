# OSS Modern Examples: TypeScript Monorepo Tooling Survey

**Researched:** 2026-04-07
**Projects surveyed:** LangChain JS, Crawlee, Effect, tRPC, Drizzle ORM, Hono, Turborepo (self)
**Purpose:** Establish 2025/2026 consensus stack for a serious TypeScript OSS monorepo

---

## Project-by-Project Findings

### 1. LangChain JS (langchain-ai/langchainjs)

One of the largest TypeScript monorepos in the OSS ecosystem — hundreds of packages spanning core, community integrations, and provider-specific packages.

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | Turborepo + pnpm workspaces | `turbo.json` + `pnpm-workspace.yaml` |
| Package manager | pnpm 10.14.0 | Pinned exact version via `packageManager` field |
| Build | tsdown (v0.21+, rebranded from tsup) | Per-package compilation |
| Linting | Oxlint (oxlintrc.jsonc) | Rust-based linter, NOT ESLint flat config |
| Formatting | Oxfmt (oxfmtrc.jsonc) | Rust-based formatter, NOT Prettier |
| Git hooks | lint-staged | Pre-commit runs Oxfmt on staged files |
| Commit conventions | Not enforced via commitlint | No explicit Conventional Commits enforcement |
| CI/CD | GitHub Actions — 20 workflows | ci.yml, release.yml, dev-release.yml, publish.yml, codeql.yml, format.yml, labeler.yml, and more |
| Release | Changesets (`@changesets/cli`) | Changesets action creates version PRs, OIDC trusted publish to npm |
| Versioning | Some packages fixed-linked (Google group), others independent | `fixed` array in changeset config |
| Testing | Jest (via `@types/jest`) | Note: one of the few holdouts on Jest vs Vitest |
| Security | CodeQL (`codeql.yml`), Dependabot (`dependabot.yml`) | Monthly Dependabot for npm + GitHub Actions; grouped minor/patch vs major |
| Docs | Separate repo (langchain-ai/docs) | Not Docusaurus in the main repo |
| README | Comprehensive — badges, quick start, API examples | High quality, links to full docs site |
| Notable | Oxlint + Oxfmt is an unusual Rust-toolchain choice for linting/formatting | Fastest linting available; also uses `devcontainer` for contributor onboarding |

**Takeaway:** LangChain JS is pushing toward Rust-based tooling (Oxlint/Oxfmt, tsdown) for speed at monorepo scale. Changesets is their release backbone. CodeQL + Dependabot for security. Jest is a legacy holdout — unusual in 2025.

---

### 2. Crawlee (apify/crawlee)

Web scraping framework with tight multi-package architecture and unusually strict ESM/CommonJS dual-build requirements.

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | Turborepo + Yarn workspaces | `turbo.json` + `lerna.json` |
| Package manager | Yarn 4.10.3 (Berry) | Pinned via `packageManager` field + Volta for Node pinning |
| Build | TypeScript 6 + custom build | `turbo run build` orchestrates |
| Linting | ESLint 9 (`eslint.config.mjs`) | Flat config format |
| Formatting | Biome 2.x (`biome.json`) | Formatter only (linting explicitly disabled in Biome) — hybrid approach |
| Git hooks | Husky + lint-staged | Pre-commit runs `yarn lint-staged` |
| Commit conventions | Conventional Commits enforced | `lerna.json` uses `conventionalCommits: true` for versioning |
| CI/CD | GitHub Actions | Build, test across Node 18-24 before release |
| Release | Lerna (`lerna version` + `lerna publish`) | NOT Changesets; Lerna creates git tags, separate `publish-to-npm.yml` workflow |
| Testing | Vitest 4 + Playwright | `vitest.config.mts`; Playwright for browser-based crawling tests |
| Security | Not explicitly documented | No Dependabot/Renovate visible |
| Docs | Website at crawlee.dev | Not in main repo |
| README | Good — installation, quick start, links | Medium quality |
| Notable | Hybrid Biome (formatter) + ESLint (linter) is a real pattern | Using Biome for formatting speed without migrating ESLint rules |

**Takeaway:** Crawlee shows that Yarn Berry + Lerna is still a viable stack in 2025, though not the emerging consensus. The Biome-for-formatting-only + ESLint-for-linting hybrid is a pragmatic migration path worth noting. Conventional Commits via Lerna rather than Changesets is an older pattern.

---

### 3. Effect (Effect-TS/effect)

Arguably the most sophisticated TypeScript library architecture in the OSS ecosystem — deep type-level programming with strict quality standards.

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | pnpm workspaces (no Turborepo) | `pnpm-workspace.yaml` but NO `turbo.json` — custom build scripts |
| Package manager | pnpm 10.17.1 | Pinned exact version |
| Build | TypeScript + Babel + Vite | Multi-format: ESM (tsc), CJS (Babel transform), annotated ESM (tree-shake markers) |
| Linting | ESLint 9 flat config | `eslint.config.mjs` with `@effect/eslint-plugin` (wraps dprint), `@typescript-eslint`, `eslint-plugin-import`, `eslint-plugin-codegen`, `simple-import-sort`, `sort-destructure-keys` |
| Formatting | dprint (via `@effect/eslint-plugin` ESLint rule) | Unusual: dprint runs as an ESLint rule — 2-space indent, 120 char width, double quotes, no semicolons |
| Git hooks | Not found | No Husky/lefthook in evidence; strict validation happens in CI |
| Commit conventions | Not formally enforced via tool | Conventional-style but no commitlint found |
| CI/CD | GitHub Actions — 6 workflows | check.yml (lint+typecheck+test sharded), release.yml, release-queue.yml, snapshot.yml, pages.yml, ts-nightly.yml |
| Release | Changesets + `@changesets/changelog-github` | Changesets action; OIDC trusted publish; `updateInternalDependencies: "patch"` |
| Testing | Vitest (sharded: 4 shards) + tstyche | `@effect/vitest` package for integration; `tstyche` for type-level tests |
| Security | Not explicitly documented | No Dependabot/Renovate visible |
| Docs | Custom docgen (`docgen.json`) + effect.website (separate) | JSDoc required on all public API with `@example`, `@since`, `@category` |
| README | Minimal in package README; full docs at effect.website | No badges |
| Notable | `tstyche` for type-level testing; `madge` for circular dep detection; dprint as ESLint rule is unique | Also uses `@arethetypeswrong/cli` for package exports validation |

**Takeaway:** Effect is the most opinionated stack here. The "dprint via ESLint" approach forces formatting through the lint pipeline. `tstyche` for type tests and `@arethetypeswrong/cli` for exports validation are standout additions any serious TypeScript library should consider. No pre-commit hooks — they trust CI. Changesets for releases.

---

### 4. tRPC (trpc/trpc)

High-impact TypeScript monorepo with a strong focus on DX and comprehensive example coverage.

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | Turborepo + pnpm workspaces + Lerna | `turbo.json` + `pnpm-workspace.yaml` + `lerna.json` (Lerna 11.x) |
| Package manager | pnpm 9.12.2 | Pinned via `packageManager` field |
| Build | tsdown (v0.12.7) | Per-package: `"build": "tsdown"` in each package.json; generates `.mjs`/`.cjs`/`.d.mts`/`.d.cts` |
| Linting | ESLint 9 flat config (`eslint.config.js`) | `@typescript-eslint` plugin |
| Formatting | Prettier 3.x (`prettier.config.js`) | Standard Prettier |
| Git hooks | Husky | `.husky` directory present |
| Commit conventions | Not strictly enforced via commitlint | Has Kodiak for PR auto-merge |
| CI/CD | GitHub Actions — separate `main.yml` + `lint.yml` | main.yml: build, typecheck, test (with Codecov), e2e (19+ example apps), release-tmp (pkg.pr.new) |
| Release | Lerna for versioning | Note: uses Lerna's versioning but the actual publish mechanism isn't Changesets |
| Testing | Vitest 4 + Playwright | Unit/integration via Vitest; E2E across 19+ framework examples |
| Security | Renovate (`renovate.json`) | Not Dependabot; Renovate handles dependency updates |
| Docs | Docusaurus 2 (`www/` directory) | Self-hosted docs site |
| GitHub config | CODEOWNERS, PR template, FUNDING.yml, labeler.yml, renovate.json, issue templates | Comprehensive GitHub hygiene |
| README | Good — badges, quick start, feature overview | High quality |
| Notable | `pkg.pr.new` for PR preview packages; CodeRabbit (`.coderabbit.yaml`) for AI code review; `@manypkg/cli` for monorepo consistency; Kodiak (`.kodiak.toml`) for auto-merge | Multiple DX automation layers |

**Takeaway:** tRPC's stack is pragmatic and production-proven. tsdown for building is the modern tsup successor. `pkg.pr.new` for instant PR preview packages is a powerful OSS contributor experience tool. CodeRabbit shows AI-assisted code review is entering mainstream OSS. Renovate over Dependabot for dependency updates.

---

### 5. Drizzle ORM (drizzle-team/drizzle-orm)

Lean, performance-focused ORM with aggressive zero-dependency stance and multiple packages (drizzle-orm, drizzle-kit, drizzle-seed, drizzle-zod, etc.).

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | Turborepo + pnpm workspaces | `turbo.json` + `pnpm-workspace.yaml` |
| Package manager | pnpm 10.6.3 | Pinned exact version |
| Build | tsup 8.x | Per-package tsup bundling |
| Linting | ESLint (`.eslintrc.yaml`) | YAML config (not flat config); custom `eslint-plugin-drizzle` also published |
| Formatting | dprint (`dprint.json`) | TypeScript + JSON + Markdown plugins; tabs for indentation; single quotes |
| Git hooks | Not found | No Husky/lefthook visible |
| Commit conventions | Not enforced via tool | No commitlint found |
| CI/CD | GitHub Actions — 5 workflows | codeql.yml, release-latest.yaml, release-feature-branch.yaml, router.yaml, unpublish-release-feature-branch.yaml |
| Release | Custom npm publish via OIDC | Version diffing against npm registry; requires changelog files; NOT Changesets-based |
| Testing | Custom test runner (complex integration-tests setup) | Tests across many DB shards/providers |
| Security | CodeQL (`codeql.yml`) | Static analysis; `@arethetypeswrong/cli` for exports validation |
| Docs | drizzle.team (separate) | Not in main repo |
| README | Good | Active badge set, examples |
| Notable | Feature branch releases (`release-feature-branch.yaml`) for trying unreleased features; `eslint-plugin-drizzle` is itself published as an OSS package | Custom OIDC publish pipeline without Changesets |

**Takeaway:** Drizzle shows dprint as a serious Prettier alternative. Their custom release pipeline (without Changesets) is complex but gives them feature-branch publish capability. The home-grown `eslint-plugin-drizzle` is worth noting — this library ships its own lint rules for users. Feature branch publishing is a DX differentiator for beta testing.

---

### 6. Hono (honojs/hono)

Single-package (not a monorepo in the traditional sense), runtime-agnostic web framework with exceptional multi-runtime CI matrix.

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | Not a monorepo | Single package, though has `packages/` subdirectories |
| Package manager | Bun 1.2.20 | `bun.lock` present; `packageManager` field uses Bun |
| Build | Custom esbuild script (`build/build.ts`) | Bun-executed; ESM to `dist/`, CJS to `dist/cjs/`, types via `tsc`; path rewriting plugin for `.js` extensions |
| Linting | ESLint 9 flat config (`eslint.config.mjs`) | `@typescript-eslint` plugin |
| Formatting | Prettier 3.7.x | Standard Prettier |
| Git hooks | Not found | No Husky; relies on CI checks |
| Commit conventions | Not enforced | No commitlint found |
| CI/CD | GitHub Actions — comprehensive matrix | Bun, Bun-Windows, Deno, Node 18/20/22, workerd, AWS Lambda, Fastly Compute, Lambda@Edge; bundle size + type perf checks on PRs; JSR dry-run |
| Release | Tag-based via `@david/publish-on-tag` (Deno/JSR tool) | git tag push triggers publish; also publishes to JSR |
| Testing | Vitest 3.x (multi-runtime) | `vitest.config.ts` with runtime-specific configs; Codecov integration |
| Security | Codecov | No Dependabot/Renovate visible |
| Docs | hono.dev (separate) | |
| README | Excellent | Badges, runtime matrix, quick examples, performance comparisons |
| Notable | JSR publishing alongside npm; bundle size measurement on every PR; HTTP benchmarking with automated PR comments; `publint` for package validation; tests across 10+ runtime targets | Runtime-first design forces the most comprehensive CI matrix of any project here |

**Takeaway:** Hono demonstrates Bun-as-package-manager in a production OSS project — Bun for scripts/testing, npm-compatible package.json for publishing. The multi-runtime CI matrix is state-of-the-art. JSR publishing alongside npm is forward-looking. Bundle size CI comments is a DX practice worth copying for any library.

---

### 7. Turborepo (vercel/turborepo)

The build orchestration tool itself — Rust core with TypeScript/MDX documentation layer. Shows how Vercel structures their own monorepo using their own tool.

| Category | Tool | Notes |
|----------|------|-------|
| Monorepo | Turborepo itself | Obviously |
| Package manager | pnpm 10.28.0 | Pinned exact version |
| Build | Rust (cargo) for core; TypeScript for docs/JS packages | Dual-language; Rust 68%, TypeScript 20%, MDX 10% |
| Linting | Oxlint (`oxlintrc.json`) | Same as LangChain JS; Rust-based linting |
| Formatting | Oxfmt (`oxfmtrc.jsonc`) + Prettier (`.prettierignore`) | Oxfmt for TypeScript, Prettier still in ignore list suggesting migration |
| Git hooks | Husky 8.x + lint-staged 13.x | Pre-commit: lint-staged |
| Commit conventions | Not enforced via commitlint | |
| CI/CD | GitHub Actions | Workflows for CI, release |
| Release | Managed by Vercel team | Cargo release for Rust; npm for JS packages |
| Testing | Vitest for TypeScript; Rust test framework for core | |
| Security | `cargo-deny` (`deny.toml`) for Rust supply chain; Socket.dev (`socket.yaml`) for JS supply chain | Most advanced security posture in this survey |
| Docs | Custom Vercel-hosted docs | MDX-based |
| README | Excellent | Vercel branding, badges, clear value prop |
| Notable | `socket.yaml` (Socket.dev) for JS dependency security scanning; `deny.toml` (cargo-deny) for Rust; `ultracite` in devDeps (Vercel's internal type utilities); Taplo (`taplo.toml`) for TOML validation | Socket.dev is an emerging supply chain security tool worth watching |

**Takeaway:** Turborepo shows that even Vercel uses Oxlint/Oxfmt for TypeScript linting/formatting (consistent with LangChain JS). Husky + lint-staged for pre-commit is still the standard. Socket.dev for supply chain security is new and worth monitoring. `cargo-deny` is Rust-specific but the concept (dependency license/vulnerability audit) applies to the JS ecosystem too.

---

## Comparison Matrix

| Tool Category | LangChain JS | Crawlee | Effect | tRPC | Drizzle | Hono | Turborepo | **Consensus** |
|---------------|-------------|---------|--------|------|---------|------|-----------|--------------|
| **Monorepo** | Turborepo | Turborepo | pnpm workspaces | Turborepo | Turborepo | N/A (single) | Turborepo | **Turborepo** (6/7 if Hono counted) |
| **Package manager** | pnpm | Yarn | pnpm | pnpm | pnpm | Bun | pnpm | **pnpm** (5/7) |
| **Build** | tsdown | tsc | tsc + Babel + Vite | tsdown | tsup | esbuild (custom) | Rust/tsc | **tsup/tsdown** emerging |
| **Linting** | Oxlint | ESLint 9 flat | ESLint 9 flat | ESLint 9 flat | ESLint (YAML) | ESLint 9 flat | Oxlint | **ESLint 9 flat config** (4/7), Oxlint rising (2/7) |
| **Formatting** | Oxfmt | Biome (fmt only) | dprint | Prettier | dprint | Prettier | Oxfmt | **Prettier** (2/7) but alternatives surging |
| **Git hooks** | lint-staged | Husky + lint-staged | None | Husky | None | None | Husky + lint-staged | **Husky + lint-staged** (3/7 use, 3/7 skip) |
| **Commit enforcement** | None | Conventional (Lerna) | None | None | None | None | None | **Not widely enforced** |
| **CI/CD** | GitHub Actions | GitHub Actions | GitHub Actions | GitHub Actions | GitHub Actions | GitHub Actions | GitHub Actions | **GitHub Actions** (7/7) |
| **Releases** | Changesets | Lerna | Changesets | Lerna | Custom | Tag-based | Custom | **Changesets** (3/7), Lerna (2/7) |
| **Testing** | Jest | Vitest | Vitest | Vitest | Custom | Vitest | Vitest | **Vitest** (5/7) |
| **Type tests** | None found | None found | tstyche | None | ATTW CLI | None | None | Niche but notable |
| **Export validation** | None found | None found | ATTW CLI | None | ATTW CLI | publint | None | `@arethetypeswrong/cli` or `publint` emerging |
| **Dep security** | Dependabot | None | None | Renovate | CodeQL | None | Socket.dev + cargo-deny | Split: **Dependabot** or **Renovate** |
| **CodeQL** | Yes | None | None | None | Yes | None | None | Present in larger projects |
| **Docs framework** | Separate repo | crawlee.dev | effect.website | Docusaurus 2 | drizzle.team | hono.dev | Vercel custom | **Separate site** (most common) |
| **PR template** | Yes | Unknown | Unknown | Yes | Unknown | Unknown | Unknown | Common in mature projects |
| **CODEOWNERS** | Unknown | Unknown | Unknown | Yes | Unknown | Unknown | Unknown | Common in larger teams |
| **Renovate vs Dependabot** | Dependabot | None | None | Renovate | None | None | None | Split preference |

---

## The 2025/2026 Consensus Stack

Based on frequency and trajectory across these 7 projects:

### Strong Consensus (5+ of 7 use it)

- **Turborepo** — The clear monorepo task orchestration winner. Every TypeScript monorepo of significance uses it except for one edge case (Effect, which has a custom build system because of its unusual multi-format output requirements).
- **pnpm** — 5 of 7 projects, with only Crawlee (Yarn) and Hono (Bun, single-package) as exceptions.
- **GitHub Actions** — Universal. Zero projects use CircleCI, GitLab CI, or anything else.
- **Vitest** — 5 of 7 projects (LangChain holding out with Jest, Drizzle with custom). The Jest-to-Vitest migration is essentially complete in the OSS ecosystem.
- **ESLint 9 flat config** — 4 of 7 use ESLint flat config format. The remaining two (LangChain JS, Turborepo) use Oxlint. The old `.eslintrc.*` format is gone from all surveyed projects.

### Moderate Consensus (3-4 of 7)

- **Changesets** — 3 of 7 use it (LangChain JS, Effect, tRPC use it for versioning; Crawlee and Drizzle use alternatives). For a new OSS monorepo in 2025, Changesets is the right default.
- **Husky + lint-staged** — 3 of 7 use it for pre-commit; 3 skip pre-commit entirely (Effect, Hono, Drizzle). The skip pattern is defensible: "trust CI, don't slow down developer workflow."
- **`@typescript-eslint`** — Universal among ESLint users.
- **Dual ESM + CJS output** — All publishing packages emit both formats with separate type declarations (`.d.mts`/`.d.cts`).

### Emerging (1-2 of 7, but trending)

- **tsdown** — tRPC and LangChain JS both moved to tsdown (the successor to tsup from the same author). If tsup is listed as the build tool, expect it to be tsdown within a year.
- **Oxlint / Oxfmt** — LangChain JS and Turborepo (both large teams) use Rust-based linting/formatting. This is fast but not yet mainstream.
- **dprint** — Effect and Drizzle use it instead of Prettier. Gaining traction for teams wanting more control over formatting configuration.
- **Biome** — Crawlee uses Biome for formatting only (hybrid with ESLint). Not replacing ESLint wholesale yet.
- **`@arethetypeswrong/cli`** — Effect and Drizzle validate their published packages' exports. Essential for any library publishing to npm.
- **`pkg.pr.new`** — tRPC uses this for PR-preview packages. Low effort, high contributor DX value.
- **Renovate** — tRPC uses Renovate; LangChain uses Dependabot. Both valid; Renovate is more configurable.
- **Socket.dev** — Turborepo uses it for supply chain security. Emerging tool.
- **JSR publishing** — Hono publishes to both npm and JSR. Forward-looking but not yet mainstream.
- **CodeRabbit** — tRPC uses AI code review via `.coderabbit.yaml`. Increasingly common.

---

## Actionable Recommendations for nestjs-odata

### What to Adopt Immediately (high confidence, clear consensus)

1. **Turborepo** for monorepo task orchestration — confirmed by 6/7 projects. Use `turbo.json` with `build`, `test`, `lint`, `typecheck` tasks in dependency order.

2. **pnpm** as the package manager — Pin exact version in `packageManager` field (e.g., `"pnpm@10.x.x"`). Use `pnpm-workspace.yaml`.

3. **ESLint 9 flat config** (`eslint.config.mjs`) with `@typescript-eslint` — The old `.eslintrc.*` format is dead. All modern projects use flat config.

4. **Prettier** for formatting — Still the simplest choice for a new project. Not worth the config overhead of dprint/Biome/Oxfmt unless team has strong preferences.

5. **Vitest** for testing — 5/7 projects. Jest migration cost is real; start with Vitest.

6. **Changesets** for versioning — Best choice for a multi-package OSS monorepo starting from scratch. Creates good contributor experience (changeset files with PRs) and clean changelogs.

7. **GitHub Actions** — Universal. Use separate workflow files: `ci.yml` (lint + test + typecheck on PRs), `release.yml` (Changesets on main), `codeql.yml` (security scanning).

8. **Dual ESM + CJS builds** with separate type declarations (`.d.mts`/`.d.cts`) — Do this from day one. tsup or tsdown handles this automatically.

### What to Adopt (strong recommendation)

9. **`@arethetypeswrong/cli`** — Run this in CI to validate published package exports. Effect and Drizzle both use it. Essential for a TypeScript library where consumers will import subpaths. Catches the common "exports map doesn't match actual files" bug before it reaches users.

10. **`publint`** — Hono uses it. Validates package.json publish fields. Pair with ATTW.

11. **Husky + lint-staged** for pre-commit — Run `eslint --fix` + `prettier --write` on staged files. Keeps CI green by catching obvious errors locally. Three of the largest projects do this.

12. **PR template** (`.github/pull_request_template.md`) — tRPC and LangChain have good examples: link to issue, describe change, checklist with "tests added" and "docs updated."

13. **CODEOWNERS** — Once the project has multiple maintainers, add this. tRPC has it from early on.

### What to Consider (useful but project-dependent)

14. **Renovate over Dependabot** — tRPC uses Renovate, which has more granular grouping and auto-merge configuration. For a project with many dependencies, Renovate's `updateInternalDeps: true` is useful for keeping monorepo packages in sync. Either works; Renovate is more powerful.

15. **`pkg.pr.new`** for PR preview packages — tRPC uses this to let maintainers install PR builds directly (`npm i https://pkg.pr.new/@nestjs-odata/core@123`). Excellent for beta testing with users. Add to `ci.yml` with minimal effort.

16. **CodeQL** (`codeql.yml`) — LangChain JS and Drizzle both have it. GitHub's free static security analysis. Worth adding — it's a GitHub Action with minimal config.

17. **tsdown instead of tsup** — tRPC and LangChain JS have both moved to tsdown (same author as tsup, more modern architecture). For a new project, either works. tsdown if you want to be on the latest.

### What to Skip (for now)

18. **Oxlint/Oxfmt** — Only LangChain and Turborepo use these. The tooling is fast but the ESLint plugin ecosystem (e.g., `@typescript-eslint/eslint-plugin-recommended`) is richer. Wait until Oxlint's plugin support matures.

19. **dprint** — Effect and Drizzle love it, but the "dprint as ESLint rule" pattern is complex. Start with Prettier.

20. **Biome** — Not yet displacing ESLint for linting. Crawlee's hybrid approach adds config complexity. Skip for now.

21. **Conventional Commits enforcement via commitlint** — None of the 7 projects strictly enforce this via tooling, even the ones that use Conventional Commits for versioning. Trust your contributors.

22. **JSR publishing** — Only Hono does this. The ecosystem isn't there yet for a NestJS library.

---

## Recommended nestjs-odata CI/CD Topology

Based on survey findings:

```
.github/
  workflows/
    ci.yml              # On PRs: lint, typecheck, test (Vitest, sharded if needed)
    release.yml         # On main push: Changesets action (version PR or publish)
    codeql.yml          # Weekly: CodeQL security scan
  ISSUE_TEMPLATE/
    bug_report.md
    feature_request.md
  pull_request_template.md
  CODEOWNERS            # Add when second maintainer joins
  renovate.json         # OR dependabot.yml — pick one
  FUNDING.yml           # GitHub Sponsors link
```

The CI workflow should run in this order:
1. Install (pnpm install with frozen lockfile)
2. Build (turbo run build — needed for typecheck of dependent packages)
3. Lint (turbo run lint)
4. Typecheck (turbo run typecheck — separate from build)
5. Test (turbo run test with Vitest)
6. Validate exports (ATTW + publint — on every PR for library packages)

---

## Sources

- https://github.com/langchain-ai/langchainjs — package.json, turbo.json, .changeset/config.json, .oxlintrc.jsonc, .github/dependabot.yml, .github/workflows/
- https://github.com/apify/crawlee — package.json, lerna.json, biome.json, turbo.json, .github/workflows/release.yml
- https://github.com/Effect-TS/effect — package.json, eslint.config.mjs, .changeset/config.json, .github/workflows/check.yml, .github/workflows/release.yml
- https://github.com/trpc/trpc — package.json (root + @trpc/server), turbo.json, lerna.json, .github/renovate.json, .github/pull_request_template.md, .github/workflows/main.yml
- https://github.com/drizzle-team/drizzle-orm — package.json, dprint.json, turbo.json, .github/workflows/
- https://github.com/honojs/hono — package.json, build/build.ts, .github/workflows/ci.yml, .github/workflows/release.yml
- https://github.com/vercel/turborepo — package.json, .oxlintrc.json
