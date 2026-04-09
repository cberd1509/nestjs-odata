# Filter Functions

Advanced filter operations available in `$filter` expressions: lambda expressions (`any`/`all`), arithmetic operators, date/time extraction functions, and string manipulation functions.

All functions are implemented in `TypeOrmFilterVisitor` and translate directly to parameterized SQL — no string interpolation.

## Lambda Expressions

Lambda expressions allow filtering based on related collection properties. They use the OData v4 lambda syntax: `Collection/operator(variable: predicate)`.

### any()

Returns entities where **at least one** element in a related collection matches the predicate.

```
GET /odata/Orders?$filter=Items/any(i: i/Price gt 100)
```

This translates to a SQL `EXISTS` subquery:

```sql
WHERE EXISTS (
  SELECT 1 FROM "order_item" i WHERE i.orderId = order.id AND i.Price > 100
)
```

**Without a predicate** — returns entities where the collection is non-empty:

```
GET /odata/Orders?$filter=Items/any()
```

```sql
WHERE EXISTS (SELECT 1 FROM "order_item" i WHERE i.orderId = order.id)
```

**Requirements:**

- The navigation property must be registered as a TypeORM relation (`@OneToMany`, `@ManyToOne`)
- Many-to-many relations are not supported — use a junction entity with two `@OneToMany` relations instead
- The variable name (e.g. `i`) is used as the SQL subquery alias

**More examples:**

```
# Orders with any item from supplier 'Acme'
GET /odata/Orders?$filter=Items/any(item: item/Supplier eq 'Acme')

# Products that have at least one review
GET /odata/Products?$filter=Reviews/any()

# Categories that have at least one in-stock product
GET /odata/Categories?$filter=Products/any(p: p/InStock eq true)
```

### all()

Returns entities where **every** element in a related collection matches the predicate.

```
GET /odata/Orders?$filter=Items/all(i: i/Shipped eq true)
```

This translates to a SQL `NOT EXISTS` with the negated predicate:

```sql
WHERE NOT EXISTS (
  SELECT 1 FROM "order_item" i WHERE i.orderId = order.id AND NOT (i.Shipped = true)
)
```

**Vacuous truth** — `all()` with an empty collection returns true (per OData spec). This is consistent with standard logical quantification.

**More examples:**

```
# Orders where all items are fulfilled
GET /odata/Orders?$filter=Items/all(i: i/Status eq 'fulfilled')

# Customers whose all orders are paid
GET /odata/Customers?$filter=Orders/all(o: o/Paid eq true)

# Products where all reviews are 4 stars or above
GET /odata/Products?$filter=Reviews/all(r: r/Rating ge 4)
```

### Combining lambda with other filters

Lambda expressions compose with `and`, `or`, and `not`:

```
# Orders over $500 with at least one express item
GET /odata/Orders?$filter=Total gt 500 and Items/any(i: i/Shipping eq 'express')

# Orders with no unfulfilled items (equivalent to all fulfilled)
GET /odata/Orders?$filter=not Items/any(i: i/Status ne 'fulfilled')
```

---

## Arithmetic Operators

Use arithmetic expressions directly within `$filter` comparisons. The full set of OData v4 arithmetic operators is supported.

| Operator | SQL | Example                                                    |
| -------- | --- | ---------------------------------------------------------- |
| `add`    | `+` | `$filter=Price add Tax gt 50`                              |
| `sub`    | `-` | `$filter=Price sub Discount gt 10`                         |
| `mul`    | `*` | `$filter=Price mul Quantity gt 1000`                       |
| `div`    | `/` | `$filter=Total div Count gt 25`                            |
| `divby`  | `/` | `$filter=Total divby Count gt 25` (decimal division alias) |
| `mod`    | `%` | `$filter=Quantity mod 3 eq 0`                              |

**Examples:**

```bash
# Products where price plus tax exceeds $50
curl 'http://localhost:3000/odata/Products?$filter=Price add Tax gt 50'

# Products where net price (after discount) is positive
curl 'http://localhost:3000/odata/Products?$filter=Price sub Discount gt 0'

# Products where price times quantity exceeds $1000
curl 'http://localhost:3000/odata/Products?$filter=Price mul Quantity gt 1000'

# Products where quantity is divisible by 3
curl 'http://localhost:3000/odata/Products?$filter=Quantity mod 3 eq 0'

# Average unit price exceeds $25
curl 'http://localhost:3000/odata/Orders?$filter=Total div ItemCount gt 25'
```

Arithmetic operators can be nested:

```
# (Price * Quantity) + Tax > 500
$filter=Price mul Quantity add Tax gt 500
```

All operands are parameterized — no SQL injection risk.

---

## Date/Time Functions

Extract date and time components from datetime columns and compare them numerically. These functions translate to dialect-specific SQL: `strftime()` for SQLite and `EXTRACT()` for PostgreSQL and other ANSI-compliant databases.

| Function        | Extracts            | SQLite SQL                               | PostgreSQL SQL               |
| --------------- | ------------------- | ---------------------------------------- | ---------------------------- |
| `year(field)`   | Year (4-digit)      | `CAST(strftime('%Y', field) AS INTEGER)` | `EXTRACT(YEAR FROM field)`   |
| `month(field)`  | Month (1–12)        | `CAST(strftime('%m', field) AS INTEGER)` | `EXTRACT(MONTH FROM field)`  |
| `day(field)`    | Day of month (1–31) | `CAST(strftime('%d', field) AS INTEGER)` | `EXTRACT(DAY FROM field)`    |
| `hour(field)`   | Hour (0–23)         | `CAST(strftime('%H', field) AS INTEGER)` | `EXTRACT(HOUR FROM field)`   |
| `minute(field)` | Minute (0–59)       | `CAST(strftime('%M', field) AS INTEGER)` | `EXTRACT(MINUTE FROM field)` |
| `second(field)` | Second (0–59)       | `CAST(strftime('%S', field) AS INTEGER)` | `EXTRACT(SECOND FROM field)` |

**Examples:**

```bash
# Products created in 2024
curl 'http://localhost:3000/odata/Products?$filter=year(CreatedAt) eq 2024'

# Orders placed in December
curl 'http://localhost:3000/odata/Orders?$filter=month(OrderDate) eq 12'

# Events on the 15th of any month
curl 'http://localhost:3000/odata/Events?$filter=day(EventDate) eq 15'

# Appointments in the morning (before noon)
curl 'http://localhost:3000/odata/Appointments?$filter=hour(StartTime) lt 12'

# Logs from 2023 or 2024
curl 'http://localhost:3000/odata/Logs?$filter=year(Timestamp) ge 2023 and year(Timestamp) le 2024'
```

**Combining date functions with arithmetic:**

```
# Products updated in the last quarter of any year
GET /odata/Products?$filter=month(UpdatedAt) gt 9

# Orders from Q4 2024
GET /odata/Orders?$filter=year(OrderDate) eq 2024 and month(OrderDate) gt 9
```

::: info Dialect detection
The `TypeOrmFilterVisitor` accepts a `dialect` option (`'sqlite'`, `'postgres'`, or `'ansi'`). The `ODataTypeOrmModule` automatically detects the TypeORM driver and sets the correct dialect. SQLite uses `strftime()`; all others use `EXTRACT()`.
:::

---

## String Functions

### Basic string functions

These functions have been available since the initial release:

| Function                     | Behavior         | SQL Translation        |
| ---------------------------- | ---------------- | ---------------------- |
| `contains(field, 'value')`   | Substring match  | `field LIKE '%value%'` |
| `startswith(field, 'value')` | Prefix match     | `field LIKE 'value%'`  |
| `endswith(field, 'value')`   | Suffix match     | `field LIKE '%value'`  |
| `tolower(field)`             | Lowercase        | `LOWER(field)`         |
| `toupper(field)`             | Uppercase        | `UPPER(field)`         |
| `trim(field)`                | Strip whitespace | `TRIM(field)`          |
| `length(field)`              | Character count  | `LENGTH(field)`        |

::: tip LIKE injection prevention
`%` and `_` characters in the search value are automatically escaped before SQL translation. The pattern `contains(name, '100%')` translates to `LIKE '%100\%%'`, not `LIKE '%100%%'`.
:::

### Additional string functions

Three additional string functions are available:

#### indexof()

Returns the zero-based position of a substring within a string. Returns `-1` if not found.

```
GET /odata/Products?$filter=indexof(Name, 'Pro') ge 0
```

Translates to SQL:

- SQLite: `INSTR(Name, 'Pro') - 1 >= 0`
- PostgreSQL: `STRPOS(Name, 'Pro') - 1 >= 0`

**Note:** The SQL functions (`INSTR`, `STRPOS`) are 1-based, so the visitor subtracts 1 to match OData's 0-based convention.

**Examples:**

