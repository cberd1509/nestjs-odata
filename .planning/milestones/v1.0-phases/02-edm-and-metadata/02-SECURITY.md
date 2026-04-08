---
phase: 02
slug: edm-and-metadata
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-07
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary                         | Description                                                                                         | Data Crossing                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Decorator metadata               | Metadata stored via reflect-metadata on entity classes — consumed at init time, not at request time | Entity class metadata (types, names) |
| Module options → EdmRegistry     | Configuration flows from user-provided options to singleton registry at init time                   | serviceRoot, maxTop, maxExpandDepth  |
| TypeORM metadata → EDM types     | Entity metadata from TypeORM is transformed into OData types at init time                           | Column types, relation metadata      |
| HTTP client → $metadata endpoint | External clients request CSDL XML; response is read-only schema                                     | CSDL XML (public schema)             |
| HTTP client → service document   | External clients discover available EntitySets                                                      | EntitySet names and URLs             |

---

## Threat Register

| Threat ID | Category        | Component               | Disposition | Mitigation                                                                                                        | Status |
| --------- | --------------- | ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| T-02-01   | Tampering       | EdmRegistry.register()  | mitigate    | Throws on duplicate registration to prevent silent override of entity types                                       | closed |
| T-02-02   | Info Disclosure | Decorator metadata      | accept      | Decorator metadata is internal to the server process; not exposed to clients                                      | closed |
| T-02-03   | Tampering       | ODataModuleOptions      | mitigate    | Validates serviceRoot is non-empty string; maxTop > 0 and maxExpandDepth >= 0 enforced via defaults               | closed |
| T-02-04   | DoS             | maxTop / maxExpandDepth | mitigate    | Defaults enforced (maxTop=1000, maxExpandDepth=2) when not provided — prevents unbounded queries                  | closed |
| T-02-05   | Info Disclosure | TypeORM column exposure | mitigate    | @ODataExclude decorator hides sensitive columns from OData exposure during EDM derivation                         | closed |
| T-02-06   | Tampering       | Type mapping            | mitigate    | 'error' unmappedTypeStrategy fails fast on unknown column types rather than silently exposing them                | closed |
| T-02-07   | Info Disclosure | $metadata endpoint      | accept      | $metadata is public by OData spec — describes schema, not data. Sensitive columns excluded via @ODataExclude      | closed |
| T-02-08   | DoS             | CsdlBuilder             | mitigate    | CSDL XML built once at init time and cached. Repeated requests serve cached string — zero computation per request | closed |
| T-02-09   | Spoofing        | MetadataController      | accept      | $metadata is read-only; no state change. Standard NestJS auth guards can be applied by consumers                  | closed |

_Status: open · closed_
_Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)_

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale                                                                                     | Accepted By      | Date       |
| ------- | ---------- | --------------------------------------------------------------------------------------------- | ---------------- | ---------- |
| AR-01   | T-02-02    | Decorator metadata is server-internal; no client exposure path                                | gsd-secure-phase | 2026-04-07 |
| AR-02   | T-02-07    | $metadata is designed to be public per OData v4 spec (OASIS standard)                         | gsd-secure-phase | 2026-04-07 |
| AR-03   | T-02-09    | $metadata and service document are read-only endpoints; consumers apply auth guards as needed | gsd-secure-phase | 2026-04-07 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By           |
| ---------- | ------------- | ------ | ---- | ---------------- |
| 2026-04-07 | 9             | 9      | 0    | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-07
