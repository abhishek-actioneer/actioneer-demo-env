---
title: "feat: Presto Synthetic Dataset — Full Pipeline Plan"
type: feat
date: 2026-03-17
---

# feat: Presto Synthetic Dataset — Full Pipeline Plan

## Overview

Comprehensive working plan for the Presto synthetic mobile UA dataset. Covers all changes
needed to `generate-gameramp.py`, `setup-gameramp.ts`, `gameramp.ts`, and the scatter chart
TypeScript additions. This is the single authoritative file — do not split into sub-plans.

**App:** Presto — casual/mid-core mobile puzzle game
**Date range:** August 1, 2025 → February 28, 2026 (7 months, 212 days)
**Scale:** ~300K users, ~6.5M rows total

---

## The 6 Scenarios (unchanged narratives, updated dates)

| # | Scenario | Signal |
|---|----------|--------|
| 1 | CPI↔LTV correlation | Facebook ($7.50 CPI) → D60 LTV ~$2.25; Vungle ($3.00) → ~$0.77 |
| 2 | Fraud/settlement | Vungle ~17% IVT, Moloco ~14%, AdMob ~11%, Facebook ~6% |
| 3 | Cohort vs calendar | Aug UA spend $55K; Aug closed revenue ~$12K; Aug cohort D180 LTV >> spend |
| 4 | Stale LTV model | D30 retention decays Aug 15% → Feb 8.1% — model built on Aug cohorts is stale by Jan |
| 5 | ARPDAU dilution | Total revenue grows as user base expands; ARPDAU stays flat |
| 6 | Geo expansion risk | IN/BR/ID/MX D14 LTV overshoots D90 by 30-40% (relative to US pattern) |

---

## Part A: `scripts/generate-gameramp.py` Changes

### A1. Header / docstring

```python
"""
generate-gameramp.py — Synthetic GamerRamp dataset generator

Presto — casual/mid-core mobile puzzle game
~300K users, Aug 1 – Feb 28, 2026

Six engineered scenarios:
  1. CPI↔LTV correlation: facebook $7.50 CPI → D60 LTV ~$2.25; vungle $3.00 → ~$0.77
  2. Fraud/settlement: vungle ~17% invalid traffic, reported≠settled revenue
  3. Cohort vs calendar: first-month UA spend >> early closed revenue; D180 LTV much larger
  4. Stale LTV model: D30 retention decays Aug→Feb (15%→8.1%)
  5. ARPDAU dilution: total ad revenue grows, ARPDAU stays flat
  6. Geo expansion risk: IN/BR D14 LTV overshoots D90 LTV by 30–40%
"""
```

### A2. Date range

```python
# ── Date range ─────────────────────────────────────────────────────────────────
START_DATE = date(2025, 8,  1)
END_DATE   = date(2026, 2, 28)
TOTAL_DAYS = (END_DATE - START_DATE).days + 1  # 212 days
ALL_DATES  = [START_DATE + timedelta(days=i) for i in range(TOTAL_DAYS)]
```

### A3. D30 Retention — fresh decay curve for Presto launch

The new range starts at Presto's launch (Aug 2025). The stale-model scenario requires a
visible declining trend across all 7 months. Start at 15% (good early cohorts) and decay
steadily to 8.1% by Feb 2026 — a 46% decline.

```python
D30_RETENTION = {
    "2025-08": 0.150,   # Launch cohort — high quality
    "2025-09": 0.136,
    "2025-10": 0.123,
    "2025-11": 0.111,
    "2025-12": 0.100,
    "2026-01": 0.090,
    "2026-02": 0.081,   # Retention degraded 46% since launch
}
```

### A4. Monthly Spend — new 7-month profile

Holiday season (Nov–Dec) is now fully in range. The spend profile includes the Q4 holiday
ramp and a post-holiday pullback in Jan 2026. This creates a realistic Scenario 3 signal:
Jan/Feb UA spend is high while settled revenue from Jan/Feb installs is still very early.

```python
MONTHLY_SPEND = {
    "2025-08":  55_000,   # Launch — moderate initial ramp
    "2025-09":  72_000,   # Growth phase
    "2025-10":  90_000,   # Pre-holiday scaling
    "2025-11": 110_000,   # Holiday season begins
    "2025-12": 125_000,   # Holiday peak (Christmas / NYE)
    "2026-01":  78_000,   # Post-holiday pullback
    "2026-02":  68_000,   # Stabilisation
}
# Total: ~$598K across 7 months
```

### A5. AR(1) CPI model — add Dec/Jan holiday premium

The current Q4 premium covers only `d.month in (10, 11)`. With December and January now in
scope, the holiday premium must extend:

```python
# Holiday premium — ad auction inflation from holiday advertisers
if d.month in (10, 11):
    trend *= 1.32    # Pre-holiday (Oct/Nov)
elif d.month == 12:
    trend *= 1.45    # Peak Christmas season
elif d.month == 1:
    trend *= 1.18    # Post-holiday tail (New Year campaigns)
```

> **Rationale:** Dec CPIs run ~10-15% above Nov in real mobile UA auctions (holiday
> direct-response advertisers + gaming gift-card recipients causing install spike).
> Jan drops back as holiday budgets expire.

