---
phase: 08
plan: 03
subsystem: docs-tooling
tags: [doc-guardian, skill, claude-code-skill, docs-build-verification]
dependency_graph:
  requires:
    - 08-01
    - 08-02
  provides:
    - doc-guardian-skill
    - verified-full-docs-build
  affects:
    - .claude/skills/doc-guardian/SKILL.md
    - .claude/skills/doc-guardian/rules/doc-coverage.md
tech_stack:
  added: []
  patterns:
    - Claude Code skill with YAML frontmatter
    - Source-to-doc mapping tables
key_files:
  created:
    - .claude/skills/doc-guardian/SKILL.md
    - .claude/skills/doc-guardian/rules/doc-coverage.md
  modified: []
decisions:
  - 'doc-guardian skill defaults to diffing against origin/main (full branch diff) with optional base ref override — avoids HEAD~1 pitfall of missing earlier phase commits'
  - 'doc-coverage.md organized into 4 tables: core package, typeorm adapter, test-app, cross-cutting — covers all source file patterns that could affect documentation'
  - 'Task 2 is verification only — full docs build passed without any infrastructure changes needed (all content from Plans 01 and 02 combined builds clean)'
metrics:
  duration_minutes: 8
  completed_date: '2026-04-08'
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 08 Plan 03: Doc-Guardian Skill and Full Build Verification Summary

**One-liner:** Doc-guardian Claude Code skill created with 4-step diff-based doc evaluation workflow and comprehensive source-to-doc mapping covering all core/typeorm/test-app source patterns; full docs pipeline (TypeDoc + VitePress + llms.txt) verified clean with all Phase 08 content.

## Tasks Completed

| Task | Name                                                 | Commit                                | Files                                                                                                                                   |
| ---- | ---------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create doc-guardian skill with source-to-doc mapping | 02a8cc7                               | .claude/skills/doc-guardian/SKILL.md, .claude/skills/doc-guardian/rules/doc-coverage.md                                                 |
| 2    | Verify complete docs build and llms.txt output       | (verification only — no file changes) | Build verified: llms.txt, llms-full.txt, filter-functions.html, getting-started.html, decorators.html, typedoc-sidebar.json all present |

## What Was Built

### Task 1 — Doc-guardian skill (commit `02a8cc7`)

**`.claude/skills/doc-guardian/SKILL.md`** (91 lines):

- YAML frontmatter with `name: doc-guardian` and full description explaining when and how to invoke
- `## When to Use` — after phase plans modifying `packages/core/src/`, `packages/typeorm/src/`, or `apps/test-app/src/`
- `## How It Works` — 4-step workflow:
  1. `git diff origin/main --name-only -- packages/core packages/typeorm` (defaults to `origin/main`; optional base ref override documented)
  2. Map changed files using `rules/doc-coverage.md` tables
  3. For each affected doc: read current doc, read changed source, update doc, verify examples
  4. `cd docs && pnpm build` — must exit 0 before finishing
- `## Rules` — 8 bullet rules preventing regressions (no scratch rewrites, no auto-generated file edits, breaking change migration notes required)
- `## Source Files` — references `@.claude/skills/doc-guardian/rules/doc-coverage.md`

**`.claude/skills/doc-guardian/rules/doc-coverage.md`** (53 lines):

Four mapping tables covering all major source patterns:

1. **Core Package** (13 rows): decorators, odata.module.ts, interfaces, pipes, interceptors, filters, batch, index.ts
2. **TypeORM Adapter** (7 rows): filter-visitor, select-visitor, orderby-visitor, expand-visitor, auto-handler, typeorm-edm-deriver, index.ts
3. **Test App** (2 rows): controllers, modules
4. **Cross-Cutting Changes** (7 rows): new decorator, new config option, new query option, security limit, response format change, new filter function, breaking change

### Task 2 — Full docs build verification (no commits)

Build pipeline `pnpm turbo build` ran clean (4 tasks, 0 cached, 6.81s):

- `typedoc` generated `docs/api/generated/typedoc-sidebar.json` (8.4 KB) and `docs/api/generated/index.md` from `packages/core/src/index.ts`
- VitePress built all pages including `guide/filter-functions.html` (65 KB — new Phase 07 guide from Plan 02)
- `vitepress-plugin-llms` generated `llms.txt` (9.9 KB) and `llms-full.txt` (153 KB) in dist/
- All acceptance criteria files confirmed present

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Deviation: worktree missing node_modules (Rule 3 — auto-fix blocking issue)

- **Found during:** Task 1 commit attempt
- **Issue:** Git pre-commit hook calls `pnpm exec lint-staged` but `node_modules` were not installed in the worktree (they exist only in the main repo). Commit failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "lint-staged" not found`.
- **Fix:** Ran `pnpm install --frozen-lockfile` in the worktree root. Completed in 4.5s using cached packages.
- **Files modified:** none (install only)
- **Commit:** N/A

## Known Stubs

None. The skill files contain real instructions and real mappings — no placeholder content.

## Threat Flags

None. Skill files are development tooling only. No runtime trust boundaries introduced.

## Self-Check

### Created files exist:

- `.claude/skills/doc-guardian/SKILL.md` — FOUND (91 lines, frontmatter valid)
- `.claude/skills/doc-guardian/rules/doc-coverage.md` — FOUND (53 lines, all 4 tables present)

### Build outputs verified:

- `docs/.vitepress/dist/llms.txt` — FOUND (9,991 bytes)
- `docs/.vitepress/dist/llms-full.txt` — FOUND (153,630 bytes)
- `docs/.vitepress/dist/guide/filter-functions.html` — FOUND (65,132 bytes)
- `docs/.vitepress/dist/guide/getting-started.html` — FOUND (69,646 bytes)
- `docs/.vitepress/dist/api/decorators.html` — FOUND (115,021 bytes)
- `docs/api/generated/typedoc-sidebar.json` — FOUND (8,371 bytes)
- `docs/api/generated/index.md` — FOUND (5,156 bytes)

### Commits exist:

- `02a8cc7` — feat(08-03): create doc-guardian skill with source-to-doc mapping — FOUND

## Self-Check: PASSED
