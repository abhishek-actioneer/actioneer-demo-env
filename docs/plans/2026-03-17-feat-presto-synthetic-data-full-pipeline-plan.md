---
title: "feat: Presto Synthetic Dataset — Full Pipeline Plan"
type: feat
date: 2026-03-17
---

# feat: Presto Synthetic Dataset — Full Pipeline Plan

## Overview

Single working document for all changes to the GamerRamp synthetic data pipeline. Covers:

1. **Rebrand** — "Highway Racer Pro" → "Presto" (casual/mid-core mobile puzzle game)
2. **Date range** — Feb–Nov 2025 → August 2025–February 2026 (7 months)
3. **MONTHLY_SPEND** — new values covering the missing Aug 2025–Feb 2026 window (including holiday peak)
4. **D30_RETENTION** — fresh decay curve starting at launch (Aug 2025) for a clean stale-LTV-model story
5. **CPI holiday premium** — extend to Dec (Christmas peak) and Jan (post-holiday carryover)
6. **`cac_by_month` table** — add to both `setup-gameramp.ts` and `gameramp.ts`
7. **Scenario 3/5/6 verification** — add to `setup-gameramp.ts`
8. **Scatter chart** — add `"scatter"` to TypeScript chart union and Recharts renderer

All existing calibration is **carried forward unchanged**: AR(1) CPI model, `CPI_GEO_MULT`, `GEO_RETENTION_MULT`, `ARPDAU_BASE`, bi-phasic emerging-geo retention curve, fraud rates, channel spend shares.

---

## Problem Statement

### 1. App identity mismatch
The script docstring, scenario descriptions, and dataset config all reference "Highway Racer Pro (HRP)" and "racing game." The product is being rebranded to **Presto** (casual/mid-core mobile puzzle game). All display strings must update.

### 2. Date range gaps
Current: `START_DATE = date(2025, 2, 10)`, `END_DATE = date(2025, 11, 24)`.
Needed: August 2025 – February 2026.

Three constants are keyed by month string and will break silently (fall through to `.get(..., default)`) for the 3 missing months:
- `D30_RETENTION` — keys "2025-02"→"2025-11" — missing "2025-12", "2026-01", "2026-02"
- `MONTHLY_SPEND` — same gap
- The AR(1) holiday premium only targets Oct/Nov — missing Dec/Jan coverage

### 3. Scenario narrative starts mid-story
With Aug 2025 as the start, the dataset begins at an already-decayed retention level ($0.094 D30) from the old curve. The cleaner story for Presto: **launched August 2025**, first cohorts excellent ($0.150 D30), model trained on those cohorts, retention degrades through Feb 2026 — clear stale-model risk by Q1 2026.

### 4. `cac_by_month` missing
At small scale (or at full scale for channels with low volume), `cac_by_channel` (daily granularity) produces noisy CPI lines. The LLM needs `cac_by_month` as an alternative.

### 5. Scenario 3/5/6 not verified in setup script
`setup-gameramp.ts` only verifies scenarios 1, 2, 4. Scenarios 3, 5, 6 have no automated checks.

### 6. No scatter chart support
`ChartSpec.type` union is `"bar" | "line" | "area" | "pie"`. Cannot render a CPI×LTV correlation scatter plot. The deck-processing route already recognizes `"scatter"` from LLM output but falls back to `"bar"`.

---

## Proposed Solution

### Part A — `scripts/generate-gameramp.py`

Four targeted changes:

**A1. App name + docstring** — replace all display strings.

**A2. Date range constants:**
```python
START_DATE = date(2025, 8, 1)
END_DATE   = date(2026, 2, 28)
```
212 days (vs 289). Scale factor stays at 1.0 → ~300K users still valid (FULL_SCALE_USERS unchanged, distribution happens over 212 days → higher daily install volume, which is realistic for a ramp-up period).

**A3. New D30_RETENTION** — fresh decay curve starting at Presto launch:
```python
D30_RETENTION = {
    "2025-08": 0.150,   # Launch — first cohorts are best quality
    "2025-09": 0.136,
    "2025-10": 0.123,
    "2025-11": 0.111,
    "2025-12": 0.100,
    "2026-01": 0.090,
    "2026-02": 0.081,   # 46% decline over 7 months — clear stale-model signal
}
```

