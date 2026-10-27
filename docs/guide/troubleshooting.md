# Troubleshooting

Common questions and solutions when working with `nestjs-odata`.

## My entity doesn't show in $metadata

**Symptoms:** The entity type and entity set are missing from `GET /odata/$metadata` and the service document.

**Checklist:**

1. The entity class has the `@Entity()` decorator from TypeORM
2. The entity is included in the `ODataTypeOrmModule.forFeature()` array:
   ```typescript
   ODataTypeOrmModule.forFeature([Product])
   ```
3. A controller exists with `@ODataController('Products')` referencing the entity set name
4. The controller is listed in `ODataModule.forRoot({ controllers: [...] })`
5. The entity is also registered with TypeORM (in `TypeOrmModule.forRoot({ entities: [...] })` or via auto-loading)

If any of these are missing, the entity will not appear in the EDM.

## DI error for TypeOrmAutoHandler

**Error:** `Nest can't resolve dependencies of the TypeOrmAutoHandler`

**Cause:** `ODataTypeOrmModule.forFeature()` is not imported in the module where you're injecting `TypeOrmAutoHandler`.

**Fix:** Make sure your module imports both the TypeORM module and the OData TypeORM module:

```typescript
@Module({
  imports: [
    TypeOrmModule.forRoot({/* ... */}),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      controllers: [ProductsController],
    }),
    ODataTypeOrmModule.forFeature([Product]),
  ],
})
export class AppModule {}
```

`TypeOrmAutoHandler` is automatically registered as a provider by `forFeature()` — do not add it to a `providers` array manually.

## $filter returns 400 Bad Request

**Symptoms:** Queries with `$filter` return a 400 error.

**Checklist:**

1. **Check filter syntax.** OData filter expressions follow a specific grammar. Common mistakes:
   - Missing spaces around operators: `price lt 100` (correct) vs `price<100` (wrong)
   - Wrong string quoting: use single quotes for strings: `name eq 'Widget'`
   - Case-sensitive operators: `eq`, `ne`, `lt`, `gt`, `le`, `ge` (lowercase)

2. **Check `maxFilterDepth`.** If your filter has nested `and`/`or` clauses, it may exceed the configured depth limit:

   ```typescript
   ODataModule.forRoot({
     serviceRoot: '/odata',
     maxFilterDepth: 10, // Increase if needed (default: 5)
   })
   ```

3. **Check supported functions.** Not all OData filter functions may be implemented. See [Filter Functions](./filter-functions.md) for the full list of supported functions.

4. **Collection-valued navigation in a path.** `orderItems/quantity gt 1` is rejected with
   "'orderItems' is a collection-valued navigation property ... use any/all". Paths can only
   go through single-valued navigation properties (`category/name`); filter collections with a
   lambda: `orderItems/any(i: i/quantity gt 1)`.

5. **Lambda over something that isn't a collection.** `category/any(...)` (single-valued) or an
   unknown name before `/any` is a 400. Lambdas range over `@OneToMany` and `@ManyToMany`
   navigation properties.

## A query returns 501 Not Implemented

**Symptoms:** A request answers `501` with `"code": "NotImplemented"`.

The request is valid OData, but uses a feature the library does not implement. Rather than
ignore it (and return more data than asked for), it refuses the request (OData 4.01 Part 1
§9.3.1). The message names the feature. The 501 cases are:

- `$root`, and `$it` inside `$expand` options;
- `$count` / `$this` path segments in `$filter` (`items/$count gt 2`): use `items/any()` or a
  lambda instead;
- navigation paths in `$orderby` (`$orderby=category/name`);
- nested `$compute` / `$apply` in `$expand`, `$expand=nav/$ref`, parameter aliases in `$expand`
  options;
- nested `$search` when no search provider is registered.

