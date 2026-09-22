# Alpha Synthetic Dataset — Brainstorm

**Date:** 2026-03-17
**Branch:** feat/presto-synthetic-dataset
**Status:** Ready for planning

---

## What We're Building

A new synthetic demo dataset called **alpha** — a fictional mid-to-large racing game — derived from real distributions sampled from `gc-prod-459709.gameramp` (July 2025). All files use the prefix `alpha_*`. The dataset powers Sentinel demos with richer, more varied data than the existing `gameramp` / `presto` dataset.

---

## Source Dataset Analysis: gameramp (July 2025 Sample)

### Available Tables in BigQuery

| Table | July 2025 Volume | Status |
|---|---|---|
| `installs` | 429,507 rows | ✅ Include |
| `sessions` | 1,328,918 rows | ✅ Include |
| `ad_impression_events` | 814,738 rows | ✅ Include |
| `revenue` (cohort MMP) | ~175K rows | ✅ Include |
| `campaign` (UA spend) | ~5,700 rows | ✅ Include |
| `races` | 5,724,443 rows | ✅ Include |
| `events_hybrid` | 165,271,148 rows | ❌ Skip — 165M rows/month unworkable |
| `iaps` | 0 rows | ❌ Skip — empty |
| `ab_start_events` | 18 rows | ❌ Skip — trivially small |
| `stores_rawdata` | ~15K rows | ❌ Skip — raw AppsFlyer dump, low demo value |
| `tutorial_flows` | Static config | ❌ Skip — internal config only |

### Key Distributions (July 2025)

**installs**
- Platform split: 79% Android / 21% iOS
- Top install countries: Turkey (7.6%), Philippines (7.5%), Algeria (6.9%), China (6.2%), Russia (4.2%), Iraq (4.1%), Brazil (3.3%), Germany (2.8%)
- 220 unique countries
- Daily installs: ~13,900/day average

**sessions**
- Avg session duration: ~1,167s (19.4 minutes)
- Avg events per session: 124.6
- Avg session number per user: 4.25 (mix of new + returning)
- Avg ad revenue per session: $0.009
- IAP conversion rate: ~0.1% of sessions
- Platform: 72% Android / 28% iOS

**ad_impression_events**
- REWARDED: 72% of events, $0.0089 avg revenue
- INTER: 28% of events, $0.0057 avg revenue
- Total July revenue: ~$11,800 ad rev

**campaign (UA spend)**
- Media sources: Facebook Ads, Unity Ads, Organic (dominant)
- Facebook iOS: $1.91 CPI (highest CPI but best quality)
- Unity Android: $0.081 CPI
- Facebook Android: $0.063 CPI
- ~80% of installs are Organic

**revenue (cohort MMP)**
- Organic iOS = strongest monetizer ($534K IAP + $221K ad rev from July cohort)
- Organic Android = high volume, lower IAP ($125K IAP + $158K ad rev)
- Facebook iOS cohort = moderate IAP ($6.5K), best ROAS
- Retention rates: ~8% D7 retention organic iOS, ~5% organic Android
- ROI columns are NULL (not yet populated for recent cohorts)

**races**
- Level types: ClassicRace (largest), TimeScore, BeatTheTime, Survival, Elimination, Multiplayer, FreeDrive
- Win/Lose/null (in-progress/abandoned) results
- ClassicRace Win: avg score 4,967, avg duration 45s, avg 10 overtakes, 2.4 crashes
- TimeScore Win: avg score 10,121 (Android) / 13,185 (iOS), avg duration 50s
- FreeDrive / Multiplayer: much longer duration (270-370s), no win/lose
- ~17.5 races per user per month

---

## Design Decisions

### 1. Genre & Branding
**Decision: Same racing game domain, fresh fictional identity.**

Alpha uses the same table schema as gameramp but represents a different fictional studio's game. Different country distribution weightings, slightly different monetization profile, distinct campaign naming. No schema changes needed — just new synthetic row generation.

**Why:** Schema reuse means zero new TypeScript `DatasetConfig` schema work. The demo story is "same game category, different company" which is a realistic Sentinel use case.

### 2. Tables to Include
**Decision: 6 tables — installs, sessions, ad_impression_events, revenue, campaign, races.**

- `events_hybrid` (165M rows/month) is excluded — 165M × 6 months × 4x = ~4B rows, completely unworkable
- `iaps` is excluded — BQ source is empty, would require full synthetic IAP logic
- `races` included despite its size (see scaling below) — it's the richest engagement signal

### 3. Time Range
**Decision: 6 months (Jan–Jun 2026).**