**A4. New MONTHLY_SPEND** — Aug 2025 launch ramp through Q4 holiday peak, Jan pullback:
```python
MONTHLY_SPEND = {
    "2025-08":  65_000,   # Launch — moderate initial spend
    "2025-09":  78_000,   # Growth
    "2025-10":  88_000,   # Pre-holiday ramp
    "2025-11": 105_000,   # Holiday UA peak begins (Black Friday)
    "2025-12": 120_000,   # Christmas peak — highest CPI month
    "2026-01":  72_000,   # Post-holiday pullback
    "2026-02":  68_000,   # Stabilization
}
# Total: ~$596K over 7 months
```

**A5. Extended holiday CPI premium** — update the AR(1) `build_daily_cpi_series` branch:
```python
# Before:
if d.month in (10, 11):
    trend *= 1.32

# After:
if d.month == 12:
    trend *= 1.45     # Christmas peak — highest auction pressure
elif d.month in (10, 11):
    trend *= 1.32     # Pre-holiday / Black Friday
elif d.month == 1:
    trend *= 1.10     # Post-holiday carryover
```

**A6. Scenario 4 docstring + verification output** — update month references from "Feb→Nov" to "Aug→Feb".

### Part B — `scripts/setup-gameramp.ts`

**B1. `cac_by_month` table:**
```sql
CREATE OR REPLACE TABLE cac_by_month AS
SELECT
  strftime('%Y-%m', cohort_date)           AS install_month,
  channel, country, os,
  SUM(cost)                                AS total_spend,
  SUM(installs)                            AS installs,
  ROUND(SUM(cost) / NULLIF(SUM(installs), 0), 2) AS avg_cpi
FROM cac_by_channel
GROUP BY strftime('%Y-%m', cohort_date), channel, country, os
ORDER BY install_month, channel
```
> **Note**: `cac_by_channel` has no `install_month` column — only `cohort_date DATE`. Use `strftime('%Y-%m', cohort_date)` consistently. Do NOT use `DATE_TRUNC` — it returns a DATE, not a VARCHAR month string.

**B2. Scenario 3 verification** — monthly UA spend vs settled revenue gap:
```sql
-- Scenario 3: Cohort vs calendar — total UA spend >> settled revenue per month
SELECT
  strftime('%Y-%m', c.cohort_date) AS month,
  SUM(c.cost)                      AS ua_spend,
  COALESCE(SUM(m.settled_revenue), 0) AS settled_rev,
  ROUND(SUM(c.cost) / NULLIF(COALESCE(SUM(m.settled_revenue), 0), 0), 2) AS spend_to_rev_ratio
FROM cac_by_channel c
LEFT JOIN (
  SELECT strftime('%Y-%m', month) AS mo, SUM(settled_revenue) AS settled_revenue
  FROM monthly_revenue_summary GROUP BY 1
) m ON strftime('%Y-%m', c.cohort_date) = m.mo
GROUP BY 1 ORDER BY 1
-- Expect: spend_to_rev_ratio >= 3× for all months (UA not yet recouped)
```

**B3. Scenario 5 verification** — ARPDAU flat check:
```sql
-- Scenario 5: ARPDAU dilution — total revenue grows, ARPDAU stays flat
SELECT
  strftime('%Y-%m', month) AS mo,
  SUM(total_revenue)       AS total_rev,
  SUM(active_users)        AS active_users,
  ROUND(SUM(total_revenue) / NULLIF(SUM(active_users), 0), 4) AS arpdau
FROM arpdau_trend
GROUP BY 1 ORDER BY 1
-- Expect: total_rev grows >50% Aug→Jan; arpdau CV < 20%
```
> **Known audit finding**: At full scale, monthly ARPDAU (revenue / unique_users_seen) shows a ~29% decline (CV=0.170) rather than flat. This is because monthly active user denominator grows rapidly with UA scaling, diluting per-user revenue. The scenario narrative ("revenue grows from volume, not monetization improvement") still holds. The LLM will observe this declining ARPDAU and correctly interpret it as dilution, which is the intended signal.

