# Doc Coverage — Source-to-Doc Mapping

This file maps source file patterns to affected documentation files.
Used by the doc-guardian skill (see SKILL.md) to determine which docs need updating after a code change.

## Core Package (`packages/core/src/`)

| Source Pattern                               | Affected Docs                                                                                   | What to Check                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `decorators/*.ts`                            | `docs/api/decorators.md`                                                                        | Decorator signatures, parameter tables, usage examples                                                       |
| `decorators/odata-controller.decorator.ts`   | `docs/api/decorators.md`, `docs/guide/getting-started.md`, `docs/examples/custom-controller.md` | `@ODataController` signature, `ODataControllerOptions` fields, controller setup example                      |
| `decorators/odata-get.decorator.ts`          | `docs/api/decorators.md`, `docs/guide/getting-started.md`                                       | `@ODataGet` signature, `ODataGetOptions` fields including `autoHandler`                                      |
| `decorators/odata-post.decorator.ts`         | `docs/api/decorators.md`                                                                        | `@ODataPost` signature and options                                                                           |
| `decorators/odata-patch.decorator.ts`        | `docs/api/decorators.md`                                                                        | `@ODataPatch` signature and options                                                                          |
| `decorators/odata-delete.decorator.ts`       | `docs/api/decorators.md`                                                                        | `@ODataDelete` signature and options                                                                         |
| `odata.module.ts`                            | `docs/api/module.md`, `docs/guide/configuration.md`                                             | `forRoot`, `forRootAsync`, `forFeature` signatures; injection tokens; module setup code                      |
| `interfaces/module-options.interface.ts`     | `docs/api/module.md`, `docs/guide/configuration.md`, `docs/guide/security.md`                   | `ODataModuleOptions` fields, defaults, types; security-related limits (`maxTop`, filter depth, expand depth) |
| `pipes/odata-query.pipe.ts`                  | `docs/guide/query-options.md`                                                                   | Query parameter parsing behavior, error format on invalid query                                              |
| `interceptors/odata-response.interceptor.ts` | `docs/guide/query-options.md`                                                                   | Response envelope format (`@odata.context`, `value`, `@odata.count`); annotation fields if added             |
| `filters/odata-exception.filter.ts`          | `docs/guide/security.md`                                                                        | OData error format (`error.code`, `error.message`, `error.innererror`)                                       |
| `batch/**`                                   | `docs/guide/batch.md`                                                                           | Batch request format, Content-Type header, response structure, Content-ID behavior                           |
| `index.ts`                                   | All API docs (`docs/api/decorators.md`, `docs/api/module.md`)                                   | Public exports — if a symbol is added or removed from the public API, update all API reference pages         |

## TypeORM Adapter (`packages/typeorm/src/`)

| Source Pattern                   | Affected Docs                                                   | What to Check                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `translator/filter-visitor.ts`   | `docs/guide/query-options.md`, `docs/guide/filter-functions.md` | Filter operators, comparison functions, lambda any/all, arithmetic operators, date/time functions, string functions — verify SQL mapping table is current |
| `translator/select-visitor.ts`   | `docs/guide/query-options.md`                                   | `$select` behavior, property name mapping, excluded/computed properties                                                                                   |
| `translator/orderby-visitor.ts`  | `docs/guide/query-options.md`                                   | `$orderby` behavior, multi-property sort, direction keywords                                                                                              |
| `translator/expand-visitor.ts`   | `docs/guide/expand.md`                                          | `$expand` behavior, nested expand, select within expand, depth limits                                                                                     |
| `auto-handler.ts`                | `docs/guide/crud.md`, `docs/examples/basic-crud.md`             | Auto-handler CRUD operations, `handleGet`/`handleCount`/`handlePost`/`handlePatch`/`handleDelete` signatures                                              |
| `deriver/typeorm-edm-deriver.ts` | `docs/guide/getting-started.md`                                 | EDM derivation from TypeORM entities, entity registration, metadata reflection behavior                                                                   |
| `index.ts`                       | `docs/api/module.md`                                            | Public exports from the adapter — `TypeOrmODataModule`, adapter-specific types                                                                            |

## Test App (`apps/test-app/src/`)

| Source Pattern    | Affected Docs                                                       | What to Check                                                                          |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `*.controller.ts` | `docs/examples/basic-crud.md`, `docs/examples/custom-controller.md` | Real usage patterns, controller setup, decorator combinations, mixed OData/REST routes |
| `*.module.ts`     | `docs/guide/getting-started.md`                                     | Module registration example, `forRoot`/`forFeature` wiring, entity registration        |

## Cross-Cutting Changes

| Change Type                                  | Affected Docs                                              | What to Check                                                                      |
| -------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| New decorator added                          | `docs/api/decorators.md` + relevant guide                  | Add to decorator table, document parameters, add usage example                     |
| New config option in `ODataModuleOptions`    | `docs/api/module.md`, `docs/guide/configuration.md`        | Add to options table with type, default, and description                           |
| New query option (`$search`, `$apply`, etc.) | `docs/guide/query-options.md` + dedicated guide if complex | Document syntax, supported expressions, SQL mapping, limitations                   |
| Security limit added (new `max*` option)     | `docs/guide/security.md`, `docs/guide/configuration.md`    | Document the limit name, default value, and how to override                        |
| Response format change                       | `docs/guide/query-options.md`                              | Update response envelope shape, add/remove fields from examples                    |
| New filter function                          | `docs/guide/filter-functions.md`                           | Add function to relevant section with syntax, parameters, SQL mapping, and example |
| Breaking change (renamed/removed)            | All docs that reference the old name                       | Update all references; add migration note explaining the rename and before/after   |
