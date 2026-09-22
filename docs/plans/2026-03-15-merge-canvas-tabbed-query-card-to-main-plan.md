---
title: "chore: Merge feat/canvas-tabbed-query-card to main and prune branch"
type: chore
date: 2026-03-15
---

# chore: Merge feat/canvas-tabbed-query-card to main and prune branch

## Overview

The `feat/canvas-tabbed-query-card` branch is feature-complete — all acceptance criteria in `2026-03-15-feat-canvas-tabbed-query-result-card-plan.md` are checked. The branch is 5 commits ahead of main. There are also **uncommitted changes and untracked files** that need to be staged and committed before the PR can be opened.

This plan covers: commit remaining work → lint → push → PR → merge → prune.

---

## Commits ahead of main

| SHA | Message |
|---|---|
| `f3a84ca` | fix(canvas): use stopPropagation instead of useEditor in TabButton |
| `18323c3` | feat(canvas): tabbed Chart \| SQL \| Table card |
| `e67318f` | feat(board): chart-stack layout + compact follow-up cards |
| `549d79d` | added PDF > Board flows |
| `6d04b76` | feat(canvas): board from PDF deck |

---

## Uncommitted Changes (must be committed first)

### Modified tracked files (106 lines, 7 files)

These are part of the feature work on this branch and belong in a commit:

| File | Notes |
|---|---|
| `src/app/api/canvas-query/route.ts` | +48 lines — canvas query route updates |
| `src/components/canvas/card-renderers/shared.tsx` | +44 lines — additional shared card renderer code |
| `src/lib/board-types.ts` | +3 lines — type additions |
| `src/lib/canvas-sse-types.ts` | +2 lines — SSE event type additions |
| `src/components/canvas/use-canvas-stream.ts` | +9 lines — small stream fix |
| `src/app/layout.tsx` | +2 lines — layout tweak |
| `package.json` + `pnpm-lock.yaml` | Dependency change |
| `src/components/canvas/card-renderers/insight-renderer.tsx` | Renderer update |
| `src/components/canvas/card-renderers/text-renderer.tsx` | Renderer update |

### Untracked files

| File | Action |
|---|---|
| `docs/brainstorms/2026-03-15-canvas-tabbed-query-result-card-brainstorm.md` | ✅ Commit with docs |
| `docs/brainstorms/2026-03-15-document-view-layout-responsiveness-brainstorm.md` | ✅ Commit with docs |
| `docs/plans/2026-03-15-feat-canvas-tabbed-query-result-card-plan.md` | ✅ Commit with docs |
| `docs/plans/2026-03-15-feat-document-view-chart-stack-layout-plan.md` | ✅ Commit with docs |
| `docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md` | ✅ Commit with docs |
| `src/components/agentation-toolbar.tsx` | ⚠️ **Decide before committing** — unrelated component, may be WIP/experimental. Commit if intentional, stash/drop if not. |

---

## Acceptance Criteria

- [ ] `src/components/agentation-toolbar.tsx` decision made (commit or drop)
- [ ] All uncommitted changes staged and committed with clear message
- [ ] `pnpm lint` passes (0 errors)
- [ ] Branch pushed to origin
- [ ] PR created against `main` with summary of all 5 feature commits
- [ ] PR merged to main (squash or merge commit — follow project convention)
- [ ] Remote branch `feat/canvas-tabbed-query-card` deleted
- [ ] Local branch `feat/canvas-tabbed-query-card` deleted
- [ ] Local `main` fast-forwarded to latest

---

## Step-by-step

### Step 1 — Decide on `agentation-toolbar.tsx`

```
src/components/agentation-toolbar.tsx  ← new untracked file
```

If it's intentional and part of this branch's work: include it in the commit.
If it's a WIP experiment not ready to ship: stash or delete before committing.

### Step 2 — Commit remaining source changes

