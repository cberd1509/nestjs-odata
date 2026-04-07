# Phase 5: $batch, Security, and v1 Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 05-batch-security-and-v1-hardening
**Areas discussed:** $batch request handling, Security limits & query complexity, Release pipeline & package quality, Gap closure from Phase 4

---

## $batch Request Handling

### Batch parsing

| Option                  | Description                                           | Selected |
| ----------------------- | ----------------------------------------------------- | -------- |
| Custom multipart parser | Parse multipart/mixed per OData spec, no external dep | ✓        |
| Use existing library    | Adapt a multipart parser library                      |          |
| You decide              |                                                       |          |

**User's choice:** Custom multipart parser (Recommended)
**Notes:** User asked for explanation of $batch concept before answering. After explanation of multipart/mixed format, changesets vs independent requests, and enterprise use cases, user understood and selected recommended options.

### Changeset rollback

| Option                  | Description                                     | Selected |
| ----------------------- | ----------------------------------------------- | -------- |
| Full changeset rollback | TypeORM QueryRunner transaction, all-or-nothing | ✓        |
| You decide              |                                                 |          |

**User's choice:** Full changeset rollback (Recommended)

### Batch error responses

| Option               | Description                               | Selected |
| -------------------- | ----------------------------------------- | -------- |
| Per-operation status | Each op gets its own HTTP status and body | ✓        |
| You decide           |                                           |          |

**User's choice:** Per-operation status (Recommended)

---

## Security Limits & Query Complexity

### maxTop violations

| Option                 | Description                    | Selected |
| ---------------------- | ------------------------------ | -------- |
| Reject with 400        | HTTP 400 with OData error body | ✓        |
| Silently clamp         | Reduce to maxTop without error |          |
| Clamp + warning header | Middle ground                  |          |

**User's choice:** Reject with 400 (Recommended)

### Query complexity limits

| Option                  | Description                   | Selected |
| ----------------------- | ----------------------------- | -------- |
| Filter depth limit      | Max nesting depth for $filter |          |
| Full complexity scoring | Score each query component    |          |
| You decide              |                               |          |

**User's choice:** "Make it configurable with default values" — user wants all complexity dimensions configurable with sensible defaults, not a single fixed approach.

### Security limit scope

| Option               | Description                            | Selected |
| -------------------- | -------------------------------------- | -------- |
| Global only          | Same limits for all entities           |          |
| Per-entity overrides | Global defaults + forFeature overrides | ✓        |
| You decide           |                                        |          |

**User's choice:** Per-entity overrides

---

## Release Pipeline & Package Quality

### Release pipeline

| Option                      | Description                  | Selected |
| --------------------------- | ---------------------------- | -------- |
| Changesets + GitHub Actions | Complete Phase 1 scaffolding | ✓        |
| Manual release              |                              |          |
| You decide                  |                              |          |

**User's choice:** Changesets + GitHub Actions (Recommended)

### Documentation

| Option                | Description                              | Selected |
| --------------------- | ---------------------------------------- | -------- |
| VitePress docs        | Getting-started, API reference, examples | ✓        |
| README only           |                                          |          |
| Defer docs to post-v1 |                                          |          |

**User's choice:** VitePress docs (Recommended)

---

## Gap Closure from Phase 4

### $expand $top/$skip

| Option             | Description                  | Selected |
| ------------------ | ---------------------------- | -------- |
| Fix in Phase 5     | Add expand-pagination.ts     | ✓        |
| Defer to post-v1   | Document as known limitation |          |
| Reject unsupported | Return 400 for unsupported   |          |

**User's choice:** Fix in Phase 5 (Recommended)

### 80%+ coverage

| Option                    | Description                         | Selected |
| ------------------------- | ----------------------------------- | -------- |
| Yes, add coverage CI step | @vitest/coverage-v8, fail below 80% | ✓        |
| Check but don't block     | Report only                         |          |
| You decide                |                                     |          |

**User's choice:** Yes, add coverage CI step (Recommended)

---

## Claude's Discretion

- $batch multipart boundary generation
- Exact complexity scoring formula and defaults
- VitePress site structure
- forFeature config merge strategy
- Changelog formatting
- $batch size limit

## Deferred Ideas

- ESLint rule: OData decorators only on @ODataController — post-v1 tooling
