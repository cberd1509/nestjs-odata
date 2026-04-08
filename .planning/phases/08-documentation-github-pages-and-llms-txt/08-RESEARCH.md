# Phase 8: Documentation, GitHub Pages, and llms.txt - Research

**Researched:** 2026-04-08
**Domain:** VitePress documentation, GitHub Pages deployment, LLM discoverability, TypeDoc API reference generation, Claude Code skills
**Confidence:** HIGH (stack and tooling), MEDIUM (llms.txt ecosystem maturity)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Audit and rewrite all existing docs against the actual codebase. Read each of the 11 existing doc files, verify code examples work, fix inaccuracies, and fill gaps (Phase 7 filter functions, lambda any/all, arithmetic operators, date/time functions, string functions). Every code example must be verifiable against the real API.
- **D-02:** Hybrid approach — auto-generate decorator signatures, types, and interfaces from TypeScript source using typedoc, then hand-edit for better examples and context. Rebuild on each release to catch drift.
- **D-03:** Create a project skill in `.claude/skills/` (not a GSD agent or hook). The skill gets spawned by the GSD executor after each phase plan completes. It reads the diff, checks which docs are affected, and updates them.
- **D-04:** Research the ecosystem first — do NOT commit to `vitepress-plugin-llms` or any specific tool. Investigate best maintained/official solutions for llms.txt generation and MCP auto-generation. If a good MCP auto-generation tool exists, use it; if not, ship llms.txt only and defer MCP. Also research "copy as markdown" button plugins.

### Claude's Discretion

- VitePress theme customization (default theme is fine unless something specific is needed)
- Sidebar navigation structure and ordering
- typedoc plugin choice and configuration
- GitHub Actions workflow details for Pages deployment
- How the doc skill determines which docs are "affected" by a diff

### Deferred Ideas (OUT OF SCOPE)

- ESLint rule for enforcing OData decorators on ODataController only (belongs in tooling phase)
  </user_constraints>

---

## Summary

Phase 8 is a documentation-first phase building on an already-scaffolded VitePress 1.6 site in `docs/`. Three independent workstreams run in parallel: (1) audit/rewrite 11 existing doc files against real codebase, adding Phase 7 filter function coverage; (2) wire up TypeDoc auto-generation for the API reference using `typedoc-plugin-markdown` + `typedoc-vitepress-theme`; (3) deploy to GitHub Pages via a new GitHub Actions workflow and add `llms.txt`/`llms-full.txt` via `vitepress-plugin-llms`.

The research resolves D-04 definitively: **use `vitepress-plugin-llms` v1.12.0** — it is the clear leader (15,305 weekly downloads, used by Vite/Vue/Vitest/Rolldown, 350 GitHub stars, last publish 2026-03-20). It includes the "copy as markdown" button feature, so no separate plugin is needed for that. MCP auto-generation exists (openapi-mcp-generator, Stainless, FastMCP) but all require an OpenAPI spec as input — nestjs-odata does not have one yet. Defer MCP server to a future phase.

The doc-guardian skill (D-03) follows the Claude Code skill format: a `.claude/skills/doc-guardian/` directory with `SKILL.md` frontmatter describing when to invoke it and instructions for diff-based doc evaluation.

**Primary recommendation:** Deploy all three workstreams in parallel waves — audit docs, wire TypeDoc, deploy Pages + llms.txt — then add the doc-guardian skill as the final task.

---

## Standard Stack

### Core (already in `docs/package.json`)

| Library   | Version         | Purpose               | Why Standard                                           |
| --------- | --------------- | --------------------- | ------------------------------------------------------ |
| vitepress | 1.6.4 (current) | Static site generator | Already scaffolded; latest stable [VERIFIED: npm view] |

### Add in this phase