```bash
# Stage source changes
git add src/app/api/canvas-query/route.ts \
        src/app/layout.tsx \
        src/components/canvas/card-renderers/insight-renderer.tsx \
        src/components/canvas/card-renderers/shared.tsx \
        src/components/canvas/card-renderers/text-renderer.tsx \
        src/components/canvas/use-canvas-stream.ts \
        src/lib/board-types.ts \
        src/lib/canvas-sse-types.ts \
        package.json pnpm-lock.yaml
# Add agentation-toolbar.tsx here if keeping it

git commit -m "feat(canvas): canvas-query route + renderer polish"
```

### Step 3 — Commit docs

```bash
git add docs/brainstorms/2026-03-15-canvas-tabbed-query-result-card-brainstorm.md \
        docs/brainstorms/2026-03-15-document-view-layout-responsiveness-brainstorm.md \
        docs/plans/2026-03-15-feat-canvas-tabbed-query-result-card-plan.md \
        docs/plans/2026-03-15-feat-document-view-chart-stack-layout-plan.md \
        docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md \
        docs/plans/2026-03-15-merge-canvas-tabbed-query-card-to-main-plan.md

git commit -m "docs: brainstorms, plans, and solutions for canvas tabbed card"
```

### Step 4 — Lint check

```bash
pnpm lint
```

Fix any errors before proceeding. Do not skip (`--no-verify`) if lint fails.

### Step 5 — Push and create PR

```bash
git push -u origin feat/canvas-tabbed-query-card

gh pr create \
  --title "feat(canvas): board from PDF, chart-stack layout, tabbed Chart|SQL|Table card" \
  --body "$(cat <<'EOF'
## Summary

- **feat(canvas): board from PDF deck** — PDF upload flow that generates a tldraw board from a slide deck
- **added PDF > Board flows** — additional wiring for the deck-to-board pipeline
- **feat(board): chart-stack layout + compact follow-up cards** — improved board layout with stacked charts and trimmed follow-up card height
- **feat(canvas): tabbed Chart | SQL | Table card** — replaces 3 separate cards per query with a single card; Chart/SQL/Table accessible via tabs
- **fix(canvas): use stopPropagation instead of useEditor in TabButton** — fixes crash when TabButton was rendered outside tldraw canvas context

## What changed

- `ChartCardRenderer` — tab switcher (Chart | SQL | Table) with three-zone pointer-events pattern
- `use-canvas-stream.ts` — suppresses sibling sql/table shapes when a chart card exists in the same query group
- `MIN_CARD_HEIGHT.chart` increased from 440 → 476px to accommodate tab bar
- Board-from-PDF pipeline: `deck-to-board.ts`, `use-deck-upload-to-board.ts`, `canvas/page.tsx` PDF upload entry point
- Zero data-model changes — `BoardCard` already had `sql`, `data`, `chartSpec` fields

## Test plan

- [ ] Canvas query emits one card with Chart | SQL | Table tabs (not 3 separate cards)
- [ ] Tabs not interactive when card is deselected
- [ ] Table-only query: no Chart tab rendered
- [ ] Existing boards with standalone sql/table cards still render (no regression)
- [ ] PDF upload on canvas page creates a board from deck
- [ ] `pnpm lint` passes (0 errors)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 6 — Merge PR

Merge via GitHub UI (or `gh pr merge --merge`). Follow project convention — the existing history shows standard merge commits (`Merge pull request #N`), not squash.

### Step 7 — Prune branch

```bash
# Delete remote branch (GitHub UI does this on merge, or manually:)
git push origin --delete feat/canvas-tabbed-query-card

# Switch to main and pull
git checkout main
git pull

# Delete local branch
git branch -d feat/canvas-tabbed-query-card
```

---

## References

- Brainstorm: `docs/brainstorms/2026-03-15-canvas-tabbed-query-result-card-brainstorm.md`
- Feature plan: `docs/plans/2026-03-15-feat-canvas-tabbed-query-result-card-plan.md`
- tldraw pointer-events solution: `docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`
- ESLint config rules: `memory/` — worktrees must be in `globalIgnores`
