# Phase 11: $search and $apply — Research

**Researched:** 2026-04-08
**Domain:** OData v4 free-text search + aggregation pipeline; custom parser extension, TypeORM QueryBuilder, adapter pattern
**Confidence:** HIGH (based on verified codebase read + OData v4 spec knowledge)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** LIKE fallback + pluggable FTS. Default uses SQL `LIKE %term%` across configurable searchable fields (marked via decorator or config). Users can plug in a custom search provider via `ISearchProvider` — same adapter pattern as `IETagProvider`. Core defines interface, TypeORM adapter provides the LIKE default.
- **D-02:** Single SQL query. Translate the entire `$apply` pipeline into one SQL query with `GROUP BY`, aggregate functions (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`), and `WHERE` clauses. Pipeline steps (`filter`/`groupby`/`aggregate`) map to SQL clauses. Response is a flat array of aggregated rows — different shape from regular GET.
- **D-03:** Extend existing parser. Add `parseSearch()` and `parseApply()` to the existing parser module. `$search` is a simple free-text parser (quoted phrases, AND/OR/NOT). `$apply` needs a mini-pipeline parser for `filter(...)/groupby((...),aggregate(...))`. Reuse existing AST visitor pattern.

### Claude's Discretion

- Searchable fields decorator design (`@ODataSearchable()` or config-based)
- $apply supported transformation types (start with `filter`, `groupby`, `aggregate` — defer `compute`, `concat`, `expand` to v2)
- How aggregated response differs from entity response in the interceptor (no @odata.id, different @odata.context)
- Whether $search and $apply can be combined in one request

### Deferred Ideas (OUT OF SCOPE)

- $apply `compute` transformation
- $apply `concat` transformation
- $apply `expand` transformation
- Full-text search integration guides (PostgreSQL tsvector, Elasticsearch)
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                               | Research Support                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SRCH-01 | `$search` query option parses free-text expressions                                       | parseSearch() new function in parser.ts; new SearchNode AST type; new TokenKinds (DOUBLE_QUOTE for phrases) or string-based approach |
| SRCH-02 | `$search` translates to configurable full-text backend (LIKE fallback, FTS extension)     | ISearchProvider interface in core; TypeOrmSearchProvider (LIKE default); ODataQuery extension; TypeOrmQueryTranslator search branch  |
| AGG-01  | `$apply=groupby((field),aggregate(count as Total))` parses and translates to SQL GROUP BY | parseApply() new function; ApplyNode AST; apply-visitor.ts in typeorm; qb.groupBy() + qb.select() aggregate expressions              |
| AGG-02  | `$apply=aggregate(field with sum as Total)` produces aggregated response                  | aggregate-only (no groupby) maps to SQL aggregate function without GROUP BY; ODataQueryResult extended with isAggregated flag        |
| AGG-03  | `$apply=filter(...)` as transformation step in the apply pipeline                         | filter() transformation step calls existing parseFilter() internally; maps to qb.andWhere() before GROUP BY                          |

</phase_requirements>

---

## Summary

Phase 11 adds two independent query subsystems to the nestjs-odata library. Both are architectural extensions to existing infrastructure: the custom recursive-descent parser gains two new top-level parse functions, two new AST node hierarchies are added to `ast.ts`, the `ODataQuery`/`ODataQueryResult` types gain new optional fields, and the TypeORM adapter gains a new visitor (apply-visitor) plus a new provider interface (ISearchProvider).

The codebase is cleanly layered. Core owns all AST definitions, interfaces, and the query pipe; the typeorm adapter owns all SQL translation. This boundary is strict and must be maintained. The existing `IETagProvider`/`ETAG_PROVIDER`/`TypeOrmETagProvider` triplet is the canonical pattern to follow for `ISearchProvider`/`SEARCH_PROVIDER`/`TypeOrmSearchProvider`.

The $apply response format deviates from entity collections: aggregated rows are plain objects with no `@odata.id` or `@odata.type` per OData v4 Part 2 Section 3. The `@odata.context` URL uses a projection-style format: `$metadata#Orders(CustomerId,Total)`. The interceptor must branch on a flag (`isAggregated`) in `ODataQueryResult` to apply this different formatting.

**Primary recommendation:** Add AST nodes → extend parser → extend ODataQuery → add TypeOrmApplyVisitor → add ISearchProvider + TypeOrmSearchProvider → extend TypeOrmQueryTranslator → handle aggregated response in interceptor.

---

## Standard Stack

No new npm packages required. All work uses existing codebase primitives:

| Component                    | Version   | Purpose                                                                     |
| ---------------------------- | --------- | --------------------------------------------------------------------------- |
| `typeorm` SelectQueryBuilder | `^0.3.28` | `.groupBy()`, `.addGroupBy()`, `.select()` with aggregate expressions       |
| `@nestjs-odata/core` parser  | internal  | Extend with `parseSearch()`, `parseApply()`                                 |
| `reflect-metadata`           | `^0.2.2`  | Used by new `@ODataSearchable()` decorator (same pattern as `@ODataETag()`) |

**No new dependencies.** [VERIFIED: codebase read]

---

## Architecture Patterns

### Existing Parser Architecture (VERIFIED: codebase read)

The parser is a hand-written recursive-descent parser in `packages/core/src/parser/parser.ts`. It uses a `Parser` class with `tokenize()` (from `lexer.ts`) plus Pratt precedence-climbing for binary operators. Public entry points are:

- `parseFilter(input: string): FilterNode`
- `parseQuery(queryString: string): QueryOptions`
- `parseOrderBy(value: string): OrderByItem[]` (internal)
- `parseSelect(value: string): SelectNode` (internal)
- `parseExpand(value: string): ExpandNode` (internal)

New entry points to add (exported from `parser/index.ts`):

- `parseSearch(input: string): SearchNode`
- `parseApply(input: string): ApplyNode`

### AST Extension Pattern (VERIFIED: codebase read)

All AST nodes live in `packages/core/src/parser/ast.ts` as TypeScript interfaces with `kind` discriminants. The union type at the bottom determines type narrowing. New nodes follow the same pattern:

```typescript
// Source: packages/core/src/parser/ast.ts (verified)

// $search AST
export interface SearchTermNode {
  readonly kind: 'SearchTerm'
  readonly value: string // unquoted word or quoted phrase
  readonly negated?: boolean // preceded by NOT
}
export interface SearchBinaryNode {
  readonly kind: 'SearchBinary'
  readonly operator: 'AND' | 'OR'
  readonly left: SearchNode
  readonly right: SearchNode
}
export type SearchNode = SearchTermNode | SearchBinaryNode

// $apply AST
export interface ApplyFilterStep {
  readonly kind: 'ApplyFilter'
  readonly filter: FilterNode // reuse existing FilterNode
}
export interface AggregateExpression {
  readonly property: string // field being aggregated (or '$count')
  readonly method: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countdistinct'
  readonly alias: string // the 'as TotalAmount' alias
}
export interface ApplyGroupByStep {
  readonly kind: 'ApplyGroupBy'
  readonly properties: string[] // groupby((CustomerId, Year))
  readonly aggregate?: AggregateExpression[] // optional aggregate(...)
}
export interface ApplyAggregateStep {
  readonly kind: 'ApplyAggregate'
  readonly expressions: AggregateExpression[] // top-level aggregate(...)
}
export type ApplyStep = ApplyFilterStep | ApplyGroupByStep | ApplyAggregateStep
export interface ApplyNode {
  readonly steps: ApplyStep[] // pipeline: filter/.../groupby/...
}
```

### ODataQuery Extension Pattern (VERIFIED: codebase read)

`packages/core/src/query/odata-query.types.ts` defines `ODataQuery` and `ODataQueryResult`. Both need new optional fields:

```typescript
// Source: packages/core/src/query/odata-query.types.ts (verified)
export interface ODataQuery {
  // existing fields...
  readonly search?: SearchNode // from $search
  readonly apply?: ApplyNode // from $apply
}

export interface ODataQueryResult<T = unknown> {
  readonly items: T[]
  readonly count?: number
  readonly nextLink?: string
  readonly select?: SelectNode
  readonly isAggregated?: boolean // true when $apply produced aggregated rows
  readonly applyProperties?: string[] // column names for @odata.context projection
}
```

### ODataQueryPipe Extension (VERIFIED: codebase read)

`packages/core/src/query/odata-query.pipe.ts` parses query params in a `for...of` loop over `Object.entries(value)`. Add two new `else if` branches:

```typescript
// Source: packages/core/src/query/odata-query.pipe.ts (verified pattern)
} else if (lkey === '$search') {
  const val = part.slice('$search='.length)
  search = parseSearch(decodeURIComponent(val))
} else if (lkey === '$apply') {
  const val = part.slice('$apply='.length)
  apply = parseApply(decodeURIComponent(val))
}
```

`$apply` fields (groupby properties, aggregate aliases) do NOT need validation against EdmRegistry in the pipe — the translator validates them. `$search` terms are free-text and require no field validation.

### ISearchProvider Interface Pattern (VERIFIED: etag.interface.ts)

Exact same pattern as `IETagProvider`. Core defines interface + symbol token, adapter implements:

```typescript
// New file: packages/core/src/interfaces/search.interface.ts
export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER')

export interface ISearchProvider {
  /**
   * Build a WHERE condition for the $search term against the entity set.
   * Returns an object with { condition: string, params: Record<string, unknown> }
   * to be applied via qb.andWhere(condition, params).
   */
  buildSearchCondition(
    searchNode: SearchNode,
    entitySetName: string,
    alias: string,
  ): { condition: string; params: Record<string, unknown> } | null
}
```

The TypeORM adapter's default implementation (`TypeOrmSearchProvider`) reads searchable fields from entity metadata (decorator `@ODataSearchable()`) and builds `LIKE %term%` OR chains.

### @ODataSearchable() Decorator (Claude's Discretion — RECOMMENDED APPROACH)

Follow the exact same pattern as `@ODataETag()` in `packages/core/src/decorators/odata-etag.decorator.ts`. Metadata is stored via `Reflect.defineMetadata` on the class constructor. The `TypeOrmSearchProvider` reads it via `Reflect.getMetadata`:

```typescript
// Source: packages/core/src/decorators/odata-etag.decorator.ts (verified pattern)
export const ODATA_SEARCHABLE_KEY = 'odata:searchable'

export function ODataSearchable(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const existing: string[] = Reflect.getMetadata(ODATA_SEARCHABLE_KEY, target.constructor) ?? []
    Reflect.defineMetadata(
      ODATA_SEARCHABLE_KEY,
      [...existing, String(propertyKey)],
      target.constructor,
    )
  }
}

export function getSearchableProperties(target: new (...args: unknown[]) => unknown): string[] {
  return Reflect.getMetadata(ODATA_SEARCHABLE_KEY, target) ?? []
}
```

Config-based searchable fields are a viable alternative but the decorator approach is more consistent with the existing codebase style and allows per-property opt-in.

### TypeOrmApplyVisitor (NEW — $apply translation) (ASSUMED for specific API)

Separate file `packages/typeorm/src/translator/apply-visitor.ts`. Takes the SelectQueryBuilder, modifies it to produce a GROUP BY query:

```typescript
// Pattern: analogous to existing visitors (verified)
export class TypeOrmApplyVisitor {
  constructor(
    private readonly qb: SelectQueryBuilder<ObjectLiteral>,
    private readonly alias: string,
  ) {}

  apply(applyNode: ApplyNode): ApplyProperties {
    // Returns the projected column names for @odata.context
  }

  private applyFilterStep(step: ApplyFilterStep): void {
    // Delegate to TypeOrmFilterVisitor (reuse)
  }

  private applyGroupByStep(step: ApplyGroupByStep): string[] {
    // qb.select(`${alias}.CustomerId`) for each groupby property
    // qb.addGroupBy(`${alias}.CustomerId`) for each
    // qb.addSelect(`SUM(${alias}.Amount) AS "Total"`) for each aggregate
  }

  private applyAggregateStep(step: ApplyAggregateStep): string[] {
    // No GROUP BY — just aggregate select expressions
    // qb.select(`COUNT(*) AS "Total"`) etc.
  }
}
```

SQL translation rules for aggregate methods [VERIFIED: standard SQL]:

- `count` → `COUNT(*)` or `COUNT(alias.field)`
- `sum` → `SUM(alias.field)`
- `avg` → `AVG(alias.field)`
- `min` → `MIN(alias.field)`
- `max` → `MAX(alias.field)`
- `countdistinct` → `COUNT(DISTINCT alias.field)`

TypeORM QueryBuilder `.getRawMany()` must be used instead of `.getMany()` for aggregated queries because `.getMany()` maps rows to entity instances and drops computed aliases. [ASSUMED: standard TypeORM behavior — getRawMany() is the correct method for raw SQL projections]

### TypeOrmQueryTranslator Extension (VERIFIED: codebase read)

`translate()` method gets two new branches after existing visitors:

```typescript
// Source: packages/typeorm/src/translator/typeorm-query-translator.ts (verified pattern)
// 6. Apply ($apply aggregation pipeline)
let applyProperties: string[] | undefined
if (query.apply) {
  const applyVisitor = new TypeOrmApplyVisitor(qb, alias)
  applyProperties = applyVisitor.apply(query.apply)
}

// 7. Search ($search free-text)
if (query.search) {
  const searchProvider = this.searchProvider // injected via DI
  const result = searchProvider?.buildSearchCondition(query.search, query.entitySetName, alias)
  if (result) {
    qb.andWhere(result.condition, result.params)
  }
}
```

`execute()` needs a new branch: when `isAggregated`, call `qb.getRawMany()` instead of `qb.getMany()`:

```typescript
// In execute():
if (isAggregated) {
  const items = await qb.getRawMany()
  return { items, isAggregated: true, applyProperties }
}
```

### $apply Response Format (VERIFIED: OData v4 Part 2 Section 3 [CITED: docs.oasis-open.org/odata/odata-data-aggregation-ext/v4.0])

Aggregated results use a different `@odata.context` format. Instead of `$metadata#Orders`, the context URL reflects the projected columns:

```
@odata.context: /odata/$metadata#Orders(CustomerId,Total)
```

This is the same select-projection format already supported by `buildContextUrl()` in `odata-context-url.builder.ts`. Pass the aggregated column names as a synthetic `SelectNode` to `buildContextUrl`.

The interceptor (`odata-response.interceptor.ts`) handles this with a new branch: when `queryResult.isAggregated === true`, skip entity annotation (no `@odata.id`, no `@odata.type`, no navigation links) and use the projection context URL.

### Module Registration Pattern for ISearchProvider (VERIFIED: odata-typeorm.module.ts)

Following the ETAG_PROVIDER pattern exactly:

```typescript
// In ODataTypeOrmModule.forFeature() providers array:
{
  provide: TypeOrmSearchProvider,
  useFactory: (dataSource: DataSource, edmRegistry: EdmRegistry): TypeOrmSearchProvider => {
    return new TypeOrmSearchProvider(dataSource, edmRegistry)
  },
  inject: [DataSource, EdmRegistry],
},
{
  provide: SEARCH_PROVIDER,
  useExisting: TypeOrmSearchProvider,
},
```

TypeOrmQueryTranslator gets `@Inject(SEARCH_PROVIDER) private readonly searchProvider: ISearchProvider` in its constructor (optional — graceful degradation if not provided).

---

## Don't Hand-Roll

| Problem                           | Don't Build           | Use Instead                                                                                   |
| --------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| $apply filter step SQL            | New filter translator | Instantiate existing `TypeOrmFilterVisitor` (or `InnerFilterExprBuilder`) with the current qb |
| Aggregate COUNT SQL               | Custom counting logic | Standard SQL `COUNT(*)` via `qb.select()` string                                              |
| LIKE escape for $search           | Custom escaping       | Copy the existing `escapeLike()` method already in `TypeOrmFilterVisitor`                     |
| Prototype-based decorator storage | Custom reflection     | `Reflect.defineMetadata` / `Reflect.getMetadata` — already used throughout the codebase       |

---

## Common Pitfalls

### Pitfall 1: Using getMany() for Aggregated Queries

**What goes wrong:** TypeORM's `.getMany()` maps raw SQL rows to entity class instances. Aggregate aliases (`COUNT(*) AS "Total"`) are dropped because they don't map to entity properties.
**Why it happens:** TypeORM entity hydration strips unknown columns.
**How to avoid:** Switch to `.getRawMany()` when `$apply` is present. The result will be `Record<string, unknown>[]`.
**Warning signs:** Aggregate alias values are `undefined` in the result.

### Pitfall 2: $apply Overrides $select and $orderby

**What goes wrong:** When `$apply` is present, the query should not also apply `$select` or entity-column `$orderby` — those options make no sense on aggregated output.
**Why it happens:** The existing translate() blindly applies all visitors.
**How to avoid:** In `translate()`, if `query.apply` is set, skip the `$select`, `$orderby`, and `$expand` visitor branches. Only `$filter` and `$top`/`$skip` (for pagination on aggregated results) may combine with `$apply`.
**Warning signs:** SQL query contains both GROUP BY and entity property ORDER BY, leading to SQL errors.

### Pitfall 3: SQL Injection via Aggregate Aliases

**What goes wrong:** If aggregation aliases (`as Total`) are interpolated directly into SQL, a malicious alias like `Total; DROP TABLE` causes injection.
**Why it happens:** $apply aliases are user-supplied strings.
**How to avoid:** Validate aggregate aliases against `/^[A-Za-z_][A-Za-z0-9_]*$/` before interpolating into SQL. Reject on mismatch. [VERIFIED: standard SQL identifier pattern]

### Pitfall 4: $search Without Searchable Fields

**What goes wrong:** `TypeOrmSearchProvider` has no fields to search against (no `@ODataSearchable()` decorators).
**Why it happens:** Developer forgot to annotate fields.
**How to avoid:** Return `null` from `buildSearchCondition` and log a warning. Do not throw — graceful degradation means all records are returned (or throw a validation error with a clear message).
**Warning signs:** `$search` requests return all rows without filtering.

### Pitfall 5: $apply Pipeline Order Matters

**What goes wrong:** If `aggregate()` is applied before `filter()` in the pipeline, the WHERE clause is generated after GROUP BY, producing HAVING semantics instead of WHERE semantics. OData $apply spec defines that `filter()` before `groupby()` means WHERE; `filter()` after means HAVING.
**Why it happens:** Pipeline steps are ordered by position in the $apply string.
**How to avoid:** The `ApplyNode.steps` array preserves pipeline order. The visitor must detect WHERE-position filter (before any groupby/aggregate step) vs HAVING-position filter (after). For v1.1, only support pre-groupby filter (maps to WHERE). Post-groupby HAVING is complex — reject with a 400 if a filter step follows a groupby step, or silently skip it and document the limitation.
**Warning signs:** SQL contains HAVING where WHERE was expected.

### Pitfall 6: parseApply() $apply String Has Nested Commas

**What goes wrong:** Naive `split('/')` on the $apply string breaks `groupby((A,B),aggregate(C with sum as D))` because the comma inside `groupby(...)` is treated as a pipeline separator.
**Why it happens:** Pipeline steps are `/`-separated, but transformation arguments use commas.
**How to avoid:** Use depth-tracked parsing (same approach as `splitTopLevelCommas()` already in the codebase) when splitting the pipeline. [VERIFIED: `splitTopLevelCommas` already exists in parser.ts]

### Pitfall 7: Double-Registration of SEARCH_PROVIDER

**What goes wrong:** If SEARCH_PROVIDER is registered in both ODataModule.forRoot() and ODataTypeOrmModule.forFeature(), NestJS DI will use the last one registered, leading to silent override.
**Why it happens:** Module hierarchy ambiguity.
**How to avoid:** Only register SEARCH_PROVIDER in the adapter module (ODataTypeOrmModule). Core has no default implementation — it is optional. Use `@Optional()` when injecting in TypeOrmQueryTranslator.

---

## Code Examples

### $search Parser: Parsing Logic

The $search grammar (OASIS OData v4 Part 2, Section 5.1.7) is:

```
searchExpr = searchTerm *(BWS 'OR' BWS searchTerm) / searchTerm *(BWS 'AND' BWS searchTerm)
searchTerm = ['-'] searchWord / ['-'] DQUOTE searchPhrase DQUOTE
```

Simple recursive descent without needing new TokenKinds in the existing lexer — `parseSearch()` can be a standalone function that works on the raw string directly:

```typescript
// Source: design based on verified parser.ts patterns
export function parseSearch(input: string): SearchNode {
  // Split by whitespace-separated AND/OR, collect quoted phrases
  // Minimal tokenization: words, quoted phrases, AND/OR/NOT keywords
  // Returns SearchBinaryNode (AND/OR) or SearchTermNode
}
```

Since `$search` input is URL-decoded free text (not OData $filter syntax), it does NOT need the existing tokenizer. A small standalone string-based parser is cleaner and avoids polluting `TokenKind` with `DOUBLE_QUOTE`.

### $apply Parser: Pipeline Splitting

```typescript
// Source: design based on verified splitTopLevelCommas in parser.ts
function splitApplyPipeline(value: string): string[] {
  // Use depth tracking: split on '/' only when depth === 0
  // Same algorithm as splitTopLevelCommas but split on '/' not ','
}

export function parseApply(input: string): ApplyNode {
  const steps = splitApplyPipeline(input)
  return { steps: steps.map(parseApplyStep) }
}

function parseApplyStep(step: string): ApplyStep {
  const trimmed = step.trim()
  if (trimmed.startsWith('filter(')) {
    // Extract inner content, call parseFilter()
  } else if (trimmed.startsWith('groupby(')) {
    // Parse groupby((fields),aggregate(...))
  } else if (trimmed.startsWith('aggregate(')) {
    // Parse aggregate(field with method as alias, ...)
  }
  throw new ODataParseError(...)
}
```

### TypeORM getRawMany() for Aggregated Results

```typescript
// Source: TypeORM documentation [ASSUMED: standard TypeORM behavior]
// getRawMany() returns raw SQL result rows as plain objects
// Column aliases from .select('COUNT(*) AS "Total"') are preserved
const rawRows = await qb.getRawMany()
// Result: [{ entity_CustomerId: 1, Total: '5' }, ...]
// Note: TypeORM prefixes aliased columns with the QB alias ('entity_')
// for non-aggregate columns. Use .select() without the alias prefix for
// groupby columns, or strip the prefix in post-processing.
```

**Important:** TypeORM `.select()` with `alias.field` produces columns named `alias_field` in getRawMany() output (the underscore is TypeORM's separator). To get clean output property names (`CustomerId` not `entity_CustomerId`), use explicit aliases: `.select(\`${alias}.CustomerId\`, 'CustomerId')`.

### Interceptor Branch for Aggregated Response

```typescript
// Source: design based on verified odata-response.interceptor.ts
// Add new branch before the existing collection response branch:
if (queryResult.isAggregated) {
  // Build context URL with aggregated property names
  const projectedSelect: SelectNode = {
    items: (queryResult.applyProperties ?? []).map((p) => ({ path: [p] })),
  }
  const contextUrl = buildContextUrl(this.options.serviceRoot, entitySetName, projectedSelect)
  return {
    '@odata.context': contextUrl,
    value: queryResult.items,
    ...(queryResult.count !== undefined && { '@odata.count': queryResult.count }),
  }
}
```

---

## State of the Art

| Old Approach                                                     | Current Approach                                  | Impact                                 |
| ---------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------- |
| parseQuery() handles $filter/$select/$orderby/$top/$skip/$expand | Extend to also handle $search and $apply          | Additive — no breaking change          |
| QueryOptions in ast.ts has 6 fields                              | Add `search?: SearchNode` and `apply?: ApplyNode` | Optional fields — backwards compatible |
| ODataQuery in query.types.ts mirrors QueryOptions                | Add `search?` and `apply?` fields                 | Optional — backwards compatible        |
| ODataQueryResult has items/count/nextLink/select                 | Add `isAggregated?` and `applyProperties?`        | Optional — backwards compatible        |

---

## Assumptions Log

| #   | Claim                                                                                                            | Section                  | Risk if Wrong                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| A1  | TypeORM `.getRawMany()` preserves aggregate aliases like `COUNT(*) AS "Total"` — result row has `{ Total: '5' }` | Code Examples            | Plan would need to use raw SQL query instead                                            |
| A2  | TypeORM `.select(\`${alias}.CustomerId\`, 'CustomerId')`produces clean`CustomerId` key in getRawMany() output    | Code Examples            | Post-processing logic needed to strip alias prefix                                      |
| A3  | `$search` and `$apply` can coexist in one request (both applied, AND'd)                                          | Interceptor / translator | Spec allows this; if not, one must win                                                  |
| A4  | `parseSearch()` does not need new TokenKind entries — standalone string-based parser is sufficient               | Standard Stack           | If search expressions grow complex (nested AND/OR), the lexer approach would be cleaner |
| A5  | Post-groupby filter (HAVING) is rejected rather than silently ignored in v1.1                                    | Pitfall 5                | If silently ignored, users get wrong results                                            |

---

## Open Questions

1. **$search graceful degradation — 400 or silent pass-through?**
   - What we know: no `@ODataSearchable()` fields means the provider can't build a condition
   - What's unclear: should this return all records (silently skip) or throw a 400 Bad Request?
   - Recommendation: throw `ODataValidationError` with a clear message — silent pass-through is dangerous

2. **$apply + $count interaction**
   - What we know: `$count=true` on a regular query returns `@odata.count`
   - What's unclear: does `$count` apply to aggregated result sets (count of groups)?
   - Recommendation: support `$count=true` with $apply by using `.getRawMany()` and returning `items.length`

3. **$apply + $top/$skip pagination**
   - What we know: OData spec allows server-side pagination on $apply results
   - What's unclear: TypeORM's `.take()` / `.skip()` applies before GROUP BY — wrong for group pagination
   - Recommendation: apply LIMIT/OFFSET to the outer query after GROUP BY. TypeORM may need a subquery approach. Flag this as a known limitation in v1.1 and document it.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all work is code changes within the existing monorepo with already-installed packages).

---

## Validation Architecture

nyquist_validation is explicitly `false` in `.planning/config.json`. Section skipped.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category       | Applies | Standard Control                                                                                                                     |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| V5 Input Validation | yes     | Validate aggregate aliases with `/^[A-Za-z_][A-Za-z0-9_]*$/`; validate $search terms are free-text strings within a max-length limit |
| V6 Cryptography     | no      | —                                                                                                                                    |
| V2 Authentication   | no      | —                                                                                                                                    |
| V4 Access Control   | no      | —                                                                                                                                    |

### Known Threat Patterns

| Pattern                                                                 | STRIDE    | Standard Mitigation                                                             |
| ----------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| Aggregate alias SQL injection (`field with sum as "Total; DROP TABLE"`) | Tampering | Validate alias with identifier regex before SQL interpolation                   |
| Unbounded $search LIKE queries (`%a%` on large tables)                  | DoS       | Honor existing `maxTop` limit; document index recommendation                    |
| Deeply nested $search AND/OR trees                                      | DoS       | Add MAX_SEARCH_DEPTH constant (follow MAX_NESTING_DEPTH pattern from parser.ts) |

---

## Sources

### Primary (HIGH confidence)

- `packages/core/src/parser/ast.ts` — Verified AST node patterns, discriminated unions
- `packages/core/src/parser/parser.ts` — Verified parser class structure, parseQuery(), splitTopLevelCommas()
- `packages/core/src/parser/lexer.ts` — Verified TokenKind enum, keyword handling
- `packages/core/src/interfaces/etag.interface.ts` — Verified IETagProvider pattern for ISearchProvider design
- `packages/core/src/query/odata-query.pipe.ts` — Verified ODataQueryPipe extension points
- `packages/core/src/query/odata-query.types.ts` — Verified ODataQuery, ODataQueryResult shapes
- `packages/typeorm/src/translator/typeorm-query-translator.ts` — Verified translate()/execute() extension points
- `packages/typeorm/src/translator/filter-visitor.ts` — Verified visitor pattern, InnerFilterExprBuilder reuse
- `packages/core/src/response/odata-response.interceptor.ts` — Verified interceptor branch pattern
- `packages/core/src/response/odata-context-url.builder.ts` — Verified buildContextUrl() for aggregated context
- `packages/typeorm/src/odata-typeorm.module.ts` — Verified module provider registration pattern
- `packages/typeorm/src/etag/typeorm-etag.provider.ts` — Verified adapter implementation pattern
- `packages/core/src/decorators/odata-etag.decorator.ts` — Verified decorator + metadata pattern for @ODataSearchable

### Secondary (MEDIUM confidence)

- OASIS OData v4 Data Aggregation Extension v4.0 Section 3 — $apply transformation pipeline grammar [CITED: docs.oasis-open.org/odata/odata-data-aggregation-ext/v4.0/cs02/odata-data-aggregation-ext-v4.0-cs02.html]
- OASIS OData v4 Part 2 Section 5.1.7 — $search expression grammar [CITED: docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html]

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**

- Parser extension: HIGH — existing parser read verbatim, new functions follow exact same pattern
- AST nodes: HIGH — follow exact discriminated union pattern already in use
- ISearchProvider interface: HIGH — exact clone of IETagProvider
- TypeOrmApplyVisitor: MEDIUM — API shape designed from patterns; getRawMany() column naming is ASSUMED
- Interceptor branch: HIGH — existing branch structure read verbatim; new branch follows same shape
- $apply spec grammar: MEDIUM — OASIS spec cited but not fetched in this session

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable domain — OData spec and TypeORM API won't change in 30 days)
