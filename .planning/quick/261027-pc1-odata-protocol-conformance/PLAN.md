---
slug: odata-protocol-conformance
date: 2026-10-27
branch: fix/odata-protocol-conformance
issues: [63, 70, 71, 75, 76, 77, 78, 79, 80, 81]
---

# OData 4.01 protocol conformance: writes, ETags, routing, errors

Fix the conformance findings #63, #70, #71, #75, #76, #77, #78, #79, #80, #81 in one branch.
Spec-mandated behaviour is the default (no compat opt-in for MUSTs); behaviour changes are
noted in the changeset. `$batch` changes stay localized (follow-up #64/#65/#67/#73 reworks it);
parser/filter/expand visitors are out of scope (#66/#68/#69/#72/#74, another branch).

## Tasks (TDD: unit + e2e first)

1. Core: `ODataEmptyResponse` signal answered by `ODataExceptionFilter` (304 #77, 204 #79).
2. Core: `Prefer` handling in `ODataResponseInterceptor` (#79); per-item `__etag` → `@odata.etag` (#81).
3. Core: `Content-Language` (`errorLanguage` option, mapping `language`) (#71).
4. Core: canonical `Set(key)` URL rewrite on Express in `ODataModule.configure()` (#63) + Express
   `etag` startup warning (#78).
5. Core: `EdmProperty.computed` → `Core.Computed`; `EdmEntitySet.optimisticConcurrency` →
   `Core.OptimisticConcurrency` (#75, #80).
6. TypeORM: `prepareWriteBody` (computed/key/unknown → 400, `ignoreUnknownProperties`) (#75, #76).
7. TypeORM: preconditions — If-None-Match 412, `requireIfMatch` 428, headers from the request
   (#70, #80); collection ETags (#81).
8. TypeORM `$batch`: same preconditions, PUT key, body rules, Prefer, Content-Language parts.
9. Docs (crud, security, getting-started, configuration, error-mapping, write-handlers, batch,
   query-options, troubleshooting, API pages, README) + changeset.
