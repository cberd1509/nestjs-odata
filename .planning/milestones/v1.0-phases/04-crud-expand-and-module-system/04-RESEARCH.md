# Phase 4: CRUD, $expand, and Module System - Research

**Researched:** 2026-04-07
**Domain:** NestJS CRUD decorators, OData $expand with TypeORM JOINs, @ODataController design, route isolation
**Confidence:** HIGH — primarily based on direct codebase inspection of Phase 3 artifacts and established patterns

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Merge-patch semantics for PATCH — send only changed fields, server merges with existing entity. Missing fields remain untouched.
- **D-02:** Parenthetical key format in URLs: `/Products(42)`, `/OrderItems(OrderId=1,ItemId=3)` for composite keys.
- **D-03:** POST returns HTTP 201 + `Location` header (entity URL) + full created entity in OData JSON format.
- **D-04:** DELETE returns HTTP 204 No Content.
- **D-05:** GET by key: `/Products(42)` returns a single entity (not wrapped in `value` array). Returns 404 if not found.
- **D-06:** Auth/validation via NestJS guards and interceptors. TypeORM `@BeforeInsert()`/`@BeforeUpdate()` for entity-level hooks.
- **D-07:** Full nested `$expand` with configurable `maxExpandDepth` from `forRoot()` config. Recursive visitor.
- **D-08:** Full nested query options on expanded entities: `$expand=Orders($filter=Amount gt 100;$top=5;$orderby=Date desc;$select=Id,Amount)`.
- **D-09:** `$expand` uses TypeORM JOINs (`leftJoinAndSelect`) — NOT lazy loading. One SQL query.
- **D-10:** Only EDM NavigationProperties are expandable. `@ODataExclude()` on a relation hides it. Expanding a non-EDM relation returns 400.
- **D-11:** `@ODataController(Entity)` sets entity context and route prefix. Separate from NestJS `@Controller()`.
- **D-12:** Resolver-discovery pattern: explicit opt-in per operation via `@ODataGet()`, `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()`.
- **D-13:** Method override: user calls `return this.handler.handleGet(query)` to delegate to auto-handler.
- **D-14:** Auto-handler (`TypeOrmAutoHandler`) injected via NestJS DI. Provides `handleGet()`, `handleGetByKey()`, `handleCreate()`, `handleUpdate()`, `handleDelete()`, `handleCount()`.
- **D-15:** `@ODataController(Entity)` IS the OData scope — all methods get OData response formatting.
- **D-16:** Non-OData endpoints go on separate `@Controller()` classes.
- **D-17:** Service root applied by `@ODataController` decorator from `forRoot({ serviceRoot: '/odata' })`.

### Claude's Discretion

- ExpandVisitor implementation details (recursive AST walk + JOIN generation)
- How `@ODataController()` decorator internally applies interceptors and filters
- PATCH merge implementation strategy (deep merge vs shallow)
- Key parsing from parenthetical URL segments
- How auto-handler resolves the TypeORM repository for the entity
- Test structure and e2e test organization

### Deferred Ideas (OUT OF SCOPE)

- Custom lifecycle callbacks (beforeCreate/afterCreate hooks at handler level)
- `Prefer` header support (`return=minimal` / `return=representation`)
- PUT (full replacement) alongside PATCH
  </user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID       | Description                                                         | Research Support                                                                                 |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CRUD-01  | POST — create entity, 201 + Location header + created entity        | TypeOrmAutoHandler.handleCreate() using repo.save(); NestJS HttpCode(201) + response.setHeader() |
| CRUD-02  | PATCH — partial update with OData-compliant response                | TypeOrmAutoHandler.handleUpdate() using merge-patch; repo.preload() + repo.save()                |
| CRUD-03  | DELETE — 204 No Content                                             | TypeOrmAutoHandler.handleDelete() using repo.delete(); HttpCode(204)                             |
| CRUD-04  | GET by key — single entity by primary key (composite supported)     | Key parsing from parenthetical segment; repo.findOne() with where clause                         |
| QUERY-07 | $expand support for navigation property expansion                   | ExpandVisitor added to TypeOrmQueryTranslator; $expand parsed in ODataQueryPipe                  |
| QUERY-08 | $expand must use JOINs, not lazy loading (no N+1)                   | TypeORM leftJoinAndSelect() in ExpandVisitor                                                     |
| RESP-03  | Response serialization is route-scoped; non-OData routes unaffected | ODataResponseInterceptor already checks ODATA_ROUTE_KEY metadata; @ODataController scoping       |
| MOD-01   | ODataModule.forRoot() — already exists (Phase 2)                    | Verify maxExpandDepth is already in ODataModuleResolvedOptions (confirmed: it is)                |
| MOD-02   | ODataModule.forFeature() — already exists (Phase 2)                 | No new work needed                                                                               |
| MOD-03   | @ODataController(Entity) class decorator                            | New work: applyDecorators(Controller(path), SetMetadata) + interceptors at class level           |
| MOD-04   | @ODataGet/Post/Patch/Delete decorators                              | @ODataGet() exists; add Post/Patch/Delete variants                                               |
| MOD-05   | OData and non-OData routes coexist without conflicts                | @ODataController on one class, @Controller on another — already enforced by D-16                 |
| MOD-06   | ConfigurableModuleBuilder for idiomatic async config                | Already implemented via ConfigurableModuleBuilder in ODataModule (Phase 2)                       |
| TEST-04  | Integration tests for full HTTP request/response cycle              | Extend existing e2e test-app suite in apps/test-app/test/                                        |
| TEST-06  | 80%+ code coverage across both packages                             | vitest --coverage; existing vitest.config.ts already has coverage reporter configured            |

