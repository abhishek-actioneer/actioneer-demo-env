---
title: "feat: GamerRamp Scatter Chart + Dataset Quality Improvements"
type: feat
date: 2026-03-16
---

# feat: GamerRamp Scatter Chart + Dataset Quality Improvements

## Overview

Three focused improvements to the GamerRamp synthetic dataset and its frontend integration:

1. **Scatter chart support (minimal)** — add `"scatter"` to the chart type union and implement a Recharts `ScatterChart` renderer. Board cards can then be manually pinned with scatter charts. No LLM prompt changes, no deck-processor route changes.
2. **CPI small-scale smoothing** — add a `cac_by_month` pre-aggregated summary table to prevent noisy per-day CPI charts at `--scale 0.1`.
3. **Scenario verification completeness** — add verification queries for scenarios 3, 5, 6 to `setup-gameramp.ts` (currently only scenarios 1, 2, 4 are verified).

> **Scope note:** Deck processing route (`src/app/api/decks/process/route.ts`) is intentionally excluded. Scatter charts will be added to boards manually (pinned cards), not via LLM deck generation.

## Problem Statement

### 1. No Scatter Chart Support

The LLM cannot generate CPI×LTV correlation scatter plots — the chart type union only has `"bar" | "line" | "area" | "pie"`. The deck-processing route (line 147 in `src/app/api/decks/process/route.ts`) already recognizes `"scatter"` from LLM output but falls back to `"bar"`. The GamerRamp's killer scenario — "does higher CPI actually produce higher LTV players?" — is best answered visually with a scatter plot of (avg_cpi, avg_d60_ltv) by channel.

### 2. Noisy CPI at Small Scale

At `--scale 0.1` (~30K users), Moloco gets ≈6.7 installs/day on average (1,950 installs ÷ 289 days). With Poisson variance, individual days can have 0–20 installs — making per-day CPI charts noisy or missing. The `cac_by_channel` summary is daily granularity (`cohort_date`). When the LLM queries it for a "CPI trend" chart, grouping by day at small scale reveals the sampling artifact rather than the AR(1) trend.

### 3. Incomplete Scenario Verification

`setup-gameramp.ts` only verifies 3 of 6 scenarios after build. Scenarios 3, 5, and 6 have no automated checks — the dataset could silently produce wrong signals without detection.

| Scenario | Verified in setup-gameramp.ts? |
|---|---|
| 1. CPI↔LTV correlation | ✅ |
| 2. Fraud/settlement gap | ✅ |
| 3. Cohort vs calendar accounting | ❌ |
| 4. Stale LTV model (D30 decay) | ✅ |
| 5. ARPDAU flat / volume dilution | ❌ |
| 6. Geo expansion risk (IN/BR overshoot) | ❌ |

## Proposed Solution

### Part A: Scatter Chart (5 TypeScript files)

Add `"scatter"` to the ChartSpec type union. Scatter uses the existing `xKey` (numeric X axis), `yKeys[0]` (numeric Y axis), and an optional `nameKey` for dot labels. Implement as an early-return branch in `report-chart.tsx` (like `pie`) using Recharts `<ScatterChart>` + `<Scatter>`.

**SQL for scatter:** one row per dimension (channel), returning `(channel, avg_cpi, avg_d60_ltv)`.

### Part B: CPI Smoothing (1 SQL table + domain hint update)

Add `cac_by_month` to `setup-gameramp.ts` that pre-aggregates `cac_by_channel` by `install_month` (not `cohort_date`). Update domain hints in `gameramp.ts` to direct the LLM toward `cac_by_month` for CPI trend charts.

```sql
-- cac_by_month
SELECT
  DATE_TRUNC('month', cohort_date)::VARCHAR AS install_month,
  channel, country, os,
  SUM(cost)         AS total_spend,
  SUM(installs)     AS installs,
  ROUND(SUM(cost) / NULLIF(SUM(installs), 0), 2) AS avg_cpi
FROM cac_by_channel
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2
```

### Part C: Scenario Verification (setup-gameramp.ts)

Add 3 verification print-outs after the existing checks:

- **Scenario 3**: Monthly UA spend vs monthly settled revenue — spend should be ≥3× revenue in recent months.
- **Scenario 5**: Monthly ARPDAU from `arpdau_trend` — should be flat (~constant) while `total_revenue` grows.
- **Scenario 6**: D14 vs D90 LTV by country from `ltv_by_cohort` — IN/BR/ID/MX ratio should be ≥1.25×; US/GB ≤1.15×.

## Technical Approach

### Part A: Scatter Chart — File-by-File Changes

#### `src/lib/chart-types.ts` (line 2)

```typescript
// Before
type: "bar" | "line" | "area" | "pie";

// After
type: "bar" | "line" | "area" | "pie" | "scatter";
// No new fields needed — xKey = numeric X axis, yKeys[0] = numeric Y axis, nameKey = dot label
```

#### `src/components/chart/report-chart.tsx`

