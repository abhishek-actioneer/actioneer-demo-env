---
title: "feat: Chart interactivity — tooltips + click-to-chat for deck and canvas"
type: feat
date: 2026-03-12
brainstorm: docs/brainstorms/2026-03-12-chart-interactivity-deck-canvas-brainstorm.md
---

# feat: Chart interactivity — tooltips + click-to-chat for deck and canvas

## Overview

Charts in deck slides and canvas cards are currently non-interactive: no hover tooltips, no click behavior. This plan adds:

1. **Hover tooltips** on all chart cards (deck + canvas), separated from click-gating
2. **Click-to-chat injection** — clicking a data point injects a `ContextReference` chip into the sidebar chat input (matching the `@` mention UX). User types their question; the LLM receives the full chart data as grounded context.

Consistent behavior across both surfaces: deck and canvas chart cards behave identically on hover and click.

---

## Problem Statement

### Tooltip gap
`ChartRenderer` (`src/components/canvas/card-renderers/chart-renderer.tsx:7`) sets:
```ts
const interactive = (isSelected || isEditing) && !!onDataPointClick;
// pointerEvents: interactive ? "auto" : "none"
```
This gates **both** tooltips (hover) and clicks on the same `interactive` flag. Result: unselected chart cards have `pointerEvents: none` → Recharts never receives mouse events → no tooltips.

### Deck has no drilldown handler at all
`DeckCanvas` renders `<TldrawCanvas boardId={boardId} />` with **no** `DrilldownHandlerProvider` wrapper. All chart cards in deck get `onDataPointClick={undefined}` and are completely inert. An `openChartChat(slide)` function exists in `DeckCanvas` (line 225) but is suppressed: `void openChartChat`.

### Chat input has no programmatic chip injection
`ChatInputHandle` exposes `focus`, `setValue`, `setQuotedContext`, `suggest` — but no way to inject a `ContextReference` chip from outside the component. The `@` mention chip pattern is internal to user-typed `@` triggers only.

---

## Proposed Solution

### Phase 1 — Fix tooltips (decouple from click gate)

Separate hover-interactivity (pointer events for tooltip) from click-interactivity (full click handler) in `ChartRenderer`:

- `pointerEvents: auto` + `nodrag nopan nowheel` when card **is selected** (both tooltip and click work)
- `pointerEvents: auto` when card **is NOT selected** — tooltips work, but click handler not wired
- Remove the `!!onDataPointClick` gate on pointer events entirely

This means hovering over any chart card (selected or not) shows the Recharts tooltip. Click only fires when selected and a handler is present.

### Phase 2 — Deck click → chat injection

1. Add `addContextRef(ref: ContextReference)` to `ChatInputHandle` imperative API
2. Add `injectChartContext(ref: ContextReference)` to the `ChatPanelState` interface — internally calls `chatInputRef.current?.addContextRef(ref)` and focuses the input
3. Thread `chatInputRef` from `ChatStateProvider` through to `ChatPanelProvider` (or call `useChatState` directly)
4. In `DeckCanvas`: wrap `<TldrawCanvas>` in `<DrilldownHandlerProvider handler={handleDeckDataPointClick}>`
5. `handleDeckDataPointClick(cardId, payload)` maps `cardId` → `slide` (by parsing `${boardId}-slide-${N}-hub`), builds a `ContextReference`, calls `injectChartContext`
6. Replace `void openChartChat` with the new click handler

### Phase 3 — Canvas click → chat injection (consistency)

Update `canvas-page.tsx` drilldown handler to also inject into chat when clicked, replacing the `DrilldownPopover` with the same chat-injection UX. The canvas drilldown generates new SQL cards — that workflow can live on as a separate "Drill into data" button on the canvas card itself (scope for future), but the primary click behavior becomes chat injection.

---

## Technical Considerations

### `ContextReference.type` extension
`ContextReference.type` is currently `EntityType | "conversation" | "page"`. Add `"chart"` to this union in `src/components/chat/context-picker.tsx:15`.

### Chart `contextPayload` serialization
When the message is sent, `use-analytics.ts` or `use-action-handlers.ts` assembles the final prompt. Chart context refs need a serializer that outputs:
```
[Chart context: Daily Revenue — Oct 1–30]
Clicked: 2019-10-15, Revenue = $9,700,000
Data: [{"date":"2019-10-01","revenue":6600000}, ...]
```
Find where `contextRefs` are currently serialized into the LLM prompt and add the `"chart"` case.

