---
phase: 01-foundation-and-parser-spike
plan: '03'
subsystem: ci-cd-governance
tags: [github-actions, ci-cd, dependabot, codeql, odata-agent, oss-governance]
dependency_graph:
  requires: ['01-01']
  provides:
    [
      ci-pipeline,
      release-pipeline,
      security-scanning,
      dependency-monitoring,
      odata-expert-agent,
      oss-templates,
    ]
  affects: [all-future-phases]
tech_stack:
  added: [github-actions, changesets, codeql, dependabot]
  patterns: [oidc-trusted-publishing, matrix-ci, weekly-security-scanning, grouped-dependabot-prs]
key_files:
  created:
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - .github/workflows/codeql.yml
    - .github/dependabot.yml
    - .github/ISSUE_TEMPLATE/bug_report.yml
    - .github/ISSUE_TEMPLATE/feature_request.yml
    - .github/ISSUE_TEMPLATE/config.yml
    - .github/PULL_REQUEST_TEMPLATE.md
    - .github/SECURITY.md
    - CONTRIBUTING.md
    - CODE_OF_CONDUCT.md
  modified: []
decisions:
  - OIDC trusted publishing via id-token:write — no long-lived NPM_TOKEN secret stored in GitHub
  - Node matrix 20 and 22 for CI coverage of both supported LTS versions
  - Dependabot groups dev dependencies to reduce PR noise (max 10 open at once)
  - CodeQL weekly Monday schedule plus PR trigger for maximum coverage
  - OData expert agent deferred — sandbox restriction prevented writing to .claude/agents/ path
metrics:
  duration_minutes: 16
  completed_date: '2026-04-07'
  tasks_completed: 1
  tasks_total: 2
  files_created: 11
  files_modified: 0
---

# Phase 01 Plan 03: GitHub CI/CD, OSS Governance, and OData Expert Agent Summary

**One-liner:** GitHub Actions CI with Node 20/22 matrix, OIDC Changesets release, CodeQL weekly scanning, Dependabot npm+actions monitoring, and full OSS governance templates.

## What Was Built

### Task 1 — GitHub Actions Workflows, Dependabot Config, and GitHub Templates (COMPLETE)

All GitHub CI/CD infrastructure and OSS governance files created and committed at `8cb4c01`:

**CI Pipeline (`.github/workflows/ci.yml`):**

- Node.js matrix: 20 and 22
- Steps: `pnpm turbo lint` → `pnpm turbo typecheck` → `pnpm turbo test` → `pnpm turbo build`
- Package export validation: `@arethetypeswrong/cli --pack` and `publint` for both `packages/core` and `packages/typeorm`
- Concurrency group with cancel-in-progress for PRs

**Release Pipeline (`.github/workflows/release.yml`):**

- OIDC trusted publishing via `id-token: write` permission
- No `NPM_TOKEN` secret — short-lived OIDC token per workflow run
- Changesets action: creates a "Version Packages" PR on merge, publishes on that PR merge
- Builds before publish: `pnpm turbo build`

**Security Scanning (`.github/workflows/codeql.yml`):**

- Language: `javascript-typescript`
- Triggers: push to main, PRs, weekly Monday 06:00 UTC schedule
- `security-events: write` permission for uploading SARIF results

**Dependency Monitoring (`.github/dependabot.yml`):**

- npm ecosystem: weekly Monday, max 10 open PRs, dev dependencies grouped (minor+patch)
- github-actions ecosystem: weekly Monday

**OSS Templates:**

- `bug_report.yml`: structured bug report with package version, NestJS version, Node.js version
- `feature_request.yml`: feature description + use case + alternatives
- `config.yml`: blank issues disabled, docs link
- `PULL_REQUEST_TEMPLATE.md`: type of change checklist + CI checklist with `pnpm changeset`
- `SECURITY.md`: email-based vulnerability reporting (not public issues)
- `CONTRIBUTING.md`: setup + conventional commits + PR flow + changeset instructions
- `CODE_OF_CONDUCT.md`: Contributor Covenant v2.1

### Task 2 — OData v4 Expert Sub-Agent (DEFERRED — sandbox restriction)

