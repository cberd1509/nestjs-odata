# Query Options

`nestjs-odata` supports the full OData v4 system query options. All query options are parsed from the URL and translated to TypeORM query builder operations.

## $filter

Filter the entity collection. The parser supports the full OData v4 ABNF grammar.

### Comparison operators

| Operator | Description           | Example                    |
| -------- | --------------------- | -------------------------- |
| `eq`     | Equal                 | `$filter=name eq 'Widget'` |
| `ne`     | Not equal             | `$filter=inStock ne false` |
| `lt`     | Less than             | `$filter=price lt 100`     |
| `le`     | Less than or equal    | `$filter=price le 99.99`   |
| `gt`     | Greater than          | `$filter=price gt 0`       |
| `ge`     | Greater than or equal | `$filter=price ge 10`      |

### Logical operators

```
$filter=price lt 100 and inStock eq true
$filter=name eq 'Widget' or name eq 'Gadget'
$filter=not (inStock eq false)
```

### String functions

| Function                     | Example                                            |
| ---------------------------- | -------------------------------------------------- |
| `contains(field, 'value')`   | `$filter=contains(name, 'Pro')`                    |
| `startswith(field, 'value')` | `$filter=startswith(name, 'Super')`                |
| `endswith(field, 'value')`   | `$filter=endswith(name, 'Pro')`                    |
| `tolower(field)`             | `$filter=tolower(name) eq 'widget'`                |
| `toupper(field)`             | `$filter=toupper(sku) eq 'ABC-123'`                |
| `trim(field)`                | `$filter=trim(description) ne ''`                  |
| `length(field)`              | `$filter=length(name) gt 5`                        |
| `indexof(field, 'value')`    | `$filter=indexof(name, 'Pro') ge 0`                |
| `substring(field, offset)`   | `$filter=substring(name, 5) eq 'Pro'`              |
| `concat(field, 'value')`     | `$filter=concat(firstName, lastName) eq 'JohnDoe'` |

### Arithmetic operators

```
$filter=price add 10 gt 100
$filter=quantity sub 5 gt 0
$filter=price mul 2 lt 200
$filter=price div 2 gt 25
$filter=quantity mod 3 eq 0
```

### Null checks

```
$filter=description eq null
$filter=deletedAt ne null
```

### Examples

```bash
# Products under $50 in stock
curl 'http://localhost:3000/odata/Products?$filter=price lt 50 and inStock eq true'

# Products whose name contains "Pro"
curl 'http://localhost:3000/odata/Products?$filter=contains(name, %27Pro%27)'

# Nested filter with parentheses
curl 'http://localhost:3000/odata/Products?$filter=(price gt 10 and price lt 100) or inStock eq false'
```

::: tip URL encoding
OData `$filter` values must be URL-encoded when using single quotes or special characters. Use `%27` for `'` and `%20` for spaces, or use a library that handles encoding automatically.
:::

## $select

Select a subset of properties to return. Reduces payload size.

```bash
# Return only name and price
curl 'http://localhost:3000/odata/Products?$select=name,price'
```

Response:

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products(name,price)",
  "value": [
    { "name": "Widget", "price": 9.99 },
    { "name": "Gadget", "price": 49.99 }
  ]
}
```

::: info @odata.context
When `$select` is used, the `@odata.context` URL includes the selected properties in parentheses — per the OData v4 spec.
:::

## $orderby

Sort results. Supports multiple fields and `asc`/`desc` direction.

```bash
# Sort by price ascending (default)
curl 'http://localhost:3000/odata/Products?$orderby=price'

# Sort by price descending
curl 'http://localhost:3000/odata/Products?$orderby=price desc'

# Multiple sort fields
curl 'http://localhost:3000/odata/Products?$orderby=inStock desc,price asc'
```

## $top and $skip

Pagination. `$top` limits results; `$skip` offsets the start.

```bash
# First 10 products
curl 'http://localhost:3000/odata/Products?$top=10'

