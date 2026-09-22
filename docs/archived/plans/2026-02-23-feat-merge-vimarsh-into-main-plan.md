---
title: "Merge vimarsh branch into main (production-readiness)"
type: feat
date: 2026-02-23
---

# Merge vimarsh into main — Production Readiness

## Overview

Merge `origin/vimarsh` into `main` on branch `merge/vimarsh-into-main`. vimarsh is a major refactoring pass (dynamic dataset system, hooks extraction, Zod validation, inline actions) that conflicts with main's Railway deployment, onboarding widget, entity detection system, forecasting page, and data catalog page.

**19 atomic tasks** have been pre-defined. This plan organizes them into 5 parallel subagent groups running in isolated git worktrees, plus a sequential final phase.

**Full conflict analysis:** `memory/merge-vimarsh-summary.md`
**Railway finding:** `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md`

---

## Key Decisions (Already Made)

| Question | Decision |
|---|---|
| Dynamic dataset system | ✅ Keep vimarsh's (API-driven, localStorage) |
| Entity detection (@mentions, chip bar) | ✅ Keep (from main) |
| Data catalog + forecasting pages | ✅ Keep (restore from main) |
| Onboarding widget | ✅ Keep (restore into vimarsh's sidebar) |
| topbar.tsx | ✅ Keep vimarsh's version |
| CSV fallback in db.ts | ❌ Drop it |
| Railway Volume for dynamic uploads | ⚠️ Document requirement (not a code fix) |

---

## Architecture

### Worktree Strategy

Each group runs in its own git worktree (isolated branch from `main`). Groups work on **non-overlapping file sets** so they never conflict with each other. All branches are merged into `merge/vimarsh-into-main` in the final phase.

```
main ─────────────────────────────────────────────────── merge/vimarsh-into-main
      │                                                        ↑ cherry-pick all
      ├─ .worktrees/group-a-api-routes ──────(commit)────────┤
      ├─ .worktrees/group-b-data-layer ──────(commit)────────┤
      ├─ .worktrees/group-c-chat-components ─(commit)────────┤
      ├─ .worktrees/group-d-shell ───────────(commit)────────┤
      └─ .worktrees/group-e-restore ─────────(commit)────────┘
                                                               ↓
                                              .worktrees/group-f-page-tsx
                                              (sequential, after all above)
```

**Why worktrees instead of direct edits:** Each subagent gets a clean branch without conflict markers. This prevents subagents seeing each other's partial work and makes each commit independently reviewable.

---

## Worktree Setup (Run Before Spawning Subagents)

```bash
# From repo root (must be on main, not the conflict branch)
git checkout main

# Create isolated branches + worktrees for each group
git worktree add .worktrees/group-a-api-routes -b merge/group-a-api-routes
git worktree add .worktrees/group-b-data-layer -b merge/group-b-data-layer
git worktree add .worktrees/group-c-chat-components -b merge/group-c-chat-components
git worktree add .worktrees/group-d-shell -b merge/group-d-shell
git worktree add .worktrees/group-e-restore -b merge/group-e-restore
git worktree add .worktrees/group-f-page-tsx -b merge/group-f-page-tsx
```

---

## Implementation Phases

### Phase 1: Parallel Groups A–E (All Run Simultaneously)

Launch all 5 subagents at once. Each works in its worktree, resolves its files, and commits.

---

#### Group A — API Routes
**Worktree:** `.worktrees/group-a-api-routes`
**Strategy:** Take vimarsh's version with Zod validation. Rename `entityContext` → `knowledgeContext`. Use extracted prompt helpers.
**Tasks:** #4, #5, #6

**Files owned:**
- `src/app/api/analyze/route.ts`
- `src/app/api/chat/route.ts`
- `src/app/api/classify/route.ts`

**Subagent instructions:**
```
Working in .worktrees/group-a-api-routes (branch merge/group-a-api-routes, based on main).

For each file, apply vimarsh's version from origin/vimarsh using:
  git checkout origin/vimarsh -- <file>

Then review and ensure:
1. analyze/route.ts — Uses AnalyzeRequestSchema (Zod), `knowledgeContext` (not entityContext),
   calls getReportGenerationTemplate(ds) and getQuickResponseTemplate(...) instead of inline strings.
2. chat/route.ts — Uses ChatSchema (Zod), `knowledgeContext`.
3. classify/route.ts — Uses ClassifySchema (Zod), drops entityContext entirely from this endpoint.

Also apply these supporting files from vimarsh (no conflicts, just missing from main):
  git checkout origin/vimarsh -- src/lib/prompts/analyze.ts
  git checkout origin/vimarsh -- src/lib/gemini.ts
  git checkout origin/vimarsh -- src/lib/sse-types.ts

Commit: "feat(merge): resolve API route conflicts — Zod validation, knowledgeContext"
```

---

#### Group B — Data Layer
**Worktree:** `.worktrees/group-b-data-layer`
**Strategy:** Take vimarsh's dynamic dataset system wholesale. Drop CSV fallback.
**Tasks:** #2, #3

**Files owned:**
- `src/lib/db.ts`
- `src/lib/dataset-context.tsx`
- `src/lib/datasets/` (entire directory)

**Subagent instructions:**
```
Working in .worktrees/group-b-data-layer (branch merge/group-b-data-layer, based on main).

Apply vimarsh's full dataset system:
  git checkout origin/vimarsh -- src/lib/db.ts
  git checkout origin/vimarsh -- src/lib/dataset-context.tsx
  git checkout origin/vimarsh -- src/lib/datasets/dynamic-registry.ts
  git checkout origin/vimarsh -- src/lib/datasets/schema-enricher.ts
  git checkout origin/vimarsh -- src/lib/datasets/data-profiler.ts
  git checkout origin/vimarsh -- src/lib/datasets/generic-prompts.ts
  git checkout origin/vimarsh -- src/lib/datasets/utils.ts
  git checkout origin/vimarsh -- src/lib/datasets/index.ts
  git checkout origin/vimarsh -- src/lib/datasets/types.ts
  git checkout origin/vimarsh -- src/lib/datasets/ecommerce.ts
  git checkout origin/vimarsh -- src/lib/datasets/quickhelp.ts

Also apply the datasets API endpoints (new in vimarsh):
  git checkout origin/vimarsh -- src/app/api/datasets/route.ts
  git checkout origin/vimarsh -- "src/app/api/datasets/[id]/enrich/route.ts"
  git checkout origin/vimarsh -- "src/app/api/datasets/[id]/prompts/route.ts"
  git checkout origin/vimarsh -- src/app/api/datasets/upload/route.ts

Verify db.ts:
- Uses `connections: Map` + `initConnection()` with catch-and-delete retry pattern
- Does NOT have resolveViewSQL (CSV fallback is removed)
- Integrations seeded with connected: true (intentional demo mock)

Verify dataset-context.tsx:
- Fetches from GET /api/datasets on mount
- Exposes allDatasets: DatasetMeta[] and refreshDatasets
- Persists datasetId in localStorage (SSR-safe getInitialDatasetId)
- No switchLocked

Commit: "feat(merge): resolve data layer conflicts — dynamic dataset system"
```

---

#### Group C — Chat Components
**Worktree:** `.worktrees/group-c-chat-components`
**Strategy:** Merge both branches carefully. Keep entity detection from main. Add SubagentInfo citations from vimarsh. Replace SuggestionCarousel with InlineActions.
**Tasks:** #7, #8, #9, #10

**Files owned:**
- `src/lib/markdown.tsx`
- `src/components/chat/document-view.tsx`
- `src/components/chat/chat-input.tsx`
- `src/components/chat/chat-thread.tsx`

**Subagent instructions:**
```
Working in .worktrees/group-c-chat-components (branch merge/group-c-chat-components, based on main).

Read the full conflict analysis at:
  memory/merge-vimarsh-summary.md (sections for each of these 4 files)

IMPORTANT: All 4 files require careful manual merging (not simply taking one side).

markdown.tsx — MERGE BOTH:
  - Keep main's: DetectableEntity import, entityLookup + onEntityClick props (for [[WikiLink]] rendering)
  - Add vimarsh's: SubagentInfo import from @/lib/types, subagents prop (for citation badge hover tooltips)
  - ParseInlineOptions interface: include BOTH sets of props
  - MarkdownContent signature: { content, onCitationClick, activeCitation, subagents, renderChartActions, entityLookup, onEntityClick }
  - citationOpts: trigger on (onCitationClick || entityLookup)

document-view.tsx — MERGE BOTH IMPORTS:
  - Keep: import type { DetectableEntity } from "@/lib/entity-types"
  - Add: import type { SubagentInfo } from "@/lib/types"
  - Props interface supports both entityLookup/onEntityClick AND subagents

chat-input.tsx — TAKE MAIN (keep entity detection):
  git checkout main -- src/components/chat/chat-input.tsx
  (Keep @mention dropdown, EntityChipBar, entityCatalog, runCatalog, detectEntities, etc.)

chat-thread.tsx — MERGE:
  - Take vimarsh's InlineActions (replace SuggestionCarousel):
      import { InlineActions } from "@/components/chat/inline-actions"
      Render <InlineActions actions={...} onAction={...} onDismiss={...} />
      (no more SuggestionCarousel, no buildCarouselCards, no showCarousel)
  - Keep main's entity props in interface:
      entityLookup?: Map<string, DetectableEntity>
      onEntityClick?: (entity: DetectableEntity) => void
      liveResponseIds?: Set<string>
      onCreateOfferFromCarousel?
  - Add vimarsh's: onDismissCard prop
  - Use vimarsh's simpler agent message lookup:
      const agentMsg = messages.find(...)
      const hasAgentData = !!agentMsg

Also apply these new files from vimarsh (no conflicts):
  git checkout origin/vimarsh -- src/components/chat/inline-actions.tsx
  git checkout origin/vimarsh -- src/components/error-boundary.tsx

Keep entity system files from main (restore if missing):
  git checkout main -- src/lib/entity-context.ts
  git checkout main -- src/lib/entity-detector.ts
  git checkout main -- src/lib/entity-registry.ts
  git checkout main -- src/lib/entity-types.ts
  git checkout main -- src/lib/temporal-parser.ts
  git checkout main -- src/lib/carousel-types.ts
  git checkout main -- src/components/chat/entity-chip-bar.tsx
  git checkout main -- src/components/chat/mention-dropdown.tsx

Commit: "feat(merge): resolve chat component conflicts — keep entity detection, add inline actions"
```

---

#### Group D — Shell Components
**Worktree:** `.worktrees/group-d-shell`
**Strategy:** Take vimarsh's sidebar structure, but add back OnboardingWidget. Accept vimarsh's topbar.
**Tasks:** #11, #12

**Files owned:**
- `src/components/sidebar.tsx`
- `src/components/topbar.tsx`
- `src/components/sidebar/panels.tsx`
- `src/components/sidebar/panel-styles.ts`

**Subagent instructions:**
```
Working in .worktrees/group-d-shell (branch merge/group-d-shell, based on main).

sidebar.tsx — MERGE:
  Start from vimarsh's version:
    git checkout origin/vimarsh -- src/components/sidebar.tsx

  Then add back OnboardingWidget:
  1. Add import: import { OnboardingWidget } from "@/components/onboarding/onboarding-widget"
  2. In the JSX, find the spacer element between nav icons and the user avatar section
  3. Render <OnboardingWidget /> there (same position as in main's sidebar.tsx)

  To see main's OnboardingWidget placement, run:
    git show main:src/components/sidebar.tsx | grep -n -A 5 "OnboardingWidget"

  Keep vimarsh's approach for everything else:
  - Hardcoded nav icons (not SIDEBAR_GROUPS config loop)
  - useRouter for navigation (not Link/href)
  - button-based RailIcon component

topbar.tsx — TAKE VIMARSH:
  git checkout origin/vimarsh -- src/components/topbar.tsx

Apply sidebar panel files from vimarsh:
  git checkout origin/vimarsh -- src/components/sidebar/panels.tsx
  git checkout origin/vimarsh -- src/components/sidebar/panel-styles.ts

Restore onboarding widget (deleted in vimarsh, keep from main):
  git checkout main -- src/components/onboarding/onboarding-widget.tsx

Commit: "feat(merge): resolve sidebar/topbar conflicts — vimarsh structure + onboarding widget"
```

---

#### Group E — Restore from Main
**Worktree:** `.worktrees/group-e-restore`
**Strategy:** Pure git restore operations. No conflict resolution needed — just checkout from the right branch.
**Tasks:** #1, #13, #14, #16, #17, #19

**Files owned:**
- Forecasting page + all forecast components/lib
- Data catalog page + catalog lib files
- Railway deployment files
- GitHub Actions workflows

**Subagent instructions:**
```
Working in .worktrees/group-e-restore (branch merge/group-e-restore, based on main).

1. Restore forecasting page (deleted in vimarsh):
  git checkout main -- src/app/forecasting/page.tsx
  git checkout main -- src/components/forecast/forecast-chart.tsx
  git checkout main -- src/components/forecast/forecast-table.tsx
  git checkout main -- src/components/forecast/inspect-panel.tsx
  git checkout main -- src/components/forecast/row-context-menu.tsx
  git checkout main -- src/lib/forecast-data.ts
  git checkout main -- src/lib/forecast-engine.ts
  git checkout main -- src/lib/forecast-store.ts
  git checkout main -- src/lib/forecast-types.ts
  git checkout main -- src/app/api/forecast/generate-sql/route.ts
  git checkout main -- "src/app/api/forecast/predict/route.ts"
  git checkout main -- src/app/api/forecast/seed/route.ts

2. Restore data catalog page (deleted in vimarsh):
  git checkout main -- src/app/data-catalog/page.tsx
  git checkout main -- src/app/data-catalog/loading.tsx
  git checkout main -- src/lib/catalog-data.ts
  git checkout main -- src/lib/catalog-types.ts

3. Restore Railway deployment files (deleted in vimarsh):
  git checkout main -- nixpacks.toml
  git checkout main -- railway.toml
  git checkout main -- scripts/startup.sh
  git checkout main -- DEPLOY.md

4. Restore GitHub Actions (deleted in vimarsh):
  git checkout main -- .github/workflows/claude-code-review.yml
  git checkout main -- .github/workflows/claude.yml

5. Document Railway Volume requirement — add to DEPLOY.md:
  Open DEPLOY.md and append a section:

  ## Dynamic Dataset Persistence

  User-uploaded datasets are stored in `data/datasets/` (via the vimarsh dynamic registry).
  This directory is ephemeral on Railway. To persist uploads across redeploys:

  1. Railway dashboard → your service → Volumes → Add Volume
  2. Mount path: `/app/data/datasets`
  3. Size: 1 GB minimum

  Static datasets (ecommerce, quickhelp) are unaffected — they are hardcoded TypeScript modules.
  See: docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md

Commit: "feat(merge): restore forecasting, data-catalog, Railway config, GitHub Actions from main; document Railway Volume requirement"
```

---

### Phase 2: page.tsx (Sequential — After Phase 1)

**Worktree:** `.worktrees/group-f-page-tsx`
**Why sequential:** `page.tsx` imports from files resolved in groups A–D. The subagent needs the final shapes of those files to correctly wire up props.
**Task:** #15

**Subagent instructions:**
```
Working in .worktrees/group-f-page-tsx (branch merge/group-f-page-tsx, based on main).

CONTEXT: Read memory/merge-vimarsh-summary.md section "page.tsx (11 hunks)" carefully.

Start from vimarsh's version of page.tsx:
  git checkout origin/vimarsh -- src/app/page.tsx

Then make these targeted modifications:

1. ADD BACK onboarding widget:
   - Find where it was rendered in main: git show main:src/app/page.tsx | grep -n -A 3 "onboarding\|OnboardingWidget"
   - Add the same import and render in the vimarsh-based page.tsx

2. ADD BACK entity context props on <ChatThread>:
   - liveResponseIds={liveResponseIds}
   - entityLookup={entityLookup}
   - onEntityClick={handleEntityClick}
   (Check what main passed: git show main:src/app/page.tsx | grep -n -A 5 "ChatThread")

3. ADD BACK entity props on <ChatInput>:
   - entityCatalog={entityCatalog}
   - runCatalog={runCatalog}

4. ADD BACK create-segment-bigquery action type:
   Find the action type check that includes clevertap, firebase, create-segment.
   Add create-segment-bigquery back to the condition.
   (git show main:src/app/page.tsx | grep -n "create-segment-bigquery")

5. Keep from vimarsh:
   - All hook extractions (usePlaybookCreation, useSegmentCreation, useConversation, usePanel, useAnalytics)
   - handleDismissCard + onDismissCard={handleDismissCard} on ChatThread
   - Simplified handleSavePlaybookPreview stub
   - Correct de-indented offline DB banner structure

6. Also apply new hook files from vimarsh:
   git checkout origin/vimarsh -- src/hooks/use-analytics.ts
   git checkout origin/vimarsh -- src/hooks/use-conversation.ts
   git checkout origin/vimarsh -- src/hooks/use-panel.ts
   git checkout origin/vimarsh -- src/hooks/use-playbook-creation.ts
   git checkout origin/vimarsh -- src/hooks/use-segment-creation.ts

Commit: "feat(merge): resolve page.tsx conflict — vimarsh hooks + entity props + onboarding widget"
```

---

### Phase 3: Final Integration (Sequential)

**In the main repo (not a worktree):**
**Task:** #18

```bash
# 1. Cherry-pick all group commits into merge/vimarsh-into-main
git checkout merge/vimarsh-into-main
git checkout main  # Reset to clean state (abandon old conflict markers)
git checkout -B merge/vimarsh-into-main

# Cherry-pick in order (A→B→C→D→E first, then F)
git cherry-pick merge/group-a-api-routes
git cherry-pick merge/group-b-data-layer
git cherry-pick merge/group-c-chat-components
git cherry-pick merge/group-d-shell
git cherry-pick merge/group-e-restore
git cherry-pick merge/group-f-page-tsx

# 2. Install dependencies (pnpm-lock.yaml and package.json also changed in vimarsh)
git checkout origin/vimarsh -- package.json pnpm-lock.yaml pnpm-workspace.yaml
pnpm install

# 3. Build verification
pnpm build

# 4. Fix any TypeScript errors that surface
# Common failure points:
# - Hook return types (usePlaybookCreation, useSegmentCreation etc.)
# - Props mismatches on ChatThread/ChatInput after entity props were added back
# - Missing imports if any vimarsh-added file references a main-only file
```

**After clean build:**
```bash
# Clean up worktrees
git worktree remove .worktrees/group-a-api-routes
git worktree remove .worktrees/group-b-data-layer
git worktree remove .worktrees/group-c-chat-components
git worktree remove .worktrees/group-d-shell
git worktree remove .worktrees/group-e-restore
git worktree remove .worktrees/group-f-page-tsx
```

---

## Files Owned Per Group (Quick Reference)

| Group | Files | Strategy |
|---|---|---|
| A — API Routes | analyze/route, chat/route, classify/route, lib/prompts/analyze, lib/gemini, lib/sse-types | Take vimarsh |
| B — Data Layer | db.ts, dataset-context.tsx, datasets/*, api/datasets/* | Take vimarsh |
| C — Chat Components | markdown.tsx, document-view.tsx, chat-input.tsx, chat-thread.tsx, entity system files, inline-actions | Manual merge |
| D — Shell | sidebar.tsx, topbar.tsx, sidebar/panels, onboarding-widget | vimarsh + onboarding |
| E — Restore | forecasting/*, data-catalog/*, Railway files, GitHub Actions, DEPLOY.md | git checkout main |
| F — page.tsx | src/app/page.tsx, hooks/* | vimarsh + entity props + onboarding |
| Final | package.json, pnpm-lock.yaml, pnpm-workspace.yaml | Take vimarsh |

---

## Acceptance Criteria

- [ ] `pnpm build` completes with zero TypeScript errors
- [ ] Dynamic dataset system: `GET /api/datasets` returns ecommerce + quickhelp + any uploaded datasets
- [ ] Entity detection active: @mentions and entity chip bar visible in chat input
- [ ] Forecasting page accessible at `/forecasting`
- [ ] Data catalog page accessible at `/data-catalog`
- [ ] Onboarding widget renders in sidebar
- [ ] Topbar renders (vimarsh version)
- [ ] Railway deployment files present (nixpacks.toml, railway.toml, startup.sh)
- [ ] GitHub Actions workflows present
- [ ] DEPLOY.md documents Railway Volume requirement for dynamic datasets

---

## Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| page.tsx prop mismatches (entity props + hooks) | High | Group F runs after all others; read final file shapes before editing |
| Hook return types incompatible | Medium | Read hook files from vimarsh before wiring page.tsx |
| markdown.tsx merge introduces type errors | Medium | Keep both prop sets optional (`?`) |
| pnpm-lock.yaml conflicts (package versions) | Low | Take vimarsh's lock file wholesale; both add compatible packages |
| chat-thread/InlineActions import path wrong | Low | File created by Group C; path is `@/components/chat/inline-actions` |

---

## References

- Full conflict analysis: `memory/merge-vimarsh-summary.md`
- Railway finding: `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md`
- Post-merge audit checklist: `docs/solutions/integration-issues/post-merge-missing-navigation-entry-point.md`
- Task list (19 tasks): Currently in session TaskCreate/TaskList
