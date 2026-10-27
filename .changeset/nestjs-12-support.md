---
'@nestjs-odata/core': minor
'@nestjs-odata/typeorm': minor
---

Support NestJS 12 and TypeORM 1.

- Widen the peer dependencies to `@nestjs/common`, `@nestjs/core` and `@nestjs/typeorm` `^10 || ^11 || ^12`, and `typeorm` `^0.3.0 || ^1.0.0`.
- `@nestjs-odata/core` now declares `@nestjs/core` as a peer dependency; it already imported `Reflector` from it.
- `@nestjs-odata/typeorm` no longer deep-imports `@nestjs/typeorm/dist/...` in its published type declarations. `@nestjs/typeorm` 12 only exports its root entry, so that import did not resolve for consumers. The type is now exported as `EntityClassOrSchema`.
- A consumer smoke test (`pnpm smoke:nest12`, run in CI) installs the packed packages into an ESM (`"type": "module"`, NodeNext) NestJS 12 + TypeORM 1 app and exercises `$metadata`, `$filter`, `$expand`, `$count`, by-key reads and creates.
