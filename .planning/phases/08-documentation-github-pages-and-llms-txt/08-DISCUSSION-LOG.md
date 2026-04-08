# Phase 8: Documentation, GitHub Pages, and llms.txt - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 08-documentation-github-pages-and-llms-txt
**Areas discussed:** Doc completeness audit, API reference strategy, Doc sub-agent design, llms.txt and MCP scope

---

## Doc Completeness Audit

| Option               | Description                                                                                                | Selected |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| Audit and rewrite    | Read each doc against actual codebase, fix inaccuracies, fill gaps (Phase 7 features). Trustworthy result. | ✓        |
| Trust and extend     | Assume existing docs are correct, only add missing sections. Faster but risks wrong examples.              |          |
| Scrap and regenerate | Delete existing docs and regenerate from scratch. Cleanest but loses hand-crafted explanations.            |          |

**User's choice:** Audit and rewrite
**Notes:** Every code example should be verifiable against the real API

---

## API Reference Strategy

| Option                            | Description                                                                                | Selected |
| --------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| Hybrid: auto-generate + hand-edit | Use typedoc to extract signatures, then hand-edit for better examples. Rebuild on release. | ✓        |
| Fully auto-generated              | Pure typedoc output, no hand edits. Accurate but raw.                                      |          |
| Fully hand-written                | Keep current hand-written api/ docs. Readable but drifts from code.                        |          |

**User's choice:** Hybrid
**Notes:** Auto-generated output is starting point, not final product

---

## Doc Sub-Agent Design

| Option                           | Description                                                                                        | Selected |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| Project skill in .claude/skills/ | Spawned by GSD executor after each plan completes. Reads diff, checks affected docs, updates them. | ✓        |
| GSD agent (.claude/agents/)      | More integrated with GSD but heavier, only useful inside GSD.                                      |          |
| PostToolUse hook                 | Fires on every file change. Very aggressive, high overhead.                                        |          |

**User's choice:** Project skill
**Notes:** Lives in repo so contributors benefit too

---

## LLM Discoverability

| Option                  | Description                                                                  | Selected |
| ----------------------- | ---------------------------------------------------------------------------- | -------- |
| llms.txt + research MCP | Ship llms.txt, research MCP auto-generation, only build if good tool exists. |          |
| llms.txt only           | Just the files, skip MCP entirely.                                           |          |
| Full LLM suite          | llms.txt + build custom MCP server.                                          |          |

**User's choice:** Research ecosystem first (custom response)
**Notes:** Don't commit to vitepress-plugin-llms or any specific tool. Investigate best maintained / official solutions for both llms.txt and MCP auto-generation. If no good MCP tool exists, ship llms.txt only. Also research "copy as markdown" button plugins for VitePress pages.

## Claude's Discretion

- VitePress theme customization
- Sidebar navigation structure
- typedoc plugin choice
- GitHub Actions workflow details
- Doc skill diff-evaluation logic

## Deferred Ideas

- ESLint rule for OData decorators — tooling concern, not docs
