---
phase: 12-developer-experience-audit-and-api-simplification
plan: 02
subsystem: api
tags: [nestjs, odata, error-handling, dx, validation, parser]

# Dependency graph
requires:
  - phase: 12-developer-experience-audit-and-api-simplification
    provides: ODataValidationError, ODataParseError, ODataQueryPipe, ODataExceptionFilter
provides:
  - enriched ODataValidationError with availableProperties field
  - ODataParseError.withContext() static factory for context snippets
  - ODataExceptionFilter surfacing enriched error details
  - ODataEntitySecurityOptions type export
affects: [documentation, developer-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns: [enriched-error-messages, context-snippet-extraction, no-fuzzy-matching]

key-files:
  created:
    - packages/core/src/parser/errors.spec.ts
  modified:
    - packages/core/src/query/odata-validation.error.ts
    - packages/core/src/query/odata-validation.error.spec.ts
    - packages/core/src/query/odata-query.pipe.ts
    - packages/core/src/query/odata-query.pipe.spec.ts
    - packages/core/src/parser/errors.ts
    - packages/core/src/response/odata-exception.filter.ts
    - packages/core/src/response/odata-exception.filter.spec.ts
    - packages/core/src/query/index.ts

key-decisions:
  - 'Generic "Available properties:" suffix for all validation errors including nav props -- keeps ODataValidationError constructor simple'
  - 'ODataParseError.withContext() as static factory rather than modifying all throw sites -- incremental adoption'
  - 'ODataExceptionFilter surfaces availableProperties and queryContext in details array for programmatic API consumer access'

patterns-established:
  - 'Enriched error pattern: error classes accept optional diagnostic fields, auto-enrich message in constructor'
  - 'Context snippet extraction: ~20 chars before/after error position with ellipsis markers'

requirements-completed: [DX-09, DX-10, DX-11]

# Metrics
duration: 6min
completed: 2026-04-08
---

# Phase 12 Plan 02: Error Message Enrichment and Public API Export Audit Summary

**Validation errors include available property lists, parse errors get context snippets, public API exports verified complete -- no fuzzy matching per D-11**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-08T20:44:12Z
- **Completed:** 2026-04-08T20:50:36Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- ODataValidationError auto-appends "Available properties: id, name, price" when availableProperties provided
- ODataParseError.withContext() extracts ~20 char context snippet around error position for diagnostic clarity
- ODataQueryPipe passes available property names in all three validation paths: filter, select, expand
- ODataExceptionFilter surfaces enriched error details (queryContext, availableProperties) in response details array
- ODataEntitySecurityOptions type now exported from core query index for per-entity security configuration
- All 343 core + 260 typeorm + 186 e2e tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD):** `18b6ee7` (feat) - Enrich validation and parse errors with actionable context
2. **Task 2:** `8944831` (chore) - Export ODataEntitySecurityOptions from core query index

## Files Created/Modified

- `packages/core/src/query/odata-validation.error.ts` - Added availableProperties field, auto-enriched message
- `packages/core/src/query/odata-validation.error.spec.ts` - Tests for availableProperties, message enrichment, D-11
- `packages/core/src/query/odata-query.pipe.ts` - Passes knownNames/navNames to ODataValidationError in all validation paths
- `packages/core/src/query/odata-query.pipe.spec.ts` - Tests for enriched errors in filter, select, expand validation
- `packages/core/src/parser/errors.ts` - Added queryContext field and withContext() static factory
- `packages/core/src/parser/errors.spec.ts` - Tests for queryContext, withContext, context snippet extraction
- `packages/core/src/response/odata-exception.filter.ts` - Surfaces queryContext and availableProperties in details
- `packages/core/src/response/odata-exception.filter.spec.ts` - Tests for enriched details in error responses
- `packages/core/src/query/index.ts` - Added ODataEntitySecurityOptions type export

## Decisions Made

- **Generic "Available properties:" for all validation errors:** Both property and navigation property validation use the same enrichment pattern. The base message ("Property..." vs "Navigation property...") provides the distinction. This keeps ODataValidationError's constructor simple with a single optional parameter.
- **Static factory for context snippets:** `ODataParseError.withContext()` creates errors with context rather than modifying all existing throw sites in lexer/parser. This is additive -- existing code continues to work, and callers can opt in to context enrichment.
- **Details array enrichment:** The ODataExceptionFilter uses the OData error response `details` array to surface structured diagnostic info (queryContext as target string, availableProperties as target+value). This gives API consumers programmatic access without changing the message format.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 12 DX audit complete -- all 11 DX requirements (DX-01 through DX-11) implemented
- Error enrichment patterns established for future error types
- Public API surface verified complete for both packages

## Self-Check: PASSED

All 9 files verified present. Both commits verified in git log.

---

_Phase: 12-developer-experience-audit-and-api-simplification_
_Completed: 2026-04-08_
