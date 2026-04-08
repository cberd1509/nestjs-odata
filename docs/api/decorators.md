# Decorators

## Controller decorators

### @ODataController()

```typescript
@ODataController(entitySetName: string, options?: ODataControllerOptions)
```

Marks a class as an OData controller for the given entity set. Sets the initial route prefix to `{entitySetName}`, which is then patched to `{serviceRoot}/{entitySetName}` by `ODataModule.forRoot()`.

**Parameters:**

| Parameter       | Type                      | Description                                   |
| --------------- | ------------------------- | --------------------------------------------- |
| `entitySetName` | `string`                  | The OData entity set name (e.g. `'Products'`) |
| `options`       | `ODataControllerOptions?` | Optional configuration                        |

**ODataControllerOptions:**

| Option | Type     | Default         | Description                                      |
| ------ | -------- | --------------- | ------------------------------------------------ |
| `path` | `string` | `entitySetName` | Override the NestJS controller route path prefix |

**Requirements:**

- The controller must be listed in `ODataModule.forRoot({ controllers: [...] })` for path patching to apply.
- The controller must be declared in a NestJS module that imports or registers it.

**Example:**

```typescript
@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}
  // ...
}

// In AppModule:
ODataModule.forRoot({
  serviceRoot: '/odata',
  controllers: [ProductsController],
})
```

---

## Route decorators

These decorators are applied to controller methods. They register the correct HTTP method and path for OData operations.

### @ODataGet()

```typescript
@ODataGet(entitySetName: string, options?: ODataGetOptions)
```

Registers a `GET` handler for an entity set collection.

**ODataGetOptions:**

| Option | Type     | Default | Description                          |
| ------ | -------- | ------- | ------------------------------------ |
| `path` | `string` | `''`    | Sub-path within the entity set route |

**Example:**

```typescript
@ODataGet('Products', { path: '' })
async getProducts(
  @ODataQueryParam('Products') query: ODataQuery,
  @Req() req: { originalUrl: string },
) {
  return this.handler.handleGet(query, req.originalUrl)
}
```

### @ODataGetByKey()

```typescript
@ODataGetByKey(entitySetName: string, options?: ODataGetByKeyOptions)
```

Registers a `GET /{entitySet}/:key` handler for a single entity.

**Example:**

```typescript
@ODataGetByKey('Products')
async getProduct(@Param('key') key: string) {
  return this.handler.handleGetByKey(key, 'Products')
}
```

### @ODataPost()

```typescript
@ODataPost(entitySetName: string, options?: ODataPostOptions)
```

Registers a `POST /{entitySet}` handler for creating entities. Returns `201 Created`.

**Example:**

```typescript
@ODataPost('Products')
async createProduct(@Body() body: Record<string, unknown>) {
  return this.handler.handleCreate(body, 'Products')
}
```

### @ODataPatch()

```typescript
@ODataPatch(entitySetName: string, options?: ODataPatchOptions)
```

Registers a `PATCH /{entitySet}/:key` handler for updating entities with merge-patch semantics.

**Example:**

```typescript
@ODataPatch('Products')
async updateProduct(
  @Param('key') key: string,
  @Body() body: Record<string, unknown>,
) {
  return this.handler.handleUpdate(key, body, 'Products')
}
```

### @ODataPut()

```typescript
@ODataPut(entitySetName: string, options?: ODataPutOptions)
```

Registers a `PUT /{entitySet}/:key` handler for full entity replacement. Unlike `PATCH` (merge-patch), `PUT` resets all unspecified fields to their column defaults.

**Example:**

```typescript
@ODataPut('Products')
async replaceProduct(
  @Param('key') key: string,
  @Body() body: Record<string, unknown>,
  @Headers('if-match') ifMatch?: string,
) {
  return this.handler.handleReplace(key, body, 'Products', ifMatch)
}
```

### @ODataDelete()

```typescript
@ODataDelete(entitySetName: string, options?: ODataDeleteOptions)
```

Registers a `DELETE /{entitySet}/:key` handler for deleting entities. Returns `204 No Content`.

**Example:**

```typescript
@ODataDelete('Products')
async deleteProduct(@Param('key') key: string) {
  return this.handler.handleDelete(key, 'Products')
}
```

---

## Parameter decorators

### @ODataQueryParam()

```typescript
@ODataQueryParam(entitySetName?: string)
```

Parameter decorator that injects the parsed `ODataQuery` object. **Auto-applies `ODataQueryPipe`** -- no `@UsePipes(ODataQueryPipe)` needed on the method.

