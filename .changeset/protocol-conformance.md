---
'@nestjs-odata/core': minor
'@nestjs-odata/typeorm': minor
---

OData 4.01 protocol conformance of writes, ETags, routing and errors (#63, #70, #71, #75, #76, #77, #78, #79, #80, #81).

**Behaviour changes** (spec-mandated, on by default):

- **Unknown properties in write bodies answer 400** (Part 1 §11.4.2: the service MUST fail when it cannot persist a value). POST, PATCH and PUT (HTTP and `$batch`, repository path) refuse a property that is not in the entity type, including columns hidden with `@ODataExclude` or `select: false`, with one `UnknownProperty` entry per property in `details`. They were silently ignored before (and hidden columns could be written). Escape hatch: `ignoreUnknownProperties: true` in `ODataModule.forRoot()` drops them instead (still never persisted). Bodies handed to write handlers are unchanged.
- **PUT ignores a body key that differs from the URL key** (§11.4.3) and replaces the entity at the URL, over HTTP and in `$batch`, instead of answering 400 "Key in body does not match URL key".
- **Computed properties are ignored on POST/PATCH** (§11.4.2): `@CreateDateColumn`, `@UpdateDateColumn`, `@VersionColumn` and generated non-key columns. `$metadata` annotates them with `Core.Computed` and now references the Core vocabulary (`edmx:Reference`) whenever an annotation is used.
- **`If-None-Match` on PATCH, PUT and DELETE** answers 412 with no change when it matches the current ETag; `*` matches any existing entity (§8.2.5). HTTP and `$batch`.
- **`If-Match` / `If-None-Match` are read from the request** by `TypeOrmAutoHandler` when the controller doesn't pass them, so controllers that never bound `@Headers('if-match')` now get 412 on a stale `If-Match`. An explicit `ifMatch` argument still wins.
- **`ETag` on rows without an ETag value**: an entity whose ETag column is absent from the row (e.g. not selected) gets no ETag instead of the ETag of `undefined`.

**Additions:**

- **Canonical entity URLs are routed** (URL Conventions §4.3.1): `GET/PATCH/PUT/DELETE /odata/Products(1)` and composite `/odata/OrderItems(orderId=1,productId=2)` reach the key routes, so `Location` and `@odata.id` (unchanged, canonical) are resolvable. `ODataModule` rewrites the URL to `/Set/key` before routing on the Express adapter, only for registered entity sets; `/Set/key` keeps working.
- **`Content-Language`** on every error response and `$batch` error part (§9.4): an `errorMapper` result's new `language`, else the new `errorLanguage` module option, else `en`. `buildODataErrorResponse()` returns `language` and takes an optional default language. Mappings with an invalid language tag fall back to the default mapping; an invalid `errorLanguage` fails at startup.
- **`Prefer: return=minimal`** (§8.2.8.7) on POST, PATCH and PUT answers 204 with `Preference-Applied` (POST: `Location` and `OData-EntityId`); `return=representation` is confirmed with `Preference-Applied`; `$select`/`$expand` imply representation. Also per `$batch` part (`$N` references to a 204 create keep working).
- **`requireIfMatch`** per `forFeature()` item: PATCH, PUT and DELETE without `If-Match` answer 428 with no change (HTTP, `$batch`, write handlers), and `$metadata` annotates the entity set with `Core.OptimisticConcurrency`. Write handlers get `ctx.requireIfMatch` and `ctx.ifNoneMatch`.
- **`@odata.etag` on each entity of a collection** for entity sets with an ETag (JSON §4.5.10).
- **304 Not Modified no longer logs "Cannot set headers after they are sent"**: the interceptor signals an empty response that `ODataExceptionFilter` sends (also used for 204).
- **Express `etag` warning**: a startup warning while Express's `etag` setting is on (its hash ETags on errors, collections and `$metadata` are not OData ETags). The library doesn't change the setting; docs recommend `app.set('etag', false)`.
- The default error mapping keeps valid `details` of 4xx `HttpException`s with an OData-shaped body, and maps 428 to `PreconditionRequired`.
- New exports: core `resolveReturnPreference`, `rewriteCanonicalKeyUrl`, `isLanguageTag`, `DEFAULT_ERROR_LANGUAGE`, `EdmProperty.computed`, `EdmEntitySet.optimisticConcurrency`; typeorm `prepareWriteBody`.
