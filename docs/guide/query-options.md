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
