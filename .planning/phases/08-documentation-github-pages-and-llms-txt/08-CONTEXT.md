# Phase 8: Documentation, GitHub Pages, and llms.txt - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the VitePress documentation site covering everything built so far (Phases 1-7), deploy to GitHub Pages, add llms.txt for LLM discoverability, and create a project-level doc-guardian skill. This phase establishes the docs infrastructure so every subsequent phase ships with documentation updates automatically.

</domain>

<decisions>
## Implementation Decisions

### Doc Completeness Audit

- **D-01:** Audit and rewrite all existing docs against the actual codebase. Read each of the 11 existing doc files, verify code examples work, fix inaccuracies, and fill gaps (Phase 7 filter functions, lambda any/all, arithmetic operators, date/time functions, string functions). The result must be trustworthy — every code example should be verifiable against the real API.

### API Reference Strategy

- **D-02:** Hybrid approach — auto-generate decorator signatures, types, and interfaces from TypeScript source using typedoc, then hand-edit for better examples and context. The auto-generated output is a starting point, not the final product. Rebuild on each release to catch drift.

### Doc Sub-Agent Design

- **D-03:** Create a project skill in `.claude/skills/` (not a GSD agent or hook). The skill gets spawned by the GSD executor after each phase plan completes. It reads the diff, checks which docs are affected by the code changes, and updates them. Lives in the repo so contributors using Claude Code benefit automatically.

### LLM Discoverability

- **D-04:** Research the ecosystem first — do NOT commit to `vitepress-plugin-llms` or any specific tool. Investigate the best maintained / official solutions for both llms.txt generation and MCP server auto-generation. If a good MCP auto-generation tool exists, use it; if not, ship llms.txt only and defer MCP. Also research "copy as markdown" button plugins for VitePress doc pages.

### Claude's Discretion

- VitePress theme customization (default theme is fine unless something specific is needed)
- Sidebar navigation structure and ordering
- typedoc plugin choice and configuration
- GitHub Actions workflow details for Pages deployment
- How the doc skill determines which docs are "affected" by a diff

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing docs infrastructure

- `docs/` — VitePress site root with 11 existing content files
- `docs/.vitepress/config.mts` — VitePress configuration
- `docs/package.json` — VitePress 1.6 dependency
- `docs/index.md` — Landing page with hero and features

### Guides to audit

- `docs/guide/getting-started.md` — Installation, setup, basic usage (196 lines)
- `docs/guide/query-options.md` — $filter, $select, $orderby, $top, $skip, $count (204 lines)
- `docs/guide/crud.md` — CRUD operations (209 lines)
- `docs/guide/expand.md` — $expand usage (157 lines)
- `docs/guide/batch.md` — $batch operations (171 lines)
- `docs/guide/configuration.md` — Module configuration (128 lines)
- `docs/guide/security.md` — Security limits and guards (190 lines)

### API docs to audit

- `docs/api/decorators.md` — Decorator reference (297 lines)
- `docs/api/module.md` — Module API reference (192 lines)

### Examples to audit

- `docs/examples/basic-crud.md` — Basic CRUD example (228 lines)
- `docs/examples/custom-controller.md` — Custom controller example (189 lines)

### Source of truth (for audit)

- `packages/core/src/decorators/` — All decorator implementations
- `packages/core/src/odata.module.ts` — Module configuration options
- `packages/typeorm/src/translator/filter-visitor.ts` — Filter functions (Phase 7 additions)

### Research topics

- llms.txt ecosystem — vitepress-plugin-llms and alternatives, official solutions
- MCP auto-generation — tools that create MCP servers from TypeScript APIs
- "Copy as markdown" — VitePress plugins that add copy-as-markdown buttons to pages
- typedoc + VitePress integration — typedoc-plugin-markdown, vitepress-plugin-typedoc, etc.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- VitePress 1.6 site already scaffolded in `docs/` with config, scripts, and 11 content files
- Landing page with hero, features, and nav links
- Turbo build pipeline includes docs package

### Established Patterns

- Guides organized by feature area (guide/, api/, examples/)
- Code blocks use TypeScript with practical examples
- VitePress tip/warning containers used for notes

### Integration Points

- `docs/package.json` — add typedoc, llms.txt plugin, and other deps
- `docs/.vitepress/config.mts` — nav, sidebar, plugins
- `.github/workflows/` — GitHub Actions for Pages deployment
- `.claude/skills/` — doc-guardian skill definition
- `turbo.json` — docs build task integration

</code_context>

<specifics>
## Specific Ideas

- "Copy as markdown" button on doc pages — research VitePress plugins that add this
- Doc sub-agent should evaluate diffs, not blindly regenerate all docs
- Research-first for llms.txt and MCP — don't commit to any specific tool without comparing alternatives
- Every code example in docs must be verifiable against the actual API

</specifics>

<deferred>
## Deferred Ideas

- ESLint rule for enforcing OData decorators on ODataController only (todo matched but not relevant to this phase — belongs in tooling)

</deferred>

---

_Phase: 08-documentation-github-pages-and-llms-txt_
_Context gathered: 2026-04-08_
