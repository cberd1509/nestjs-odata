---
phase: 05-batch-security-and-v1-hardening
plan: '05'
subsystem: packaging
tags: [packaging, exports, publint, attw, typecheck]
dependency_graph:
  requires: []
  provides: [correct-package-exports]
  affects: [packages/core, packages/typeorm]
tech_stack:
  added: []
  patterns: [split-condition-exports]
key_files:
  created: []
  modified:
    - packages/core/package.json
    - packages/typeorm/package.json
decisions:
  - Split exports conditions (import.types + require.types) instead of a single top-level types key — eliminates the publint warning about CJS consumers not getting correct types
metrics:
  duration: ~3 minutes
  completed: '2026-04-07'
  tasks_completed: 1
  tasks_total: 1
  files_modified: 2
---

# Phase 5 Plan 05: Fix Package Exports Summary

Split-condition exports with per-format types fields so publint and @arethetypeswrong/cli both pass cleanly with zero errors for both packages.

## What Was Done

**Task 1 — Fix package.json exports for both packages** (commit `895eb2b`)

Two gaps were present from Phase 5 verification:

1. `packages/typeorm/package.json` had `exports["."].types` pointing to `./dist/index.d.ts` — a file that tsdown never produces. tsdown outputs `index.d.mts` (ESM) and `index.d.cts` (CJS).
2. `packages/core/package.json` had the `types` key as the last key in `exports["."]` instead of first, which publint flags as an error.

Both were fixed by adopting the split-condition pattern:

```json
"exports": {
  ".": {
    "import": {
      "types": "./dist/index.d.mts",
      "default": "./dist/index.mjs"
    },
    "require": {
      "types": "./dist/index.d.cts",
      "default": "./dist/index.cjs"
    }
  }
}
```

This is strictly better than a single top-level `types` key because CJS consumers resolve `index.d.cts` while ESM consumers resolve `index.d.mts`, giving each format the correct declaration file.

## Verification Results

**publint:**

- `@nestjs-odata/core` — exit 0, zero errors, zero warnings (one suggestion about `"type"` field, not an error)
- `@nestjs-odata/typeorm` — exit 0, zero errors, zero warnings

**@arethetypeswrong/cli:**

- `@nestjs-odata/core` — exit 0, "No problems found", all four resolution modes green
- `@nestjs-odata/typeorm` — exit 0, "No problems found", all four resolution modes green

**pnpm build** — all packages built successfully, no errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Split exports into per-condition types**

- **Found during:** Task 1 verification
- **Issue:** After placing `"types"` as the first key at the exports root level, publint emitted a warning that CJS consumers would incorrectly receive ESM types (`index.d.mts`) when resolving via `require`. This is a correctness issue for CJS consumers.
- **Fix:** Replaced the single `types` key with split `import.types` and `require.types` conditions pointing to the correct declaration files for each format.
- **Files modified:** `packages/core/package.json`, `packages/typeorm/package.json`
- **Commit:** 895eb2b

## Known Stubs

None.

## Threat Flags

None — this is a packaging metadata fix only, no new network surface or trust boundaries introduced.

## Self-Check: PASSED

- packages/core/package.json — modified with correct exports
- packages/typeorm/package.json — modified with correct exports
- commit 895eb2b exists and contains both files
