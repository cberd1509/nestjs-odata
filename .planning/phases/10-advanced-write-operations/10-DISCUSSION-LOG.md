# Phase 10: Advanced Write Operations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 10-advanced-write-operations
**Areas discussed:** PUT semantics, Deep insert strategy, Content-ID resolution

---

## PUT Semantics

| Option                | Description                                                                                                  | Selected |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Strict OData spec     | PUT replaces ALL properties. Unspecified reset to defaults. Nav props ignored. If-Match required with ETags. | ✓        |
| Lenient replacement   | PUT replaces specified fields only (like PATCH). Less spec-compliant.                                        |          |
| Reject partial bodies | Require ALL non-nullable fields. Strictest but frustrating.                                                  |          |

**User's choice:** Strict OData spec
**Notes:** Full spec compliance

---

## Deep Insert Strategy

| Option                          | Description                         | Selected |
| ------------------------------- | ----------------------------------- | -------- |
| One level + TypeORM cascade     | Single nesting level only. Simpler. |          |
| Recursive nesting               | Arbitrary depth with config limit.  | ✓        |
| Manual transaction (no cascade) | Manual insert parent then children. |          |

**User's choice:** Recursive nesting with configurable depth limit
**Notes:** "Once we have the recursive approach, it works for all depths. Limit from config."

---

## Content-ID Resolution

| Option           | Description                                                                             | Selected |
| ---------------- | --------------------------------------------------------------------------------------- | -------- |
| Batch controller | Resolve $N in batch-controller.ts during execution. Store created keys in contentIdMap. | ✓        |
| Batch parser     | Two-pass parsing approach. Adds parser complexity.                                      |          |
| Middleware layer | Separate ContentIdResolver service. Extra abstraction.                                  |          |

**User's choice:** Batch controller
**Notes:** Resolution close to execution where created keys are available

## Claude's Discretion

- @ODataPut decorator design
- Deep insert error message format
- Content-ID regex pattern
- Content-ID scope (URLs + bodies)

## Deferred Ideas

None
