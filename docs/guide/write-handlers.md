# Custom write handlers

By default, `TypeOrmAutoHandler` and `$batch` write through the TypeORM repository. **Write
handlers** route an entity set's writes through your own code instead: an application service,
a command bus, a use case with its own validation, auditing or events. Reads still use the
OData query pipeline.

| Request                             | Handler                                 |
| ----------------------------------- | --------------------------------------- |
| `POST /Set`                         | `create(body, ctx)`                     |
| `POST /Set` with nested entities    | `deepInsert(body, ctx)` (else `create`) |
| `PATCH /Set/:key`                   | `update(key, body, ctx)`                |
| `PUT /Set/:key`                     | `replace(key, body, ctx)`               |
| `DELETE /Set/:key`                  | `delete(key, ctx)`                      |
| the same operations inside `$batch` | the same handlers                       |

An entity set with write handlers **never falls back to the repository**. An operation without a
handler answers `405 Method Not Allowed`.

A POST counts as a deep insert when a collection navigation property holds an array or a
single-valued one holds an object; `null` and scalar values do not. A deep insert into an entity
set **without** handlers whose nested entities belong to an entity set **with** handlers is
refused with 400 (the nested rows would otherwise bypass those handlers): give the parent a
`deepInsert` handler instead.

## Registering handlers

Pass `writeHandlers` on a `forFeature()` item, as an object or as an injectable class:

```typescript
import {
  ODataTypeOrmModule,
  type ODataEntityKey,
  type ODataWriteContext,
  type ODataWriteHandlers,
} from '@nestjs-odata/typeorm'

@Injectable()
export class AccountWriteHandlers implements ODataWriteHandlers<Account> {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  create(body: Record<string, unknown>, ctx: ODataWriteContext) {
    return this.accounts.open(body, ctx.request)
  }

  update(key: ODataEntityKey, body: Record<string, unknown>, ctx: ODataWriteContext) {
    return this.accounts.rename(Number(key.id), body, ctx.ifMatch)
  }

  async delete(key: ODataEntityKey) {
    await this.accounts.close(Number(key.id))
  }
}

@Module({
  imports: [
    ODataTypeOrmModule.forFeature(
      [{ entity: Account, writeHandlers: AccountWriteHandlers, etag: 'version' }],
      { imports: [AccountsModule] }, // provides AccountService
    ),
  ],
})
export class AccountsODataModule {}
```

A class is registered as a provider of the feature module. List the modules its dependencies come
from in `imports`. Your controller keeps calling `TypeOrmAutoHandler` (`handleCreate`,
`handleUpdate`, `handleReplace`, `handleDelete`, `handleDeepCreate`), which dispatches to the
handlers.

## Handler signatures

```typescript
interface ODataWriteHandlers<TEntity extends object = Record<string, unknown>> {
  create?(body: Record<string, unknown>, ctx: ODataWriteContext): TEntity | Promise<TEntity>
  deepInsert?(body: Record<string, unknown>, ctx: ODataWriteContext): TEntity | Promise<TEntity>
  update?(
    key: ODataEntityKey,
    body: Record<string, unknown>,
    ctx: ODataWriteContext,
  ): TEntity | Promise<TEntity>
  replace?(
    key: ODataEntityKey,
    body: Record<string, unknown>,
    ctx: ODataWriteContext,
  ): TEntity | Promise<TEntity>
  delete?(key: ODataEntityKey, ctx: ODataWriteContext): void | Promise<void>
}

interface ODataWriteContext {
  entitySetName: string
  entityType: EdmEntityType
  operation: 'create' | 'deepInsert' | 'update' | 'replace' | 'delete'
  rawKey?: string // the key as written in the URL
  ifMatch?: string // the If-Match header
  executionContext?: ExecutionContext // the route's (the $batch route's, in a batch)
  request?: unknown // the Express/Fastify request (the $batch request, in a batch)
  manager?: EntityManager // the transaction's manager: in a $batch changeset, or passed to handleDeepCreate
  batch?: { contentId?: string; inChangeset: boolean }
}
```

- `key` is the parsed key: `{ id: 5 }`, or `{ orderId: 1, itemId: 2 }` for composite keys.
- `body` is the parsed JSON body. Validate it: the library does not, and with handlers there is
  no repository whitelist of columns.
- Return the entity to serialize. For `create`, its key properties build the `Location` header.
  `create`, `deepInsert`, `update` and `replace` must return an object: a handler that returns
  nothing fails with 500 (and rolls back its `$batch` changeset), over HTTP and in `$batch`.
