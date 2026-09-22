---
module: Forecasting
date: 2026-02-20
problem_type: best_practice
component: frontend_stimulus
symptoms:
  - "Forecast cells show dash for all base metrics despite sourceQuery being stored on rows"
  - "Client-side trend extrapolation produces unrealistic values unrelated to actual data"
  - "DEFAULT_MODEL references non-existent tables (daily_metrics_summary) and columns (ad_revenue, total_spend)"
  - "Monthly granularity produces only 2 data points from Oct-Nov 2019 dataset"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [forecasting, weekly-granularity, gemini-api, seed-data, time-series, api-routes]
---

# Troubleshooting: Forecast Cells Empty — Switch to Weekly Granularity + Gemini API Forecasting

## Problem
The forecasting spreadsheet stored `sourceQuery` on rows but never executed them, leaving all base metric cells showing "—". Client-side linear trend extrapolation produced unrealistic forecasts, and the model referenced non-existent database tables/columns.

## Environment
- Module: Forecasting
- Stack: Next.js 16, React 19, DuckDB, Google Gemini API
- Affected Components: forecast-engine.ts, forecast-data.ts, forecast-types.ts, forecast-store.ts, forecasting/page.tsx, forecast-table.tsx
- Date: 2026-02-20

## Symptoms
- All base metric cells display "—" (null values) because `sourceQuery` was never executed
- `DEFAULT_MODEL` referenced `daily_metrics_summary` table and `ad_revenue`/`total_spend` columns that don't exist in the schema
- Monthly granularity with Oct-Nov 2019 data produced only 2 data points — insufficient for any meaningful trend
- Client-side `mulberry32` PRNG + linear regression produced forecasts disconnected from actual data patterns

## What Didn't Work

**Direct solution:** The problem was identified through schema analysis and fixed by a comprehensive architecture change from monthly→weekly granularity + replacing client-side forecasting with Gemini API.

## Solution

### Architecture: Keep `resolveTable` Pure, Populate `seedData` Upstream

The key insight was NOT to make `resolveTable` async. Instead:

```
Page loads / metric selected
  → POST /api/forecast/seed   (execute SQL → weekly aggregates)
  → POST /api/forecast/predict (Gemini forecasts next 12 weeks)
  → Both stored in seedData Map
  → resolveTable(model, seedData) fills all cells (sync, pure)
```

### 1. Weekly Column Generation (forecast-engine.ts)

```typescript
// Before (monthly — only 2 data points for Oct-Nov 2019):
const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// After (weekly — 9 historical + 12 forecast weeks):
function toMonday(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(mon.getUTCDate() + diff);
  return mon;
}
// Keys: "2019-10-07", Labels: "7 Oct"
```

### 2. Removed Client-Side Forecasting

Deleted `mulberry32`, `normalRandom`, `buildTrendForecaster`, `hashString`. Base rows now read from seedData for ALL columns (both historical and forecast). Derived rows still use formula evaluation.

### 3. Real SQL Against Actual Schema

```typescript
// Before (broken — non-existent table/columns):
sourceTable: "daily_metrics_summary",
sourceQuery: "SELECT ... SUM(ad_revenue) ... FROM daily_metrics_summary"

// After (real schema — daily_metrics has: date, revenue, purchases, views, unique_users, paying_users):
sourceTable: "daily_metrics",
sourceQuery: "SELECT DATE_TRUNC('week', date) AS week, SUM(revenue) AS value FROM daily_metrics GROUP BY 1 ORDER BY 1"
```

### 4. Two New API Routes

- `POST /api/forecast/seed` — Executes SQL, detects date/value columns, aggregates to weekly. On failure: Gemini auto-fixes SQL once, then returns plain-English error explanation.
- `POST /api/forecast/predict` — Sends historical weekly data to Gemini, gets 12-week forecast back as `{YYYY-MM-DD: number}` JSON.

### 5. Hardcoded BASE_SEED_DATA for Instant Load

Default metrics have pre-computed weekly values so the page renders immediately without waiting for API calls. Gemini forecast fills in forecast columns asynchronously.

### 6. Override Key Format Change

```typescript
// Before:
const overrideKey = `month:${col.key}`;

// After:
const overrideKey = `week:${col.key}`;
```

## Why This Works

1. **Root cause**: The forecast engine assumed monthly granularity, but the dataset (Oct 1 - Nov 30, 2019) spans only 2 months. Weekly granularity gives 9 data points — enough for meaningful trend analysis.

2. **Architecture principle**: `resolveTable` stays pure and synchronous. All async work (SQL execution, Gemini forecasting) happens upstream in the page component, populating `seedData` before resolution runs. This keeps the formula engine simple and testable.

3. **Gemini over client-side**: Linear regression + seeded PRNG can't capture seasonality, market dynamics, or metric-specific patterns. Gemini understands context (e.g., revenue should grow differently than conversion rate).

4. **Schema alignment**: The actual `daily_metrics` table has specific column names (`revenue`, `purchases`, `views`, `unique_users`, `paying_users`) — the old model referenced fabricated columns.

## Prevention

- **Always verify table/column names against `src/lib/datasets/ecommerce.ts`** before writing SQL in forecast models
- **Match granularity to data range**: For 2-month datasets, use weekly (not monthly) to get sufficient data points
- **Keep `resolveTable` pure**: Never add async logic to the formula engine — populate seedData upstream
- **Hardcode default seed data**: Prevents blank page on first load while async forecasts populate
- **Use `week:` prefix for override keys** when using weekly granularity (not `month:`)

## Related Issues

- See also: [recharts-consistency-custom-tooltip-Forecasting-20260220.md](./recharts-consistency-custom-tooltip-Forecasting-20260220.md) — Chart styling for the same forecasting module