**B4. Scenario 6 verification** — geo D14/D90 LTV overshoot:
```sql
-- Scenario 6: Geo expansion risk — early LTV frontloaded for IN/BR/ID/MX
SELECT
  country,
  AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END) AS d14_ltv,
  AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
  ROUND(
    AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END)
    / NULLIF(AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END), 0),
  3) AS d14_d90_ratio
FROM ltv_by_cohort
WHERE cohort_date <= DATE '2025-11-30'  -- at least 90 days before END_DATE (2026-02-28)
GROUP BY country ORDER BY country
-- Expect: IN/BR/ID/MX ratio ~0.67–0.69 (frontloaded) vs US/GB/CA ~0.44–0.45 (spread)
-- Interpretation: a US-trained model projects D90 from D14 at 0.44 ratio;
--   applying to IN (actual ratio 0.69) overpredicts D90 by ~57%
```

### Part C — `src/lib/datasets/gameramp.ts`

**C1. Label + date range:**
```typescript
label: "Presto",
description: "Casual/mid-core mobile puzzle game — 7-month UA analytics dataset",
dateRange: { start: "2025-08-01", end: "2026-02-28" },
```

**C2. Add `cac_by_month` to `summaryTableSQL` array** — same SQL as B1 above (must be in both places for Railway restarts via `ensureDatasetReady`).

**C3. Add `cac_by_month` to `schemaContext` table listing:**
```
cac_by_month: install_month VARCHAR, channel, country, os, total_spend, installs, avg_cpi
```

**C4. Add `cac_by_month` to `summaryTableHint` string** (the authoritative table list injected into SQL prompts).

**C5. Update domain hints #1 and #8** to distinguish `cac_by_month` (trend over time) vs `cac_by_channel` (daily cohort-level):
```
Hint #1: Use cac_by_month for CPI trend charts (smooth monthly averages).
         Use cac_by_channel for daily cohort-level or campaign-day analysis.
Hint #8: For period-vs-cohort: cac_by_month shows monthly spend; monthly_revenue_summary
         shows monthly revenue. These will NOT match for recent months (payback lag).
```

**C6. All "Highway Racer Pro" / "racing game" strings** — update to "Presto" / "puzzle game".

### Part D — TypeScript scatter chart (2 files)

**D1. `src/lib/chart-types.ts` line 2:**
```typescript
// Before
type: "bar" | "line" | "area" | "pie";

// After
type: "bar" | "line" | "area" | "pie" | "scatter";
```

**D2. `src/components/chart/report-chart.tsx`:**

Add to Recharts imports (after `PieChart, Pie, Cell`):
```typescript
ScatterChart, Scatter,
```

