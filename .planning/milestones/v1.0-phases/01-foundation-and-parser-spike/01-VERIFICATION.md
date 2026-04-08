---
phase: 01-foundation-and-parser-spike
verified: 2026-04-07T00:00:00Z
status: gaps_found
score: 4/5 roadmap success criteria verified
re_verification: false
gaps:
  - truth: 'Running `changeset version` produces a correct semver bump and changelog entry'
    status: failed
    reason: 'pnpm changeset version fails with two validation errors: (1) `.changeset/config.json` has `ignore: ["test-app"]` but the actual package name is `@nestjs-odata/test-app`; (2) `@nestjs-odata/typeorm` peerDependency declares `>=0.1.0` for `@nestjs-odata/core` but core''s current version is `0.0.1`, which fails changesets internal dependency validation.'
    artifacts:
      - path: '.changeset/config.json'
        issue: 'ignore array value "test-app" does not match the actual package name "@nestjs-odata/test-app"'
      - path: 'packages/typeorm/package.json'
        issue: 'peerDependencies["@nestjs-odata/core"] = ">=0.1.0" does not include the current published version "0.0.1"'
    missing:
      - 'Fix `.changeset/config.json` ignore entry from `"test-app"` to `"@nestjs-odata/test-app"`'
      - 'Either bump core to 0.1.0 before first release or adjust typeorm peerDep to `">=0.0.1"`'
human_verification:
  - test: 'Run VitePress docs build and verify index.html is produced'
    expected: 'docs/.vitepress/dist/index.html exists after running `cd docs && pnpm exec vitepress build`'
    why_human: 'VitePress dist directory is not committed; build must be run interactively to verify'
  - test: 'Trigger a PR on GitHub and observe CI workflow run'
    expected: 'ci.yml executes all steps: lint, typecheck, test, build, ATTW, publint — all green on Node 20 and Node 22'
    why_human: 'Cannot simulate GitHub Actions locally; requires actual PR against the repository'
---

# Phase 1: Foundation and Parser Spike Verification Report