6 months enables:
- Complete D30/D60/D90 retention curves for early cohorts
- Visible monthly trend lines across all KPIs
- Seasonality simulation (ramp-up in Q1, plateau in Q2)

### 4. Scaling Strategy (Mixed — not flat 4x)
**Decision: Apply per-table scaling factors tuned to DuckDB memory constraints.**

The 4GB DuckDB query memory limit means individual full-table scans must complete safely. Key rule: any single table that exceeds ~20M rows needs careful handling.

| Table | Scale Factor | 6-Month Row Count | Rationale |
|---|---|---|---|
| `installs` | 4x | ~10.3M | Small columns, fast scan |
| `sessions` | 2x | ~16M | Wide table (50+ cols), 2x keeps scan under 3GB |
| `ad_impression_events` | 4x | ~19.6M | Narrow table, compresses well |
| `revenue` | 4x | ~16.8M | Cohort table, mostly numeric |
| `campaign` | 4x | ~137K | Tiny — no constraint |
| `races` | 1x | ~34.3M | Already large; 1x keeps parquet ~2-3GB |

**Total across all tables: ~97M rows.** Each table independently stays within safe DuckDB scan bounds.

### 5. Memory-Safe Generation Approach

**Problem:** 32GB RAM is ample for generation but we must not materialize large tables in RAM all at once.

**Solution: Chunked per-month generation with incremental parquet append.**
- Generate month-by-month, write each month to parquet, clear memory
- Use PyArrow `ParquetWriter` with `write_table()` per chunk (not pandas concat)
- For `races` (largest): generate user-by-user in batches of 10K users

### 6. Parquet Layout
```
data/parquet/alpha/
  alpha_installs.parquet               (~10MB compressed, 10.3M rows)
  alpha_sessions.parquet               (~120MB compressed, 16M rows)
  alpha_ad_impression_events.parquet   (~40MB compressed, 19.6M rows)
  alpha_revenue.parquet                (~35MB compressed, 16.8M rows)
  alpha_campaign.parquet               (<1MB compressed, 137K rows)
  alpha_races.parquet                  (~350MB compressed, 34.3M rows)
```
Uncompressed in-memory: ~3.5GB total across all tables. Snappy-compressed parquet on disk: ~550MB total. DuckDB lazy-scans parquet so only queried columns are loaded into the 4GB memory budget.

### 7. DuckDB View + Summary Table Strategy

Mirror the gameramp pattern exactly:
- `viewSQL`: CREATE OR REPLACE VIEW for each parquet file
- `summaryTableSQL`: Pre-aggregate 8–10 summary tables (same as gameramp: ltv_by_cohort, cac_by_channel, segment_trends, roas_by_cohort, etc.) + add `alpha_race_performance` summary
- Always end setup with `CHECKPOINT` to flush WAL

New summary table: `race_performance_by_level_type` (level_type × country × platform → win_rate, avg_score, avg_duration, avg_overtakes).

---

## Key Country/Channel Differences vs. Gameramp

To make "alpha" feel like a distinct game (not just a reskin), use a shifted geo/channel profile:
- **Alpha's top markets**: US, UK, Germany, France, Brazil (more Western/tier-1 heavy)
- **UA mix**: Google Ads replaces Unity Ads as the main paid channel; Facebook stays; add Apple Search Ads (iOS)
- **Monetization**: Slightly higher IAP conversion (0.15% vs 0.1%), lower ad CPMs (more rewarded, less inter)
- **Seasonality**: Q1 growth spike (new year UA push), Q2 plateau

---

## Open Questions

1. Should the fictional game have a name visible in reports (e.g. "Apex Rush", "Velocity X")? If yes, populate `campaign.app_name` and `revenue.app_name`.
2. ~~What year/date range?~~ **Decided:** Jan 2026–Jun 2026 (see Section 3).
3. ~~Should `alpha_races` include a `race_name`/`track_name` column?~~ **Decided: No.** YAGNI — exact schema match to gameramp's `races` table. No new columns.
4. How many app versions to simulate? gameramp has ~14 versions (0.4.1–0.7.1). Suggest 6 for alpha (1.0.0–1.5.0).

---

## Implementation Files (all prefixed alpha_*)

| File | Purpose |
|---|---|
| `scripts/alpha_generate.py` | Python generator — produces all 6 parquet files |
| `scripts/alpha_setup.ts` | TypeScript setup — runs viewSQL + summaryTableSQL + CHECKPOINT |
| `src/lib/datasets/alpha.ts` | DatasetConfig TypeScript definition |
| Registration in `src/lib/datasets/index.ts` | Add to STATIC_DATASETS |

