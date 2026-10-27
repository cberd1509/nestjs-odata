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

# The second-largest item of each order
curl 'http://localhost:3000/odata/Orders?$expand=items($top=1;$skip=1;$orderby=quantity desc)'
```

The page is taken per parent, after the nested `$filter`, `$search` and the target's
[row-level scope](./row-level-scopes), in the order of the nested `$orderby` (then the key).

::: info How paging runs
On one-to-many navigation properties the page is computed in SQL: the JOIN keeps only the
related rows whose `ROW_NUMBER() OVER (PARTITION BY <foreign key> ORDER BY <nested $orderby>, <key>)`
falls in the page, so only the requested rows are loaded. This needs window functions and is used
on SQLite (every SQLite-based driver), PostgreSQL, CockroachDB, SQL Server and Oracle.

On MySQL/MariaDB (window functions depend on the server version), on many-to-many navigation
properties and on targets with composite keys, the expanded collection is sliced in memory after
the query. Results are still bounded by the parent `maxTop` and `maxExpandDepth`.

Paging options are kept per expand path: in
`$expand=reports($top=1),manager($expand=reports($top=2))` the two `reports` collections are paged
independently.
:::

## $expand with $count

`$count=true` inside `$expand` annotates the expanded collection with its total count
(`nav@odata.count`, OData 4.01 Part 1 §11.2.6.5). The count includes the nested `$filter` and
`$search` and the target's row-level scope, and ignores the nested `$top`/`$skip`:

```bash
curl 'http://localhost:3000/odata/Orders?$expand=items($count=true;$top=2)'
```

```json
{
  "value": [
    {
      "id": 1,
      "items@odata.count": 3,
      "items": [
        { "id": 1, "quantity": 150 },
        { "id": 2, "quantity": 30 }
      ]
    }
  ]
}
```

To get only the count, without the related entities, expand `nav/$count`. Only `$filter` and
`$search` may follow it:

```bash
curl 'http://localhost:3000/odata/Orders?$expand=items/$count($filter=quantity gt 40)'
```

```json
{ "value": [{ "id": 1, "items@odata.count": 2 }] }
```

Counts run as one grouped `COUNT(*)` query per counted expand item, after the main query.
`$count` and `/$count` on a single-valued navigation property answer 400.

## $expand with $search

`$search` inside `$expand` keeps only the related entities matching the search, using the same
[search provider](./query-options#search) and `@ODataSearchable()` properties as a top-level
`$search`:

```bash
curl 'http://localhost:3000/odata/Customers?$expand=orders($search=pending;$count=true)'
```

A target entity without searchable properties answers 400, and a service without a search
provider answers 501.

## $levels (recursive navigation properties)

For a navigation property whose target is the same entity type (a hierarchy such as
`Employee.manager` or `Employee.reports`), `$levels` repeats the expansion that many levels deep.
The other nested options apply at every level:

```bash
# An employee, their manager and their manager's manager, with id and name only
curl 'http://localhost:3000/odata/Employees?$expand=manager($levels=2;$select=id,name)'

# As deep as maxExpandDepth allows
curl 'http://localhost:3000/odata/Employees?$expand=reports($levels=max)'
```

`$levels=max` expands to the remaining `maxExpandDepth`. A number of levels that goes past
`maxExpandDepth`, or more than one level on a navigation property that is not recursive, answers
400 (`$levels=1` is a plain expand on any navigation property).

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

## Nested query options and row-level scopes

The nested options are `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`, `$search`,
`$levels` and `$expand`, separated by semicolons (OData 4.01 Part 2 §5.1.3). They are validated
against the related entity type (unknown or excluded properties give 400) and apply to the related
rows only: a nested `$filter` that matches nothing yields an empty collection (or `null`), never a
missing parent. When the target entity set has a [row-level scope](./row-level-scopes), it
restricts the expanded rows, the nested counts and the nested paging in the same way, at every
depth.

A nested `$filter` can use [navigation paths](./query-options#navigation-paths) and lambdas like
a top-level one.

## Unsupported nested options

Options the library does not implement are refused instead of being ignored (OData 4.01 Part 1
§9.3.1), so a client never gets more data than it asked for:

| Request                                                   | Response                                            |
| --------------------------------------------------------- | --------------------------------------------------- |
| `items($compute=...)`, `items($apply=...)`                | 501 `NotImplemented`                                |
| `items/$ref`                                              | 501 `NotImplemented`                                |
| `$it` inside a nested option (`items($filter=$it/...)`)   | 501 `NotImplemented` (it would refer to the parent) |
| Parameter aliases (`items(@p=1)`)                         | 501 `NotImplemented`                                |
| An unknown option (`items($foo=1)`)                       | 400 `BadRequest`                                    |
| `items/$count($top=1)` (only `$filter`/`$search` allowed) | 400 `BadRequest`                                    |
