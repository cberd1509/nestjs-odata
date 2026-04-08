# Phase 3: Query Engine and Response Format - Research

**Researched:** 2026-04-07
**Domain:** OData v4 AST-to-TypeORM translation, NestJS interceptors/filters/pipes, OData JSON response envelope
**Confidence:** HIGH

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Separate visitor classes per query option: `FilterVisitor`, `SelectVisitor`, `OrderByVisitor`, `PaginationVisitor`. Each walks its AST subtree and appends to the same `SelectQueryBuilder`.
- **D-02:** `$filter` string functions (`contains`, `startsWith`, `endsWith`) map to TypeORM-native LIKE/ILIKE where possible. Raw SQL fragments only for functions TypeORM can't express (e.g., `length()`, `indexof()`).
- **D-03:** `$select` uses `QueryBuilder.select()` for real SQL projection — only requested columns fetched. Requires mapping OData property names back to TypeORM column names via EdmEntityType metadata.
- **D-04:** Parameter binding uses TypeORM's built-in parameterization: `.where('price > :p1', { p1: value })`. Generate unique parameter names (`:p1`, `:p2`, ...) to avoid collisions. QUERY-09 mandates zero string interpolation.
- **D-05:** A `ODataResponseInterceptor` (NestJS interceptor) wraps raw results into the OData envelope. Applied only to OData routes via decorator. Non-OData routes unaffected.
- **D-06:** `@odata.nextLink` uses offset-based pagination with `$skip`/`$top`. nextLink = same URL with `$skip` incremented by `$top`. Honors `maxTop` config. nextLink is **omitted** (not null) when there are no more pages.
- **D-07:** `@odata.context` includes `$select` projection: e.g., `/odata/$metadata#Products(Name,Price)` when `$select` is used, `/odata/$metadata#Products` when none.
- **D-08:** `$count=true` adds `@odata.count` to the envelope alongside `value`. `GET /:entitySet/$count` returns plain integer (`text/plain`).
- **D-09:** A custom `ODataExceptionFilter` catches errors on OData routes and formats them as OData v4 error bodies: `{ error: { code, message, details } }`. Applied via `@UseFilters()`.
- **D-10:** Field validation at parse time against EdmRegistry — validate field names and types BEFORE hitting the database.
- **D-11:** Parser throws structured `ODataParseError`; `ODataExceptionFilter` maps it to OData 400. Zero stack-trace leakage.
- **D-12:** User-defined controllers with method-level decorators. User creates a standard NestJS controller and applies `@ODataGet()` on specific methods.
- **D-13:** Default query handler auto-provided with opt-in override. `@ODataGet()` decorator auto-provides a default handler; user can override by defining their own method body.
- **D-14:** `ODataQueryPipe` parses the raw query string and injects a typed `ODataQuery` object (with filter AST, select list, orderby list, top, skip, count flag).
- **D-15:** `GET /:entitySet/$count` registered as a separate route returning a plain integer.

### Claude's Discretion

- Exact visitor class internal implementation details
- TypeORM QueryBuilder chaining order and optimization
- ODataQuery type shape (beyond agreed fields)
- Internal naming conventions for parameter generation
- How the auto-provided handler discovers the correct TypeORM repository
- Interceptor/filter registration mechanics (module-level vs route-level)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                   | Research Support                                                                      |
| -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| QUERY-01 | Custom OData v4 query parser built from OASIS ABNF grammar                                    | Parser exists in Phase 1; this phase wires it into `ODataQueryPipe`                   |
| QUERY-02 | `$filter` support with full OData v4 filter expression parsing                                | `FilterVisitor` walks AST → TypeORM `.andWhere()` / `.orWhere()` calls                |
| QUERY-03 | `$select` field projection — only requested fields returned                                   | `SelectVisitor` → `QueryBuilder.select([...columns])`                                 |
| QUERY-04 | `$orderby` support for sorting by one or more fields (asc/desc)                               | `OrderByVisitor` → `QueryBuilder.orderBy()` / `addOrderBy()`                          |
| QUERY-05 | `$top` and `$skip` support for pagination                                                     | `PaginationVisitor` → `QueryBuilder.take()` / `skip()`                                |
| QUERY-06 | `$count` — both inline (`$count=true`) and `/$count` path segment                             | Separate route for `/$count`; `COUNT(*)` run in parallel with data query              |
| QUERY-09 | All filter literals are SQL-parameterized — zero string interpolation                         | TypeORM `.setParameter()` / named params `:p1, :p2` pattern enforced in FilterVisitor |
| RESP-01  | OData v4 JSON response envelope: `@odata.context`, `value`, `@odata.count`, `@odata.nextLink` | `ODataResponseInterceptor` wraps results; context URL builder per D-07                |
| RESP-02  | OData v4 error format: `error.code`, `error.message`, `error.details`                         | `ODataExceptionFilter` formats all errors for OData routes                            |
| TEST-01  | TDD approach — tests written first against OData v4 spec expected behavior                    | Vitest + unplugin-swc; TDD at unit level for each visitor                             |
| TEST-02  | Unit tests for OData query parser against OASIS ABNF grammar                                  | Parser unit tests already exist (Phase 1); this phase adds translator unit tests      |