### A6. All other constants — carry forward unchanged

These are calibrated and audited. Do NOT change:

| Constant | Status |
|----------|--------|
| `CHANNEL_CPI` | ✅ Keep (Facebook $7.50 → Vungle $3.00) |
| `CHANNEL_SPEND_SHARE` | ✅ Keep |
| `CHANNEL_FRAUD_RANGE` | ✅ Keep (Vungle 14-20%, Moloco 11-17%, etc.) |
| `CHANNEL_RETENTION_MULT` | ✅ Keep |
| `GEO_RETENTION_MULT` | ✅ Keep (tier ordering correct; bi-phasic compounding is expected) |
| `ARPDAU_BASE` | ✅ Keep (all within ±9% in audit) |
| `CPI_GEO_MULT` | ✅ Keep (all within ±13% in audit) |
| `CHANNEL_CPI_VOLATILITY` | ✅ Keep |
| `CHANNEL_ARPDAU_MULTIPLIER` | ✅ Keep |
| `COUNTRY_WEIGHTS_PAID` | ✅ Keep |
| `COUNTRY_WEIGHTS_ORGANIC` | ✅ Keep |
| `PLATFORM_IOS_PROB` | ✅ Keep |
| Bi-phasic emerging geo curve | ✅ Keep (EMERGING_GEOS shape logic) |
| Fraud model logic | ✅ Keep (impression stuffing pattern) |

---

## Part B: `scripts/setup-gameramp.ts` Changes

### B1. Add `cac_by_month` summary table (after `cac_by_channel`)

> **Critical:** Must be in BOTH `setup-gameramp.ts` AND `gameramp.ts` `summaryTableSQL`.
> Otherwise it won't be created on Railway restarts via `ensureDatasetReady`.

```sql
CREATE OR REPLACE TABLE cac_by_month AS
SELECT
  strftime('%Y-%m', cohort_date) AS install_month,
  channel, country, os,
  SUM(cost)    AS total_spend,
  SUM(installs) AS installs,
  ROUND(SUM(cost) / NULLIF(SUM(installs), 0), 2) AS avg_cpi
FROM cac_by_channel
GROUP BY strftime('%Y-%m', cohort_date), channel, country, os
ORDER BY install_month, channel;
```

> **Note:** Use `strftime('%Y-%m', cohort_date)` — NOT `DATE_TRUNC` — to match the
> `"2025-08"` VARCHAR format used in other tables. `DATE_TRUNC` returns a date type which
> mismatches on joins. (See: `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md`)

### B2. Add scenario 3, 5, 6 verification queries

Add after the existing D30 retention check in `setup-gameramp.ts`:

```typescript
// ── Scenario 3: Cohort vs calendar ──────────────────────────────────────────
const s3 = `
  SELECT
    strftime('%Y-%m', c.cohort_date) AS month,
    SUM(c.cost)                       AS ua_spend,
    COALESCE(SUM(m.settled_revenue), 0) AS settled_rev
  FROM cac_by_channel c
  LEFT JOIN (
    SELECT strftime('%Y-%m', month) AS mo, SUM(settled_revenue) AS settled_revenue
    FROM monthly_revenue_summary GROUP BY 1
  ) m ON strftime('%Y-%m', c.cohort_date) = m.mo
  GROUP BY 1 ORDER BY 1
`;
// Print: month, ua_spend, settled_rev — verify spend ≥ 3× settled for recent months

// ── Scenario 5: ARPDAU flat ──────────────────────────────────────────────────
const s5 = `
  SELECT
    strftime('%Y-%m', month) AS mo,
    SUM(total_revenue)        AS total_rev,
    SUM(total_revenue) / NULLIF(SUM(active_users), 0) AS arpdau
  FROM arpdau_trend
  GROUP BY 1 ORDER BY 1
`;
// Print: mo, total_rev, arpdau — verify total_rev grows while arpdau stays flat (CV < 0.20)

// ── Scenario 6: Geo LTV overshoot ───────────────────────────────────────────
const s6 = `
  SELECT
    country,
    AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END) AS d14_ltv,
    AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
    AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END)
      / NULLIF(AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END), 0) AS ratio
  FROM ltv_by_cohort
  WHERE cohort_date <= DATE '2025-11-30'  -- at least 90 days before END_DATE (2026-02-28)
  GROUP BY country ORDER BY country
`;
// Print: country, d14_ltv, d90_ltv, ratio
// Expected: emerging (IN/BR/ID/MX) ratio ~0.67-0.69; developed (US/GB/DE) ratio ~0.44-0.45
// Interpretation: emerging geos are more "frontloaded" — using a US-calibrated model
// to project D90 from D14 will overshoot actual D90 by ~55% for IN/BR
```

---

## Part A7: `generate-gameramp.py` — Engagement Tier Segment

### The Story

Marketing wants to justify switching Facebook UA targeting from "players who completed 3
games" to "players who completed 5+ games." The argument:
- 5-game completers are significantly stickier (higher D30/D60 retention)
- Their LTV is high enough to absorb a +20% CPI premium
- Even at higher CPI, `roas_d90` stays positive and outperforms the current 3-game cohort

