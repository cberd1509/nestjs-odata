# Phase 10: Advanced Write Operations - Research

**Researched:** 2026-04-08
**Domain:** OData v4 write semantics — PUT full replacement, deep insert, Content-ID batch references
**Confidence:** HIGH

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** PUT strict OData spec compliance. PUT replaces ALL properties — unspecified fields reset to column defaults (NULL for nullable, default value otherwise). Navigation properties in the body are ignored per OData spec. Reject if key in URL doesn't match body key. If-Match required when ETag is enabled.
- **D-02:** Deep insert: Recursive nesting with configurable depth limit (`maxDeepInsertDepth`, default 5). Use TypeORM transactions — if any entity fails validation, everything rolls back. One recursive implementation serves all use cases.
- **D-03:** Content-ID resolution in `batch-controller.ts` during changeset execution. After each operation, store created entity's key in a `contentIdMap`. Before next operation, scan URL and body for `$N` patterns and substitute with the resolved key.

### Claude's Discretion

- Whether PUT needs a new `@ODataPut()` decorator or reuses `@ODataPatch()` with a flag
- Deep insert error message format (which nested entity failed, at what depth)
- Content-ID pattern matching regex (`$` followed by digits)
- Whether Content-ID resolution also applies to request bodies (not just URLs)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                                    | Research Support                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WRITE-01 | PUT replaces entire entity (all unspecified fields reset to defaults)                                                          | TypeORM has no built-in replace — needs custom `handleReplace()` using `dataSource.getMetadata()` to build default-reset entity; see PUT Semantics section                            |
| WRITE-02 | Deep insert — POST with nested navigation properties creates related entities atomically                                       | Requires manual recursive save within a single QueryRunner transaction; cascade: true NOT configured on test entities so cannot rely on TypeORM auto-cascade; see Deep Insert section |
| WRITE-03 | Content-ID reference resolution in `$batch` — `$1` in URLs substitutes the created entity key from a prior changeset operation | Parser already extracts Content-ID header; resolution hooks into `executeChangeset()` loop with a `contentIdMap`; see Content-ID section                                              |

</phase_requirements>

## Summary

Phase 10 implements three write operations: PUT full entity replacement (WRITE-01), deep insert via recursive POST with nested navigation properties (WRITE-02), and Content-ID reference substitution in `$batch` changesets (WRITE-03).

All three build on existing infrastructure: `TypeOrmAutoHandler` already has `handleCreate`, `handleUpdate`, and `handleDelete`; `BatchController.executeChangeset()` already owns the changeset transaction loop; the OData decorator pattern (`@ODataPatch`, `@ODataPost`) is well-established. No new subsystems are needed — these are targeted extensions to proven code paths.

The most complex aspect is PUT full replacement: TypeORM provides no `replace()` or `upsert-with-defaults` API. The implementation must use `dataSource.getMetadata()` to read column default values and nullability, build a complete entity from scratch using those defaults, overlay only the body-supplied values, and call `save()`. This is the only way to guarantee that unspecified fields are reset rather than preserved.

Deep insert is conceptually straightforward (recursive save within a transaction) but requires care around entities that do NOT have TypeORM `cascade: true` — which is the case for the existing `Order`/`OrderItem` test entities. The implementation must save parent first, inject the generated foreign key, then save children — all within a single `QueryRunner` transaction.

**Primary recommendation:** Implement `handleReplace()` using metadata-driven default construction; implement `insertDeep()` as a recursive function receiving depth counter and transaction manager; add Content-ID tracking as a `contentIdMap` mutated inside the existing `executeChangeset()` loop.

---

## Standard Stack

### Core — already in use, no additions needed

| Library | Version | Purpose                             | Notes                            |
| ------- | ------- | ----------------------------------- | -------------------------------- |
| TypeORM | ^0.3.28 | ORM for all write operations        | [VERIFIED: package.json in repo] |
| NestJS  | ^11.x   | Controller/decorator infrastructure | [VERIFIED: package.json in repo] |

### TypeORM APIs used by this phase

