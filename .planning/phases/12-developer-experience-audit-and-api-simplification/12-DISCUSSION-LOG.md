# Phase 12: Developer Experience Audit and API Simplification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 12-developer-experience-audit-and-api-simplification
**Areas discussed:** Controller registration, Auto-pipe wiring, serviceRoot inheritance, Error message enrichment

---

## Controller Registration Simplification

| Option                                                | Description                                                                                            | Selected |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| @ODataController handles routing automatically        | @ODataController('Products') auto-prepends serviceRoot from forRoot config. No PATH_METADATA patching. | ✓        |
| forRoot({ controllers }) as single registration point | All OData controllers declared in forRoot(). Feature modules only import forFeature for DI providers.  |          |
| Convention-based discovery                            | Auto-discover all @ODataController classes in DI container. No explicit registration needed.           |          |

**User's choice:** @ODataController handles routing automatically
**Notes:** None — recommended option accepted

---

## Auto-Pipe Wiring

| Option                                  | Description                                                                                              | Selected |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| @ODataQueryParam auto-applies pipe      | @ODataQueryParam internally creates pipe. Developers never import ODataQueryPipe. @UsePipes unnecessary. | ✓        |
| Keep pipe explicit, add lint rule       | Keep @UsePipes but add ESLint warning when @ODataQueryParam used without it.                             |          |
| Merge into single @ODataQuery decorator | Replace both with @ODataQuery('Products'). Bigger breaking change.                                       |          |

**User's choice:** @ODataQueryParam auto-applies pipe
**Notes:** None — recommended option accepted

---

## serviceRoot Inheritance

| Option                             | Description                                                                    | Selected |
| ---------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Inherit from forRoot automatically | forFeature reads serviceRoot from ODATA_MODULE_OPTIONS token. No param needed. | ✓        |
| Optional override only             | Inherit by default, accept optional override for edge cases.                   |          |
| Keep explicit, add validation      | Keep requiring serviceRoot but validate it matches forRoot.                    |          |

**User's choice:** Inherit from forRoot automatically
**Notes:** None — recommended option accepted

---

## Error Message Enrichment

| Option                      | Description                                                                                  | Selected |
| --------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| Add available-fields hints  | List available properties in error messages. Helps discover correct names without $metadata. | ✓        |
| Add hints + fix suggestions | Same plus fuzzy-match "Did you mean?" for typos/case mismatches.                             |          |
| Keep minimal, improve docs  | Keep short errors. Add troubleshooting guide in docs.                                        |          |

**User's choice:** Add available-fields hints
**Notes:** None — recommended option accepted

---

## Claude's Discretion

- Public API export audit
- Type inference and IDE autocompletion improvements
- Additional paper cuts discovered during implementation

## Deferred Ideas

None — discussion stayed within phase scope.
