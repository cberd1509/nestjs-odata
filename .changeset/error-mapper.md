---
'@nestjs-odata/core': minor
'@nestjs-odata/typeorm': minor
---

Error-mapping hook.

- **`@nestjs-odata/core`:**
  - New `errorMapper` option on `ODataModule.forRoot()`/`forRootAsync()`: `(exception, ctx) => ODataErrorMapping | undefined`, synchronous. A mapping has `status`, `code`, `message`, and optionally `target`, `details` and `innererror`, and is sent in OData v4 JSON error format. Every field is validated. Returning `undefined` keeps the default mapping, and so do a mapper that throws, returns a Promise or returns an invalid mapping (logged as a warning).
  - It runs on the routes of the OData route decorators, `$metadata` and the service document. Plain Nest routes on an `@ODataController` keep the application's global filters and can opt in with `@UseFilters(ODataExceptionFilter)`.
  - The default mapping keeps the 4xx/5xx status of non-`HttpException` errors carrying a numeric `status`/`statusCode`, and never sends the message of a 5xx error (also for 5xx `HttpException`s, whose message was sent before).
  - Error responses always use `Content-Type: application/json`.
  - `HttpException`s with an OData-shaped body keep their message instead of "Http Exception", and 412 maps to `PreconditionFailed`.
  - New exports: `buildODataErrorResponse`, `httpStatusToODataCode`, `odataErrorBody` and the `ODataErrorMapper*` types.
- **`@nestjs-odata/typeorm`:** each failing `$batch` operation goes through the mapper, with `ctx.batch = { method, url, contentId }` and the `$batch` request. Its status and body become the part's response. A changeset that fails as a whole gets `ctx.batch = { changeset: true }`.
- OData conformance (JSON Format 4.01 §21.1): mapper results need non-empty `code` and `message` (also in `details`), and `target` may be `null`. The default `details` of parse and validation errors now carry `code` and `message` too (`QueryOption`, `AvailableProperties`); their `target` and `value` are unchanged.
- The library's own `$batch` part errors (404, missing key, 412, 405, …) also go through the mapper, and the mapper context's `request` comes from the OData request context. The default mapping follows an error's `cause` chain to a 4xx, over HTTP and in `$batch`.