```bash
# Products whose name contains 'Pro' anywhere
curl 'http://localhost:3000/odata/Products?$filter=indexof(Name,%27Pro%27) ge 0'

# Names where 'Widget' appears at position 0 (starts with 'Widget')
curl 'http://localhost:3000/odata/Products?$filter=indexof(Name,%27Widget%27) eq 0'
```

#### substring()

Extracts a portion of a string. Two forms:

- `substring(field, start)` — from position `start` to end of string
- `substring(field, start, length)` — `length` characters starting at `start`

Positions are zero-based (OData convention). The visitor adds 1 internally for SQL compatibility.

```
GET /odata/Products?$filter=substring(Name, 0, 3) eq 'Pro'
```

Translates to: `SUBSTR(Name, 1, 3) = 'Pro'`

**Examples:**

```bash
# Products whose name starts with 'Pro' (first 3 characters)
curl 'http://localhost:3000/odata/Products?$filter=substring(Name,0,3) eq %27Pro%27'

# Products whose name from position 4 onwards is 'Widget'
curl 'http://localhost:3000/odata/Products?$filter=substring(Name,4) eq %27Widget%27'
```

#### concat()

Concatenates two string expressions. Can be used to build comparison strings.

```
GET /odata/People?$filter=concat(FirstName, LastName) eq 'JohnDoe'
```

Translates to: `FirstName || LastName = 'JohnDoe'`

To include a space between names, use `concat` with `concat`:

```
GET /odata/People?$filter=concat(concat(FirstName, ' '), LastName) eq 'John Doe'
```

**Examples:**

```bash
# Find person by combined name (no space)
curl 'http://localhost:3000/odata/People?$filter=concat(FirstName,LastName) eq %27JohnDoe%27'

# Filter by city+country combination
curl 'http://localhost:3000/odata/Addresses?$filter=concat(City,Country) eq %27LondonUK%27'
```

### String function composition

String functions can be composed and used with comparison operators:

```bash
# Case-insensitive name search
curl 'http://localhost:3000/odata/Products?$filter=tolower(Name) eq %27widget%27'

# Trimmed description is not empty
curl 'http://localhost:3000/odata/Products?$filter=length(trim(Description)) gt 0'

# SKU starts with category prefix (case-insensitive)
curl 'http://localhost:3000/odata/Products?$filter=startswith(tolower(SKU),%27elec%27)'
```

---

## Combining Advanced Filters

All filter functions compose freely with logical operators:

```bash
# Lambda + date: orders from 2024 with any express item
curl 'http://localhost:3000/odata/Orders?$filter=year(OrderDate) eq 2024 and Items/any(i: i/Shipping eq %27express%27)'

# Arithmetic + string: expensive products whose name contains 'Pro'
curl 'http://localhost:3000/odata/Products?$filter=Price mul Quantity gt 500 and contains(Name, %27Pro%27)'

# Date + lambda: recent orders with all items fulfilled
curl 'http://localhost:3000/odata/Orders?$filter=year(OrderDate) eq 2024 and Items/all(i: i/Status eq %27fulfilled%27)'
```

---

## SQL Translation Reference

| OData Filter                       | SQL (PostgreSQL)                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `Items/any(i: i/Price gt 100)`     | `EXISTS (SELECT 1 FROM "item" i WHERE i.orderId = order.id AND i.Price > 100)`              |
| `Items/all(i: i/Shipped eq true)`  | `NOT EXISTS (SELECT 1 FROM "item" i WHERE i.orderId = order.id AND NOT (i.Shipped = true))` |
| `Price add Tax gt 50`              | `(Price + Tax) > 50`                                                                        |
| `year(CreatedAt) eq 2024`          | `EXTRACT(YEAR FROM CreatedAt) = 2024`                                                       |
| `indexof(Name, 'Pro') ge 0`        | `STRPOS(Name, 'Pro') - 1 >= 0`                                                              |
| `substring(Name, 0, 3) eq 'Pro'`   | `SUBSTR(Name, 1, 3) = 'Pro'`                                                                |
| `concat(First, Last) eq 'JohnDoe'` | `First \|\| Last = 'JohnDoe'`                                                               |

All values are bound as named parameters — never interpolated into the SQL string.

---

## See Also

- [Query Options](./query-options.md) — Full `$filter`, `$select`, `$orderby`, pagination reference
- [Security](./security.md) — `maxFilterDepth` to limit nesting of lambda and compound expressions
- [`TypeOrmFilterVisitor` source](https://github.com/cberd1509/nestjs-odata/blob/main/packages/typeorm/src/translator/filter-visitor.ts) — Full implementation source
