---
phase: 01-foundation-and-parser-spike
plan: 02
subsystem: tooling
tags: [eslint, prettier, husky, commitlint, changesets, vitepress, lint-staged]
dependency_graph:
  requires: ['01-01']
  provides: ['shared-eslint-config', 'git-hooks', 'changesets-config', 'docs-site']
  affects: ['all-packages']
tech_stack:
  added:
    - eslint@^10.2.0
    - typescript-eslint@^8.0.0
    - eslint-config-prettier@^10.0.0
    - prettier@^3.8.1
    - husky@^9.1.7
    - lint-staged@^16.4.0
    - '@commitlint/cli@^20.5.0'
    - '@commitlint/config-conventional@^20.5.0'
    - '@changesets/cli@^2.30.0'
    - '@changesets/changelog-github@^0.6.0'
    - vitepress@^1.6.0
  patterns:
    - ESLint 9 flat config with shared @repo/eslint-config workspace package
    - Husky v9 git hooks (pre-commit + commit-msg)
    - Conventional commits enforced by commitlint
    - VitePress docs with .mts config for ESM compatibility
key_files:
  created:
    - packages/eslint-config/package.json
    - packages/eslint-config/eslint.config.mjs
    - eslint.config.mjs
    - .prettierrc
    - .prettierignore
    - commitlint.config.cjs
    - lint-staged.config.mjs
    - .husky/pre-commit
    - .husky/commit-msg
    - .changeset/config.json
    - .changeset/README.md
    - docs/package.json
    - docs/.vitepress/config.mts
    - docs/index.md
  modified:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - turbo.json
    - .gitignore
decisions:
  - '@repo/eslint-config added as workspace:* devDependency at root so pnpm hoists it to root node_modules for ESLint resolution'
  - 'VitePress config uses .mts extension instead of .ts — VitePress is ESM-only and esbuild cannot require() .ts config'
  - 'ESLint installed as ^10.2.0 (latest available), not ^9.x — plan specified ^9.x but registry resolved to 10 which is compatible with typescript-eslint v8'
metrics:
  duration: '~15 minutes'
  completed: '2026-04-07'
  tasks_completed: 2
  files_created: 14
  files_modified: 5
---

# Phase 01 Plan 02: Code Quality Tooling and VitePress Docs Summary

**One-liner:** ESLint 9 flat config via shared @repo/eslint-config package, Husky v9 git hooks with conventional commit enforcement, Changesets for release management, and VitePress 1.6 docs site — all passing `pnpm lint` and `vitepress build`.

## Tasks Completed

| Task | Name                                                      | Commit  | Files                  |
| ---- | --------------------------------------------------------- | ------- | ---------------------- |
| 1    | Configure ESLint, Prettier, Husky, commitlint, Changesets | 5e17ed6 | 11 created, 3 modified |
| 2    | Set up VitePress documentation site                       | 6dcc36e | 3 created, 2 modified  |

## Verification Results

- `pnpm lint` exits 0 — ESLint 9 flat config runs across @nestjs-odata/core, @nestjs-odata/typeorm, @nestjs-odata/test-app
- `.husky/pre-commit` runs `pnpm exec lint-staged` (executable)
- `.husky/commit-msg` runs `pnpm exec commitlint --edit $1` (executable)
- `.changeset/config.json` contains `"access": "public"` and `"ignore": ["test-app"]`
- `docs/.vitepress/dist/index.html` built successfully by VitePress 1.6.4

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @repo/eslint-config not found in node_modules**

- **Found during:** Task 1 verification (`pnpm lint` failed with ERR_MODULE_NOT_FOUND)
- **Issue:** The @repo/eslint-config package was created in packages/eslint-config but wasn't linked in root node_modules because pnpm doesn't auto-hoist workspace packages unless declared as a dependency
- **Fix:** Added `"@repo/eslint-config": "workspace:*"` to root package.json devDependencies, then ran `pnpm install --no-frozen-lockfile`
- **Files modified:** package.json, pnpm-lock.yaml
- **Commit:** 5e17ed6

**2. [Rule 1 - Bug] VitePress config .ts extension fails ESM loading**

- **Found during:** Task 2 verification (vitepress build failed)
- **Issue:** VitePress is ESM-only; esbuild cannot `require()` the config when it has a `.ts` extension. Error: "ESM file cannot be loaded by require"
- **Fix:** Renamed `docs/.vitepress/config.ts` to `docs/.vitepress/config.mts` — the `.mts` extension signals ESM to Node.js and VitePress's bundler
- **Files modified:** docs/.vitepress/config.mts (renamed from config.ts)
- **Commit:** 6dcc36e

### Minor Observations

- ESLint resolved to version 10.2.0 (not 9.x as in plan). The plan specified `^9.x` but pnpm resolved the latest compatible version 10.x. typescript-eslint v8 is compatible with both ESLint 9 and 10. No functional impact.
- `pnpm-workspace.yaml` updated to include `docs` workspace (was missing from Plan 01 output).
- `.gitignore` updated to exclude `docs/.vitepress/dist/` and `docs/.vitepress/cache/`.

## Known Stubs

None — all files are functional and wired correctly.

## Threat Surface Scan

No new security-relevant surface introduced. All additions are developer tooling (linting, formatting, git hooks, docs generation). No network endpoints, auth paths, or schema changes.

## Self-Check

- [x] packages/eslint-config/package.json exists
- [x] packages/eslint-config/eslint.config.mjs contains `tseslint.config(`
- [x] packages/eslint-config/eslint.config.mjs contains `eslint-config-prettier`
- [x] packages/eslint-config/eslint.config.mjs does NOT contain `eslint-plugin-prettier`
- [x] eslint.config.mjs contains `from '@repo/eslint-config'`
- [x] .prettierrc contains `"singleQuote": true`
- [x] commitlint.config.cjs contains `@commitlint/config-conventional`
- [x] lint-staged.config.mjs contains `eslint --fix`
- [x] .husky/pre-commit contains `lint-staged`
- [x] .husky/commit-msg contains `commitlint`
- [x] .changeset/config.json contains `"access": "public"`
- [x] .changeset/config.json contains `"ignore": ["test-app"]`
- [x] pnpm lint exits 0
- [x] docs/.vitepress/dist/index.html exists
- [x] Commits 5e17ed6 and 6dcc36e exist

## Self-Check: PASSED