The dataset must make this signal **unambiguous**: high-engagement users (5+ games in D0–D7)
should have ~2–3× better retention and LTV than low-engagement users.

### A7a. Add `engagement_tier` to `installs` table

Each user is assigned an engagement tier at install time, drawn from a channel-specific
distribution. Organic users are most engaged (word-of-mouth effect); Vungle least.

```python
# Engagement tier: based on games completed in first 7 days
# "low"    = 0-2 completions in D7
# "medium" = 3-4 completions
# "high"   = 5+  completions
ENGAGEMENT_TIERS = ["low", "medium", "high"]

CHANNEL_ENGAGEMENT_DIST = {
    #              low    med    high
    "facebook": [0.30,  0.40,  0.30],  # current 3-game targeting → 30% high
    "admob":    [0.40,  0.38,  0.22],
    "moloco":   [0.45,  0.35,  0.20],
    "vungle":   [0.55,  0.32,  0.13],  # volume play → mostly low engagement
    "organic":  [0.25,  0.38,  0.37],  # word-of-mouth → most engaged
}
```

Add `engagement_tier: str` column to `installs` parquet.

### A7b. Engagement tier multipliers on retention and ARPDAU

The stickiness signal must be dramatic enough to be visible in queries:

```python
# Retention multiplier applied on top of channel × geo retention
ENGAGEMENT_RETENTION_MULT = {
    "low":    0.40,   # 0-2 games: churn fast, rarely hit D30
    "medium": 0.90,   # 3-4 games: close to baseline
    "high":   1.85,   # 5+ games: nearly 2× baseline retention
}

# ARPDAU multiplier — engaged players watch more ads, spend more time
ENGAGEMENT_ARPDAU_MULT = {
    "low":    0.65,
    "medium": 0.95,
    "high":   1.40,
}
```

**Net effect at US iOS D30:**
- Base D30 (Aug cohort, US iOS) = 0.150 × 1.0 (geo) × channel_mult
- Facebook high-engagement D30 ≈ 0.150 × 1.20 × 1.85 = **~0.333** (33%)
- Facebook low-engagement D30  ≈ 0.150 × 1.20 × 0.40 = **~0.072** (7%)
- Ratio: **4.6× more likely to still be active at D30**

### A7c. Thread engagement_tier through generation pipeline

In `gen_sessions`: compute `eng_mult` array from `installs["engagement_tier"]` and apply
to both `d30_arr` (via `build_retention_matrix` — add 4th multiplier parameter) and
per-session `ad_revenue` (ARPDAU effect).

In `gen_revenue`: look up `ENGAGEMENT_RETENTION_MULT` and `ENGAGEMENT_ARPDAU_MULT` per row
and apply to `d30_base` and `arpdau_base` respectively.

In `gen_campaign`: `engagement_tier` is a channel-level property — the campaign table
already doesn't track individual users. No change needed in campaign generation.

> **Critical**: `engagement_tier` must be passed from `installs` into `gen_sessions` and
> `gen_revenue` as a per-user attribute. It is sampled once at install time (deterministic
> given seed) and used throughout.

### A7d. "New targeting" cohort — synthetic A/B signal

Add a second Facebook engagement distribution representing the **proposed 5-game targeting**:

```python
# Hypothetical: Facebook with 5-game targeting filter applied
# (higher CPI, better engagement mix — used in payback_analysis projections)
FACEBOOK_NEW_TARGETING_ENGAGEMENT_DIST = [0.15, 0.40, 0.45]
# vs current:                             [0.30, 0.40, 0.30]
```

**Important:** This is NOT a separate channel. Instead, add a boolean column
`is_new_targeting: bool` to the `installs` table. Mark approximately the last 4 weeks of
Facebook installs (Jan–Feb 2026) as `is_new_targeting = True` with `high` engagement
sampled at 45% instead of 30%. CPI for these users is 20% higher.

This represents a real-world scenario: the targeting switch was made in January 2026, and
the data now shows the early signal of improved retention for those cohorts.

```python
# In gen_installs — for Facebook users after 2026-01-01:
# is_new_targeting = True
# engagement_tier drawn from FACEBOOK_NEW_TARGETING_ENGAGEMENT_DIST
# cpi_premium = 1.20× (new targeting costs more)
```

This lets the LLM answer: "Compare D30 retention for Facebook Jan/Feb 2026 cohorts
(new targeting) vs Aug–Dec 2025 (old targeting)."

---

## Part B3: `generate-gameramp.py` — Net Revenue (platform fee)

Add `platform_fee` and `net_revenue` to `ad_impression_events`. For ad-monetised mobile
games, the ad network pays the developer directly (no Apple/Google cut on ad revenue). The
distinction that matters here is **reported vs settled** (fraud-adjusted). However to make
"revenue vs net revenue" a clear financial concept, add a platform service fee:

```python
# Platform service fee on net settled revenue (ad mediation take-rate)
PLATFORM_FEE = {
    "ios":     0.30,  # Apple App Store fee (applied to any IAP-adjacent ad revenue)
    "android": 0.30,  # Google Play fee
}
# In practice ad revenue has ~0% platform fee, but a 30% fee makes the
# "gross vs net" story compelling for finance demos.
# net_revenue = settled_revenue × (1 - platform_fee)
```