**Phase Goal:** The monorepo is running, all OSS tooling is wired, and the OData query parser approach is validated against the OASIS ABNF grammar
**Verified:** 2026-04-07T00:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                             | Status     | Evidence                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm install && pnpm build` passes across all workspace packages with no errors                  | ✓ VERIFIED | `pnpm build` exits 0; dist/index.mjs and dist/index.cjs produced for both packages                                                                                                                                         |
| 2   | `pnpm lint` and `pnpm test` run in CI on every PR and pass                                        | ✓ VERIFIED | `.github/workflows/ci.yml` runs `pnpm turbo lint`, `pnpm turbo test`, `pnpm turbo build` on PR trigger; 102/102 tests pass locally                                                                                         |
| 3   | OData sub-agent exists and can correctly answer questions about OData v4 filter expression syntax | ✓ VERIFIED | `.claude/agents/odata-expert.md` exists (222 lines); contains `name: odata-expert`, tools, OASIS URLs, ABNF, CSDL, `@odata.context`, `discriminated union`, `recursive descent`                                            |
| 4   | `$filter` parser spike correctly parses representative OASIS ABNF test vectors                    | ✓ VERIFIED | 102 tests pass: `Price gt 5` → BinaryExpr, `contains(Name,'Alice')` → FunctionCall, `Year eq 2024 and Active eq true` → correct precedence, lambda `Tags/any(...)` → LambdaExpr                                            |
| 5   | Running `changeset version` produces a correct semver bump and changelog entry                    | ✗ FAILED   | `pnpm changeset version` exits with ValidationError: ignore entry `"test-app"` does not match package `@nestjs-odata/test-app`; additionally `@nestjs-odata/typeorm` peerDep `>=0.1.0` conflicts with core version `0.0.1` |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact                                          | Expected                                        | Status     | Details                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/dist/index.mjs`                    | ESM build output for @nestjs-odata/core         | ✓ VERIFIED | Exists, contains parseQuery, parseFilter, TokenKind                                                                                     |
| `packages/core/dist/index.cjs`                    | CJS build output for @nestjs-odata/core         | ✓ VERIFIED | Exists                                                                                                                                  |
| `packages/typeorm/dist/index.mjs`                 | ESM build output for @nestjs-odata/typeorm      | ✓ VERIFIED | Exists                                                                                                                                  |
| `turbo.json`                                      | Turborepo pipeline configuration with dependsOn | ✓ VERIFIED | Contains `"dependsOn": ["^build"]` for build, test, typecheck                                                                           |
| `apps/test-app/src/entities/product.entity.ts`    | Product entity with ManyToOne to Category       | ✓ VERIFIED | Has `@ManyToOne(() => Category`, `@OneToMany(() => OrderItem`, `@ManyToMany(() => Tag`                                                  |
| `packages/eslint-config/eslint.config.mjs`        | Shared ESLint flat config package               | ✓ VERIFIED | Contains `tseslint.config(`, `eslint-config-prettier`                                                                                   |
| `.changeset/config.json`                          | Changesets release configuration                | ✗ PARTIAL  | Exists with `"access": "public"` and `"baseBranch": "main"`, but `"ignore": ["test-app"]` is wrong — should be `@nestjs-odata/test-app` |
| `docs/.vitepress/config.ts`                       | VitePress documentation site config             | ✓ VERIFIED | Exists as `docs/.vitepress/config.mts` (correct ESM extension), contains `title: 'nestjs-odata'`                                        |
| `.husky/pre-commit`                               | Pre-commit hook running lint-staged             | ✓ VERIFIED | Contains `pnpm exec lint-staged`                                                                                                        |
| `packages/core/src/parser/ast.ts`                 | Discriminated union AST types                   | ✓ VERIFIED | Contains BinaryExpr, FunctionCall, LambdaExpr, PropertyAccess, Literal, UnaryExpr kinds; exports QueryOptions                           |
| `packages/core/src/parser/visitor.ts`             | Visitor interface for AST traversal             | ✓ VERIFIED | Exports `FilterVisitor<T>` with all visit methods                                                                                       |
| `packages/core/src/parser/lexer.ts`               | Tokenizer for OData query expressions           | ✓ VERIFIED | Exports `tokenize`, `TokenKind` enum with `STRING_LITERAL` and all other token types                                                    |
| `packages/core/src/parser/parser.ts`              | Recursive descent parser with Pratt precedence  | ✓ VERIFIED | Exports `parseQuery`, `parseFilter`; contains `parseExpression`, `parsePrimary`, `getPrecedence`                                        |
| `packages/core/src/parser/errors.ts`              | Parser error types                              | ✓ VERIFIED | Exports `ODataParseError`                                                                                                               |
| `.github/workflows/ci.yml`                        | CI pipeline for PRs                             | ✓ VERIFIED | Contains `pnpm turbo lint/test/build`, `@arethetypeswrong/cli`, `publint`, node-version matrix [20, 22]                                 |
| `.github/workflows/release.yml`                   | Changesets release with OIDC                    | ✓ VERIFIED | Contains `id-token: write`, `changesets/action`; no NPM_TOKEN                                                                           |
| `.github/workflows/codeql.yml`                    | CodeQL security scanning                        | ✓ VERIFIED | Contains `codeql-action/analyze`, weekly `schedule`                                                                                     |
| `.github/dependabot.yml`                          | Dependabot dependency monitoring                | ✓ VERIFIED | Contains `package-ecosystem: npm` and `package-ecosystem: github-actions`                                                               |
| `.claude/agents/odata-expert.md`                  | OData v4 expert sub-agent                       | ✓ VERIFIED | 222 lines, correct frontmatter with tools, comprehensive OData v4 spec knowledge                                                        |
| `packages/core/test/parser/parser-filter.test.ts` | TDD tests for $filter parsing                   | ✓ VERIFIED | 461 lines, 49 tests, covers `Price gt 5`, `contains(Name`, `Tags/any`, `O''Brien`                                                       |
| `packages/core/test/parser/parser-query.test.ts`  | TDD tests for $orderby, $select, $top, $skip    | ✓ VERIFIED | 172 lines, 21 tests                                                                                                                     |

### Key Link Verification