### tldraw pointer events conflict
The three-zone pointer events model (from `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`) keeps content at `pointerEvents: none` for drag-through. For chart cards specifically, we must accept that hover will suppress tldraw drag when hovering over a chart area. The `nodrag nopan nowheel` classes prevent pan/zoom interference only when selected — unselected charts will still block drag-through on hover (acceptable tradeoff for tooltip UX).

### Deck `cardId` → `Slide` mapping
Deck cards are named `${boardId}-slide-${slide.index}-hub`. Parse the index from `cardId`, then look up `deck.slides[index]` from the current `deck` state in `DeckCanvas`.

### `ChatPanelProvider` / `ChatStateProvider` threading
`ChatStateProvider` (line 161) already has `chatInputRef`. `ChatPanelProvider` calls `useChatState()`. Add `injectChartContext` to `ChatPanelProvider` that calls `chatInputRef.current?.addContextRef(ref)` — thread `chatInputRef` from `useChatState()` in `ChatPanelProvider`.

### Chat panel open state
If the chat panel is closed when user clicks a chart (on non-home pages), `injectChartContext` should call `panel.open()` + `setRightPanelMode("chat")` before injecting the chip, so the user sees the input with the chip.

---

## Acceptance Criteria

- [x] Hovering over any chart card in deck shows Recharts tooltip (value + label) — card does not need to be selected first
- [x] Hovering over any chart card in canvas shows Recharts tooltip — card does not need to be selected first
- [x] Clicking a data point in a deck chart card injects a chip into the sidebar chat input
- [x] Chip shows chart title + clicked data point (e.g., `📊 Daily Revenue · Oct 15: $9.7M`)
- [x] Chip is dismissible with `×`
- [x] After chip injection, sidebar chat input is focused and chat panel is open
- [x] Sending the message with the chip includes chart data in the LLM context (title, clicked point, all data rows)
- [ ] Clicking canvas chart cards also injects into chat (Phase 3 — deferred)
- [x] Multiple chip clicks before sending are additive (like multiple @mentions)
- [x] TypeScript compiles with no errors after changes
- [x] No regression in canvas drilldown on tldraw pan/zoom behavior when card is not selected

---

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| tldraw drag breaks when hovering unselected chart cards | Accept tradeoff; chart cards with `pointerEvents: auto` will block drag-through. Document as known behavior. |
| `ContextReference.type` union change breaks exhaustive switches | Search for switch statements on `ctxRef.type`; add `"chart"` case everywhere |
| Canvas drilldown popover removal breaks existing canvas workflow | Phase 3 optional — ship Phase 1+2 first, validate deck UX, then decide on canvas |
| `chatInputRef` not accessible in `ChatPanelProvider` | Thread it from `useChatState()` return value; verify at compile time |
| Deck chart cards use `data` field on `BoardCard` but `ChartSpec.data` is the authoritative source | Use `card.chartSpec` (not `card.data`) when building context payload |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/canvas/card-renderers/chart-renderer.tsx` | Decouple `pointerEvents` from click gate; enable hover always |
| `src/components/chat/chat-input.tsx` | Add `addContextRef(ref: ContextReference)` to `ChatInputHandle` + `useImperativeHandle` |
| `src/components/chat/context-picker.tsx` | Add `"chart"` to `ContextReference.type` union |
| `src/components/chat/chat-panel-provider.tsx` | Add `injectChartContext(ref: ContextReference)` + open panel if closed |
| `src/components/chat/chat-state-provider.tsx` | Verify `chatInputRef` is returned by `useChatState()` (likely already is) |
| `src/components/deck/deck-canvas.tsx` | Add `DrilldownHandlerProvider` wrapper; wire `handleDeckDataPointClick`; remove `void openChartChat` |
| `src/hooks/use-analytics.ts` (or context serializer) | Add `"chart"` case to context ref serialization |
| `src/components/canvas/canvas-page.tsx` | (Phase 3) Replace `DrilldownPopover` with chat injection |

---

## References

- Brainstorm: `docs/brainstorms/2026-03-12-chart-interactivity-deck-canvas-brainstorm.md`
- tldraw pointer events pattern: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
- Sidebar state injection pattern: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
- Recharts consistency guide: `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md`
- `ChartRenderer`: `src/components/canvas/card-renderers/chart-renderer.tsx`
- `DeckCanvas`: `src/components/deck/deck-canvas.tsx:225` (stubbed `openChartChat`)
- `ChatInput` + `ChatInputHandle`: `src/components/chat/chat-input.tsx:14`
- `DrilldownHandlerProvider`: `src/components/canvas/drilldown-context.tsx`
- `ContextReference` type: `src/components/chat/context-picker.tsx:13`
- `ChatPanelProvider`: `src/components/chat/chat-panel-provider.tsx`