Add to `ad_impression_events` schema:
- `net_revenue: float` — `settled_revenue * (1 - PLATFORM_FEE[platform])`

Update `monthly_revenue_summary` SQL in `setup-gameramp.ts` to include:
```sql
SUM(net_revenue) AS net_revenue
```

**Domain hint:** "Finance books `net_revenue` (after platform fees). Marketing uses
`settled_revenue` (after fraud deductions). `reported_revenue` is raw MMP gross."

---

## Part B4: `setup-gameramp.ts` — Four New Summary Tables

### B4a. `segment_trends` — Segment cuts by install date × geo × platform

Enables the LLM to answer "show me D30 retention for US iOS cohorts over time" or
"compare ARPDAU trend for Android users in Brazil vs India".

```sql
CREATE OR REPLACE TABLE segment_trends AS
SELECT
  strftime('%Y-%m', cohort_date) AS install_month,
  channel,
  country,
  platform,
  SUM(cohort_installs)                                          AS installs,
  AVG(CASE WHEN days_from_cohort =  7 THEN retention_rate END) AS d7_retention,
  AVG(CASE WHEN days_from_cohort = 30 THEN retention_rate END) AS d30_retention,
  AVG(CASE WHEN days_from_cohort = 60 THEN retention_rate END) AS d60_retention,
  AVG(CASE WHEN days_from_cohort =  7 THEN avg_projected_ltv END) AS d7_ltv,
  AVG(CASE WHEN days_from_cohort = 30 THEN avg_projected_ltv END) AS d30_ltv,
  AVG(CASE WHEN days_from_cohort = 60 THEN avg_projected_ltv END) AS d60_ltv,
  AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
  AVG(arpdau)                                                   AS avg_arpdau
FROM ltv_by_cohort
GROUP BY 1, 2, 3, 4
ORDER BY install_month, channel, country, platform;
```

**Use case:** "Compare retention trends for Facebook vs Vungle users in India over the last
3 months" — one query on `segment_trends`.

### B4b. `roas_by_cohort` — RoAS elasticity

Shows how Return on Ad Spend varies across channel, geo, and LTV horizon. Enables the
question "at what CPI does D90 RoAS break even?" and "which channel has the best long-term
RoAS despite higher CPI?".

```sql
CREATE OR REPLACE TABLE roas_by_cohort AS
SELECT
  strftime('%Y-%m', l.cohort_date) AS install_month,
  l.channel,
  l.country,
  l.platform,
  SUM(l.cohort_installs)                                           AS installs,
  AVG(c.avg_cpi)                                                   AS avg_cpi,
  AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
  AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
  AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
  AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
  ROUND(AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END)
    / NULLIF(AVG(c.avg_cpi), 0), 3)                                AS roas_d30,
  ROUND(AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END)
    / NULLIF(AVG(c.avg_cpi), 0), 3)                                AS roas_d60,
  ROUND(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END)
    / NULLIF(AVG(c.avg_cpi), 0), 3)                                AS roas_d90
FROM ltv_by_cohort l
LEFT JOIN cac_by_channel c
  ON c.cohort_date = l.cohort_date
 AND c.channel     = l.channel
 AND c.country     = l.country
GROUP BY 1, 2, 3, 4
ORDER BY install_month, channel, country;
```

**RoAS elasticity story:** Facebook has highest CPI ($7.50) but `roas_d90 > 1.0` because
LTV is high. Vungle has lowest CPI ($3.00) but `roas_d90 < 0.5` — it never pays back.
Doubling Facebook spend → CPI rises (AR(1) spend-pressure) → marginal RoAS declines.

**Domain hints to add:**
- "For RoAS analysis: use `roas_by_cohort`. `roas_d90` > 1.0 = profitable at 90-day horizon."
- "RoAS elasticity: Facebook and AdMob show declining `roas_d60` as `avg_cpi` increases — spend-pressure from the AR(1) model causes CPI inflation when monthly budget is high."

### B4d. `engagement_analysis` — Engagement tier × channel LTV breakdown

The primary table for the targeting justification story.

```sql
CREATE OR REPLACE TABLE engagement_analysis AS
SELECT
  strftime('%Y-%m', l.cohort_date)    AS install_month,
  i.channel,
  i.engagement_tier,
  i.is_new_targeting,
  COUNT(DISTINCT i.user_id)           AS installs,
  AVG(c.avg_cpi)                      AS avg_cpi,
  AVG(CASE WHEN l.days_from_cohort =  7 THEN l.retention_rate END) AS d7_retention,
  AVG(CASE WHEN l.days_from_cohort = 30 THEN l.retention_rate END) AS d30_retention,
  AVG(CASE WHEN l.days_from_cohort = 60 THEN l.retention_rate END) AS d60_retention,
  AVG(CASE WHEN l.days_from_cohort =  7 THEN l.avg_projected_ltv END) AS d7_ltv,
  AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_ltv,
  AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END) AS d60_ltv,
  AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_ltv,
  ROUND(
    AVG(CASE WHEN l.days_from_cohort = 60 THEN l.avg_projected_ltv END)
    / NULLIF(AVG(c.avg_cpi), 0), 3)   AS roas_d60
FROM installs i
LEFT JOIN ltv_by_cohort l
  ON  l.cohort_date = i.install_date
  AND l.channel     = i.channel
  AND l.country     = i.country
  AND l.platform    = i.platform
LEFT JOIN cac_by_channel c
  ON  c.cohort_date = i.install_date
  AND c.channel     = i.channel
  AND c.country     = i.country
GROUP BY 1, 2, 3, 4
ORDER BY install_month, channel, engagement_tier;
```

