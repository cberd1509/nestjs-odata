# OSS Tooling Research: nestjs-odata

**Domain:** Open-source TypeScript monorepo library (Turborepo + NestJS)
**Researched:** 2026-04-07
**Overall confidence:** HIGH — most findings verified against official NestJS repos and official docs

---

## Executive Summary

This document covers the 2025-era best-practice tooling stack for a serious open-source TypeScript library published from a Turborepo monorepo. Evidence comes from inspecting the official NestJS ecosystem repos (`@nestjs/typeorm`, `@nestjs/swagger`), current official tooling docs, and the broader TypeScript OSS community.

The NestJS official repos have converged on a specific set of tools: **ESLint flat config** (eslint.config.mjs), **Prettier** with minimal config, **commitlint with `@commitlint/config-angular`**, **Husky** for git hooks, and **release-it** for releases. However, for a greenfield Turborepo monorepo, **Changesets** is a stronger choice than release-it because it is purpose-built for multi-package repos and has first-class Turborepo documentation support.

---

## 1. Linting & Formatting

### ESLint

**Recommendation: ESLint 9 flat config (`eslint.config.mjs`)**

ESLint's flat config is now the only supported format (the legacy `.eslintrc` was removed in ESLint 9). The `eslint.config.mjs` format gives you an array of config objects with full JavaScript control. This is confirmed as the current approach in both `@nestjs/typeorm` and `@nestjs/swagger`.

**Required packages:**

```
eslint                          ^9.x
@typescript-eslint/eslint-plugin ^8.x
@typescript-eslint/parser        ^8.x
typescript-eslint               ^8.x   (the meta-package)
eslint-config-prettier          ^9.x   (disables ESLint rules that conflict with Prettier)
@darraghor/eslint-plugin-nestjs-typed  ^6.x (NestJS-specific rules)
```

Note: `@darraghor/eslint-plugin-nestjs-typed` v6.x supports ESLint 9 and typescript-eslint v7/v8.

**`eslint.config.mjs` baseline (from nestjs/swagger and nestjs/typeorm):**

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // NestJS official repos relax these — pragmatic for a decorator-heavy codebase
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/require-await': 'warn',
    },
  },
);
```

**Why flat config over legacy `.eslintrc`:** It's the only format supported going forward, supported by all modern tooling, and removes the confusing `extends` merge chains.

**Why NOT `eslint-plugin-prettier`:** Use `eslint-config-prettier` (disables conflicting rules) rather than `eslint-plugin-prettier` (runs Prettier as ESLint rule). The latter causes confusing double-error output. Let Prettier run independently.

### Prettier

**Recommendation: Prettier 3.x with a minimal `.prettierrc`**

Prettier 3 is the current major version. The NestJS official repos use a minimal config with single quotes and no trailing commas — matching their historical style.

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

Note: NestJS official repos use `"trailingComma": "none"` but `"all"` is the current Prettier default and is better for git diffs. Use `"all"` for a greenfield project.

**`.prettierignore`:**
```
dist/
node_modules/
*.md
```

**No Stylelint:** This is a backend NestJS library with no CSS. Stylelint is irrelevant here.

---

## 2. Commit Conventions

### commitlint

**Recommendation: `@commitlint/config-conventional` (not `config-angular`)**

The NestJS official repos use `@commitlint/config-angular` for historical reasons. For a greenfield project, use `@commitlint/config-conventional` instead — it follows the official [Conventional Commits 1.0.0 spec](https://www.conventionalcommits.org/en/v1.0.0/) more faithfully, supports the `!` breaking change marker, and is what tooling like Changesets and release-please expect.

**`commitlint.config.cjs`:**

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'body-max-line-length': [2, 'always', 100],
  },
};
```

**Packages:**
```
@commitlint/cli         ^19.x
@commitlint/config-conventional  ^19.x
```

### Husky vs Lefthook

**Recommendation: Husky v9**

Both work. Lefthook is technically faster (Go binary, parallel execution) and has zero npm dependencies. However:

- Husky is the de facto standard in the Node.js/NestJS ecosystem — every contributor will know it
- The NestJS official repos all use Husky
- The speed difference is imperceptible for a pre-commit hook running lint-staged (1-5 files)
- Lefthook's main advantage (multi-language support) is irrelevant for a TypeScript-only repo
- Husky v9 is 2 kB with zero dependencies — the "bloat" argument against it is now obsolete

Use Husky unless you have a specific reason not to.

