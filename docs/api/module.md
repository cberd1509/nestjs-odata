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
   * Fail closed when an entity set has no row-level scope. Default: false.
   * See the "Row-level scopes" guide.
   */
  requireScope?: boolean

  /**
   * Maps any exception thrown by an OData route or a $batch operation to an OData error.
   * Synchronous; return undefined for the default mapping. See the "Error mapping" guide.
   */
  errorMapper?: ODataErrorMapper

  /**
   * RFC 5646 language of error messages, sent as Content-Language on every error response and
   * $batch error part. Default: 'en'. A mapping's own `language` wins.
   */
  errorLanguage?: string

  /**
   * Drop write-body properties that are not in the entity type instead of answering
   * 400 Bad Request (OData §11.4.2). Default: false.
   */
  ignoreUnknownProperties?: boolean

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

### ODataModule.globalPrefixExclude()

```typescript
static globalPrefixExclude(
  serviceRootOverride?: string
): ReadonlyArray<{ path: string; method: number }>
```

Build the exclude pattern array for `app.setGlobalPrefix()` so OData routes
(which already include `serviceRoot` in their `PATH_METADATA`) don't get
double-prefixed by NestJS.

Returns Express 5 splat-style patterns covering both the bare service root
and its children — compatible with NestJS 11 and 12.

**Parameters:**

| Parameter             | Type      | Description                                                                                  |
| --------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `serviceRootOverride` | `string?` | Explicit service root to use. Defaults to the value registered via `forRoot()` (or `odata`). |

**Example:**

```typescript
import { ODataModule } from '@nestjs-odata/core'

const app = await NestFactory.create(AppModule)
app.setGlobalPrefix('api', { exclude: ODataModule.globalPrefixExclude() })
// → `/api/users` routes go through; `/odata/...` routes stay unprefixed
```

### ODataModule.forFeature()

```typescript
ODataModule.forFeature(entityConfigs: EdmEntityConfig[]): DynamicModule
```

Registers EDM entity configurations from a feature module. Typically used directly; the TypeORM adapter (`ODataTypeOrmModule.forFeature()`) calls this internally.

---

## ODataTypeOrmModule

The TypeORM adapter module. Derives OData EDM from TypeORM entity metadata.

### ODataTypeOrmModule.forRoot()

```typescript
ODataTypeOrmModule.forRoot(options?: {
  changesetRunner?: ODataChangesetRunner
  batch?: ODataBatchOptions // { enabled?, entitySets?, operationTimeout? }
}): DynamicModule
```

Optional, imported once in the root module (global). Application-wide adapter settings:

- `changesetRunner` runs each `$batch` changeset atomically in your own unit of work (default: a
  TypeORM `QueryRunner` transaction). See
  [$batch changesets and atomicity](../guide/write-handlers#batch-changesets-and-atomicity).
  For a runner with injected dependencies, provide the `ODATA_CHANGESET_RUNNER` token from a
  `@Global()` module instead.
- `batch` controls the `$batch` endpoint: `enabled: false` answers 404, `entitySets` allow-lists
  the entity sets operations may reach (resource path, navigation and `$expand` targets; others
  answer 403), `operationTimeout` limits each operation (ms, default 30 000; then 504). Provided under the
  `ODATA_BATCH_OPTIONS` token. See [$batch](../guide/batch#turning-batch-off-or-restricting-it).

### ODataTypeOrmModule.forFeature()

```typescript
ODataTypeOrmModule.forFeature(
  items: ODataTypeOrmFeatureItem[],
  options?: {
    serviceRoot?: string
    controllers?: Type[]
    defaultScope?: ODataScopeDefinition
    imports?: ModuleMetadata['imports']
  }
): DynamicModule
```

Registers TypeORM entities for OData auto-derivation.

**`items` array** accepts a mixed list of (`EntityClassOrSchema` is exported, and is whatever
`TypeOrmModule.forFeature()` accepts: an entity class or an `EntitySchema`):

- **Bare entity class** — `Product` — the OData entity-set name is derived from
  the class name (respecting any `@ODataEntitySet` decorator, otherwise
  pluralized).
- **Object config** — `{ entity: UserEntity, name: 'Users' }` — explicitly
  override the OData entity-set name. Takes precedence over `@ODataEntitySet`
  and over default pluralization.

```typescript
type ODataTypeOrmFeatureConfig = {
  readonly entity: EntityClassOrSchema
  readonly name?: string
  /** Row-level scope: a function `(qb, ctx) => void | Promise<void>` or an injectable `ODataScope` class */
  readonly scope?: ODataScopeDefinition
  /** Route writes through application code: an `ODataWriteHandlers` object or injectable class */
  readonly writeHandlers?: ODataWriteHandlersDefinition
  /** ETag source: a property name or `(entity) => value`. Overrides @ODataETag / @UpdateDateColumn */
  readonly etag?: ODataETagSource
  /** PATCH/PUT/DELETE without If-Match answer 428; $metadata gets Core.OptimisticConcurrency */
  readonly requireIfMatch?: boolean
}
type ODataTypeOrmFeatureItem = EntityClassOrSchema | ODataTypeOrmFeatureConfig
```

**Parameters:**

| Parameter              | Type                         | Description                                                                                                                                                                                  |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`                | `ODataTypeOrmFeatureItem[]`  | Entity classes and/or `{ entity, name }` configs                                                                                                                                             |
| `options.serviceRoot`  | `string?`                    | Optional. Inherits from `ODataModule.registeredServiceRoot` by default.                                                                                                                      |
| `options.controllers`  | `Type[]?`                    | OData controllers (decorated with `@ODataController`). When provided, `forFeature` patches their `PATH_METADATA` with `serviceRoot` AND registers them — no separate `@Module` entry needed. |
| `options.defaultScope` | `ODataScopeDefinition?`      | [Row-level scope](../guide/row-level-scopes) for every item without its own `scope`.                                                                                                         |
| `options.imports`      | `ModuleMetadata['imports']?` | Modules whose providers class-based scopes inject.                                                                                                                                           |

**What it does:**

1. Wraps `TypeOrmModule.forFeature(entities)` for repository injection
2. Registers `TypeOrmEdmInitializer` which runs `onModuleInit` to derive EDM from TypeORM metadata (applying any `{ entity, name }` overrides)
3. Registers `TypeOrmQueryTranslator` for `$filter`, `$select`, `$orderby`, `$expand`, `$search`, `$apply` translation
4. Registers `TypeOrmAutoHandler` for zero-boilerplate CRUD operation handling. Multi-entity safe: each request resolves the right Repository from its entity-set name (no need to split into per-feature modules)
5. Registers `TypeOrmETagProvider` and `TypeOrmSearchProvider` for ETag concurrency and `$search` support
6. Imports `ODataBatchModule`, which registers `BatchController` at `POST {serviceRoot}/$batch` once per application: one endpoint serves the entity sets of every `forFeature()` module
7. (When `options.controllers` is set) Patches each controller's `PATH_METADATA` with `serviceRoot` and registers it in the dynamic module's `controllers` array

**Examples:**

```typescript
// Simple — bare entity classes
ODataTypeOrmModule.forFeature([Product, Category, Order, OrderItem])

// With set-name overrides (avoids `/odata/UserEntities` URLs)
ODataTypeOrmModule.forFeature([
  { entity: UserEntity, name: 'Users' },
  { entity: ClaudeSessionEntity, name: 'Sessions' },
])

// Single-declaration: controllers live in this dynamic module
ODataTypeOrmModule.forFeature(
  [
    { entity: UserEntity, name: 'Users' },
    { entity: ClaudeSessionEntity, name: 'Sessions' },
  ],
  { controllers: [UsersODataController, SessionsODataController] },
)
```

---

## Request context

`ODataModule.forRoot()` and `forRootAsync()` register `ODataRequestContextInterceptor` as a global
interceptor. It keeps the current `ExecutionContext` and request for the whole handler, so adapters
can hand them to application hooks such as row-level scopes.

```typescript
import { getODataRequestContext, runWithODataRequestContext } from '@nestjs-odata/core'

getODataRequestContext() // { executionContext?, request? } | undefined outside a request
runWithODataRequestContext({ request }, () => handler.handleGet(query, url)) // outside HTTP
```

### $batch operations

Each `$batch` operation runs through its own route, so the request context is the operation's.
While it runs, `getODataBatchPart()` describes it:

```typescript
import { getODataBatchPart, type ODataBatchPartContext } from '@nestjs-odata/core'

interface ODataBatchPartContext {
  method: string // as sent in the batch
  url: string // as sent, after $<Content-ID> references are resolved
  contentId?: string
  inChangeset: boolean
  batchRequest: unknown // the platform request of the enclosing $batch request
}

getODataBatchPart(request?) // ODataBatchPartContext | undefined (not in a $batch)
```

The operation is attached to its request (`request[ODATA_BATCH_PART]`, also read from
`request.raw`) and kept in an `AsyncLocalStorage`. `getODataBatchPart(request?)` reads `request`
(else the request of the OData request context) first, then the async context: pass the request
from guards and middleware. `getODataBatchRequestValue(key, request?)` reads any value the batch
controller attached (`null` means "explicitly none").

Lower-level helpers used by the adapter's `BatchController`, exported for other adapters:
`dispatchBatchOperation(httpAdapter, { method, url, headers, body?, remoteAddress?, attach?, timeoutMs? })`
(runs one operation through the Express application or Fastify's `inject()`, in process; `attach`
sets symbol properties on the injected request; rejects with `BatchOperationTimeoutError` after
`timeoutMs`; the response's headers keep multi-valued headers as arrays and a binary body as a
`Buffer`),
`batchOperationHeaders(batchHeaders, partHeaders, hasBody)` (the headers an operation inherits),
`resolveBatchOperationUrl(operationUrl, batchUrl)` and `runWithODataBatchPart(part, fn)`.

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