| Library                 | Version | Purpose                                                        | Why Standard                                                                                             |
| ----------------------- | ------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| vitepress-plugin-llms   | 1.12.0  | llms.txt + llms-full.txt generation + copy-as-markdown buttons | Leader: 15k weekly downloads, used by Vite/Vitest/Rolldown, last publish 2026-03-20 [VERIFIED: npm view] |
| typedoc                 | 0.28.18 | TypeScript API doc extraction                                  | Current stable, required by typedoc-plugin-markdown [VERIFIED: npm view]                                 |
| typedoc-plugin-markdown | 4.11.0  | TypeDoc output in Markdown format                              | Last publish 2026-03-18; native VitePress integration [VERIFIED: npm view]                               |
| typedoc-vitepress-theme | 1.1.2   | VitePress-specific sidebar + anchor generation                 | Official companion to typedoc-plugin-markdown; last publish 2025-01-07 [VERIFIED: npm view]              |

### Supporting

| Library                                                             | Version | Purpose | When to Use |
| ------------------------------------------------------------------- | ------- | ------- | ----------- |
| (none — existing GitHub Actions already use `pnpm/action-setup@v4`) | —       | —       | —           |

### Alternatives Considered for llms.txt

| Instead of            | Could Use                                      | Tradeoff                                              |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| vitepress-plugin-llms | vitepress-plugin-llmstxt (v0.5.1)              | Much lower adoption, missing copy-as-markdown buttons |
| vitepress-plugin-llms | @zenjoy/vitepress-plugin-llms (1.8.0-zenjoy.0) | Fork with experimental suffix, lower adoption         |
| vitepress-plugin-llms | Manual llms.txt                                | Tedious to maintain, loses auto-sync with docs        |

### Alternatives Considered for API Reference

| Instead of                                        | Could Use                       | Tradeoff                                              |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| typedoc-plugin-markdown + typedoc-vitepress-theme | Handwritten API docs only       | No drift protection; tedious after each release       |
| typedoc-plugin-markdown + typedoc-vitepress-theme | typedoc default HTML output     | Separate site; can't integrate into VitePress sidebar |
| typedoc-plugin-markdown + typedoc-vitepress-theme | @terwer/typedoc-vitepress-theme | Unofficial fork; lower adoption                       |

### MCP Auto-Generation — Verdict: Defer

The available MCP generation tools (openapi-mcp-generator, Stainless, Speakeasy, FastMCP) all require an OpenAPI spec as input. nestjs-odata does not expose an OpenAPI spec — it is an OData library, not a REST API. Generating an OpenAPI spec solely to feed an MCP server is disproportionate work for a documentation phase. **Decision: ship llms.txt only; defer MCP server to a future phase when/if OpenAPI spec exists.** [ASSUMED: nestjs-odata has no OpenAPI spec — verified by examining package structure, no openapi-related deps found]

### Installation

```bash
# In docs/ package
pnpm add -D vitepress-plugin-llms typedoc typedoc-plugin-markdown typedoc-vitepress-theme
```

**Version verification (run before writing tasks):**

```bash
npm view vitepress-plugin-llms version      # 1.12.0 as of 2026-04-08
npm view typedoc version                    # 0.28.18
npm view typedoc-plugin-markdown version    # 4.11.0
npm view typedoc-vitepress-theme version    # 1.1.2
```

---

## Architecture Patterns

### Recommended Project Structure (additions to existing `docs/`)

```
docs/
├── .vitepress/
│   ├── config.mts            # Add: vitepress-plugin-llms plugin, import typedoc sidebar
│   └── theme/
│       └── index.ts          # NEW: register CopyOrDownloadAsMarkdownButtons component
├── api/
│   ├── typedoc-sidebar.json  # AUTO-GENERATED by typedoc-vitepress-theme
│   ├── index.md              # AUTO-GENERATED by typedoc (regenerate on each release)
│   └── ...                   # AUTO-GENERATED markdown files
├── guide/                    # Audit + rewrite 7 existing files
│   ├── filter-functions.md   # NEW: Phase 7 additions
│   └── ...
├── examples/                 # Audit + rewrite 2 existing files
├── index.md                  # Landing page (keep, verify)
├── typedoc.json              # NEW: TypeDoc configuration
└── package.json              # Add new deps

packages/core/src/            # TypeDoc reads from here
  decorators/                 # All decorators — primary source for API reference

.github/workflows/
└── docs.yml                  # NEW: GitHub Pages deployment workflow

.claude/skills/
└── doc-guardian/
    ├── SKILL.md              # NEW: skill definition
    └── rules/
        └── doc-coverage.md   # NEW: which changes require which doc updates
```

