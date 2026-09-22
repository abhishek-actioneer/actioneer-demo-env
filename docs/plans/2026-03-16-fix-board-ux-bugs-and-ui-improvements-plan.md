---
title: "fix: Board UX bugs and UI improvements"
type: fix
date: 2026-03-16
---

# fix: Board UX bugs and UI improvements

Five board-related bugs and UI improvements identified via agentation annotations.

## Items

### 1. Chat follow-up buttons don't pre-populate input in side-panel

**Root cause:** `injectText` in `chat-panel-provider.tsx` (line 132) uses a single `requestAnimationFrame` to call `chatInputRef.current?.setValue(text)`. When the panel is closed, `setIsOpen(true)` triggers a React state update, but `ChatInput` hasn't mounted by the time rAF fires — `chatInputRef.current` is `null`, and the text is silently dropped.

**Fix:** Replace the single rAF with a polling mechanism that retries until the ref is populated (with a max retry count to prevent leaks). Apply the same fix to `injectChartContext` and `injectQuotedContext` which share the same pattern.

**Files:**
- `src/components/chat/chat-panel-provider.tsx` — lines 119-137 (`injectText`, `injectChartContext`, `injectQuotedContext`)

**Acceptance criteria:**
- [x] Clicking a follow-up chip on a board card pre-populates the chat input in the side panel
- [x] Works when panel is already open (existing behavior preserved)
- [x] Works when panel is closed (panel opens, input populates after mount)
- [x] `injectChartContext` and `injectQuotedContext` also use the robust mechanism
- [x] Max retry limit (e.g., 10 attempts × 50ms = 500ms timeout) prevents infinite polling
- [x] If ref never populates (edge case), fail silently — don't crash

---

### 2. Card delete button not working in DocumentView

**Root cause:** Tailwind `group/card` naming collision. Both `SortableCard` (`sortable-card.tsx:54`) and `CardRenderer` (`card-renderer.tsx:241`) declare `group/card`. The delete button uses `group-hover/card:opacity-100` but the two nested groups shadow each other, making the delete button's hover state unreliable — it may never become visible/clickable.

**Fix:** Rename the inner group in `CardRenderer` from `group/card` to `group/doccard` (or similar). Update the delete button's hover class to `group-hover/doccard:opacity-100`.

**Files:**
- `src/components/board/card-renderer.tsx` — line 241 (group declaration), lines 254-265 (delete button classes)

**Acceptance criteria:**
- [x] Delete button appears on hover over any card type in document view
- [x] Clicking delete removes the card (ghost placeholder appears)
- [x] Drag handle in `SortableCard` still appears on hover (its `group/card` is unaffected)
- [x] No regression on card selection, click, or drag behaviors

---

### 3. Remove chart summary stats from all charts

**What:** Remove the hero value display ("48.1K Total"), the `StatCell` bottom row (Highest/Lowest/Average), and pie chart stats (Largest/Smallest/Categories) from `ReportChart`.

**Files:**
- `src/components/chart/report-chart.tsx`:
  - Remove `useChartStats` hook (lines 138-183) and its call (line 212)
  - Remove `StatCell` component (lines 128-135)
  - Remove hero value sections: canvas variant (lines 508-526), default variant (lines 603-620)
  - Remove stats footer sections: canvas variant (lines 578-589), default variant stat rows
  - Remove pie chart stats: canvas variant (lines 313-319), default variant (lines 375-382)
  - Remove `chartStats` variable and all references
  - Clean up unused imports (`useMemo` if no longer needed, etc.)

**Acceptance criteria:**
- [x] No summary stats visible on any chart type (bar, line, area, pie) in any context (board cards, chat messages)
- [x] Charts expand to fill the space previously occupied by stats
- [x] No lint warnings for unused variables/imports
- [x] `ResponsiveContainer` fills available height correctly without stats row

---

### 4. Remove AI containers from comment threads

**What:** Remove the `AiBadge` component from comment threads entirely. AI-authored comments should show no author label — just the timestamp.

**Files:**
- `src/components/board/card-comment-thread.tsx`:
  - Remove local `AiBadge` function (~line 62)
  - In `CommentRow`, remove the `isUser ? <span>You</span> : <AiBadge />` conditional for the author label on AI comments. Keep "You" label for user comments.
- `src/components/canvas/card-renderers/shared.tsx`:
  - Remove exported `AiBadge` component (~line 161) — confirmed zero consumers

**Acceptance criteria:**
- [x] AI-authored comments in card comment threads show no author label
- [x] User-authored comments still show "You" label
- [x] Timestamps remain visible for all comments
- [x] No dead code (`AiBadge`) remains in `shared.tsx` or `card-comment-thread.tsx`

---

### 5. Redirect after deleting active board from sidebar

**What:** After deleting a board via the sidebar's 2-click confirm, redirect to `/canvas` if the deleted board was the one being viewed. Also reset `activeBoardId`.

**Files:**
- `src/components/sidebar.tsx`:
  - `handleDeleteBoard` (lines 205-208): After `removeBoard(boardId)` and `notifyBoardChanged()`, check if deleted board matches current route. If so, `router.push("/canvas")`.
  - Reset `activeBoardId` to `null` when the active board is deleted.

**Acceptance criteria:**
- [x] Deleting the currently-viewed board redirects to `/canvas` (board list)
- [x] Deleting a non-active board does NOT navigate (no disruption)
- [x] `activeBoardId` is reset to `null` when active board is deleted
- [x] Deleting the last board redirects to `/canvas` (which will show empty state or seed demo)

## References

- Agentation annotations: 13 total, 5 actionable after triage
- Dropped items: "Board" breadcrumb (already working), collapsed sidebar boards (by design)
- Related learnings: `docs/solutions/ui-bugs/board-grid-auto-fill-shows-3-columns-instead-of-2.md`, `docs/solutions/design-patterns/follow-up-actions-card-redesign.md`
- Convention: delete confirmations should use shadcn `AlertDialog` per CLAUDE.md — the sidebar's inline 2-click pattern is an exception since it's already implemented and working
