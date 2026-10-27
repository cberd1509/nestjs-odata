# Configuration

## ODataModule.forRoot() options

All options are passed to `ODataModule.forRoot()`:

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata', // Required
  namespace: 'MyApp', // Default: 'Default'
  maxTop: 500, // Default: 1000
  maxExpandDepth: 3, // Default: 2
  maxFilterDepth: 15, // Default: 10
  maxDeepInsertDepth: 3, // Default: 5
  unmappedTypeStrategy: 'skip', // Default: 'skip'
  controllers: [ProductsController, CategoriesController],
})
```

### Options reference

| Option                    | Type                           | Default      | Description                                                                                                                      |
| ------------------------- | ------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `serviceRoot`             | `string`                       | — (required) | Base path for all OData routes, e.g. `'/odata'`                                                                                  |
| `namespace`               | `string`                       | `'Default'`  | EDM namespace used in `$metadata` and `@odata.context` URLs                                                                      |
| `maxTop`                  | `number`                       | `1000`       | Maximum value for `$top`. Requests exceeding this return HTTP 400                                                                |
| `maxExpandDepth`          | `number`                       | `2`          | Maximum depth for `$expand` nesting                                                                                              |
| `maxFilterDepth`          | `number`                       | `10`         | Maximum nesting depth of `$filter` expressions                                                                                   |
| `unmappedTypeStrategy`    | `'skip' \| 'error'`            | `'skip'`     | Behavior when a TypeScript type cannot be mapped to an EDM primitive                                                             |
| `maxDeepInsertDepth`      | `number`                       | `5`          | Maximum nesting depth for deep insert POST bodies                                                                                |
| `errorMapper`             | `ODataErrorMapper`             | —            | Maps any exception to an OData error (status, code, message, target, details). See [Error mapping](./error-mapping)              |
| `requireScope`            | `boolean`                      | `false`      | Fail closed when an entity set has no [row-level scope](./row-level-scopes)                                                      |
| `errorLanguage`           | `string`                       | `'en'`       | RFC 5646 language of error messages, sent as `Content-Language` on errors. See [Error mapping](./error-mapping#content-language) |
| `ignoreUnknownProperties` | `boolean`                      | `false`      | Drop write-body properties that are not in the entity type instead of answering 400. See [CRUD](./crud#request-bodies)           |
| `controllers`             | `(new (...args) => unknown)[]` | `[]`         | `@ODataController` classes to register and path-patch with `serviceRoot`                                                         |

::: warning maxTop is a hard limit
Unlike some OData implementations, `nestjs-odata` rejects `$top` values that exceed `maxTop` with HTTP 400. It does not silently clamp. This ensures clients know exactly what they are receiving.
:::

## forRootAsync()

For async configuration (environment variables, config service):

```typescript
import { ConfigModule, ConfigService } from '@nestjs/config'

@Module({
  imports: [
    ConfigModule.forRoot(),
    ODataModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        serviceRoot: config.get('ODATA_SERVICE_ROOT', '/odata'),
        maxTop: config.get<number>('ODATA_MAX_TOP', 1000),
        namespace: config.get('ODATA_NAMESPACE', 'Default'),
      }),
      inject: [ConfigService],
    }),
    // ...
  ],
})
export class AppModule {}
```

## Error mapping

`errorMapper` maps any exception thrown by an OData route or a `$batch` operation to an OData
error. Return `undefined` to keep the default mapping:

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  errorMapper: (err) =>
    err instanceof AppError
      ? { status: err.httpStatus, code: err.code, message: err.publicMessage }
      : undefined,
})
```

The mapper must be synchronous. It runs on the OData route decorators' routes, `$metadata` and
`$batch`; plain routes keep your global filters unless they opt in with
`@UseFilters(ODataExceptionFilter)`. See [Error mapping](./error-mapping) for the full API.

## ODataTypeOrmModule.forFeature() options

```typescript
ODataTypeOrmModule.forFeature([Product, Category, Order])
```

The `serviceRoot` option in `forFeature()` is **optional**. It defaults to the value registered by `ODataModule.forRoot()` via `ODataModule.registeredServiceRoot`. You only need to pass it explicitly if you have multiple OData services with different roots:

```typescript
// Explicit override (rarely needed)
ODataTypeOrmModule.forFeature([Product], { serviceRoot: '/api/v2' })
```

### Row-level scopes

Each item can carry a `scope`, and `defaultScope` covers the rest of the feature's entities.
`imports` lists the modules that class-based scopes inject from. See
[Row-level scopes](./row-level-scopes).

```typescript
ODataTypeOrmModule.forFeature([{ entity: Project, scope: ownRows }, Task], {
  defaultScope: ownRows,
})
```

### Write handlers and ETags