- Throw to fail the write. An `HttpException` keeps its status, and other errors become 500.
  In `$batch`, an `HttpException` wrapped by your code as an error's `cause` keeps its status
  too. Your own error types can be mapped with the error-mapping option.

## ETags and `If-Match`

`etag` on a `forFeature()` item sets where the entity set's ETag comes from. It overrides
`@ODataETag` and `@UpdateDateColumn`, and applies with or without write handlers:

```typescript
{ entity: Account, etag: 'version' }                       // a property
{ entity: Account, etag: (a) => `${a.version}-${a.region}` } // a function of the entity
```

The value becomes a weak ETag (`W/"<base64>"`). A function may instead return a complete ETag
(`W/"…"` or `"…"`), which is used as is. The ETag is sent:

- as the `ETag` header and `@odata.etag` on `GET /Set/:key` (`If-None-Match` → 304),
- on the responses of `POST`, `PATCH` and `PUT`, with or without write handlers,
- as the `ETag` header and `@odata.etag` of `$batch` response parts (GET by key and writes).

Every ETag, from an `etag` option or from `@ODataETag` / `@UpdateDateColumn`, is compared the
same way: `*` matches any entity, and a comma-separated list matches when any entry does.

With write handlers, the library passes `If-Match` to the handler as `ctx.ifMatch` and does not
check it: compare it with the current version **in the same transaction as the write**. The
`etagMatches(ifMatch, currentEtag)` and `formatWeakETag(value)` helpers produce exactly the ETags
the library sends, and `etagMatches` understands `*` and lists:

```typescript
async rename(id: number, body: Record<string, unknown>, ifMatch?: string) {
  const current = await this.repo.findOneByOrFail({ id })
  if (ifMatch && !etagMatches(ifMatch, formatWeakETag(current.version))) {
    throw new HttpException('Precondition Failed', 412)
  }
  return this.repo.save({ ...current, ...body, version: current.version + 1 })
}
```

Without write handlers, the repository path checks `If-Match` against the ETag itself and
answers 412 (the HTTP routes; `$batch` parts are not checked).

## Row-level scopes

When the entity set has a [row-level scope](./row-level-scopes), the library loads the target row
through the scope **before** calling `update`, `replace` or `delete`, and answers 404 without
calling the handler when the row is outside it. That check holds no row lock while your handler
runs (outside a changeset), so re-check what matters inside your own transaction. `create` and
`deepInsert` are not checked: make sure new rows land inside the caller's scope.

## `$batch` changesets and atomicity

Writes inside a changeset go through the same handlers, with `ctx.batch.inChangeset === true`
and `ctx.manager` set to the changeset's transaction. The library makes changesets atomic as
long as **your handlers write through the transaction the changeset runs in**:

- **Default:** each changeset runs in a TypeORM `QueryRunner` transaction. Write through
  `ctx.manager` (`ctx.manager.getRepository(Account)`). If any operation fails, the library
  rolls back and every part of the changeset gets the error.
- **Your own unit of work:** pass `changesetRunner` to `ODataTypeOrmModule.forRoot()`, once in
  the root module (it applies to every changeset of the application). It receives a `work`
  function that runs every operation of the changeset and rejects when one fails. Commit when
  `work` resolves and roll back when it rejects:

  ```typescript
  @Module({
    imports: [
      ODataModule.forRoot({ serviceRoot: '/odata' }),
      ODataTypeOrmModule.forRoot({
        changesetRunner: (work, { request }) => unitOfWork.run(request, (manager) => work(manager)),
      }),
      // ... ODataTypeOrmModule.forFeature(...) imports
    ],
  })
  export class AppModule {}
  ```

  The `manager` you pass to `work` becomes `ctx.manager`. If your services find the current
  transaction another way (for example AsyncLocalStorage), start it in the runner: the
  handlers run inside the runner's callback. The runner may wrap or replace the error it sees:
  the parts still get the failing operation's own status.

  A runner that needs injected services: provide the `ODATA_CHANGESET_RUNNER` token yourself
  from a `@Global()` module (`useFactory` + `inject`) instead of calling `forRoot()`.

Outside a changeset (single parts of a `$batch`, plain requests), the library opens no
transaction for handlers and `ctx.manager` is `undefined`. The one exception is
`handleDeepCreate(body, set, manager)`: the `manager` your controller passes is handed to the
`deepInsert` / `create` handler as `ctx.manager`.