**Husky v9 setup:**

```bash
pnpm add -D husky
pnpm exec husky init
```

This creates `.husky/pre-commit`. Then add `.husky/commit-msg` manually.

`.husky/pre-commit`:
```sh
pnpm exec lint-staged
```

`.husky/commit-msg`:
```sh
pnpm exec commitlint --edit "$1"
```

`package.json`:
```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

**lint-staged** (`lint-staged.config.mjs` or in `package.json`):

```js
export default {
  '**/*.{ts}': ['eslint --fix', 'prettier --write'],
  '**/*.{json,md,yml,yaml}': ['prettier --write'],
};
```

Do NOT run `tsc --noEmit` in pre-commit — it checks the whole project and adds 10-20s to every commit. Run type-checking in CI instead.

---

## 3. GitHub Templates

### Issue Templates

Use the YAML form (`.github/ISSUE_TEMPLATE/*.yml`), not the legacy Markdown form. YAML templates support required fields and dropdown selectors.

**`.github/ISSUE_TEMPLATE/bug_report.yml`:**
```yaml
name: Bug Report
description: Report a bug in nestjs-odata
labels: ["bug", "triage"]
body:
  - type: markdown
    attributes:
      value: |
        Please search existing issues before filing a new one.
  - type: input
    id: version
    attributes:
      label: Library Version
      placeholder: "e.g. 0.1.0"
    validations:
      required: true
  - type: input
    id: nestjs-version
    attributes:
      label: NestJS Version
      placeholder: "e.g. 10.x"
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: Describe the bug
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Steps to reproduce
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
```

**`.github/ISSUE_TEMPLATE/feature_request.yml`:**
```yaml
name: Feature Request
description: Suggest a new feature
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem are you trying to solve?
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Describe the solution you'd like
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
```

**`.github/ISSUE_TEMPLATE/config.yml`:**
```yaml
blank_issues_enabled: false
contact_links:
  - name: Stack Overflow
    url: https://stackoverflow.com/questions/tagged/nestjs
    about: General NestJS questions
```

### PR Template

**`.github/PULL_REQUEST_TEMPLATE.md`** (follows NestJS official pattern):

```markdown
## PR Checklist

- [ ] Commit message follows [conventional commits](CONTRIBUTING.md)
- [ ] Tests added/updated for the changes
- [ ] Documentation updated if needed

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Refactoring
- [ ] CI/build change
- [ ] Documentation

## Description

<!-- Fixes #(issue) -->

**Current behavior:**

**New behavior:**

**Breaking changes:** Yes / No

## Additional context
```

### CONTRIBUTING.md

Keep it short and link out. Key sections:
- Development setup (pnpm install, turbo build)
- Running tests
- Commit conventions (link to commitlint config or conventional commits)
- PR process
- Issue reporting guidelines (link to issue templates)

NestJS official CONTRIBUTING.md is a good reference — it links to the Angular commit convention, explains the PR checklist, and directs general support to Stack Overflow.

### CODE_OF_CONDUCT.md

Use the **Contributor Covenant v2.1** verbatim — it is the industry standard. Customize the enforcement contact email only.

```
https://www.contributor-covenant.org/version/2/1/code_of_conduct/
```

---

## 4. CI/CD: GitHub Actions

### PR Workflow

**`.github/workflows/ci.yml`** — runs on every PR and push to main:

```yaml
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
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm turbo lint
      - run: pnpm turbo typecheck
      - run: pnpm turbo test
      - run: pnpm turbo build
```

Test on both Node 20 (LTS) and Node 22 (current LTS). Skip Node 18 — it reaches EOL April 2025.

### PR Title Lint

Add a separate workflow to enforce conventional commit format on PR titles (important for squash-merge workflows):

```yaml
name: PR Title

on:
  pull_request:
    types: [opened, edited, synchronize]

jobs:
  lint-title:
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Package: `amannn/action-semantic-pull-request` — the most widely used PR title linter for conventional commits.

### Release Workflow

**`.github/workflows/release.yml`** — triggered manually or by merging the Changeset PR:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 9

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
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 5. Documentation

### Recommendation: VitePress + typedoc-plugin-markdown

**Do not use Docusaurus** for a TypeScript library. Docusaurus is React-based and carries significant overhead for what is primarily an API documentation use case. VitePress is lighter, faster, and has better TypeScript/Vite-native DX.

**Stack:**
```
vitepress                   ^1.x
typedoc                     ^0.27.x
typedoc-plugin-markdown     ^4.x
```

The `typedoc-plugin-markdown` package has a dedicated VitePress plugin that auto-generates a sidebar from TypeDoc output and integrates cleanly into VitePress.

**Workflow:**
1. TypeDoc generates Markdown API docs from source
2. VitePress renders the Markdown into a static site
3. GitHub Actions deploys to GitHub Pages

**`typedoc.json`:**
```json
{
  "entryPoints": ["packages/core/src/index.ts", "packages/typeorm/src/index.ts"],
  "out": "docs/api",
  "plugin": ["typedoc-plugin-markdown"],
  "hidePageTitle": false,
  "readme": "none"
}
```

### README Badges

Standard badge set for a serious OSS library (shields.io):

```markdown
[![npm version](https://img.shields.io/npm/v/@nestjs-odata/core.svg)](https://www.npmjs.com/package/@nestjs-odata/core)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-odata/core.svg)](https://www.npmjs.com/package/@nestjs-odata/core)
[![CI](https://github.com/your-org/nestjs-odata/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/nestjs-odata/actions/workflows/ci.yml)
[![Coverage](https://coveralls.io/repos/github/your-org/nestjs-odata/badge.svg?branch=main)](https://coveralls.io/github/your-org/nestjs-odata?branch=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
```

For coverage, use **Coveralls** (free for open source) or **Codecov** — both integrate with GitHub Actions. Codecov is slightly more feature-rich but Coveralls has been around longer and works well.

---

## 6. Changesets / Versioning

### Recommendation: Changesets (not release-it, not semantic-release)

The NestJS official repos (`@nestjs/typeorm`, `@nestjs/swagger`) use **release-it** — a solid single-package release tool. However, for a Turborepo monorepo publishing multiple packages (`@nestjs-odata/core`, `@nestjs-odata/typeorm`), Changesets is the correct choice.

**Why Changesets over release-it:**
- release-it does not have built-in multi-package monorepo support
- Changesets was designed for monorepos first — it tracks which packages changed and bumps versions independently
- Turborepo's official documentation recommends Changesets
- The GitHub Changesets action creates automated "Version Packages" PRs — gives you a review gate before every release

**Why Changesets over semantic-release:**
- semantic-release's monorepo plugin (`semantic-release-monorepo`) is community-maintained and was last updated in 2022
- semantic-release requires strictly linear commit history — incompatible with squash-merging
- Changesets is unopinionated about git workflow — squash merges work fine

**Setup:**

```bash
pnpm add -D @changesets/cli
pnpm exec changeset init
```

**`.changeset/config.json`:**
```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/changelog-github",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

Use `@changesets/changelog-github` for changelogs that include PR links and contributor names.

**`package.json` scripts (root):**
```json
{
  "scripts": {
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "turbo run build && changeset publish"
  }
}
```

**Contributor workflow:**
1. Make change, open PR
2. Run `pnpm changeset` to describe what changed (patch/minor/major + description)
3. Commit the `.changeset/*.md` file with the PR
4. Changeset bot comments on PR indicating whether a changeset was added
5. On merge to main, Changesets Action opens a "Version Packages" PR
6. Merge the Version Packages PR to publish

**Changeset bot** (`changeset-bot` GitHub App): Install from the GitHub Marketplace. It comments on every PR reminding contributors to add a changeset if none is present.

---

## 7. Git Hooks Summary

Complete hook setup:

```
.husky/
  pre-commit    → pnpm exec lint-staged
  commit-msg    → pnpm exec commitlint --edit "$1"
```

Root `package.json` `scripts.prepare = "husky"` ensures hooks are installed after `pnpm install`.

`lint-staged.config.mjs`:
```js
export default {
  '**/*.ts': ['eslint --fix', 'prettier --write'],
  '**/*.{json,yml,yaml,md}': ['prettier --write'],
};
```

Do not add `tsc --noEmit` to pre-commit. Run it in CI.

---

## 8. Package Publishing

### .npmrc (root)

```ini
# Required for pnpm workspaces
shamefully-hoist=false
strict-peer-dependencies=false

