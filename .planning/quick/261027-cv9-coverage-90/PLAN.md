---
slug: coverage-90
date: 2026-10-27
branch: test/coverage-90
---

# Raise coverage thresholds to 90% (core + typeorm)

Raise the Vitest coverage thresholds of `@nestjs-odata/core` and `@nestjs-odata/typeorm` to 90%
for statements, branches, functions and lines, met with real tests (no `v8 ignore`, no new
exclusions). Remove typeorm's temporary 70% branch threshold.

## Tasks

1. Measure the starting coverage per package and metric; list the least-covered files.
2. Core: behaviour tests for parser/lexer, `$search`/`$apply`, batch parser and dispatch, query
   pipe validation, response interceptor, exception filter, module `configure()`.
3. TypeORM: module wiring in a real Nest container on SQLite; filter functions in `not()` and
   lambdas; many-to-many lambdas; scope fail-closed paths; `$batch` allow-list, body sources and
   changeset runner; deep insert failure modes; helpers.
4. Bugs found by the tests: failing test first, minimal `fix:` commit, changeset.
5. Thresholds to 90 in both configs; CONTRIBUTING.md.
6. Verify: build, lint, typecheck, `turbo test -- --coverage`, docs build.
