---
title: Board Feature Improvements (5 items)
date: 2026-03-16
status: complete
source: agentation annotations
---

# Board Feature Improvements Brainstorm

Five board UX improvements identified via agentation annotations, brainstormed individually.

---

## 1. User-Editable Markdown Commentary Blocks

### What We're Building

A simple text card type that users can add to any board section and edit inline. Click to edit, plain textarea with basic markdown rendering (bold, lists, code). No toolbar. Like Notion's simplest block.

### Why This Approach

- `"text"` and `"sticky"` card types already exist but are read-only (AI-generated)
- `AddCardMenu` currently offers metric/chart/table/insight — no user-authored text option
- `markdownContent` field already exists on `BoardCard` — just needs an editable render path
- `TextRenderer` already has `renderSimpleMarkdown` — reuse for display mode

### Key Decisions

- **New card type or reuse?** Reuse `"text"` type with a new flag (e.g., `userEditable: true`) or add a new `"commentary"` type. Recommend adding `"commentary"` to avoid conflating AI text cards with user text.
- **Entry point:** Add "Text" option to `AddCardMenu` (`add-card-menu.tsx`)
- **Edit mode:** Click card → textarea appears. Blur/Enter → save via `saveBoardCard`. No contentEditable (too complex, markdown rendering is good enough).
- **Rendering:** When not editing, render `markdownContent` via existing `renderSimpleMarkdown`. When editing, show plain `<textarea>`.

### Open Questions

- Should commentary cards support `colSpan` (full-width)?
- Should they have a visual distinction from AI-generated text cards (e.g., different border or icon)?

---

## 2. Schema-Aware Follow-Up Suggestions on All Board Routes

### What We're Building

Add follow-up question generation to `board-from-research` and `board-generate` API routes, matching the existing pattern in `canvas-query`. Follow-ups should be grounded in actual table schema so they're answerable.

### Why This Approach

- `canvas-query` already does this well: after cards are generated, it calls `buildTextToSqlPrompt(datasetId)` (which includes full DuckDB schema) + card summaries → generates 2-3 schema-aware follow-up questions
- `board-from-research` and `board-generate` skip this step entirely — cards arrive with no `followUpQuestions`
- The infrastructure is proven; just needs to be applied to the other routes

### Key Decisions

- **Reuse the same prompt pattern** from `canvas-query/route.ts` lines 544-608
- **Attach follow-ups to the last text card** in each query group (matching canvas-query behavior)
- **Schema context comes from `buildTextToSqlPrompt(datasetId)`** — already battle-tested, includes column names, types, date ranges
- **Per-card context:** Pass card title, type, row count, and column names to the follow-up prompt so suggestions are contextual to what the card shows

### Open Questions

- Should follow-ups be generated per-section or per-board? (canvas-query does per query-group)
- Rate limit concern: board-generate already makes many LLM calls — adding one more per section. Acceptable?

---

## 3. Fix Scalar Value Chart Display

### What We're Building

Ensure single-value SQL results never render as charts. They should always be `"metric"` cards showing just the number.

### Why This Approach

- `inferCardType` in `chart-inference.ts` already routes 1-row results to `"metric"` — this works for `board-from-research`
- But `buildChartSpec` in `canvas-query/route.ts` is a separate function that doesn't have this guard — it can produce a chart spec for single-value data
- The fix is a guard in `buildChartSpec`: if data has 1 row and 1 numeric column, return `null` (forcing fallback to metric/table)

### Key Decisions

- **Where to fix:** Add a guard at the top of `buildChartSpec` in `canvas-query/route.ts`: `if (rows.length <= 1) return null`
- **Also consolidate:** `buildChartSpec` (canvas-query) and `inferChartSpec` (chart-inference.ts) duplicate logic. Consider extracting to a shared function in `chart-inference.ts`. But this is optional — the guard fix is the priority.
- **Metric card rendering:** `CompactMetricCard` already handles the display well for document view

### Open Questions

- Should we also consolidate the two duplicate chart inference functions? (Nice-to-have, not blocking)

---

## 4. Card Grid Layout — Keep 2-Column Max

### What We're Building

Keep the current 2-column max layout. Ensure cards fill width properly within the 2-column grid. No 3-column layout.

### Why This Approach

- Current `grid-cols-1 md:grid-cols-2` is the right constraint for readability
- The `ResizeObserver` + `colCount` + `colSpan` infrastructure exists but capping at 2 is intentional
- The annotation mentioned 3 columns being forced — this was likely from a previous `auto-fill` bug that was already fixed (see `docs/solutions/ui-bugs/board-grid-auto-fill-shows-3-columns-instead-of-2.md`)

### Key Decisions

- **No layout change needed** — the 2-col max is correct and already implemented
- **Verify `colSpan` works:** Cards with `colSpan: 2` should span full width. This already works via `clampSpan()`.
- **Follow-up context from annotation #4 about schema-aware follow-ups** → covered by item #2 above

### Open Questions

- None — this is resolved. The annotation's concern was already addressed by a prior fix.

---

## 5. Pin Destination — Context-Aware Board Selection

### What We're Building

Make pinning context-aware: if the user is on a board page, pin to that board. If on chat or another page, show the board picker. Always show the destination in the toast.

### Why This Approach

- Current behavior: silently pins to last-used board (localStorage `sentinel-last-used-board-id`). User has no idea where the chart went.
- On board pages, the natural destination is the board being viewed — no picker needed
- On chat/other pages, showing the picker gives the user control
- The toast should always say "Pinned to [Board Name]" with a "View" link

### Key Decisions

- **Board page context:** If `pathname.startsWith("/canvas/")` or there's an `activeBoardId`, pin directly to that board. This already works for deck pages via `getDeckPinBoardId()`.
- **Chat/other pages:** Always show the `BoardPickerPopover` — remove the localStorage shortcut
- **Toast improvement:** Change from generic "Pinned" to "Pinned to {boardName}" with View action
- **Dataset scoping:** Fix the bug where `sentinel-last-used-board-id` is shared across datasets. Either scope the key per dataset or remove the localStorage approach entirely (since we're showing the picker on non-board pages).

### Open Questions

- Should "Pin" on a board page add the card to the current section or to the end of the board?
- If the user is viewing board A but the chat is about board B's data, which board gets the pin?
