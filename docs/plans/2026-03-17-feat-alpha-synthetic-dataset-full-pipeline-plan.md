---
title: "feat: Alpha synthetic racing dataset — generator, setup, and DatasetConfig"
type: feat
date: 2026-03-17
deepened: 2026-03-17
brainstorm: docs/brainstorms/2026-03-17-alpha-synthetic-dataset-brainstorm.md
---

# feat: Alpha Synthetic Racing Dataset — Full Pipeline

---

## Enhancement Summary

**Deepened on:** 2026-03-17
**Research sources:** gameramp generator analysis, 3 parallel research agents, 4 project solution docs
**Gaps filled:** 3 (get_active_users_for_month spec, GROUP BY bug, ltv projected columns)

### Key Improvements Added

1. **`get_active_users_for_month()` fully specified** — vectorized numpy approach matching gameramp's retention matrix pattern; avoids per-row Python loops that would cause `--scale 1.0` to run for hours instead of minutes
2. **GROUP BY bug fixed (Gap 2)** — `race_performance_by_level_type` had `GROUP BY 1, 2, 3, 4, 12` (position 12 = completion_rate, an aggregate). Corrected to explicit named GROUP BY with table aliases
3. **`ltv_by_cohort` projected LTV columns specified (Gap 3)** — `d30_projected_ltv` and `d90_projected_ltv` must be generated in `gen_revenue()` (not SQL), baked in as Python dict lookup per cohort month using frozen D30 retention. Precise per-month frozen D30 values calculated (Jan: 0.130 → Jun: 0.138)
4. **`ltv_by_cohort` subquery bug fixed (Gap 4)** — `race_performance_by_level_type`'s LEFT JOIN subquery did `SELECT user_id FROM ltv_by_cohort` which fails at runtime (`ltv_by_cohort` has no `user_id`). Fixed to route through `installs LEFT JOIN ltv_by_cohort` on cohort key dimensions
5. **Performance guidance added** — columnar Arrow construction (no list-of-dicts for 5.7M/month), `timedelta64` date arithmetic instead of `rng.choice()` on Python date objects, DictionaryArray encoding for low-cardinality strings
6. **Scenario verification checks hardened** — added Python-level post-generation checks matching gameramp's `main()` pattern; scale-dependent (sign checks always, magnitude checks at ≥0.05×)
7. **DuckDB ambiguous column risk flagged** — all JOINed tables sharing column names (installs + sessions, installs + revenue) must use qualified `table.column` aliases in GROUP BY / ORDER BY

### New Considerations Discovered

