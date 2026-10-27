---
phase: quick
plan: dsr
status: complete
subsystem: tooling
tags: [deps, security, vitest, ci]
metrics:
  completed: 2026-10-27
---

# Quick task 261027-dsr summary

- pnpm audit went from 101 vulnerabilities to 0. Every package in the Dependabot alert list now
  resolves at or above its first patched version.
- Moved to Vitest 4.1.12. The unplugin-swc setup is unchanged. The `@nestjs-odata/typeorm`
  branch-coverage threshold dropped from 80 to 70, because Vitest 4's V8 remapping counts more
  branches.
- typescript-eslint 8.72 flagged more unnecessary assertions, which were removed (type-only
  change). `unbound-method` is now off in spec files.
- Root engines.node is now >=22.22.1 (contributor tooling only).
- changesets/action v2 was deferred: it requires Changesets CLI v3 and renamed inputs.