**Key queries this enables:**
- "Show D60 LTV by engagement_tier for Facebook" → 5+ game players ~2.5× higher LTV
- "Compare old vs new targeting: d30_retention for Facebook Jan/Feb 2026 is_new_targeting=True vs False"
- "At +20% CPI, does the new targeting still have positive roas_d60?" → yes if high-engagement mix is ≥45%

### B4c. `payback_analysis` — Cash-cycle finance math

The finance team's view: "we spend $X now and wait N months to get it back." This table
shows the **running cumulative revenue per cohort dollar spent** at each horizon, making
the payback period visible and comparable across channels and geos.

```sql
CREATE OR REPLACE TABLE payback_analysis AS
WITH cohort_spend AS (
  SELECT
    strftime('%Y-%m', cohort_date) AS install_month,
    channel, country,
    SUM(cost)     AS ua_spend,
    SUM(installs) AS installs
  FROM cac_by_channel
  GROUP BY 1, 2, 3
),
cohort_ltv AS (
  SELECT
    strftime('%Y-%m', cohort_date) AS install_month,
    channel, country,
    AVG(CASE WHEN days_from_cohort =  7 THEN avg_projected_ltv END) AS d7_ltv,
    AVG(CASE WHEN days_from_cohort = 30 THEN avg_projected_ltv END) AS d30_ltv,
    AVG(CASE WHEN days_from_cohort = 60 THEN avg_projected_ltv END) AS d60_ltv,
    AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
    SUM(CASE WHEN days_from_cohort = 90 THEN cohort_installs END)   AS cohort_installs
  FROM ltv_by_cohort
  GROUP BY 1, 2, 3
)
SELECT
  s.install_month,
  s.channel,
  s.country,
  s.ua_spend,
  s.installs,
  s.ua_spend / NULLIF(s.installs, 0)           AS cpi,
  l.d7_ltv, l.d30_ltv, l.d60_ltv, l.d90_ltv,
  -- Cumulative revenue estimate per cohort at each horizon
  l.d7_ltv  * s.installs                        AS rev_d7,
  l.d30_ltv * s.installs                        AS rev_d30,
  l.d60_ltv * s.installs                        AS rev_d60,
  l.d90_ltv * s.installs                        AS rev_d90,
  -- Payback ratio (cumulative revenue / ua_spend)
  ROUND(l.d7_ltv  * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d7,
  ROUND(l.d30_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d30,
  ROUND(l.d60_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d60,
  ROUND(l.d90_ltv * s.installs / NULLIF(s.ua_spend, 0), 3) AS payback_ratio_d90
FROM cohort_spend s
LEFT JOIN cohort_ltv l
  ON l.install_month = s.install_month
 AND l.channel       = s.channel
 AND l.country       = s.country
ORDER BY s.install_month, s.channel, s.country;
```

**Cash-cycle story:** Aug 2025 cohort: `ua_spend = $55K`, `payback_ratio_d30 = 0.14`
(14% recovered in 30 days), `payback_ratio_d90 = 0.42` (42% recovered in 90 days).
Finance sees a $47K cash hole at D30. Only after ~D180–D270 does the cohort break even.
This is the "marketing is right over a longer horizon" argument — made concrete with numbers.

**Domain hints to add:**
- "For payback period / cash-cycle: use `payback_analysis`. `payback_ratio_d90 = 0.42` means
  42% of UA spend recovered by day 90. Full payback typically at D180–D360 for mid-core games."
- "For monthly cash flow: join `payback_analysis.ua_spend` (monthly outflow) with
  `monthly_revenue_summary.net_revenue` (monthly inflow). The gap is working capital needed."

---

## Part C: `src/lib/datasets/gameramp.ts` Changes

### C1. App name, date range, entity name

```typescript
{
  id: "gameramp",
  label: "Presto",
  dbFile: "data/gameramp.duckdb",
  sourceType: "duckdb",
  primaryTable: "installs",
  userIdField: "user_id",
  dateField: "install_date",
  dateRange: { start: "2025-08-01", end: "2026-02-28" },
  currency: "$",
  entityName: "players",
}
```

### C2. Add `cac_by_month` to `summaryTableSQL`

Same SQL as in `setup-gameramp.ts` (B1 above). Required for Railway `ensureDatasetReady`.

### C3. Update `schemaContext` table listing

Add all new tables to the documentation block:

```
cac_by_month       — Monthly CPI: install_month VARCHAR, channel, country, os,
                     total_spend, installs, avg_cpi.
                     Use for CPI TREND (smoother than cac_by_channel daily granularity).

segment_trends     — KPI trends by install_month × channel × country × platform:
                     installs, d7/d30/d60_retention, d7/d30/d60/d90_ltv, avg_arpdau.
                     Primary table for sliced trend analysis.

roas_by_cohort     — RoAS by install_month × channel × country × platform:
                     avg_cpi, d7/d30/d60/d90_ltv, roas_d30/d60/d90.
                     Use for RoAS elasticity and payback ROI analysis.

payback_analysis   — Cash-cycle finance view by install_month × channel × country:
                     ua_spend, installs, cpi, rev_d7/d30/d60/d90,
                     payback_ratio_d7/d30/d60/d90.
                     Use for payback period, cash flow gap, and working capital stories.

ad_impression_events — Raw impression events. Includes reported_revenue, settled_revenue
                     (post-fraud), AND net_revenue (post-platform-fee).
```

### C4. Add all new tables to `summaryTableHint`

Update the authoritative table list injected into SQL prompts to include:
`cac_by_month`, `segment_trends`, `roas_by_cohort`, `payback_analysis`.

### C5. Domain hints — full updated list

Replace existing domain hints with this complete set:

1. **CPI tables:** "For CPI **trend over time**: `cac_by_month` (monthly, smooth). For cohort/daily CPI: `cac_by_channel`."
2. **Revenue vocabulary:** "`reported_revenue` = gross MMP. `settled_revenue` = post-fraud. `net_revenue` = post-platform-fee. Finance books `net_revenue`; marketing uses `settled_revenue`."
3. **LTV horizons:** "`ltv_by_cohort.avg_projected_ltv` at `days_from_cohort` 7/30/60/90. `segment_trends` has pre-pivoted columns."
4. **Fraud:** "`ad_impression_events` fraud rate is channel-specific (Vungle ~17%, Moloco ~14%, AdMob ~11%, Facebook ~6%). `monthly_revenue_summary.settled_revenue` is the audited figure."
5. **Segment cuts:** "For slicing KPIs by install_month × channel × country × platform: use `segment_trends`. Supports retention, LTV, ARPDAU trend per segment."
6. **RoAS:** "For RoAS and payback ROI: `roas_by_cohort.roas_d90` > 1.0 = profitable at 90-day horizon. Facebook typically crosses break-even at D90; Vungle never does."
7. **Cash-cycle:** "`payback_analysis.payback_ratio_d90` = fraction of UA spend recovered by day 90. Full payback ~D180-D360. For monthly cash flow: `payback_analysis.ua_spend` (outflow) vs `monthly_revenue_summary.net_revenue` (inflow) — the gap is working capital required."
8. **Period vs cohort:** "`cac_by_channel` SUM by month vs `monthly_revenue_summary` by month — diverge for recent months. That gap IS the payback lag story (Scenario 3)."
9. **ARPDAU:** "`arpdau_trend` for flat-ARPDAU check (Scenario 5). `segment_trends.avg_arpdau` for geo/channel cuts."
10. **Geo risk:** "`ltv_by_cohort` WHERE `days_from_cohort` = 14 vs 90 — IN/BR/ID/MX D14/D90 ratio ~0.68 vs US/GB ~0.44. Emerging geos are frontloaded."

### C5b. Add engagement tier domain hints (append to hint list)

11. **Engagement tiers:** "`installs.engagement_tier` = 'low' (0-2 games D7), 'medium' (3-4), 'high' (5+). High-engagement players have ~4.6× better D30 retention than low. Use `engagement_analysis` for tier breakdowns."
12. **New targeting signal:** "`installs.is_new_targeting = true` marks Facebook users from Jan 2026 onward who were acquired under the 5-game targeting criteria (45% high-engagement vs 30% prior). Compare with `is_new_targeting = false` to see the early retention improvement."
13. **Targeting ROI:** "New targeting increases Facebook CPI by ~20% but raises high-engagement mix from 30% → 45%. Net effect: `roas_d60` stays positive. Use `engagement_analysis` WHERE `channel='facebook'` to compare old vs new cohorts."

### C5c. Add key prompts for engagement scenario

Add to `suggestedPrompts`:
- "Show me D60 LTV broken down by engagement tier for Facebook — how much stickier are 5-game players?"
- "Has switching to 5-game targeting in January improved Facebook retention?"
- "At the higher CPI of the new targeting, does the D60 RoAS still justify the switch?"
- "Compare high-engagement vs low-engagement player LTV across all channels"

### C6. Update all date references in domain hints

Any hint referencing "Feb 2025" or "Nov 2025" must be updated to "Aug 2025" and "Feb 2026".

---

## Part D: Scatter Chart TypeScript Changes

### D1. `src/lib/chart-types.ts`

Add `"scatter"` to the type union:

```typescript
// Before (line 2):
type: "bar" | "line" | "area" | "pie";

// After:
type: "bar" | "line" | "area" | "pie" | "scatter";
// No new fields needed:
//   xKey  = numeric X axis column (e.g., "avg_cpi")
//   yKeys[0] = numeric Y axis column (e.g., "avg_d60_ltv")
//   nameKey = dot label column (e.g., "channel") — same field as pie, different semantic
```