| API                                             | Method             | Purpose                                                  |
| ----------------------------------------------- | ------------------ | -------------------------------------------------------- |
| `DataSource.getMetadata(cls)`                   | `EntityMetadata`   | Read column defaults and nullability for PUT reset logic |
| `EntityMetadata.columns`                        | `ColumnMetadata[]` | Iterate over all columns with `.default`, `.isNullable`  |
| `Repository.save(entity)`                       | mutate             | Save parent entity; returns entity with generated key    |
| `QueryRunner.manager.save(EntityClass, entity)` | mutate within txn  | Deep insert child entities in existing transaction       |
| `QueryRunner.manager.getRepository(cls)`        |                    | Get repo scoped to the changeset transaction             |

### No new packages required

All implementation is TypeORM + NestJS already in the project. [VERIFIED: codebase scan]

---

## Architecture Patterns

### Pattern 1: PUT Full Replacement via Metadata-Driven Default Construction

**What:** TypeORM has no `replace()` method. `preload()` preserves existing values — wrong for PUT. `save()` skips undefined properties — also wrong. The only correct approach is:

1. Load the existing entity (to confirm it exists; throw 404 otherwise).
2. Use `dataSource.getMetadata(entityClass)` to iterate all columns.
3. Build a new plain object: for each column, use the body value if present, else `column.default` if defined, else `null` if nullable, else leave absent (TypeORM will use DB default on write).
4. Call `repo.save()` with the constructed object including the primary key from the URL.
5. Reject if the body contains a key that differs from the URL key (per D-01 spec compliance).

```typescript
// Source: TypeORM EntityMetadata API [ASSUMED — based on pattern used in TypeOrmETagProvider]
async handleReplace(
  keyStr: string,
  body: Record<string, unknown>,
  entitySetName: string,
  ifMatchHeader?: string,
): Promise<unknown> {
  const entityType = this.resolveEntityType(entitySetName)
  const where = parseODataKey(keyStr, entityType.keyProperties)

  // 1. Confirm entity exists
  const existing = await this.repo.findOne({ where })
  if (!existing) throw new NotFoundException(...)

  // 2. ETag If-Match enforcement (same as handleUpdate)
  // ... (identical to handleUpdate ETag block)

  // 3. Validate key in body matches URL key (D-01 spec compliance)
  for (const kp of entityType.keyProperties) {
    if (body[kp] !== undefined && body[kp] !== (where as Record<string,unknown>)[kp]) {
      throw new HttpException({ error: { code: '400', message: 'Key in body does not match URL key' } }, 400)
    }
  }

  // 4. Build full replacement entity using column metadata
  const meta = this.dataSource.getMetadata(this.repo.target)
  const replacement: Record<string, unknown> = { ...where } // inject key values
  for (const col of meta.columns) {
    if (col.isPrimary) continue          // key already set
    if (col.isCreateDate || col.isUpdateDate) continue  // managed by TypeORM
    const propName = col.propertyName
    if (body[propName] !== undefined) {
      replacement[propName] = body[propName]  // use body value
    } else if (col.default !== undefined) {
      replacement[propName] = col.default     // reset to column default
    } else if (col.isNullable) {
      replacement[propName] = null            // reset to null
    }
    // else: leave absent — TypeORM will use DB-level default on save
  }

  const entity = this.repo.create(replacement as ObjectLiteral)
  return this.repo.save(entity)
}
```

**Anti-pattern avoided:** Using `preload()` for PUT — it loads existing values and only overwrites what's in the body, so fields not in the body keep their old values. This violates OData PUT semantics.

### Pattern 2: Decorator Pattern — @ODataPut

Based on CONTEXT.md discretion and the existing decorator pattern, a new `@ODataPut` decorator is the right call. Reusing `@ODataPatch` with a flag would couple two distinct operations and complicate the route metadata. The decorator mirrors `@ODataPatch` exactly except it uses NestJS `Put()` instead of `Patch()` and sets `operation: 'replace'` in ODATA_ROUTE_KEY metadata.

