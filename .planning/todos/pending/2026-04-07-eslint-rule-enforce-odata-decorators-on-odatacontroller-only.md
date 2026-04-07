---
created: 2026-04-07T21:28:32.593Z
title: ESLint rule enforce OData decorators on ODataController only
area: tooling
files:
  - packages/core/src/decorators/odata-get.decorator.ts
  - packages/core/src/decorators/odata-post.decorator.ts
  - packages/core/src/decorators/odata-patch.decorator.ts
  - packages/core/src/decorators/odata-delete.decorator.ts
  - packages/core/src/decorators/odata-get-by-key.decorator.ts
  - packages/core/src/decorators/odata-controller.decorator.ts
---

## Problem

Phase 4 established a clean separation: `@ODataController(Entity)` is the OData scope, and `@Controller()` is for non-OData routes. However, nothing prevents a developer from accidentally using `@ODataGet()`, `@ODataPost()`, `@ODataPatch()`, `@ODataDelete()`, or `@ODataGetByKey()` on a regular `@Controller()` class. This would produce confusing behavior — the interceptor and filter would apply but routing and entity context would be missing.

An ESLint rule should enforce that OData method decorators can only appear on classes decorated with `@ODataController`. Using them on a plain `@Controller` or undecorated class should be a lint error.

## Solution

Create a custom ESLint rule (e.g., `@nestjs-odata/no-odata-decorators-outside-controller`) that:

1. Detects class declarations with `@ODataGet`, `@ODataPost`, `@ODataPatch`, `@ODataDelete`, `@ODataGetByKey` method decorators
2. Checks if the class has an `@ODataController()` class decorator
3. Reports an error if OData method decorators are found without `@ODataController`
4. Add to the shared ESLint config in `packages/eslint-config/` (or equivalent)

This belongs in Phase 5 or as a standalone quality phase since it's tooling/DX, not core functionality.