### D2. `src/components/chart/report-chart.tsx`

**Step 1:** Add to Recharts imports (around line 5-21):
```typescript
ScatterChart, Scatter,
```

**Step 2:** Add early-return scatter branch before the bar/line/area block (before the
`ChartComponent` ternary, around line 373):

```tsx
if (spec.type === "scatter") {
  const xKey    = spec.xKey;
  const yKey    = spec.yKeys?.[0];
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

**Rendering contract:**
- `xKey` → numeric column → `<XAxis type="number">` (Recharts computes domain)
- `yKeys[0]` → numeric column → `<YAxis type="number">`
- `nameKey` → string column for dot labels — safe to reuse from pie since they're separate render branches
- Click-to-drill-down: omit for this iteration
- Uses early-return pattern (same as `pie`) — does NOT go through `renderSeries()`

**GamerRamp use case:** `(avg_cpi, avg_d60_ltv, channel)` — one dot per channel,
showing "does higher CPI produce higher LTV?" visually as a scatter plot.

**Excluded from scope:**
- `src/app/api/decks/process/route.ts` — scatter charts added to boards manually, not via deck LLM
- `src/components/canvas/canvas-config-panel.tsx` — no picker change needed

---

## Execution Order

```
1. scripts/generate-gameramp.py
   a. Update docstring (app name "Presto", date range Aug 2025–Feb 2026)
   b. Update START_DATE / END_DATE
   c. Replace D30_RETENTION with 7-month curve (Aug 0.150 → Feb 0.081)
   d. Replace MONTHLY_SPEND with 7-month profile ($55K Aug → $125K Dec → $68K Feb)
   e. Add Dec/Jan holiday premium to AR(1) CPI model (Dec 1.45×, Jan 1.18×)
   f. Add PLATFORM_FEE dict + net_revenue column to ad_impression_events generation

2. pnpm lint  ← TypeScript changes
   a. src/lib/chart-types.ts — add "scatter" to type union
   b. src/components/chart/report-chart.tsx — add ScatterChart import + scatter branch

3. scripts/setup-gameramp.ts
   a. Add cac_by_month table (B1)
   b. Add segment_trends table (B4a)
   c. Add roas_by_cohort table (B4b)
   d. Add payback_analysis table (B4c)
   e. Update monthly_revenue_summary to include net_revenue column
   f. Add scenarios 3, 5, 6 verification queries (B2)

4. src/lib/datasets/gameramp.ts
   a. Update label → "Presto", dateRange → Aug 2025–Feb 2026 (C1)
   b. Add all new tables to summaryTableSQL (C2)
   c. Update schemaContext with all new tables (C3)
   d. Update summaryTableHint (C4)
   e. Replace domain hints with full updated set (C5)
   f. Update date references (C6)

5. python3 scripts/generate-gameramp.py --scale 1.0 --seed 42
   ← Regenerates all 5 parquet files with Presto branding + new dates + net_revenue
      + engagement_tier + is_new_targeting columns in installs

6. npx tsx scripts/setup-gameramp.ts
   ← Rebuilds gameramp.duckdb: 10 summary tables + scenario 3/5/6 verification
      (added: engagement_analysis)