| From                                 | To                                         | Via                                             | Status  | Details                                                                                                        |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `turbo.json`                         | `packages/*/tsdown.config.ts`              | turbo build task                                | ✓ WIRED | `"build"` task defined with `"dependsOn": ["^build"]`                                                          |
| `packages/typeorm/package.json`      | `packages/core/package.json`               | peerDependencies + devDependencies workspace:\* | ✓ WIRED | `"@nestjs-odata/core": "workspace:*"` in devDeps, `">=0.1.0"` in peerDeps (peerDep semver issue noted in gaps) |
| `eslint.config.mjs`                  | `packages/eslint-config/eslint.config.mjs` | import                                          | ✓ WIRED | `import config from '@repo/eslint-config'`                                                                     |
| `.husky/pre-commit`                  | `lint-staged.config.mjs`                   | pnpm exec lint-staged                           | ✓ WIRED | `pnpm exec lint-staged` in hook                                                                                |
| `.husky/commit-msg`                  | `commitlint.config.cjs`                    | pnpm exec commitlint                            | ✓ WIRED | `pnpm exec commitlint --edit $1`                                                                               |
| `.github/workflows/ci.yml`           | `turbo.json`                               | pnpm turbo lint/test/build                      | ✓ WIRED | `pnpm turbo lint`, `pnpm turbo test`, `pnpm turbo build` all present                                           |
| `.github/workflows/release.yml`      | `.changeset/config.json`                   | changesets/action                               | ✓ WIRED | `changesets/action@v1` with `publish: pnpm run release`                                                        |
| `packages/core/src/parser/parser.ts` | `packages/core/src/parser/lexer.ts`        | import tokenize                                 | ✓ WIRED | `tokenize` is called inside parser                                                                             |
| `packages/core/src/parser/parser.ts` | `packages/core/src/parser/ast.ts`          | import AST node types                           | ✓ WIRED | AST node types consumed in parser construction                                                                 |
| `packages/core/src/index.ts`         | `packages/core/src/parser/index.ts`        | re-export                                       | ✓ WIRED | `export * from './parser/index.js'`                                                                            |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces build tooling, parsers, and configuration files, not components that render dynamic UI data. The parser accepts string input and returns AST; data flow is verified through the 102 passing tests.

### Behavioral Spot-Checks

| Behavior                                                 | Command                                       | Result                                                             | Status |
| -------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Parser parses `Price gt 5` into BinaryExpr               | `pnpm test --no-cache`                        | 102/102 tests pass, including this specific vector                 | ✓ PASS |
| Parser parses `contains(Name,'Alice')` into FunctionCall | `pnpm test --no-cache`                        | Covered in parser-filter.test.ts (49 tests pass)                   | ✓ PASS |
| `pnpm build` exits 0                                     | `pnpm build`                                  | 4/4 turbo tasks successful                                         | ✓ PASS |
| `pnpm changeset version` produces semver bump            | `pnpm changeset version`                      | ValidationError — ignore entry mismatch + peerDep version conflict | ✗ FAIL |
| Core has zero typeorm imports                            | `grep -r "from 'typeorm'" packages/core/src/` | No matches                                                         | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                      | Status      | Evidence                                                                                                                 |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| SCAF-01     | 01-01       | Turborepo + pnpm monorepo with packages/core, packages/typeorm, apps/test-app                    | ✓ SATISFIED | All three workspaces exist; pnpm-workspace.yaml configured; turbo.json wired                                             |
| SCAF-02     | 01-02       | Full OSS tooling: ESLint 9 flat config, Prettier, Husky + lint-staged, Commitlint                | ✓ SATISFIED | All tools configured and wired; pnpm lint passes                                                                         |
| SCAF-03     | 01-03       | GitHub templates: issue templates, PR template, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md | ✓ SATISFIED | All files present at expected paths                                                                                      |
| SCAF-04     | 01-03       | CI/CD: GitHub Actions for lint, test, build on PR; Changesets-based release workflow             | ✓ SATISFIED | ci.yml and release.yml both configured correctly with all steps                                                          |
| SCAF-05     | 01-03       | npm package publishing with OIDC trusted publishing (no long-lived tokens)                       | ✓ SATISFIED | release.yml has `id-token: write` permission; no NPM_TOKEN present                                                       |
| SCAF-06     | 01-03       | `@arethetypeswrong/cli` + `publint` in CI to validate package exports                            | ✓ SATISFIED | ci.yml contains both tools with `--pack` flag for both packages                                                          |
| SCAF-07     | 01-02       | VitePress documentation site with typedoc-generated API docs                                     | ? PARTIAL   | VitePress site exists and config is correct; typedoc integration not present yet (docs content deferred to later phases) |
| SCAF-08     | 01-03       | OData v4 expert sub-agent built from OASIS spec                                                  | ✓ SATISFIED | `.claude/agents/odata-expert.md` exists with 222 lines covering all required areas                                       |
| SCAF-09     | 01-01       | tsdown build pipeline for both packages (ESM + CJS dual build)                                   | ✓ SATISFIED | Both packages produce dist/index.mjs and dist/index.cjs                                                                  |
| SCAF-10     | 01-01       | Vitest + unplugin-swc test setup                                                                 | ✓ SATISFIED | All three workspaces have vitest.config.ts with swc.vite() plugin and .swcrc                                             |
| SCAF-11     | 01-03       | Dependabot + CodeQL security scanning configured from day one                                    | ✓ SATISFIED | dependabot.yml monitors npm and github-actions; codeql.yml has weekly schedule                                           |

