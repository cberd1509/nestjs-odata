# @nestjs-odata/typeorm API

The TypeORM adapter package that auto-derives OData EDM metadata from TypeORM entities and translates OData queries into TypeORM `SelectQueryBuilder` operations.

## ODataTypeOrmModule

The main module class. Wraps `TypeOrmModule.forFeature()` and wires up EDM derivation, query translation, and CRUD handling.

### forFeature()

```typescript
ODataTypeOrmModule.forFeature(
  items: ODataTypeOrmFeatureItem[],
  options?: ODataTypeOrmFeatureOptions
): DynamicModule
```

See [Module API](./module#odatatypeormmodule-forfeature) for the item and option shapes,
including the `scope` / `defaultScope` row-level scope options.

Register TypeORM entity classes for OData auto-derivation.

**Parameters:**

| Parameter             | Type                    | Description                                                  |
| --------------------- | ----------------------- | ------------------------------------------------------------ |
| `entities`            | `EntityClassOrSchema[]` | Array of TypeORM entity classes (decorated with `@Entity()`) |
| `options.serviceRoot` | `string`                | OData service root path (default: `'odata'`)                 |

**Returns:** A `DynamicModule` that imports `TypeOrmModule.forFeature`, provides `TypeOrmEdmInitializer` to populate the `EdmRegistry` at module init, and exports `TypeOrmQueryTranslator` and `TypeOrmAutoHandler`.

**Usage:**

```typescript
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product, Category } from './entities'

@Module({
  imports: [ODataTypeOrmModule.forFeature([Product, Category])],
})
export class ProductModule {}
```

**Prerequisites:** `ODataModule.forRoot()` must be imported in the application root module. `EdmRegistry` is `@Global()` so it is available without an explicit import.

---

## TypeOrmAutoHandler

Injectable service that handles OData requests automatically using the TypeORM repository and query translator. Provides zero-boilerplate OData endpoint handling.

### handleGet()

```typescript
async handleGet(query: ODataQuery, requestUrl: string): Promise<ODataQueryResult>
```

Handle an OData GET collection request.

- Resolves `EdmEntityType` via `EdmRegistry`
- Clamps `$top` to the configured `maxTop` (default: 1000)
- Fetches `top + 1` rows to detect whether a next page exists (avoids a separate count query)
- Builds `@odata.nextLink` when more results are available

**Parameters:**

| Parameter    | Type         | Description                                                |
| ------------ | ------------ | ---------------------------------------------------------- |
| `query`      | `ODataQuery` | Validated query from `ODataQueryPipe`                      |
| `requestUrl` | `string`     | Base URL of the request (used for `nextLink` construction) |

### handleGetByKey()

```typescript
async handleGetByKey(keyStr: string, entitySetName: string): Promise<unknown>
```

Handle OData GET by key -- single entity retrieval. Throws `NotFoundException` (HTTP 404) if the entity does not exist.

**Parameters:**

| Parameter       | Type     | Description                                                  |
| --------------- | -------- | ------------------------------------------------------------ |
| `keyStr`        | `string` | The key value from the URL, e.g. `'42'` or `'key1=1,key2=2'` |
| `entitySetName` | `string` | The OData entity set name                                    |

### handleCreate()

```typescript
async handleCreate(
  body: Record<string, unknown>,
  entitySetName: string
): Promise<{ entity: unknown; locationUrl: string }>
```

Handle OData POST -- create a new entity. Returns the created entity and a `locationUrl` for the HTTP `Location` header. Unknown fields in the body are ignored (the entity class acts as a whitelist).

**Parameters:**

| Parameter       | Type                      | Description                         |
| --------------- | ------------------------- | ----------------------------------- |
| `body`          | `Record<string, unknown>` | Request body with entity properties |
| `entitySetName` | `string`                  | The OData entity set name           |

### handleUpdate()

```typescript
async handleUpdate(
  keyStr: string,
  body: Record<string, unknown>,
  entitySetName: string
): Promise<unknown>
```

Handle OData PATCH -- partial update with merge-patch semantics. Only changed fields need to be sent. Throws `NotFoundException` if the entity does not exist.

**Parameters:**

| Parameter       | Type                      | Description                        |
| --------------- | ------------------------- | ---------------------------------- |
| `keyStr`        | `string`                  | The key value from the URL         |
| `body`          | `Record<string, unknown>` | Request body with fields to update |
| `entitySetName` | `string`                  | The OData entity set name          |

### handleDelete()

```typescript
async handleDelete(keyStr: string, entitySetName: string): Promise<void>
```

Handle OData DELETE -- remove an entity. Returns `void` (HTTP 204 No Content). Throws `NotFoundException` if the entity does not exist.

**Parameters:**

| Parameter       | Type     | Description                |
| --------------- | -------- | -------------------------- |
| `keyStr`        | `string` | The key value from the URL |
| `entitySetName` | `string` | The OData entity set name  |

### handleCount()

```typescript
async handleCount(query: ODataQuery): Promise<number>
```

Handle an OData `$count` route. Strips `$top`, `$skip`, `$orderby`, and `$select` from the query so the count reflects total matching rows for the filter, not just the current page.

**Parameters:**

| Parameter | Type         | Description                           |
| --------- | ------------ | ------------------------------------- |
| `query`   | `ODataQuery` | Validated query from `ODataQueryPipe` |

---

## TypeOrmQueryTranslator

Injectable service that orchestrates visitor classes to translate an `ODataQuery` into a TypeORM `SelectQueryBuilder`.

Implements `IQueryTranslator<SelectQueryBuilder<ObjectLiteral>>`.

### translate()

```typescript
translate(
  query: ODataQuery,
  entityType: EdmEntityType,
  entityRepo?: Repository<ObjectLiteral>,
  scopes?: TypeOrmScopePlan,
): TranslateResult
```

Translate an `ODataQuery` AST into a TypeORM `SelectQueryBuilder`. Does not execute the query.
`scopes` is the plan from `TypeOrmScopeService.prepare()` (see
[Row-level scopes](../guide/row-level-scopes)); with `requireScope: true`, calling without it
throws.

Visitor application order:

1. **filter** -- WHERE clause
2. **select** -- column projection
3. **orderby** -- sorting
4. **pagination** -- take/skip
5. **expand** -- JOINs for navigation properties

**Returns:** A `TranslateResult` containing the `SelectQueryBuilder`, the `expandPaginationMap`
of the nested `$top`/`$skip` that could not be paged in SQL, and the count queries of nested
`$count=true` / `nav/$count` expand items.

```typescript
interface TranslateResult {
  readonly qb: SelectQueryBuilder<ObjectLiteral>
  /** Keyed by expand path: `items`, `store/items`. */
  readonly expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }>
  readonly applyProperties?: string[]
  readonly expandCounts?: readonly ExpandCountQuery[]
}
```

Nested `$top`/`$skip` on one-to-many navigation properties are paged in SQL
(`ROW_NUMBER() OVER (PARTITION BY <foreign key> ...)` in the JOIN condition) on SQLite,
PostgreSQL, CockroachDB, SQL Server and Oracle, and are then absent from `expandPaginationMap`.
Many-to-many navigations, composite keys and other drivers are sliced in memory by `execute()`
(or by `applyExpandPagination(items, expandPaginationMap)` when you execute `qb` yourself).

### execute()

```typescript
async execute(
  translateResult: TranslateResult | SelectQueryBuilder<ObjectLiteral>,
  includeCount: boolean
): Promise<ODataQueryResult>
```

Execute the translated query builder and return structured results. After fetching, it slices
the expanded collections listed in `expandPaginationMap` and runs the `expandCounts` queries,
which set `<navigation>@odata.count` on the parent entities.

**Parameters:**

| Parameter         | Type              | Description                                                |
| ----------------- | ----------------- | ---------------------------------------------------------- |
| `translateResult` | `TranslateResult` | The result from `translate()`                              |
| `includeCount`    | `boolean`         | If `true`, uses `getManyAndCount()` to include total count |

---

## TypeOrmScopeService

Resolves and renders [row-level scopes](../guide/row-level-scopes). `TypeOrmAutoHandler` and the
`$batch` controller use it; inject it in custom controllers.

```typescript
class TypeOrmScopeService {
  isScoped(entitySetName: string): boolean
  prepare(
    query: ODataQuery,
    operation: ODataScopeOperation,
    manager?: EntityManager,
  ): Promise<TypeOrmScopePlan>
  findOne(
    entitySetName: string,
    where: Record<string, unknown>,
    operation: ODataScopeOperation,
    manager?: EntityManager,
    options?: { lock?: boolean }, // SELECT ... FOR UPDATE where the driver supports it
  ): Promise<ObjectLiteral | undefined>
  subqueryFor(
    entitySetName: string,
    operation: ODataScopeOperation,
    navigationPath?: readonly string[],
    manager?: EntityManager,
  ): Promise<ScopedSubquery | undefined>
}

function applyScopeToQuery(
  qb: SelectQueryBuilder<ObjectLiteral>,
  alias: string,
  sub: ScopedSubquery | undefined,
): void
```

Related exports: `ODataScopeFn`, `ODataScope`, `ODataScopeDefinition`, `ODataScopeContext`,
`ODataScopeOperation`, `ScopedSubquery`, `TypeOrmScopePlan`, `ODataScopeRegistry`,
`scopeInCondition`, `lookupScope`. `navigationTargetTypeName` (strip `Collection()` and the
namespace from a navigation type) is exported by `@nestjs-odata/core`.

## Write handlers

See [Custom write handlers](../guide/write-handlers).

```typescript
interface ODataWriteHandlers<TEntity> {
  create?: (body, ctx: ODataWriteContext) => TEntity | Promise<TEntity>
  deepInsert?(body, ctx): TEntity | Promise<TEntity>
  update?(key: ODataEntityKey, body, ctx): TEntity | Promise<TEntity>
  replace?(key: ODataEntityKey, body, ctx): TEntity | Promise<TEntity>
  delete?(key: ODataEntityKey, ctx): void | Promise<void>
}
type ODataETagSource =
  string | ((entity: Record<string, unknown>) => string | number | Date | null | undefined)
type ODataChangesetRunner = <T>(
  work: (manager: EntityManager) => Promise<T>,
  ctx: { executionContext?; request? },
) => Promise<T>

function etagMatches(ifMatch: string, currentETag: string | undefined): boolean
function formatWeakETag(value: unknown): string
function computeETagFromSource(
  source: ODataETagSource,
  entity: Record<string, unknown>,
): string | undefined
// The ETag the library sends: the `etag` option, else the ETag provider's column.
function resolveEntityETag(
  entitySetName: string,
  entity: Record<string, unknown>,
  writes: ODataWriteRegistry | undefined,
  etagProvider: IETagProvider | undefined,
): string | undefined
const ODATA_CHANGESET_RUNNER: symbol // DI token set by ODataTypeOrmModule.forRoot()
```

`TypeOrmAutoHandler.handleCreate`, `handleDeepCreate`, `handleUpdate`, `handleReplace` and
`handleDelete` dispatch to the entity set's handlers when it has any (405 for a missing one,
500 when a handler that must return an entity returns nothing).

