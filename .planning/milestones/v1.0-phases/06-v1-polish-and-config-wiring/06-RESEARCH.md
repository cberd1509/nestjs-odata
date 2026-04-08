# Phase 6: v1 Polish and Config Wiring - Research

**Researched:** 2026-04-07
**Domain:** NestJS DI wiring, TypeORM filter visitor, OData sub-agent validation, changeset config
**Confidence:** HIGH

## Summary

Phase 6 closes five precise gaps found by the v1.0 milestone audit. None require new architectural decisions — they are all surgical fixes to existing code.

The largest item (SEC-04) is a one-line change: pass `this.options.maxFilterDepth` to the `TypeOrmFilterVisitor` constructor in `typeorm-query-translator.ts`. The `TypeOrmFilterVisitor` constructor already accepts `maxFilterDepth` as its fourth argument (line 53 in `filter-visitor.ts`), defaulting to 10. The translator creates the visitor without passing this argument, so `options.maxFilterDepth` from `ODataModuleResolvedOptions` is silently ignored.

The second item (MOD-02) requires creating a core-side EDM consumer. `ODataModule.forFeature()` provides the `EDM_ENTITY_CONFIGS` token containing pre-derived `EdmEntityConfig[]`, but nothing ever reads it to call `edmRegistry.register()`. This means a consumer using only `@nestjs-odata/core` (no TypeORM adapter) cannot register entities. The fix is to add an `OnModuleInit` service in `packages/core` that injects `EDM_ENTITY_CONFIGS` and registers them into `EdmRegistry`.

The remaining items (SCAF-08 validation, changeset config, peer dep version) are documentation/config fixes with no code impact.

**Primary recommendation:** Execute all five fixes as separate, independently-testable tasks. Each task is bounded and verifiable in isolation.

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                            | Research Support                                                                                               |
| ------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SEC-04  | Query complexity limits to prevent DoS via expensive filter expressions                | Fix: pass `options.maxFilterDepth` to `TypeOrmFilterVisitor` constructor in translator                         |
| MOD-02  | `ODataModule.forFeature([entities])` for registering OData-enabled entities per module | Fix: add `EdmFeatureInitializer` in core that consumes `EDM_ENTITY_CONFIGS` and calls `EdmRegistry.register()` |
| SCAF-08 | OData v4 expert sub-agent built from the OASIS spec for implementation guidance        | Fix: validate odata-expert.md against a set of OASIS spec test vectors and add missing knowledge               |

</phase_requirements>

---

## Standard Stack

### Core (no new dependencies required)

All five fixes use code and config already in the repo. No new npm packages needed.

| Package                 | Current Version | Role in Phase                                                                    |
| ----------------------- | --------------- | -------------------------------------------------------------------------------- |
| `@nestjs-odata/core`    | 0.0.2           | Add `EdmFeatureInitializer`; fix peer dep is declared in `@nestjs-odata/typeorm` |
| `@nestjs-odata/typeorm` | 0.0.1           | Pass `maxFilterDepth` in translator; fix peer dep range                          |
| `@changesets/cli`       | existing        | Fix config `ignore` entry                                                        |

### No New Dependencies

[VERIFIED: codebase grep] All required types, classes, and tokens exist. Zero new packages.

---

## Architecture Patterns

### Pattern 1: SEC-04 — Wire maxFilterDepth to TypeOrmFilterVisitor

**What:** `TypeOrmQueryTranslator.translate()` creates `TypeOrmFilterVisitor` without passing the configured `maxFilterDepth`. The visitor constructor accepts it as the fourth argument with a default of 10.

**Gap location:** `packages/typeorm/src/translator/typeorm-query-translator.ts` line 60:

```typescript
// CURRENT (broken — always uses default 10):
new TypeOrmFilterVisitor(qb, alias, entityType).visit(query.filter)

// FIXED (uses configured value):
new TypeOrmFilterVisitor(qb, alias, entityType, this.options.maxFilterDepth).visit(query.filter)
```

