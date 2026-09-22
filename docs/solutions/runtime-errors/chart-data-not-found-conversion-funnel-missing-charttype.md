---
title: "Deck canvas slides display 'Chart data not found' for conversion/funnel metrics"
date: 2026-03-11
category: runtime-errors
tags:
  - charting
  - deck-slides
  - sql-generation
  - gemini
  - reanalyze-flow
  - funnel-metrics
symptoms:
  - Conversion rate slides (e.g. "View Cart → Purchase") show blank chart with "Chart data not found"
  - Funnel metrics show null chartSpec despite SQL executing successfully
  - Reanalyze endpoint refreshes commentary but leaves chart rendering broken
  - Slides with scalar SQL results (single-column SELECT) never render charts
components:
  - src/lib/deck-store.ts
  - src/lib/deck-chart-utils.ts
  - src/app/api/decks/process/route.ts
  - src/app/api/decks/[id]/reanalyze/route.ts
severity: high
time_to_solve: "~2 hours (3 compounding bugs)"
related_issues: []
related_docs:
  - docs/solutions/database-issues/duckdb-node-api-v1-usage-patterns.md
  - docs/solutions/logic-errors/classifier-misrouting-composite-queries.md
---

# Deck Slides: "Chart data not found" for Conversion/Funnel Metrics

## Symptoms

After uploading a PDF deck, slides representing funnel or conversion metrics (e.g. "View Cart → Purchase", "Signup Conversion Rate") displayed a blank chart area with the message "Chart data not found." Other slides with multi-column time-series data rendered correctly.

Triggering "Re-analyze" updated commentary but left the chart blank on those slides.

---

## Root Cause

Three compounding bugs, each of which would silently prevent chart rendering:

### Bug 1: SQL generated for conversion metrics was single-column

Gemini commonly generates aggregation-only SQL for conversion rate slides:

```sql
SELECT COUNT(DISTINCT CASE WHEN event_type='purchase' THEN user_id END) * 1.0 /
  NULLIF(COUNT(DISTINCT CASE WHEN event_type='cart' THEN user_id END), 0) AS view_to_purchase_rate
FROM events
```

This returns one row, one column: `{ view_to_purchase_rate: 0.42 }`. The `buildChartSpec()` function requires at least 2 columns and returned `null`, so `chartSpec` was stored as `null` even though the query succeeded.

### Bug 2: Reanalyze route never rebuilt `chartSpec`

`/api/decks/[id]/reanalyze` updated `data`, `commentary`, and `followUps` on each slide, but never called `buildChartSpec()` after getting fresh query results. The slide's `chartSpec` remained whatever was stored from the original (broken) upload — `null`.

```typescript
// BEFORE — chartSpec not touched:
d.slides[idx] = {
  ...d.slides[idx],
  data: newData,       // ✅ updated
  commentary,          // ✅ updated
  // chartSpec: ← never rebuilt
};
```

### Bug 3: Reanalyze route ignored SQL errors and didn't pass `datasetId`

```typescript
// BEFORE:
const result = await executeSQL(slide.sql);              // ← missing datasetId
newData = (result.rows ?? []).slice(0, 10) as ...;       // ← ignores result.error
```

If the stored SQL failed (wrong column name, DuckDB syntax), `result.error` was set but ignored. `newData` became `[]` silently. Also, `executeSQL` was called without the dataset context from the request headers.

---

## Solution

### 1. Extract `buildChartSpec` to a shared utility

Created `src/lib/deck-chart-utils.ts` so both `process/route.ts` and `reanalyze/route.ts` can use the same chart building logic:

```typescript
// src/lib/deck-chart-utils.ts
import type { ChartSpec } from "./chart-types";

export function buildChartSpec(
  chartType: string,
  data: Record<string, string | number>[],
  title: string,
  xAxisLabel?: string,
): ChartSpec | null {
  if (chartType === "none" || data.length === 0) return null;
  const keys = Object.keys(data[0] ?? {});
  if (keys.length < 2) return null;  // single scalar — not chart-renderable
  // ...builds ChartSpec with xKey/yKey detection
}
```