1. Add to recharts imports (line 5–21):
   ```typescript
   ScatterChart, Scatter,
   ```

2. Add early-return scatter branch before the bar/line/area block (before the `ChartComponent` ternary at line 373). Data format: pass `data` directly to `<Scatter data={data}>` (not via `dataKey`).

   ```tsx
   if (spec.type === "scatter") {
     const xKey = spec.xKey;
     const yKey = spec.yKeys?.[0];
     const nameKey = spec.nameKey;
     if (!xKey || !yKey) return null;
     return (
       <ResponsiveContainer width="100%" height={height}>
         <ScatterChart>
           <CartesianGrid strokeDasharray="3 3" />
           <XAxis dataKey={xKey} type="number" name={xKey} />
           <YAxis dataKey={yKey} type="number" name={yKey} />
           <Tooltip cursor={{ strokeDasharray: "3 3" }} />
           {nameKey && <Legend />}
           <Scatter name={nameKey ?? yKey} data={data} fill="#3E63DD" />
         </ScatterChart>
       </ResponsiveContainer>
     );
   }
   ```

> **Excluded:** `src/app/api/decks/process/route.ts` and `src/components/canvas/canvas-config-panel.tsx` — scatter charts will be added to boards via manual card creation, not LLM/deck generation.

**Scatter rendering contract (GamerRamp use case):**
- `xKey` = numeric column (e.g., `avg_cpi`) → `<XAxis type="number">` with computed domain
- `yKeys[0]` = numeric column (e.g., `avg_d60_ltv`) → `<YAxis type="number">`
- `nameKey` = string column for dot labels (e.g., `channel`) — same field name as pie, different semantic; safe because pie and scatter are separate rendering branches
- Click-to-drill-down: omit for this iteration

### Part B: cac_by_month — `setup-gameramp.ts` AND `gameramp.ts`

> **Critical (from SpecFlow):** `cac_by_month` must be added to BOTH the standalone `setup-gameramp.ts` script AND `gameramp.ts`'s `summaryTableSQL` array. Otherwise it won't be created on Railway restarts or fresh installs via `ensureDatasetReady`.

> **Column note:** `campaign` table has no `install_month` VARCHAR column — only `cohort_date DATE`. Use `strftime('%Y-%m', cohort_date)` to derive the `"2025-02"` format, matching other tables.

SQL for the table (same in both places):
```sql
CREATE OR REPLACE TABLE cac_by_month AS
SELECT
  strftime('%Y-%m', cohort_date) AS install_month,
  channel, country, os,
  SUM(cost)         AS total_spend,
  SUM(installs)     AS installs,
  ROUND(SUM(cost) / NULLIF(SUM(installs), 0), 2) AS avg_cpi
FROM cac_by_channel
GROUP BY strftime('%Y-%m', cohort_date), channel, country, os
ORDER BY install_month, channel
```

In `gameramp.ts`:
1. Add the SQL above to `summaryTableSQL` array
2. Add `cac_by_month` to `schemaContext` table listing with columns: `install_month VARCHAR, channel, country, os, total_spend, installs, avg_cpi`
3. Add `cac_by_month` to `summaryTableHint` string (the authoritative table list injected into SQL prompts)
4. Update domain hint #1 and #8 to distinguish: `cac_by_month` for CPI **trend** charts (line over time), `cac_by_channel` for cohort-level or daily granularity

### Part C: Scenario Verification — `setup-gameramp.ts`

Add after the existing D30 retention check. All comparisons are **total-across-channels** per month (not per-channel — mixing UA cost with in-app ad revenue per-channel is meaningless).

```typescript
// Scenario 3: Cohort vs calendar — total spend >> total settled revenue per month
// (UA spend is acquisition cost; settled_revenue is in-app ad earnings from acquired users)
const s3 = `
  SELECT
    strftime('%Y-%m', c.cohort_date) AS month,
    SUM(c.cost)                      AS ua_spend,
    COALESCE(SUM(m.settled_revenue), 0) AS settled_rev
  FROM cac_by_channel c
  LEFT JOIN (
    SELECT strftime('%Y-%m', month) AS mo, SUM(settled_revenue) AS settled_revenue
    FROM monthly_revenue_summary GROUP BY 1
  ) m ON strftime('%Y-%m', c.cohort_date) = m.mo
  GROUP BY 1 ORDER BY 1
`;
// Print: month, ua_spend, settled_rev, ratio — verify spend ≥ 3× settled for recent months

// Scenario 5: ARPDAU flat — aggregate to one ARPDAU per month across all geos/platforms
// Flag if coefficient of variation > 20%
const s5 = `
  SELECT
    strftime('%Y-%m', month) AS mo,
    SUM(total_revenue)       AS total_rev,
    SUM(total_revenue) / NULLIF(SUM(active_users), 0) AS arpdau
  FROM arpdau_trend
  GROUP BY 1 ORDER BY 1
