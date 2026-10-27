# Row-level scopes

A **row-level scope** restricts which rows of an entity set a request can see or change. Use one
for multi-tenancy (rows of the caller's organization), ownership (rows the caller created), or any
access rule you can write as a query. The library applies it everywhere a row can surface, so a
row outside the scope never appears, however it is reached.

| Where a row can surface                                    | What the scope does                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /Set` (with `$filter`, `$orderby`, `$top`, `$search`) | restricts the root rows                                             |
| `GET /Set?$count=true`, `GET /Set/$count`                  | counts only rows inside the scope                                   |
| `GET /Set?$apply=...`                                      | aggregates only rows inside the scope                               |
| `GET /Set/:key`                                            | 404 when the row is outside the scope                               |
| `$expand=nav`, at any depth                                | the target set's own scope restricts the related rows; parents stay |
| `$filter=nav/any(...)`, `nav/all(...)`                     | the lambda ranges over rows inside the target set's scope           |
| `PATCH`, `PUT`, `DELETE /Set/:key`                         | 404 (and no write) when the row is outside the scope                |
| `$batch` reads and changeset writes                        | same as above                                                       |

## Registering a scope

Pass `scope` on a `forFeature()` item, or `defaultScope` for every entity of the feature without
one of its own:

```typescript
import { ODataTypeOrmModule, type ODataScopeFn } from '@nestjs-odata/typeorm'

/** Only the caller's rows. `request.user` is set by your auth guard. */
const ownRows: ODataScopeFn = (qb, ctx) => {
  const user = (ctx.request as { user?: { id: string } }).user
  if (!user) {
    qb.andWhere('1 = 0') // no user, no rows
    return
  }
  qb.andWhere(`${ctx.alias}.ownerId = :userId`, { userId: user.id })
}

@Module({
  imports: [
    ODataTypeOrmModule.forFeature(
      [
        { entity: Project, scope: ownRows },
        { entity: Task }, // gets defaultScope
        { entity: Comment, scope: CommentScope }, // injectable class, see below
      ],
      { defaultScope: ownRows, imports: [AccessModule] },
    ),
  ],
})
export class ProjectsModule {}
```

A scope is a function or an injectable class:

```typescript
type ODataScopeFn = (
  qb: SelectQueryBuilder<ObjectLiteral>,
  ctx: ODataScopeContext,
) => void | Promise<void>

interface ODataScope {
  apply(qb: SelectQueryBuilder<ObjectLiteral>, ctx: ODataScopeContext): void | Promise<void>
}
```

A class scope is registered as a provider of the feature module, so it can inject services. List
the modules that export them in the `imports` option:

```typescript
@Injectable()
export class CommentScope implements ODataScope {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  async apply(qb: SelectQueryBuilder<ObjectLiteral>, ctx: ODataScopeContext) {
    const projectIds = await this.access.projectIdsOf(ctx.request)
    qb.andWhere(`${ctx.alias}.projectId IN (:...projectIds)`, { projectIds })
  }
}
```

Scopes are shared by the whole application: when `Projects` expands into `Tasks`, the `Tasks`
scope applies even if `Tasks` was registered in another `forFeature()` call. An entity set can
have only one scope. Registering two different ones throws at startup.

## The scope context

```typescript
interface ODataScopeContext {
  entitySetName: string // the entity set being scoped (the target, for $expand and lambdas)
  entityType: EdmEntityType
  metadata: EntityMetadata // TypeORM metadata of its entity
  alias: string // alias of the entity in `qb`
  operation: 'collection' | 'count' | 'entity' | 'expand' | 'filter' | 'write'
  navigationPath: readonly string[] // [] for the root, ['tasks', 'notes'] for $expand=tasks($expand=notes)
  executionContext: ExecutionContext | undefined
  request: unknown // the Express/Fastify request
}
```

`executionContext` and `request` come from the route being handled. `ODataModule.forRoot()`
registers a global interceptor, `ODataRequestContextInterceptor`, that keeps them for the whole
request. It runs after guards, so `request.user` is already set. In `$batch` they are the
context and request of the `$batch` call. Outside an HTTP request (a queue worker calling
`TypeOrmAutoHandler`), provide them yourself:

```typescript
import { runWithODataRequestContext } from '@nestjs-odata/core'

await runWithODataRequestContext({ request: { user } }, () =>
  handler.handleGet(query, '/odata/Projects'),
)
```

## How a scope is applied

The scope receives its own query: `SELECT <primary key> FROM <table> AS <ctx.alias>`. It adds
conditions and joins to that query, and the library uses the result as
`<primary key> IN (<scope query>)`:

- in the `WHERE` of the root query,
- in the `JOIN ... ON` of each `$expand`, so it limits the related rows and never removes
  parents,
- inside the `EXISTS` subquery of each lambda,
- in the lookup that runs before an update, replace or delete.

Some consequences:

- **The scope can't break the rest of the query.** `where`, `orWhere` and `Brackets` affect only
  the scope's own query. Don't change its selection (`select`/`addSelect`).
- **Parameter names don't collide.** Each scope's parameters are renamed with a unique prefix, so
  every scope can use `:userId`.
- **Scopes can be async**, for example to load what the caller can access. They run before the
  OData query is built, concurrently, and **once per entity set and operation** for a request:
  an entity set reached through several `$expand` paths reuses one result. `ctx.navigationPath`
  is the first path the entity set was reached through, so treat it as informational and don't
  make the scope's result depend on it.
- **Writes are checked and done in one transaction.** For a scoped entity set, `PATCH`, `PUT`
  and `DELETE` look the row up through the scope and write it in the same transaction. On
  drivers with row locks (PostgreSQL, MySQL/MariaDB, SQL Server, Oracle and others) the row is
  locked (`SELECT ... FOR UPDATE`), so it can't leave the scope between the check and the write.
  `$batch` writes outside a changeset get their own transaction. Inside a changeset, the
  changeset's transaction is used.
- **Scoped by-key reads load eager relations,** like `Repository.findOne()`.
- **Rows outside the scope look absent.** By-key reads and writes return 404, not 403, so their
  existence doesn't leak.

## Failing closed: `requireScope`

```typescript
ODataModule.forRoot({ serviceRoot: '/odata', requireScope: true })
```

With `requireScope: true`:

- **any path without a prepared scope fails** instead of running unscoped (for example a plan
  built by hand that misses an `$expand` or lambda path);
- the application **refuses to start** when an entity set registered with
  `ODataTypeOrmModule.forFeature()` has neither a `scope` nor a `defaultScope`;
- at request time, reading or writing an entity set without a scope, or following `$expand` or a
  lambda to an entity type that is not an OData entity set, fails with HTTP 500 and a message
  naming the entity set;
- `TypeOrmQueryTranslator.translate()` throws if it is called without a scope plan (see below).

## Custom controllers

`TypeOrmAutoHandler` applies scopes for you. A controller that builds its own queries with
`TypeOrmQueryTranslator` resolves the plan with `TypeOrmScopeService` and passes it to
`translate()`:

```typescript
const plan = await this.scopes.prepare(query, 'collection')
const { qb } = this.translator.translate(query, entityType, repo, plan)
```

`TypeOrmScopeService` also has `findOne(entitySetName, where, operation)` for scoped lookups by key
and `subqueryFor(...)` together with `applyScopeToQuery(qb, alias, subquery)` for your own query
builders.

## Limits

- A key in a `PATCH` body is ignored (OData §11.4.3), so it can't redirect the write to another
  row. `PUT` refuses a body key that differs from the URL key (400).
- Scopes restrict reads and the existence check before writes. They do **not** check the data of
  a write: a `POST`, or a `PATCH` that changes the scoped column, can still create or move a row
  outside the caller's scope. Validate writes in your controller, or route them through your own
  code.
- `$batch` collection GETs ignore query options (an existing `$batch` limitation). They are still
  scoped.
