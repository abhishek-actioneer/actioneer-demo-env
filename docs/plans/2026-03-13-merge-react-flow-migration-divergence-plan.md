# Plan: Merge react-flow-migration Branch Divergence

**Date:** 2026-03-13
**Branch:** react-flow-migration
**Situation:** Local (your 5 commits) and origin/react-flow-migration (Vimarsh's 4 commits) have diverged from `0561c7d`.

---

## Context: What Diverged

### Your 5 local commits (NOT on origin)
| Commit | Description |
|--------|-------------|
| `aa3a1b1` | fix(deck): set nameKey/valueKey for pie ChartSpec |
| `b021dda` | fix(sidebar): cmd+click nav items opens new tab |
| `5cf8f5c` | feat(sidebar): dataset upload to workspace switcher |
| `ac03ec8` | feat(deck): pin sidebar chat cards to active deck canvas |
| `36f4bc4` | feat(deck): add follow-up question FAB to deck canvas |

### Vimarsh's 4 commits (on origin, NOT local)
| Commit | Description |
|--------|-------------|
| `d6ac586` | fix: board route params and auto-redirect after board creation |
| `fff10af` | feat: compact metric cards, trimmed prose, board UX improvements |
| `cead609` | feat: board delete operations with ghost placeholders |
| `750f32c` | feat: board document view, research-to-board flow, sidebar boards nav |

---

## Conflict Analysis

### 1. `src/components/sidebar.tsx` — COMMITTED CONFLICT (must be manually merged)

**Your changes:**
- Added `Link` import from next/link
- Added `Upload` icon from lucide-react
- Added `DatasetUploadModal` component + `uploadModalOpen` state
- Upload dataset button in workspace switcher dropdown
- `MiniRailIcon` now uses `href` prop (Link-based) instead of `onClick={() => router.push(...)}`
- `mounted` guard around `FolderSection` (SSR safety)

**Vimarsh's changes:**
- Added `Layers` icon from lucide-react
- Added `saveBoard`, `removeBoard` from `board-store`
- Reads `boards`, `activeBoardId`, `setActiveBoardId`, `notifyBoardChanged` from sidebar context
- Added `boardsOpen` state
- Added `handleNewBoard`, `handleDeleteBoard` callbacks
- Removed `Canvas` from `NAV_ITEMS` array
- Added an expandable "Boards" section in the sidebar body

**Decision required:** Both sets of changes are additive and in different sections of the file. They can be merged together. Key question: **do you want to keep "Canvas" removed from NAV_ITEMS?** (Vimarsh removed it; your commits don't touch NAV_ITEMS.)

### 2. `src/hooks/use-analytics.ts` — UNCOMMITTED OVERLAP (easy merge)

**Your uncommitted changes:**
- Added `silentContext?: string` param to `handleSend`
- Injects `silentContext` into `knowledgeCtx` and `pageContext`

**Vimarsh's committed changes:**
- Added `columns`/`previewData` retention on query_result events
- Appends `report-cta` message after deep research completes

**Assessment:** Completely independent — different lines, different concerns. Can apply both with no conflict.

### 3. `src/lib/board-types.ts` — UNCOMMITTED OVERLAP (easy merge)

**Your uncommitted changes:**
- Added `silentContext?: string` to `BoardCard` interface

**Vimarsh's committed changes:**
- Added `viewMode`, `globalTimeRange` to `Board`
- Added `SectionLayout` type
- Added `BoardSection` interface
- Added `sectionId`, `orderInSection` to `BoardCard`

**Assessment:** Completely independent additions. Can apply both with no conflict.

### 4. `src/app/canvas/[id]/page.tsx` — IDENTICAL CHANGE (no conflict)

Both you and Vimarsh made the exact same change: updating `params` to `Promise<{ id: string }>` using React 19's `use()`. Your uncommitted local change is identical to what Vimarsh committed. No merge work needed.

---

## Merge Strategy: `git merge origin/react-flow-migration`

A standard merge (not rebase) is recommended because both sides have meaningful commit histories that should be preserved.

### Step-by-Step

- [ ] **Step 1: Stash uncommitted working tree changes**
  ```bash
  git stash push -m "wip: silentContext, canvas params, deck renderer changes"
  ```

- [ ] **Step 2: Run the merge**
  ```bash
  git merge origin/react-flow-migration
  ```
  Expected: conflict on `src/components/sidebar.tsx` only. All other files merge cleanly.

- [ ] **Step 3: Resolve `sidebar.tsx` conflict**
  Merge strategy: keep ALL changes from both sides (they're additive):
  - Keep your: `Link` import, `Upload` icon, `DatasetUploadModal`, upload button in dropdown, `MiniRailIcon href` prop, `mounted` guard on FolderSection
  - Keep Vimarsh's: `Layers` icon, board-store imports, sidebar context board fields, `boardsOpen` state, `handleNewBoard`/`handleDeleteBoard`, expandable Boards section
  - **Decision point**: Canvas removed from NAV_ITEMS by Vimarsh — confirm you're OK with this

- [ ] **Step 4: Complete the merge commit**
  ```bash
  git add src/components/sidebar.tsx
  git commit
  ```

- [ ] **Step 5: Pop the stash**
  ```bash
  git stash pop
  ```
  The stash changes (`silentContext` additions, deck renderers, etc.) should apply cleanly since they don't overlap with merge changes.

- [ ] **Step 6: Verify build passes**
  ```bash
  pnpm build
  ```

- [ ] **Step 7: Push**
  ```bash
  git push origin react-flow-migration
  ```

---

## Decision Points for User

Before executing, answer these:

1. **Canvas removed from nav?** Vimarsh removed `{ icon: LayoutDashboard, label: "Canvas", href: "/canvas", page: "canvas" }` from `NAV_ITEMS`. Keep this removal? (Canvas is still accessible at `/canvas/[id]`)

2. **Merge vs rebase?** This plan uses merge (preserves history of both sides). Prefer `git rebase origin/react-flow-migration` instead for linear history? (More complex to execute with the stash; conflicts would appear one commit at a time.)

3. **Stash or commit WIP?** The uncommitted changes are meaningful features (`silentContext` for deck follow-ups, deck renderers, etc.). Stash is fine for the merge; consider committing them properly after the merge.
