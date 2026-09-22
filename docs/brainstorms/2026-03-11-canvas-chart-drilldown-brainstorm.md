---
title: Canvas Chart Drill-Down — Click Data Points to Fork Analysis
date: 2026-03-11
status: decided
---

# Canvas Chart Drill-Down

## What We're Building

Click a data point (bar, slice, line point) on any chart card on the canvas → a popover appears with LLM-generated drill-down suggestions + a free-text input → user picks one → a new DAG (SQL → Table → Chart → Summary) materializes downstream of the parent chart, connected by a labeled edge.

This turns the canvas from a collection of static charts into a spatial exploration tool where you drill down visually and the investigation tree shows your reasoning path.

## Why This Matters

In chat, drill-downs are linear — three levels deep and the original chart is 40 messages above. You can't see parent and child side by side, and you can't branch off in a different direction without losing your current path.

On canvas, every branch is visible simultaneously. Click Koramangala on a "Revenue by Hub" chart, see the breakdown. Click Indiranagar on the same chart, get a parallel branch. The canvas IS the investigation — anyone looking at the board can follow the analytical path.

## Why This Approach

**Pure LLM suggestions, no hardcoding.** The Quick Help schema has ~40 columns. Hardcoding drill-down hierarchies per dataset doesn't scale and produces generic suggestions. The LLM has the chart's SQL, the clicked value, and the full schema context — it can figure out that for a hub revenue chart, service type and time trend matter, while weather and traffic density don't.

**Ride existing infrastructure.** The canvas-query NDJSON pipeline, `useCanvasStream`, `computeDAGLayout`, and board-store all exist. The drill-down is just another way to trigger the same flow with extra parent context.

## Key Decisions

1. **No hardcoded suggestions** — All drill-down options come from LLM (Gemini Flash). No per-dataset drill-down hierarchies or heuristic rules.

2. **Popover UX** — Click a data point on a selected chart → popover appears with:
   - Clicked value + measure as header (e.g. "Koramangala Hub — ₹4.2M")
   - Shimmer loading state while LLM generates suggestions (1-2s)
   - 3-4 LLM-generated suggestion buttons
   - Free-text input at the bottom (always available, works even if LLM fails)

3. **Interaction model** — Data point clicks only work on already-selected cards. Unselected cards: click selects the card (React Flow default). Selected cards: clicks pass through to Recharts `onClick` handlers. This prevents conflicts between card selection and chart interaction.

4. **Parent context passed to canvas-query** — When a drill-down triggers, the request includes the parent card's SQL and the filter condition. The LLM rewrites the parent SQL with a new GROUP BY + WHERE clause rather than generating from scratch. This ensures continuity and accuracy.

5. **Edge labeling** — The edge connecting parent chart to child DAG is labeled with the clicked value (e.g. "Koramangala Hub"). This makes the exploration tree self-documenting.

6. **Positioning** — New DAG materializes to the right of the parent chart card, offset down slightly per branch to avoid overlap with sibling drill-downs.

## Concrete Example (Quick Help Dataset)

```
User asks: "Revenue by hub"
→ Bar chart: Koramangala ₹4.2M, Indiranagar ₹3.8M, HSR ₹2.1M...
→ SQL: SELECT hub_name, SUM(booking_value) FROM bookings WHERE payment_status='success' GROUP BY hub_name

Click Koramangala bar → Popover:
  "Koramangala Hub — ₹4.2M"
  [Break down by service type]
  [Show monthly trend]
  [On-time performance comparison]
  [__________________________ Ask something...]

Pick "Break down by service type" →
New DAG: [SQL] → [Table] → [Bar Chart: Koramangala by Service]
Edge label: "Koramangala Hub"
SQL: SELECT service_type, SUM(booking_value) FROM bookings WHERE payment_status='success' AND hub_name='Koramangala Hub' GROUP BY service_type

Click Deep Cleaning bar → another branch grows...

Result: visible exploration tree showing the full reasoning path.
```

## Implementation Touches

1. **chart-renderer.tsx** — Add `onClick` to Recharts `<Bar>`, `<Line>`, `<Area>`, `<Pie>` elements. Callback provides: clicked data entry, axis keys from ChartSpec, parent card ID.

2. **New `DrilldownPopover` component** — Floating popover anchored to click position. Fires LLM call on mount for suggestions. Free-text input always available. Selecting/submitting dismisses and triggers query.

3. **Suggestion generation** — Lightweight LLM call (Gemini Flash, <2s). Input: parent SQL + clicked column/value + schema context. Output: 3-4 suggestion objects as JSON. Could be a new endpoint or inline in canvas-query.

4. **canvas-page.tsx / use-canvas-stream.ts** — Wire chart click → open popover → on selection, call `processStream` with query + parentContext (SQL, filter, parentCardId). Position new DAG downstream of parent. Create labeled edge.

## Open Questions

None — all key decisions resolved in conversation.
