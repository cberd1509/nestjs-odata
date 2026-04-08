# Phase 4: CRUD, $expand, and Module System - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 04-crud-expand-and-module-system
**Areas discussed:** CRUD operation design, $expand implementation, @ODataController auto-wiring, Route isolation

---

## CRUD Operation Design

### PATCH style

| Option                   | Description                                                    | Selected |
| ------------------------ | -------------------------------------------------------------- | -------- |
| Merge-patch              | OData standard: PATCH sends only changed fields, server merges | ✓        |
| Full replacement via PUT | PUT replaces the entire entity                                 |          |
| Both PATCH and PUT       | Support merge-patch via PATCH and full replace via PUT         |          |

**User's choice:** Merge-patch (Recommended)

### Key format

| Option             | Description                                    | Selected |
| ------------------ | ---------------------------------------------- | -------- |
| Parenthetical keys | /Products(42), /OrderItems(OrderId=1,ItemId=3) | ✓        |
| Slash-based keys   | /Products/42                                   |          |
| Both formats       | Accept both                                    |          |

**User's choice:** Parenthetical keys (Recommended)

### Hooks for custom logic

| Option              | Description                    | Selected    |
| ------------------- | ------------------------------ | ----------- |
| Guard-based         | NestJS guards and interceptors | ✓ (partial) |
| Lifecycle callbacks | beforeCreate/afterCreate hooks |             |
| You decide          | Claude picks                   |             |

**User's choice:** Guards + interceptors for auth (mandatory), plus TypeORM entity subscribers for entity logic. No custom lifecycle API in v1.
**Notes:** User asked about TypeORM lifecycle support — confirmed TypeORM has @BeforeInsert/@BeforeUpdate. Handler-level hooks deferred.

### POST response

| Option                  | Description                  | Selected |
| ----------------------- | ---------------------------- | -------- |
| 201 + Location + entity | Full OData standard response | ✓        |
| 201 + minimal response  | Only key fields              |          |
| Prefer header support   | Both via Prefer header       |          |

**User's choice:** 201 + Location + entity (Recommended)

---

## $expand Implementation

### Nested expand

| Option              | Description                            | Selected |
| ------------------- | -------------------------------------- | -------- |
| Single-level only   | Reject nested $expand                  |          |
| Full nested support | Arbitrary nesting up to maxExpandDepth | ✓        |
| Two levels max      | Allow one level of nesting             |          |

**User's choice:** Full nested support from start, configurable maxExpandDepth. Reasoning: "once you built the 2 level the n level should be the same (recursive approach)"

### Expand query options

| Option                    | Description                                           | Selected |
| ------------------------- | ----------------------------------------------------- | -------- |
| $select only              | Project expanded entity fields                        |          |
| Full nested query options | $filter, $top, $orderby, $select on expanded entities | ✓        |
| No nested options         | Return all fields                                     |          |

**User's choice:** Full nested query options

### Expand scope

| Option                | Description                      | Selected |
| --------------------- | -------------------------------- | -------- |
| EDM-only              | Only NavigationProperties in EDM | ✓        |
| All TypeORM relations | Any TypeORM relation expandable  |          |

**User's choice:** EDM-only (Recommended)

---

## @ODataController Auto-wiring

### Auto routes

| Option                   | Description                           | Selected |
| ------------------------ | ------------------------------------- | -------- |
| All CRUD auto-registered | Auto-register all operations          |          |
| Opt-in per operation     | User decorates each method explicitly | ✓        |
| Auto with opt-out        | Auto-register with exclusion config   |          |

**User's choice:** Opt-in per operation — resolver-discovery pattern like GraphQL
**Notes:** User later clarified: "I would even prefer that they explicitly define the routes instead of just defaulting to create all the crud (More like in GraphQL the library discover the existing resolvers)"

### Override mechanism

| Option            | Description                                               | Selected |
| ----------------- | --------------------------------------------------------- | -------- |
| Method override   | Define method with same decorator to replace auto-handler | ✓        |
| Handler injection | Custom handler class via module config                    |          |
| You decide        |                                                           |          |

**User's choice:** Method override (Recommended)

---

## Route Isolation

### Serialization scope

| Option            | Description                                          | Selected |
| ----------------- | ---------------------------------------------------- | -------- |
| Decorator-scoped  | OData formatting per-method                          |          |
| Controller-scoped | All methods on @ODataController get OData formatting | ✓        |
| You decide        |                                                      |          |

**User's choice:** Initially decorator-scoped, then revised to controller-scoped after deciding @ODataController is separate from @Controller.

### Service root prefix

| Option              | Description                        | Selected |
| ------------------- | ---------------------------------- | -------- |
| Configurable prefix | forRoot({ serviceRoot: '/odata' }) | ✓        |
| No prefix           | User manages manually              |          |
| You decide          |                                    |          |

**User's choice:** Configurable prefix at root path level: /odata/Products (not /products/odata)

### Routing model (follow-up)

| Option                   | Description                                              | Selected |
| ------------------------ | -------------------------------------------------------- | -------- |
| Entity-driven path       | @ODataController sets route to {serviceRoot}/{EntitySet} | ✓        |
| Controller path + prefix | @Controller('products') + @ODataController               |          |
| You decide               |                                                          |          |

**User's choice:** Entity-driven path — @ODataController is separate from @Controller. Users create two controllers if they need both OData and non-OData endpoints for the same domain.

---

## Claude's Discretion

- ExpandVisitor implementation details
- How @ODataController decorator internally applies interceptors and filters
- PATCH merge implementation strategy
- Key parsing from parenthetical URL segments
- Auto-handler repository resolution
- Test structure

## Deferred Ideas

- Custom lifecycle callbacks (beforeCreate/afterCreate hooks) — post-v1
- Prefer header support (return=minimal/return=representation) — Phase 5+
- PUT (full replacement) alongside PATCH — deferred
