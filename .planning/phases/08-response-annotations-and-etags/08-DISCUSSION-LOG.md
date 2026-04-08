# Phase 8: Response Annotations and ETags - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 08-response-annotations-and-etags
**Areas discussed:** Annotation placement, ETag source column, ETag scope, Namespace convention

---

## Annotation Placement

| Option                         | Description                                                                                                                                             | Selected |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Extend the interceptor         | ODataResponseInterceptor already wraps every response. Add annotation logic there using EDM registry metadata. Keeps it in core, zero adapter coupling. | ✓        |
| New AnnotationService in core  | Dedicated service injected into the interceptor. Cleaner separation but more moving parts.                                                              |          |
| Adapter-side (TypeORM handler) | Generate annotations in typeorm-auto-handler before returning results. Leaks OData response concerns into the query layer.                              |          |

**User's choice:** Extend the interceptor
**Notes:** Natural extension point — already handles @odata.context

---

## ETag Source Column

| Option                          | Description                                                                                                                | Selected |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| @UpdateDateColumn               | Use TypeORM's @UpdateDateColumn — auto-set on every save. ETag = hash of timestamp. Most entities already have updatedAt.  | ✓        |
| @VersionColumn (auto-increment) | TypeORM's optimistic lock column. Integer that increments on each save. Simpler ETag but requires adding a version column. |          |
| Content hash                    | Hash the serialized entity fields. No special column needed, but expensive and can't short-circuit with If-None-Match.     |          |

**User's choice:** @UpdateDateColumn
**Notes:** Minimizes migration burden — most entities already have updatedAt

---

## ETag Scope

| Option                  | Description                                                                                                   | Selected |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| Opt-in per entity       | Only entities with @UpdateDateColumn or explicit @ODataETag decorator get ETag headers. Others skip silently. | ✓        |
| Global default, opt-out | All entities get ETags by default. Entities without a suitable column throw a startup warning.                |          |
| Global config toggle    | ODataModule.forRoot({ etags: true }) enables for all entities. All-or-nothing.                                |          |

**User's choice:** Opt-in per entity
**Notes:** Incremental adoption — doesn't break existing setups

---

## Namespace Convention

| Option                         | Description                                                                         | Selected |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------- |
| Auto-derive from module config | ODataModule.forRoot({ namespace: 'MyApp' }) sets it once. Falls back to 'Default'.  | ✓        |
| Per-entity decorator           | @ODataEntity({ namespace: 'Sales' }) per entity class. Maximum control but verbose. |          |
| Convention from package name   | Derive from package.json name automatically. Zero config but opaque.                |          |

**User's choice:** Auto-derive from module config
**Notes:** One namespace per app is the common case

## Claude's Discretion

- ETag hash algorithm choice
- @odata.editLink inclusion (spec-optional)
- @odata.navigationLink URL format (relative vs absolute)
- Annotation rendering in $expand nested entities

## Deferred Ideas

None — discussion stayed within phase scope