`;
// Print: mo, total_rev, arpdau — verify total_rev grows while arpdau stays flat (CV < 20%)

// Scenario 6: Geo LTV overshoot — defensive against null D90 for recent cohorts
// Filter to cohorts with days_elapsed ≥ 90 to avoid undersampled recent cohorts
const s6 = `
  SELECT
    country,
    AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END) AS d14_ltv,
    AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
    AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END)
      / NULLIF(AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END), 0) AS ratio
  FROM ltv_by_cohort
  WHERE cohort_date <= DATE '2025-08-26'  -- at least 90 days before END_DATE
  GROUP BY country ORDER BY country
`;
// Print: country, d14_ltv, d90_ltv, ratio — verify IN/BR/ID/MX ratio ≥ 1.25; US/GB ≤ 1.15
```

## Acceptance Criteria

### Scatter Chart
- [ ] `ChartSpec["type"]` includes `"scatter"` without breaking existing `"bar" | "line" | "area" | "pie"` rendering
- [ ] `report-chart.tsx` renders `<ScatterChart>` for `spec.type === "scatter"` with numeric X/Y axes and dot labels via `nameKey`
- [ ] A scatter chart card with `(avg_cpi, avg_d60_ltv, channel)` data renders correctly on the board when manually added
- [ ] `pnpm lint` passes with no TypeScript errors

### CPI Smoothing
- [ ] `cac_by_month` table exists in `data/gameramp.duckdb` with correct columns
- [ ] Domain hint in `gameramp.ts` directs LLM to `cac_by_month` for CPI trend queries
- [ ] Schema context documents `cac_by_month` table
- [ ] The prompt "Show CPI trend over time by channel" returns a smooth line chart (not noisy day-level)

### Scenario Verification
- [ ] `npx tsx scripts/setup-gameramp.ts` prints verification output for all 6 scenarios
- [ ] Scenario 3: UA spend ≥ 3× settled revenue for months with <90 days elapsed
- [ ] Scenario 5: ARPDAU flat (CV < 0.15 across all months) while total revenue grows >50% Feb→Oct
- [ ] Scenario 6: IN/BR/ID/MX D14/D90 ratio ≥ 1.25×; US/GB/DE ≤ 1.15×

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `ScatterChart` data format differs from other charts — `<Scatter data={data}>` vs `dataKey` pattern | Use early-return branch (separate code path, like `pie`), not modified `renderSeries()` |
| `yKeys` is plural array — scatter only uses `yKeys[0]` | Access `spec.yKeys?.[0]` with null guard; return `null` if missing |
| `inferChartSpec` auto-inference never produces scatter | No change needed — scatter is LLM-only (explicitly requested, never inferred from data shape) |
| `cac_by_month` adds setup time | It's a simple aggregation over `cac_by_channel` (already materialized) — negligible |
| Scenario 3 verification query joins `cac_by_channel` with `monthly_revenue_summary` on month — DuckDB needs `DATE_TRUNC` or `STRFTIME` for join | Use `STRFTIME(cohort_date, '%Y-%m')` consistently; test with `DESCRIBE` before running |

## References

### Internal
- Chart type union: `src/lib/chart-types.ts:2`
- Chart renderer type switch: `src/components/chart/report-chart.tsx:179,373`
- Recharts imports: `src/components/chart/report-chart.tsx:5-21`
- LLM chart instructions: `src/lib/prompts/analyze.ts:7-19`
- Deck scatter fallback: `src/app/api/decks/process/route.ts:147`
- Canvas chart picker: `src/components/canvas/canvas-config-panel.tsx:10`
- AR(1) CPI model (already built): `scripts/generate-gameramp.py:313-367`
- Scenario checks (Python): `scripts/generate-gameramp.py:872-901`
- Dataset config: `src/lib/datasets/gameramp.ts`

### Solution Docs
- `docs/solutions/best-practices/synthetic-ua-data-cpi-ltv-calibration.md` — AR(1) model and mid-core benchmarks
- `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md` — qualify all JOIN columns
- `docs/solutions/database-issues/pyarrow-date-vs-timestamp-parquet-duckdb-charts.md` — keep `datetime.date` objects

## Execution Order

1. **TypeScript** (`pnpm lint` after both files):
   1. `src/lib/chart-types.ts` — add `"scatter"` to union
   2. `src/components/chart/report-chart.tsx` — add imports + scatter branch

2. **Setup script** (`setup-gameramp.ts`):
   1. Add `cac_by_month` table creation
   2. Add scenarios 3, 5, 6 verification queries

3. **Dataset config** (`gameramp.ts`):
   1. Document `cac_by_month` in `schemaContext`
   2. Add domain hint for CPI trend queries

4. **Rebuild DuckDB**:
   ```bash
   npx tsx scripts/setup-gameramp.ts
   ```

5. **Manual test** — add a scatter chart card to the board manually with `(avg_cpi, avg_d60_ltv, channel)` data, verify it renders correctly.