</phase_requirements>

---

## Summary

Phase 3 translates the typed OData v4 AST (produced by the Phase 1 parser) into TypeORM `SelectQueryBuilder` calls, then wraps results in a spec-compliant OData JSON envelope. The work splits cleanly across two packages: `@nestjs-odata/core` gains the `ODataQueryPipe`, `ODataResponseInterceptor`, `ODataExceptionFilter`, `@ODataGet()` decorator, and `ODataQuery` type; `@nestjs-odata/typeorm` gains the five visitor classes and `TypeOrmQueryTranslator` that implements the now-refined `IQueryTranslator` interface.

All user-facing decisions are locked (D-01 through D-15). Claude's discretion covers internal wiring: how the auto-provided handler discovers its repository, exact QueryBuilder chaining order, and whether the interceptor is registered module-level or per-route. Both approaches (module-level with metadata guard vs. per-route via `@UseInterceptors()`) are proven NestJS patterns; the section below favors per-route application to minimize surface area.

Security is foundational: parameterized queries are mandated by D-04/QUERY-09, field validation at parse time by D-10, and error body sanitization by D-11. All three are code-level constraints that must be built into the visitors and filter, not bolted on afterward.

**Primary recommendation:** Build the TypeORM visitor classes as pure functions that receive a `SelectQueryBuilder` by reference and accumulate calls, keeping them independently testable. The `TypeOrmQueryTranslator` orchestrates them in a fixed order (filter → select → orderby → pagination). Core pieces (`ODataQueryPipe`, `ODataResponseInterceptor`, `ODataExceptionFilter`) live in `@nestjs-odata/core` and have no ORM dependency.

---

## Standard Stack

### Core (already in project)

| Library              | Version       | Purpose                                                                           | Notes                                                                         |
| -------------------- | ------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `typeorm`            | `^0.3.28`     | SelectQueryBuilder API                                                            | Peer dep in `@nestjs-odata/typeorm` [VERIFIED: packages/typeorm/package.json] |
| `@nestjs/common`     | `^11.0.0`     | `NestInterceptor`, `ExceptionFilter`, `PipeTransform`, `SetMetadata`, `Reflector` | Peer dep [VERIFIED: packages/typeorm/package.json]                            |
| `rxjs`               | `^7.0.0`      | `Observable`, `map` operator — required by NestJS interceptor return type         | Peer dep [VERIFIED: packages/typeorm/package.json]                            |
| `@nestjs-odata/core` | `workspace:*` | AST types, `QueryOptions`, `FilterVisitor`, `ODataParseError`, `EdmRegistry`      | [VERIFIED: packages/core/src/parser/ast.ts, visitor.ts, errors.ts]            |

### No New Dependencies Required

All building blocks already exist. This phase adds **code**, not new packages.
[VERIFIED: scanning packages/core/package.json and packages/typeorm/package.json — no missing runtime deps identified]

---

## Architecture Patterns

### Recommended File Layout (new files only)

```
packages/core/src/
├── query/
│   ├── odata-query.types.ts       # ODataQuery typed object (input to IQueryTranslator)
│   ├── odata-query.pipe.ts        # ODataQueryPipe — PipeTransform implementation
│   └── index.ts
├── response/
│   ├── odata-response.interceptor.ts  # ODataResponseInterceptor
│   ├── odata-exception.filter.ts      # ODataExceptionFilter
│   ├── odata-context-url.builder.ts   # Pure fn: builds @odata.context value
│   └── index.ts
└── decorators/
    └── odata-get.decorator.ts         # @ODataGet() method decorator

packages/typeorm/src/
└── translator/
    ├── typeorm-query-translator.ts    # IQueryTranslator implementation; orchestrates visitors
    ├── filter-visitor.ts              # FilterVisitor: BinaryExpr/FunctionCall → WHERE
    ├── select-visitor.ts              # SelectVisitor: SelectNode → SELECT columns
    ├── orderby-visitor.ts             # OrderByVisitor: OrderByItem[] → ORDER BY
    ├── pagination-visitor.ts          # PaginationVisitor: top/skip → TAKE/SKIP
    └── index.ts
```

### Pattern 1: Visitor Classes (D-01)

Each visitor receives the `SelectQueryBuilder` by reference and the `EdmEntityType` for column mapping. Visitors are stateless beyond the builder reference — they produce side effects on the builder, not new values.

