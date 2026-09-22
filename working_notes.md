# GamerRamp Dataset — Working Notes

Issues and fixes found during testing.

---

## Issue 1: CPI chart looks like a sine wave (not realistic)

**Status:** Open
**File:** `scripts/generate-gameramp.py`

### What's wrong

When charting CPI over time, the line oscillates in a perfect sine-wave between ~$2.50 and ~$0.80. This is completely unrealistic — it looks obviously synthetic.

### Root cause

Two layered problems:

1. **Fixed per-channel CPI with tiny noise only.** Each channel has a constant CPI (facebook=$2.50, vungle=$0.80) with just ±$0.05 Gaussian noise added. No time trend, no day-of-week effect, no autocorrelation.

2. **Alternating channel dominance by day.** At scale=0.1 (30K users / 289 days / 5 channels ≈ 20 users/channel/day), random date sampling creates days dominated by different channels. The aggregated "average CPI" oscillates between high-CPI days (Facebook installs) and low-CPI days (Vungle installs). The sine pattern comes from this alternation, not actual CPI variation.

### What realistic UA CPI looks like (to research)

Look at the quickhelp dataset's `ad_full` table for a real example. From mobile game UA benchmarks:

- **Temporal trend**: CPI rises gradually over the year as competition increases (+5–10% Feb→Oct), then spikes in Q4 (Oct/Nov) by 25–40% due to holiday advertiser competition
- **Day-of-week**: Weekends have lower CPI (less competition), Thursday/Friday highest
- **Per-channel variance**: Each channel has its own volatility profile — Facebook is relatively stable (±8%), Vungle is more volatile (±20%), DSPs like Moloco can swing ±25%
- **No sine wave**: Real CPI trends upward with noise, not alternating

### Proposed fix

Replace the fixed CPI + tiny noise model with:

```python
def get_daily_cpi(channel: str, date: date, rng: np.random.Generator) -> float:
    base = CHANNEL_CPI[channel]

    # 1. Gradual upward trend (+8% Feb→Oct, then Q4 spike)
    day_of_year = date.timetuple().tm_yday
    trend = 1.0 + 0.08 * (day_of_year - 40) / 280  # ~+8% over the period

    # 2. Q4 holiday premium (Oct 1 – Nov 24 = +25–35%)
    if date.month in (10, 11):
        trend *= 1.30

    # 3. Day-of-week effect (Mon=1.0, Fri=1.12, Sat=0.88)
    dow = date.weekday()
    dow_mult = [0.97, 1.00, 1.03, 1.06, 1.12, 0.92, 0.88][dow]

    # 4. Per-channel autocorrelated noise (not i.i.d. Gaussian)
    #    Use a pre-seeded random walk per channel rather than per-row noise
    volatility = {"facebook": 0.08, "admob": 0.12, "vungle": 0.20, "moloco": 0.18, "organic": 0.0}
    noise = rng.normal(0, volatility[channel])

    return max(0.01, base * trend * dow_mult * (1 + noise))
```

Also: pre-generate a daily CPI series per channel using an autocorrelated random walk (AR(1)) so consecutive days are correlated — real CPI doesn't jump randomly each day.

### Impact on scenarios

Scenario 1 (CPI↔LTV) still works as long as Facebook mean CPI stays higher than Vungle mean CPI. The fix should use the base CPIs as anchors with variation around them, not replace them.

---

## Issue 2: cohort_date shows timestamp (00:00:00) clutter on charts

**Status:** Open
**File:** `scripts/generate-gameramp.py`

### What's wrong

Charts using `cohort_date` as the X-axis show "2025-02-10 00:00:00" instead of "2025-02-10". The timestamp suffix clutters axis labels.

### Root cause

In `gen_campaign` and `gen_revenue`, `pd.to_datetime()` is called on `cohort_date`, converting Python `datetime.date` objects into pandas `Timestamp`. PyArrow writes these as `TIMESTAMP` type in parquet. DuckDB reads and formats them as datetimes.

### Fix

Remove the `pd.to_datetime()` calls for `cohort_date`. Keeping them as Python `datetime.date` objects causes PyArrow to write them as `date32` (DATE type), which DuckDB displays as "2025-02-10".

---

## Issue 3: CPI ($0.80–$2.50) and LTV ($0.05–$0.13) values are too small

**Status:** Open
**File:** `scripts/generate-gameramp.py`

### What's wrong

Current CPI range ($0.80–$2.50) and D60 LTV range ($0.05–$0.13) are unrealistically low for a mid-core mobile racing game. Target: CPI $3–$8, D60 LTV $3–$12.

### Root cause

`CHANNEL_CPI`, `ARPDAU_BASE`, and `D30_RETENTION` all calibrated for a cheap hyper-casual game, not a mid-core racing title.

### Fix

```
CHANNEL_CPI:   facebook $7.50, admob $5.50, moloco $4.50, vungle $3.00
ARPDAU_BASE:   US iOS → $0.45, US android → $0.32 (scale others proportionally, ~8x increase)
D30_RETENTION: Feb → 15%, Nov → 7% (4x scale-up; decay narrative preserved)
```

Expected D60 LTV after fix (facebook US iOS): 0.45 × 1.30 (ch_mult) × ~17 active-days ≈ $9.9 ✓

---

## Issue 4: Scatter chart (CPI × LTV) not supported in current arch

**Status:** Note / feature gap
**File:** `src/lib/chart-types.ts`

### Current state

Chart types: `"bar" | "line" | "area" | "pie"`. No scatter type. The LLM cannot request a scatter chart.

### Workaround

The bar chart with channels ordered by CPI already shows the correlation visually (screenshot confirmed). Valid substitute for now.

### To add scatter support

Add `"scatter"` to the chart type union with `{ xKey, yKey, nameKey }` schema. Recharts has native `<ScatterChart>`. SQL would return `(avg_cpi, d60_ltv, channel)` — one row per channel.

---

## Issue 5: CPI needs realistic temporal dynamics (spend correlation, Q4, day-of-week)

**Status:** Open (expands Issue 1)
**File:** `scripts/generate-gameramp.py`

### Requirements

- **Spend ↔ CPI correlation**: Higher monthly UA spend → higher CPIs (auction pressure). `MONTHLY_SPEND` dict already exists.
- **Holiday premium**: Q4 (Oct/Nov) +30–35%
- **Weekend trough**: Sat/Sun ~10–15% below weekday average
- **Gradual drift**: +15% Feb→Nov baseline
- **Note on BigQuery**: User referenced a BigQuery gameramp dataset for CPI trend data — no BigQuery access here. Using UA industry benchmarks instead.

### Implementation

Pre-generate `daily_cpi_series[(channel, date)]` using AR(1) model:
```
CPI = base × trend_mult × q4_mult × dow_mult × spend_mult × exp(AR1_noise)
```
AR(1): ε_t = 0.7×ε_{t-1} + σ×N(0,1), σ by channel: FB=0.06, AdMob=0.10, Moloco=0.12, Vungle=0.15

---