[VERIFIED: codebase read] `this.options` is of type `ODataModuleResolvedOptions` and is already injected via `@Inject(ODATA_MODULE_OPTIONS)` in the constructor. `maxFilterDepth` is a required field of `ODataModuleResolvedOptions` (default: 10). The fix is a single argument addition.

**Test gap:** `typeorm-query-translator.spec.ts` `mockOptions` object at line 66 is missing `maxFilterDepth`. After the fix, a new test must verify that the translator passes `options.maxFilterDepth` to the visitor and that a custom value (e.g. 3) is respected end-to-end.

### Pattern 2: MOD-02 — Add EdmFeatureInitializer in core

**What:** `ODataModule.forFeature()` provides `EDM_ENTITY_CONFIGS` token but no service reads it to register entities.

**TypeORM adapter reference:** `TypeOrmEdmInitializer` in `packages/typeorm/src/odata-typeorm.module.ts` (lines 32-67) demonstrates the same pattern: it implements `OnModuleInit`, injects `TYPEORM_ODATA_ENTITIES` and `EdmRegistry`, and calls `edmRegistry.register()` in `onModuleInit()`. The core-only path needs the same pattern but consuming `EDM_ENTITY_CONFIGS` (which contains pre-built `EdmEntityConfig[]`) instead of raw TypeORM entity classes.

**What EdmRegistry.register() needs:** `EdmEntityType` + `EdmEntitySet`. These must be constructed from `EdmEntityConfig`. The namespace comes from injecting `ODATA_MODULE_OPTIONS`.

**New class to add:** `EdmFeatureInitializer` in `packages/core/src/edm/edm-feature-initializer.ts`:

```typescript
// Source: derived from TypeOrmEdmInitializer pattern [VERIFIED: codebase read]
@Injectable()
export class EdmFeatureInitializer implements OnModuleInit {
  constructor(
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleResolvedOptions,
    @Inject(EDM_ENTITY_CONFIGS) private readonly entityConfigs: EdmEntityConfig[],
  ) {}

  onModuleInit(): void {
    const namespace = this.options.namespace
    for (const config of this.entityConfigs) {
      const entityType: EdmEntityType = {
        name: config.entityTypeName,
        namespace,
        properties: config.properties,
        navigationProperties: config.navigationProperties,
        keyProperties: config.keyProperties,
        isReadOnly: config.isReadOnly,
      }
      const entitySet: EdmEntitySet = {
        name: config.entitySetName,
        entityTypeName: config.entityTypeName,
        namespace,
        isReadOnly: config.isReadOnly,
      }
      this.edmRegistry.register(entityType, entitySet)
    }
  }
}
```

**ODataModule.forFeature() update:** Add `EdmFeatureInitializer` to providers:

```typescript
// CURRENT:
static forFeature(entityConfigs: EdmEntityConfig[]): DynamicModule {
  return {
    module: ODataModule,
    providers: [{ provide: EDM_ENTITY_CONFIGS, useValue: entityConfigs }],
    exports: [EDM_ENTITY_CONFIGS],
  }
}

// FIXED:
static forFeature(entityConfigs: EdmEntityConfig[]): DynamicModule {
  return {
    module: ODataModule,
    providers: [
      { provide: EDM_ENTITY_CONFIGS, useValue: entityConfigs },
      EdmFeatureInitializer,
    ],
    exports: [EDM_ENTITY_CONFIGS],
  }
}
```

**Important:** `EdmRegistry` is provided by `@Global()` `ODataModule`. `ODATA_MODULE_OPTIONS` is exported by `ODataModule.forRoot()`. Both are available to `forFeature()` providers because `forFeature()` shares the module scope with the global `@Global()` ODataModule.

**Test gap:** A new test in `odata.module.spec.ts` must verify that after compiling a module with both `forRoot()` and `forFeature([config])`, the `EdmRegistry` contains the registered entity type and entity set.

### Pattern 3: SCAF-08 — Validate odata-expert sub-agent

**What:** The sub-agent at `.claude/agents/odata-expert.md` was scaffolded but not validated against OASIS spec questions. Validation means posing a set of concrete OASIS spec questions (edge cases, ABNF parsing, CSDL structure, error format) to the agent and verifying its answers against the spec.