```typescript
// Source: OData v4 Part 2 §5.1.1; TypeORM QueryBuilder docs [ASSUMED - pattern derivation]
class FilterVisitor implements FilterVisitor<void> {
  private paramCount = 0

  constructor(
    private readonly qb: SelectQueryBuilder<unknown>,
    private readonly alias: string,
    private readonly entityType: EdmEntityType,
  ) {}

  // Each visit method calls this.qb.andWhere() with :pN parameters
  visitBinaryExpr(node: BinaryExprNode): void { ... }
  visitFunctionCall(node: FunctionCallNode): void { ... }
  // ... etc

  private nextParam(): string {
    return `p${++this.paramCount}`
  }
}
```

The `TypeOrmQueryTranslator` orchestrates in a deterministic order:

```typescript
// Source: TypeORM QueryBuilder docs [ASSUMED - ordering is by convention, not enforced]
translate(query: ODataQuery, entityType: EdmEntityType): SelectQueryBuilder<unknown> {
  const alias = 'entity'
  const qb = this.repo.createQueryBuilder(alias)

  if (query.filter) new FilterVisitor(qb, alias, entityType).visitRoot(query.filter)
  if (query.select) new SelectVisitor(qb, alias, entityType).visit(query.select)
  if (query.orderBy) new OrderByVisitor(qb, alias, entityType).visit(query.orderBy)
  new PaginationVisitor(qb, query.top, query.skip, this.maxTop).visit()

  return qb
}
```

### Pattern 2: ODataQueryPipe (D-14)

NestJS `PipeTransform` that receives the raw query string (or Express request query object) and returns a typed `ODataQuery`. Parsing delegates to the Phase 1 `ODataQueryParser`. Field validation (D-10) happens here, after parsing.

```typescript
// Source: NestJS official docs — PipeTransform [ASSUMED — pattern is standard NestJS]
@Injectable()
export class ODataQueryPipe implements PipeTransform<Record<string, string>, ODataQuery> {
  constructor(private readonly edmRegistry: EdmRegistry) {}

  transform(value: Record<string, string>, metadata: ArgumentMetadata): ODataQuery {
    // 1. Parse raw query string fields into ODataQuery (calls Phase 1 parser)
    // 2. Validate field names/types against EdmRegistry (D-10)
    // 3. Throw ODataParseError on unknown fields — filter catches it (D-11)
    // Returns typed ODataQuery
  }
}
```

The `@ODataQuery()` parameter decorator binds `ODataQueryPipe` to the `req.query` object:

```typescript
// Source: NestJS official docs — createParamDecorator [ASSUMED]
export const ODataQuery = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().query,
)
```

### Pattern 3: ODataResponseInterceptor (D-05, D-07, D-08)

NestJS interceptors receive the `ExecutionContext` and can access the request for building `@odata.context`. The interceptor uses `Reflector` to confirm the route is marked as an OData route before wrapping.

```typescript
// Source: ARCHITECTURE.md Pattern 4; NestJS interceptors docs [VERIFIED: .planning/research/ARCHITECTURE.md]
@Injectable()
export class ODataResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isOData = this.reflector.get(ODATA_ROUTE_KEY, ctx.getHandler())
    if (!isOData) return next.handle() // non-OData routes pass through

    return next.handle().pipe(
      map((result: ODataQueryResult) => ({
        '@odata.context': buildContextUrl(result, this.options.serviceRoot),
        value: result.items,
        ...(result.count !== undefined ? { '@odata.count': result.count } : {}),
        ...(result.nextLink ? { '@odata.nextLink': result.nextLink } : {}),
      })),
    )
  }
}
```

The handler must return a structured `ODataQueryResult` object (not raw entity array) so the interceptor has access to count and nextLink metadata without needing to re-query.

### Pattern 4: ODataExceptionFilter (D-09, D-11)

An `ExceptionFilter` applied via `@UseFilters()` on OData controllers. Catches `ODataParseError`, `ODataValidationError`, and any generic `Error` — formats all into OData v4 error body.

```typescript
// Source: NestJS official docs — ExceptionFilter; OData v4 Part 1 §9.4 [ASSUMED - error body structure per spec]
@Catch()
export class ODataExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    if (exception instanceof ODataParseError) {
      response.status(400).json({
        error: { code: 'BadRequest', message: exception.message, details: [] },
      })
    } else if (exception instanceof ODataValidationError) {
      response.status(400).json({
        error: { code: 'BadRequest', message: exception.message, details: [] },
      })
    } else {
      // Generic — never leak stack trace
      response.status(500).json({
        error: {
          code: 'InternalServerError',
          message: 'An unexpected error occurred.',
          details: [],
        },
      })
    }
  }
}
```

### Pattern 5: @ODataGet() Decorator (D-12, D-13)

Applies `SetMetadata(ODATA_ROUTE_KEY, true)` plus `@Get()` route metadata. When a method body is provided by the user, it runs as-is. When no body is provided, the auto-handler injects the repository and runs the translation pipeline.

