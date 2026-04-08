---
name: doc-guardian
description: 'Evaluates whether code changes require documentation updates and applies them. Invoke after a phase plan completes, when diffs touch packages/core or packages/typeorm source files. Reads the git diff, checks the source-to-doc mapping in rules/doc-coverage.md, reads affected doc files, and updates them to reflect the code changes.'
---

# Doc Guardian

Keep documentation in sync with implementation after every phase plan that modifies source code.
This skill is invoked after a phase executor completes. It reads the diff against the base branch,
determines which doc files are affected, reads those docs, and updates them to reflect new or
changed API surface.

## When to Use

Invoke this skill after completing a phase plan that modifies files in:

- `packages/core/src/` — decorators, module options, pipes, interceptors, filters, batch
- `packages/typeorm/src/` — translators (filter, select, orderby, expand), auto-handler, EDM deriver
- `apps/test-app/src/` — controllers or modules that illustrate real usage patterns

Do NOT invoke for changes to `.planning/`, `.github/workflows/`, `docs/`, or test files alone —
those changes do not require documentation updates.

## How It Works

### Step 1: Read the diff against the base branch

Run:

```bash
git diff origin/main --name-only -- packages/core packages/typeorm
```

This lists all source files that changed relative to `origin/main`. Accept an optional base ref
argument to override (e.g., `git diff HEAD~3 --name-only -- packages/core packages/typeorm` if you
need to scope to the last few commits rather than the full branch diff).

### Step 2: Map changed files to affected docs

Using the mapping defined in `rules/doc-coverage.md`, identify every documentation file that may
need updating. For each changed source file, look up its row in the Core Package, TypeORM Adapter,
or Test App tables and note the Affected Docs column.

If a single source file maps to multiple doc files, all of them are candidates — read each one and
decide whether the specific change warrants an update.

### Step 3: For each affected doc file, update it

For each doc file identified in Step 2:

a. Read the current doc content to understand what is already documented.

b. Read the changed source files to understand what actually changed (new functions, changed
signatures, new options, removed behavior, renamed identifiers).

c. Update the doc to reflect the new API surface, config options, or behavior. Keep the existing
style and structure — do not rewrite sections that are still accurate.

d. Verify that every code example in the updated sections still matches the real implementation.
Check function signatures, parameter names, return types, and import paths.

### Step 4: Verify the build

After making all documentation changes, run:

```bash
cd docs && pnpm build
```

The build must exit with code 0. If it fails, fix the VitePress/TypeDoc issue before finishing.

## Rules

- Do NOT regenerate docs from scratch — update only what changed
- Do NOT modify auto-generated TypeDoc output (files in `docs/api/generated/`)
- Every code example must be verifiable against the actual source
- If a decorator signature changed, update both `docs/api/decorators.md` and any guide that references it
- If a new feature was added, add it to the relevant guide AND the API reference
- If a config option was added, update `docs/api/module.md` and `docs/guide/configuration.md`
- If a filter function was added, update `docs/guide/filter-functions.md` with correct syntax, SQL mapping, and examples
- If unsure whether a change requires doc updates, err on the side of updating
- If a breaking change occurred (signature changed, option renamed), call it out explicitly in the doc update with a migration note

## Source Files

The complete source-to-doc mapping is defined in:

@.claude/skills/doc-guardian/rules/doc-coverage.md

Consult that file for the authoritative table of which source file changes affect which documentation
files. The mapping covers the core package, TypeORM adapter, test app, and cross-cutting changes.