The OData expert sub-agent was planned for `.claude/agents/odata-expert.md`. During execution, all write operations targeting any path containing `.claude/` as a subdirectory component were denied by the execution sandbox security restriction. This blocked creation of `.claude/agents/odata-expert.md`.

**Impact:** The agent definition is not committed to the repository in this plan. The OASIS spec knowledge, ABNF grammar reference, operator precedence table, and TypeScript/NestJS implementation patterns that would have constituted the agent's system prompt are documented here for reference and must be created manually or in a subsequent execution that has `.claude/` write access.

**Agent specification (for manual creation at `.claude/agents/odata-expert.md`):**

```yaml
---
name: odata-expert
description: OData v4 specification expert for implementation guidance, grammar interpretation, CSDL structure, error format, and code compliance review. Sources: OASIS OData v4.01 Protocol, URL Conventions, ABNF grammar, and odata.org documentation.
tools: Read, WebFetch, Grep, Glob
---
```

Primary references the agent should use:

- Protocol (Part 1): https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html
- URL Conventions (Part 2): https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html
- ABNF Grammar: https://docs.oasis-open.org/odata/odata/v4.01/cs01/abnf/odata-abnf-construction-rules.txt
- JSON Format: https://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html

Key knowledge the agent must cover: $filter ABNF structure, operator precedence, literal types, string/date/math functions, lambda operators (any/all), CSDL entity/navigation/complex types, OData JSON response envelope format, error format (Part 1 §9.3), EDM primitive type mappings to TypeScript/TypeORM, discriminated union AST design, recursive descent + Pratt parsing approach.

## Deviations from Plan

### Deferred Issues

**1. [Sandbox Restriction] Task 2 blocked — cannot write to .claude/agents/ path**

- **Found during:** Task 2 execution
- **Issue:** The execution sandbox security policy denies all Write and Bash operations targeting paths that contain `.claude/` as a subdirectory component (e.g., `/repos/nestjs-odata/.claude/worktrees/agent-ab7bf79e/.claude/agents/`). This blocks creating the OData expert sub-agent file.
- **Attempted paths:** `/Users/carlosber/repos/nestjs-odata/.claude/worktrees/agent-ab7bf79e/.claude/agents/odata-expert.md` and `/Users/carlosber/repos/nestjs-odata/.claude/agents/odata-expert.md` — both denied.
- **Resolution required:** User must manually create `.claude/agents/odata-expert.md` in the project root, or run this task in an environment with `.claude/` write access.
- **Files modified:** None

## Threat Mitigations Applied

Per plan threat model:

| Threat ID | Status    | Implementation                                                                         |
| --------- | --------- | -------------------------------------------------------------------------------------- |
| T-01-05   | Mitigated | `id-token: write` + no NPM_TOKEN in release.yml                                        |
| T-01-06   | Mitigated | All actions pinned to @v4/@v3 major tags; Dependabot monitors github-actions ecosystem |
| T-01-07   | Mitigated | SECURITY.md uses email-based private disclosure                                        |
| T-01-08   | Mitigated | `open-pull-requests-limit: 10` + dev dependency grouping in dependabot.yml             |

## Known Stubs

None in created files — all GitHub workflow and template files are complete and non-stub.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced by GitHub config files.

## Self-Check: PARTIAL

**Files verified present:**

- `.github/workflows/ci.yml` — FOUND
- `.github/workflows/release.yml` — FOUND
- `.github/workflows/codeql.yml` — FOUND
- `.github/dependabot.yml` — FOUND
- `.github/ISSUE_TEMPLATE/bug_report.yml` — FOUND
- `.github/ISSUE_TEMPLATE/feature_request.yml` — FOUND
- `.github/ISSUE_TEMPLATE/config.yml` — FOUND
- `.github/PULL_REQUEST_TEMPLATE.md` — FOUND
- `.github/SECURITY.md` — FOUND
- `CONTRIBUTING.md` — FOUND
- `CODE_OF_CONDUCT.md` — FOUND
- `.claude/agents/odata-expert.md` — MISSING (sandbox restriction)

**Commits verified:**

- `8cb4c01` — FOUND (chore(01-03): add GitHub Actions workflows, Dependabot config, and GitHub templates)
