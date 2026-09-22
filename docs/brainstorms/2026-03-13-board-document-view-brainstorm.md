---
date: 2026-03-13
topic: board-document-view
---

# Board Document View (Mixpanel-Inspired)

## What We're Building

A **document view** for boards — a scrollable, section-based layout that renders the same `BoardCard[]` data as the existing tldraw canvas, but in a Mixpanel-style reading format with sections, AI-generated prose, responsive card grids, and a global time filter.

This is NOT a replacement for the canvas. It's a second view mode on the same `Board` entity. A toggle in the top bar switches between document view (default) and canvas view (tldraw).

Additionally: a **"Save as Board"** button on deep research messages that converts the structured research output (agents, queries, summaries) into a board with sections.

Additionally: **board templates** that provide pre-built section structures for common analysis patterns, populated by AI against the active dataset.

## Why This Approach

The current canvas is great for investigation and exploration (spatial, freeform, connections). But most analytics consumption is **reading** — you want to scroll through your numbers, see what changed, understand why. That's what Mixpanel boards do well: a narrative reading experience with live charts.

By making it a view toggle (not a separate feature), we:
- Reuse all existing card types, store, and APIs
- Let users investigate in canvas, then share as document
- Keep one data model, two renderers

## Key Decisions

### Data Model
- **Add `BoardSection` type** to `board-types.ts` — `{ id, title, prose, layout, cardIds, order }`
- **Add `sections` to `Board`** — `BoardSection[]` stored alongside cards
- **Add `viewMode` to `Board`** — `"document" | "canvas"` (default: `"document"`)
- **Add `globalTimeRange` to `Board`** — `{ preset: string } | { start: string, end: string }`
- **Existing `BoardCard` unchanged** — position/size used by canvas view, section membership used by document view

### Section Layouts
Each section specifies a layout for its cards:
- `"full"` — single card, full width
- `"grid-2"` — two cards side by side
- `"grid-3"` — three cards in a row (metric cards)
- `"text-chart"` — prose block on left, chart on right

Layout is auto-inferred from card types during research→board conversion but editable.

### Card Type Inference (for research→board conversion)
Query result shape → card type:
- 1 row, 1-2 numeric columns → `metric` card
- 1 row, 3+ numeric columns → multiple `metric` cards (one per column)
- Multiple rows with date column → `chart` card (line/area)
- Multiple rows with categorical + numeric → `chart` card (bar)
- Complex multi-column → `table` card
- Retention-shaped data → `chart` card (retention curve)

### Research → Board Conversion
- Button: "Save as Board" on completed deep research messages
- Maps `AgentInfo.subagents[]` → `BoardSection[]`
- Maps `SubagentInfo.summary` → section prose
- Maps `SubagentInfo.queries[].result` → cards (chart/table/metric via inference)
- Maps `message.content` (synthesis) → intro section
- Maps critique agent → "Data Quality Notes" callout section
- No new LLM calls needed — uses existing data

### Templates
Pre-built section structures that AI populates for the active dataset:
- **"Overview"** — KPI metrics row + trend chart + breakdown table
- **"Funnel Analysis"** — conversion funnel + drop-off by step + comparison
- **"Retention"** — retention curve + cohort table + repeat rate metrics
- **"User Segments"** — segment breakdown + engagement tiers + spending distribution

Templates define sections with placeholder queries (NL descriptions). On creation, AI generates SQL from the descriptions against the active dataset schema, executes, and infers card types.

### Global Time Filter
- Renders in top bar next to view toggle
- Presets: 7D, 30D, 90D, 1Y, Custom
- Changing the filter re-runs all SQL queries with modified date WHERE clauses
- Prose does NOT auto-regenerate (too expensive) — shows a "Refresh insights" button instead

### Board List
- Canvas page shows a board list/picker when no board is selected
- Shows board name, card count, last updated
- "New Board" button → blank / from template / from chat

### Route
- Keep `/canvas` route
- `?board=<id>` selects a board (existing behavior)
- `?view=document` / `?view=canvas` controls the view mode
- Default view mode comes from `board.viewMode`

## Open Questions
- Should section prose be editable inline (contenteditable) or via a modal?
- Should "Save as Board" navigate to the board immediately or show a toast with link?
- Do we need a "Regenerate prose" per-section button, or just the global "Refresh insights"?

## Next Steps
→ Implementation plan with phases and file changes
