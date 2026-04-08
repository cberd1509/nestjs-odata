# @nestjs-odata/typeorm API

The TypeORM adapter package that auto-derives OData EDM metadata from TypeORM entities and translates OData queries into TypeORM `SelectQueryBuilder` operations.

## ODataTypeOrmModule

The main module class. Wraps `TypeOrmModule.forFeature()` and wires up EDM derivation, query translation, and CRUD handling.

### forFeature()

```typescript
ODataTypeOrmModule.forFeature(
  entities: EntityClassOrSchema[],
  options?: { serviceRoot?: string }
): DynamicModule
```

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
translate(query: ODataQuery, entityType: EdmEntityType): TranslateResult
```

Translate an `ODataQuery` AST into a TypeORM `SelectQueryBuilder`. Does not execute the query.

Visitor application order:

1. **filter** -- WHERE clause
2. **select** -- column projection
3. **orderby** -- sorting
4. **pagination** -- take/skip
5. **expand** -- JOINs for navigation properties

**Returns:** A `TranslateResult` containing the `SelectQueryBuilder` and an `expandPaginationMap` for post-JOIN in-memory slicing.

```typescript
interface TranslateResult {
  readonly qb: SelectQueryBuilder<ObjectLiteral>
  readonly expandPaginationMap: ReadonlyMap<string, { skip?: number; top?: number }>
}
```

### execute()

```typescript
async execute(
  translateResult: TranslateResult | SelectQueryBuilder<ObjectLiteral>,
  includeCount: boolean
): Promise<ODataQueryResult>
```

Execute the translated query builder and return structured results. Applies post-JOIN in-memory expand pagination after fetching.

**Parameters:**

| Parameter         | Type              | Description                                                |
| ----------------- | ----------------- | ---------------------------------------------------------- |
| `translateResult` | `TranslateResult` | The result from `translate()`                              |
| `includeCount`    | `boolean`         | If `true`, uses `getManyAndCount()` to include total count |

---

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
