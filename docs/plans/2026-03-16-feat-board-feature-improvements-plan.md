---
title: "feat: Board feature improvements (commentary, follow-ups, scalar fix, pin UX)"
type: feat
date: 2026-03-16
brainstorm: docs/brainstorms/2026-03-16-board-feature-improvements-brainstorm.md
---

# feat: Board feature improvements

Four board UX features from agentation feedback. Each is independent and can be implemented/shipped separately.

---

## 1. User-Editable Commentary Cards

### Overview

Add a `"commentary"` card type that users create via AddCardMenu to write markdown notes on boards. Simple textarea edit, rendered via `renderSimpleMarkdown` when not editing.

### Implementation

**`src/lib/board-types.ts`**
- [x] Add `"commentary"` to the `CardType` union (line 38)

**`src/components/board/add-card-menu.tsx`**
- [x] Add `"commentary"` to `CardTypeOption` union (line 9)
- [x] Add entry to `OPTIONS` array: `{ type: "commentary", icon: MessageSquareText, label: "Text", description: "Add a note or annotation" }`
- [x] Handle `"commentary"` in `handleOptionClick` — skip NL query step, directly create a blank card

**`src/components/board/document-view.tsx`**
- [x] In `handleAddCard`, handle `"commentary"` type: create a `BoardCard` with `type: "commentary"`, `markdownContent: ""`, `colSpan: 2` (full width default for prose)

**`src/components/board/card-renderer.tsx`**
- [x] Add `case "commentary":` to the switch. Render a `CommentaryRenderer` component:
  - View mode: render `markdownContent` via `renderSimpleMarkdown` (import from `text-renderer.tsx` — export it first)
  - Edit mode: render `<textarea>` with the raw markdown. Toggle on click.
  - On blur/Cmd+Enter: save via `saveBoardCard(card)` with updated `markdownContent`
  - Empty state: show placeholder "Click to add a note..."

**`src/components/board/section-card-grid.tsx`**
- [x] Add `commentary: 120` to `CARD_HEIGHTS` (shorter default — auto-height will take over)
- [x] Add `"commentary"` to the auto-height types check if one exists, or handle in `SortableCard`

**`src/components/canvas/card-renderers/text-renderer.tsx`**
- [x] Export `renderSimpleMarkdown` so commentary-renderer can reuse it

**Canvas view (tldraw):**
- [x] In `src/components/canvas/shapes/card-content.tsx`, add `case "commentary":` — render read-only via `TextRenderer` (no editing in canvas view, document view only)
- [x] Add `"commentary"` to `AUTO_HEIGHT_TYPES` in `card-shape-util.tsx`

**`src/components/canvas/pin-button.tsx`**
- [x] Add `commentary: { width: 400, height: 200 }` to `CARD_SIZES`

### Edge Cases

- **Empty content:** Show placeholder text, auto-enter edit mode on creation
- **Canvas view:** Read-only, rendered same as text cards
- **Drag/reorder:** Works via existing SortableCard infrastructure
- **mergeFollowUpsIntoText:** Commentary cards should NOT absorb follow-up cards — the merge function checks for `"text"` and `"report"` types only, so commentary is safe

---

## 2. Schema-Aware Follow-Up Suggestions on All Board Routes

### Overview

Add follow-up question generation to `board-from-research` and `board-generate` API routes using the proven `buildTextToSqlPrompt` pattern from `canvas-query`.

### Key Challenge

Board-from-research and board-generate produce chart/metric/table cards but **no text cards**. Follow-up questions only render on text cards (via `AnalysisPanel` in document view). Two options:

**Option A (recommended):** Generate a `"text"` card per section as a summary/analysis card, with `followUpQuestions` attached. This also improves the board by adding prose context between charts.

**Option B:** Extend `CompactMetricCard` and `ChartRenderer` to render follow-up chips. More invasive, lower bang-for-buck.

### Implementation (Option A)

**`src/app/api/board-from-research/route.ts`**
- [x] After building all cards per section, add a follow-up generation step:
  1. Build `cardSummaryLines` from cards in the section (title, type, row count)
  2. Call `generateText()` with `buildTextToSqlPrompt(datasetId)` + `userQuery` + card summaries
  3. Parse the JSON array response (2-3 questions)
  4. Create a `"text"` card with a brief analysis summary as `markdownContent` and `followUpQuestions` set
  5. Append to the section's cards
- [x] Wrap in try/catch — on failure, skip silently (board still works without follow-ups)
- [x] Use `timeoutMs: 8000` to prevent blocking

**`src/app/api/board-generate/route.ts`**
- [x] After generating metric/chart cards per section, add same pattern
- [x] Context for the prompt: `dataset.label` + `dataset.description` + metric names from the section
- [x] No `userQuery` available — use board `name` + `description` as context instead
- [x] Same try/catch + timeout pattern

**Prompt template (extract to shared helper):**

```
src/lib/prompts/follow-up.ts
```

- [x] Create `generateFollowUpQuestions(datasetId, context, cardSummaries)` helper
- [x] Reusable by canvas-query, board-from-research, and board-generate
- [x] Returns `string[]` (2-3 questions) or empty array on failure

**Client persistence:**
- [x] Both routes return JSON — `followUpQuestions` is already a field on `BoardCard`
- [x] Wherever the client saves board cards from these routes, the field will persist automatically
- [x] Verify `populateDemoBoard` / `saveBoardCard` calls include `followUpQuestions`

