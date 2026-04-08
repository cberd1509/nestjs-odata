# Troubleshooting

Common questions and solutions when working with `nestjs-odata`.

## My entity doesn't show in $metadata

**Symptoms:** The entity type and entity set are missing from `GET /odata/$metadata` and the service document.

**Checklist:**

1. The entity class has the `@Entity()` decorator from TypeORM
2. The entity is included in the `ODataTypeOrmModule.forFeature()` array:
   ```typescript
   ODataTypeOrmModule.forFeature([Product], { serviceRoot: '/odata' })
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
    TypeOrmModule.forRoot({
      /* ... */
    }),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      controllers: [ProductsController],
    }),
    ODataTypeOrmModule.forFeature([Product], { serviceRoot: '/odata' }),
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
  "value": [
    /* 10 items */
  ]
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

## Still stuck?

- Check the [GitHub Issues](https://github.com/nestjs-odata/nestjs-odata/issues) for known problems
- Open a new issue with a minimal reproduction
- Review the [Configuration](./configuration.md) page for all available options