# Provenance attestation (set per-package via publishConfig or here globally)
provenance=true
```

### package.json per publishable package

Each package (`packages/core/package.json`, `packages/typeorm/package.json`):

```json
{
  "name": "@nestjs-odata/core",
  "version": "0.0.1",
  "license": "MIT",
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "sideEffects": false
}
```

### Build Tool: tsup

Use **tsup** (powered by esbuild) for building TypeScript packages. It produces ESM + CJS dual output with `.d.ts` declarations from a single config.

```ts
// packages/core/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata'],
});
```

**Why tsup over tsc directly:** Zero config, esbuild speed, automatic ESM/CJS dual output, `.d.ts` bundling. tsc alone cannot produce ESM and CJS simultaneously without multiple tsconfig files and custom scripts.

### Trusted Publishing (OIDC)

npm Trusted Publishing (OIDC-based, no long-lived tokens) is now generally available (July 2025). It requires:
- npm CLI 11.5.1+
- Node.js 22.14.0+
- A Trusted Publisher configured on npmjs.com

This is the recommended approach over NPM_TOKEN secrets for 2025+. Configure in the release workflow using `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` as a fallback until OIDC setup is done (OIDC requires up-front npmjs.com configuration).

### What NOT to publish

`.npmignore` or `files` in package.json (prefer `files`):
- Source files (`src/`)
- Test files (`**/*.spec.ts`, `**/*.e2e-spec.ts`)
- Config files (`tsup.config.ts`, `jest.config.ts`, etc.)
- `.husky/`

---

## 9. License: MIT

MIT is the correct choice. It is the most popular license in the npm ecosystem and is compatible with NestJS's own MIT license and all peer dependencies.

**Considerations:**

1. **SPDX identifier**: Use `"license": "MIT"` in package.json (SPDX identifier). Do not use `"license": "MIT License"` or other variants.

2. **LICENSE file**: Include a `LICENSE` file at the repo root with the standard MIT text, year, and copyright holder. pnpm workspaces automatically includes the root `LICENSE` when publishing packages that don't have their own.

3. **Copyright year**: Use the year of initial publication, not a range. Some projects use `2025-present` — both are acceptable but a single year is simpler.

4. **No dual-licensing needed**: Since all dependencies (NestJS, TypeORM) are MIT/Apache-2.0, there are no compatibility concerns. MIT sublicensing is unrestricted.

---

## 10. Security

### Dependabot

**`.github/dependabot.yml`:**

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      development-dependencies:
        dependency-type: "development"
    ignore:
      # Avoid major version bumps for core NestJS peerDeps
      - dependency-name: "@nestjs/*"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

Group development dependencies to reduce PR noise. Use the `groups` feature (available since Dependabot v2) to batch minor/patch dev dep updates into a single PR per week.

### CodeQL

**`.github/workflows/codeql.yml`:**

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'  # Monday at 6am

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    steps:
      - uses: actions/checkout@v4

      - uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript

      - uses: github/codeql-action/autobuild@v4

      - uses: github/codeql-action/analyze@v4
```