### Edge Cases

- **LLM failure:** Silent fallback — return board without follow-ups
- **No text card target:** Option A creates a text card, solving this
- **Rate limiting:** One additional LLM call per section. For board-generate with 3 sections, that's 3 extra calls. Acceptable with 8s timeout each.
- **board-generate no userQuery:** Use board name + metric names as context

---

## 3. Fix Scalar Value Chart Display

### Overview

Ensure single-row SQL results in `canvas-query` are displayed as metric cards, not meaningless single-bar charts.

### Implementation

**`src/app/api/canvas-query/route.ts`** — chart execution branch (the `else if (card.type === "chart")` block)

- [x] Before calling `buildChartSpec`, add scalar detection:

```typescript
// If only 1 row returned, demote chart → metric
if (rows.length <= 1) {
  const firstRow = rows[0];
  const numericEntries = Object.entries(firstRow).filter(([, v]) => typeof v === "number" || typeof v === "bigint");
  const heroEntry = numericEntries[0];
  const value = heroEntry ? Number(heroEntry[1]) : null;
  const label = heroEntry ? heroEntry[0] : card.title;

  send({ type: "card-data", cardId: card.cardId, cardType: "metric", heroMetric: formatValue(value), heroLabel: label, data: rows });
  send({ type: "card-complete", cardId: card.cardId });
  continue;
}
```

**Client handling of type mismatch:**
- [x] In `src/hooks/use-canvas-actions.ts` (or wherever canvas SSE events are processed): when a `card-data` event has `cardType: "metric"` but the plan card was `type: "chart"`, update the card's type in the store to `"metric"`. The renderer dispatch (`card-content.tsx`, `card-renderer.tsx`) already uses the card's current type, so once updated, it renders correctly.

**`src/app/api/canvas-query/route.ts`** — `buildChartSpec` function

- [x] Add guard at top: `if (rows.length <= 1) return null;`
- [x] Update return type to `ChartSpec | null`
- [x] Update caller to handle `null` (fallback to table display)

### Edge Cases

- **1 row, multiple numeric columns:** Demote to metric using the first numeric column. The table card (part of the SQL→table→chart triplet) already shows all columns.
- **2-row results:** Leave as charts for now. A future improvement could detect period-comparison patterns.
- **Plan event already emitted as "chart":** The client must handle the type downgrade in the card-data handler. This is a new code path.

---

## 4. Context-Aware Pin Destination

### Overview

Make pinning context-aware: board pages pin directly to the viewed board. Chat/other pages show the board picker. Toast always shows the destination board name.

### Implementation

**`src/components/canvas/pin-button.tsx`**

- [x] Add `targetBoardId?: string` prop to `PinButton`
- [x] Update `handleClick` priority order:
  1. Already pinned → toast, return
  2. Deck page (`getDeckPinBoardId()`) → deck handler (unchanged)
  3. `targetBoardId` provided → validate board exists via `getBoard(datasetId, targetBoardId)`. If exists, `pinToBoard(targetBoardId)`. If deleted, fall through to picker.
  4. No targetBoardId → show `BoardPickerPopover` (remove the `getTargetBoardId` localStorage shortcut)
- [x] Update toast in `pinToBoard`: look up board name via `getBoard(datasetId, boardId)` and show "Pinned to {boardName}"
- [x] If user is already on the target board, suppress the "View" action in the toast (they're already there)

**Board page integration:**
- [x] In `src/app/canvas/[id]/page.tsx` (or wherever PinButton is rendered on board pages): pass `targetBoardId={boardId}` to PinButton
- [x] In `src/components/chat/chat-thread.tsx`: when on a board page, pass `onChartPinned` with the board's ID context

**Remove localStorage shortcut:**
- [x] Delete `getTargetBoardId` function from `board-picker-popover.tsx` (or keep it only as internal to the picker for pre-selecting)
- [x] On non-board pages, always show the picker — no silent auto-pin to an unknown board

### Edge Cases

- **Stale targetBoardId (deleted board):** `getBoard` returns undefined → fall through to picker
- **Deck page takes priority:** Deck path fires before targetBoardId check — this is correct since deck pins go to the React Flow canvas, not board store
- **Duplicate pins:** Pre-existing issue. Not addressed here — acceptable for now.
- **Dataset mismatch:** `getBoard(datasetId, boardId)` is already dataset-scoped, preventing cross-dataset pins

---

## References

- Brainstorm: `docs/brainstorms/2026-03-16-board-feature-improvements-brainstorm.md`
- Learnings: Card renderers must be tldraw-hook-free (`docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`)
- Learnings: buildChartSpec requires 2+ columns (`docs/solutions/runtime-errors/chart-data-not-found-conversion-funnel-missing-charttype.md`)
- Learnings: Three-zone pointer events for interactive card elements (`docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`)
- Learnings: Board grid must use explicit Tailwind classes, not auto-fill (`docs/solutions/ui-bugs/board-grid-auto-fill-shows-3-columns-instead-of-2.md`)
- Key files: `src/lib/board-types.ts`, `src/components/board/add-card-menu.tsx`, `src/components/board/card-renderer.tsx`, `src/app/api/canvas-query/route.ts`, `src/app/api/board-from-research/route.ts`, `src/app/api/board-generate/route.ts`, `src/components/canvas/pin-button.tsx`, `src/lib/chart-inference.ts`