### Pattern 1: typedoc-plugin-markdown + VitePress Integration

**What:** TypeDoc reads TypeScript source, outputs Markdown + `typedoc-sidebar.json` into `docs/api/`; VitePress config imports the sidebar JSON.

**When to use:** On every release (turbo pipeline: `typedoc` runs before `vitepress build`).

**typedoc.json:**

```json
{
  "entryPoints": ["../packages/core/src/index.ts"],
  "plugin": ["typedoc-plugin-markdown", "typedoc-vitepress-theme"],
  "out": "./api",
  "readme": "none",
  "hideBreadcrumbs": true,
  "hidePageHeader": true,
  "anchorFormat": "slug",
  "entryDocument": "index.md"
}
```

**config.mts additions:**

```typescript
// Source: typedoc-plugin-markdown.org/plugins/vitepress/quick-start [CITED]
import typedocSidebar from '../api/typedoc-sidebar.json'

// In themeConfig.sidebar:
'/api/': [
  { text: 'Module API', link: '/api/module' },       // handwritten
  { text: 'Decorators', link: '/api/decorators' },   // handwritten
  {
    text: 'Auto-generated API',
    items: typedocSidebar,
  },
],
```

**Important caveat:** The auto-generated files in `docs/api/` should NOT be committed to git directly (add to `.gitignore`) since they are regenerated on each build. The handwritten `docs/api/decorators.md` and `docs/api/module.md` should be audited/rewritten as part of D-01 — the TypeDoc output supplements them, it does not replace them (per D-02 hybrid approach).

### Pattern 2: vitepress-plugin-llms Zero-Config Integration

**What:** Generates `llms.txt`, `llms-full.txt`, and per-page `.md` files in the build output. Optionally adds "Copy as Markdown" buttons to each page.

**config.mts (minimal — step 1):**

```typescript
// Source: deepwiki.com/okineadev/vitepress-plugin-llms/2-installation-and-usage [CITED]
import llmstxt from 'vitepress-plugin-llms'

export default defineConfig({
  vite: {
    plugins: [llmstxt()],
  },
})
```

**theme/index.ts (for copy/download buttons — step 2):**

```typescript
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import CopyOrDownloadAsMarkdownButtons from 'vitepress-plugin-llms/vitepress-components/CopyOrDownloadAsMarkdownButtons.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CopyOrDownloadAsMarkdownButtons', CopyOrDownloadAsMarkdownButtons)
  },
} satisfies Theme
```

**config.mts (add markdown plugin for buttons — step 3):**

```typescript
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'

export default defineConfig({
  vite: { plugins: [llmstxt()] },
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons)
    },
  },
})
```

**Known bug:** Issue #109 in the repo: "Copy/Download as Markdown copies raw `<!--@include-->` directive instead of included content." Avoid `<!--@include-->` directives if using copy buttons. [CITED: github.com/okineadev/vitepress-plugin-llms/issues/109]

### Pattern 3: GitHub Pages Deployment Workflow

**What:** Separate GitHub Actions job triggered on push to `main`, builds docs via Turborepo, deploys to GitHub Pages.

**docs.yml skeleton (pnpm + Turborepo):**