## TypeOrmEdmDeriver

Derives OData v4 `EdmEntityConfig[]` from TypeORM `EntityMetadata`. Used internally by `TypeOrmEdmInitializer` at module init time.

Implements `IEdmDeriver`.

### Constructor

```typescript
new TypeOrmEdmDeriver(namespace: string, unmappedTypeStrategy: UnmappedTypeStrategy)
```

| Parameter              | Type                | Description                                                      |
| ---------------------- | ------------------- | ---------------------------------------------------------------- |
| `namespace`            | `string`            | OData namespace for entity types (e.g. `'Default'`)              |
| `unmappedTypeStrategy` | `'skip' \| 'error'` | How to handle TypeORM column types that have no OData equivalent |

### deriveEntityTypes()

```typescript
deriveEntityTypes(entityClasses: EntityClass[], entityMetadatas?: EntityMetadata[]): EdmEntityConfig[]
```

Derive EDM entity configurations from the given entity classes and their TypeORM metadata.

**Behavior:**

- Respects OData decorators: `@EdmType`, `@ODataExclude`, `@ODataEntitySet`
- Detects `ViewEntity` and marks the resulting config as read-only
- Navigation property types are namespace-qualified (e.g. `'Default.Category'`)
- All datetime-like column types produce `Edm.DateTimeOffset` (never `Edm.DateTime`)

---

## TypeOrmEdmInitializer

Injectable service that implements `OnModuleInit`. Runs after the TypeORM `DataSource` is ready and derives EDM metadata from registered entity classes, registering them in the `EdmRegistry`.

This class is provided automatically by `ODataTypeOrmModule.forFeature()` and does not need to be used directly.

---

## TYPEORM_ODATA_ENTITIES

```typescript
const TYPEORM_ODATA_ENTITIES: symbol
```

DI injection token for the array of TypeORM entity classes registered via `ODataTypeOrmModule.forFeature()`. Exported for advanced use cases where you need to access the registered entity list.