`writeHandlers` on an item routes the entity set's POST, PATCH, PUT, DELETE and deep insert
(also in `$batch`) through your own code, and `etag` sets where its ETag comes from (a property
name or a function). See [Custom write handlers](./write-handlers). `requireIfMatch: true`
makes PATCH, PUT and DELETE without `If-Match` answer `428 Precondition Required` and
advertises `Core.OptimisticConcurrency` in `$metadata` (see
[CRUD: Requiring If-Match](./crud#requiring-if-match)).

```typescript
ODataTypeOrmModule.forFeature(
  [
    {
      entity: Account,
      writeHandlers: AccountWriteHandlers,
      etag: 'version',
      requireIfMatch: true,
    },
  ],
  { imports: [AccountsModule] }, // modules the handlers class injects from
)
```

### Custom entity-set names

Pass `{ entity, name }` configs inside the items array to override the OData
entity-set name without touching the entity class. The override wins over
both `@ODataEntitySet` decorator and default pluralization.

```typescript
ODataTypeOrmModule.forFeature([
  Tag, // → /odata/Tags (auto-pluralized)
  { entity: UserEntity, name: 'Users' }, // → /odata/Users (not /odata/UserEntities)
  { entity: ClaudeSessionEntity, name: 'Sessions' },
])
```

### Co-locating controllers (single declaration)

Pass `controllers` in the options object and `forFeature` will patch their
`PATH_METADATA` with the service root _and_ register them in its own dynamic
module. You no longer need to list them in `@Module({ controllers })` (they
still need to be listed in `ODataModule.forRoot({ controllers })` for the
service-root path patching, but the declaration in `forFeature` covers the
DI side).

```typescript
@Module({
  imports: [
    ODataModule.forRoot({
      serviceRoot: '/odata',
      controllers: [UsersODataController, SessionsODataController],
    }),
    ODataTypeOrmModule.forFeature(
      [
        { entity: UserEntity, name: 'Users' },
        { entity: ClaudeSessionEntity, name: 'Sessions' },
      ],
      { controllers: [UsersODataController, SessionsODataController] },
    ),
  ],
  // controllers: [...] — not needed; forFeature owns the registration
})
export class AppModule {}
```

### Mounting under `app.setGlobalPrefix()`

If your app applies a Nest global prefix (typical pattern: `app.setGlobalPrefix('api')`),
exclude the OData routes so the service root isn't double-prefixed. The
`ODataModule.globalPrefixExclude()` helper returns the correct Express 5
splat patterns based on the `serviceRoot` you registered:

```typescript
import { ODataModule } from '@nestjs-odata/core'

const app = await NestFactory.create(AppModule)
app.setGlobalPrefix('api', { exclude: ODataModule.globalPrefixExclude() })
// Non-OData routes → /api/...
// OData routes      → /odata/...  (unprefixed; serviceRoot stays canonical)
```

Pass an explicit value (`globalPrefixExclude('/v2/odata')`) when you have
multiple OData mounts or need to exclude a specific sub-path. Without this,
`@odata.context` / `@odata.id` / `@odata.nextLink` URLs in the response body
would be inconsistent with the actual route paths.

## ODataTypeOrmModule.forRoot() options

Optional, imported once in the root module.

| Option             | Type                    | Default               | Description                                                                                                                                                                 |
| ------------------ | ----------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changesetRunner`  | `ODataChangesetRunner?` | TypeORM `QueryRunner` | Runs every `$batch` changeset inside your own unit of work. See [$batch changesets and atomicity](./write-handlers#batch-changesets-and-atomicity).                         |
| `batch.enabled`    | `boolean?`              | `true`                | `false` turns `POST {serviceRoot}/$batch` off (404).                                                                                                                        |
| `batch.entitySets` | `string[]?`             | every entity set      | Allow-list of entity sets `$batch` operations may target; other targets answer 403 without reaching their route. See [$batch](./batch#turning-batch-off-or-restricting-it). |

```typescript
ODataTypeOrmModule.forRoot({
  changesetRunner: (work, { request }) => unitOfWork.run(request, (manager) => work(manager)),
  batch: { entitySets: ['Products', 'Orders'] },
})
```

`$batch` operations always run through their routes (guards, interceptors, pipes), like
standalone requests; these options only restrict the endpoint further.

## Per-entity security overrides

Individual entity sets can override the global security limits:

```typescript
// In a module initializer or custom provider
import { EdmRegistry } from '@nestjs-odata/core'

@Injectable()
export class SecurityConfigService implements OnModuleInit {
  constructor(private readonly edmRegistry: EdmRegistry) {}

  onModuleInit(): void {
    // Products can only return 50 items at most
    this.edmRegistry.setEntitySecurityOptions('Products', {
      maxTop: 50,
    })

    // Orders has a shallower expand limit
    this.edmRegistry.setEntitySecurityOptions('Orders', {
      maxTop: 200,
      maxExpandDepth: 1,
    })
  }
}
```

Per-entity overrides take precedence over global `ODataModuleOptions` values. See [Security](./security.md) for the full security reference.

## Namespace

The `namespace` affects:

- EDM type names in `$metadata`: `Default.Product` vs `MyApp.Product`
- `@odata.context` URLs: `$metadata#Products/Default.Product`

Use a namespace that matches your application domain:

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  namespace: 'Northwind',
})
```

## unmappedTypeStrategy

When the TypeORM entity has a column whose TypeScript type cannot be mapped to an OData EDM primitive:

- `'skip'` (default) — The property is silently excluded from the EDM. The column still exists in the database but is not exposed via OData.
- `'error'` — Module initialization throws an error. Use this in development to catch unmapped types early.

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  unmappedTypeStrategy: 'error', // Fail fast in development
})
```
