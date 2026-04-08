# EDM Schema & $metadata

OData v4 services expose machine-readable descriptions of their data model. This page explains the two discovery endpoints that `nestjs-odata` generates automatically and how to use them with common tools.

## Service document — `GET /odata/`

The **service document** is the root endpoint of your OData service. It lists every entity set available for querying.

```bash
curl http://localhost:3000/odata/
```

**Example response:**

```json
{
  "@odata.context": "/odata/$metadata",
  "value": [
    { "name": "Products", "url": "Products", "kind": "EntitySet" },
    { "name": "Categories", "url": "Categories", "kind": "EntitySet" }
  ]
}
```

The `@odata.context` property points to the full metadata document. Each entry in `value` corresponds to an entity set registered via `ODataTypeOrmModule.forFeature()`.

## $metadata — `GET /odata/$metadata`

The **$metadata** endpoint returns CSDL (Common Schema Definition Language) XML that describes the full Entity Data Model: entity types, their properties and keys, navigation properties, and the entity container.

```bash
curl http://localhost:3000/odata/\$metadata
```

::: tip Shell escaping
In most shells, `$metadata` needs escaping (`\$metadata`) or quoting (`'$metadata'`) to prevent variable expansion.
:::

### Example $metadata output

For a `Product` entity with a `Category` navigation property:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Default">
      <EntityType Name="Product">
        <Key>
          <PropertyRef Name="id"/>
        </Key>
        <Property Name="id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="name" Type="Edm.String" Nullable="false"/>
        <Property Name="price" Type="Edm.Decimal" Nullable="false" Precision="10" Scale="2"/>
        <Property Name="inStock" Type="Edm.Boolean" Nullable="false"/>
        <NavigationProperty Name="category" Type="Default.Category" Nullable="true"/>
      </EntityType>
      <EntityType Name="Category">
        <Key>
          <PropertyRef Name="id"/>
        </Key>
        <Property Name="id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="name" Type="Edm.String" Nullable="false"/>
        <NavigationProperty Name="products" Type="Collection(Default.Product)"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Products" EntityType="Default.Product"/>
        <EntitySet Name="Categories" EntityType="Default.Category"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
```

### How TypeORM maps to EDM

| TypeORM concept                                  | EDM concept                         | Example         |
| ------------------------------------------------ | ----------------------------------- | --------------- |
| `@Entity()` class                                | `<EntityType>`                      | `Product`       |
| `@PrimaryGeneratedColumn()` / `@PrimaryColumn()` | `<Key><PropertyRef>`                | `id`            |
| `@Column()`                                      | `<Property>`                        | `name`, `price` |
| `@ManyToOne()` / `@OneToOne()`                   | `<NavigationProperty>` (single)     | `category`      |
| `@OneToMany()` / `@ManyToMany()`                 | `<NavigationProperty>` (collection) | `products`      |
| Entity set name from `@ODataController`          | `<EntitySet>`                       | `Products`      |

The `Namespace` defaults to `"Default"` and the container is always named `"Container"`. You can change the namespace via the `namespace` option in `ODataModule.forRoot()`:

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  namespace: 'MyApp',
})
```

### Property type mapping

TypeORM column types are mapped to OData EDM primitive types:

| TypeORM / TypeScript | EDM type             |
| -------------------- | -------------------- |
| `number` (integer)   | `Edm.Int32`          |
| `number` (decimal)   | `Edm.Decimal`        |
| `string`             | `Edm.String`         |
| `boolean`            | `Edm.Boolean`        |
| `Date`               | `Edm.DateTimeOffset` |

Column options like `precision`, `scale`, and `maxLength` are reflected in the CSDL as attributes on the `<Property>` element.

## Browsing $metadata

### In a browser

Navigate directly to your metadata URL:

```
http://localhost:3000/odata/$metadata
```

Most browsers render XML with syntax highlighting and collapsible nodes.

### With XOData

[XOData](https://pragmatiqa.com/xodata/) is a free visual tool for exploring OData metadata:

1. Open https://pragmatiqa.com/xodata/
2. Paste your `$metadata` URL (e.g., `http://localhost:3000/odata/$metadata`)
3. Browse the entity relationship diagram and test queries interactively

### With Postman

OData endpoints can be imported into Postman by converting `$metadata` to OpenAPI:

1. **Download** the `$metadata` XML:

   ```bash
   curl http://localhost:3000/odata/\$metadata -o metadata.xml
   ```

2. **Convert** to OpenAPI using one of these options:

   **Option A — Web converter (recommended):**
   Visit [convert.odata-openapi.net](https://convert.odata-openapi.net/), upload your `metadata.xml`, and download the resulting OpenAPI JSON. The conversion runs entirely client-side — no data is sent to a server.

   **Option B — CLI tool:**

   ```bash
   npm install -g odata-openapi
   odata-openapi3 metadata.xml
   ```

   This produces a `metadata.openapi3.json` file.

3. **Import** the OpenAPI JSON into Postman:
   - Open Postman and click **Import**
   - Select the `.json` file
   - Postman generates a collection with all your OData endpoints pre-configured

## Next steps

- [Getting Started](./getting-started.md) — Set up your first OData service
- [Configuration](./configuration.md) — Customize namespace, limits, and async setup
- [Query Options](./query-options.md) — `$filter`, `$select`, `$orderby`, pagination