**Current state:** [VERIFIED: codebase read] The agent references all 6 primary OASIS spec URLs and covers: query options, CSDL, JSON response format, $batch, security. It has NestJS project-specific context. Its primary gap is untested depth — no verification that it answers edge-case questions correctly.

**Validation approach:** Create a checklist of 5-10 OASIS spec questions spanning each knowledge area, invoke the agent against each, and mark answers as correct/incorrect against the spec. This is a documentation/validation task, not a code change. If gaps are found, update the agent's knowledge sections.

### Pattern 4: Changeset Config Fix

**Gap:** `.changeset/config.json` `ignore` array contains `"test-app"` but the actual package name is `"@nestjs-odata/test-app"`.

**Current:**

```json
"ignore": ["@nestjs-odata/test-app"]
```

[VERIFIED: codebase read] The config already says `"@nestjs-odata/test-app"` — the audit noted "test-app" as the issue but the current file at line 10 shows the correct scoped name. This item may already be correct. **Verify before changing.**

**Verification command:** `cat /path/.changeset/config.json` and check `ignore` value against `apps/test-app/package.json` `name` field.

### Pattern 5: Peer Dep Version Fix

**Gap:** `packages/typeorm/package.json` declares `peerDependencies["@nestjs-odata/core"]: ">=0.1.0"` but core is at version `0.0.2`.

**Current:** [VERIFIED: codebase read]

- `packages/core/package.json` version: `"0.0.2"`
- `packages/typeorm/package.json` peerDeps: `"@nestjs-odata/core": ">=0.1.0"`

**Fix:** Change peer dep range to `">=0.0.1"` to match the current published version range.

---

## Don't Hand-Roll

| Problem                                 | Don't Build           | Use Instead                                                                                                      |
| --------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| EDM construction from `EdmEntityConfig` | Custom mapper         | Use the same shape already defined in `EdmEntityType` and `EdmEntitySet` interfaces — direct property assignment |
| NestJS DI for `EdmFeatureInitializer`   | Manual initialization | Standard `@Injectable()` + `OnModuleInit` pattern already used by `TypeOrmEdmInitializer`                        |

---

## Common Pitfalls

### Pitfall 1: forFeature() DI Scope for EdmFeatureInitializer

**What goes wrong:** `EdmFeatureInitializer` injects `ODATA_MODULE_OPTIONS` which is only provided by `ODataModule.forRoot()`. If a consumer calls `forFeature()` without having imported `forRoot()`, the injection will fail.

**Why it happens:** `@Global()` makes `EdmRegistry` available globally, but `ODATA_MODULE_OPTIONS` is only added to the global scope by `forRoot()`. The existing TypeORM adapter has the same constraint.

**How to avoid:** This constraint already exists and is documented. No new handling needed — throw a clear error if `ODATA_MODULE_OPTIONS` is not available (NestJS will throw "Nest can't resolve dependencies" which is acceptable).

**Warning signs:** Test that `forFeature()` without `forRoot()` produces a clear DI error, not a silent null.

### Pitfall 2: SEC-04 mockOptions Missing maxFilterDepth

**What goes wrong:** After adding `this.options.maxFilterDepth` to the translator, existing translator unit tests that use `mockOptions` (line 66 in `typeorm-query-translator.spec.ts`) will have a TypeScript type error because `ODataModuleResolvedOptions` requires `maxFilterDepth`.

**How to avoid:** Update `mockOptions` in the spec to include `maxFilterDepth: 10` in the same task as the translator fix.

### Pitfall 3: Changeset Config Already Correct

**What goes wrong:** The audit says the changeset ignore entry uses `"test-app"`, but reading the actual file shows `"@nestjs-odata/test-app"`. Acting on this without verifying will waste a task.

**How to avoid:** Always read the current file state before declaring a fix needed.

### Pitfall 4: EDM_ENTITY_CONFIGS Symbol is unique

**What goes wrong:** `EDM_ENTITY_CONFIGS` is declared as `Symbol('EDM_ENTITY_CONFIGS')` in `packages/core/src/tokens.ts`. Symbol identity is reference-based. If `forFeature()` and `EdmFeatureInitializer` are in the same module, they share the same symbol import — no issue. But if the token is re-declared anywhere, injection breaks silently.