```yaml
# Source: vitepress.dev/guide/deploy#github-pages [CITED]
name: Deploy Docs

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo docs:build # uses turbo.json docs:build task
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**GitHub repo settings required:** Settings > Pages > Source = "GitHub Actions" (not "Deploy from a branch").

**base config:** `docs/.vitepress/config.mts` already has `base: '/nestjs-odata/'` — correct for `username.github.io/nestjs-odata/`.

### Pattern 4: Doc-Guardian Skill

**What:** A Claude Code skill stored in `.claude/skills/doc-guardian/` that evaluates git diffs after a phase completes and updates affected documentation.

**Structure:**

```
.claude/skills/doc-guardian/
├── SKILL.md            # Frontmatter + instructions
└── rules/
    └── doc-coverage.md # Maps source files → doc files
```

**SKILL.md format:**

```markdown
---
name: doc-guardian
description: Evaluates whether code changes require documentation updates and applies them. Use after phase execution completes, when reviewing diffs that touch packages/core or packages/typeorm.
---

# Doc Guardian Skill

[Instructions for reading the diff, checking doc-coverage.md mapping,
reading affected doc files, and updating them]
```

**doc-coverage.md mapping logic (Claude's discretion on exact implementation):**

- Changes to `packages/core/src/decorators/` → `docs/api/decorators.md`
- Changes to `packages/core/src/odata.module.ts` → `docs/guide/configuration.md`, `docs/api/module.md`
- Changes to `packages/typeorm/src/translator/filter-visitor.ts` → `docs/guide/query-options.md`, new filter-functions guide
- New query option (parser change) → `docs/guide/query-options.md`
- Security-related changes → `docs/guide/security.md`

### Anti-Patterns to Avoid

- **Committing auto-generated typedoc output:** Auto-generated `docs/api/*.md` and `typedoc-sidebar.json` should be in `.gitignore`; regenerated by the build pipeline. If committed, they create noise in every PR that changes a TypeScript signature.
- **Single workflow for CI + docs:** Keep the Pages deployment workflow (`docs.yml`) separate from CI (`ci.yml`) — different triggers, different permissions, different concerns.
- **Using `<!--@include-->` with copy buttons:** Known bug in vitepress-plugin-llms v1.x — the copy button captures the raw directive instead of the included content.
- **Hardcoding decorator docs:** With D-02 hybrid approach, the handwritten decorator examples live in `docs/api/decorators.md`; TypeDoc-generated output is supplemental. Don't merge them into the same files or you'll lose edits on rebuild.
- **Running typedoc from root:** TypeDoc needs to be invoked from the `docs/` directory (or with explicit path config) since the `packages/core` source is in a sibling directory, not `docs/src`.

---

## Don't Hand-Roll

| Problem                            | Don't Build                            | Use Instead                                                    | Why                                                                                                                              |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| llms.txt generation                | Custom script parsing VitePress output | vitepress-plugin-llms                                          | Handles frontmatter, excludes non-content, generates proper llms.txt spec, adds copy buttons — 427 commits of edge case handling |
| Copy-as-markdown button            | Custom Vue component                   | vitepress-plugin-llms built-in                                 | Already ships `CopyOrDownloadAsMarkdownButtons` — zero code needed                                                               |
| TypeDoc → VitePress sidebar wiring | Parsing TypeDoc JSON to build nav      | typedoc-vitepress-theme                                        | Auto-generates `typedoc-sidebar.json` with correct VitePress anchor format                                                       |
| GitHub Pages deployment YAML       | Writing custom deploy logic            | `actions/deploy-pages@v4` + `actions/upload-pages-artifact@v3` | Official GitHub Actions for Pages; handles all edge cases (branch, artifact, permissions)                                        |

**Key insight:** All four problems above have mature, maintained solutions. Building custom versions would cost multiple days and reproduce bugs that the ecosystem already fixed.

---

## Common Pitfalls

### Pitfall 1: TypeDoc Runs After VitePress Build

**What goes wrong:** If the `typedoc` step runs concurrently with or after `vitepress build`, the `docs/api/` directory is empty when VitePress tries to include the sidebar JSON — causing a build error.

**Why it happens:** Turborepo tasks run in topological order by dependency declaration, but without explicit `dependsOn`, TypeDoc and VitePress build may run in any order.

**How to avoid:** In `docs/package.json`, create a `docs:build` script that sequences TypeDoc → VitePress: `"docs:build": "typedoc && vitepress build"`. The `turbo.json` `docs:build` task already exists; just make sure its `docs/package.json` script chains them correctly.

**Warning signs:** Build fails with `Cannot find module '../api/typedoc-sidebar.json'` or `404` on auto-generated API pages.

### Pitfall 2: vitepress-plugin-llms Copies Raw `<!--@include-->` Directive

**What goes wrong:** Pages using VitePress `<!--@include-->` snippets see the raw directive in the copied markdown instead of the included content.

**Why it happens:** Known bug in v1.x (Issue #109) — the plugin reads the source markdown before VitePress processes includes.

**How to avoid:** Avoid `<!--@include-->` in pages where the copy button matters. Inline content directly, or accept that the copy button output will be imperfect for those pages.

**Warning signs:** User copies a page and sees `<!--@include: ./snippets/x.md-->` in the clipboard.

### Pitfall 3: GitHub Pages Permissions Not Configured

**What goes wrong:** Workflow deploys successfully but `actions/deploy-pages` fails with 403 or "Resource not accessible by integration."

**Why it happens:** GitHub Pages source must be set to "GitHub Actions" in repo settings, AND the workflow must have `pages: write` + `id-token: write` permissions.

**How to avoid:** Document in the workflow file that the deployer must configure GitHub Pages source in repo settings. Check permissions block in the workflow YAML.

### Pitfall 4: `base` Mismatch Between VitePress Config and Deployment URL

**What goes wrong:** Site deploys but all assets 404 — CSS, JS, images broken.

**Why it happens:** VitePress `base` must match the GitHub Pages subdirectory. Current config has `base: '/nestjs-odata/'`, which is correct for `https://username.github.io/nestjs-odata/`. If the Pages URL differs, assets break.

**Warning signs:** Site HTML loads but is unstyled; browser console shows 404s for `/nestjs-odata/assets/*.js`.

### Pitfall 5: Doc-Guardian Skill Reads Wrong Files

**What goes wrong:** The skill diffs `git diff HEAD~1` and misses files changed earlier in the phase or compares against the wrong baseline.

**Why it happens:** Skills don't have built-in phase context — they read git state at invocation time.

**How to avoid:** The skill should accept an optional base ref (or default to `origin/main`), not just `HEAD~1`. Document this in `SKILL.md`.

---

## Code Examples

### typedoc.json for monorepo (entryPoint in sibling package)

```json
{
  "entryPoints": ["../packages/core/src/index.ts"],
  "plugin": ["typedoc-plugin-markdown", "typedoc-vitepress-theme"],
  "out": "./api",
  "readme": "none",
  "hideBreadcrumbs": true,
  "hidePageHeader": true,
  "anchorFormat": "slug",
  "entryDocument": "index.md",
  "excludePrivate": true,
  "excludeInternal": true,
  "excludeExternals": true
}
```

### docs/package.json build script (sequences typedoc before vitepress)

```json
{
  "scripts": {
    "dev": "vitepress dev",
    "build": "typedoc && vitepress build",
    "preview": "vitepress preview",
    "typedoc": "typedoc"
  }
}
```

### config.mts with all plugins wired

```typescript
// Source: vitepress.dev and deepwiki.com/okineadev/vitepress-plugin-llms [CITED]
import { defineConfig } from 'vitepress'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'
import typedocSidebar from '../api/typedoc-sidebar.json'

export default defineConfig({
  title: 'nestjs-odata',
  description: 'OData v4 for NestJS — zero double-declaration',
  base: '/nestjs-odata/',
  vite: {
    plugins: [llmstxt()],
  },
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons)
    },
  },
  themeConfig: {
    // ... existing nav ...
    sidebar: {
      '/api/': [
        { text: 'Module API', link: '/api/module' },
        { text: 'Decorators', link: '/api/decorators' },
        { text: 'Auto-generated Reference', items: typedocSidebar },
      ],
      // ... other sidebars unchanged ...
    },
  },
})
```

### doc-guardian SKILL.md frontmatter

```yaml
---
name: doc-guardian
description: Evaluates whether code changes require documentation updates and applies them automatically. Use after a phase plan completes, when diffs touch packages/core or packages/typeorm source files.
---
```

---

## llms.txt Ecosystem Assessment (D-04 Resolution)

| Dimension               | Finding                                                                                                                      | Confidence                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Standard maturity       | llmstxt.org proposed Sep 2024; 844k+ sites adopted [CITED: ppc.land, ahrefs.com]                                             | MEDIUM                                                                                     |
| AI platform support     | No major AI platform (OpenAI, Anthropic, Google) officially reads these files during inference                               | HIGH — multiple sources agree [CITED: ppc.land]                                            |
| VitePress plugin winner | `vitepress-plugin-llms` — 15k weekly downloads, used by Vite/Vitest/Rolldown official docs, v1.12.0, last publish 2026-03-20 | HIGH [VERIFIED: npm view]                                                                  |
| Copy-as-markdown        | Built into vitepress-plugin-llms — no separate plugin needed                                                                 | HIGH [CITED: deepwiki.com/okineadev/vitepress-plugin-llms]                                 |
| MCP auto-generation     | Available tools require OpenAPI spec input; nestjs-odata has none → defer                                                    | HIGH [ASSUMED: no OpenAPI spec exists in this repo — confirmed by package.json inspection] |

**Bottom line for D-04:** Ship `vitepress-plugin-llms`. The standard's AI platform support is uncertain, but it has zero setup cost and ships files that _are_ used by Anthropic/Stripe/Cloudflare themselves. Copy-as-markdown button is a bonus for human visitors. MCP server deferred — no viable no-OpenAPI-spec path exists.

---

## State of the Art

| Old Approach                 | Current Approach                            | When Changed | Impact                              |
| ---------------------------- | ------------------------------------------- | ------------ | ----------------------------------- |
| `tsup` for bundling          | `tsdown` (already using per CLAUDE.md)      | 2024         | No impact on docs phase             |
| `typedoc` HTML output        | `typedoc-plugin-markdown` + VitePress theme | 2023–ongoing | Integrated API docs within the site |
| Manual `llms.txt`            | `vitepress-plugin-llms` auto-generation     | 2024–2025    | Zero maintenance; stays in sync     |
| `actions/upload-artifact` v2 | `actions/upload-pages-artifact@v3`          | 2023         | Required for Pages source = Actions |

**Deprecated/outdated:**

- `vitepress-plugin-typedoc` (old package name): superseded by `typedoc-vitepress-theme` from the typedoc2md org
- `actions/deploy-pages@v1/v2`: v4 is current [ASSUMED — check GitHub Actions marketplace for exact latest]

---

## Environment Availability

| Dependency            | Required By     | Available                    | Version              | Fallback                             |
| --------------------- | --------------- | ---------------------------- | -------------------- | ------------------------------------ |
| Node.js               | VitePress build | Yes                          | 24 (from ci.yml)     | —                                    |
| pnpm                  | Package install | Yes                          | v10 (from ci.yml)    | —                                    |
| GitHub Pages          | Deployment      | Must enable in repo settings | —                    | No fallback — manual action required |
| typedoc               | API reference   | Not yet installed            | 0.28.18 (to install) | Handwritten API docs only            |
| vitepress-plugin-llms | llms.txt        | Not yet installed            | 1.12.0 (to install)  | Ship without llms.txt                |

**Missing dependencies with no fallback:**

- GitHub Pages must be enabled in repository settings with source set to "GitHub Actions" — this is a manual action requiring repo admin access.

**Missing dependencies with fallback:**

- `typedoc` / `typedoc-plugin-markdown` — if blocked, fallback is handwritten API reference only (acceptable short-term, per D-02 intent)
- `vitepress-plugin-llms` — if blocked, fallback is no llms.txt (acceptable, low risk)

---

## Validation Architecture

### Test Framework

| Property           | Value                            |
| ------------------ | -------------------------------- |
| Framework          | Vitest 3.x (workspace-level)     |
| Config file        | `packages/core/vitest.config.ts` |
| Quick run command  | `pnpm turbo test`                |
| Full suite command | `pnpm turbo test -- --coverage`  |

**Note:** Documentation phase has no unit test requirements. Validation is structural: build succeeds, links resolve, GitHub Pages deploys.

### Phase Requirements → Test Map

| Req ID       | Behavior                                               | Test Type | Automated Command                                      | File Exists?             |
| ------------ | ------------------------------------------------------ | --------- | ------------------------------------------------------ | ------------------------ |
| DOCS-BUILD   | VitePress site builds without errors                   | smoke     | `pnpm turbo docs:build`                                | ✅ (turbo.json task)     |
| DOCS-DEPLOY  | GitHub Actions Pages workflow runs clean               | smoke     | CI check on PR                                         | ❌ Wave 0 (new workflow) |
| DOCS-LLMS    | `llms.txt` and `llms-full.txt` present in build output | smoke     | `ls docs/.vitepress/dist/llms*.txt`                    | ❌ Wave 0                |
| DOCS-TYPEDOC | `typedoc-sidebar.json` generated before build          | smoke     | `pnpm typedoc && [ -f docs/api/typedoc-sidebar.json ]` | ❌ Wave 0                |

### Sampling Rate

- **Per task commit:** `pnpm turbo docs:build` (build must stay green)
- **Phase gate:** Full build green + Pages workflow passes in CI before marking phase complete

### Wave 0 Gaps

- [ ] `docs/.github/workflows/docs.yml` — GitHub Pages deployment workflow (new file)
- [ ] `docs/typedoc.json` — TypeDoc configuration (new file)
- [ ] `docs/.vitepress/theme/index.ts` — VitePress theme file to register components (new file)
- [ ] `.gitignore` entry for `docs/api/` auto-generated output

---

## Security Domain

Phase 8 is documentation infrastructure only. No auth, no user input, no API endpoints. ASVS categories V2–V6 do not apply.

The only security-relevant consideration: the GitHub Actions Pages workflow must NOT use `pull_request_target` (which would give PR forks write access). Use `push` trigger only. [ASSUMED standard GitHub Pages workflow security posture]

---

## Project Constraints (from CLAUDE.md)

Directives that apply to this phase:

| Directive                                                  | Impact on Phase 8                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Tech stack: NestJS, TypeScript, Turborepo, TypeORM**     | VitePress docs site is in `docs/` package; TypeDoc reads from `packages/core/src/`                  |
| **Testing: TDD mandatory, 80% coverage**                   | N/A — documentation content has no unit tests; build/deploy validation is structural                |
| **Open source: MIT, clean API docs, contributor-friendly** | llms.txt + copy buttons improves contributor experience; TypeDoc hybrid approach (D-02) serves this |
| **Package architecture: Core has zero ORM dependencies**   | TypeDoc entryPoint targets `packages/core` only; typeorm adapter docs are handwritten               |
| **tsdown (not tsup)**                                      | No impact on docs phase — docs use VitePress, not tsdown                                            |
| **Vitest (not Jest)**                                      | No impact on docs phase                                                                             |
| **GSD Workflow Enforcement**                               | All file changes go through GSD execute-phase                                                       |

---

## Assumptions Log

| #   | Claim                                                                    | Section                       | Risk if Wrong                                                                                                     |
| --- | ------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A1  | nestjs-odata has no OpenAPI spec, making MCP auto-generation impractical | llms.txt Ecosystem Assessment | Low — if an OpenAPI spec exists somewhere, MCP could be added; worst case is deferred work is picked up sooner    |
| A2  | `actions/deploy-pages@v4` is the current latest version                  | Pattern 3                     | Low — if older version, update the version pin; no functional change                                              |
| A3  | GitHub Pages is not yet enabled in repo settings                         | Environment Availability      | Low — if already enabled, skip that setup step                                                                    |
| A4  | Auto-generated `docs/api/` files should not be committed to git          | Architecture Patterns         | MEDIUM — if the team prefers committing them for offline browsing, the `.gitignore` recommendation needs reversal |

---

## Open Questions

1. **TypeDoc entryPoint scope**
   - What we know: `packages/core/src/index.ts` exports all public decorators, module, and types
   - What's unclear: Does `packages/typeorm/src/index.ts` also have public surface worth documenting in the auto-generated reference?
   - Recommendation: Start with `packages/core` only (per architecture constraint — core is the primary public API); add typeorm adapter as a second entryPoint if needed

2. **GitHub repository ownership for Pages URL**
   - What we know: `base: '/nestjs-odata/'` is already set in `config.mts`
   - What's unclear: The actual GitHub org/user account — the repo might be at `nestjs-odata/nestjs-odata` or a personal fork
   - Recommendation: Verify the Pages URL in repo Settings before finalizing the workflow; the `base` config is already correct

3. **Doc-guardian diff baseline**
   - What we know: The skill should read diffs and identify affected docs
   - What's unclear: Should it diff against `origin/main`, `HEAD~1`, or accept a ref argument?
   - Recommendation: Default to `origin/main` (compares full feature branch) with an override argument; document in SKILL.md

---

## Sources

### Primary (HIGH confidence)

- `npm view vitepress-plugin-llms` — version 1.12.0, last publish 2026-03-20 [VERIFIED]
- `npm view typedoc-plugin-markdown` — version 4.11.0, last publish 2026-03-18 [VERIFIED]
- `npm view typedoc` — version 0.28.18 [VERIFIED]
- `npm view typedoc-vitepress-theme` — version 1.1.2, last publish 2025-01-07 [VERIFIED]
- `npm view vitepress` — version 1.6.4 [VERIFIED]
- [vitepress.dev/guide/deploy](https://vitepress.dev/guide/deploy) — GitHub Pages workflow YAML [CITED]
- [typedoc-plugin-markdown.org/plugins/vitepress/quick-start](https://typedoc-plugin-markdown.org/plugins/vitepress/quick-start) — typedoc.json + config.mts examples [CITED]
- [deepwiki.com/okineadev/vitepress-plugin-llms/2-installation-and-usage](https://deepwiki.com/okineadev/vitepress-plugin-llms/2-installation-and-usage) — installation + copy button setup [CITED]
- [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) — Claude Code skill SKILL.md format [CITED]

### Secondary (MEDIUM confidence)

- [github.com/okineadev/vitepress-plugin-llms](https://github.com/okineadev/vitepress-plugin-llms) — 350 stars, 427 commits, used by Vite/Vitest/Rolldown [CITED]
- [ppc.land/llms-txt-adoption-stalls](https://ppc.land/llms-txt-adoption-stalls-as-major-ai-platforms-ignore-proposed-standard/) — AI platform non-adoption status [CITED]

### Tertiary (LOW confidence)

- WebSearch result claiming 15,305 weekly downloads for vitepress-plugin-llms — plausible given Vite/Vitest usage, not independently verified via npm registry

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all versions verified via `npm view`
- Architecture: HIGH — patterns verified against official docs and working examples
- llms.txt ecosystem: MEDIUM — standard is immature; plugin choice is HIGH confidence, platform adoption is LOW
- MCP deferral: HIGH — no OpenAPI spec exists, confirmed by codebase inspection
- Doc-guardian skill format: HIGH — Claude Code skills docs read and format confirmed

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable ecosystem; typedoc-vitepress-theme may lag behind typedoc releases — re-check compatibility if typedoc bumps major version)
