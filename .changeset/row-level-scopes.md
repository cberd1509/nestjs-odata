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
