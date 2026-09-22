---
title: Metric Table Cards on Boards
type: feat
status: active
date: 2026-03-24
---

# Metric Table Cards on Boards

## Overview

The Tables tab in the board "Add card" menu currently shows a blank text input. Change it to show the same searchable metric list as the Metrics tab, but create a **table card** (not a chart card) with the metric's underlying SQL data.

## Scope

Two files changed:
1. **`src/components/board/add-card-menu.tsx`** — Tables tab renders metric list instead of bare text input
2. **`src/components/board/document-view.tsx`** — `handleAddCard` handles `type: "table"` with a `metricId`

## Design

### Tables Tab UI

- Fetch metrics from `GET /api/metrics?datasetId=${datasetId}` (same as Metrics tab)
- Show searchable list: metric name + current value
- Clicking a metric emits `{ type: "table", value: metricId, metricName: "Revenue" }`
- Free-text input stays at the top as fallback (goes through existing `runQuery` pipeline)

### Handler

When `handleAddCard` receives `{ type: "table", value: metricId }`:

1. Fetch metric definition (has SQL recipe)
2. Execute SQL via `/api/chart-requery` or direct `apiFetch` to a query endpoint
3. Create `BoardCard` with `type: "table"`, `title: metricName`, `data: rows`, `sql: metricSQL`
4. Save to board-store

No streaming, no LLM — just SQL execution and card creation.

### Rendering

Existing `table-renderer.tsx` handles everything: sorting, pagination, heatmap gradient. No changes needed.

## What Stays the Same

- Metrics tab unchanged (creates chart cards)
- Free-text fallback in Tables tab unchanged (goes through `runQuery`)
- Table renderer unchanged
- Board persistence unchanged