</phase_requirements>

---

## Summary

Phase 4 builds on a solid Phase 3 foundation: the visitor-pattern query translator, composite-decorator route approach, and the `TypeOrmAutoHandler` GET/count implementation are already in place. This phase extends three dimensions: (1) CRUD operations (POST/PATCH/DELETE + GET-by-key), (2) `$expand` via TypeORM JOINs, and (3) the `@ODataController` class decorator for OData-scoped controllers.

The critical insight is that **`$expand` is not yet parsed at all** — the parser's `parseQuery()` silently ignores `$expand`. Phase 4 must add `$expand` parsing to the query string parser (`parseQuery`) and AST types, add an `ExpandNode` to `ast.ts`, extend `ODataQuery` to carry expand nodes, validate expand names against EDM `navigationProperties`, and implement `TypeOrmExpandVisitor` that calls `leftJoinAndSelect` for each navigation property. D-08 (nested expand options like `$filter` inside `$expand`) adds significant parsing complexity since OData uses `;`-separated nested query options within `$expand(...)`.

For `@ODataController`, NestJS supports class-level `UseInterceptors` and `UseFilters` through `applyDecorators` when applied as a class decorator — this is how route-scoped OData formatting (RESP-03) works without leaking to non-OData controllers. The service root path prefix must be injected at decorator application time; the existing pattern in `ODataModule` uses `Reflect.defineMetadata(PATH_METADATA, path, MetadataController)` as the model.

**Primary recommendation:** Implement in this order: (1) CRUD handlers in TypeOrmAutoHandler + CRUD decorators, (2) $expand AST node + parser extension, (3) ExpandVisitor + ODataQueryPipe validation, (4) @ODataController class decorator, (5) e2e test coverage.

---

## Standard Stack

### Core (all already in the project — no new installs needed)

| Library          | Version | Purpose                                                              | Why Standard         |
| ---------------- | ------- | -------------------------------------------------------------------- | -------------------- |
| @nestjs/common   | ^11.0.0 | applyDecorators, Controller, HttpCode, HttpStatus, NotFoundException | Required peer dep    |
| typeorm          | ^0.3.28 | leftJoinAndSelect, repo.save(), repo.preload(), repo.delete()        | Existing adapter dep |
| rxjs             | ^7.0.0  | Observable pipeline in interceptors                                  | Required peer dep    |
| reflect-metadata | ^0.2.2  | Decorator metadata for @ODataController                              | Required peer dep    |

No new npm packages needed for Phase 4. All required APIs exist in the current dependency set.

**Version verification:** [VERIFIED: codebase grep — packages/typeorm/package.json]

---

## Architecture Patterns

### Recommended Project Structure (new files for Phase 4)

```
packages/core/src/
├── decorators/
│   ├── odata-controller.decorator.ts    # NEW: @ODataController class decorator
│   ├── odata-post.decorator.ts          # NEW: @ODataPost() composite method decorator
│   ├── odata-patch.decorator.ts         # NEW: @ODataPatch() composite method decorator
│   ├── odata-delete.decorator.ts        # NEW: @ODataDelete() composite method decorator
│   └── odata-get.decorator.ts           # EXISTING — may need handleGetByKey variant
├── parser/
│   └── ast.ts                           # EXTEND: add ExpandNode, ExpandItem types
├── query/
│   └── odata-query.types.ts             # EXTEND: add expand?: ExpandNode field to ODataQuery
└── response/
    └── odata-response.interceptor.ts    # EXTEND: handle single-entity response (GET by key)

packages/typeorm/src/
└── translator/
    ├── expand-visitor.ts                # NEW: TypeOrmExpandVisitor
    └── typeorm-auto-handler.ts          # EXTEND: handleGetByKey, handleCreate, handleUpdate, handleDelete
    └── typeorm-query-translator.ts      # EXTEND: call ExpandVisitor in translate()
```

### Pattern 1: @ODataController Class Decorator

**What:** A class decorator that applies `Controller(path)`, `UseInterceptors(ODataResponseInterceptor)`, and `UseFilters(ODataExceptionFilter)` at the class level. This ensures every method on the controller gets OData formatting without per-method decoration.