See [Unsupported nested options](./expand#unsupported-nested-options).

## $expand returns empty array

**Symptoms:** `$expand=category` returns entities but the expanded property is `null` or an empty array.

**Checklist:**

1. **Check TypeORM relation decorators.** The entity must have a proper relation defined:

   ```typescript
   @ManyToOne(() => Category, (category) => category.products)
   category: Category

   @OneToMany(() => Product, (product) => product.category)
   products: Product[]
   ```

2. **Check `maxExpandDepth`.** Deep expansions may be rejected:

   ```typescript
   ODataModule.forRoot({
     serviceRoot: '/odata',
     maxExpandDepth: 3, // Increase if needed (default: 2)
   })
   ```

3. **Check that related data exists.** If the database has no related records, the expansion will legitimately return `null` or `[]`.

4. **Check row-level scopes and nested options.** The target entity set's
   [scope](./row-level-scopes), a nested `$filter`/`$search`, or a nested `$skip` past the end of
   the collection all leave related rows out of the expansion.

## OData routes conflict with my REST routes

**Symptoms:** OData endpoints interfere with regular NestJS REST routes, or vice versa.

**Solutions:**

1. **Use a distinct service root.** The `serviceRoot` option prefixes all OData routes:

   ```typescript
   ODataModule.forRoot({
     serviceRoot: '/odata', // All OData routes under /odata/...
   })
   ```

2. **Use the `path` option in `@ODataController`.** This lets you control the exact route prefix for a specific controller.

3. **Order matters.** NestJS resolves routes in registration order. If a wildcard REST route matches before the OData route, move the OData module import earlier.

## $count returns unexpected number

**Symptoms:** The `@odata.count` value in the response doesn't match the number of items in `value`.

**Explanation:** This is correct behavior. `$count=true` returns the **total number of entities matching the filter**, regardless of `$top` and `$skip`. The `value` array contains only the current page.

```bash
# 1000 total products, but only 10 returned in this page
curl 'http://localhost:3000/odata/Products?$top=10&$count=true'
```

```json
{
  "@odata.context": "...",
  "@odata.count": 1000,
  "value": [/* 10 items */]
}
```

## How do I use composite keys?

OData supports entities with multiple key properties. Decorate each key column with `@PrimaryColumn()` in TypeORM:

```typescript
@Entity()
export class OrderItem {
  @PrimaryColumn()
  orderId: number

  @PrimaryColumn()
  productId: number

  @Column()
  quantity: number
}
```

Both properties will appear as `<PropertyRef>` elements inside the `<Key>` block in `$metadata`:

```xml
<EntityType Name="OrderItem">
  <Key>
    <PropertyRef Name="orderId"/>
    <PropertyRef Name="productId"/>
  </Key>
  ...
</EntityType>
```

To query by composite key, use the OData multi-key syntax:

```bash
curl 'http://localhost:3000/odata/OrderItems(orderId=1,productId=42)'
```

The key routes receive `orderId=1,productId=42` as their `key` parameter, which
`handleGetByKey` and the write handlers parse. `/odata/OrderItems/orderId=1,productId=42` reaches
the same route. `Location` and `@odata.id` use the parenthesized form.

## `Products(1)` answers `Cannot GET /odata/Products(1)`

The canonical `Set(key)` URL is routed by a URL rewrite that `ODataModule.forRoot()` installs on
the **Express** adapter. Check that `ODataModule.forRoot()` is imported (not only `forFeature`),
that the entity set is registered (it appears in `$metadata`), and that the app runs on
`@nestjs/platform-express`. Other adapters only route `/odata/Products/1`.

## Writes answer 412 although the client sent the ETag it received

Express adds its own hash `ETag` (`W/"<len>-<hash>"`) to every response, including collections and
errors. A client that echoes that one in `If-Match` always gets `412 Precondition Failed`. Call
`app.set('etag', false)` in `main.ts` (the library warns about it at startup), and use the
OData ETag: the `ETag` header of a by-key read or write, or `@odata.etag` in the body.

## A write answers 400 "Entity type '…' has no property '…'"

The body carries a property that is not in the entity type (a typo, a property hidden with
`@ODataExclude` or `select: false`, or a client-only field). OData requires the service to fail
when it cannot persist a value (Part 1 §11.4.2). Fix the client, or set
`ignoreUnknownProperties: true` in `ODataModule.forRoot()` to drop such properties instead.
Computed properties (timestamps, version) and instance annotations (`@odata.type`) are ignored
rather than refused.

## Writes answer 428 Precondition Required

The entity set has `requireIfMatch: true`: send `If-Match` with the entity's current ETag (or
`*`) on PATCH, PUT and DELETE.

## TypeORM synchronize warning in production

**Symptoms:** Console warning about `synchronize: true` in production.

**Fix:** Never use `synchronize: true` in production. It can cause data loss by auto-altering tables. Use TypeORM migrations instead:

```typescript
TypeOrmModule.forRoot({
  type: 'postgres',
  synchronize: false, // Always false in production
  migrations: ['dist/migrations/*.js'],
  migrationsRun: true,
})
```

## Routes appear under `/api/api/odata/...` (double-prefixed)

**Symptom:** You call `app.setGlobalPrefix('api')` and OData routes get the
`api/` prefix applied twice — the metadata service-document URL ends up at
`/api/api/odata/$metadata` and clients 404 trying to reach the canonical
`/api/odata/$metadata`.

**Fix:** exclude the OData service-root from the global prefix using
`ODataModule.globalPrefixExclude()`:

```typescript
app.setGlobalPrefix('api', { exclude: ODataModule.globalPrefixExclude() })
```

The helper reads the `serviceRoot` you registered via `forRoot()` and returns
the right Express 5 splat patterns (`odata` + `odata/{*splat}`). Without
the exclude, `@odata.context` / `@odata.id` (built from `serviceRoot`) will be
inconsistent with `@odata.nextLink` (built from `req.originalUrl`), and OData
v4 clients (Excel, Olingo, odata2ts) will fail to navigate.

## URLs come out as `/odata/UserEntities` (ugly suffix)

**Symptom:** You name your TypeORM class `UserEntity` (the idiomatic Nest+TypeORM
convention) and the OData entity set becomes `UserEntities`. You don't want the
`Entity` suffix in your URLs.

**Fix:** use the object-form in `forFeature` to override the entity-set name
without touching the class:

```typescript
ODataTypeOrmModule.forFeature([
  { entity: UserEntity, name: 'Users' },
  { entity: ClaudeSessionEntity, name: 'Sessions' },
])
```

The override wins over both the `@ODataEntitySet` decorator and default
pluralization. Equivalent class-level option: `@ODataEntitySet('Users')` on
the entity itself.

## Multiple entities in one feature module return the wrong rows

**Symptom:** You register two entities in a single `forFeature([A, B])` call.
Requests to `/odata/A` work; requests to `/odata/B` either return rows from
`A` or 500 with "column does not exist" when the filter references a `B`-only
column.

**Fix:** make sure you're on a recent enough version of
`@nestjs-odata/typeorm` — `TypeOrmAutoHandler` resolves the right Repository
per request from the entity-set name. Older releases routed everything to
`entities[0]`. Bug #1 in the integration handoff doc; covered by
`multi-entity-disambiguation.e2e-spec.ts`.

## Still stuck?

- Check the [GitHub Issues](https://github.com/cberd1509/nestjs-odata/issues) for known problems
- Open a new issue with a minimal reproduction
- Review the [Configuration](./configuration.md) page for all available options