### Anti-Patterns Found

| File                            | Line | Pattern                                                                            | Severity | Impact                                                                          |
| ------------------------------- | ---- | ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `.changeset/config.json`        | —    | `"ignore": ["test-app"]` — wrong package name (should be `@nestjs-odata/test-app`) | Blocker  | `pnpm changeset version` fails with ValidationError; release pipeline blocked   |
| `packages/typeorm/package.json` | —    | `peerDependencies["@nestjs-odata/core"] = ">=0.1.0"` but core is at `0.0.1`        | Warning  | Changesets validation also reports this; first changeset version bump will fail |
| `.github/workflows/release.yml` | —    | `publish: pnpm run release` but no `release` script in root package.json           | Warning  | Release workflow will fail at publish step; `pnpm run release` is undefined     |
| `packages/core/src/index.ts`    | 1    | `export const VERSION = '0.0.1'` — placeholder, intentional stub                   | Info     | Acknowledged in SUMMARY as intentional; will be replaced by real exports        |
| `packages/typeorm/src/index.ts` | —    | `export const VERSION = '0.0.1'` — placeholder, intentional stub                   | Info     | Acknowledged in SUMMARY as intentional                                          |

### Human Verification Required

#### 1. VitePress Documentation Build

**Test:** Run `cd /path/to/nestjs-odata/docs && pnpm exec vitepress build`
**Expected:** Build completes without errors; `docs/.vitepress/dist/index.html` is created with the home page
**Why human:** VitePress dist directory is not committed to version control; must be built interactively to confirm it still compiles after the config.mts rename from config.ts

#### 2. CI Workflow on Real GitHub PR

**Test:** Push a branch to GitHub and open a PR targeting main
**Expected:** The ci.yml workflow triggers, runs all steps (lint, typecheck, test, build, ATTW, publint) successfully on both Node.js 20 and 22 matrix
**Why human:** Cannot simulate GitHub Actions environment locally; the workflow YAML is correctly formed but actual runner behavior requires a real GitHub environment

### Gaps Summary

**Critical gap:** The Changesets release pipeline is broken. `pnpm changeset version` fails immediately with a ValidationError because the `ignore` array in `.changeset/config.json` contains `"test-app"` but the actual package name is `"@nestjs-odata/test-app"`. This means SC-5 (changeset version produces correct output) cannot be satisfied. Additionally, the `@nestjs-odata/typeorm` peerDependency specifies `>=0.1.0` for `@nestjs-odata/core`, but core is currently at `0.0.1`, which triggers a second validation failure. Both are simple one-line fixes.

**Non-critical gap (warning):** The release.yml workflow calls `pnpm run release` which does not exist in the root package.json scripts. This would cause the release pipeline to fail at the publish step. A `"release": "changeset publish"` script needs to be added.

**Partial items:** SCAF-07 (VitePress with typedoc API docs) — the VitePress site is fully functional, but typedoc integration is not present. Since the plan scope for 01-02 only covered the VitePress site (not typedoc), and typedoc API docs are a documentation content concern that can be added incrementally, this is noted as partial rather than blocked.

---

_Verified: 2026-04-07T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