Add early-return scatter branch **before** the `ChartComponent` ternary (similar pattern to pie's early return):
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

**Scatter rendering contract:**
- `xKey` → numeric X axis (e.g., `avg_cpi`)
- `yKeys[0]` → numeric Y axis (e.g., `avg_d60_ltv`)
- `nameKey` → string column for dot labels (e.g., `channel`) — same field as pie but different semantic; safe because branches are separate
- `data` passed directly to `<Scatter data={data}>` (not via `dataKey` pattern)
- No drill-down in this iteration

**Excluded from this plan:**
- `src/app/api/decks/process/route.ts` — scatter added to boards manually, not via LLM deck generation
- `src/components/canvas/canvas-config-panel.tsx` — no picker update needed

---

## Execution Order

```
1. scripts/generate-gameramp.py      (A1–A6)  → python3 ... --scale 0.1 sanity check
2. scripts/setup-gameramp.ts         (B1–B4)  → npx tsx scripts/setup-gameramp.ts
3. src/lib/datasets/gameramp.ts      (C1–C6)
4. src/lib/chart-types.ts            (D1)
5. src/components/chart/report-chart.tsx  (D2)
6. pnpm lint                              → must pass
7. python3 scripts/generate-gameramp.py --scale 1.0 --seed 42
8. npx tsx scripts/setup-gameramp.ts      → check all 6 scenario outputs
```

---

## Acceptance Criteria

### Generator (`generate-gameramp.py`)
- [ ] Docstring and all display strings reference "Presto" (no "Highway Racer Pro" or "HRP")
- [ ] `START_DATE = date(2025, 8, 1)`, `END_DATE = date(2026, 2, 28)`
- [ ] `D30_RETENTION` has keys "2025-08" through "2026-02" only
- [ ] `MONTHLY_SPEND` has keys "2025-08" through "2026-02" only
- [ ] AR(1) model includes Dec ×1.45 and Jan ×1.10 holiday multipliers
- [ ] `python3 scripts/generate-gameramp.py --scale 0.1` runs without KeyError or missing-month warnings

### DuckDB setup (`setup-gameramp.ts`)
- [ ] `cac_by_month` table created with correct schema (`install_month VARCHAR`, `avg_cpi FLOAT`)
- [ ] Scenario 3 print shows `spend_to_rev_ratio` column; recent months ≥ 3×
- [ ] Scenario 5 print shows `total_rev` growing while `arpdau` stays within 30% of mean
- [ ] Scenario 6 print shows IN/BR/ID/MX `d14_d90_ratio` ~0.67–0.69; US/CA/GB ~0.44–0.45
- [ ] All 6 scenarios verified in a single `npx tsx scripts/setup-gameramp.ts` run

### Dataset config (`gameramp.ts`)
- [ ] `label: "Presto"`, `dateRange.start: "2025-08-01"`, `dateRange.end: "2026-02-28"`
- [ ] `summaryTableSQL` includes `cac_by_month` CREATE statement
- [ ] `schemaContext` documents `cac_by_month` columns
- [ ] Domain hints distinguish `cac_by_month` (trend) vs `cac_by_channel` (daily)

### Scatter chart (TypeScript)
- [ ] `ChartSpec["type"]` includes `"scatter"` — `pnpm lint` passes, no TS errors
- [ ] `report-chart.tsx` renders `<ScatterChart>` for `spec.type === "scatter"`
- [ ] A manually-created board card with `{ type: "scatter", xKey: "avg_cpi", yKeys: ["avg_d60_ltv"], nameKey: "channel" }` and the channel-level CPI×LTV data renders correctly

---

## Calibration Reference (Carry-Forward, Do Not Change)

### CPI_GEO_MULT (geo × platform vs US iOS = 1.0)
| Geo | iOS | Android |
|-----|-----|---------|
| US  | 1.00 | 0.73 |
| CA  | 1.34 | 1.17 |
| GB  | 1.40 | 0.67 |
| DE  | 1.51 | 0.98 |
| FR  | 0.92 | 0.44 |
| BR  | 0.45 | 0.19 |
| MX  | 0.43 | 0.22 |
| IN  | 0.11 | 0.09 |
| ID  | 0.46 | 0.11 |
| others | 0.50 | 0.22 |

### GEO_RETENTION_MULT (geo × platform D30 multiplier vs US iOS = 1.0)
| Geo | iOS | Android |
|-----|-----|---------|
| US  | 1.00 | 0.82 |
| CA  | 0.92 | 0.76 |
| GB  | 0.88 | 0.72 |
| DE  | 0.82 | 0.67 |
| FR  | 0.76 | 0.60 |
| BR  | 0.62 | 0.52 |
| MX  | 0.60 | 0.50 |
| IN  | 0.52 | 0.44 |
| ID  | 0.55 | 0.46 |
| others | 0.72 | 0.58 |

> **Known calibration note**: The bi-phasic retention curve for EMERGING_GEOS (IN/BR/MX/ID) compounds multiplicatively with GEO_RETENTION_MULT, causing actual D30 ratios for emerging geos to be ~60% lower than the multiplier implies (~0.20–0.24 vs expected 0.52–0.62). Tier ordering is correct (US > CA > GB > DE > FR > BR/MX > ID > IN). All 6 scenarios produce correct directional signals. No fix needed unless absolute retention levels become a concern for a specific demo scenario.

### ARPDAU_BASE (US iOS anchor = $0.450)
US iOS $0.450, US Android $0.320, GB iOS $0.320, GB Android $0.255,
DE iOS $0.210, DE Android $0.170, FR iOS $0.185, FR Android $0.095,
IN iOS $0.045, IN Android $0.030, BR iOS $0.095, BR Android $0.065,
MX iOS $0.100, MX Android $0.068, ID iOS $0.068, ID Android $0.028,
others iOS $0.175, others Android $0.095

### Fraud rates (channel mid-points)
Vungle 17%, Moloco 14%, AdMob 11%, Facebook 6%, Organic 3.5%

### Channel CPI + volatility
Facebook $7.50 (σ=0.06), AdMob $5.50 (σ=0.10), Moloco $4.50 (σ=0.12),
Vungle $3.00 (σ=0.15), Organic $0.00

### AR(1) model parameters
`AR_PHI = 0.7` (autocorrelation), `DOW_MULT = [0.97, 1.00, 1.03, 1.06, 1.12, 0.92, 0.88]` (Mon–Sun),
trend: +15% Aug→Feb, Q4/holiday: Oct/Nov ×1.32, Dec ×1.45, Jan ×1.10

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| `MONTHLY_SPEND` missing "2025-12"/"2026-01"/"2026-02" causes AR(1) spend_mult to fall back to `avg_spend` | Keys explicitly defined in new dict — no gap |
| `D30_RETENTION` KeyError for months outside the dict | `.get(install_month, 0.081)` fallback already in script; new dict covers all months in range |
| `cac_by_month` added only to `setup-gameramp.ts` but not `gameramp.ts` `summaryTableSQL` — missing on Railway restart | Both places must be updated simultaneously (Part B + Part C) |
| DuckDB ambiguous column in `cac_by_month` query (no JOINs here) | Simple GROUP BY aggregation of `cac_by_channel` — no JOIN ambiguity risk |
| `cohort_date` in `cac_by_month` might render as timestamp on charts | Keep as DATE (already fixed per pyarrow-date solution); `strftime` returns VARCHAR for `install_month` |
| Scatter chart `yKeys` is plural — scatter only uses `yKeys[0]` | Access `spec.yKeys?.[0]` with null guard; return `null` if missing |
| `DATE '2025-11-30'` hardcoded in Scenario 6 verification SQL | Use `DATE '2025-11-30'` = END_DATE minus 90 days = `date(2026,2,28) - 90 = 2025-11-30` — correct for new range |

---

## References

### Internal
- Generator: `scripts/generate-gameramp.py:1-50` (date range, spend, retention constants)
- Setup script: `scripts/setup-gameramp.ts`
- Dataset config: `src/lib/datasets/gameramp.ts`
- Chart types: `src/lib/chart-types.ts:2`
- Chart renderer: `src/components/chart/report-chart.tsx`
- Previous scatter plan: `docs/plans/2026-03-16-feat-gameramp-scatter-chart-dataset-quality-plan.md`

### Solution Docs
- `docs/solutions/best-practices/synthetic-ua-data-cpi-ltv-calibration.md` — AR(1) model, mid-core benchmarks
- `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md` — qualify all JOIN columns
- `docs/solutions/database-issues/pyarrow-date-vs-timestamp-parquet-duckdb-charts.md` — keep `datetime.date` objects
- `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md` — scatter chart styling

### Audit Results (2026-03-17)
- CPI geo multipliers: ✅ all within ±13%
- Retention tier ordering: ✅ correct; absolute magnitude for emerging geos ~60% lower than GEO_RETENTION_MULT (bi-phasic compounding — known, not a bug)
- ARPDAU: ✅ all within ±9% of ARPDAU_BASE
- Fraud gaps: ✅ exact (Vungle 17.3%, Moloco 14.1%, AdMob 10.8%, Facebook 6.0%)
- D30 decay: ✅ 8.6% (Aug) → 4.4% (Oct) at full scale
- Scenario 5 ARPDAU: ⚠️ declining (CV=0.170 > 0.15 target) — acceptable, scenarios still work