**Key constraint:** The entity class reference is stored as metadata for runtime resolution but the path must be set at decoration time. Since `serviceRoot` comes from `forRoot()` config (not available at decorator-definition time), the decorator uses a two-step approach: store the entity class in metadata, then on `@ODataController` application, read serviceRoot lazily from the DI container via request-scoped context OR accept serviceRoot as a constructor parameter.

**Practical implementation:** Given that NestJS `@Controller()` requires the path at class decoration time (not at request time), and `serviceRoot` is known at module init, the cleanest approach is to make `@ODataController(Entity, { serviceRoot })` accept the service root — but D-17 says the service root is applied by the decorator. The safest approach verified in the codebase is the same pattern used by MetadataController: `Reflect.defineMetadata(PATH_METADATA, path, ControllerClass)` applied during module initialization.

**However**, for user-authored controllers the path cannot be patched externally after the fact cleanly. The viable approach is:

```typescript
// Source: codebase pattern — odata-get.decorator.ts + odata.module.ts
// @ODataController accepts the entity class; serviceRoot comes from forRoot config
// The controller's route prefix is `{serviceRoot}/{EntitySetName}`
// but since serviceRoot is config-time, two options:

// Option A: @ODataController stores metadata; ODataTypeOrmModule.forFeature
// patches PATH_METADATA at module init (like MetadataController)

// Option B: @ODataController accepts explicit path override or reads it from
// a module-level symbol — requires MODULE_OPTIONS injection at decorator time

// Recommended: Option A (consistent with existing MetadataController pattern)
export function ODataController(entity: EntityClass): ClassDecorator {
  return applyDecorators(
    Controller(''), // placeholder — patched by module at init
    SetMetadata(ODATA_ENTITY_KEY, entity),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
```

[VERIFIED: codebase — odata.module.ts:82-86 uses Reflect.defineMetadata(PATH_METADATA) pattern]

### Pattern 2: CRUD Composite Method Decorators

**What:** `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()` follow the exact same composite-decorator pattern as `@ODataGet()`. They wrap the corresponding NestJS HTTP method decorator + ODATA_ROUTE_KEY metadata + interceptor + filter.

**Key difference per HTTP verb:**

- `@ODataPost()`: wraps `Post(path)` — path defaults to entity set name (e.g., `Products`)
- `@ODataPatch()`: wraps `Patch(path)` — path includes key segment (e.g., `Products(:key)`)
- `@ODataDelete()`: wraps `Delete(path)` — path includes key segment (e.g., `Products(:key)`)

The OData key segment uses NestJS route params — `/Products(:key)` maps to `@Param('key')` in the handler.

```typescript
// Source: codebase pattern — odata-get.decorator.ts
export function ODataPost(entitySetName: string, options?: ODataPostOptions): MethodDecorator {
  return applyDecorators(
    Post(options?.path ?? entitySetName),
    SetMetadata(ODATA_ROUTE_KEY, { entitySetName, operation: 'create' }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
```

[VERIFIED: codebase — odata-get.decorator.ts applyDecorators pattern]

### Pattern 3: OData Parenthetical Key Parsing

**What:** OData URL keys use parenthetical notation: `/Products(42)`, `/OrderItems(OrderId=1,ItemId=3)`. NestJS route params capture the content inside the parens as a string that must be parsed.

**Route definition:** `@Get('Products(:key)')` captures `42` or `OrderId=1,ItemId=3` in `@Param('key')`.