7. pnpm lint  ← Final lint pass
```

---

## Acceptance Criteria

### Data Generation
- [ ] `generate-gameramp.py` prints "Presto — casual/mid-core mobile puzzle game" in header
- [ ] Output covers Aug 1, 2025 → Feb 28, 2026 (~212 days)
- [ ] `MONTHLY_SPEND` keys are "2025-08" through "2026-02"
- [ ] `D30_RETENTION` keys are "2025-08" through "2026-02" with values 0.150 → 0.081
- [ ] Dec CPI premium ~1.45× visible in `cac_by_channel` medians for Dec 2025
- [ ] `ad_impression_events` includes `net_revenue = settled_revenue × (1 - 0.30)`
- [ ] All 5 parquet files regenerated cleanly at `--scale 1.0`

### DuckDB Setup (9 summary tables total)
- [ ] `cac_by_month` — install_month VARCHAR "2025-08", avg_cpi, installs, total_spend
- [ ] `segment_trends` — d7/d30/d60_retention, d7/d30/d60/d90_ltv, avg_arpdau per segment
- [ ] `roas_by_cohort` — avg_cpi, d30/d60/d90_ltv, roas_d30/d60/d90 per cohort
- [ ] `payback_analysis` — ua_spend, rev_d7/d30/d60/d90, payback_ratio_d7/d30/d60/d90
- [ ] `monthly_revenue_summary` updated to include `net_revenue`
- [ ] `npx tsx scripts/setup-gameramp.ts` prints scenario 3, 5, 6 verification
- [ ] Scenario 3: ua_spend ≥ 3× settled_rev for recent months
- [ ] Scenario 6: IN/BR/ID/MX D14/D90 ratio ~0.67-0.69; US/GB ~0.44-0.45

### Dataset Config
- [ ] App labeled "Presto" in UI dataset switcher
- [ ] `dateRange` → `{ start: "2025-08-01", end: "2026-02-28" }`
- [ ] All 9 tables in `summaryTableSQL`, `schemaContext`, and `summaryTableHint`
- [ ] All 10 domain hints present (revenue vocab, segment cuts, RoAS, cash-cycle, etc.)

### Scatter Chart
- [ ] `ChartSpec["type"]` includes `"scatter"` without breaking existing types
- [ ] `pnpm lint` passes with no TypeScript errors
- [ ] Scatter chart card renders with `(avg_cpi, avg_d60_ltv, channel)` data
- [ ] Numeric X/Y axes auto-scale; dots labeled by `nameKey`

### Engagement Tier Signal
- [ ] `installs` table has `engagement_tier` (low/medium/high) and `is_new_targeting` (bool) columns
- [ ] Facebook high-engagement D30 retention is ~4–5× higher than low-engagement in same channel
- [ ] `engagement_analysis` table exists with tier × channel × is_new_targeting breakdown
- [ ] Facebook Jan/Feb 2026 (`is_new_targeting=true`) shows visibly higher d30_retention vs Aug–Dec 2025
- [ ] `roas_d60` for new targeting cohort is positive despite +20% CPI

### Key Prompts That Must Work
- [ ] "Does higher CPI actually produce higher LTV players? Show the correlation" → scatter chart
- [ ] "Compare D30 retention trend for Facebook vs Vungle users in India" → segment_trends
- [ ] "Which channel has the best D90 RoAS?" → roas_by_cohort
- [ ] "How long until August cohorts pay back their UA spend?" → payback_analysis
- [ ] "Show me gross revenue vs net revenue by channel" → monthly_revenue_summary
- [ ] "Show CPI trend over time by channel" → cac_by_month (smooth line, not noisy)
- [ ] "Show me D60 LTV by engagement tier for Facebook — how much stickier are 5-game players?" → engagement_analysis
- [ ] "Has switching to 5-game targeting in January improved Facebook retention?" → engagement_analysis WHERE is_new_targeting
- [ ] "At the higher CPI of the new targeting, does D60 RoAS still justify the switch?" → engagement_analysis roas_d60

---

## Known Calibration Notes (from audit 2026-03-17)

| Finding | Status | Action |
|---------|--------|--------|
| CPI geo mults: all within ±13% | ✅ Pass | None |
| Retention geo tier ordering correct | ✅ Pass | None |
| Retention geo magnitude: emerging geos -61% vs `GEO_RETENTION_MULT` | ⚠️ Known | Bi-phasic curve compounds multiplicatively. Tier order correct; no scenario broken. Accept as-is. |
| ARPDAU all within ±9% | ✅ Pass | None |
| Fraud gaps exact (Vungle 17.3%, etc.) | ✅ Pass | None |
| D30 decay monotone (8.6%→4.4% in old range) | ✅ Pass | New range will show similar curve |
| Scenario 5 ARPDAU: declining (CV=0.170), not flat | ⚠️ Known | `arpdau_trend` uses monthly DAU denominator; diluted by new-user ramp. Accept or fix denominator SQL post-launch. |

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| `MONTHLY_SPEND` missing Dec 2025 / Jan-Feb 2026 keys causes `avg_spend` fallback | Replace entire dict; script uses `MONTHLY_SPEND.get(mk, avg_spend)` at line 430 — graceful fallback but produces flat CPI |
| `D30_RETENTION` missing 2026 keys causes KeyError | Script uses `.get(install_month, 0.020)` — silent fallback to very low retention. Replace entire dict. |
| AR(1) holiday premium: Dec 1.45× may inflate CPIs unrealistically | Validate median CPI in campaign for Dec — should be ~15-20% above Nov |
| `cac_by_month` must be in BOTH `setup-gameramp.ts` AND `gameramp.ts` `summaryTableSQL` | Both files edited together in step 3+4 |
| Railway DuckDB checkpoint: DDL without CHECKPOINT accumulates WAL | `setup-gameramp.ts` already calls `CHECKPOINT` — keep it |
| Scatter `<XAxis type="number">` needs `dataKey` on `<XAxis>` not `<Scatter>` | Recharts ScatterChart pattern: XAxis/YAxis carry `dataKey`, Scatter gets `data` array |

---

## References

### Internal
- Chart type union: `src/lib/chart-types.ts:2`
- Chart renderer: `src/components/chart/report-chart.tsx:373`
- Dataset config: `src/lib/datasets/gameramp.ts`
- Setup script: `scripts/setup-gameramp.ts`
- Generator: `scripts/generate-gameramp.py`

### Solution Docs
- `docs/solutions/best-practices/synthetic-ua-data-cpi-ltv-calibration.md` — AR(1) model, mid-core CPI/ARPDAU benchmarks
- `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md` — qualify all JOIN columns; use `strftime` not `DATE_TRUNC` for VARCHAR month keys
- `docs/solutions/database-issues/duckdb-wal-replay-alter-table-default-crash.md` — always CHECKPOINT after DDL

### Superseded Plans
- `docs/plans/2026-03-16-feat-gameramp-scatter-chart-dataset-quality-plan.md` — superseded by this file