```typescript
// Pattern: mirrors odata-patch.decorator.ts exactly
// Source: packages/core/src/decorators/odata-patch.decorator.ts [VERIFIED]
export function ODataPut(entitySetName: string, options?: { path?: string }): MethodDecorator {
  return applyDecorators(
    Put(options?.path ?? ':key'),
    SetMetadata(ODATA_ROUTE_KEY, {
      entitySetName,
      operation: 'replace', // <-- new operation identifier
      isSingleEntity: true,
    }),
    UseInterceptors(ODataResponseInterceptor),
    UseFilters(ODataExceptionFilter),
  )
}
```

The `ODataResponseInterceptor` and `ODataExceptionFilter` are reused unchanged — PUT returns 200 with the replaced entity body just like PATCH. [VERIFIED: existing interceptor handles isSingleEntity correctly]

### Pattern 3: Deep Insert — Recursive Save in Single Transaction

**What:** When a POST body contains a navigation property key (e.g., `"items": [...]`), resolve the navigation property's target entity type from `EdmRegistry`, save child entities within the same transaction after the parent has been saved (so the generated FK is available).

**Critical constraint:** The existing `Order.items` relation has NO `cascade: true`. This means `repo.save()` will silently ignore nested `items` in the body. The deep insert implementation must handle nesting manually. [VERIFIED: order.entity.ts and order-item.entity.ts read directly]

```typescript
// Recursive deep insert — runs within an existing QueryRunner transaction
async insertDeep(
  body: Record<string, unknown>,
  entitySetName: string,
  manager: EntityManager,    // transaction-scoped
  depth: number,
  maxDepth: number,
): Promise<{ entity: unknown; locationUrl: string }> {
  if (depth > maxDepth) {
    throw new HttpException({ error: { code: '400', message: `Deep insert exceeds maxDeepInsertDepth (${maxDepth})` } }, 400)
  }

  const entityType = this.resolveEntityType(entitySetName)

  // Separate scalar properties from navigation properties
  const scalarBody: Record<string, unknown> = {}
  const nestedByNavProp: Record<string, unknown[]> = {}

  for (const [key, val] of Object.entries(body)) {
    const navProp = entityType.navigationProperties.find(p => p.name === key)
    if (navProp) {
      // Collect nested entities for later
      nestedByNavProp[key] = Array.isArray(val) ? val : [val]
    } else {
      scalarBody[key] = val
    }
  }

  // Save parent (scalar fields only)
  const repo = manager.getRepository(entityClass)
  const parent = repo.create(scalarBody as ObjectLiteral)
  const savedParent = await manager.save(entityClass, parent) as Record<string, unknown>

  // Recursively save nested entities
  for (const [navPropName, children] of Object.entries(nestedByNavProp)) {
    const navProp = entityType.navigationProperties.find(p => p.name === navPropName)!
    // navProp.type = "Default.OrderItem" — strip namespace to get entity type name
    const childTypeName = navProp.type.includes('.') ? navProp.type.split('.').pop()! : navProp.type
    const childEntitySet = this.findEntitySetForType(childTypeName)

    for (const child of children as Record<string, unknown>[]) {
      // Inject FK: resolve FK column name from TypeORM metadata
      const fkColumn = this.resolveForeignKey(entityClass, navPropName)
      const childWithFk = { ...child, [fkColumn]: savedParent[entityType.keyProperties[0]] }
      await this.insertDeep(childWithFk, childEntitySet, manager, depth + 1, maxDepth)
    }
  }

  // Build Location URL (same as handleCreate)
  const keyStr = this.buildKeyStr(savedParent, entityType)
  return { entity: savedParent, locationUrl: `${this.options.serviceRoot}/${entitySetName}(${keyStr})` }
}
```

**Error message format (discretion):** Wrap errors in a message that includes the navigation property path: `"Deep insert failed at 'items[0]': <original error>"`. This lets callers identify which nested entity triggered the failure.

### Pattern 4: Content-ID Resolution in executeChangeset()

**What:** After each `dispatchWithManager()` call in the changeset loop, extract the created entity's key from the `Location` header of a 201 response and store it in a `contentIdMap`. Before dispatching the next operation, scan its URL and body string for `$<N>` patterns and substitute the resolved URL.