**How to avoid:** Always import `EDM_ENTITY_CONFIGS` from `@nestjs-odata/core` (the compiled dist), not from a relative path that might be a different module instance.

---

## Code Examples

### SEC-04 Fix in typeorm-query-translator.ts

```typescript
// Source: packages/typeorm/src/translator/typeorm-query-translator.ts line 59-61 [VERIFIED: codebase read]
// BEFORE:
if (query.filter) {
  new TypeOrmFilterVisitor(qb, alias, entityType).visit(query.filter)
}

// AFTER:
if (query.filter) {
  new TypeOrmFilterVisitor(qb, alias, entityType, this.options.maxFilterDepth).visit(query.filter)
}
```

### SEC-04 Test Addition

```typescript
// Add to typeorm-query-translator.spec.ts
it('SEC-04: passes options.maxFilterDepth to TypeOrmFilterVisitor', () => {
  const strictOptions = { ...mockOptions, maxFilterDepth: 10 }
  const strictTranslator = new TypeOrmQueryTranslator(repo, mockEdmRegistry, strictOptions)
  // Build a filter with depth 11 — should throw
  // (use existing depth-4 filter pattern from filter-visitor.spec.ts as reference)
})
```

### MOD-02 Test Addition

```typescript
// Add to odata.module.spec.ts
it('MOD-02: forFeature() registers entities in EdmRegistry via EdmFeatureInitializer', async () => {
  const { ODataModule } = await import('./odata.module.js')
  const { EdmRegistry } = await import('./edm/edm-registry.js')

  const config: EdmEntityConfig = {
    /* ... */
  }

  const module = await Test.createTestingModule({
    imports: [ODataModule.forRoot({ serviceRoot: '/odata' }), ODataModule.forFeature([config])],
  }).compile()

  // Trigger OnModuleInit
  await module.init()

  const registry = module.get(EdmRegistry)
  expect(registry.getEntityType('Product')).toBeDefined()
  expect(registry.getEntitySet('Products')).toBeDefined()
})
```

---

## Runtime State Inventory

Phase 6 is a polish/wiring phase with no rename, migration, or rebrand. Skip this section — not applicable.

---

## Environment Availability

All fixes are code changes. No external tools, databases, or services required beyond what is already in the repo.

| Dependency | Required By | Available       | Notes                              |
| ---------- | ----------- | --------------- | ---------------------------------- |
| pnpm       | All tasks   | Assumed present | Project uses pnpm throughout       |
| Vitest     | Test tasks  | Assumed present | Already configured in all packages |
| Node.js    | All tasks   | Assumed present | No version change                  |

Step 2.6: External dependency audit is minimal — this phase makes no new external calls.

---

## Validation Architecture

### Test Framework

| Property            | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Framework           | Vitest 3.x                                                            |
| Config file         | `packages/core/vitest.config.ts`, `packages/typeorm/vitest.config.ts` |
| Quick run (core)    | `pnpm --filter @nestjs-odata/core test`                               |
| Quick run (typeorm) | `pnpm --filter @nestjs-odata/typeorm test`                            |
| Full suite          | `pnpm turbo test`                                                     |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                        | Test Type | Automated Command                                                                 | File Exists?                   |
| ------- | --------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | ------------------------------ |
| SEC-04  | `options.maxFilterDepth` is forwarded to `TypeOrmFilterVisitor` | unit      | `pnpm --filter @nestjs-odata/typeorm test -- translator/typeorm-query-translator` | Partial — new test case needed |
| MOD-02  | `forFeature()` triggers EDM registration in `EdmRegistry`       | unit      | `pnpm --filter @nestjs-odata/core test -- odata.module`                           | Partial — new test case needed |
| SCAF-08 | OData sub-agent answers spec questions correctly                | manual    | N/A — manual review                                                               | N/A                            |

### Sampling Rate

- Per task commit: `pnpm --filter <package> test`
- Per wave merge: `pnpm turbo test`
- Phase gate: Full suite green before verification

### Wave 0 Gaps