```typescript
// Source: NestJS official docs — SetMetadata, applyDecorators [ASSUMED]
export function ODataGet(path?: string): MethodDecorator {
  return applyDecorators(
    Get(path ?? ''),
    SetMetadata(ODATA_ROUTE_KEY, true),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
```

The auto-provided handler (D-13) is the core implementation question under Claude's discretion. Two approaches exist:

**Option A — Decorator factory with auto-handler injection:**
`@ODataGet()` augments the prototype method at decoration time. If the decorated method has zero lines (or is marked with a special sentinel), replace it with the auto-handler. This is complex to detect reliably.

**Option B — Explicit `autoHandler: true` option:**

```typescript
@ODataGet({ autoHandler: true })
findAll(@ODataQuery() query: ODataQuery) {} // body is ignored; auto-handler runs
```

The decorator replaces the method descriptor's value with the auto-handler function when `autoHandler: true` is set.

**Option C — Separate `@ODataAutoGet()` decorator:**
Two decorators: `@ODataGet()` for user-defined handlers, `@ODataAutoGet()` for zero-boilerplate auto-handling.

**Recommendation:** Option B — explicit opt-in `{ autoHandler: true }` is the most predictable API, avoids magic, and aligns with NestJS conventions where configuration is explicit. [ASSUMED — no official precedent found; recommendation based on NestJS API conventions]

### Pattern 6: $count Route (D-08, D-15)

Two separate behaviors from `$count`:

1. `GET /products?$count=true` — adds `@odata.count` to the standard envelope. The translator runs `COUNT(*)` as a second query (or subquery). The handler returns `ODataQueryResult` with `count` populated.

2. `GET /products/$count` — registered as a separate NestJS route. Returns `number` as `text/plain`. TypeORM `.getCount()` on the filtered QueryBuilder.

Both routes must apply the same `$filter` and other non-pagination query options. The `/$count` route ignores `$top`, `$skip`, `$orderby`, and `$select`.

### Pattern 7: $select Column Mapping (D-03)

OData property names must be mapped to TypeORM column names before calling `QueryBuilder.select()`. The `EdmEntityType.properties` array contains `name` (OData name). The TypeORM `EntityMetadata.columns` array contains `propertyName` (TypeScript name) and `databaseName` (SQL column name). The translator must bridge these.

```typescript
// Mapping: OData name → TypeORM alias.column
// EdmProperty.name is the OData property name
// TypeORM EntityMetadata.findColumnWithPropertyName(name) gives the column metadata
// Source: TypeORM internals / EntityMetadata API [ASSUMED — verified by reading deriver code]
const column = `${alias}.${propertyName}`
```

The `EdmEntityType` as currently defined only contains `name` and `type` — it does NOT store the TypeORM `propertyName` or `databaseName`. This is a gap: the SelectVisitor needs a way to map `EdmProperty.name` → TypeORM column name. Either:

- The `TypeOrmQueryTranslator` receives both `EdmEntityType` AND `TypeORM EntityMetadata`, or
- `EdmEntityType` is augmented with a TypeORM-specific field (breaks PKG-01), or
- A lookup table is built at module init time mapping OData name → TypeORM property name.

