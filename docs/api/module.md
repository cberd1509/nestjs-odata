# Module API

## ODataModule

The core module — ORM-agnostic. Import once in your root module.

### ODataModule.forRoot()

```typescript
ODataModule.forRoot(options: ODataModuleOptions): DynamicModule
```

Registers the OData service synchronously.

#### ODataModuleOptions

```typescript
interface ODataModuleOptions {
  /** Base path for the OData service, e.g. '/odata'. Required. */
  serviceRoot: string

  /** EDM namespace for all entity types. Default: 'Default' */
  namespace?: string

  /** Maximum value for $top. Requests exceeding this return HTTP 400. Default: 1000 */
  maxTop?: number

  /** Maximum depth of $expand nesting. Default: 2 */
  maxExpandDepth?: number

  /** Maximum nesting depth of $filter expressions. Default: 10 */
  maxFilterDepth?: number

  /** Strategy when a TypeScript type cannot be mapped to an EDM primitive. Default: 'skip' */
  unmappedTypeStrategy?: 'skip' | 'error'

  /**
   * Maximum nesting depth for deep insert POST bodies. Default: 5.
   * Prevents denial-of-service via unbounded recursion.
   */
  maxDeepInsertDepth?: number

  /**
   * @ODataController classes to register and path-patch with serviceRoot.
   * Controllers listed here have their route prefix set to `{serviceRoot}/{entitySetName}`.
   */
  controllers?: (new (...args: unknown[]) => unknown)[]
}
```

**Example:**

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  namespace: 'MyApp',
  maxTop: 500,
  maxExpandDepth: 3,
  maxFilterDepth: 15,
  controllers: [ProductsController, CategoriesController],
})
```

### ODataModule.forRootAsync()

```typescript
ODataModule.forRootAsync(
  options: ConfigurableModuleAsyncOptions<ODataModuleOptions>
): DynamicModule
```

Registers the OData service with async configuration. Supports `useFactory`, `useClass`, and `useExisting`.

**Example with ConfigService:**

```typescript
ODataModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    serviceRoot: config.get('ODATA_ROOT', '/odata'),
    maxTop: config.get<number>('ODATA_MAX_TOP', 1000),
  }),
  inject: [ConfigService],
})
```

### ODataModule.registeredServiceRoot

```typescript
static get registeredServiceRoot(): string
```

Returns the `serviceRoot` registered via `forRoot()`. Used by adapter modules (e.g. `ODataTypeOrmModule`) to inherit the service root without requiring it to be passed again.

### ODataModule.forFeature()

```typescript
ODataModule.forFeature(entityConfigs: EdmEntityConfig[]): DynamicModule
```

Registers EDM entity configurations from a feature module. Typically used directly; the TypeORM adapter (`ODataTypeOrmModule.forFeature()`) calls this internally.

---

## ODataTypeOrmModule

The TypeORM adapter module. Derives OData EDM from TypeORM entity metadata.

### ODataTypeOrmModule.forFeature()

```typescript
ODataTypeOrmModule.forFeature(
  entities: EntityClassOrSchema[],
  options?: { serviceRoot?: string }
): DynamicModule
```

Registers TypeORM entities for OData auto-derivation.

**Parameters:**

| Parameter             | Type                    | Description                                                                                                                  |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `entities`            | `EntityClassOrSchema[]` | TypeORM entity classes decorated with `@Entity()`                                                                            |
| `options.serviceRoot` | `string?`               | Optional. Inherits from `ODataModule.registeredServiceRoot` by default. Only needed to override the `$batch` controller path |

**What it does:**

1. Wraps `TypeOrmModule.forFeature(entities)` for repository injection
2. Registers `TypeOrmEdmInitializer` which runs `onModuleInit` to derive EDM from TypeORM metadata
3. Registers `TypeOrmQueryTranslator` for `$filter`, `$select`, `$orderby`, `$expand`, `$search`, `$apply` translation
4. Registers `TypeOrmAutoHandler` for zero-boilerplate CRUD operation handling (including PUT replace and deep insert)
5. Registers `TypeOrmETagProvider` and `TypeOrmSearchProvider` for ETag concurrency and `$search` support
6. Registers `BatchController` at `POST {serviceRoot}/$batch`

**Example:**

```typescript
ODataTypeOrmModule.forFeature([Product, Category, Order, OrderItem])
```

---

## Injection tokens

### ODATA_MODULE_OPTIONS

Inject the resolved options (with defaults applied) in custom providers:

```typescript
import { ODATA_MODULE_OPTIONS, ODataModuleResolvedOptions } from '@nestjs-odata/core'

@Injectable()
export class MyService {
  constructor(
    @Inject(ODATA_MODULE_OPTIONS)
    private readonly options: ODataModuleResolvedOptions,
  ) {}
}
```

### ODataModuleResolvedOptions

```typescript
interface ODataModuleResolvedOptions {
  serviceRoot: string
  namespace: string // Always set (default: 'Default')
  maxTop: number // Always set (default: 1000)
  maxExpandDepth: number // Always set (default: 2)
  maxFilterDepth: number // Always set (default: 10)
  unmappedTypeStrategy: UnmappedTypeStrategy
  maxDeepInsertDepth: number // Always set (default: 5)
}
```

---

## EdmRegistry

The `EdmRegistry` is a global singleton that stores all registered entity types and sets. It is exported from `ODataModule` and available for injection throughout the application.

```typescript
import { EdmRegistry } from '@nestjs-odata/core'

@Injectable()
export class SecurityConfigService implements OnModuleInit {
  constructor(private readonly edmRegistry: EdmRegistry) {}

  onModuleInit(): void {
    this.edmRegistry.setEntitySecurityOptions('Products', {
      maxTop: 50,
      maxExpandDepth: 1,
      maxFilterDepth: 5,
    })
  }
}
```

### EdmRegistry methods

| Method                     | Signature                                                    | Description                        |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `register`                 | `(entityType, entitySet) => void`                            | Registers an entity type and set   |
| `getEntityType`            | `(name: string) => EdmEntityType \| undefined`               | Gets entity type by name           |
| `getEntitySet`             | `(name: string) => EdmEntitySet \| undefined`                | Gets entity set by name            |
| `getAllEntitySets`         | `() => EdmEntitySet[]`                                       | Returns all registered entity sets |
| `setEntitySecurityOptions` | `(entitySetName, opts) => void`                              | Sets per-entity security overrides |
| `getEntitySecurityOptions` | `(entitySetName) => ODataEntitySecurityOptions \| undefined` | Gets per-entity security overrides |