**Spec-compliant format (from Apache Olingo tutorial):** [CITED: olingo.apache.org/doc/odata4/tutorials/batch/tutorial_batch.html]

- Content-ID header value: a numeric string (e.g., `1`, `2`) — already extracted by `batch-parser.ts` into `part.contentId`
- Reference in URLs: `$1` (dollar sign + the Content-ID value) — used as a URL segment, e.g., `PATCH $1/Items HTTP/1.1` or `PATCH $1 HTTP/1.1`
- Resolution: `$1` substitutes the full resource URL from the Location header of the referenced operation

**Pattern also applies to request bodies** (per D-03 discretion): after URL substitution, scan the raw body string for `$N` patterns too, so that inline references in body JSON work.

```typescript
// Inside executeChangeset() — additive change to existing method
private async executeChangeset(parts: readonly BatchRequestPart[]): Promise<BatchResponsePart[]> {
  const queryRunner = this.dataSource.createQueryRunner()
  await queryRunner.connect()
  await queryRunner.startTransaction()

  // NEW: map from Content-ID string -> resolved resource URL (Location header value)
  const contentIdMap = new Map<string, string>()

  try {
    const results: BatchResponsePart[] = []

    for (const part of parts) {
      // NEW: resolve any $N references in this part before dispatching
      const resolvedPart = this.resolveContentIdReferences(part, contentIdMap)

      const result = await this.dispatchWithManager(resolvedPart, queryRunner.manager)
      results.push(result)

      // NEW: after successful 201, register the Location URL for this Content-ID
      if (result.statusCode === 201 && result.headers['location'] && part.contentId) {
        contentIdMap.set(part.contentId, result.headers['location'])
      }

      if (result.statusCode >= 400) {
        throw new ChangesetOperationError(result.statusCode, result.body ?? 'Operation failed')
      }
    }

    await queryRunner.commitTransaction()
    return results
  } catch (err) {
    // ... existing rollback logic unchanged
  } finally {
    await queryRunner.release()
  }
}

// NEW: helper — pure function, easy to unit test
private resolveContentIdReferences(
  part: BatchRequestPart,
  contentIdMap: Map<string, string>,
): BatchRequestPart {
  if (contentIdMap.size === 0) return part  // fast path

  let url = part.url
  let body = part.body

  // Replace $<N> patterns with resolved URL
  // Regex: dollar sign followed by one or more digits, word boundary
  for (const [id, resolvedUrl] of contentIdMap) {
    const pattern = new RegExp(`\\$${id}(?=\\b|/)`, 'g')
    url = url.replace(pattern, resolvedUrl)
    if (body) {
      body = body.replace(pattern, resolvedUrl)
    }
  }

  return url === part.url && body === part.body ? part : { ...part, url, body }
}
```

**Regex design (discretion):** `\$<N>` followed by word boundary or slash. This covers:

- `$1` used as a standalone URL segment (maps to full resource URL)
- `$1/RelatedSet` used to navigate from the created resource
- `"$1"` embedded in JSON body strings

### Anti-Patterns to Avoid