The `entitySetName` argument is passed to the pipe for context URL construction and field validation.

**ODataQuery type:**

```typescript
interface ODataQuery {
  readonly filter?: FilterNode // Parsed $filter AST
  readonly select?: SelectNode // Parsed $select
  readonly orderBy?: OrderByItem[] // Parsed $orderby
  readonly top?: number // Parsed $top
  readonly skip?: number // Parsed $skip
  readonly count?: boolean // true when $count=true
  readonly entitySetName: string // The entity set name
  readonly expand?: ExpandNode // Parsed $expand
  readonly search?: SearchNode // Parsed $search
  readonly apply?: ApplyNode // Parsed $apply
}
```

**Example:**

```typescript
@ODataGet('Products', { path: '' })
async getProducts(
  @ODataQueryParam('Products') query: ODataQuery,
  @Req() req: { originalUrl: string },
) {
  // query.filter, query.top, query.skip, query.orderBy, query.search, etc.
  return this.handler.handleGet(query, req.originalUrl)
}
```

::: tip Migration from earlier versions
If your code uses `@UsePipes(ODataQueryPipe)`, you can safely remove it. `@ODataQueryParam` now auto-applies the pipe. `ODataQueryPipe` remains exported for advanced use cases where you need it independently.
:::

---

## Entity decorators

These decorators are optional — the library auto-derives all OData metadata from TypeORM annotations. Use them to customize the OData representation.

### @ODataEntitySet()

```typescript
@ODataEntitySet(name: string)
```

Override the OData entity set name for an entity class. By default, the entity set name is derived from the TypeORM table name (pluralized).

```typescript
@Entity('tbl_products') // TypeORM table name
@ODataEntitySet('Products') // Override OData entity set name
export class Product {
  // ...
}
```

### @ODataKey()

```typescript
@ODataKey()
```

Mark a property as the OData key. By default, the library uses the TypeORM primary column. Use this when the primary key has a different name or to be explicit.

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  @ODataKey() // Explicit OData key designation
  id: number
}
```

### @ODataExclude()

```typescript
@ODataExclude()
```

Exclude a TypeORM column from OData exposure. The column still exists in the database but will not appear in `$metadata`, query responses, or CRUD operations.

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  email: string

  @Column()
  @ODataExclude() // Never expose password hash via OData
  passwordHash: string
}
```

### @EdmType()

```typescript
@EdmType(options: EdmTypeOptions)
```

Override the EDM primitive type for a TypeORM column. Useful when the inferred type is not what you want.

```typescript
interface EdmTypeOptions {
  type: string // EDM primitive type, e.g. 'Edm.String', 'Edm.Decimal'
}
```

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column('decimal', { precision: 10, scale: 2 })
  @EdmType({ type: 'Edm.Decimal' }) // Explicitly declare as Decimal
  price: number
}
```

### @ODataView()

```typescript
@ODataView(options: ODataViewOptions)
```

Configure read-only behavior for an entity. Read-only entities expose only `GET` operations in the OData service.

```typescript
interface ODataViewOptions {
  isReadOnly?: boolean
}
```

```typescript
@Entity()
@ODataView({ isReadOnly: true }) // No POST, PATCH, DELETE
export class ProductSummary {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string
}
```

### @ODataETag()

```typescript
@ODataETag()
```

Marks a property as the ETag source for optimistic concurrency control. When an entity has an `@ODataETag` property:

- `GET` single entity responses include an `ETag` response header and `@odata.etag` annotation
- `PATCH`, `PUT`, and `DELETE` enforce `If-Match` header validation (returns `412 Precondition Failed` on mismatch)
- `GET` supports `If-None-Match` (returns `304 Not Modified` when unchanged)

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  @UpdateDateColumn()
  @ODataETag() // Use the update timestamp as ETag source
  updatedAt: Date
}
```

### @ODataSearchable()

```typescript
@ODataSearchable()
```

Marks a property as searchable via OData `$search`. Multiple properties on the same entity can be decorated. When `$search=term` is used, all `@ODataSearchable` fields are searched with SQL `LIKE`.

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  @ODataSearchable() // Include in $search queries
  name: string

  @Column({ type: 'text', nullable: true })
  @ODataSearchable() // Include in $search queries
  description: string | null

  @Column()
  price: number // NOT searchable — numeric fields typically excluded
}
```

Usage:

```bash
# Search products by name or description
curl 'http://localhost:3000/odata/Products?$search=Widget'
```