Note: Use **CodeQL Action v4** (released October 2025). v3 is deprecated in December 2026.

### npm audit

Add to CI workflow:

```yaml
- name: Audit dependencies
  run: pnpm audit --audit-level=high
```

Run with `--audit-level=high` to fail on high/critical vulnerabilities only. Low/moderate are acceptable noise in CI; address them via Dependabot PRs.

### SECURITY.md

Create a `.github/SECURITY.md` (or root `SECURITY.md`) to tell security researchers how to disclose vulnerabilities:

```markdown
# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

Please do NOT open public GitHub issues for security vulnerabilities.

Report vulnerabilities via [GitHub Private Vulnerability Reporting](https://github.com/your-org/nestjs-odata/security/advisories/new)
or email security@your-domain.com.

We will respond within 48 hours and aim to release a patch within 7 days for critical issues.
```

Enable **GitHub Private Vulnerability Reporting** in the repo Security settings — it's free and is the recommended disclosure mechanism for open-source projects.

---

## Recommended Setup: Execution Checklist

This is the order in which to set up tooling in Phase 1 (scaffolding):

### Step 1: Repo Structure

```
nestjs-odata/
├── .changeset/
│   └── config.json
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
├── .husky/
│   ├── pre-commit
│   └── commit-msg
├── packages/
│   ├── core/
│   └── typeorm/
├── apps/
│   └── test-app/
├── docs/
├── eslint.config.mjs
├── .prettierrc
├── .prettierignore
├── commitlint.config.cjs
├── lint-staged.config.mjs
├── turbo.json
├── pnpm-workspace.yaml
├── .npmrc
├── LICENSE
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
└── package.json (root)
```

### Step 2: Install Order

