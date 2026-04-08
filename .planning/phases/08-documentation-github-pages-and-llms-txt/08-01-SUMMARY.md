---
phase: 08
plan: 01
subsystem: docs-infrastructure
tags: [vitepress, typedoc, llms-txt, github-pages, documentation]
dependency_graph:
  requires: []
  provides: [docs-build-pipeline, typedoc-api-generation, llms-txt, github-pages-workflow]
  affects:
    [
      docs/package.json,
      docs/.vitepress/config.mts,
      docs/.vitepress/theme/index.ts,
      docs/typedoc.json,
      .github/workflows/docs.yml,
      .gitignore,
    ]
tech_stack:
  added:
    [
      vitepress-plugin-llms@1.12.0,
      typedoc@0.28.18,
      typedoc-plugin-markdown@4.11.0,
      typedoc-vitepress-theme@1.1.2,
    ]
  patterns: [typedoc-before-vitepress sequencing, sanitizeComments for markdown safety]
key_files:
  created:
    - docs/typedoc.json
    - docs/.vitepress/theme/index.ts
    - .github/workflows/docs.yml
  modified:
    - docs/package.json
    - docs/.vitepress/config.mts
    - .gitignore
decisions:
  - 'Use sanitizeComments: true in typedoc.json to escape angle brackets in JSDoc (e.g. Set<string>) which Vue compiler treats as HTML tags'
  - 'TypeDoc tsconfig must point to packages/core/tsconfig.json, not docs/tsconfig.json which only covers .vitepress/ files'
  - 'skipErrorChecking: true required because peer deps (NestJS, rxjs) are not installed in docs/ workspace'
  - 'typedoc output goes to docs/api/generated/ (not docs/api/) to avoid clobbering handwritten decorators.md and module.md'
  - 'pnpm/action-setup@v4 auto-reads packageManager from root package.json; no explicit version pin needed'
metrics:
  duration: 338 seconds
  completed: 2026-04-08
  tasks_completed: 2
  files_changed: 6
---

# Phase 08 Plan 01: Documentation Infrastructure Summary

Wired the full docs build pipeline: TypeDoc API generation from packages/core source, vitepress-plugin-llms for llms.txt output and copy-as-markdown buttons, and GitHub Pages deployment workflow via official GitHub Actions.

## Tasks Completed

| Task | Name                                                                 | Commit  | Files                                                                                                                        |
| ---- | -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | Install deps, create TypeDoc config, wire VitePress config and theme | 532c27b | docs/package.json, docs/typedoc.json, docs/.vitepress/config.mts, docs/.vitepress/theme/index.ts, .gitignore, pnpm-lock.yaml |
| 2    | Create GitHub Pages deployment workflow                              | d5b932c | .github/workflows/docs.yml                                                                                                   |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed invalid typedoc.json option names**

- **Found during:** Task 1, first typedoc run
- **Issue:** Plan specified `anchorFormat` and `entryDocument` — both were rejected by typedoc 0.28.18 as unknown options
- **Fix:** Replaced with valid options: removed `anchorFormat` (no direct equivalent needed), replaced `entryDocument` with `entryFileName`
- **Files modified:** docs/typedoc.json
- **Commit:** 532c27b

**2. [Rule 1 - Bug] Added tsconfig path to typedoc.json**

- **Found during:** Task 1, second typedoc run
- **Issue:** TypeDoc defaulted to docs/tsconfig.json which only includes `.vitepress/**/*.ts`, not the packages/core source files — caused "Unable to find any entry points"
- **Fix:** Added `"tsconfig": "../packages/core/tsconfig.json"` to typedoc.json
- **Files modified:** docs/typedoc.json
- **Commit:** 532c27b

**3. [Rule 1 - Bug] Added skipErrorChecking: true to typedoc.json**

- **Found during:** Task 1, third typedoc run
- **Issue:** TypeDoc reported 43 TypeScript errors because NestJS, rxjs, and reflect-metadata are peer dependencies not installed in the docs/ package workspace
- **Fix:** Added `"skipErrorChecking": true` — TypeDoc still reads and documents the public API, it just ignores unresolved peer dep types
- **Files modified:** docs/typedoc.json
- **Commit:** 532c27b

**4. [Rule 1 - Bug] Added sanitizeComments: true to typedoc.json**

- **Found during:** Task 1, VitePress build step
- **Issue:** JSDoc comment "stores Set<string> of excluded property names" was rendered as raw markdown; VitePress/Vue compiler treated `<string>` as an unclosed HTML tag, causing "Element is missing end tag" build error
- **Fix:** Added `"sanitizeComments": true` which escapes angle brackets in comments as `\<string\>`, preventing Vue compiler parse errors
- **Files modified:** docs/typedoc.json
- **Commit:** 532c27b

**5. [Rule 1 - Bug] Reverted isCustomElement: () => true from VitePress config**

- **Found during:** Task 1, attempt to fix the Set<string> error via vue config
- **Issue:** Setting `isCustomElement: () => true` to suppress HTML tag parsing broke VitePress's own Layout.vue (returned "Cannot read properties of undefined (reading 'type')")
- **Fix:** Removed the `vue.template.compilerOptions` block; used `sanitizeComments` in typedoc instead
- **Files modified:** docs/.vitepress/config.mts
- **Commit:** 532c27b

## Known Stubs

None — the pipeline generates real TypeDoc output from live source. No placeholder content.

## Threat Flags

| Flag                              | File                       | Description                                                                                                                                                       |
| --------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| threat_flag: workflow-permissions | .github/workflows/docs.yml | New workflow has `pages: write` and `id-token: write` permissions — mitigated by push-to-main trigger only (no pull_request_target), matching T-08-01 disposition |

## Self-Check: PASSED

| Item                                    | Status |
| --------------------------------------- | ------ |
| docs/typedoc.json                       | FOUND  |
| docs/.vitepress/theme/index.ts          | FOUND  |
| .github/workflows/docs.yml              | FOUND  |
| docs/api/generated/typedoc-sidebar.json | FOUND  |
| docs/.vitepress/dist/llms.txt           | FOUND  |
| commit 532c27b                          | FOUND  |
| commit d5b932c                          | FOUND  |
