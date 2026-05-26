# docs

## 0.1.0

### Minor Changes

- [#35](https://github.com/cberd1509/nestjs-odata/pull/35) [`d204ea2`](https://github.com/cberd1509/nestjs-odata/commit/d204ea2ef65128a3dc9d7ea6675542e64ffeeaba) Thanks [@cberd1509](https://github.com/cberd1509)! - Dependency bumps to the latest safe versions, plus a focused round of fixes
  and DX improvements surfaced by a real-world multi-entity integration.

  ### Bug fixes
  - **`@nestjs-odata/typeorm`**: `TypeOrmAutoHandler` no longer mis-routes
    requests to the first-registered entity when `forFeature([A, B, ...])` is
    called with multiple entities. The handler now resolves the correct
    `Repository` per request from the entity-set name via `DataSource` +
    `EdmRegistry`. `TypeOrmQueryTranslator.translate()` accepts an optional
    per-request repo override (backwards compatible for single-entity callers).
    Eliminates the downstream "column does not exist" 500 that hit any filter
    referencing a column unique to the second-registered entity.

  ### New features / DX improvements
  - **`@nestjs-odata/typeorm`**: `ODataTypeOrmModule.forFeature()` now accepts a
    mixed array of entity classes and `{ entity, name }` config objects so you
    can override the OData entity-set name without touching the entity class.
    Avoids the `/odata/UserEntities` ugliness that comes from the `Entity`
    suffix convention — pass `{ entity: UserEntity, name: 'Users' }` to expose
    `/odata/Users` instead. Override wins over `@ODataEntitySet` decorator and
    default pluralization.
  - **`@nestjs-odata/typeorm`**: `forFeature()` accepts a new
    `options.controllers` array. When provided, controllers are both
    PATH_METADATA-patched with `serviceRoot` AND registered in the dynamic
    module — eliminating the "declare in two places" papercut (`ODataModule
.forRoot({controllers})` + `@Module({controllers})`). Single declaration
    in `forFeature` is now sufficient for DI resolution.
  - **`@nestjs-odata/typeorm`**: `@odata.nextLink` is now built from `serviceRoot
    - entitySetName`(not`req.originalUrl`), so it's prefix-consistent with
    `@odata.context`and`@odata.id`. OData v4 clients (Excel, Olingo,
    odata2ts) can now navigate paginated responses when the app is mounted
    under a Nest `setGlobalPrefix`.
  - **`@nestjs-odata/core`**: New `ODataModule.globalPrefixExclude(serviceRoot?)`
    static helper returning the Express 5 splat-style exclude patterns for
    `app.setGlobalPrefix()`. Replaces hand-crafted `'api/odata{/*splat}'`
    snippets — call `app.setGlobalPrefix('api', { exclude: ODataModule
.globalPrefixExclude() })`.

  ### Tests
  - New e2e regression suite `apps/test-app/test/multi-entity-disambiguation
.e2e-spec.ts` (16 tests) covering: multi-entity routing for list /
    get-by-key / $count / POST / PATCH / DELETE / multi-word `$filter`literal /
entity registration-order swap, the`{ entity, name }`override, the
single-declaration`forFeature({ controllers })`pattern, the prefix-
consistent`@odata.nextLink`, and the `globalPrefixExclude` helper.

  ### Docs
  - `docs/guide/getting-started.md`: new sections on multi-entity registration
    - custom set names, and `setGlobalPrefix()` integration.
  - `docs/guide/configuration.md`: documents the `{ entity, name }` form, the
    `controllers` option on `forFeature`, and the global-prefix workflow.
  - `docs/api/module.md`: full reference for `ODataModule.globalPrefixExclude()`
    and the expanded `ODataTypeOrmModule.forFeature()` signature including
    the new `ODataTypeOrmFeatureItem` type.
  - `docs/guide/troubleshooting.md`: three new entries for the common gotchas
    (double-prefixed routes, ugly `Entities` URL suffix, multi-entity wrong-
    row symptom).

  ### Backwards compatibility

  All changes are additive. Existing `forFeature([Product, Order])` calls and
  `forRoot({ controllers })` + `@Module({ controllers })` setups continue to
  work unchanged. The test-app's existing 197 e2e tests pass without
  modification.