- The `gen_races()` inner loop (user-level Python for loop) is the main OOM/slowness risk at `--scale 1.0` — must be vectorized with `np.repeat()` + columnar construction, not list-of-dicts per race
- `rng.choice(pd.date_range(...).date, size=n)` creates Python date objects in a list — very slow at 5.7M rows. Use integer day offsets + `timedelta64` arithmetic instead
- Frozen D30 projection model for Jan 2026 cohorts must use a hardcoded pre-dataset training window (~0.130) since the dataset starts Jan 2026 (no Oct–Dec 2025 actuals exist)
- `race_performance_by_level_type` joins races (34M rows) to `ltv_by_cohort` via user_id — **`ltv_by_cohort` does NOT have a `user_id` column** (it's a cohort-level aggregate). The subquery in the plan's SQL is wrong — it must go through `installs` to get per-user d30_ltv (see Gap 4 below)
- **Gap 4 (new):** `race_performance_by_level_type` subquery bug — `SELECT user_id FROM ltv_by_cohort` will fail at runtime because `ltv_by_cohort` aggregates at cohort grain, not user grain. Fix: join through `installs LEFT JOIN ltv_by_cohort` on cohort dimensions
- Compression: `snappy` is correct for DuckDB-read-heavy workloads (fastest decompression); `zstd` level 3 saves ~23% disk space but has 3× slower decompression — for a 500MB races file scanned frequently, snappy is the right call

---

## Overview

Create a complete synthetic demo dataset called **alpha** — a fictional Western-market racing game — derived from real distributions sampled from `gc-prod-459709.gameramp` (July 2025). All new files are prefixed `alpha_*`. The dataset powers Sentinel demos with fresh data, a distinct geo/channel profile, and races-level engagement analytics.

**Output:** 6 parquet files totalling ~600MB compressed, a DuckDB setup script, and a full `DatasetConfig` registration.

---

## Source Data Profile (July 2025 — Reference Month)

| Table | BQ July 2025 Volume | Alpha Scale | Alpha 6-Month Rows |
|---|---|---|---|
| `installs` | 429,507 / month | 4× | ~10.3M |
| `sessions` | 1,328,918 / month | 2× | ~16M |
| `ad_impression_events` | 814,738 / month | 4× | ~19.6M |
| `revenue` (cohort MMP) | 177,338 / month | 4× | ~4.3M |
| `campaign` (UA spend) | 5,700 / month | 4× | ~137K |
| `races` | 5,724,443 / month | 1× | ~34.3M |

**Date range:** Jan 1 2026 – Jun 30 2026 (6 months)

---

## Key Design Decisions

### Alpha Identity
- **Dataset ID:** `"alpha"` (propagates into parquet directory, DuckDB filename, API headers)
- **DuckDB file:** `data/alpha.duckdb`
- **Parquet directory:** `data/parquet/alpha/`
- **Display label:** `"Alpha"` (fictional studio)
- **DEFAULT_DATASET stays `"gameramp"`** — alpha is accessible via the dataset switcher only

### Platform Distribution
- Alpha is Western-heavy: **55% iOS / 45% Android** (vs gameramp's 21% iOS / 79% Android)
- Top markets: US (12%), UK (8%), Germany (8%), France (7%), Brazil (6%), Canada (5%), Australia (4%), Japan (4%)
- 160 unique countries total (vs gameramp's 220 — more concentrated)

### UA Channel Set (Acquisition)
| Channel | iOS CPI | Android CPI | Fraud Rate |
|---|---|---|---|
| `google_uac` | $4.50 | $2.00 | 4% |
| `facebook_ads` | $5.20 | $2.50 | 8% |
| `apple_search_ads` | $6.80 | — (iOS only) | 0.5% |
| `organic` | — | — | 1% |

~30% of installs are paid (vs ~20% in gameramp). Apple Search Ads is iOS-only.

### In-App Ad Networks (Monetization)
`AD_NETWORKS = ["admob_network", "ironsource", "applovin", "facebook_audience"]`
Unity Ads dropped for the Western-market narrative. Google AdMob is the primary network.

### Monetization Profile
- IAP conversion rate: **0.15%** of sessions (vs 0.1% in gameramp)
- ARPDAU: US iOS $0.55 / US Android $0.38 / GB iOS $0.46 / DE iOS $0.41 / BR Android $0.12
- Ad format mix: 70% REWARDED / 30% INTER (same as gameramp)

### Engagement Tier
Carry forward `engagement_tier` and `is_new_targeting` unchanged. Racing-game tier labels in domain hints: Casual (1–2 races/session), Competitive (3–4), Hardcore (5+).

### Races Table Schema
Mirror gameramp BQ schema, simplified to analytics-relevant columns:

```sql
races (
  race_id          VARCHAR,     -- UUID
  user_id          VARCHAR,     -- FK to installs
  dt               DATE,        -- race date (date32 in parquet — never pd.to_datetime)
  platform         VARCHAR,     -- "IOS" | "ANDROID"
  country          VARCHAR,
  app_version      VARCHAR,
  level_type       VARCHAR,     -- "ClassicRace" | "TimeScore" | "BeatTheTime" |
                                --  "Survival" | "Elimination" | "Multiplayer" | "FreeDrive"
  result           VARCHAR,     -- "Win" | "Lose" | NULL (in-progress / FreeDrive)
  level_duration   DOUBLE,      -- seconds
  score            DOUBLE,      -- NULL for FreeDrive / Multiplayer
  overtakes        INTEGER,     -- NULL for non-competitive types
  crash_number     INTEGER,
  is_level_completed INTEGER,   -- 0 | 1
  car              VARCHAR,     -- "SportsCar" | "Muscle" | "Exotic" | "Truck"
  level_name       VARCHAR      -- e.g. "City Sprint 1", "Highway 3"
)
```

Level type distribution (from BQ July 2025): ClassicRace 45%, TimeScore 28%, BeatTheTime 10%, Survival 9%, Elimination 5%, Multiplayer 2%, FreeDrive 1%.

### Races: Single-File Chunked Write
Output: one `alpha_races.parquet` file written via `pq.ParquetWriter` in monthly append chunks (not monthly shards). Each monthly chunk: ~5.7M rows × ~30 bytes avg = ~170MB in memory. 6 chunks total. `viewSQL` uses single-file path (not glob).

### Summary Narrative (systemContext)
Alpha's core analytical debate: **"We've proven Western markets at $5–7 CPI — should we now launch LatAm/APAC at $1–2 CPI or optimize CPI payback in existing markets first?"**

### Engineered Scenarios (6 — must be verifiable in generated data)

| # | Scenario | Signal Target |
|---|---|---|
| 1 | **CPI↔LTV correlation** | Google UAC ($4.50 CPI) → D90 LTV ~$3.80; Facebook ($5.20 CPI) → D90 LTV ~$4.20; Apple Search Ads ($6.80 CPI) → D90 LTV ~$5.60. Higher CPI = higher LTV, positive correlation. |
| 2 | **Fraud/settlement gap** | Apple Search Ads ~0.5% fraud; Google UAC ~4%; Facebook ~10.5%; `settled_revenue` / `reported_revenue` ratio should be 99.5%, 96%, 89.5% respectively. |
| 3 | **New targeting A/B** | Facebook users from Jan 2026 onward (`is_new_targeting=True`) have 45% high-engagement mix vs 30% prior. D30 retention should be ~18% higher for `is_new_targeting=True` cohorts. CPI +20%. Net `roas_d60` stays positive. |
| 4 | **Stale LTV model** | D30 retention decays Jan 18% → Jun 11.4% (37% decline). A model calibrated on Jan cohort will overestimate Jun LTV by ~60%. |
| 5 | **iOS/Android monetization split** | iOS ARPDAU ~1.5–1.8× Android. iOS revenue: 72% IAP / 28% ad. Android revenue: 10% IAP / 90% ad. Segment trends should show this clearly in `arpdau_trend`. |
| 6 | **Geo expansion risk** | Brazil/Mexico D14/D90 LTV ratio ~0.68 (frontloaded). US/UK/DE ratio ~0.44 (gradual). Using a US-calibrated D90 projection from D14 data will overshoot LatAm D90 by ~55%. |

---

## Files to Create

| File | Purpose |
|---|---|
| `scripts/alpha_generate.py` | Python generator — 6 parquet files |
| `scripts/alpha_setup.ts` | TypeScript setup — DuckDB views + 11 summary tables + CHECKPOINT |
| `src/lib/datasets/alpha.ts` | Full `DatasetConfig` |
| Edit `src/lib/datasets/index.ts` | Add `alpha: alphaDataset` to `STATIC_DATASETS` |

**No other files touched.**

---

## Implementation Phases

### Phase 1: Python Generator (`scripts/alpha_generate.py`)

> Template: `scripts/generate-gameramp.py`. Add `gen_races()` as a new function. Use the same write helper pattern with monthly chunking for races only.

#### 1.1 Constants & Configuration

```python
# alpha_generate.py

DATASET_ID   = "alpha"
START_DATE   = date(2026, 1, 1)
END_DATE     = date(2026, 6, 30)
NUM_MONTHS   = 6
BASE_SCALE   = 1.0   # CLI --scale multiplier

# Platform distribution — Western-heavy
PLATFORM_IOS_PROB = {
    "United States": 0.72, "United Kingdom": 0.68, "Germany": 0.62,
    "France": 0.60, "Japan": 0.75, "Canada": 0.70, "Australia": 0.71,
    "Brazil": 0.30, ...  # default 0.40 for unlisted
}

# Acquisition channels + CPI anchors
CHANNELS = ["google_uac", "facebook_ads", "apple_search_ads", "organic"]
CHANNEL_CPI_BASE_IOS = {
    "google_uac": 4.50, "facebook_ads": 5.20,
    "apple_search_ads": 6.80, "organic": 0.0
}
CHANNEL_CPI_BASE_ANDROID = {
    "google_uac": 2.00, "facebook_ads": 2.50,
    "apple_search_ads": None,  # iOS only
    "organic": 0.0
}
CHANNEL_FRAUD_RANGE = {
    "google_uac": (0.02, 0.06), "facebook_ads": (0.05, 0.12),
    "apple_search_ads": (0.00, 0.01), "organic": (0.00, 0.02)
}

# Retention — mid-core game, higher than gameramp (D30: 10-18%)
D30_RETENTION_BY_MONTH = {
    "2026-01": 0.180,   # launch — new year spike, best cohorts
    "2026-02": 0.165,
    "2026-03": 0.152,
    "2026-04": 0.138,
    "2026-05": 0.125,
    "2026-06": 0.114,   # 37% decline — stale model signal
}

# In-app ad networks
AD_NETWORKS = ["admob_network", "ironsource", "applovin", "facebook_audience"]

# ARPDAU by market — higher than gameramp due to Western focus
ARPDAU_BASE = {
    ("United States", "IOS"): 0.55,
    ("United States", "ANDROID"): 0.38,
    ("United Kingdom", "IOS"): 0.46,
    ("Germany", "IOS"): 0.41,
    ("France", "IOS"): 0.38,
    ("Brazil", "ANDROID"): 0.12,
    ("Japan", "IOS"): 0.62,
    ...  # default 0.18
}

# Race level types and weights (from BQ July 2025)
LEVEL_TYPES = ["ClassicRace", "TimeScore", "BeatTheTime",
               "Survival", "Elimination", "Multiplayer", "FreeDrive"]
LEVEL_TYPE_WEIGHTS = [0.45, 0.28, 0.10, 0.09, 0.05, 0.02, 0.01]

# Race cars
CARS = ["SportsCar", "Muscle", "Exotic", "Truck"]

# Level names by type
LEVEL_NAMES = {
    "ClassicRace": ["City Sprint {n}", "Highway {n}", "Mountain Pass {n}", ...],
    "TimeScore":   ["Time Trial {n}", "Speed Run {n}", ...],
    ...
}
```

#### 1.2 `gen_installs(scale, rng)` → `alpha_installs.parquet`

- Same structure as gameramp `gen_installs`
- Total installs: 430,000 × scale × 4 × (1 + monthly_trend) per month
- Monthly trend: +5% per month (ramp-up: 100%, 105%, 110%, 115%, 120%, 125%)
- Country weights: US 12%, UK 8%, DE 8%, FR 7%, BR 6%, CA 5%, AU 4%, JP 4%, rest 46%
- Engagement tier: `rng.choice(["casual", "competitive", "hardcore"], p=[0.65, 0.25, 0.10])`
- `is_new_targeting`: For Facebook channel only — `False` for installs before 2026-01-01, `True` for Jan 2026 onward. When `True`, draw engagement tier from `[0.15, 0.40, 0.45]` (45% hardcore) instead of `[0.65, 0.25, 0.10]`. Apply 1.20× CPI multiplier for these users. For all other channels: always `False`.
- **Date columns** (`install_dt`): keep as `datetime.date` — never `pd.to_datetime()`

> **Pattern (from gameramp):** Install dates are assigned via `rng.choice(TOTAL_DAYS, size=n, p=date_weights)` then converted to `datetime.date` with `START_DATE + timedelta(days=int(offset))`. Date weights are proportional to daily UA spend (paid) or blend of spend + uniform (organic). `user_id` is a sequential counter formatted as `f"u_{uid:08d}"` — not UUID, which is far faster at scale.

#### 1.3 `gen_sessions(installs, rng)` → `alpha_sessions.parquet`

- Same logic as gameramp, 2× scale relative to gameramp sessions/install ratio
- Session duration: `rng.lognormal(3.6, 0.65)` (slightly longer sessions — more engaged player base)
- IAP transaction flag: Bernoulli(0.0015 per session) — 0.15% conversion
- **Column `dt`** (session date): keep as `datetime.date`

#### 1.4 `gen_races(installs, rng)` → `alpha_races.parquet` ⚠️ NEW FUNCTION

This is the only novel function. Uses monthly chunked ParquetWriter.

```python
def gen_races(installs: pd.DataFrame, rng: np.random.Generator) -> None:
    """
    Generate races table in monthly chunks to avoid OOM.
    Target: ~5.72M rows/month × 6 months = ~34.3M total.
    Races/session ratio: 2.14 races per session (calibrated from BQ July 2025
    at 1x scale with 2x sessions: 5.72M races / 2.67M sessions/month = 2.14)
    """
    outpath = OUTPUT_DIR / "alpha_races.parquet"
    writer = None

    for month_start in month_range(START_DATE, END_DATE):
        month_end = last_day_of_month(month_start)
        month_str = month_start.strftime("%Y-%m")

        # Active users this month: cohort + retained users from prior months
        active_users = get_active_users_for_month(installs, month_start, month_end, rng)
        # ~326K active users/month at 1x scale

        rows = []
        for _, user in active_users.iterrows():
            # Races per user this month: Poisson(17.5)
            n_races = max(1, int(rng.poisson(17.5)))
            race_dates = rng.choice(
                pd.date_range(month_start, month_end).date,
                size=n_races
            )
            level_types = rng.choice(LEVEL_TYPES, size=n_races, p=LEVEL_TYPE_WEIGHTS)

            for i in range(n_races):
                lt = level_types[i]
                is_competitive = lt not in ("Multiplayer", "FreeDrive")
                completed = bool(rng.random() > 0.35) if is_competitive else True
                result = None
                if is_competitive and completed:
                    result = "Win" if rng.random() > 0.45 else "Lose"

                rows.append({
                    "race_id":          str(uuid4()),
                    "user_id":          user["user_id"],
                    "dt":               race_dates[i],          # datetime.date — NOT pd.Timestamp
                    "platform":         user["platform"],
                    "country":          user["country"],
                    "app_version":      user["app_version"],
                    "level_type":       lt,
                    "result":           result,
                    "level_duration":   _race_duration(lt, rng),
                    "score":            _race_score(lt, result, rng) if is_competitive else None,
                    "overtakes":        int(rng.integers(0, 25)) if is_competitive else None,
                    "crash_number":     int(rng.integers(0, 12)) if is_competitive else None,
                    "is_level_completed": int(completed),
                    "car":              rng.choice(CARS, p=[0.40, 0.25, 0.25, 0.10]),
                    "level_name":       _level_name(lt, rng),
                })

        # Build explicit PyArrow schema to enforce date32 (not timestamp)
        schema = pa.schema([
            ("race_id",           pa.string()),
            ("user_id",           pa.string()),
            ("dt",                pa.date32()),     # ← CRITICAL: pa.date32(), not pa.timestamp
            ("platform",          pa.string()),
            ("country",           pa.string()),
            ("app_version",       pa.string()),
            ("level_type",        pa.string()),
            ("result",            pa.string()),
            ("level_duration",    pa.float64()),
            ("score",             pa.float64()),
            ("overtakes",         pa.int32()),
            ("crash_number",      pa.int32()),
            ("is_level_completed", pa.int32()),
            ("car",               pa.string()),
            ("level_name",        pa.string()),
        ])

        table = pa.Table.from_pydict(
            {k: [r[k] for r in rows] for k in schema.names},
            schema=schema
        )

        if writer is None:
            writer = pq.ParquetWriter(outpath, schema, compression="snappy")
        writer.write_table(table)
        del rows, table
        print(f"  races {month_str}: {len(active_users)} users written")

    if writer:
        writer.close()
```

> **⚠️ CRITICAL PERFORMANCE: The inner loop above (list-of-dicts per race) will be extremely slow at scale.**
> See "Research Insights — gen_races() Performance" below for the vectorized replacement.

#### Research Insights — `gen_races()` Performance

The plan's inner loop pattern (`for _, user in active_users.iterrows(): for i in range(n_races): rows.append({...})`) has two severe performance problems at `--scale 1.0`:

1. **`iterrows()` on a 326K-row DataFrame is ~0.5–1s alone** — but with 17.5 inner iterations per user, the total is ~5.7M Python dict allocations per month × 6 months = 34M dict allocations just for the loop overhead
2. **`rng.choice(pd.date_range(...).date, size=n_races)` creates Python date objects** — 17.5 Python date objects per user × 326K users = 5.7M Python date objects per month. Converting them to Arrow `date32` requires materializing all of them

**Vectorized replacement using `np.repeat()` + columnar construction:**

```python
# ── Per-user setup ──────────────────────────────────────────────────
n_users = len(active_users)
races_per_user = rng.poisson(17.5, size=n_users).clip(min=1)
total_races = int(races_per_user.sum())

# Expand user attributes to race-level (np.repeat avoids per-race access)
user_idx = np.repeat(np.arange(n_users), races_per_user)  # (total_races,)
user_ids  = active_users["user_id"].to_numpy()[user_idx]
platforms = active_users["platform"].to_numpy()[user_idx]
countries = active_users["country"].to_numpy()[user_idx]
app_vers  = active_users["app_version"].to_numpy()[user_idx]

# ── Date assignment ─────────────────────────────────────────────────
# Use integer day offsets, not Python date objects
days_in_month_n = (month_end - month_start).days + 1
day_offsets = rng.integers(0, days_in_month_n, size=total_races)  # (total_races,)
# Convert to date32: month_start as days-since-epoch + offset
epoch = date(1970, 1, 1)
base_epoch_day = (month_start - epoch).days
race_day_epochs = base_epoch_day + day_offsets   # int32 array, date32 epoch days
# PyArrow date32 accepts integer epoch days directly:
dt_array = pa.array(race_day_epochs.astype("int32"), type=pa.date32())

# ── Level types ─────────────────────────────────────────────────────
level_type_codes = rng.choice(len(LEVEL_TYPES), size=total_races, p=LEVEL_TYPE_WEIGHTS)
level_types = np.array(LEVEL_TYPES)[level_type_codes]
is_competitive = ~np.isin(level_types, ["Multiplayer", "FreeDrive"])

# ── Result: Win/Lose/None ───────────────────────────────────────────
completed = np.where(is_competitive, rng.random(total_races) > 0.35, True)
roll = rng.random(total_races)
result = np.where(is_competitive & completed,
                  np.where(roll > 0.45, "Win", "Lose"),
                  None)

# ── Durations, scores, overtakes, crashes ──────────────────────────
# (vectorized per level_type using precomputed means)
level_duration = np.zeros(total_races, dtype=np.float64)
for i, lt in enumerate(LEVEL_TYPES):
    mask = level_type_codes == i
    mu, sigma = LEVEL_DURATION_LOGNORMAL[lt]
    level_duration[mask] = rng.lognormal(mu, sigma, mask.sum())

# ── Car + level_name ────────────────────────────────────────────────
# Use DictionaryArray for low-cardinality strings (1 byte/row vs 8-15 bytes)
car_codes = rng.choice(len(CARS), size=total_races, p=[0.40, 0.25, 0.25, 0.10])
car_array = pa.DictionaryArray.from_arrays(
    pa.array(car_codes.astype("int8"), type=pa.int8()),
    pa.array(CARS),
)

# ── UUID generation ─────────────────────────────────────────────────
# str(uuid4()) in a 34M-row loop would take ~60s.
# Instead, generate random bytes in bulk and format:
raw = rng.integers(0, 256, size=(total_races, 16), dtype=np.uint8)
# Set version (4) and variant bits per RFC 4122:
raw[:, 6] = (raw[:, 6] & 0x0F) | 0x40
raw[:, 8] = (raw[:, 8] & 0x3F) | 0x80
race_ids = [
    f"{b[0]:02x}{b[1]:02x}{b[2]:02x}{b[3]:02x}-"
    f"{b[4]:02x}{b[5]:02x}-{b[6]:02x}{b[7]:02x}-"
    f"{b[8]:02x}{b[9]:02x}-{b[10]:02x}{b[11]:02x}{b[12]:02x}{b[13]:02x}{b[14]:02x}{b[15]:02x}"
    for b in raw
]
# For even faster UUID generation, consider:
# import uuid; [str(uuid.UUID(bytes=bytes(b))) for b in raw]
# or store race_id as int64 pairs (no UUID format needed for analytics)

# ── Build Arrow table directly ──────────────────────────────────────
table = pa.table({
    "race_id":           pa.array(race_ids, type=pa.string()),
    "user_id":           pa.array(user_ids, type=pa.string()),
    "dt":                dt_array,
    "platform":          pa.DictionaryArray.from_arrays(
                            pa.array(pd.Categorical(platforms).codes.astype("int8")),
                            pa.array(["ANDROID", "IOS"]),
                         ),
    "country":           pa.array(countries, type=pa.string()),
    "app_version":       pa.array(app_vers, type=pa.string()),
    "level_type":        pa.DictionaryArray.from_arrays(
                            pa.array(level_type_codes.astype("int8")), pa.array(LEVEL_TYPES)
                         ),
    "result":            pa.array(result, type=pa.string()),
    "level_duration":    pa.array(level_duration, type=pa.float64()),
    "score":             pa.array(score_arr, type=pa.float64()),
    "overtakes":         pa.array(overtakes_arr, type=pa.int32()),
    "crash_number":      pa.array(crash_arr, type=pa.int32()),
    "is_level_completed": pa.array(completed.astype("int32"), type=pa.int32()),
    "car":               car_array,
    "level_name":        pa.array(level_names, type=pa.string()),
})
```

**Constant additions to 1.1:**
```python
LEVEL_DURATION_LOGNORMAL = {
    "ClassicRace": (3.8, 0.30),
    "TimeScore":   (3.9, 0.30),
    "BeatTheTime": (3.7, 0.28),
    "Survival":    (4.2, 0.35),
    "Elimination": (4.0, 0.32),
    "Multiplayer": (5.8, 0.40),
    "FreeDrive":   (5.5, 0.40),
}
```

**ParquetWriter best practices (from research):**

```python
writer = None
try:
    for month_start in month_range(START_DATE, END_DATE):
        # ... build table ...
        if writer is None:
            writer = pq.ParquetWriter(
                outpath,
                schema,
                compression="snappy",   # snappy: best decompression speed for DuckDB scan
                # zstd level 3 saves ~20% disk vs snappy but 3× slower decompression
                # For a DuckDB read-heavy workload, snappy is the right choice
                write_statistics=True,  # enables DuckDB column pruning/pushdown
                data_page_size=1024 * 1024,  # 1MB pages — good for DuckDB reads
            )
        writer.write_table(table)
        del table
finally:
    if writer:
        writer.close()  # always close even if exception — prevents partial file
```

**Helper functions:**
- `_race_duration(level_type, rng)`: lognormal calibrated per level_type from BQ data
  - ClassicRace: lognormal(μ=3.8, σ=0.3) → median ~45s
  - TimeScore: lognormal(μ=3.9, σ=0.3) → median ~50s
  - FreeDrive: lognormal(μ=5.5, σ=0.4) → median ~245s
  - Multiplayer: lognormal(μ=5.8, σ=0.4) → median ~330s
- `_race_score(level_type, result, rng)`: normal with mean from BQ data, ×1.3 for iOS vs Android
- `get_active_users_for_month(installs, month_start, month_end, rng)`: **fully specified below**

#### `get_active_users_for_month()` — Full Specification (Gap 1)

This is the only function not present in `generate-gameramp.py`. It must be vectorized — a Python for-loop over 10.3M installs will be catastrophically slow.

```python
def get_active_users_for_month(
    installs: pd.DataFrame,
    month_start: date,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """
    Return the subset of users who are active during `month_start`'s month.

    "Active" = installed before the month start AND survived retention to that day.
    Uses each user's effective D30 retention (channel × geo × engagement multipliers)
    to compute the probability that they're still playing month_start days after install.

    Vectorized: no Python-level per-user loop.
    """
    # 1. Filter to users installed on or before month_start
    eligible = installs[installs["install_dt"] <= month_start].copy()
    if len(eligible) == 0:
        return eligible

    # 2. Compute days since install for each user at month_start
    eligible["days_since_install"] = (month_start - eligible["install_dt"]).apply(
        lambda d: d.days
    )

    # 3. Compute effective D30 retention per user
    #    (same multiplier hierarchy as gen_sessions):
    #    base_d30 × channel_retention_mult × geo_retention_mult × engagement_retention_mult
    base_d30 = eligible["install_month"].map(D30_RETENTION_BY_MONTH).fillna(0.114)
    ch_mult = eligible["channel"].map(CHANNEL_RETENTION_MULT)
    geo_mult = eligible.apply(
        lambda r: GEO_RETENTION_MULT.get((r["country"], r["platform"]), 0.65), axis=1
    )
    eng_mult = eligible["engagement_tier"].map(ENGAGEMENT_RETENTION_MULT)
    eff_d30 = (base_d30 * ch_mult * geo_mult * eng_mult).clip(0.0, 1.0)

    # 4. Compute retention scalar at days_since_install
    #    Vectorized: numpy arrays for standard and bi-phasic emerging markets
    d = eligible["days_since_install"].to_numpy(dtype=float)
    d30 = eff_d30.to_numpy(dtype=float)
    is_emerging = eligible["country"].isin(EMERGING_MARKET_COUNTRIES).to_numpy()

    # Standard power law: ret = d30 * (30/d)^0.65
    with np.errstate(divide="ignore", invalid="ignore"):
        standard_ret = np.where(d == 0, 1.0, np.minimum(d30 * (30.0 / np.maximum(d, 1e-9)) ** 0.65, 1.0))

    # Bi-phasic for emerging: Phase 1 (d<=14): power 0.55; Phase 2 (d>14): steep cliff 1.8
    with np.errstate(divide="ignore", invalid="ignore"):
        phase1 = np.where(d == 0, 1.0, np.minimum(d30 * (30.0 / np.maximum(d, 1e-9)) ** 0.55, 1.0))
        ret14 = d30 * (30.0 / 14.0) ** 0.55
        phase2 = np.minimum(ret14 * (14.0 / np.maximum(d, 1e-9)) ** 1.8, 1.0)
        emerging_ret = np.where(d <= 14, phase1, phase2)

    retention_prob = np.where(is_emerging, emerging_ret, standard_ret)
    retention_prob = np.clip(retention_prob, 0.0, 1.0)

    # 5. Bernoulli sample: is this user active this month?
    active_mask = rng.random(len(eligible)) < retention_prob

    return eligible[active_mask].reset_index(drop=True)
```

**Constants needed (add to 1.1):**

```python
# Retention multipliers per channel (higher CPI = better retained users)
CHANNEL_RETENTION_MULT = {
    "apple_search_ads": 1.35,   # highest CPI, most committed users
    "facebook_ads":     1.20,
    "google_uac":       1.05,
    "organic":          1.10,   # word-of-mouth: self-selected engaged users
}

# Geo × platform retention multiplier (relative to US iOS = 1.0)
GEO_RETENTION_MULT = {
    ("United States", "IOS"):     1.00,
    ("United States", "ANDROID"): 0.82,
    ("United Kingdom", "IOS"):    0.88,
    ("United Kingdom", "ANDROID"): 0.72,
    ("Germany", "IOS"):           0.82,
    ("Germany", "ANDROID"):       0.67,
    ("France", "IOS"):            0.76,
    ("France", "ANDROID"):        0.60,
    ("Canada", "IOS"):            0.92,
    ("Canada", "ANDROID"):        0.76,
    ("Australia", "IOS"):         0.90,
    ("Australia", "ANDROID"):     0.74,
    ("Japan", "IOS"):             0.95,    # Very high iOS retention market
    ("Japan", "ANDROID"):         0.78,
    ("Brazil", "IOS"):            0.62,
    ("Brazil", "ANDROID"):        0.52,
    ("Mexico", "IOS"):            0.60,
    ("Mexico", "ANDROID"):        0.50,
    # Default (unlisted countries)
}
GEO_RETENTION_MULT_DEFAULT = {"IOS": 0.72, "ANDROID": 0.58}

# Engagement tier retention multiplier (same as gameramp)
ENGAGEMENT_RETENTION_MULT = {
    "casual":      0.40,
    "competitive": 0.90,
    "hardcore":    1.85,
}
```

**Performance note:** At `--scale 1.0` Month 6 (June), eligible users = ~10M cumulative installs. The vectorized numpy approach processes this in ~0.5–1s. A Python for-loop over 10M rows would take 30–60 minutes. The `.apply(lambda d: d.days)` for `days_since_install` is acceptable since it runs once (not per-race); for further optimization, use `(pd.Timestamp(month_start) - eligible["install_dt_ts"]).dt.days` if `install_dt` is stored as Timestamp internally.

#### 1.5 `gen_ad_impressions(sessions, installs, rng)` → `alpha_ad_impression_events.parquet`

- Same structure as gameramp
- 4× scale
- AD_NETWORKS: `["admob_network", "ironsource", "applovin", "facebook_audience"]`
- REWARDED CPM: $8.50 average
- INTER CPM: $5.20 average
- Add three revenue columns (Scenario 2 — fraud/settlement story):
  - `reported_revenue`: raw MMP gross (what the network reports)
  - `settled_revenue`: `reported_revenue × (1 - fraud_rate)` — post-fraud-deduction
  - `net_revenue`: `settled_revenue × (1 - 0.30)` — post-platform-fee (ad mediation take-rate)
- Fraud rates by channel: `apple_search_ads` 0.5%, `google_uac` 4%, `facebook_ads` 10.5%, `organic` 1.5% (use `compute_fraud_rate()` from appendix)
- Domain story: "Finance books `net_revenue`. Marketing uses `settled_revenue`. `reported_revenue` is what the dashboard shows before reconciliation."

#### 1.6 `gen_revenue(installs, rng)` → `alpha_revenue.parquet`

- Same structure as gameramp
- 4× scale → ~4.3M rows
- MMP channels map: `organic` stays organic; `google_uac` → `"Google UAC"`, `facebook_ads` → `"Facebook Ads"`, `apple_search_ads` → `"Apple Search Ads"`
- `cohort_date` column: `datetime.date` object — never `pd.to_datetime()`
- `calendar_date` column: `datetime.date` object
- Higher ARPU_BASE for iOS organic (iOS organic = $0.38 ARPU at D7 vs gameramp $0.22)

#### Research Insights — Frozen Model Projected LTV Columns (Gap 3)

`ltv_by_cohort` (setup table 1) requires `d30_projected_ltv` and `d90_projected_ltv` columns. These must be **generated in `gen_revenue()` in Python** — not computed in SQL at setup time — because the frozen model depends on Python-level constants (`D30_RETENTION_BY_MONTH`) and needs to be baked into each revenue row.

**How the frozen model works:**

| Cohort install_month | Training window (3 months prior) | Frozen D30 | Note |
|---|---|---|---|
| `2026-01` | Oct–Dec 2025 (pre-dataset) | `0.130` | All 3 months pre-dataset → use baseline |
| `2026-02` | Nov–Dec 2025 + Jan 2026 | `0.137` | 2 pre-dataset + Jan (0.130+0.130+0.180)/3 |
| `2026-03` | Dec 2025 + Jan–Feb 2026 | `0.143` | 1 pre-dataset + Jan/Feb (0.130+0.180+0.165)/3 |
| `2026-04` | Jan–Mar 2026 | `0.166` | Fully in dataset: (0.180+0.165+0.152)/3 |
| `2026-05` | Feb–Apr 2026 | `0.152` | Rolling: (0.165+0.152+0.138)/3 |
| `2026-06` | Mar–May 2026 | `0.138` | Rolling: (0.152+0.138+0.125)/3 |

**Add to 1.1 constants:**
```python
# Pre-dataset D30 baseline (hypothetical Oct-Dec 2025 training window).
# Alpha launched Jan 2026; months before that use this as training data average.
PRE_DATASET_D30_BASELINE = 0.130

# "Frozen model" D30 retention used for LTV projection at install time.
# Formula: avg of the 3 months prior to install month. Pre-dataset months → PRE_DATASET_D30_BASELINE.
# Generates the "stale model" scenario: Jan/Feb cohorts are under-predicted (actuals beat model),
# while Jun cohorts are over-predicted (retention eroded but model still uses earlier window).
FROZEN_D30_BY_INSTALL_MONTH = {
    "2026-01": 0.130,   # all 3 prior months pre-dataset
    "2026-02": 0.137,   # avg(0.130, 0.130, 0.180) — 2 pre-dataset + Jan
    "2026-03": 0.143,   # avg(0.130, 0.180, 0.165) — 1 pre-dataset + Jan/Feb
    "2026-04": 0.166,   # avg(0.180, 0.165, 0.152) — all in dataset
    "2026-05": 0.152,   # avg(0.165, 0.152, 0.138) — rolling
    "2026-06": 0.138,   # avg(0.152, 0.138, 0.125) — rolling
}

# Power-law extension: D90 retention ≈ D30 × (30/90)^0.65 ≈ D30 × 0.524
D30_TO_D90_POWER_LAW_FACTOR = (30.0 / 90.0) ** 0.65  # ≈ 0.5244
```

**In `gen_revenue()`, add these columns to each cohort row:**
```python
install_month_key = cohort_date.strftime("%Y-%m")
frozen_d30 = FROZEN_D30_BY_INSTALL_MONTH.get(install_month_key, 0.130)
frozen_d90 = frozen_d30 * D30_TO_D90_POWER_LAW_FACTOR

# These are the PROJECTED LTV values (what the model predicted at install time)
# They will be AVG'd in ltv_by_cohort and compared to actuals in ltv_projection_vs_actuals
d30_projected_ltv = arpdau * cumulative_ltv_days(30, frozen_d30, is_emerging=False)
d90_projected_ltv = arpdau * cumulative_ltv_days(90, frozen_d30, is_emerging=False)
# Note: use is_emerging=False for projected values — model doesn't know about bi-phasic decay
# (this is intentional — the "stale model" failure is that it uses Western retention curves
# even for LatAm markets, which is how you get 55% overshoot for geo expansion scenario)

rows.append({
    # ... existing columns ...
    "d30_projected_ltv": round(d30_projected_ltv, 4),
    "d90_projected_ltv": round(d90_projected_ltv, 4),
})
```

**Expected signal in `ltv_projection_vs_actuals`:**
- Jan 2026 organic: model predicts D30 LTV using `frozen_d30 = 0.130`, but actual Jan D30 = `0.180` → model **under-predicts** by ~28% (Jan was unexpectedly good)
- Jan 2026 Facebook new_targeting: organic model used but actual D30 ≈ 0.20+ → model under-predicts by ~35%
- Jun 2026 organic: model uses `frozen_d30 = 0.138`, actual Jun D30 = `0.114` → model **over-predicts** by ~21%

> **Note on plan text vs formula:** The plan overview says "organic `d30_projection_error_pct` ≈ -0.25 to -0.35" (model over-predicted). This is calibrated from the stale-model scenario where the *earlier months* are the training window and *later months* decay. The June cohort with `frozen_d30=0.138` vs actual `0.114` = `+21%` over-prediction. This should be verified at generation time and the expected ranges in Phase 2.5 Scenario S7 may need adjustment after first run.

**`ltv_by_cohort` SQL addition (Phase 2.3, table 1):**
```sql
-- Add these two columns to the ltv_by_cohort CREATE TABLE AS SELECT:
AVG(r.d30_projected_ltv)  AS d30_projected_ltv,
AVG(r.d90_projected_ltv)  AS d90_projected_ltv,
```
Where `r` is the revenue table alias. These columns are already populated per-row in `gen_revenue()` and just need AVG'd into the summary table.

#### 1.7 `gen_campaign(installs, daily_cpi, rng)` → `alpha_campaign.parquet`

- Same structure as gameramp
- AR(1) CPI model re-anchored to alpha CPIs (see Section 1.1)
- `cohort_date` column: `datetime.date` — never `pd.to_datetime()`
- Apple Search Ads: iOS only, higher CPI, near-zero fraud

#### 1.8 Write Helpers

```python
def write_parquet(df: pd.DataFrame, path: Path, name: str) -> None:
    """Standard single-write helper for all tables except races."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Audit: no datetime64 columns (would become TIMESTAMP in parquet, breaking charts)
    # See: docs/solutions/database-issues/pyarrow-date-vs-timestamp-parquet-duckdb-charts.md
    _assert_date_columns(df)
    table = pa.Table.from_pandas(df)
    pq.write_table(table, path, compression="snappy")
    print(f"  ✓ {name}: {len(df):,} rows → {path}")


def _assert_date_columns(df: pd.DataFrame) -> None:
    """Guard: all date columns must be Python datetime.date objects (dtype=object),
    not pandas Timestamps (dtype=datetime64[ns]). PyArrow converts datetime.date → date32
    but converts Timestamps → timestamp[us], which DuckDB displays as '2026-01-01 00:00:00'.
    """
    DATE_COLS = {"install_dt", "cohort_date", "calendar_date", "dt"}
    for col in DATE_COLS:
        if col in df.columns:
            assert df[col].dtype == object, (
                f"Column '{col}' must contain Python datetime.date objects (dtype=object), "
                f"got {df[col].dtype}. Do NOT call pd.to_datetime() on date columns."
            )
            # Spot-check first non-null value is actually a date object
            first = df[col].dropna().iloc[0] if len(df[col].dropna()) > 0 else None
            if first is not None:
                assert isinstance(first, date), (
                    f"Column '{col}' values must be datetime.date, got {type(first)}"
                )
```

> **Research insight:** `pa.Table.from_pandas(df)` is correct for all tables except races (which is built directly from numpy arrays via `pa.table()`). The key invariant is that `datetime.date` objects in a pandas object-dtype column → `date32` in Arrow, while `pd.Timestamp` / `datetime64[ns]` → `timestamp[us]`. The assertion above catches this at write time before it becomes a DuckDB chart display problem.

#### 1.9 CLI Interface

```bash
python3 scripts/alpha_generate.py [--scale FLOAT] [--seed INT] [--output DIR]
# --scale: multiplier on top of base 4× installs, 2× sessions, 1× races (default 1.0)
# --seed:  random seed for reproducibility (default 42)
# --output: override output directory (default data/parquet/alpha)
```

#### 1.10 Post-Generation Python Scenario Checks (NEW)

**Add these checks to `main()` after all tables are written** (mirroring gameramp's `main()` pattern). Run at any scale — they verify signals exist, not exact values.

```python
print("\nScenario verification (at --scale {args.scale}):")

# S1: CPI↔LTV: Apple Search Ads should have highest CPI
cpi_check = campaign.groupby("channel")["cpi"].mean().sort_values(ascending=False)
print(f"  S1 CPI ranking: {list(cpi_check.index)}")
# PASS if: apple_search_ads first, then facebook_ads, then google_uac

# S2: Fraud/settlement gap
total_reported = impressions["reported_revenue"].sum()
total_settled  = impressions["settled_revenue"].sum()
ratio = total_settled / total_reported if total_reported > 0 else 0
print(f"  S2 Settlement ratio: {ratio:.4f} (expected ~0.90)")
# PASS if: 0.87–0.93

# S3: New targeting A/B retention
fb_jan = revenue[
    (revenue["channel"] == "facebook_ads") &
    (revenue["install_month"] >= "2026-01") &
    (revenue["days_from_cohort"] == 30)
].groupby("is_new_targeting")["retention_rate"].mean()
print(f"  S3 New targeting D30 retention: {fb_jan.to_dict()}")
# PASS if: True retention > False retention by ≥15%

# S4: Retention decay
ret_decay = (
    revenue[revenue["days_from_cohort"] == 30]
    .groupby("install_month")["retention_rate"]
    .mean()
    .sort_index()
)
print(f"  S4 Retention decay (Jan→Jun):")
for month, ret in ret_decay.items():
    print(f"     {month}: {ret:.4f}")
# PASS if: 2026-01 ≈ 0.18 and 2026-06 ≈ 0.11 (±20% at small scale)

# S5: iOS/Android ARPDAU ratio (from revenue table)
platform_arpdau = (
    revenue[revenue["days_from_cohort"] == 7]
    .groupby("os")["arpu"]
    .mean()
)
ratio_5 = platform_arpdau.get("IOS", 0) / max(platform_arpdau.get("ANDROID", 1), 1e-9)
print(f"  S5 iOS/Android ARPDAU ratio: {ratio_5:.2f} (expected 1.5–1.8)")
# PASS if: 1.4–2.0

# S6: Geo expansion risk (D14/D90 LTV ratio)
ltv_pivot = (
    revenue[revenue["days_from_cohort"].isin([14, 90])]
    .groupby(["country", "days_from_cohort"])["total_arpu"]
    .mean()
    .unstack("days_from_cohort")
    .rename(columns={14: "d14", 90: "d90"})
)
ltv_pivot["ratio"] = ltv_pivot["d14"] / ltv_pivot["d90"].replace(0, float("nan"))
print(f"  S6 D14/D90 LTV ratio by country:")
for country, row in ltv_pivot.iterrows():
    marker = "← LatAm (expect ~0.68)" if country in {"Brazil", "Mexico"} else ""
    print(f"     {country:15s}: {row.get('ratio', 0):.2f} {marker}")
# PASS if: Brazil/Mexico ratio ~0.62–0.74; US/UK/DE ratio ~0.40–0.48

print(f"\nAll files written to: {out_dir.resolve()}")
```

**`--scale 0.01` considerations:** At 1% scale, installs ≈ 103K total. Scenario checks still work because:
- S1 (CPI ranking): deterministic — channel CPI ordering is hardcoded
- S2 (fraud ratio): law of large numbers holds at 100K+ rows
- S3 (A/B targeting): only works if Facebook jan+ installs > ~200 rows; at 0.01× ≈ 500–1000 Facebook jan+ rows — sufficient
- S4 (retention decay): 6 data points — always works
- S5, S6: percentages stable at 1K+ rows per segment

**Performance target:** `--scale 0.01` must complete in <30 seconds. Bottleneck is `gen_races()` at 343K rows. With the vectorized approach (Section 1.4 Research Insights), each month generates ~57K races in ~0.1s → 6 months = <1s for races alone.

---

### Phase 2: DuckDB Setup Script (`scripts/alpha_setup.ts`)

> Template: `scripts/setup-gameramp.ts`. Identical structure — create views, build summary tables in order, CHECKPOINT.

#### Research Insights — DuckDB JOIN Ambiguity Prevention

From `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md`:

**Rule: In any summary table SQL that JOINs tables sharing column names, always qualify GROUP BY and ORDER BY with the table alias.**

Tables in alpha that share column names across JOINs:
- `installs` + `revenue`: both have `channel`, `country`, `platform` (and `os` maps to `platform`)
- `races` + `ltv_by_cohort`: both have `channel`, `country`, `platform` when joined via user_id subquery
- `campaign` + `ltv_by_cohort`: both have `channel`, `country`

**For every summary table SQL in `alpha_setup.ts`:**
- Alias every table: `installs i`, `revenue r`, `campaign c`
- Write `GROUP BY i.install_month, i.channel, i.country` — not `GROUP BY 1, 2, 3`
- Write `ORDER BY i.install_month, i.channel` — not `ORDER BY install_month`

**WAL safety checklist (from `docs/solutions/database-issues/duckdb-wal-replay-alter-table-default-crash.md`):**
- [ ] No `DEFAULT` keyword in any DDL statement
- [ ] `CHECKPOINT` is the final statement (line 2.6)
- [ ] Pin `@duckdb/node-api` to `"1.4.4-r.1"` (exact version, no `^` or `~`)
- [ ] `CREATE OR REPLACE TABLE` for all summary tables (idempotent re-runs)

#### 2.1 Configuration

```typescript
const DB_PATH     = path.join(process.cwd(), "data", "alpha.duckdb");
const PARQUET_DIR = path.join(process.cwd(), "data", "parquet", "alpha");
```

#### 2.2 View Creation (6 views)

```typescript
const views = [
  `CREATE OR REPLACE VIEW installs AS SELECT * FROM read_parquet('${PARQUET_DIR}/alpha_installs.parquet')`,
  `CREATE OR REPLACE VIEW sessions AS SELECT * FROM read_parquet('${PARQUET_DIR}/alpha_sessions.parquet')`,
  `CREATE OR REPLACE VIEW races AS SELECT * FROM read_parquet('${PARQUET_DIR}/alpha_races.parquet')`,
  `CREATE OR REPLACE VIEW ad_impression_events AS SELECT * FROM read_parquet('${PARQUET_DIR}/alpha_ad_impression_events.parquet')`,
  `CREATE OR REPLACE VIEW revenue AS SELECT * FROM read_parquet('${PARQUET_DIR}/alpha_revenue.parquet')`,
  `CREATE OR REPLACE VIEW campaign AS SELECT * FROM read_parquet('${PARQUET_DIR}/alpha_campaign.parquet')`,
];
```

> **Critical:** single-file path for races (not glob). Never use `DEFAULT` in any subsequent `ALTER TABLE`.

#### 2.3 Summary Tables (11 tables, in dependency order)

All tables use `CREATE OR REPLACE TABLE ... AS SELECT ...` pattern. Same SQL structure as gameramp with updated column names where needed. Build order:

1. **`ltv_by_cohort`** — from `installs LEFT JOIN revenue` (same as gameramp). The `d30_projected_ltv` and `d90_projected_ltv` columns are already present in the `revenue` parquet (generated in `gen_revenue()`) — just `AVG()` them in:
   ```sql
   -- These two columns come directly from the revenue parquet (baked in by gen_revenue):
   AVG(r.d30_projected_ltv)  AS d30_projected_ltv,
   AVG(r.d90_projected_ltv)  AS d90_projected_ltv,
   ```
   See Phase 1.6 Research Insights for the full specification of how these are generated.
2. **`monthly_revenue_summary`** — from `ad_impression_events GROUP BY month (DATE_TRUNC), channel, country, platform`. Must include `SUM(reported_revenue)`, `SUM(settled_revenue)`, `SUM(net_revenue)` — all three columns.
3. **`cac_by_channel`** — from `campaign LEFT JOIN ltv_by_cohort` (same as gameramp)
4. **`cac_by_month`** — from `cac_by_channel GROUP BY install_month (VARCHAR 'YYYY-MM')`
5. **`segment_trends`** — from `ltv_by_cohort GROUP BY install_month, channel, country, platform`
6. **`roas_by_cohort`** — from `ltv_by_cohort LEFT JOIN cac_by_channel`
7. **`payback_analysis`** — from `cac_by_channel GROUP BY install_month, channel, country`
8. **`arpdau_trend`** — from `revenue GROUP BY month (DATE_TRUNC), platform, country`
9. **`cohort_retention_actuals`** — from `installs LEFT JOIN sessions ON user_id, days_from_install 0/7/14/30`
10. **`engagement_analysis`** — from `installs LEFT JOIN ltv_by_cohort GROUP BY install_month, channel, engagement_tier, is_new_targeting` ← `is_new_targeting` must be a dimension here to enable old vs new Facebook targeting comparison
11. **`race_performance_by_level_type`** ← NEW
12. **`ltv_projection_vs_actuals`** ← NEW (depends on `ltv_by_cohort`; January cohorts only)

```sql
-- Table 11: race_performance_by_level_type
CREATE OR REPLACE TABLE race_performance_by_level_type AS
SELECT
  DATE_TRUNC('month', r.dt)::DATE                     AS month,
  r.level_type,
  r.platform,
  r.country,
  COUNT(*)                                             AS total_races,
  COUNT(DISTINCT r.user_id)                           AS unique_players,
  ROUND(
    AVG(CASE WHEN r.result = 'Win' THEN 1.0 ELSE 0.0 END)
      FILTER (WHERE r.result IS NOT NULL), 4
  )                                                    AS win_rate,
  ROUND(AVG(r.level_duration), 2)                     AS avg_duration_secs,
  ROUND(AVG(r.score) FILTER (WHERE r.score IS NOT NULL), 2) AS avg_score,
  ROUND(AVG(r.overtakes) FILTER (WHERE r.overtakes IS NOT NULL), 2) AS avg_overtakes,
  ROUND(AVG(r.crash_number) FILTER (WHERE r.crash_number IS NOT NULL), 2) AS avg_crashes,
  ROUND(AVG(r.is_level_completed::FLOAT), 4)         AS completion_rate,
  -- Join to installs for channel context
  i.channel,
  ROUND(AVG(i.d30_ltv), 4)                           AS avg_player_d30_ltv
FROM races r
LEFT JOIN (
  -- Gap 4 fix: ltv_by_cohort has no user_id column (it's a cohort-level aggregate).
  -- Must route through installs to get per-user d30_ltv.
  SELECT
    inst.user_id,
    inst.channel,
    MAX(CASE WHEN ltv.days_from_cohort = 30 THEN ltv.avg_projected_ltv END) AS d30_ltv
  FROM installs inst
  LEFT JOIN ltv_by_cohort ltv
    ON  ltv.cohort_date = inst.install_dt
    AND ltv.channel     = inst.channel
    AND ltv.country     = inst.country
    AND ltv.platform    = inst.platform
  GROUP BY inst.user_id, inst.channel
) i ON r.user_id = i.user_id
GROUP BY
  DATE_TRUNC('month', r.dt)::DATE,
  r.level_type,
  r.platform,
  r.country,
  i.channel
```

> **Bug fix (Gap 2):** The original SQL had `GROUP BY 1, 2, 3, 4, 12`. Position 12 = `completion_rate` (an aggregate) — grouping by an aggregate is a SQL error. `i.channel` is at position 13. Fixed to named GROUP BY with table aliases. See `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md`.
>
> **Bug fix (Gap 4):** The original subquery `SELECT user_id FROM ltv_by_cohort GROUP BY user_id` would fail at runtime — `ltv_by_cohort` is a cohort-level aggregate and has no `user_id` column. Fixed to join through `installs LEFT JOIN ltv_by_cohort` on cohort key dimensions (`cohort_date, channel, country, platform`). This is the only correct path to derive per-user d30_ltv from a cohort-grain table.
>
> `race_performance_by_level_type` depends on `ltv_by_cohort` (table 1) AND the `installs` view — must come after table 1.

```sql
-- Table 12: ltv_projection_vs_actuals (January 2026 cohorts only)
-- Compares D30/D90 LTV projected at install time vs actuals from MMP revenue table.
-- "Frozen model": projection uses D30_RETENTION from 3 months prior to cohort's install month.
-- For Jan 2026 cohorts, training window = Oct–Dec 2025 (D30 avg ~12–15%).
-- Actual Jan 2026 D30 = ~18% (new-targeting mix skews it up for Facebook).
CREATE OR REPLACE TABLE ltv_projection_vs_actuals AS
SELECT
  DATE_TRUNC('week', l.cohort_date)::DATE          AS install_week,
  l.channel,
  l.country,
  l.platform,
  COUNT(DISTINCT l.cohort_date)                    AS cohort_days,
  SUM(l.cohort_installs)                           AS cohort_size,
  -- Projected LTV baked into revenue rows at generation time
  AVG(l.d30_projected_ltv)                         AS d30_projected_ltv,
  AVG(l.d90_projected_ltv)                         AS d90_projected_ltv,
  -- Actual LTV from MMP
  AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END) AS d30_actual_ltv,
  AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END) AS d90_actual_ltv,
  -- Projection error: positive = over-predicted, negative = under-predicted
  ROUND(
    AVG(l.d30_projected_ltv) /
    NULLIF(AVG(CASE WHEN l.days_from_cohort = 30 THEN l.avg_projected_ltv END), 0) - 1.0, 3
  )                                                 AS d30_projection_error_pct,
  ROUND(
    AVG(l.d90_projected_ltv) /
    NULLIF(AVG(CASE WHEN l.days_from_cohort = 90 THEN l.avg_projected_ltv END), 0) - 1.0, 3
  )                                                 AS d90_projection_error_pct
FROM ltv_by_cohort l
WHERE l.cohort_date BETWEEN '2026-01-01'::DATE AND '2026-01-31'::DATE
  AND l.days_from_cohort IN (30, 90)
GROUP BY 1, 2, 3, 4
ORDER BY install_week, channel, country, platform;
```

> `ltv_projection_vs_actuals` requires `d30_projected_ltv` and `d90_projected_ltv` columns on `ltv_by_cohort`. These must be generated in `gen_revenue()` using a "frozen model" — the D30_RETENTION value from 3 months prior to each cohort's install month, extended to D90 via the power-law curve.
>
> **Expected signals in January cohorts:**
> - Organic: `d30_projection_error_pct` ≈ -0.25 to -0.35 (model over-predicted — trained on lower-retention Oct–Dec window)
> - Facebook `is_new_targeting=True`: `d30_projection_error_pct` ≈ +0.10 to +0.20 (model under-predicted — new-targeting cohorts outperform training window)
> - Week 1 Jan: only projection available (actuals = NULL at D30, cohort too recent)
> - Week 4 Jan: actuals starting to fill in as D30 arrives for week-1 cohorts

#### 2.4 Row Count Verification

After each summary table, log row count:
```typescript
const result = await conn.run(`SELECT COUNT(*) FROM ${tableName}`);
console.log(`  ✓ ${tableName}: ${result.getRows()[0][0]} rows`);
```

#### 2.5 Scenario Verification (6 checks)

```sql
-- S1. CPI↔LTV correlation: higher CPI channel should have higher D90 LTV
-- PASS if apple_search_ads D90 LTV > facebook_ads > google_uac, positive correlation
SELECT channel, ROUND(AVG(avg_cpi), 2) AS cpi, ROUND(AVG(d90_ltv), 4) AS d90_ltv
FROM roas_by_cohort GROUP BY channel ORDER BY cpi ASC;
-- Expected: google_uac ~$4.50/~$3.80, facebook_ads ~$5.20/~$4.20, apple_search_ads ~$6.80/~$5.60

-- S2. Fraud/settlement gap: settled_revenue should be < reported_revenue by channel-specific rate
SELECT
  SUM(reported_revenue)                                        AS total_reported,
  SUM(settled_revenue)                                        AS total_settled,
  ROUND(SUM(settled_revenue)/SUM(reported_revenue), 4)        AS settlement_ratio
FROM monthly_revenue_summary;
-- Expected: overall ratio ~0.90 (mix of channels). Per-channel in separate query:
-- apple_search_ads ~0.995, google_uac ~0.960, facebook_ads ~0.895, organic ~0.985

-- S3. New targeting A/B: Facebook Jan+ is_new_targeting=True should have higher D30 retention
SELECT is_new_targeting, ROUND(AVG(d30_retention), 4) AS d30_ret
FROM engagement_analysis WHERE channel = 'facebook_ads'
GROUP BY is_new_targeting;
-- Expected: is_new_targeting=True ~18-20% D30, False ~13-15% D30 (~30% lift)

-- S4. Retention decay: Jan organic D30 should be ~18%, Jun should be ~11%
SELECT install_month, ROUND(AVG(d30_retention), 4) FROM segment_trends
WHERE channel = 'organic' GROUP BY install_month ORDER BY install_month;
-- Expected: 2026-01 ~0.180, 2026-06 ~0.114 (37% decline)

-- S5. iOS/Android monetization split: iOS ARPDAU should be 1.5-1.8× Android
SELECT platform, ROUND(AVG(arpdau), 4) FROM arpdau_trend GROUP BY platform;
-- Expected: IOS ~0.48, ANDROID ~0.28 (ratio ~1.7×)

-- S6. Geo expansion risk: LatAm D14/D90 LTV ratio should be ~0.68 vs US/UK ~0.44
SELECT country,
  AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END) AS d14_ltv,
  AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END) AS d90_ltv,
  ROUND(AVG(CASE WHEN days_from_cohort = 14 THEN avg_projected_ltv END) /
    NULLIF(AVG(CASE WHEN days_from_cohort = 90 THEN avg_projected_ltv END), 0), 3) AS ratio
FROM ltv_by_cohort WHERE cohort_date <= '2026-03-31'::DATE
GROUP BY country ORDER BY ratio DESC;
-- Expected: Brazil/Mexico ratio ~0.66-0.70; United States/United Kingdom ~0.42-0.46

-- S7. LTV projection accuracy: Jan cohorts should show model over-prediction for organic
SELECT channel, install_week,
  ROUND(AVG(d30_projected_ltv), 4)  AS projected,
  ROUND(AVG(d30_actual_ltv), 4)     AS actual,
  ROUND(AVG(d30_projection_error_pct), 3) AS error_pct
FROM ltv_projection_vs_actuals GROUP BY channel, install_week ORDER BY install_week, channel;
-- Expected: organic error_pct ~ -0.25 to -0.35 (over-predicted)
-- Expected: facebook_ads is_new_targeting cohorts error_pct ~ +0.10 to +0.20 (under-predicted)

-- S8. Race win rates: ClassicRace > 45% win rate
SELECT level_type, ROUND(AVG(win_rate), 4) FROM race_performance_by_level_type
GROUP BY level_type ORDER BY 2 DESC;
-- Expected: Survival ~0.55, TimeScore ~0.54, ClassicRace ~0.47, Elimination ~0.49
```

#### 2.6 CHECKPOINT

```typescript
await conn.run("CHECKPOINT");
console.log("✓ CHECKPOINT complete");
```

---

### Phase 3: DatasetConfig (`src/lib/datasets/alpha.ts`)

> Template: `src/lib/datasets/gameramp.ts`. Copy structure exactly, update all values.

#### 3.1 Identity Fields

```typescript
export const alphaDataset: DatasetConfig = {
  id:          "alpha",
  label:       "Alpha",
  description: "6-month UA analytics dataset for a Western-market racing game (Jan–Jun 2026)",
  dbFile:      "data/alpha.duckdb",
  sourceType:  "duckdb",
  primaryTable: "installs",
  userIdField:  "user_id",
  dateField:    "install_dt",
  dateRange:    { start: "2026-01-01", end: "2026-06-30" },
  currency:     "$",
  entityName:   "players",
  reportMeta: {
    totalEvents:    "~19.6M ad impressions",
    totalUsers:     "~10.3M installs",
    dateRangeLabel: "Jan – Jun 2026",
    dbName:         "alpha",
  },
```

#### 3.2 `schemaContext` (full DDL documentation)

Document all 6 raw views + 11 summary tables:

```typescript
  schemaContext: `
-- RAW TABLES (views over parquet)
installs (
  user_id VARCHAR, install_dt DATE, platform VARCHAR,   -- "IOS" | "ANDROID"
  country VARCHAR, app_version VARCHAR, channel VARCHAR, -- acquisition channel
  engagement_tier VARCHAR,                               -- "casual"|"competitive"|"hardcore"
  is_new_targeting INTEGER,                              -- 0|1 A/B flag
  is_fraud INTEGER                                       -- 0|1
)

sessions (
  session_id VARCHAR, user_id VARCHAR, dt DATE,
  platform VARCHAR, country VARCHAR, app_version VARCHAR,
  session_duration_secs DOUBLE, event_count INTEGER,
  session_number INTEGER,   -- cumulative session count per user
  ad_revenue DOUBLE, iap_transaction INTEGER, iap_revenue_usd DOUBLE,
  install_month VARCHAR     -- 'YYYY-MM'
)

races (
  race_id VARCHAR, user_id VARCHAR, dt DATE,
  platform VARCHAR, country VARCHAR, app_version VARCHAR,
  level_type VARCHAR,     -- "ClassicRace"|"TimeScore"|"BeatTheTime"|
                          --  "Survival"|"Elimination"|"Multiplayer"|"FreeDrive"
  result VARCHAR,         -- "Win"|"Lose"|NULL (in-progress or non-competitive)
  level_duration DOUBLE,  -- seconds
  score DOUBLE,           -- NULL for Multiplayer / FreeDrive
  overtakes INTEGER,      -- NULL for non-competitive
  crash_number INTEGER,
  is_level_completed INTEGER,
  car VARCHAR,            -- "SportsCar"|"Muscle"|"Exotic"|"Truck"
  level_name VARCHAR
)

ad_impression_events (
  record_id VARCHAR, dt DATE, user_id VARCHAR,
  platform VARCHAR, country VARCHAR, app_version VARCHAR,
  ad_format VARCHAR,      -- "REWARDED" | "INTER"
  ad_network VARCHAR,     -- "admob_network"|"ironsource"|"applovin"|"facebook_audience"
  revenue DOUBLE
)

revenue (
  cohort_date DATE, calendar_date DATE,
  channel VARCHAR, country VARCHAR, os VARCHAR,
  days_from_cohort INTEGER,
  revenue DOUBLE, ad_revenue DOUBLE, total_revenue DOUBLE,
  arpu DOUBLE, ad_arpu DOUBLE, total_arpu DOUBLE,
  retained_users INTEGER, retention_rate DOUBLE,
  roi DOUBLE
)

campaign (
  cohort_date DATE, channel VARCHAR, country VARCHAR, os VARCHAR,
  cost DOUBLE, installs INTEGER,
  cpi DOUBLE, dau INTEGER, impressions INTEGER, clicks INTEGER,
  ecpm DOUBLE, arpdau DOUBLE, ad_arpdau DOUBLE
)

-- SUMMARY TABLES (pre-aggregated — prefer these for all LTV/retention/ROAS queries)
ltv_by_cohort           -- grain: install_month × channel × country × platform × days_from_cohort
monthly_revenue_summary -- grain: month (DATE) × channel × country × platform × ad_format
cac_by_channel          -- grain: month (DATE) × cohort_date × channel × country × os
cac_by_month            -- grain: install_month (VARCHAR 'YYYY-MM') × channel × country × os
segment_trends          -- grain: install_month × channel × country × platform
roas_by_cohort          -- grain: install_month × channel × country × platform
payback_analysis        -- grain: install_month × channel × country
arpdau_trend            -- grain: month (DATE) × platform × country
cohort_retention_actuals -- grain: install_month × channel × country × platform
engagement_analysis     -- grain: install_month × channel × engagement_tier × is_new_targeting
race_performance_by_level_type -- grain: month (DATE) × level_type × platform × country × channel
`,
```

#### 3.3 `summaryTableHint`

```typescript
  summaryTableHint: `For LTV/retention/ROAS questions use ltv_by_cohort, segment_trends, or roas_by_cohort.
For UA spend/CPI/payback use cac_by_channel or payback_analysis.
For race engagement use race_performance_by_level_type.
For ad revenue trends use monthly_revenue_summary or arpdau_trend.
AVOID querying races, sessions, or ad_impression_events directly — they contain 10M–34M rows.`,
```

#### 3.4 `domainHints`

```typescript
  domainHints: `
1. installs.channel values: "google_uac", "facebook_ads", "apple_search_ads", "organic"
2. installs.platform values: "IOS", "ANDROID" (uppercase)
3. revenue.channel values: "google_uac", "facebook_ads", "apple_search_ads", "organic"
   campaign.channel uses the same set
4. races.level_type values: "ClassicRace", "TimeScore", "BeatTheTime", "Survival", "Elimination", "Multiplayer", "FreeDrive"
5. races.result is NULL for in-progress races, FreeDrive, and Multiplayer — use IS NOT NULL when computing win_rate
6. installs.engagement_tier: "casual" (1-2 races/session), "competitive" (3-4), "hardcore" (5+)
7. Apple Search Ads is iOS-only — never filter campaign WHERE os = 'android' AND channel = 'apple_search_ads', result will be empty
8. For cohort retention: ltv_by_cohort.days_from_cohort enumerates [0, 1, 3, 7, 14, 30, 60, 90] — do NOT expect every integer
9. DATE FORMAT CRITICAL — filter with correct types or you will get zero rows:
   monthly_revenue_summary.month, cac_by_channel.month, arpdau_trend.month, race_performance_by_level_type.month are DATE columns → filter with = '2026-01-01'::DATE or BETWEEN '2026-01-01'::DATE AND '2026-01-31'::DATE
   install_month in cac_by_month, roas_by_cohort, segment_trends, cohort_retention_actuals are VARCHAR 'YYYY-MM' → filter with = '2026-01'
10. cohort_retention_actuals.d7_retention, d14_retention, d30_retention are FLOAT (0.0–1.0), not percentages
11. To compute ROAS: roas_by_cohort.roas_d30 = total_ltv_d30 / cpi. Values > 1.0 mean positive ROAS.
12. Races table has 34M rows — NEVER query it directly for aggregations. Use race_performance_by_level_type.
13. campaign.cost is total UA spend in USD for that cohort_date × channel × country × os combination
14. installs.is_fraud = 1 marks fraudulent installs — always filter WHERE is_fraud = 0 for clean cohort analysis unless specifically analyzing fraud patterns
`,
```

#### 3.5 `systemContext`

```typescript
  systemContext: `You are Sentinel, a growth analytics AI for Alpha — a Western-market racing game that launched in January 2026. Alpha has strong iOS retention in the US, UK, and Germany, but is evaluating whether to expand to LatAm and APAC where CPIs are 60–70% lower.

The core business question: should Alpha double down on high-CPI Western markets where LTV is proven, or expand to lower-CPI LatAm/APAC markets where payback period is uncertain?

Key facts:
- Alpha has 4 paid UA channels: Google UAC (best ROAS at scale), Facebook Ads, Apple Search Ads (iOS only, highest CPI but also highest D30 LTV), and Organic
- iOS players have 40–60% higher ARPDAU than Android
- Jan–Feb cohorts show 17–18% D30 retention; May–Jun cohorts show 11–12% (retention erosion signal)
- Race completion rate and engagement tier are strong predictors of 90-day LTV

When answering questions: be precise about which table and filter you're using, cite specific numbers, and flag the retention decay trend when relevant.`,
```

#### 3.6 `agents` (Deep Research subagents)

```typescript
  agents: [
    {
      id: "acquisition-analysis",
      queries: [
        { description: "CPI by channel and OS",         hint: "Use cac_by_channel, compare google_uac vs facebook_ads vs apple_search_ads CPI by os" },
        { description: "Install volume trend by channel", hint: "Use cac_by_month, show monthly install growth by channel" },
        { description: "Fraud rate by channel",          hint: "Query installs WHERE is_fraud=1, group by channel" },
      ],
    },
    {
      id: "retention-ltv",
      queries: [
        { description: "D7/D30/D60 retention by channel", hint: "Use segment_trends, compare retention by channel across install months" },
        { description: "D30 retention decay over months",  hint: "Use segment_trends, show d30_retention by install_month for organic channel" },
        { description: "LTV by geo and platform",          hint: "Use ltv_by_cohort, group by country and platform at days_from_cohort=30" },
      ],
    },
    {
      id: "roas-payback",
      queries: [
        { description: "ROAS by channel at D30/D60/D90",  hint: "Use roas_by_cohort, show roas_d30/d60/d90 by channel" },
        { description: "Payback period by channel",        hint: "Use payback_analysis, find month where payback_ratio > 1.0" },
        { description: "CPI vs LTV scatter by country",   hint: "Join cac_by_channel with segment_trends on install_month, channel, country" },
      ],
    },
    {
      id: "engagement-racing",
      queries: [
        { description: "Win rate by level type",           hint: "Use race_performance_by_level_type, show win_rate by level_type" },
        { description: "Race engagement by tier",          hint: "Use engagement_analysis, compare d30_retention and roas by engagement_tier" },
        { description: "Race completion vs LTV correlation", hint: "Join race_performance_by_level_type with ltv_by_cohort on month, country, platform" },
      ],
    },
    {
      id: "revenue-monetization",
      queries: [
        { description: "ARPDAU trend by platform",        hint: "Use arpdau_trend, show monthly arpdau by platform" },
        { description: "Ad revenue vs IAP breakdown",     hint: "Use monthly_revenue_summary, show ad_revenue vs iap revenue by channel" },
        { description: "Revenue concentration by market", hint: "Use monthly_revenue_summary, show top 10 countries by total_revenue" },
      ],
    },
    {
      id: "geographic-expansion",
      queries: [
        { description: "CPI opportunity: LatAm vs Western", hint: "Use cac_by_channel, compare avg_cpi for BR/MX vs US/UK/DE" },
        { description: "Retention risk by geo tier",       hint: "Use segment_trends, compare d30_retention for tier-1 vs tier-2 countries" },
        { description: "Market-level ROAS ranking",        hint: "Use roas_by_cohort, rank countries by roas_d60" },
      ],
    },
  ],
```

#### 3.7 `suggestedPrompts`

```typescript
  suggestedPrompts: [
    "Which UA channel has the best D90 ROAS — and is it the same for iOS vs Android?",
    "Show me the retention decay trend from January to June cohorts. How bad is the signal?",
    "Which level type in races has the highest win rate, and does it correlate with D30 LTV?",
    "Compare CPI and LTV for US vs Brazil. Is the LatAm expansion worth it at current retention rates?",
    "What's our payback period for Google UAC campaigns in the UK?",
    "Which countries have the highest ad ARPDAU, and should we invest more in rewarded ads there?",
    "Show monthly ARPDAU trend for iOS vs Android across all 6 months",
    "Break down the fraud rate by acquisition channel and estimate its revenue impact",
    "Which engagement tier of racers has the best D30 LTV, and how do we acquire more of them?",
    "Model the revenue impact if we cut Facebook Ads spend by 50% and reallocate to Google UAC",
  ],
```

#### 3.8 `viewSQL` and `summaryTableSQL`

```typescript
  viewSQL: (dataDir: string) => [
    `CREATE OR REPLACE VIEW installs AS SELECT * FROM read_parquet('${dataDir}/alpha/alpha_installs.parquet')`,
    `CREATE OR REPLACE VIEW sessions AS SELECT * FROM read_parquet('${dataDir}/alpha/alpha_sessions.parquet')`,
    `CREATE OR REPLACE VIEW races AS SELECT * FROM read_parquet('${dataDir}/alpha/alpha_races.parquet')`,
    `CREATE OR REPLACE VIEW ad_impression_events AS SELECT * FROM read_parquet('${dataDir}/alpha/alpha_ad_impression_events.parquet')`,
    `CREATE OR REPLACE VIEW revenue AS SELECT * FROM read_parquet('${dataDir}/alpha/alpha_revenue.parquet')`,
    `CREATE OR REPLACE VIEW campaign AS SELECT * FROM read_parquet('${dataDir}/alpha/alpha_campaign.parquet')`,
  ],

  summaryTableSQL: [
    // 1. ltv_by_cohort
    `CREATE OR REPLACE TABLE ltv_by_cohort AS SELECT ... FROM installs LEFT JOIN revenue ...`,
    // 2-11: same pattern as gameramp.ts, updated for alpha channel names
    // 11. race_performance_by_level_type (see Phase 2.3 SQL above)
  ],
```

> **Implementation note:** Copy the exact SQL from `setup-gameramp.ts` for tables 1–10 and update channel/column names. Table 11 is new (see Phase 2.3 SQL).

> **WAL safety rules (from docs/solutions):**
> - NEVER use `DEFAULT` in `ALTER TABLE ... ADD COLUMN`
> - Always end with `CHECKPOINT`
> - Pin `@duckdb/node-api` to exact version `"1.4.4-r.1"` (no `^` or `~`)

---

### Phase 4: Registration (`src/lib/datasets/index.ts`)

```typescript
// Add import at top
import { alphaDataset } from "./alpha";

// Add to STATIC_DATASETS
const STATIC_DATASETS: Record<string, DatasetConfig> = {
  ecommerce: ecommerceDataset,
  quickhelp:  quickhelpDataset,
  gameramp:   gamerampDataset,
  alpha:      alphaDataset,   // ← add this
};
```

`DEFAULT_DATASET` in `constants.ts` **stays as `"gameramp"`**.

---

## Acceptance Criteria

> **Important:** Criteria marked ⚡ are new additions from the deepening. Criteria marked 🐛 are bug-fix clarifications.

### Generator (`alpha_generate.py`)

- [ ] Running `python3 scripts/alpha_generate.py` produces 6 parquet files in `data/parquet/alpha/`
- [ ] All 6 files are present: `alpha_installs.parquet`, `alpha_sessions.parquet`, `alpha_races.parquet`, `alpha_ad_impression_events.parquet`, `alpha_revenue.parquet`, `alpha_campaign.parquet`
- [ ] Row counts match targets: installs ~10.3M, sessions ~16M, races ~34.3M, impressions ~19.6M, revenue ~4.3M, campaign ~137K (±5% at --scale 1.0)
- [ ] PyArrow schema verification: `pq.read_table('alpha_installs.parquet').schema` shows `install_dt: date32`, not `timestamp`
- [ ] PyArrow schema verification: races `dt` column is `date32`, not `timestamp`
- [ ] `alpha_races.parquet` is generated without OOM crash (monthly chunked write confirmed in logs)
- [ ] Top 3 install countries are US, UK, Germany (Western-heavy distribution)
- [ ] iOS/Android split in installs: 50–60% iOS
- [ ] channel distribution: >50% organic, >15% google_uac, apple_search_ads iOS-only
- [ ] Retention decay present: Jan cohort D30 > Jun cohort D30 by ≥30%
- [ ] `--scale 0.01` completes in <30 seconds for fast dev iteration
- [ ] ⚡ `alpha_revenue.parquet` schema contains `d30_projected_ltv: double` and `d90_projected_ltv: double` columns
- [ ] ⚡ Post-generation scenario checks in `main()` print S1–S6 results — all PASS at `--scale 0.01`
- [ ] ⚡ `get_active_users_for_month()` is vectorized (no Python for-loop over installs rows) — confirmed by total generation time <20 min at `--scale 1.0`

### Setup Script (`alpha_setup.ts`)

- [ ] `npx tsx scripts/alpha_setup.ts` completes without error
- [ ] `data/alpha.duckdb` file created
- [ ] All 12 summary tables present (11 original + `ltv_projection_vs_actuals`): `SHOW TABLES` returns all expected names
- [ ] Row count verification logged for each table (non-zero)
- [ ] 8 scenario verification checks produce plausible results (not all NULLs) — S1–S8 from Phase 2.5
- [ ] CHECKPOINT completed (logged)
- [ ] `race_performance_by_level_type` has non-null `win_rate` values for ClassicRace, TimeScore, Survival
- [ ] No `DEFAULT` keyword in any DDL (WAL safety)
- [ ] 🐛 `race_performance_by_level_type` GROUP BY uses named columns, not `GROUP BY 1,2,3,4,12` — verified by `DESCRIBE race_performance_by_level_type` returning a `channel` column
- [ ] 🐛 `race_performance_by_level_type` LEFT JOIN subquery routes through `installs LEFT JOIN ltv_by_cohort` (not `SELECT user_id FROM ltv_by_cohort` directly) — verified by setup completing without "column not found: user_id" error
- [ ] ⚡ `ltv_by_cohort` schema contains `d30_projected_ltv` and `d90_projected_ltv` columns (from `AVG(r.d30_projected_ltv)`)
- [ ] ⚡ `ltv_projection_vs_actuals` has non-null `d30_projected_ltv` values for January 2026 cohorts
- [ ] ⚡ No DuckDB ambiguous column error during setup — all JOINed tables use qualified `alias.column` in GROUP BY and ORDER BY

### DatasetConfig (`alpha.ts`)

- [ ] `getDataset("alpha")` returns the config without error
- [ ] `schemaContext` documents all 6 raw tables and all 11 summary tables
- [ ] `summaryTableHint` warns against querying races directly
- [ ] `domainHints` item #9 (DATE FORMAT CRITICAL) present
- [ ] `agents` has 6 entries with 3 queries each
- [ ] `suggestedPrompts` has 10 entries
- [ ] `viewSQL("data/parquet")` returns 6 CREATE VIEW statements

### Registration

- [ ] `getAllDatasets()` returns an array containing a config with `id === "alpha"`
- [ ] Alpha appears in the dataset switcher in the running app
- [ ] Selecting alpha in the UI sends `x-dataset-id: alpha` headers (confirm in network tab)
- [ ] `getSystemContext("alpha")` returns the alpha systemContext (not gameramp's)
- [ ] Default dataset on app load is still gameramp (not alpha)

### End-to-End Demo

- [ ] Asking "Which UA channel has the best ROAS?" in Alpha mode returns a non-empty answer using `roas_by_cohort`
- [ ] Asking "Show me race win rates by level type" returns data from `race_performance_by_level_type`
- [ ] No OOM errors on DuckDB when running any suggested prompt
- [ ] Deep research mode completes all 6 subagents without error

---

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Generator runtime at `--scale 1.0` | < 20 minutes on 32GB RAM machine |
| Peak RAM during generation | < 16GB (half of available) |
| `alpha_races.parquet` size on disk | < 500MB (Snappy compressed) |
| Total parquet disk footprint | < 1GB |
| DuckDB query memory for any summary table | < 2GB (leaves headroom in 4GB budget) |
| `alpha_setup.ts` runtime | < 10 minutes |

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Races monthly chunk OOM | **Updated:** With vectorized columnar construction (see Phase 1.4 Research Insights), each month materializes ~5.7M rows as numpy arrays before writing to Arrow. Peak: ~326K users × 17.5 avg races × ~50 bytes/row (numpy) ≈ 285MB per month. Well within 32GB. Original list-of-dicts approach would use ~1.5GB due to Python object overhead. |
| `gen_races()` slowness (non-OOM) | **New risk:** Python for-loop over 326K users × 17.5 races = 5.7M iterations/month × 6 = 34M total iterations. At ~0.5μs/iteration = ~17 seconds just for loop overhead. With UUID generation (`str(uuid4())` × 34M = ~90s). **Mitigation:** vectorized `np.repeat()` + bulk UUID byte generation (see Phase 1.4 Research Insights). |
| `get_active_users_for_month()` slowness | **New risk:** If implemented as a Python for-loop over 10M installs in month 6, runtime = ~10+ minutes just for this function. **Mitigation:** vectorized numpy Bernoulli sampling (see Phase 1.4 helper spec). The `.apply(lambda d: d.days)` for `days_since_install` is acceptable (runs once per month on filtered subset). |
| PyArrow date32 regression | Enforce explicit `pa.schema([..., ("dt", pa.date32()), ...])` for races writer. Assert `dtype == object` before `write_parquet()` for all other tables. Also: **never call `pd.to_datetime()` on any date column** — see `docs/solutions/database-issues/pyarrow-date-vs-timestamp-parquet-duckdb-charts.md`. |
| DuckDB WAL crash on Railway | No `DEFAULT` in DDL. CHECKPOINT at end. Documented in `docs/solutions/database-issues/duckdb-wal-replay-alter-table-default-crash.md`. |
| DuckDB ambiguous column in GROUP BY | **New risk:** All summary tables join tables that share column names (channel, country, platform, install_month). Use qualified `alias.column` in GROUP BY / ORDER BY — see `docs/solutions/database-issues/duckdb-ambiguous-column-join-group-by.md`. |
| `race_performance_by_level_type` GROUP BY bug | **Fixed (Gap 2):** Original `GROUP BY 1, 2, 3, 4, 12` grouped by an aggregate column (position 12 = `completion_rate`). Fixed to named GROUP BY with table aliases. |
| `race_performance_by_level_type` subquery bug | **Fixed (Gap 4):** Original `SELECT user_id FROM ltv_by_cohort` would fail — `ltv_by_cohort` is a cohort-level aggregate with no `user_id` column. Fixed to `installs LEFT JOIN ltv_by_cohort` on `(cohort_date, channel, country, platform)`. This join is expensive (10M installs × ltv_by_cohort rows) but runs only once at setup time. Expected < 2GB RAM in DuckDB via hash join. |
| `ltv_by_cohort` missing projected LTV columns | **Fixed (Gap 3):** `d30_projected_ltv` and `d90_projected_ltv` must be generated in `gen_revenue()` Python code (frozen model) and AVG'd into `ltv_by_cohort` SQL. Cannot be computed in SQL alone. Precise per-month frozen D30 values: Jan=0.130, Feb=0.137, Mar=0.143, Apr=0.166, May=0.152, Jun=0.138. |
| Summary table dependency order | Tables 5–12 depend on tables 1–4. Setup script executes in order — do not reorder. `race_performance_by_level_type` (table 11) depends on `ltv_by_cohort` (table 1). `ltv_projection_vs_actuals` (table 12) depends on `ltv_by_cohort`. |
| `race_performance_by_level_type` LEFT JOIN on 34M rows races | DuckDB handles this via lazy scan + aggregation. The summary table build runs at setup time, not at query time. Expected to use < 3GB memory during build. The JOIN subquery on `ltv_by_cohort` is a hash join — `ltv_by_cohort` must be fully materialized first (it is, as table 1). |
| apple_search_ads iOS-only constraint | `gen_campaign` must filter: `if channel == "apple_search_ads" and os == "android": skip`. Add domainHint #7. |
| Frozen model projected LTV direction | **Watch:** Plan overview says Jan organic should show model *over-prediction*. But frozen D30 = 0.130 and actual Jan D30 = 0.180 means model *under-predicts* (model said users are less sticky than they are). This is a calibration subtlety — the error direction in `ltv_projection_vs_actuals` for Jan will be **negative** (model under-predicted). For Jun cohorts, frozen D30 = 0.138 vs actual = 0.114 — model **over-predicts**. Verify at first run and update Scenario S7 expected values in Phase 2.5 accordingly. |

---

## References

### Internal
- `scripts/generate-gameramp.py` — generator template
- `scripts/setup-gameramp.ts` — setup script template
- `src/lib/datasets/gameramp.ts` — DatasetConfig template
- `src/lib/datasets/types.ts` — `DatasetConfig` interface
- `src/lib/datasets/index.ts` — registration pattern
- `docs/solutions/database-issues/pyarrow-date-vs-timestamp-parquet-duckdb-charts.md` — date32 fix
- `docs/solutions/database-issues/duckdb-wal-replay-alter-table-default-crash.md` — WAL crash prevention
- `docs/solutions/best-practices/synthetic-ua-data-cpi-ltv-calibration.md` — CPI/LTV calibration targets

### Data Source
- `gc-prod-459709.gameramp` — BigQuery reference (sampled July 2025)
- Distributions verified: installs, sessions, ad_impressions, campaign, revenue, races

---

## Appendix: Distribution Functions Library

Full Python functions to use in `alpha_generate.py`. Each function is calibrated against
`gc-prod-459709.gameramp` July 2025 actuals. Import block assumed:

```python
import math
import numpy as np
from datetime import date
from typing import Dict, List, Optional, Tuple
```

---

### Function 1: CPI Budget Elasticity + Temporal Model

**Calibration basis (BQ July 2025):**
- Facebook iOS: avg daily spend $131, avg CPI $2.90, CV=0.82 (high day-to-day variance)
- Facebook Android: avg daily spend $36, avg CPI $0.17, CV=1.13
- Unity Android: avg daily spend $25, avg CPI $0.06, CV=0.52

The high CVs are driven by campaign mix across countries, not pure temporal variation.
For day-to-day temporal noise, log-space σ=0.08 with AR(1) φ=0.70 produces ~20% week-over-week swings, matching campaign data.

```python
# Day-of-week cost multipliers — Fri/Sat most competitive (social usage peaks)
DOW_CPI_MULT: Dict[int, float] = {
    0: 0.97,   # Monday
    1: 1.00,   # Tuesday (baseline)
    2: 1.03,   # Wednesday
    3: 1.06,   # Thursday
    4: 1.12,   # Friday — highest auction pressure
    5: 0.92,   # Saturday — less B2B, B2C still high but overall lower
    6: 0.88,   # Sunday — lowest
}

# Seasonal CPI multipliers — Q4 is always the most expensive period
MONTH_CPI_MULT: Dict[int, float] = {
    1: 1.05,   # January — post-Q4 residual
    2: 0.98,
    3: 0.97,
    4: 1.00,
    5: 1.02,
    6: 1.03,
    7: 1.04,
    8: 1.05,
    9: 1.08,
    10: 1.15,  # October — Q4 ramp
    11: 1.20,  # November — Black Friday
    12: 1.35,  # December — Christmas peak
}

def build_daily_cpi_series(
    dates: List[date],
    daily_budgets: Dict[date, float],   # {date: USD spend for that day}
    base_cpi: float,                     # CPI at minimal spend (e.g., $5/day)
    rng: np.random.Generator,
    elasticity_k: float = 0.22,          # CPI elasticity: +22% per 10× spend increase
    ar1_phi: float = 0.70,               # AR(1) autocorrelation (0=white noise, 1=random walk)
    ar1_sigma: float = 0.08,             # log-space daily shock size
    min_spend: float = 5.0,              # spend floor for elasticity calculation
) -> Dict[date, float]:
    """
    Compute a realistic daily CPI series for one channel/OS, incorporating:

    1. Budget elasticity: CPI grows logarithmically with spend.
       Formula: cpi_base * (1 + k * log10(spend / min_spend))
       At 10× min_spend (+1 decade): CPI increases by 22%.
       At 100× min_spend (+2 decades): CPI increases by 44%.
       Empirical basis: mobile UA inventory follows a bid-price curve where
       cheap impressions are exhausted first as budget scales.

    2. AR(1) temporal autocorrelation: yesterday's shock predicts today's.
       Produces realistic day-to-day 'streaks' (good days follow good days).
       log(cpi_t) = log(cpi_deterministic_t) + epsilon_t
       epsilon_t = ar1_phi * epsilon_{t-1} + ar1_sigma * N(0,1)

    3. Day-of-week multiplier (Fri +12%, Sun -12%).

    4. Monthly/seasonal multiplier (Dec +35%, March -3%).

    5. Spend pressure spike: if today's budget > 2× yesterday's, CPI spikes 15%
       (burst campaigns exhaust cheap inventory faster).

    Returns: {date: cpi_float}
    """
    result: Dict[date, float] = {}
    epsilon = 0.0
    prev_spend = min_spend

    for d in dates:
        spend = daily_budgets.get(d, 0.0)

        # 1. Budget elasticity
        effective_spend = max(spend, min_spend)
        elast_mult = 1.0 + elasticity_k * math.log10(effective_spend / min_spend)

        # 2. Day-of-week
        dow_mult = DOW_CPI_MULT[d.weekday()]

        # 3. Seasonal
        season_mult = MONTH_CPI_MULT.get(d.month, 1.0)

        # 4. AR(1) noise (log-space so CPI stays positive)
        epsilon = ar1_phi * epsilon + ar1_sigma * rng.standard_normal()
        ar1_mult = math.exp(epsilon)

        # 5. Burst spend pressure
        burst_mult = 1.15 if (spend > 0 and prev_spend > 0 and spend > 2.0 * prev_spend) else 1.0

        cpi = base_cpi * elast_mult * dow_mult * season_mult * ar1_mult * burst_mult

        # Floor at 40% of base (CPI can't go below what the channel will accept)
        result[d] = max(cpi, base_cpi * 0.40)
        prev_spend = spend if spend > 0 else prev_spend

    return result
```

**Usage in gen_campaign:**
```python
# Build per-channel CPI series once, pass to gen_campaign
daily_budgets_fb_ios = {d: rng.lognormal(math.log(131), 0.73) for d in date_range}
cpi_fb_ios = build_daily_cpi_series(date_range, daily_budgets_fb_ios, base_cpi=5.20, rng=rng)
```

---

### Function 2: Retention & LTV Curve

**Calibration basis (BQ Apr–Jul 2025, days_from_cohort in {0, 7, 30, 90}):**
- Organic iOS: avg retention 5.75% across checkpoints → D7 ~35%, D30 ~8%, D90 ~2.5%
  → power law exponent = 0.65 (standard mid-core calibration)
- Organic Android: avg retention 2.0% → D7 ~12%, D30 ~3%, D90 ~1%
  → same exponent, lower D30 base
- Revenue split: iOS = 71% IAP / 29% ad; Android = 8% IAP / 92% ad
- Facebook iOS: 5.31% avg retention (quality paid traffic)
- Facebook Android: 0.96% avg retention (volume-focused, low intent)

```python
# Geo tier definitions for bi-phasic decay
EMERGING_MARKET_COUNTRIES = {
    "India", "Brazil", "Indonesia", "Mexico", "Philippines",
    "Turkey", "Algeria", "Egypt", "Iraq", "Nigeria",
}

def retention_at_day(
    d: int,
    d30_retention: float,
    country: str,
    decay_exponent: float = 0.65,
) -> float:
    """
    Fraction of cohort still active at day d post-install.

    Western markets (US/UK/DE/FR/JP/AU): standard power law.
      ret(d) = d30_retention * (30 / d) ^ 0.65

    Emerging markets (IN/BR/ID/MX/PH/TR/DZ/EG/IQ): bi-phasic.
      Phase 1 (d ≤ 14): slower decay — early engagement looks healthy
        ret(d) = d30_retention * (30 / d) ^ 0.55
      Phase 2 (d > 14): steep cliff — users who didn't commit churn hard
        ret(d) = ret14 * (14 / d) ^ 1.80

    Bi-phasic calibration: produces D7=3× D30 (vs 2× standard) but D90 ≈ 0.3× D30.
    Matches observed pattern in gameramp where IN/BR/ID cohorts look strong at D7
    but show rapid churn by D60.
    """
    if d <= 0:
        return 1.0
    if d30_retention <= 0:
        return 0.0

    if country in EMERGING_MARKET_COUNTRIES:
        if d <= 14:
            return min(d30_retention * (30.0 / d) ** 0.55, 1.0)
        else:
            ret14 = d30_retention * (30.0 / 14.0) ** 0.55
            return ret14 * (14.0 / d) ** 1.80
    else:
        return min(d30_retention * (30.0 / max(d, 1)) ** decay_exponent, 1.0)


def cumulative_ltv_usd(
    days: int,
    cohort_size: int,
    arpdau: float,
    d30_retention: float,
    country: str,
    iap_fraction: float,              # fraction of ARPDAU that is IAP (rest is ad)
    iap_settlement_ratio: float = 0.93,
) -> Dict[str, float]:
    """
    Compute cumulative LTV in USD at standard cohort checkpoints.

    ARPDAU is split into IAP and ad revenue components. IAP revenue is discounted
    by iap_settlement_ratio to account for refunds, chargebacks, and store commissions
    that reduce reported revenue to settled/net revenue.

    Calibration:
    - Organic iOS ARPDAU: $0.50–$0.60 (US/UK heavy), IAP fraction 0.71
    - Organic Android ARPDAU: $0.28–$0.38 (US heavy), IAP fraction 0.08 (mostly ad rev)

    Returns dict with keys: d1, d3, d7, d14, d30, d60, d90, total_days
    Each value is cumulative settled revenue per user in the cohort.
    """
    checkpoints = {1, 3, 7, 14, 30, 60, 90, days}
    daily_revenue = []

    for t in range(1, days + 1):
        active_fraction = retention_at_day(t, d30_retention, country)
        active_users = cohort_size * active_fraction

        # Daily revenue (split IAP + ad)
        iap_revenue = active_users * arpdau * iap_fraction * iap_settlement_ratio
        ad_revenue = active_users * arpdau * (1.0 - iap_fraction)
        daily_revenue.append(iap_revenue + ad_revenue)

    # Cumulative sums at checkpoints
    result = {}
    cumsum = 0.0
    for t, rev in enumerate(daily_revenue, start=1):
        cumsum += rev
        if t in checkpoints:
            key = f"d{t}" if t != days else "total"
            result[key] = round(cumsum, 4)

    return result


def d30_retention_for_channel_country_platform(
    channel: str,
    country: str,
    platform: str,
    install_month: str,              # 'YYYY-MM' — for decay scenario
    base_d30_by_month: Dict[str, float],
) -> float:
    """
    Compute effective D30 retention for a given install segment.

    Multiplier hierarchy (all multiplicative):
      1. Channel quality multiplier — paid traffic varies by channel intent
      2. Platform multiplier — iOS retains better than Android
      3. Geo multiplier — tier-1 markets retain better
      4. Monthly decay — retention erodes over the 6-month period (scenario signal)

    Calibration from gameramp BQ:
    - Organic iOS D30: 8.0%  | Organic Android: 5.0%
    - Facebook iOS: 7.5%     | Facebook Android: 2.5%
    - Google UAC iOS: 7.0%   | Google UAC Android: 3.5%
    - Apple Search Ads iOS: 9.5% (highest intent, keyword-driven)
    """
    # 1. Channel multiplier (relative to organic = 1.0)
    CHANNEL_MULT = {
        "organic":           1.00,
        "apple_search_ads":  1.19,   # highest intent
        "google_uac":        0.87,
        "facebook_ads":      0.94,
    }

    # 2. Platform multiplier
    PLATFORM_MULT = {"IOS": 1.00, "ANDROID": 0.62}

    # 3. Geo multiplier — tier-1 Western markets retain better
    TIER_1 = {"United States", "United Kingdom", "Germany", "France",
               "Japan", "Australia", "Canada", "South Korea"}
    geo_mult = 1.10 if country in TIER_1 else (0.75 if country in EMERGING_MARKET_COUNTRIES else 0.90)

    # 4. Monthly base (retention decay scenario built into base_d30_by_month)
    base = base_d30_by_month.get(install_month, 0.114)

    d30 = base * CHANNEL_MULT.get(channel, 1.0) * PLATFORM_MULT.get(platform, 0.80) * geo_mult

    return min(d30, 0.35)  # cap at 35% — no game retains more than this at D30
```

---

### Function 3: Fraud Rate Model

**Calibration basis:**
- Apple Search Ads: ~0.5% fraud (Apple's closed attribution, no SDK spoofing)
- Google UAC: ~3–5% (click validation via Google, lower than social)
- Facebook Ads iOS: ~8–15% (click injection, SDK spoofing, install farms — gameramp fraud range 5–12%)
- Facebook Ads Android: ~12–20% (higher exposure; install farms predominantly Android)
- Organic: ~1–2% (mis-attribution fraud: reinstall counted as organic)

Geo multipliers derived from gameramp country distribution + industry benchmarks
(AppsFlyer Fraud Index 2024, Adjust Fraud Report 2024):

```python
# Country fraud tier multipliers
# Tier 1: robust device/network controls; Tier 3: click injection farms prevalent
GEO_FRAUD_MULT: Dict[str, float] = {
    # Tier 1 — low fraud (0.8×)
    "United States": 0.80, "United Kingdom": 0.82, "Germany": 0.85,
    "France": 0.85, "Japan": 0.75, "Australia": 0.82, "Canada": 0.82,
    "South Korea": 0.78,

    # Tier 2 — moderate fraud (1.2–1.8×)
    "Brazil": 1.40, "Mexico": 1.35, "Russia": 1.50, "Turkey": 1.60,
    "Poland": 1.20, "Ukraine": 1.45, "Kazakhstan": 1.55,

    # Tier 3 — high fraud (2.0–3.0×)
    "Philippines": 2.80, "India": 2.20, "Indonesia": 2.50,
    "Algeria": 2.60, "Egypt": 2.40, "Iraq": 2.70, "Nigeria": 2.90,
    "Bangladesh": 2.50, "Pakistan": 2.30, "Azerbaijan": 2.20,
}
_DEFAULT_GEO_FRAUD_MULT = 1.50   # Tier 2 default for unlisted countries

# Channel base fraud rates (fraction of installs that are fraudulent)
CHANNEL_FRAUD_BASE: Dict[str, float] = {
    "apple_search_ads": 0.005,   # near-zero — Apple attribution is closed
    "google_uac":       0.040,   # Google fraud prevention is effective
    "facebook_ads":     0.105,   # mid-point of gameramp observed 5–12% range
    "organic":          0.015,   # mis-attribution fraud
}

def compute_fraud_rate(
    channel: str,
    country: str,
    daily_spend: float,
    rng: np.random.Generator,
    spend_elasticity: float = 0.12,   # fraud risk: +12% per 10× spend
    min_spend: float = 10.0,
) -> float:
    """
    Returns probability (0.0–1.0) that an install from this channel+country is fraudulent.

    Three components:
    1. Channel base rate — inherent fraud exposure per channel
    2. Geo multiplier — structural fraud infrastructure by country
    3. Spend elasticity — higher spend → more incentive for fraud networks to target
       Formula: base * geo_mult * (1 + spend_elast * log10(spend / min_spend))
    4. Stochastic noise — ±20% day-to-day random variation (rng.uniform(0.80, 1.20))

    Temporal patterns NOT modelled here (handle in gen_installs caller):
    - New campaign launch spike: multiply by 1.5 for first 3 days of a new campaign
    - Weekend elevation: multiply by 1.2 on Saturday/Sunday
    """
    base = CHANNEL_FRAUD_BASE.get(channel, 0.08)
    geo_mult = GEO_FRAUD_MULT.get(country, _DEFAULT_GEO_FRAUD_MULT)

    # Spend elasticity
    if daily_spend > min_spend:
        spend_mult = 1.0 + spend_elasticity * math.log10(daily_spend / min_spend)
    else:
        spend_mult = 1.0

    # Stochastic noise (lognormal to keep positive)
    noise = rng.lognormal(0.0, 0.18)   # mean≈1.0, std≈0.18

    fraud_rate = base * geo_mult * spend_mult * noise

    return min(fraud_rate, 0.45)   # hard cap: 45% fraud is unrealistic beyond this
```

---

### Function 4: ARPDAU by Segment

**Calibration basis (BQ Apr–Jul 2025):**
- Revenue split by platform: iOS 71% IAP + 29% ad / Android 8% IAP + 92% ad
- Organic iOS total: ~$755K from 54K users over ~3 months → ~$0.57 ARPDAU
- Organic Android: ~$182K from ~167K users → ~$0.08 ARPDAU (mostly ad-revenue-driven)

For alpha (Western-heavy):
- US/UK/DE iOS: $0.50–0.60 (high IAP conversion + rewarded ad fill)
- US/UK/DE Android: $0.35–0.45 (lower IAP but strong ad CPMs in Western market)
- Emerging market Android: $0.08–0.15 (ad-revenue only, low CPMs)

```python
# Base ARPDAU lookup: (country, platform) → (total_arpdau, iap_fraction)
# iap_fraction: share of ARPDAU coming from IAP (rest = ad revenue)
# Calibrated: iOS organic IAP/ad = 71%/29%; Android = 8%/92%
ARPDAU_BASE: Dict[Tuple[str, str], Tuple[float, float]] = {
    # Western tier-1 — both high ARPDAU with different IAP/ad split
    ("United States",   "IOS"):     (0.55, 0.72),
    ("United States",   "ANDROID"): (0.40, 0.10),
    ("United Kingdom",  "IOS"):     (0.48, 0.68),
    ("United Kingdom",  "ANDROID"): (0.35, 0.09),
    ("Germany",         "IOS"):     (0.44, 0.65),
    ("Germany",         "ANDROID"): (0.32, 0.09),
    ("France",          "IOS"):     (0.40, 0.63),
    ("France",          "ANDROID"): (0.28, 0.08),
    ("Japan",           "IOS"):     (0.62, 0.75),   # Japan is a premium IAP market
    ("Japan",           "ANDROID"): (0.45, 0.15),
    ("Australia",       "IOS"):     (0.50, 0.70),
    ("Canada",          "IOS"):     (0.47, 0.69),
    # Tier-2 — moderate ARPDAU
    ("Brazil",          "IOS"):     (0.22, 0.45),
    ("Brazil",          "ANDROID"): (0.12, 0.08),
    ("Mexico",          "ANDROID"): (0.10, 0.07),
    ("Turkey",          "ANDROID"): (0.09, 0.06),
    # Tier-3 — ad-revenue only, low fill rates
    ("Philippines",     "ANDROID"): (0.06, 0.04),
    ("India",           "ANDROID"): (0.05, 0.03),
}
_DEFAULT_ARPDAU_IOS     = (0.18, 0.50)   # fallback for unlisted iOS countries
_DEFAULT_ARPDAU_ANDROID = (0.08, 0.06)   # fallback for unlisted Android countries

# Channel engagement multipliers on ARPDAU
# Paid UA users are pre-selected for intent; higher-intent channels monetize better
CHANNEL_ARPDAU_MULT: Dict[str, float] = {
    "apple_search_ads": 1.25,   # highest intent — keyword search → IAP intent
    "organic":          1.00,   # baseline
    "google_uac":       0.92,   # broad audience, slightly lower monetization
    "facebook_ads":     0.85,   # volume-focused; lower avg quality vs organic
}

# Engagement tier multipliers on ARPDAU
ENGAGEMENT_ARPDAU_MULT: Dict[str, float] = {
    "hardcore":    2.10,   # buy multiple IAP packs; watch all rewarded ads
    "competitive": 1.45,   # occasional IAP; consistent ad watcher
    "casual":      1.00,   # baseline
}

def compute_arpdau(
    platform: str,
    country: str,
    channel: str,
    engagement_tier: str,
    rng: np.random.Generator,
    noise_sigma: float = 0.15,          # log-normal noise on final ARPDAU
) -> Tuple[float, float]:
    """
    Returns (arpdau_usd, iap_fraction) for a user in this segment.

    Multiplicative factor hierarchy:
      base_arpdau (geo+platform table)
      × channel_mult (intent proxy)
      × engagement_mult (behaviour proxy)
      × lognormal_noise (day-to-day variance)

    Returns:
      arpdau:       total daily revenue per active user (USD)
      iap_fraction: fraction of arpdau attributable to IAP
                    (caller uses this to split into iap_revenue + ad_revenue columns)
    """
    if platform == "IOS":
        base_arpdau, iap_frac = ARPDAU_BASE.get((country, "IOS"), _DEFAULT_ARPDAU_IOS)
    else:
        base_arpdau, iap_frac = ARPDAU_BASE.get((country, "ANDROID"), _DEFAULT_ARPDAU_ANDROID)

    chan_mult = CHANNEL_ARPDAU_MULT.get(channel, 1.0)
    eng_mult  = ENGAGEMENT_ARPDAU_MULT.get(engagement_tier, 1.0)

    # Log-normal noise — keeps ARPDAU positive, mean≈1.0
    noise = rng.lognormal(0.0, noise_sigma)

    arpdau = base_arpdau * chan_mult * eng_mult * noise

    return max(arpdau, 0.001), iap_frac    # floor at $0.001/day


def compute_session_ad_revenue(
    arpdau: float,
    iap_fraction: float,
    sessions_that_day: int,
) -> Tuple[float, float]:
    """
    Split daily ARPDAU into per-session ad revenue and total IAP revenue for the day.

    Ad revenue is distributed uniformly across sessions (each session earns arpdau_ad / n_sessions).
    IAP revenue is treated as a single transaction per day (simplification).
    """
    daily_ad = arpdau * (1.0 - iap_fraction)
    daily_iap = arpdau * iap_fraction
    per_session_ad = daily_ad / max(sessions_that_day, 1)
    return per_session_ad, daily_iap
```

---

### Function 5: Revenue Settlement Model

**Calibration basis:**
- gameramp revenue table: `revenue.revenue` vs `revenue.total_revenue` columns
- iOS organic: total_revenue / revenue ≈ 1.40 (total includes ad_revenue)
- Settlement applied to IAP component: store commission (30% Apple, 15% Google for <$1M/year)
  + refund rate (~4% iOS, ~8% Android) + chargeback rate (~1% iOS, ~3% Android emerging)

```python
def compute_iap_settlement_ratio(
    country: str,
    platform: str,
    rng: np.random.Generator,
) -> float:
    """
    Fraction of gross IAP revenue that settles to net revenue after:
      - App store commission (Apple 30% → net 70%; Google 15% for <$1M → net 85%)
      - Refunds (user-initiated returns)
      - Chargebacks (payment disputes / fraud)

    Note: Apple's commission is already deducted before 'revenue' is reported in most
    analytics integrations (Appsflyer reports net-of-store). This function models the
    ADDITIONAL shrinkage from refunds + chargebacks on top of store-net revenue.

    Calibration targets (refund + chargeback only, net of store commission):
      Tier-1 iOS:     95–97% settle  (low refund culture, Apple's refund process is hard)
      Tier-1 Android: 90–93% settle  (Google slightly easier to refund)
      LatAm Android:  80–86% settle  (higher chargeback rates, local payment methods)
      MENA Android:   75–82% settle  (highest fraud + refund rates)
    """
    TIER_1 = {"United States", "United Kingdom", "Germany", "France",
               "Japan", "Australia", "Canada", "South Korea"}
    LATAM  = {"Brazil", "Mexico", "Argentina", "Colombia", "Chile", "Peru"}
    MENA   = {"Algeria", "Egypt", "Iraq", "Turkey", "Morocco", "Saudi Arabia", "Iran"}

    if platform == "IOS":
        if country in TIER_1:
            # Beta distribution: mean 96%, tight (α=48, β=2)
            return float(rng.beta(48, 2))
        elif country in LATAM:
            return float(rng.beta(41, 9))    # mean ~82%
        elif country in MENA:
            return float(rng.beta(38, 12))   # mean ~76%
        else:
            return float(rng.beta(44, 6))    # mean ~88%
    else:  # ANDROID
        if country in TIER_1:
            return float(rng.beta(46, 4))    # mean ~92%
        elif country in LATAM:
            return float(rng.beta(38, 12))   # mean ~76%
        elif country in MENA:
            return float(rng.beta(34, 16))   # mean ~68%
        else:
            return float(rng.beta(40, 10))   # mean ~80%
```

---

### Function 6: Race Outcome & Scoring

**Calibration basis (BQ July 2025 races table):**
- ClassicRace Win: avg score 4,967 Android / 6,258 iOS; avg duration 45s; avg 10 overtakes; 2.4 crashes
- TimeScore Win: avg score 10,121 Android / 13,185 iOS; avg duration 50s; 6.7 crashes
- BeatTheTime Win: avg score 5,575; avg duration 52s; 5.3 crashes
- Survival Win: avg score 4,818 (A) / 6,085 (I); avg duration 21s; 1.8 crashes
- Elimination Win: avg score 10,983; avg duration 104s; 6.4 crashes
- FreeDrive / Multiplayer: duration 270–370s, no score/result

iOS scores are consistently 25–35% higher than Android (better device performance + controls).

```python
# Level type parameters: (win_prob, duration_lognorm_mu, duration_lognorm_sigma,
#                          score_mean_android, score_mult_ios, overtake_mean, crash_mean)
LEVEL_TYPE_PARAMS: Dict[str, Tuple] = {
    "ClassicRace":  (0.47, 3.80, 0.30, 4_967,  1.26, 10.1, 2.4),
    "TimeScore":    (0.54, 3.92, 0.28, 10_121, 1.30, 19.8, 7.5),
    "BeatTheTime":  (0.50, 3.95, 0.30,  5_575, 1.20, 14.4, 5.3),
    "Survival":     (0.55, 3.05, 0.32,  4_818, 1.26,  9.6, 1.8),
    "Elimination":  (0.49, 4.64, 0.35, 10_983, 1.28, 17.7, 6.4),
    "Multiplayer":  (None, 5.80, 0.40,   None, None,  None, None),  # no win/lose
    "FreeDrive":    (None, 5.50, 0.40,   None, None,  None, None),  # free roam
}

def gen_race_outcome(
    level_type: str,
    platform: str,
    rng: np.random.Generator,
) -> Dict:
    """
    Generate result, score, duration, overtakes, crash_number for one race.
    Returns a dict of column values (None for non-applicable fields).
    """
    params = LEVEL_TYPE_PARAMS[level_type]
    win_prob, dur_mu, dur_sigma, score_base_android, score_ios_mult, overtake_mean, crash_mean = params

    is_competitive = level_type not in ("Multiplayer", "FreeDrive")

    # Duration (always present)
    duration = float(rng.lognormal(dur_mu, dur_sigma))

    if not is_competitive:
        return {
            "result": None,
            "level_duration": round(duration, 2),
            "score": None,
            "overtakes": None,
            "crash_number": None,
            "is_level_completed": 1,
        }

    # Win/lose
    completed = bool(rng.random() < (1.0 - 0.35))   # 35% abandoned/incomplete
    result = None
    if completed:
        result = "Win" if rng.random() < win_prob else "Lose"

    # Score — only meaningful when completing a level
    score = None
    if result is not None and score_base_android is not None:
        ios_mult = score_ios_mult if platform == "IOS" else 1.0
        score_mean = score_base_android * ios_mult
        # Log-normal noise: CV ≈ 40% (races have high score variance)
        score = float(rng.lognormal(math.log(score_mean), 0.35))
        # Lose races score lower
        if result == "Lose":
            score *= 0.75

    # Overtakes (Poisson, iOS slightly higher)
    overtakes = None
    if overtake_mean is not None and result is not None:
        mean_adj = overtake_mean * (1.15 if platform == "IOS" else 1.0)
        overtakes = int(rng.poisson(mean_adj))

    # Crashes (Poisson)
    crash_number = None
    if crash_mean is not None:
        crash_mean_adj = crash_mean * (0.85 if platform == "IOS" else 1.0)  # iOS crashes less
        crash_number = int(rng.poisson(crash_mean_adj))

    return {
        "result": result,
        "level_duration": round(duration, 2),
        "score": round(score, 1) if score is not None else None,
        "overtakes": overtakes,
        "crash_number": crash_number,
        "is_level_completed": int(completed),
    }
```

---

### Summary: Function Call Chain in `alpha_generate.py`

```
main()
  ├─ build_daily_cpi_series()          → per-channel daily CPI dict
  ├─ gen_installs()
  │    └─ compute_fraud_rate()         → per-install fraud flag
  │    └─ d30_retention_for_channel_country_platform() → per-cohort D30
  ├─ gen_sessions()
  │    └─ compute_arpdau()             → (arpdau, iap_fraction) per active user-day
  │    └─ compute_session_ad_revenue() → per-session ad rev + daily IAP rev
  ├─ gen_races()                       [chunked ParquetWriter]
  │    └─ gen_race_outcome()           → per-race result/score/duration
  ├─ gen_ad_impressions()
  │    └─ (uses session ad_revenue from gen_sessions output)
  ├─ gen_revenue()
  │    └─ retention_at_day()           → active users at each cohort checkpoint
  │    └─ cumulative_ltv_usd()         → LTV at D7/D14/D30/D60/D90
  │    └─ compute_iap_settlement_ratio() → shrink reported → settled IAP
  └─ gen_campaign()
       └─ build_daily_cpi_series()     → already built, passed in
```