- **Using `repo.preload()` for PUT:** Preload merges with existing values — unspecified fields keep old values, violating PUT semantics. [VERIFIED: TypeORM documentation confirms this]
- **Relying on TypeORM cascade for deep insert without verifying cascade config:** The existing `Order.items` has no `cascade: true`. Passing nested children to `save()` on the parent would silently ignore them. Always iterate and save children explicitly. [VERIFIED: order.entity.ts read directly]
- **Mutating `BatchRequestPart` in place:** The interface uses `readonly` fields. The Content-ID resolver must return a new object. [VERIFIED: batch-types.ts]
- **Putting Content-ID resolution in `batch-parser.ts`:** Content-ID values are only known at execution time (after a prior operation's response is available). The parser only has static structure — it cannot resolve dynamic references.
- **Scanning body for `$N` references using a naive string replace:** If the resolved URL itself contains a digit sequence that matches `$N`, subsequent replacements could corrupt it. Process each `contentIdMap` entry once in order and use regex with anchoring.

---

## Don't Hand-Roll

| Problem                                     | Don't Build                        | Use Instead                                                                                    | Why                                                                              |
| ------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Column default values for PUT reset         | Custom decorator / manual defaults | `dataSource.getMetadata(cls).columns` — each `ColumnMetadata` has `.default` and `.isNullable` | TypeORM already introspects all column metadata from entity decorators           |
| FK column name for deep insert              | Parse property name heuristics     | `dataSource.getMetadata(childClass).foreignKeys` — maps relation name to FK column             | TypeORM's EntityMetadata.foreignKeys contains exact FK column names per relation |
| Multipart body parsing for batch Content-ID | Custom regex                       | Already implemented in `batch-parser.ts` — `part.contentId` is already extracted               | Parser already handles `Content-ID: <value>` header stripping angle brackets     |
| Transaction management for deep insert      | Manual BEGIN/COMMIT SQL            | `QueryRunner` already used by `executeChangeset()` — pass the same `manager` recursively       | Reuse the changeset's existing transaction scope                                 |
| ETag If-Match for PUT                       | Custom ETag comparison             | `IETagProvider.validateIfMatch()` — already implemented and injected as `this.etagProvider`    | Identical to `handleUpdate()` ETag block — copy the block verbatim               |

**Key insight:** Deep insert and Content-ID are framework-level concerns (transaction coordination, URL resolution). The value of this phase comes from correct OData protocol semantics, not algorithmic complexity.

---

## Runtime State Inventory

Not applicable — greenfield feature additions with no rename/migration concerns.

---

## Common Pitfalls

### Pitfall 1: TypeORM `save()` Skipping Undefined vs Null

**What goes wrong:** When building the replacement entity for PUT, leaving a field as `undefined` is different from setting it to `null`. TypeORM's `save()` skips `undefined` properties (uses DB default), but sets `null` explicitly. If a field is absent from the body and nullable, the spec requires it be set to `null`. If the code leaves it as `undefined`, the DB may keep the old value (because `UPDATE` only touches columns present in the entity).

**Why it happens:** TypeORM partial-update semantics leak into PUT code if `repo.create()` is called on an object that only has body-provided fields.

**How to avoid:** After building `replacement` from `meta.columns`, call `repo.create(replacement)` with ALL columns explicitly set (either to the body value, column default, or `null`). Do not pass a partial object to `repo.create()`.

**Warning signs:** Integration test where a PUT that omits a previously-set nullable field does not reset it to null.

### Pitfall 2: Deep Insert FK Assignment Order

**What goes wrong:** If a child entity is saved before the parent's generated primary key is available, the FK column will be null and the DB will reject the insert (or produce a corrupt record).

**Why it happens:** Generic recursive code that doesn't account for generated columns (auto-increment PKs) saves children and parent in the wrong order.

**How to avoid:** Always `await manager.save(parentClass, parent)` first, capture the returned entity with its generated key, then inject that key into each child body before saving children.

**Warning signs:** FK constraint violation errors in deep insert integration tests.

### Pitfall 3: Content-ID Map Leaking Across Changesets

**What goes wrong:** If `contentIdMap` is declared outside the `executeChangeset()` scope or reused across calls, a `$1` reference in changeset B could resolve to a resource from changeset A.

**Why it happens:** Incorrect variable scoping.

**How to avoid:** Declare `contentIdMap = new Map<string, string>()` as a local variable at the top of `executeChangeset()`, so it is fresh for every changeset. [VERIFIED: current code — contentIdMap does not exist yet, will be introduced fresh]

**Warning signs:** Content-ID `$1` resolves to a resource from a previous batch request.

### Pitfall 4: PUT Rejecting Body Key Mismatch Before ETag Check

**What goes wrong:** Checking the body key mismatch after ETag validation could expose the existence of an ETag-protected resource to callers that provide a wrong key.

**Why it happens:** Order of validation in `handleReplace()`.

**How to avoid:** Validate key format and URL/body key mismatch early (before any DB lookup). Validate ETag after confirming the entity exists.

**Warning signs:** 412 Precondition Failed returned for a key mismatch that should be 400 Bad Request.

### Pitfall 5: Navigation Property Identification for Deep Insert

**What goes wrong:** Deep insert code uses property name string matching against `EdmNavigationProperty.name` to detect nested objects. If the EDM nav prop name differs from the JSON body key (due to name casing or aliasing), nesting is not detected and child entities are silently treated as scalar body fields.

**Why it happens:** OData conventions use camelCase nav prop names; TypeORM metadata uses property names directly; these should match but need verification.

**How to avoid:** Rely on `EdmEntityType.navigationProperties` array from `EdmRegistry` — these names come from the entity's TypeORM metadata derivation and should match the body keys. Add a test that confirms `Order.items` nav prop name equals `"items"` in the EdmEntityType.

---

## Code Examples

### Building the PUT Replacement Entity (Key Pattern)

```typescript
// Source: TypeORM EntityMetadata column introspection [ASSUMED — training knowledge, pattern matches TypeOrmETagProvider usage in repo]
const meta = this.dataSource.getMetadata(this.repo.target as EntityClass)
const replacement: Record<string, unknown> = {}

// Lock in key values from URL
for (const kp of entityType.keyProperties) {
  replacement[kp] = (where as Record<string, unknown>)[kp]
}

// For every non-key column: body value > column default > null (if nullable) > absent
for (const col of meta.columns) {
  if (col.isPrimary) continue
  if (col.isCreateDate || col.isUpdateDate || col.isVersion) continue
  const prop = col.propertyName
  if (Object.prototype.hasOwnProperty.call(body, prop)) {
    replacement[prop] = body[prop]
  } else if (col.default !== undefined) {
    replacement[prop] = col.default
  } else if (col.isNullable) {
    replacement[prop] = null
  }
  // else: omit — DB-managed default (e.g., CURRENT_TIMESTAMP) set at DB level
}

const entity = this.repo.create(replacement as ObjectLiteral)
return this.repo.save(entity)
```

### Resolving FK Column Name from TypeORM Metadata

```typescript
// Source: TypeORM EntityMetadata foreignKeys [ASSUMED — training knowledge]
// foreignKeys: ForeignKeyMetadata[] each has .columnNames and .referencedEntityMetadata.name
private resolveForeignKey(
  parentClass: EntityClass,
  navPropName: string,
): string {
  const parentMeta = this.dataSource.getMetadata(parentClass)
  // Find the OneToMany or ManyToOne that corresponds to navPropName
  const relation = parentMeta.relations.find(r => r.propertyName === navPropName)
  if (!relation) throw new Error(`No relation '${navPropName}' found on ${parentMeta.name}`)
  // For OneToMany: the FK lives on the child side; look at inverseSide's joinColumns
  const inverseMeta = relation.inverseEntityMetadata
  const inverseRelation = inverseMeta.relations.find(
    r => r.inverseEntityMetadata.name === parentMeta.name
  )
  if (!inverseRelation || !inverseRelation.joinColumns[0]) {
    throw new Error(`Cannot resolve FK column for relation '${navPropName}'`)
  }
  return inverseRelation.joinColumns[0].propertyName  // e.g., "orderId"
}
```

### Content-ID URL Pattern

```typescript
// OData v4 Content-ID reference format per OASIS spec and Apache Olingo implementation:
// Source: [CITED: olingo.apache.org/doc/odata4/tutorials/batch/tutorial_batch.html]
//
// Request in changeset:
//   Content-ID: 1
//   POST /odata/Orders HTTP/1.1
//   { "status": "new" }
//
// Next request references it:
//   PATCH $1 HTTP/1.1     <- $1 substituted with full Location URL from prior 201
//   { "status": "confirmed" }
//
// Or navigating a related set:
//   POST $1/Items HTTP/1.1  <- substitutes Location prefix, appends /Items

// Regex approach for $N substitution (one ID at a time):
for (const [id, resolvedUrl] of contentIdMap) {
  // Match $<id> at a word boundary (before / or end of URL segment)
  const re = new RegExp(`\\$${id}(?=[/?#]|$)`, 'g')
  url = url.replace(re, resolvedUrl)
}
```

---

## State of the Art

| Old Approach                            | Current Approach                              | When Changed        | Impact                                                                              |
| --------------------------------------- | --------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| PATCH for partial updates (widely used) | PUT for full replacement (OData v4 spec)      | OData v4 (2014+)    | PUT must reset to defaults; PATCH uses merge semantics                              |
| Manual cascade on each level            | TypeORM `cascade: true`                       | TypeORM 0.2+        | Cascade only works if configured on the entity — cannot rely on it without checking |
| Content-ID as opaque string             | Numeric Content-ID with `$N` URL substitution | OData v4 batch spec | References are scoped to a single changeset only                                    |

---

## Assumptions Log

| #   | Claim                                                                                                                                   | Section                   | Risk if Wrong                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `ColumnMetadata.default` contains the TypeScript-side default value (from `@Column({ default: 'pending' })`), not the SQL-level default | PUT Replacement Pattern   | If `ColumnMetadata.default` is `undefined` for columns with SQL-side defaults, the reset logic would fall through to `null` for non-nullable columns — causing a constraint violation |
| A2  | `ColumnMetadata.isNullable` correctly reflects `nullable: true` from the `@Column()` decorator                                          | PUT Replacement Pattern   | If wrong, nullable columns would not be reset to `null`                                                                                                                               |
| A3  | `EntityMetadata.relations[i].joinColumns[0].propertyName` gives the FK property name on the child side for a OneToMany relation         | Deep Insert FK Resolution | If wrong, the FK injection would use the wrong property name and insert would fail with a constraint error                                                                            |
| A4  | `EdmNavigationProperty.name` in the EdmRegistry matches the JSON body key for navigation properties exactly (e.g., `"items"`)           | Deep Insert Detection     | If casing differs, nesting not detected; child entities silently ignored                                                                                                              |
| A5  | Content-ID values in the existing test suite use numeric strings (e.g., `"1"`, `"2"`)                                                   | Content-ID Regex          | If Content-IDs can be non-numeric (e.g., alphanumeric), the `\$\d+` regex approach would fail to resolve them                                                                         |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (Table is not empty — A1-A5 need spike validation in Wave 0 tests.)

---

## Open Questions

1. **Does `ColumnMetadata.default` reflect TypeScript-side defaults or SQL-side defaults?**
   - What we know: `@Column({ default: 'pending' })` sets a SQL default AND TypeORM stores it in metadata
   - What's unclear: Whether `.default` in `ColumnMetadata` is the TypeScript value or undefined for SQL-only defaults
   - Recommendation: Write a unit test in Wave 0 that reads `meta.columns` from the `Order` entity and asserts `status` column has `.default === 'pending'`. If undefined, use `col.default ?? (col.isNullable ? null : undefined)`.

2. **How does `TypeOrmAutoHandler` get a DataSource reference for column metadata?**
   - What we know: `TypeOrmAutoHandler` currently has `repo: Repository<ObjectLiteral>` but NOT a direct `DataSource` injection — the DataSource is only in `BatchController`
   - What's unclear: `repo.metadata` (TypeORM Repository exposes `.metadata`) may provide the same `EntityMetadata` without requiring `DataSource` injection
   - Recommendation: Use `this.repo.metadata.columns` instead of `this.dataSource.getMetadata()` — Repository already holds its metadata reference. [ASSUMED — needs verification in Wave 0]

3. **Can deep insert reuse `TypeOrmAutoHandler.handleCreate()` or does it need a separate recursive function?**
   - What we know: `handleCreate()` uses `this.repo` (single entity's repository); recursive children need different repos
   - What's unclear: Whether the recursive function lives in `TypeOrmAutoHandler` (needs multi-repo access) or in a new `DeepInsertService`
   - Recommendation: Add a `handleDeepCreate()` method that accepts an `EntityManager` parameter, matching the batch controller's `dispatchCreate()` pattern. This keeps consistency with how batch operations pass `manager` rather than repo.

---

## Environment Availability

Step 2.6: SKIPPED — no new external tool dependencies. All writes use TypeORM + SQLite (already running in test-app).

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json` — section skipped per config.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category       | Applies | Standard Control                                                                                               |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| V4 Access Control   | no      | NestJS Guards handle authorization — library doesn't control this                                              |
| V5 Input Validation | yes     | Body validated via TypeORM entity class (acts as whitelist); key format validated by `parseODataKey()` already |
| V6 Cryptography     | no      | No crypto in write operations                                                                                  |

### Known Threat Patterns for Write Operations

| Pattern                                       | STRIDE            | Standard Mitigation                                                                                                                 |
| --------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Mass assignment via deep insert body keys     | Tampering         | TypeORM `repo.create()` maps only declared columns — unknown fields are ignored [VERIFIED: existing handleCreate uses this pattern] |
| Unbounded recursion via deeply nested payload | Denial of Service | `maxDeepInsertDepth` config cap (D-02); check depth BEFORE processing each level                                                    |
| Content-ID injection via crafted `$N` in body | Tampering         | Resolve only from `contentIdMap` populated by prior 201 responses; never evaluate `$N` as code — string replacement only            |
| PUT to overwrite entity with wrong key        | Tampering         | Reject body key != URL key (D-01 spec requirement); use `parseODataKey()` for typed key comparison                                  |

---

## Sources

### Primary (HIGH confidence)

- `packages/typeorm/src/translator/typeorm-auto-handler.ts` — existing handleCreate/handleUpdate/handleDelete patterns [VERIFIED: read directly]
- `packages/typeorm/src/batch/batch-controller.ts` — executeChangeset() loop, dispatchCreate() pattern [VERIFIED: read directly]
- `packages/core/src/batch/batch-parser.ts` — Content-ID extraction via `getHeaderValue(mimeHeaders, 'content-id')` already implemented [VERIFIED: read directly]
- `packages/core/src/batch/batch-types.ts` — BatchRequestPart.contentId field already exists, readonly interface [VERIFIED: read directly]
- `apps/test-app/src/entities/order.entity.ts` — no `cascade: true` on `items` relation [VERIFIED: read directly]
- `apps/test-app/src/entities/order-item.entity.ts` — FK columns `orderId`, `productId` defined explicitly [VERIFIED: read directly]
- `packages/core/src/edm/edm-types.ts` — EdmNavigationProperty has `.name`, `.type`, `.isCollection` [VERIFIED: read directly]
- `packages/core/src/odata.module.ts` — ODataModuleResolvedOptions shape (adding `maxDeepInsertDepth` here) [VERIFIED: read directly]

### Secondary (MEDIUM confidence)

- [Apache Olingo OData4 Batch Tutorial](https://olingo.apache.org/doc/odata4/tutorials/batch/tutorial_batch.html) — Content-ID format: `$<N>` in URL, numeric ID in header, changeset-scoped resolution [CITED]
- [TypeORM Relations Documentation](https://typeorm.io/docs/relations/relations/) — cascade options; confirmed `cascade: true` required for automatic nested saves [CITED]
- [TypeORM Repository API](https://typeorm.io/docs/working-with-entity-manager/repository-api/) — `preload()` preserves existing values; no built-in full-replace method [CITED]

### Tertiary (LOW confidence)

- Training knowledge: `ColumnMetadata.default` field behavior — needs Wave 0 spike [ASSUMED: A1]
- Training knowledge: `repo.metadata.columns` as alternative to `dataSource.getMetadata()` [ASSUMED: A2, Open Question 2]
- Training knowledge: `EntityMetadata.relations[i].joinColumns[0].propertyName` for FK resolution [ASSUMED: A3]

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; all existing TypeORM + NestJS APIs
- Architecture patterns: HIGH — PUT and Content-ID patterns are well-understood; deep insert pattern is MEDIUM pending A1-A3 spike
- Pitfalls: HIGH — all five pitfalls are code-path visible from reading the existing codebase

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable APIs; TypeORM 0.3.x has been stable for 2+ years)
