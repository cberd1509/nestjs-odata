---
slug: odata-batch-conformance
date: 2026-10-27
branch: fix/odata-batch-conformance
issues: [64, 65, 67, 73]
---

# OData 4.01 `$batch` conformance: routing, changesets, query options, one endpoint

Fix #64, #65, #67, #73 in one branch on top of main (#84, #85 merged). Spec behaviour by default;
behaviour changes in the changeset. #67 is a security fix.

## Design (#67)

Dispatch each operation in process through the platform's request handler (Express app with a
real `IncomingMessage`/`ServerResponse` pair; Fastify `inject()`), so guards, interceptors,
pipes, filters run as for the standalone request (#65 follows). Changesets: one transaction per
changeset, its `EntityManager` propagated via `AsyncLocalStorage`
(`getODataChangesetManager()`), picked up by `TypeOrmAutoHandler`, scopes and write handlers.
`$<Content-ID>` resolved before dispatch from the operation responses' `Location`.

## Tasks (TDD: unit + e2e first)

1. Core: `batch-dispatch.ts` (in-process dispatch, header inheritance, URL resolution,
   `getODataBatchPart()`); exception filter adds `batch` to the mapper context.
2. Core types: `BatchChangesetResponse`; typeorm builder nests successful changesets.
3. TypeORM: changeset ALS; auto-handler, scope service, write context use it.
4. TypeORM: BatchController rewrite (route dispatch, single error part for a failed changeset,
   `batch.enabled` / `batch.entitySets`), static `ODataBatchModule` imported by every
   `forFeature()` (#73).
5. E2E `batch-conformance.e2e-spec.ts` (two feature modules, guards, interceptors, pipes,
   query options, scopes, changesets, options); update existing batch expectations.
6. Docs (batch, security, configuration, error-mapping, write-handlers, row-level-scopes,
   troubleshooting, API pages, README, e-commerce example) + changeset.
