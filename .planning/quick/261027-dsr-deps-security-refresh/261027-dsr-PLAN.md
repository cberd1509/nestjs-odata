---
phase: quick
plan: dsr
type: execute
---

# Quick task 261027-dsr: dependency security refresh

Clear the open Dependabot alerts (all dev tooling in pnpm-lock.yaml) and fold the open
Dependabot PRs into one branch (`chore/deps-security-refresh`).

1. Bump direct dev dependencies (Vitest 4, commitlint 21, lint-staged 17, typescript-eslint 8.72,
   attw, odata2ts), `pnpm update -r` within ranges, raise `pnpm.overrides` floors.
2. Fix Vitest 4 / lint fallout; keep the SWC decorator-metadata setup.
3. Verify `pnpm audit` is clean and the CI pipeline plus docs build pass.
4. Bump actions/checkout and actions/setup-node to v7. Published peer ranges stay unchanged.