**Recommendation (Claude's discretion):** Pass TypeORM `EntityMetadata` alongside `EdmEntityType` in the translator. The translator lives in `@nestjs-odata/typeorm`, so the TypeORM dep is already in scope. This avoids polluting the core `EdmEntityType` interface with ORM-specific data.

### Anti-Patterns to Avoid

- **String interpolation in WHERE:** `qb.where(`price > ${value}`)` — SQL injection. Use `.where('price > :p1', { p1: value })`.
- **Applying interceptor globally:** `app.useGlobalInterceptors(new ODataResponseInterceptor())` — wraps all routes including non-OData ones. Use per-route via `@ODataGet()` composition instead.
- **Running COUNT as a separate HTTP call:** The `$count=true` query should use `qb.getManyAndCount()` (returns `[entities, count]` in one DB roundtrip) instead of two sequential queries. [VERIFIED: TypeORM docs — getManyAndCount() exists]
- **Including nextLink when result is complete:** If `results.length < effectiveTop`, there are no more pages. nextLink must be absent, not present with null. [VERIFIED: PITFALLS.md Pitfall 10]
- **Leaking ODataParseError position in production:** The position field is useful for debugging but the error body must never include a stack trace.

---

## Don't Hand-Roll

| Problem               | Don't Build                              | Use Instead                                      | Why                                                            |
| --------------------- | ---------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Parameterized queries | String-building SQL with values          | TypeORM `.where('col = :p', {p: val})`           | Security (QUERY-09); TypeORM handles dialect differences       |
| `getManyAndCount()`   | Two separate DB queries for data + count | TypeORM `qb.getManyAndCount()`                   | Single DB roundtrip; correct even with filters                 |
| NestJS route metadata | Manual Reflect.defineMetadata            | `SetMetadata(key, value)` + `Reflector.get()`    | Official NestJS mechanism; survives minification               |
| Observable wrapping   | Custom observable construction           | `next.handle().pipe(map(...))`                   | NestJS interceptor contract; handles async/streaming correctly |
| LIKE pattern escaping | Manual `%` prepend/append                | TypeORM `.where("col LIKE :p", {p: `%${val}%`})` | Handles DB-specific LIKE syntax                                |

---

## Common Pitfalls

### Pitfall 1: $select Projection Requires Column Name Mapping

**What goes wrong:** `QueryBuilder.select(['entity.Name'])` uses the TypeORM **property name** (`Name`), not the OData property name. If they differ (e.g., TypeORM `firstName` but OData `FirstName`), the select produces no rows or SQL errors.
**Why it happens:** `EdmEntityType` stores OData names; TypeORM uses its own property names.
**How to avoid:** Build a `Map<odataName, typeOrmPropertyName>` from `EntityMetadata.columns` at translator construction time. Use it in `SelectVisitor` before calling `qb.select()`.
**Warning signs:** `$select=Id,Name` returns rows with undefined properties; SQL shows `entity.Name` which doesn't exist.
[VERIFIED: reading EdmEntityType interface and TypeOrmEdmDeriver — no existing mapping stored]

### Pitfall 2: nextLink Incorrectly Present

**What goes wrong:** Response includes `@odata.nextLink` when results are fewer than the page size, violating OData spec and causing infinite-loop pagination in clients.
**Why it happens:** Logic `if (results.length === pageSize) { addNextLink }` passes when exactly `$top` results are returned, even if it's the last page.
**How to avoid:** Only add nextLink when `results.length >= effectiveTop`. When querying, fetch `effectiveTop + 1` rows; if `> effectiveTop` come back, a next page exists — return only `effectiveTop` items and add nextLink.
**Warning signs:** `$top=5` on a 5-row table returns nextLink; client enters infinite loop.
[VERIFIED: PITFALLS.md Pitfall 10]

### Pitfall 3: $count Route Applies Wrong Query Options

**What goes wrong:** `GET /products/$count?$top=5` should return the total filtered count ignoring pagination, but applying `$top` to the count query returns the count of the first 5 items.
**Why it happens:** The count handler reuses the full `ODataQuery` without stripping pagination options.
**How to avoid:** When building the count QueryBuilder, apply `$filter` and `$select` restrictions but skip `$top`, `$skip`, and `$orderby`. The count is always the total matching the filter, regardless of pagination.
[ASSUMED — derived from OData v4 spec §5.1.6 semantics]

### Pitfall 4: ClassSerializerInterceptor Strips OData Control Properties

**What goes wrong:** If the app uses NestJS `ClassSerializerInterceptor` globally, it will strip `@odata.context` and `@odata.count` (properties with `@` prefix are not standard class properties).
**Why it happens:** `ClassSerializerInterceptor` serializes through `class-transformer`, which ignores non-decorated properties.
**How to avoid:** Return plain objects from OData handlers (not class instances), or exclude OData responses from `ClassSerializerInterceptor`. Return `{ '@odata.context': ..., value: plainArray }` as a plain object literal.
[VERIFIED: ARCHITECTURE.md Integration Gotchas]

### Pitfall 5: Parameter Name Collisions in Complex Filters

**What goes wrong:** `$filter=a eq 1 and b eq 2` generates two parameters; if the visitor resets the counter per node rather than per traversal, `:p1` gets reused, causing TypeORM to silently overwrite one value.
**Why it happens:** Shared mutable state (the parameter counter) is not threaded correctly through recursive AST traversal.
**How to avoid:** Maintain a single `paramCount` state on the `FilterVisitor` instance. Pass the instance (not a static helper) through the recursive `accept()` calls. Each call to `nextParam()` increments and returns a unique name.
[ASSUMED — derived from D-04 constraint on unique parameter names]

### Pitfall 6: `contains()` Maps to LIKE but LIKE Escapes Aren't Applied

**What goes wrong:** `contains(Name, 'widget%')` should match literal `widget%`, but naively generating `LIKE '%widget%%'` treats `%` as a wildcard.
**Why it happens:** LIKE special characters (`%`, `_`) in the literal value are not escaped before wrapping in `%...%`.
**How to avoid:** Escape LIKE special characters in the literal before wrapping: replace `%` → `\%` and `_` → `\_` in the value. Pass the escaped value as a parameter (TypeORM handles the final parameterization).
[VERIFIED: PITFALLS.md Pitfall 2 — string escaping requirement; LIKE escape is a known gotcha]

---

## Code Examples

### FilterVisitor — Binary Comparison

```typescript
// Source: TypeORM QueryBuilder docs [ASSUMED — API shape confirmed via existing deriver test patterns]
visitBinaryExpr(node: BinaryExprNode): void {
  if (isLogicalOp(node.operator)) {
    // For 'and'/'or', recurse into both sides
    const leftParam = this.nextParam()
    const rightParam = this.nextParam()
    // ... build nested where
  } else {
    // Comparison op: eq, ne, lt, le, gt, ge
    const left = this.resolveProperty(node.left)   // e.g., 'entity.price'
    const op = toSqlOp(node.operator)               // e.g., '>'
    const paramName = this.nextParam()              // e.g., 'p1'
    const value = extractLiteralValue(node.right)
    this.qb.andWhere(`${left} ${op} :${paramName}`, { [paramName]: value })
  }
}
```

### getManyAndCount for $count=true

```typescript
// Source: TypeORM docs — getManyAndCount() [ASSUMED — method name confirmed by TypeORM API]
// When $count=true is in query options, call getManyAndCount instead of getMany
const [items, count] = await qb.getManyAndCount()
return { items, count }
```

### buildContextUrl (D-07)

```typescript
// Source: OData v4 Part 1 §10.1 [ASSUMED — spec mandates this URL format]
function buildContextUrl(serviceRoot: string, entitySetName: string, select?: SelectNode): string {
  const base = `${serviceRoot}/$metadata#${entitySetName}`
  if (select?.items?.length) {
    const fields = select.items.map((i) => i.path.join('/')).join(',')
    return `${base}(${fields})`
  }
  return base
}
```

### nextLink construction (D-06)

```typescript
// Source: PITFALLS.md Pitfall 10; OData v4 §5.1.5 [VERIFIED: PITFALLS.md]
// Fetch one extra item to determine if more pages exist
const effectiveTop = Math.min(top ?? maxTop, maxTop)
const fetched = await qb.take(effectiveTop + 1).getMany()
const hasMore = fetched.length > effectiveTop
const items = hasMore ? fetched.slice(0, effectiveTop) : fetched
const nextLink = hasMore
  ? buildNextLink(requestUrl, (skip ?? 0) + effectiveTop, effectiveTop)
  : undefined