```bash
# 1. Init Turborepo and pnpm workspace (if not done)

# 2. ESLint + Prettier
pnpm add -D -w eslint @eslint/js typescript-eslint eslint-config-prettier prettier
pnpm add -D -w @darraghor/eslint-plugin-nestjs-typed

# 3. Git hooks
pnpm add -D -w husky lint-staged
pnpm exec husky init

# 4. Commit linting
pnpm add -D -w @commitlint/cli @commitlint/config-conventional

# 5. Changesets
pnpm add -D -w @changesets/cli @changesets/changelog-github
pnpm exec changeset init

# 6. Build tool (per package)
pnpm add -D tsup  # in packages/core and packages/typeorm

# 7. TypeDoc + VitePress (docs)
pnpm add -D -w vitepress typedoc typedoc-plugin-markdown
```

### Step 3: turbo.json tasks

```json
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

---

## What the Official NestJS Repos Actually Use (Reference)

| Tool | nestjs/typeorm | nestjs/swagger | Recommendation for nestjs-odata |
|------|---------------|----------------|----------------------------------|
| ESLint | flat config (eslint.config.mjs) | flat config (eslint.config.mjs) | Same — ESLint 9 flat config |
| Prettier | .prettierrc | .prettierrc | Same — minimal config |
| Commitlint | config-angular | config-angular | config-conventional (more modern) |
| Git hooks | Husky | Husky | Husky v9 |
| Release | release-it | release-it | Changesets (better for monorepo) |
| CI | CircleCI + GH Actions | CircleCI + GH Actions | GitHub Actions only (simpler) |
| Dependency updates | renovate.json | not found | Dependabot (simpler, free) |

Note: The official NestJS repos still use CircleCI alongside GitHub Actions. For a new greenfield project there is no reason to add CircleCI — GitHub Actions handles everything and reduces the number of external integrations.

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| ESLint flat config | HIGH | Official NestJS repos confirmed using eslint.config.mjs |
| Prettier config | HIGH | Direct inspection of nestjs/swagger .prettierrc |
| Commitlint | HIGH | Official NestJS .commitlintrc.json inspected + official docs |
| Husky vs Lefthook | HIGH | NestJS uses Husky; performance difference negligible for this use case |
| Changesets | HIGH | Turborepo official docs recommend Changesets; monorepo-first design |
| GitHub templates | MEDIUM | NestJS/nest .github structure inspected but template content partially inferred |
| VitePress | MEDIUM | Ecosystem trend confirmed; no specific NestJS community library cited |
| npm provenance | HIGH | npm official docs confirm OIDC trusted publishing is GA (July 2025) |
| Dependabot | HIGH | Official GitHub docs; standard practice |
| CodeQL v4 | HIGH | GitHub changelog confirmed v4 release (Oct 2025), v3 deprecation |

---

## Sources

- [NestJS TypeORM repo](https://github.com/nestjs/typeorm) — ESLint, Prettier, commitlint, Husky, release-it configs
- [NestJS Swagger repo](https://github.com/nestjs/swagger) — confirmed same tooling pattern
- [NestJS main repo .github structure](https://github.com/nestjs/nest/tree/master/.github) — issue templates, PR template
- [ESLint flat config docs](https://eslint.org/docs/latest/use/configure/configuration-files)
- [typescript-eslint packages](https://typescript-eslint.io/packages/typescript-eslint/)
- [eslint-plugin-nestjs-typed](https://github.com/darraghoriordan/eslint-plugin-nestjs-typed)
- [Changesets GitHub repo](https://github.com/changesets/changesets)
- [Turborepo publishing libraries guide](https://turborepo.dev/docs/guides/publishing-libraries)
- [Changesets versioning — Vercel Academy](https://vercel.com/academy/production-monorepos/changesets-versioning)
- [npm trusted publishing (OIDC) — npm docs](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance statements — npm docs](https://docs.npmjs.com/generating-provenance-statements/)
- [Husky v9](https://typicode.github.io/husky/)
- [lint-staged](https://github.com/lint-staged/lint-staged)
- [Commitlint configuration](https://commitlint.js.org/reference/configuration.html)
- [tsup docs](https://tsup.egoist.dev/)
- [VitePress](https://vitepress.dev/)
- [typedoc-plugin-markdown VitePress quick start](https://typedoc-plugin-markdown.org/plugins/vitepress/quick-start)
- [CodeQL Action v4 — GitHub Changelog](https://github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3/)
- [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)
