# $expand

`$expand` follows navigation properties (TypeORM relations) and includes related entities inline in the response.

## Basic usage

Given a `Product` entity with a `Category` relation:

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  @ManyToOne(() => Category, (c) => c.products, { nullable: true })
  category: Category | null
}
```

Expand the `Category` navigation property:

```bash
curl 'http://localhost:3000/odata/Products?$expand=category'
```

Response:

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products(category())",
  "value": [
    {
      "id": 1,
      "name": "Widget",
      "category": {
        "id": 10,
        "name": "Hardware"
      }
    }
  ]
}
```

## Nested $expand

`$expand` supports nesting to follow navigation properties multiple levels deep:

```bash
# Expand orders, and within each order expand its items
curl 'http://localhost:3000/odata/Customers?$expand=orders($expand=items)'
```

::: warning Depth limit
The default `maxExpandDepth` is `2`. Requests exceeding this return HTTP 400. Override per-entity or globally — see [Security](./security.md).
:::

## $expand with $select

Combine `$expand` with `$select` to limit which fields come back for the expanded entity:

```bash
# Only return name from the expanded category
curl 'http://localhost:3000/odata/Products?$expand=category($select=name)'
```

Response:

```json
{
  "@odata.context": "...",
  "value": [
    {
      "id": 1,
      "name": "Widget",
      "category": { "name": "Hardware" }
    }
  ]
}
```

## $expand with $top and $skip

For collection navigation properties (one-to-many, many-to-many), paginate the expanded collection:

```bash
# Expand first 5 orders for each customer
curl 'http://localhost:3000/odata/Customers?$expand=orders($top=5;$skip=0)'
```

::: info Implementation detail
In v1, `$expand` pagination is applied in-memory after the JOIN query runs. Results are bounded by the parent `maxTop` and `maxExpandDepth` limits, making this safe without unbounded queries.
:::

## $expand with $filter

Filter the expanded collection:

```bash
# Only expand in-stock products for each category
curl 'http://localhost:3000/odata/Categories?$expand=products($filter=inStock eq true)'
```

## Multiple navigations

Expand multiple navigation properties at once:

```bash
curl 'http://localhost:3000/odata/Orders?$expand=customer,items'
```

Response:

```json
{
  "@odata.context": "...",
  "value": [
    {
      "id": 1,
      "customer": { "id": 5, "name": "Acme Corp" },
      "items": [{ "id": 10, "productId": 1, "quantity": 3 }]
    }
  ]
}
```

## maxExpandDepth

Configure the maximum nesting depth globally or per entity:

```typescript
// Global: 3 levels of nesting
ODataModule.forRoot({
  serviceRoot: '/odata',
  maxExpandDepth: 3,
})
```

```typescript
// Per-entity: Orders can expand 1 level only
this.edmRegistry.setEntitySecurityOptions('Orders', {
  maxExpandDepth: 1,
})
```

When exceeded, the response is:

```json
{
  "error": {
    "code": "ExpandDepthExceeded",
    "message": "$expand depth 3 exceeds maximum allowed depth 2"
  }
}
```
