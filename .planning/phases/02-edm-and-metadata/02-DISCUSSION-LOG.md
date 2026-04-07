# Phase 2: EDM and $metadata - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 02-edm-and-metadata
**Areas discussed:** Adapter Interface Design, Module Registration API, $metadata Format, Type Mapping Strategy, EntitySet Naming, EDM Derivation Lifecycle, Decorator Placement

---

## Adapter Interface Design

| Option                   | Description                                                                   | Selected |
| ------------------------ | ----------------------------------------------------------------------------- | -------- |
| Two interfaces           | IEdmDeriver + IQueryTranslator. Clean separation, independently testable.     | ✓        |
| Single adapter interface | One IODataAdapter with all methods. Simpler but bigger implementation burden. |          |

**User's choice:** Two interfaces
**Notes:** Critical for future adapter authors (Prisma, Drizzle).

---

## Module Registration API

| Option                   | Description                                                                        | Selected |
| ------------------------ | ---------------------------------------------------------------------------------- | -------- |
| Layered modules          | Core ODataModule (ORM-agnostic) + adapter ODataTypeOrmModule (convenience wrapper) | ✓        |
| NestJS-native pattern    | forRoot/forFeature directly on ODataModule                                         |          |
| Auto-detect from TypeORM | forRoot only, auto-discover entities                                               |          |

**User's choice:** Layered modules
**Notes:** User emphasized future ORM-agnostic extensibility — "at some point, there may be a spinoff for Prisma or other custom implementations."

---

## $metadata Format — Namespace

| Option                  | Description                                                       | Selected |
| ----------------------- | ----------------------------------------------------------------- | -------- |
| Configurable            | Default 'Default', configurable via forRoot({ namespace: '...' }) | ✓        |
| Auto-derive from module | Namespace from NestJS module name                                 |          |

**User's choice:** Configurable

## $metadata Format — Edge Cases

| Option                       | Description                                   | Selected |
| ---------------------------- | --------------------------------------------- | -------- |
| Strict + skip                | Map known types, skip/warn unmappable         |          |
| Strict + Edm.String fallback | Fall back to Edm.String for unknowns          |          |
| Configurable strategy        | User chooses: skip, string-fallback, or error | ✓        |

**User's choice:** Configurable — "Could we make that configurable?"

---

## Type Mapping — Overrides

| Option                 | Description                          | Selected |
| ---------------------- | ------------------------------------ | -------- |
| Decorator overrides    | @EdmType() on entity columns         | ✓        |
| Config-based overrides | Override in forFeature() config      |          |
| Both                   | Decorator priority + config fallback |          |

**User's choice:** Decorator overrides

---

## EntitySet Naming

| Option                    | Description                                      | Selected |
| ------------------------- | ------------------------------------------------ | -------- |
| Auto-pluralize + override | Default pluralize, @ODataEntitySet() to override | ✓        |
| Explicit always           | Always require @ODataEntitySet()                 |          |

**User's choice:** Auto-pluralize + override

---

## EDM Derivation Lifecycle

| Option                | Description                             | Selected |
| --------------------- | --------------------------------------- | -------- |
| onModuleInit          | Derive once at startup, cache forever   | ✓        |
| Lazy on first request | Derive on first $metadata/query request |          |

**User's choice:** onModuleInit

---

## Decorator Placement

| Option                 | Description                              | Selected     |
| ---------------------- | ---------------------------------------- | ------------ |
| On entity classes      | Decorators directly on @Entity() classes | ✓            |
| Separate config        | OData metadata in forFeature() config    |              |
| On entities + core pkg | Decorators in core, applied to entities  | ✓ (combined) |

**User's choice:** On entity classes, defined in @nestjs-odata/core (ORM-agnostic via reflect-metadata)

## Claude's Discretion

- CSDL XML generation approach
- Pluralization implementation
- EdmRegistry internals
- Unit test organization

## Deferred Ideas

None
