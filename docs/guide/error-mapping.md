# Error mapping

Every OData route answers errors in the OData v4 JSON format:

```json
{
  "error": {
    "code": "NotFound",
    "message": "Entity 'Products' with key '9' not found",
    "details": []
  }
}
```

By default, the library maps OData parse and validation errors to 400, an
`ODataNotImplementedError` (valid OData the service does not implement, such as `$root`) to 501
`NotImplemented`, an `HttpException` to its own status, an error carrying a numeric `status` or
`statusCode` (400–599, http-errors style) to that status, and anything else to a generic 500.
The message of any other 5xx error is replaced by `An unexpected error occurred.`, since it may
carry internal details; a 501's message only describes the unsupported part of the request and
is kept. The **`errorMapper`**
option lets you map any exception, including your application's own error types and errors
thrown by the database, to the OData error to send.

## Configuring

```typescript
import { ODataModule, type ODataErrorMapper } from '@nestjs-odata/core'
import { QueryFailedError } from 'typeorm'

const errorMapper: ODataErrorMapper = (err, ctx) => {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      code: err.code, // e.g. 'CLIENT_NOT_FOUND'
      message: err.publicMessage,
      target: err.field, // optional
      details: err.fieldErrors?.map((f) => ({ code: f.code, message: f.message, target: f.field })),
    }
  }
  if (err instanceof QueryFailedError && /unique/i.test(err.message)) {
    return { status: 409, code: 'Conflict', message: 'The record already exists' }
  }
  return undefined // default mapping
}

ODataModule.forRoot({ serviceRoot: '/odata', errorMapper })
```

To inject services into the mapper (a translator, a logger), build it in
`ODataModule.forRootAsync({ useFactory, inject })`.

## API

```typescript
type ODataErrorMapper = (
  exception: unknown,
  context: ODataErrorMapperContext,
) => ODataErrorMapping | undefined | null

interface ODataErrorMapping {
  status: number // 400–599
  code: string
  message: string
  target?: string
  details?: { code: string; message: string; target?: string }[]
  innererror?: Record<string, unknown>
  language?: string // RFC 5646 tag of `message`, sent as Content-Language
}

interface ODataErrorMapperContext {
  host?: ArgumentsHost // the failing route (a $batch operation's own route too)
  request?: unknown // the request (a $batch operation's own request)
  // Set for $batch errors: the failing operation, or { changeset: true } when a changeset
  // fails as a whole (for example its commit)
  batch?: { method?: string; url?: string; contentId?: string; changeset?: boolean }
}
```

The result is sent as `{ "error": { code, message, target?, details, innererror? } }` with HTTP
status `status`. `buildODataErrorResponse(exception, mapper?, context?, defaultLanguage?)` (which
returns `{ status, body, language }`), `httpStatusToODataCode(status)` and
`odataErrorBody(code, message, details?)` are exported, for custom routes that write errors
themselves.

An `HttpException` whose body is OData-shaped (`{ error: { message, details } }`) keeps its
message and, for a 4xx, its valid `details` under the default mapping.

## Content-Language

OData 4.01 Part 1 §9.4 requires the language of `message` in the `Content-Language` header.
Every error response of an OData route, and every `$batch` error part, carries it:

1. the mapping's `language`, when the `errorMapper` returned one;
2. else the `errorLanguage` module option;
3. else `en`, the language of the library's own messages.

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  errorLanguage: 'es-CO', // your exceptions' messages are in Spanish
  errorMapper: (err) =>
    err instanceof GermanPartnerError
      ? { status: 422, code: 'Partner', message: err.message, language: 'de' }
      : undefined,
})
```

Set `errorLanguage` only when the messages you throw are localized: it labels the library's own
(English) messages too. A `language` that is not a well-formed RFC 5646 tag makes the mapping
invalid (default mapping, with a warning), and an invalid `errorLanguage` fails at startup.

## Where it applies

- the `@ODataGet`, `@ODataGetByKey`, `@ODataPost`, `@ODataPatch`, `@ODataPut` and `@ODataDelete`
  routes, wherever they are declared (they carry `ODataExceptionFilter`; error responses are
  always `application/json`);
- `$metadata` and the service document;
- every failing operation of a `$batch` request. Operations run through their routes, so they
  are mapped by the route's `ODataExceptionFilter` like standalone requests, with
  `ctx.batch = { method, url, contentId }` added and `ctx.request` / `ctx.host` of the
  operation's own request (the `$batch` request is `getODataBatchPart()?.batchRequest`). The
  library's own operation errors (no route for the operation, a nested `$batch`, a target outside
  the `batch.entitySets` allow-list) and changeset-level failures (`ctx.batch.changeset`, for
  example a failed commit; `ctx.request` is then the `$batch` request) reach the mapper too. A
  failed changeset is answered with the failing operation's mapped error alone.

Unmapped errors that wrap another error (`new Error('…', { cause })`) are mapped by their
`cause` when it maps to a 4xx (an `HttpException`, an OData error, a `status`-carrying error);
otherwise they stay a generic 500.

`ODataExceptionFilter` is not global and not applied to whole classes. Other routes, including
plain Nest routes on an `@ODataController` class such as `@Get('$count')`, keep your
application's own filters (`app.useGlobalFilters()`, `APP_FILTER`) and Nest's error format. To
give one of them OData errors and the mapper, opt in per route or per class:

```typescript
import { UseFilters } from '@nestjs/common'
import { ODataExceptionFilter } from '@nestjs-odata/core'

@Get('$count')
@UseFilters(ODataExceptionFilter)
count() { /* ... */ }
```

Route-level filters win over global ones, so on the OData routes above your global filters do
not run: map your error types in `errorMapper` instead.

## Caveats

- The mapper's `message`, `details` and `innererror` go to the client **as is**. Don't include
  stack traces, SQL or secrets.
- The mapper must be **synchronous**. Its result is validated against OData JSON Format 4.01
  §21.1 and Part 1 §9.4: `status` an integer from 400 to 599, `code` and `message` non-empty
  strings, `target` a string or `null`, `details` an array of `{ code, message, target? }` with
  non-empty `code` and `message`, `innererror` an object. An invalid result, a mapper that throws
  and a mapper that returns a Promise all fall back to the default mapping, with a warning in
  the Nest logger (`ODataErrorMapper` context). A returned Promise's rejection is handled, never
  left unhandled.
- Errors of the `$batch` envelope itself (a missing boundary, a malformed body) are produced by
  the library and are not passed to the mapper.