### 2. Add `chartType` to `Slide` interface

Added `chartType: string` to the `Slide` interface in `deck-store.ts` so the reanalyze route can access the original chart type without needing to re-run Gemini extraction.

### 3. Strengthen the SQL generation prompt

Added an explicit instruction to `generateSQL()` in `process/route.ts`:

```
IMPORTANT: Always return at least 2 columns — a label/dimension column (text or date)
AND a numeric value column. For conversion or funnel metrics (e.g. view → cart → purchase),
use UNION ALL to return one row per funnel stage, for example:
SELECT 'view_item' AS stage, COUNT(DISTINCT user_id) AS users FROM events WHERE event_type='view_item'
UNION ALL SELECT 'add_to_cart' AS stage, COUNT(DISTINCT user_id) AS users FROM events WHERE event_type='add_to_cart'
UNION ALL SELECT 'purchase' AS stage, COUNT(DISTINCT user_id) AS users FROM events WHERE event_type='purchase'
```

This forces Gemini to return chartable multi-row data instead of a scalar ratio.

### 4. Fix reanalyze route: error checking + chartSpec rebuild

```typescript
// src/app/api/decks/[id]/reanalyze/route.ts — AFTER
import { buildChartSpec } from "@/lib/deck-chart-utils";

if (slide.sql) {
  const result = await executeSQL(slide.sql, datasetId || DEFAULT_DATASET);  // ← datasetId added
  if (result.error) {
    console.error(`[deck-reanalyze] SQL error for slide "${slide.title}": ${result.error}`);
  } else {
    newData = (result.rows ?? []).slice(0, 10) as Record<string, string | number>[];
  }
}

const newChartSpec = newData.length > 0
  ? buildChartSpec(slide.chartType, newData, slide.title)
  : null;

d.slides[idx] = {
  ...d.slides[idx],
  data: newData,
  chartSpec: newChartSpec,   // ← now rebuilt from fresh data
  commentary,
  followUps,
  lastRefreshed: Date.now(),
  status: "ok",
};
```

---

## Prevention

### When adding new Gemini SQL prompts

Always include an explicit column constraint:
- "Return at least 2 columns: one for the dimension/label, one for the metric value."
- For funnel metrics: "Use UNION ALL to return one row per stage."
- Mentally validate: if a `COUNT(*)` or ratio is the only output, that's a scalar — wrong for a chart.

### When adding new routes that execute SQL and update slides

Any route that calls `executeSQL()` and patches a slide **must**:
1. Check `result.error` before using `result.rows`
2. Pass `datasetId` from request headers to `executeSQL()`
3. Call `buildChartSpec()` and store the result in `chartSpec`

### Checklist for deck upload with funnel/conversion slides

- [ ] Upload PDF with a funnel chart slide → chart renders (not blank)
- [ ] Check server logs: no `[deck-process]` errors for funnel slides
- [ ] Trigger Re-analyze → chart still renders, commentary updated
- [ ] Confirm generated SQL has 2+ columns (check DevTools Network → process stream)
- [ ] Upload PDF with a conversion rate metric → should show bar chart of stages, not blank

---

## Key Insight: UNION ALL for Funnel Metrics

The architectural insight is that single-column scalar results (a ratio like `0.42`) are semantically valid SQL but are **not chart-renderable**. The fix is upstream — in the prompt — rather than in `buildChartSpec`. The utility correctly rejects single-column data. The prompt must produce multi-row results:

```sql
-- ❌ Scalar (not chartable):
SELECT purchase_count * 1.0 / view_count AS conversion_rate FROM ...

-- ✅ Funnel (chartable as bar):
SELECT 'view' AS stage, COUNT(*) AS users FROM events WHERE event_type='view_item'
UNION ALL SELECT 'cart' AS stage, COUNT(*) AS users FROM events WHERE event_type='add_to_cart'
UNION ALL SELECT 'purchase' AS stage, COUNT(*) AS users FROM events WHERE event_type='purchase'
```