**Key parsing logic (Claude's discretion):**

```typescript
// Simple key: "42" → { id: 42 }
// Composite key: "OrderId=1,ItemId=3" → { OrderId: 1, ItemId: 3 }
function parseODataKey(keyStr: string, keyProperties: string[]): Record<string, unknown> {
  if (!keyStr.includes('=')) {
    // Simple key — single keyProperty
    return { [keyProperties[0]]: coerceKeyValue(keyStr) }
  }
  // Composite key — parse name=value pairs
  return Object.fromEntries(
    keyStr.split(',').map((part) => {
      const [name, val] = part.split('=')
      return [name.trim(), coerceKeyValue(val.trim())]
    }),
  )
}
```

[ASSUMED — pattern follows OData v4 URL conventions, but exact implementation is discretionary]

### Pattern 4: TypeORM CRUD Operations

**What:** `TypeOrmAutoHandler` methods use the TypeORM `Repository` API.

**Verified TypeORM API for each CRUD operation:**

```typescript
// Source: TypeORM 0.3.x Repository API [ASSUMED — training knowledge, commonly verified pattern]

// GET by key
const entity = await repo.findOne({ where: keyWhere }) // returns null if not found

// CREATE (POST)
const created = repo.create(body) // instantiate entity from plain object
const saved = await repo.save(created) // INSERT

// UPDATE (PATCH — merge-patch)
const existing = await repo.preload({ ...keyWhere, ...body })
// repo.preload() returns undefined if entity not found
// then: await repo.save(existing)  // UPDATE only changed fields

// DELETE
const deleteResult = await repo.delete(keyWhere)
// deleteResult.affected === 0 → entity not found (return 404)
```

Key insight: `repo.preload()` is the TypeORM method for merge-patch semantics — it loads the existing entity and merges the provided partial object. If the entity does not exist, `preload()` returns `undefined`. [ASSUMED: verified against TypeORM 0.3.x docs in training knowledge]

### Pattern 5: ExpandVisitor with leftJoinAndSelect

**What:** TypeORM `SelectQueryBuilder.leftJoinAndSelect(relation, alias)` loads related entities via LEFT JOIN in a single SQL query. The ExpandVisitor adds these calls based on the `$expand` AST.

**Key TypeORM API:**

```typescript
// Source: TypeORM leftJoinAndSelect API [ASSUMED — training knowledge]
qb.leftJoinAndSelect('entity.customer', 'customer')
qb.leftJoinAndSelect('entity.items', 'items')

// With nested expand: entity.items.product
qb.leftJoinAndSelect('entity.items', 'items')
qb.leftJoinAndSelect('items.product', 'items_product')
```

The alias must be unique and deterministic. For nested expands, prefix with parent alias: `entity.customer` → alias `customer`, `customer.addresses` → alias `customer_addresses`.

**maxExpandDepth enforcement:** The ExpandVisitor tracks current depth. When depth exceeds `options.maxExpandDepth`, it throws `ODataValidationError` (400 response). Default is 2 (from `ODataModuleResolvedOptions`). [VERIFIED: codebase — odata.module.ts:51 sets maxExpandDepth: 2]

### Pattern 6: $expand AST and Parser Extension

**What:** `$expand` is currently silently ignored by `parseQuery()`. Phase 4 must add:

1. `ExpandItem` and `ExpandNode` types to `ast.ts`
2. `expand?: ExpandNode` field to `ODataQuery`
3. `$expand` parsing branch in `parseQuery()` in `parser.ts`
4. Expand validation in `ODataQueryPipe`

**OData $expand syntax (basic):**

```
$expand=Customer
$expand=Customer,Items
$expand=Items($filter=Amount gt 100;$top=5;$orderby=Amount desc;$select=Id,Amount)
$expand=Items($expand=Product)   // nested expand
```

**AST design:**

```typescript
// To add to ast.ts
export interface ExpandItem {
  readonly navigationProperty: string // e.g. 'Customer', 'Items'
  // Nested query options within $expand(...):
  readonly filter?: FilterNode
  readonly select?: SelectNode
  readonly orderBy?: OrderByItem[]
  readonly top?: number
  readonly skip?: number
  readonly expand?: ExpandNode // recursive nested expand
}

export interface ExpandNode {
  readonly items: ExpandItem[]
}
```

**Parser complexity note:** The nested query options within `$expand(...)` use semicolons as separators (not ampersands). The parser must handle `;`-delimited options inside the parenthesized expand option. This is the most complex new parsing work in Phase 4.

**Simplified approach for Phase 4** (without full nested query options inside $expand): Parse `$expand=Navigation1,Navigation2`as simple property names first, defer`;`-delimited nested options. D-08 requires full nested options, but this can be implemented in a second pass within the same phase.

[ASSUMED — based on OData v4 URL Conventions Part 2 Section 5.1.3; implementation details are discretionary]

### Pattern 7: GET by Key Response vs Collection Response

**What:** The interceptor currently wraps everything in `{ '@odata.context': ..., 'value': [...] }`. GET by key must return a **single object**, not wrapped in `value`. The response format differs:

```json
// GET /Products — collection
{ "@odata.context": "/odata/$metadata#Products", "value": [...] }

// GET /Products(42) — single entity (D-05)
{ "@odata.context": "/odata/$metadata#Products/$entity", "name": "Widget", "price": 5.99 }
```

The interceptor needs to distinguish between collection and single-entity responses. The `ODATA_ROUTE_KEY` metadata can carry an `isSingleEntity: true` flag set by `@ODataGetByKey()` (or the same `@ODataGet()` with a `single: true` option).

[VERIFIED: codebase — odata-response.interceptor.ts reads ODATA_ROUTE_KEY metadata and conditionally wraps]

### Pattern 8: POST Location Header

**What:** OData CRUD-01 requires POST to return `Location: {serviceRoot}/{EntitySetName}({key})`. NestJS provides `@Res()` for raw response or the `response.setHeader()` approach.

The cleanest approach for a library is to return a special result shape from `handleCreate()` that includes the location URL, then have the interceptor (or a dedicated `ODataCreateInterceptor`) set the Location header and HTTP 201 status.

```typescript
// handleCreate returns a result that includes the entity key
// The interceptor reads it and sets Location header
interface ODataCreateResult {
  readonly entity: unknown
  readonly locationUrl: string // built from serviceRoot + entitySetName + key
}
```

Alternatively, `handleCreate()` accepts the `@Res()` response object. The interceptor approach is cleaner since it avoids mixing `@Res()` concerns into handler logic.

[ASSUMED — design choice is Claude's discretion per D-03]

### Anti-Patterns to Avoid

- **Lazy loading for $expand:** TypeORM lazy loading fires one SQL query per entity row (N+1). Use `leftJoinAndSelect` exclusively per QUERY-08.
- **Mixing @ODataController and @Controller on the same class:** D-16 explicitly prohibits this. Two controllers, clean separation.
- **Wrapping single-entity responses in `value` array:** D-05 says GET by key returns the entity directly, not in a collection wrapper.
- **Mutating the query object:** `ODataQuery` uses `readonly` fields. Create new objects with spread when modifying.
- **String interpolation in WHERE clauses:** Already enforced by FilterVisitor; maintain for all new CRUD handlers.
- **Assuming repo.preload() always returns an entity:** Returns `undefined` when entity not found → must handle as 404.

---

## Don't Hand-Roll

| Problem                   | Don't Build            | Use Instead                                                      | Why                                                                |
| ------------------------- | ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Merge-patch semantics     | Custom diff algorithm  | TypeORM `repo.preload({ ...key, ...body })` + `repo.save()`      | preload handles partial hydration correctly                        |
| Entity creation           | Manual INSERT SQL      | TypeORM `repo.create()` + `repo.save()`                          | Handles relations, lifecycle hooks (@BeforeInsert), generated keys |
| Entity deletion           | Manual DELETE SQL      | TypeORM `repo.delete(where)`                                     | Returns affected count for 404 detection                           |
| N+1 prevention            | In-memory join         | TypeORM `leftJoinAndSelect`                                      | Single SQL JOIN query                                              |
| Response header injection | Custom response object | NestJS interceptor + setHeader via ExecutionContext              | Interceptor pattern is established in this codebase                |
| Key type coercion         | Custom type parser     | `parseInt` / `parseFloat` + EdmEntityType.properties type lookup | Types are already in EdmEntityType                                 |

**Key insight:** TypeORM's `Repository` API handles all CRUD use cases cleanly. The main custom work is OData protocol mapping (URL key parsing, Location header, response format).

---

## Common Pitfalls

### Pitfall 1: @Controller Path Registration Timing

**What goes wrong:** `@ODataController(Entity)` applies `Controller(path)` at class decoration time, but `serviceRoot` from `forRoot()` is not known until module initialization. If the path is hardcoded or empty, routes register at the wrong URL.

**Why it happens:** NestJS reads `PATH_METADATA` from the class at module compile time (before `onModuleInit`), so post-init patching via `Reflect.defineMetadata` runs too late in some configurations.

**How to avoid:** Require the service root to be passed explicitly to `@ODataController(Entity, { serviceRoot })`, or use the existing MetadataController pattern where `createMetadataControllerWithPath()` is called synchronously in `forRoot()` before the module compiles.

**Warning signs:** Routes registering at wrong paths; `/Products` instead of `/odata/Products`.

### Pitfall 2: $expand AST and ODataQuery Out of Sync

**What goes wrong:** The `$expand` string is parsed and added to `ODataQuery` but the `ExpandVisitor` is not invoked in `TypeOrmQueryTranslator.translate()`, or vice versa.

**Why it happens:** Three separate files must be updated in sync: `ast.ts` (AST types), `parser.ts` (parsing logic), `odata-query.types.ts` (ODataQuery type), `odata-query.pipe.ts` (validation), `typeorm-query-translator.ts` (visitor invocation).

**How to avoid:** Add `expand` to ODataQuery interface first, then let TypeScript compilation errors guide all the other files that need updating.

### Pitfall 3: TypeORM Alias Collision in Nested Expand

**What goes wrong:** When `$expand=Items($expand=Product)` generates two `leftJoinAndSelect` calls, if both use the alias `product`, TypeORM throws a runtime error about duplicate aliases.

**Why it happens:** TypeORM aliases must be unique per query builder.

**How to avoid:** Prefix nested expand aliases with their parent path: `customer`, `items`, `items_product`. The ExpandVisitor must track the current path prefix and build deterministic unique aliases.

**Warning signs:** TypeORM errors about duplicate property paths or alias conflicts at runtime.

### Pitfall 4: repo.preload() undefined Check

**What goes wrong:** `handleUpdate()` calls `await repo.preload(partialEntity)`, gets `undefined` (entity not found), and attempts to call `repo.save(undefined)` which throws a cryptic TypeORM error instead of a clean 404.

**Why it happens:** `repo.preload()` returns `undefined` when no matching entity exists in the database.

**How to avoid:** Check `if (!preloaded) throw new NotFoundException(...)` immediately after `preload()`.

### Pitfall 5: GET by Key Route Conflict with Collection Route

**What goes wrong:** `/Products` and `/Products(:key)` both need to be registered on the same `@ODataController`. NestJS resolves routes by specificity but parenthetical paths like `Products(42)` can conflict with routes using `:` path params if not registered carefully.

**Why it happens:** OData's `Products(42)` syntax doesn't use `/` — the key is inside the entity set name segment. NestJS treats `Products(:key)` as a route with param, but the literal `(` and `)` may confuse express/fastify route matching.

**How to avoid:** Route is `@Get(':key')` on a controller already prefixed at `Products`, making the full path `Products/:key`... but OData uses `Products(42)` not `Products/42`. The route must be defined as `@Get('Products\\(:key\\)')` or with explicit path `Products(:key)`.

**Confirmed approach:** Use NestJS path `'Products(:key)'` — the parentheses are literal characters in Express path patterns when not using `:`. Actually the `:key` inside `()` IS a named param. Express interprets `Products(:key)` as path param `key` capturing the value between `(` and `)`. [ASSUMED: this matches Express path-to-regexp behavior for named params within literal characters]

### Pitfall 6: Interceptor Wrapping Single Entity vs Collection

**What goes wrong:** `ODataResponseInterceptor` always wraps in `{ value: [...] }`, but GET by key must return the entity directly at the top level (OData spec).

**Why it happens:** The existing interceptor assumes all OData responses are collections.

**How to avoid:** Add `isSingleEntity?: boolean` to the `ODATA_ROUTE_KEY` metadata shape. The interceptor checks this flag and either wraps in `value` (collection) or returns the entity directly with `@odata.context` ending in `/$entity`.

### Pitfall 7: expand Depth Tracking Across Recursive Calls

**What goes wrong:** `maxExpandDepth` is not enforced correctly when the ExpandVisitor recursively processes nested expands, leading to unbounded query depth.

**Why it happens:** Depth counter is not threaded through recursive calls.

**How to avoid:** Pass current depth as a parameter to the recursive expand processing function, check `depth >= maxExpandDepth` before recursing.

---

## Code Examples

### Existing @ODataGet() Pattern to Mirror for CRUD Decorators

```typescript
// Source: packages/core/src/decorators/odata-get.decorator.ts (verified in codebase)
export function ODataGet(entitySetName: string, options?: ODataGetOptions): MethodDecorator {
  return applyDecorators(
    Get(options?.path ?? entitySetName),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      autoHandler: options?.autoHandler ?? false,
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
// @ODataPost(), @ODataPatch(), @ODataDelete() follow identical pattern
// with Post/Patch/Delete and appropriate path defaults
```

### Existing TypeOrmAutoHandler Pattern to Extend

```typescript
// Source: packages/typeorm/src/translator/typeorm-auto-handler.ts (verified in codebase)
// handleGet() and handleCount() already exist — add:
// handleGetByKey(keyStr: string, entitySetName: string): Promise<unknown>
// handleCreate(body: unknown, entitySetName: string): Promise<ODataCreateResult>
// handleUpdate(keyStr: string, body: unknown, entitySetName: string): Promise<unknown>
// handleDelete(keyStr: string, entitySetName: string): Promise<void>
```

### Existing Visitor Invocation Pattern to Mirror for ExpandVisitor

```typescript
// Source: packages/typeorm/src/translator/typeorm-query-translator.ts (verified in codebase)
translate(query: ODataQuery, entityType: EdmEntityType): SelectQueryBuilder<ObjectLiteral> {
  const alias = 'entity'
  const qb = this.repo.createQueryBuilder(alias)
  if (query.filter) new TypeOrmFilterVisitor(qb, alias, entityType).visit(query.filter)
  if (query.select) new TypeOrmSelectVisitor(qb, alias, entityType).apply(query.select)
  if (query.orderBy?.length) new TypeOrmOrderByVisitor(qb, alias).apply(query.orderBy)
  new TypeOrmPaginationVisitor(qb).paginate(query.top, query.skip)
  // ADD: if (query.expand) new TypeOrmExpandVisitor(qb, alias, entityType, options).apply(query.expand, 0)
  return qb
}
```

### TypeORM leftJoinAndSelect for $expand

```typescript
// Source: TypeORM 0.3.x API [ASSUMED]
// ExpandVisitor.apply(expandNode: ExpandNode, currentDepth: number): void
apply(expandNode: ExpandNode, currentDepth: number): void {
  if (currentDepth >= this.maxDepth) {
    throw new ODataValidationError(`$expand depth limit of ${this.maxDepth} exceeded`)
  }
  for (const item of expandNode.items) {
    const navProp = this.entityType.navigationProperties.find(
      np => np.name === item.navigationProperty
    )
    if (!navProp) {
      throw new ODataValidationError(`'${item.navigationProperty}' is not a navigation property`)
    }
    const joinAlias = `${this.parentAlias}_${item.navigationProperty}`
    this.qb.leftJoinAndSelect(`${this.parentAlias}.${item.navigationProperty}`, joinAlias)
    // Apply nested expand if present
    if (item.expand) {
      // recursive: new TypeOrmExpandVisitor(qb, joinAlias, navEntityType, maxDepth)
      //   .apply(item.expand, currentDepth + 1)
    }
  }
}
```

---

## State of the Art

| Old Approach                                  | Current Approach                 | When Changed | Impact                                                  |
| --------------------------------------------- | -------------------------------- | ------------ | ------------------------------------------------------- |
| `parseQuery()` ignores $expand                | Add $expand parsing              | Phase 4      | $expand becomes a first-class query option              |
| handleGet/handleCount only                    | Full CRUD in TypeOrmAutoHandler  | Phase 4      | Library consumers get complete CRUD without boilerplate |
| Per-method interceptor/filter via @ODataGet() | Class-level via @ODataController | Phase 4      | Cleaner DX — decorate once at class level               |

**Not yet implemented:**

- `$expand`: Parser ignores it; no AST nodes; no visitor. All of this is Phase 4 work.
- `@ODataController`: Does not exist yet. Only `@ODataGet()` method decorator exists.
- CRUD handlers: Only `handleGet()` and `handleCount()` exist in `TypeOrmAutoHandler`.
- `@ODataPost/Patch/Delete`: Do not exist. Only `@ODataGet()` exists.

---

## Assumptions Log

| #   | Claim                                                                                                                       | Section              | Risk if Wrong                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| A1  | `repo.preload()` returns `undefined` when entity not found in TypeORM 0.3.x                                                 | Pattern 4, Pitfall 4 | If it throws instead, error handling changes; same fix (catch + 404)               |
| A2  | NestJS Express router interprets `Products(:key)` with `key` capturing value between `(` and `)`                            | Pitfall 5, Pattern 3 | Would need different route syntax; test in Wave 0                                  |
| A3  | ExpandVisitor needs to recursively call itself for nested $expand                                                           | Pattern 5            | If TypeORM handles nested relations differently, adapter changes needed            |
| A4  | `$expand=Nav($filter=...;$top=5)` uses semicolons as nested option separator per OData spec                                 | Pattern 6            | If implementation uses different separators, parsing logic differs                 |
| A5  | `Reflect.defineMetadata(PATH_METADATA, path, ControllerClass)` in forRoot() works for user-defined @ODataController classes | Pattern 1            | If NestJS reads path before module init, the path patching approach needs revision |

---

## Open Questions

1. **@ODataController path registration timing**
   - What we know: MetadataController uses `Reflect.defineMetadata(PATH_METADATA)` in `forRoot()` synchronously
   - What's unclear: Does this work for user-defined controller classes that NestJS hasn't compiled yet at forRoot() time? Or does @ODataController need to accept serviceRoot explicitly as a parameter?
   - Recommendation: Test in Wave 0 with a simple controller. If `Reflect.defineMetadata` approach works, use it. Otherwise, require `@ODataController(Entity, { serviceRoot })` explicitly — users get it from their `forRoot()` config.

2. **$expand nested query options parsing complexity (D-08)**
   - What we know: `$expand=Items($filter=Amount gt 100;$top=5)` requires parsing semicolon-delimited nested options inside parentheses
   - What's unclear: How complex the parser extension needs to be — can we reuse the existing `parseQuery()` by swapping `&` for `;`, or does it need a separate parser?
   - Recommendation: Try replacing `&` with `;` and calling `parseQuery()` recursively for the content inside `(...)`. OData spec allows this substitution.

3. **ExpandVisitor: entity type of related entity**
   - What we know: `leftJoinAndSelect` adds the relation. For nested $expand validation, we need the `EdmEntityType` of the navigation target.
   - What's unclear: How to get the target entity type from `EdmNavigationProperty` — the current `EdmNavigationProperty` interface needs to be checked.
   - Recommendation: Check `EdmNavigationProperty` definition in `edm-types.ts` to see if it carries a target type reference.

---

## Environment Availability

Step 2.6: All dependencies are already installed. Phase 4 introduces no new external tools.

| Dependency     | Required By              | Available | Version | Fallback |
| -------------- | ------------------------ | --------- | ------- | -------- |
| TypeORM        | CRUD handlers            | Yes       | ^0.3.28 | —        |
| better-sqlite3 | e2e tests (in-memory DB) | Yes       | ^12.8.0 | —        |
| Vitest         | Unit + integration tests | Yes       | ^3.x    | —        |
| supertest      | HTTP e2e tests           | Yes       | ^7.x    | —        |

---

## Validation Architecture

### Test Framework

| Property            | Value                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Framework           | Vitest 3.x + unplugin-swc                                                                               |
| Config file         | `packages/core/vitest.config.ts`, `packages/typeorm/vitest.config.ts`, `apps/test-app/vitest.config.ts` |
| Quick run (core)    | `pnpm --filter @nestjs-odata/core test`                                                                 |
| Quick run (typeorm) | `pnpm --filter @nestjs-odata/typeorm test`                                                              |
| E2E run             | `pnpm --filter test-app test`                                                                           |
| Full suite          | `pnpm test` (turbo)                                                                                     |
| Coverage            | `pnpm --filter @nestjs-odata/core test -- --coverage`                                                   |

### Phase Requirements → Test Map

| Req ID   | Behavior                                                | Test Type                | Automated Command                          | File Exists?             |
| -------- | ------------------------------------------------------- | ------------------------ | ------------------------------------------ | ------------------------ |
| CRUD-01  | POST /Products → 201 + Location + entity body           | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| CRUD-02  | PATCH /Products(42) → 200 + merged entity               | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| CRUD-03  | DELETE /Products(42) → 204                              | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| CRUD-04  | GET /Products(42) → single entity (no value wrap)       | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| QUERY-07 | GET /Orders?$expand=Customer → customer inlined         | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| QUERY-08 | $expand uses 1 SQL query (no N+1)                       | unit (query builder spy) | `pnpm --filter @nestjs-odata/typeorm test` | ❌ Wave 0                |
| RESP-03  | GET /api/health → plain JSON (no OData envelope)        | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| MOD-03   | @ODataController wires routes correctly                 | unit                     | `pnpm --filter @nestjs-odata/core test`    | ❌ Wave 0                |
| MOD-04   | @ODataPost/Patch/Delete decorators compose correctly    | unit                     | `pnpm --filter @nestjs-odata/core test`    | ❌ Wave 0                |
| MOD-05   | OData + non-OData routes coexist; no serialization leak | e2e                      | `pnpm --filter test-app test`              | ❌ Wave 0                |
| TEST-06  | 80%+ coverage                                           | coverage                 | `pnpm test --coverage`                     | ❌ (coverage thresholds) |

### Sampling Rate

- **Per task commit:** `pnpm --filter @nestjs-odata/core test && pnpm --filter @nestjs-odata/typeorm test`
- **Per wave merge:** `pnpm test` (full turbo suite)
- **Phase gate:** Full suite green + coverage >= 80% before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/test-app/test/crud.e2e-spec.ts` — covers CRUD-01 through CRUD-04
- [ ] `apps/test-app/test/expand.e2e-spec.ts` — covers QUERY-07, QUERY-08
- [ ] `apps/test-app/test/route-isolation.e2e-spec.ts` — covers RESP-03, MOD-05
- [ ] `packages/core/src/decorators/odata-controller.decorator.spec.ts` — covers MOD-03
- [ ] `packages/core/src/decorators/odata-post.decorator.spec.ts` — covers MOD-04
- [ ] `packages/typeorm/src/translator/expand-visitor.spec.ts` — covers QUERY-07, QUERY-08
- [ ] `packages/typeorm/src/translator/typeorm-auto-handler.spec.ts` — extend existing file with CRUD methods

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                                                                                    |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication     | No      | Not in scope — NestJS Guards handle this (out of scope per requirements)                                                            |
| V3 Session Management | No      | Not in scope                                                                                                                        |
| V4 Access Control     | No      | Not in scope — NestJS Guards                                                                                                        |
| V5 Input Validation   | Yes     | ODataQueryPipe validates $expand property names against EdmEntityType.navigationProperties; key values are coerced not interpolated |
| V6 Cryptography       | No      | Not applicable                                                                                                                      |

### Known Threat Patterns for OData CRUD + $expand

| Pattern                                       | STRIDE                 | Standard Mitigation                                                                                          |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Expand a private relation not in EDM          | Information Disclosure | Validate expansion names against EdmEntityType.navigationProperties; return 400 for non-EDM relations (D-10) |
| Unbounded nested $expand causing complex JOIN | DoS                    | maxExpandDepth enforcement in ExpandVisitor (D-07, SEC-02)                                                   |
| Mass assignment via POST/PATCH body           | Tampering              | Only map body fields that correspond to EdmEntityType.properties; ignore unknown fields                      |
| Key injection via parenthetical key string    | Tampering              | Use parameterized queries via TypeORM findOne({ where: { id: parsedKey } }); never interpolate key into SQL  |
| Expand depth limit bypass                     | DoS                    | Depth counter is tracked recursively and checked before each level processes                                 |

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — `packages/core/src/`, `packages/typeorm/src/`, `apps/test-app/src/` — all files read in this session
- `odata-get.decorator.ts` — composite decorator pattern to mirror
- `typeorm-auto-handler.ts` — existing handler pattern to extend
- `typeorm-query-translator.ts` — visitor invocation pattern to mirror
- `odata-response.interceptor.ts` — interceptor pattern for single-entity vs collection
- `odata.module.ts` — ConfigurableModuleBuilder pattern + PATH_METADATA patching

### Secondary (MEDIUM confidence)

- TypeORM 0.3.x Repository API (preload, save, create, delete) — training knowledge, widely verified pattern
- NestJS applyDecorators class-level usage — training knowledge
- OData v4 URL Conventions Part 2 Section 5.1.3 — $expand syntax — training knowledge

### Tertiary (LOW confidence)

- Express/NestJS `Products(:key)` route param parsing behavior — A2 in assumptions log, needs Wave 0 verification
- $expand semicolon-delimited nested options parsing approach — A4, needs implementation spike

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all dependencies already installed and verified in codebase
- Architecture: HIGH — Phase 3 patterns are clear and directly reusable; new patterns follow same conventions
- Pitfalls: MEDIUM — most are verified from codebase inspection; A2 (route param syntax) and A5 (@ODataController path timing) need Wave 0 validation

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable NestJS/TypeORM ecosystem)