- [ ] `packages/typeorm/src/translator/typeorm-query-translator.spec.ts` — add SEC-04 end-to-end test case
- [ ] `packages/core/src/odata.module.spec.ts` — add MOD-02 registry population test case
- [ ] `packages/core/src/edm/edm-feature-initializer.ts` — new file (not yet present)
- [ ] `packages/core/src/edm/edm-feature-initializer.spec.ts` — unit test for new initializer

---

## Security Domain

Phase 6 does not introduce new security surface. The SEC-04 fix closes an existing DoS vector.

| ASVS Category       | Applies | Standard Control                                                                         |
| ------------------- | ------- | ---------------------------------------------------------------------------------------- |
| V5 Input Validation | yes     | `maxFilterDepth` enforcement via `ODataValidationError` — already implemented in visitor |
| V4 Access Control   | no      | N/A                                                                                      |
| V2 Authentication   | no      | N/A                                                                                      |

### Known Threat Patterns

| Pattern                         | STRIDE | Standard Mitigation                                     |
| ------------------------------- | ------ | ------------------------------------------------------- |
| Pathological filter depth (DoS) | DoS    | `maxFilterDepth` config — this phase wires it correctly |

---

## Assumptions Log

| #   | Claim                                                                               | Section                  | Risk if Wrong                                             |
| --- | ----------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| A1  | Changeset config `ignore` already shows `"@nestjs-odata/test-app"` not `"test-app"` | Architecture Patterns #4 | If wrong, an extra task is needed to fix the package name |

**All other claims are VERIFIED by direct codebase reads.**

---

## Open Questions

1. **Changeset config: already correct?**
   - What we know: Reading `.changeset/config.json` shows `"ignore": ["@nestjs-odata/test-app"]` which appears correct.
   - What's unclear: The audit says it uses `"test-app"` — this may have been fixed in a later phase or the audit may have been written before the file was created.
   - Recommendation: Read `.changeset/config.json` and `apps/test-app/package.json` `name` field at plan time and skip this task if they match.

2. **SCAF-08 validation depth: what does "formally validated" mean?**
   - What we know: The audit says "depth of OData v4 spec knowledge was not formally validated against OASIS test vectors".
   - What's unclear: There is no checklist of test vectors defined yet. The planner needs to define 5-10 concrete spec questions that constitute a pass.
   - Recommendation: Use the six knowledge areas in the agent (query options, CSDL, JSON format, $batch, security, parser) to write one representative question each. Pass = all answers match spec citations.

---

## Sources

### Primary (HIGH confidence — VERIFIED: codebase reads)

- `packages/typeorm/src/translator/typeorm-query-translator.ts` — translator constructor and `translate()` method
- `packages/typeorm/src/translator/filter-visitor.ts` — `TypeOrmFilterVisitor` constructor signature (lines 52-57)
- `packages/core/src/odata.module.ts` — `forFeature()` implementation (lines 179-190)
- `packages/core/src/tokens.ts` — `EDM_ENTITY_CONFIGS` token definition
- `packages/core/src/edm/edm-registry.ts` — `register()` method signature
- `packages/typeorm/src/odata-typeorm.module.ts` — `TypeOrmEdmInitializer` reference pattern (lines 32-67)
- `.changeset/config.json` — changeset ignore entry
- `packages/typeorm/package.json` — peer dep range (line 34)
- `packages/core/package.json` — current version 0.0.2
- `.planning/v1.0-MILESTONE-AUDIT.md` — gap definitions
- `.claude/agents/odata-expert.md` — sub-agent current knowledge inventory

### Secondary (MEDIUM confidence)

- `packages/typeorm/src/translator/typeorm-query-translator.spec.ts` — existing `mockOptions` object (line 66) missing `maxFilterDepth`
- `packages/typeorm/src/translator/filter-visitor.spec.ts` — depth enforcement tests at lines 375-456

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; all code paths verified by codebase reads
- Architecture: HIGH — all gap locations confirmed with exact line references
- Pitfalls: HIGH — derived from reading actual code, not assumptions

**Research date:** 2026-04-07
**Valid until:** Stable — this is internal code with no external dependencies that can drift
