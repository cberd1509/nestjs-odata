---
'@nestjs-odata/core': minor
'@nestjs-odata/typeorm': minor
---

Row-level scopes.

- **`@nestjs-odata/typeorm`:** `ODataTypeOrmModule.forFeature()` items accept a `scope`, and the options accept `defaultScope` and `imports`. A scope is `(qb, ctx) => void | Promise<void>` or an injectable `ODataScope` class. `ctx` carries the entity set, the EDM type, the TypeORM metadata, the alias, the operation, the navigation path, the Nest `ExecutionContext` and the request. The scope restricts collection reads, `$count`, `$apply`, by-key reads, every `$expand` path (in the JOIN condition, at any depth), lambdas (`any`/`all`) in `$filter`, `$batch`, and the existence checks of `PATCH`/`PUT`/`DELETE` in `TypeOrmAutoHandler` and `$batch`. New `TypeOrmScopeService` for custom controllers; `TypeOrmQueryTranslator.translate()` takes an optional scope plan.
- **`@nestjs-odata/core`:** new `requireScope` option fails closed: the app refuses to start while an entity set has no scope, and requests that reach one fail. New `getODataRequestContext()` / `runWithODataRequestContext()` and a global `ODataRequestContextInterceptor`, registered by `forRoot()`, that exposes the current `ExecutionContext` and request to hooks.
- **Fixes:**
  - Nested query options inside `$expand(...)` are applied. They were ignored, because the target type was looked up by its qualified name.
  - A nested `$filter` now restricts the expanded rows (in the JOIN), not the parent rows.
  - A nested `$select` no longer replaces the root selection.
  - Lambda predicates such as `items/any(i: i/quantity gt 1)` work: the pipe validates `i/quantity` against the collection's entity type, and the translator maps it to the lambda alias.
- **Hardening:**
  - Options inside `$expand(...)` are validated against the related type; unknown or excluded properties give 400 instead of 500.
  - TypeORM `select: false` columns are excluded from the EDM, like `@ODataExclude`.
  - A `PATCH` body whose key differs from the URL key is refused with 400, over HTTP and in `$batch`, as `PUT` already was.
  - Scoped writes run the scope check and the write in one transaction, with a row lock where the driver supports it.
  - Scoped by-key reads load eager relations.
  - Each scope runs once per entity set and operation for a request.
  - Under `requireScope`, a missing `$expand` or lambda lookup fails.
  - Inside a lambda, properties without the range variable refer to the outer entity, and predicates can use `and`, `or` and `not`.
- **`@nestjs-odata/typeorm` peers:** `@nestjs-odata/core >=2.2.0` (the core release with request context and `requireScope`) and `@nestjs/core`.
- **`navigationTargetTypeName`:** now exported from `@nestjs-odata/core`.
- **`@nestjs-odata/core`:** new `EdmRegistry.getEntitySetByTypeName()`.
