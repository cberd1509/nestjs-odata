---
phase: quick
plan: ox4
subsystem: packaging
tags: [npm, metadata, readme, changeset, release]
key-files:
  modified:
    - packages/core/package.json
    - packages/typeorm/package.json
    - .changeset/config.json
  created:
    - packages/core/README.md
    - packages/typeorm/README.md
decisions:
  - Updated typeorm peerDep on core from >=0.0.1 to >=1.0.0 to match bumped version
metrics:
  duration: ~5min
  completed: 2026-04-08
  tasks: 2
  files: 5
---

# Quick Task ox4: Fix npm Publish Metadata for Both Packages

**One-liner:** npm metadata corrected for v1.0.0 release — repository links, keywords, CHANGELOG removed from files array, changeset repo fixed, and per-package READMEs created.

## Tasks Completed

| Task | Name                                           | Commit  | Files                                                                             |
| ---- | ---------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| 1    | Update package.json metadata for both packages | c63755e | packages/core/package.json, packages/typeorm/package.json, .changeset/config.json |
| 2    | Create per-package README.md files             | 3848e04 | packages/core/README.md, packages/typeorm/README.md                               |

## What Was Done

### Task 1: package.json metadata

Both `packages/core/package.json` and `packages/typeorm/package.json` were updated:

- Version bumped from `0.0.2` / `0.0.1` to `1.0.0`
- Added `repository` field with correct `cberd1509/nestjs-odata` GitHub URL and per-package `directory`
- Added `homepage` pointing to the GitHub repo README
- Added `bugs.url` pointing to GitHub Issues
- Added `keywords` arrays (nestjs, odata, odata-v4, rest, api, edm, metadata/typeorm/orm-adapter)
- Removed `CHANGELOG.md` from `files` arrays (the file does not exist; leaving it causes npm publish warnings)
- `.changeset/config.json` repo changed from `your-org/nestjs-odata` to `cberd1509/nestjs-odata`
- typeorm package `peerDependencies` for `@nestjs-odata/core` updated to `>=1.0.0`

### Task 2: per-package READMEs

- `packages/core/README.md` (55 lines): badges, feature list, install command, quick-start NestJS module example, docs and repo links
- `packages/typeorm/README.md` (58 lines): badges, feature list, install command, TypeORM entity + controller example, docs and repo links

Both READMEs reference docs at `https://cberd1509.github.io/nestjs-odata/`.

## Verification

- Metadata validation script: all assertions passed
- `pnpm build`: 4 tasks successful, build complete

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- packages/core/package.json: version 1.0.0, repository cberd1509, keywords present, no CHANGELOG.md in files
- packages/typeorm/package.json: version 1.0.0, repository cberd1509, keywords present, no CHANGELOG.md in files
- .changeset/config.json: repo = cberd1509/nestjs-odata
- packages/core/README.md: exists, 55 lines
- packages/typeorm/README.md: exists, 58 lines
- Commits c63755e and 3848e04 verified in git log