# Page 2 (products 11-20)
curl 'http://localhost:3000/odata/Products?$top=10&$skip=10'
```

::: warning $top limit
`$top`values exceeding the global`maxTop` (default: 1000) or per-entity override return HTTP 400. See [Security](./security.md).
:::

### @odata.nextLink

When a response is paginated and there are more results, the response includes `@odata.nextLink`:

```json
{
  "@odata.context": "...",
  "@odata.count": 150,
  "@odata.nextLink": "http://localhost:3000/odata/Products?$top=10&$skip=10",
  "value": [...]
}
```

## $count

### Inline count

Add `$count=true` to include the total count of matching entities in the response:

```bash
curl 'http://localhost:3000/odata/Products?$count=true&$top=5'
```

Response:

```json
{
  "@odata.context": "...",
  "@odata.count": 42,
  "value": [...]
}
```

### Count-only endpoint

Request the count as a plain integer (useful for UI pagination controls):

```bash
curl 'http://localhost:3000/odata/Products/$count'
# Returns: 42
```

With filter:

```bash
curl 'http://localhost:3000/odata/Products/$count?$filter=inStock eq true'
# Returns: 28
```

## $search

Full-text search across fields decorated with `@ODataSearchable()`. Falls back to SQL `LIKE` by default.

### Basic search

```bash
# Search products by name or description
curl 'http://localhost:3000/odata/Products?$search=Widget'
```

### Boolean operators

`$search` supports AND, OR, and NOT operators:

```bash
# Products matching "Widget" AND "Pro"
curl 'http://localhost:3000/odata/Products?$search=Widget AND Pro'

# Products matching "Widget" OR "Gadget"
curl 'http://localhost:3000/odata/Products?$search=Widget OR Gadget'

# Products matching "Widget" but NOT "Mini"
curl 'http://localhost:3000/odata/Products?$search=Widget NOT Mini'
```

### Entity setup

Mark properties as searchable with `@ODataSearchable()`:

```typescript
import { ODataSearchable } from '@nestjs-odata/core'

@Entity()
export class Product {
  @Column()
  @ODataSearchable()
  name: string

  @Column({ type: 'text', nullable: true })
  @ODataSearchable()
  description: string | null
}
```

### Custom search provider

For advanced full-text search (Elasticsearch, PostgreSQL `tsvector`, etc.), implement the `ISearchProvider` interface and register it with the `SEARCH_PROVIDER` token:

```typescript
import { SEARCH_PROVIDER, type ISearchProvider } from '@nestjs-odata/core'

@Module({
  providers: [
    {
      provide: SEARCH_PROVIDER,
      useClass: ElasticsearchSearchProvider,
    },
  ],
})
export class AppModule {}
```

## $apply

Aggregation and grouping operations. Supports aggregate functions, GROUP BY, and pipeline composition.

### Aggregate

```bash
# Sum of all product prices
curl 'http://localhost:3000/odata/Products?$apply=aggregate(price with sum as TotalPrice)'

# Multiple aggregations
curl 'http://localhost:3000/odata/Products?$apply=aggregate(price with sum as TotalPrice, price with avg as AvgPrice, id with count as ProductCount)'
```

Response:

```json
{
  "@odata.context": "...",
  "value": [{ "TotalPrice": 1299.5, "AvgPrice": 25.99, "ProductCount": 50 }]
}
```

Supported aggregate functions: `sum`, `count`, `avg`, `min`, `max`, `countdistinct`.

### Group by

```bash
# Total revenue by category
curl 'http://localhost:3000/odata/Products?$apply=groupby((categoryId), aggregate(price with sum as TotalPrice))'

# Count products by active status
curl 'http://localhost:3000/odata/Products?$apply=groupby((active), aggregate(id with count as ProductCount))'
```

Response:

```json
{
  "@odata.context": "...",
  "value": [
    { "categoryId": 1, "TotalPrice": 499.5 },
    { "categoryId": 2, "TotalPrice": 800.0 }
  ]
}
```

### Pipeline composition

Chain `filter` and `groupby`/`aggregate` operations with `/`:

```bash
# Filter to active products, then group by category with totals
curl 'http://localhost:3000/odata/Products?$apply=filter(active eq true)/groupby((categoryId), aggregate(price with sum as TotalPrice))'
```

## Advanced filter functions

For lambda expressions (`any`/`all`), arithmetic operators, date/time extraction functions, and additional string functions (`indexof`, `substring`, `concat`) — see the [Filter Functions guide](./filter-functions.md).

## Response annotations

All entity responses include OData v4 annotations:

- `@odata.id` — canonical URL of the entity (e.g. `Products(1)`)
- `@odata.type` — fully qualified type name (e.g. `#Default.Product`)
- `{navigationProperty}@odata.navigationLink` — URL to navigate to related entities
- `@odata.etag` — ETag value (only on entities with `@ODataETag()`)

## Combining query options

All query options compose freely:

```bash
curl 'http://localhost:3000/odata/Products?$filter=inStock eq true&$select=name,price&$orderby=price asc&$top=5&$skip=0&$count=true'
```

Response:

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products(name,price)",
  "@odata.count": 28,
  "value": [
    { "name": "Clip", "price": 0.99 },
    { "name": "Pen", "price": 1.99 },
    { "name": "Notebook", "price": 4.99 },
    { "name": "Stapler", "price": 8.99 },
    { "name": "Folder", "price": 9.99 }
  ]
}
```