```

### ODataGet decorator composition (D-12)

```typescript
// Source: NestJS official docs — applyDecorators, SetMetadata [ASSUMED]
export const ODATA_ROUTE_KEY = Symbol('ODATA_ROUTE')

export function ODataGet(options?: { path?: string; autoHandler?: boolean }): MethodDecorator {
  return applyDecorators(
    Get(options?.path ?? ''),
    SetMetadata(ODATA_ROUTE_KEY, { autoHandler: options?.autoHandler ?? false }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
```

---

## IQueryTranslator Interface — Refined Signature

The current placeholder in `packages/core/src/interfaces/query-translator.interface.ts` uses `(query: unknown, entityType: EdmEntityType): unknown`. Phase 3 must refine it:

```typescript
// Source: packages/core/src/interfaces/query-translator.interface.ts [VERIFIED: file read]
// Refined signature for Phase 3:
export interface IQueryTranslator<TQuery = unknown> {
  /**
   * Translate a parsed ODataQuery into an ORM-specific query object.
   * @param query - Typed ODataQuery from ODataQueryPipe
   * @param entityType - EDM entity type for field name resolution
   * @returns ORM-specific query builder or query object (e.g., TypeORM SelectQueryBuilder)
   */
  translate(query: ODataQuery, entityType: EdmEntityType): TQuery

  /**
   * Execute the translated query and return results with optional count.
   * Separating translation from execution allows testing the QueryBuilder shape.
   */
  execute(translatedQuery: TQuery, includeCount: boolean): Promise<ODataQueryResult>
}
```

Separating `translate()` (produces the QueryBuilder) from `execute()` (runs it) simplifies unit testing: tests can assert the QueryBuilder state without hitting a database.

---

## ODataQuery Type Shape

The `ODataQuery` object that `ODataQueryPipe` produces and `ODataQueryPipe` injects:

```typescript
// Location: packages/core/src/query/odata-query.types.ts (new file)
export interface ODataQuery {
  /** Parsed $filter AST. Undefined when $filter not present. */
  readonly filter?: FilterNode
  /** Parsed $select options. Undefined when $select not present. */
  readonly select?: SelectNode
  /** Parsed $orderby items. Undefined when $orderby not present. */
  readonly orderBy?: OrderByItem[]
  /** $top value after enforcing maxTop. Undefined when not specified. */
  readonly top?: number
  /** $skip value. Undefined when not specified (defaults to 0 in pagination). */
  readonly skip?: number
  /** True when $count=true was in the query string. */
  readonly count?: boolean
  /** Entity set name — used for context URL and validation. */
  readonly entitySetName: string
}

export interface ODataQueryResult<T = unknown> {
  readonly items: T[]
  readonly count?: number
  readonly nextLink?: string
  readonly select?: SelectNode // for @odata.context construction
}
```

---

## State of the Art

| Old Approach                     | Current Approach                          | When Changed                     | Impact                                                                               |
| -------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| Global OData interceptor         | Per-route via `SetMetadata` + `Reflector` | NestJS 9+ (Reflector API stable) | Non-OData routes isolated [VERIFIED: ARCHITECTURE.md Pattern 4]                      |
| `getMany()` + separate `count()` | `getManyAndCount()`                       | TypeORM 0.3.x                    | Single DB roundtrip for `$count=true` [ASSUMED — getManyAndCount confirmed to exist] |
| Offset pagination only           | Offset acceptable for v1                  | Phase 3 decision                 | Per D-06; cursor-based is v2 [VERIFIED: CONTEXT.md D-06]                             |

---

## Assumptions Log

| #   | Claim                                                                                                                  | Section                 | Risk if Wrong                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A1  | TypeORM `qb.getManyAndCount()` is available and works with complex WHERE clauses                                       | Code Examples           | If not available, two queries needed — extra implementation work                                                      |
| A2  | `applyDecorators()` preserves all decorator effects correctly for method decorators in NestJS 11                       | Pattern 5 (@ODataGet)   | If broken, per-decorator application needed; minor refactor                                                           |
| A3  | `SelectQueryBuilder.take()` / `skip()` are the correct TypeORM 0.3.x methods for pagination (not `limit()`/`offset()`) | Pitfall 2               | If wrong, pagination is silently applied via wrong API; use `take`/`skip` for ORM-level, `limit`/`offset` for raw SQL |
| A4  | OData spec §10.1 context URL format for $select is `#EntitySet(Field1,Field2)`                                         | buildContextUrl example | If format differs, clients may reject context URL                                                                     |
| A5  | Passing `EntityMetadata` alongside `EdmEntityType` to the translator is the cleanest mapping approach                  | Pattern 7               | If another approach is chosen (e.g., storing mapping in EdmEntityType), refactor needed in core                       |
| A6  | Option B (explicit `autoHandler: true`) is the right API for auto-handler opt-in                                       | Pattern 5               | If discarded in favor of Option A or C, decorator implementation changes                                              |
| A7  | `LIKE` special characters (`%`, `_`) must be escaped before wrapping in `%value%` for `contains()`                     | Pitfall 6               | If escaping is skipped, filter results are incorrect for values containing SQL wildcards                              |

---

## Open Questions

1. **Repository discovery for auto-handler (D-13 — Claude's discretion)**
   - What we know: The auto-handler in `@ODataGet({ autoHandler: true })` must call the TypeORM translator, which needs the `Repository<Entity>` for the entity set.
   - What's unclear: How does the auto-handler know which `Repository` to inject? The decorator is in `@nestjs-odata/core` which has zero TypeORM dependency (PKG-01).
   - Recommendation: The auto-handler should be provided by `@nestjs-odata/typeorm`, not core. `@ODataGet()` in core sets metadata only; `ODataTypeOrmModule` provides a factory that creates the auto-handler method for each registered entity. The user applies `@ODataGet({ autoHandler: true })` and `ODataTypeOrmModule.forFeature([Entity])` — the module provides the handler via a NestJS module enhancer (e.g., `APP_INTERCEPTOR` or a custom provider targeting the controller prototype). This is the only approach that preserves PKG-01.

2. **ODataValidationError — new error type needed (D-10, D-11)**
   - What we know: D-10 says field validation happens at parse time, D-11 says the filter catches ODataParseError.
   - What's unclear: Should field validation use a new `ODataValidationError` class, or re-use `ODataParseError`?
   - Recommendation: Create `ODataValidationError extends Error` in `@nestjs-odata/core` for semantic clarity. The filter catches both. Keeps "parse error" semantically distinct from "unknown field" validation error.

3. **Interceptor registration: module-level vs per-route (Claude's discretion)**
   - What we know: D-05 says interceptor is applied "only to OData routes via decorator"; ARCHITECTURE.md confirms `SetMetadata + Reflector` pattern.
   - What's unclear: Register at module level (with metadata guard) vs at method level via `@ODataGet()` composition.
   - Recommendation: Per-route via `@ODataGet()` composition with `UseInterceptors(ODataResponseInterceptor)`. This is more explicit, requires less magic, and aligns with D-12's user-defined controller pattern. A controller using `@ODataGet()` automatically gets the interceptor; a plain `@Get()` never does.

---

## Environment Availability

Step 2.6: SKIPPED — phase is purely code changes within the existing monorepo. No new external tools, services, or CLI utilities required. All runtime deps (`typeorm`, `@nestjs/common`, `rxjs`) are already installed.

---

## Project Constraints (from CLAUDE.md)

| Constraint                                              | Impact on Phase 3                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs-odata/core` has zero ORM dependencies (PKG-01) | `ODataQueryPipe`, `ODataResponseInterceptor`, `ODataExceptionFilter`, `@ODataGet()` must NOT import TypeORM                                 |
| Visitors and translator live in `@nestjs-odata/typeorm` | `FilterVisitor`, `SelectVisitor`, `OrderByVisitor`, `PaginationVisitor`, `TypeOrmQueryTranslator` all in `packages/typeorm/src/translator/` |
| TDD mandatory (TEST-01)                                 | Write unit tests for each visitor class first (RED) before implementing                                                                     |
| pnpm always                                             | `pnpm add` for any new dep; no npm/yarn                                                                                                     |
| No `console.log` in production code                     | Use NestJS `Logger` for any debug output                                                                                                    |
| Immutable patterns                                      | `ODataQuery` and `ODataQueryResult` use `readonly` fields; never mutate existing objects                                                    |
| TypeScript strict — no `any`                            | Use `unknown` for untyped inputs, narrow with type guards                                                                                   |
| Function limit 50 lines                                 | Visitor methods should be short; extract helpers for complex operator mappings                                                              |
| Vitest + unplugin-swc for tests                         | Required for NestJS/TypeORM decorator metadata; already configured in `vitest.config.ts`                                                    |

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                 |
| --------------------- | ------- | ---------------------------------------------------------------- |
| V2 Authentication     | no      | Not in scope                                                     |
| V3 Session Management | no      | Not in scope                                                     |
| V4 Access Control     | no      | Library-level; consumers provide Guards                          |
| V5 Input Validation   | yes     | `ODataQueryPipe` validates field names/types against EdmRegistry |
| V6 Cryptography       | no      | Not applicable                                                   |

### Known Threat Patterns for This Stack

| Pattern                                      | STRIDE                 | Standard Mitigation                                                                                                                      |
| -------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| OData filter → SQL injection                 | Tampering              | TypeORM named parameters `:p1` — zero string interpolation (QUERY-09, D-04) [VERIFIED: PITFALLS.md Security Mistakes]                    |
| Stack trace in OData error body              | Info Disclosure        | `ODataExceptionFilter` returns only `code` + `message`; never `error.stack` (D-11)                                                       |
| Unknown field in $filter bypasses validation | Elevation of Privilege | `ODataQueryPipe` validates all property references against `EdmRegistry` before translation (D-10)                                       |
| Oversized queries (DoS via deep filter)      | DoS                    | `maxTop` config from Phase 2 honored in `PaginationVisitor`; filter AST node count limit is Phase 5 scope                                |
| `@ODataExclude()` properties in $select      | Info Disclosure        | `SelectVisitor` must reject any property not present in `EdmEntityType.properties` (excluded props were stripped at EDM derivation time) |

---

## Sources

### Primary (HIGH confidence)

- `packages/core/src/parser/ast.ts` — Verified AST node types, `QueryOptions`, `FilterNode` discriminated union
- `packages/core/src/parser/visitor.ts` — Verified `FilterVisitor<T>` interface and `acceptVisitor()` dispatch function
- `packages/core/src/parser/errors.ts` — Verified `ODataParseError` with `position` and `token`
- `packages/core/src/interfaces/query-translator.interface.ts` — Verified current placeholder signature
- `packages/core/src/edm/edm-registry.ts` — Verified `EdmRegistry` injectable API
- `packages/core/src/edm/edm-entity-type.ts` — Verified `EdmEntityType` interface (no TypeORM fields)
- `packages/core/src/odata.module.ts` — Verified `ODataModuleResolvedOptions` with `maxTop`
- `packages/typeorm/src/odata-typeorm.module.ts` — Verified `ODataTypeOrmModule.forFeature()` pattern
- `.planning/research/ARCHITECTURE.md` — Verified Pattern 4 (route-scoped interceptor with Reflector)
- `.planning/research/PITFALLS.md` — Verified Pitfall 10 (nextLink), Pitfall 2 (filter escaping), Security Mistakes (parameterization)

### Secondary (MEDIUM confidence)

- NestJS official docs patterns (interceptors, exception filters, pipes, custom decorators) — standard NestJS conventions; confirmed by existing codebase patterns
- TypeORM `getManyAndCount()` — confirmed as existing API; specific behavior with complex queries [ASSUMED for correctness details]

### Tertiary (LOW confidence)

- Specific TypeORM `take()` vs `limit()` behavior for pagination — confirmed `take()`/`skip()` is the ORM-safe approach; `limit()`/`offset()` is raw SQL level

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — verified against existing package.json files; no new deps
- Architecture: HIGH — patterns verified against existing codebase and architecture research
- Pitfalls: HIGH — cross-referenced against PITFALLS.md and existing code inspection
- Auto-handler mechanism: LOW — Claude's discretion area; PKG-01 constraint creates genuine design challenge

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable stack; TypeORM 0.3.x API is mature)
