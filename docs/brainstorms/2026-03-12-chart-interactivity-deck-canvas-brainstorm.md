# Chart Interactivity: Deck + Canvas → Chat Context

**Date:** 2026-03-12
**Status:** Brainstormed
**Type:** Feature

---

## What We're Building

Charts in deck slides and canvas cards are currently non-interactive: no hover tooltips, no click behavior. This feature adds:

1. **Hover tooltips** — Recharts `<Tooltip>` works in canvas/deck cards (same as chat variant)
2. **Click-to-context** — Clicking any data point injects a chart context chip into the sidebar chat input, similar to the `@` mentions UX. The user then types their question and the LLM receives the chart data as grounded context.

The experience mirrors tapping an `@`-mentioned entity: a removable chip appears in the chat input with the chart title and the clicked data point, and the full `ChartSpec` + data rows travel with the message to the API.

---

## Why This Approach

- **Consistent with existing UX**: The `@` mention chip pattern already exists. Reusing it avoids inventing new interaction vocabulary.
- **Canvas and deck already share `ChartRenderer`**: Pointer event fixes and the `onDataPointClick` callback apply in one place, propagating to both surfaces.
- **LLM grounding matters**: Sending just a text prefill ("explain Oct 15") is ambiguous. Serializing the full chart data means the LLM can answer precisely without re-querying DuckDB.

---

## Key Decisions

### 1. Pointer events fix (deck + canvas)

**Problem:** Deck chart cards don't pass `interactive={true}` to `ChartRenderer`. Without it, `ReportChart` wraps the Recharts container in `pointerEvents: "none"`, killing both hover and click.

**Fix:** Deck cards (in `DeckCanvas` / `BoardCard` rendering) must pass `interactive={true}` and `onDataPointClick` — same pattern already used in canvas `card-renderers/chart-renderer.tsx`.

**Conflict:** tldraw swallows pointer events for pan/zoom. The existing canvas fix adds `nodrag nopan nowheel` CSS classes to the chart wrapper when `interactive` is true. The same classes must be applied in the deck renderer.

---

### 2. Chart context chip — new attachment type

The chat input gains a `ChartAttachment` type alongside entity mention chips:

```ts
type ChartAttachment = {
  type: "chart";
  chartTitle: string;           // e.g. "Daily Revenue — Oct 1–30"
  clickedPoint?: {
    label: string;              // x-axis value, e.g. "2019-10-15"
    measure: string;            // human label, e.g. "Revenue"
    value: number | string;     // e.g. 9700000
  };
  spec: ChartSpec;              // full ChartSpec for LLM context
  data: Record<string, unknown>[];  // all data rows (capped at 30)
};
```

The chip renders as a small removable pill in the chat input area (matching `@` mention style):
- Icon: a tiny bar-chart phosphor icon
- Label: `"[Chart title] · Oct 15: $9.7M"`
- Dismissible with `×`

---

### 3. Triggering the chip

**Flow:**
1. User hovers a data point → Recharts tooltip appears (no chat involvement)
2. User clicks a data point → `onDataPointClick` fires with `{ column, value, measure, measureKey, screenX, screenY }`
3. The deck/canvas handler calls `injectChartContext(spec, data, clickedPoint)` from a shared utility
4. This function: focuses the sidebar chat input + prepends a `ChartAttachment` chip to the input state
5. User types their question (e.g., "why did revenue spike here?") and sends
6. The API receives the chip's serialized context before the user's message text

**Clicking chart background (no specific point):** Also works — chip is injected with `clickedPoint: undefined`, chip label is just the chart title.

---

### 4. API context serialization

When the message is sent, `ChartAttachment` is serialized as a structured block prepended to the user message:

```
[Chart context: Daily Revenue — Oct 1–30]
Clicked data point: 2019-10-15, Revenue = $9,700,000
Full data: [{ date: "2019-10-01", revenue: 6600000 }, ...]

User question: why did revenue spike here?
```

The existing `/api/analyze` and `/api/chat` routes receive this as part of the message — no new API endpoints needed.

---

### 5. Deck vs canvas — shared callback

Both deck and canvas call the same callback signature:
```ts
onDataPointClick: (event: ChartDataPointClick, spec: ChartSpec, data: Row[]) => void
```

The callback is provided by the outer context (canvas page, deck page) and threads down through `ChartRenderer → ReportChart`. The deck page wires it to `injectChartContext`; canvas page does the same.

---

## Open Questions

1. **Full data vs summary stats in LLM context?** Sending all 30 rows is verbose. Alternative: send only summary stats (min, max, avg, the clicked row). Leaning toward full data for now since it's capped at 30 rows.

2. **Clicking without a focused point (chart background)?** Decided yes — treat as "ask about this whole chart." Chip label = chart title only.

3. **Multiple chips?** If user clicks two different charts before sending, do both chips appear? Probably yes — they're additive like multiple `@` mentions.

4. **Canvas selection conflict?** In canvas, the chart card must be *selected* before click events reach Recharts. Deck doesn't have this constraint (no tldraw selection model). Deck should be always-interactive when in presentation or edit mode.

---

## What's Out of Scope

- Zoom / pan / brush on the chart itself
- A popover "ask about this" intermediate step
- New API endpoints (serialization goes into existing message context)
- Modifying the LLM system prompt (chart context is self-describing inline)

---

## Files Likely Affected

| File | Change |
|------|--------|
| `src/components/chart/report-chart.tsx` | Ensure `variant="canvas"` tooltip works when `interactive=false` (tooltips should always be on, only click gated) |
| `src/components/canvas/card-renderers/chart-renderer.tsx` | Pass `data` through to `onDataPointClick` callback |
| `src/components/deck/deck-canvas.tsx` | Pass `interactive={true}` + `onDataPointClick` to chart cards |
| `src/components/chat/chat-input.tsx` (or equivalent) | Add `ChartAttachment` chip support |
| `src/lib/chart-types.ts` | Add `ChartAttachment` type + `ChartDataPointClick` data extension |
| New: `src/lib/chart-context-inject.ts` | `injectChartContext()` utility called by both canvas + deck |
