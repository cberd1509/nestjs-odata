---
'@nestjs-odata/core': minor
'@nestjs-odata/typeorm': minor
---

Support NestJS 12 and TypeORM 1.

- Widen the peer dependencies to `@nestjs/common`, `@nestjs/core` and `@nestjs/typeorm` `^10 || ^11 || ^12`, and `typeorm` `^0.3.0 || ^1.0.0`.
- `@nestjs-odata/core` now declares `@nestjs/core` as a peer dependency; it already imported `Reflector` from it.
- `@nestjs-odata/typeorm` no longer deep-imports `@nestjs/typeorm/dist/...` in its published type declarations. `@nestjs/typeorm` 12 only exports its root entry, so that import did not resolve for consumers. The type is now exported as `EntityClassOrSchema`.
- `@nestjs-odata/typeorm` now requires `@nestjs-odata/core` `>=2.2.0` (the first core release with NestJS 12 peers).
- The workspace develops and tests on NestJS 12.3, `@nestjs/typeorm` 12.0 and TypeORM 1.1, so every existing suite (unit and e2e) runs on them.
- SQLite-based drivers other than `sqlite` (`better-sqlite3`, `sqljs`, `capacitor`, `expo`, …) now get the SQLite dialect for date (`year()`, …) and `indexof()` filters. Before, they fell back to ANSI SQL that SQLite cannot run.
- The query translator reads the driver type from `EntityManager.dataSource` instead of the deprecated `connection` alias.
- `EntityClassOrSchema` is derived from `TypeOrmModule.forFeature()`'s parameter type, so it always matches what `@nestjs/typeorm` accepts.
