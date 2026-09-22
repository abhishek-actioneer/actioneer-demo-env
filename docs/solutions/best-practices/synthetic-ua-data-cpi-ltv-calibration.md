---
title: "Synthetic Mobile UA Data: Realistic CPI, LTV, and Retention Calibration"
date: 2026-03-16
category: best-practices
subcategory: synthetic-data-generation
severity: medium
status: solved
symptoms:
  - "CPI chart shows sine-wave oscillation instead of smooth trend"
  - "LTV values ($0.05–$0.13) look unrealistically small for a mobile game"
  - "D30 retention (1.6–3.5%) too low for a mid-core game"
  - "Per-channel CPI too constant — no temporal variation"
technologies:
  - "Python numpy/pandas synthetic data generation"
  - "DuckDB analytics"
components:
  - "scripts/generate-gameramp.py"
---

# Synthetic Mobile UA Data: Realistic CPI, LTV, and Retention Calibration

## Problem

The initial GamerRamp synthetic dataset had two related issues:

1. **CPI chart looked like a sine wave** — alternating between high (Facebook $2.50) and
   low (Vungle $0.80) CPIs per day, because at small scale (30K users / 289 days / 5 channels)
   each day was dominated by a single channel's installs. Constant-per-channel CPI + random
   date assignment = perfect oscillation in the aggregate.

2. **LTV values were unrealistically small** — $0.05–$0.13 for a "mid-core racing game"
   because ARPDAU ($0.05) and D30 retention (3.5%) were calibrated for a hyper-casual game.

## Root Cause: Sine Wave

Two layered problems:
- Per-channel CPI was a fixed constant (no temporal dynamics)
- At small scale, random date assignment creates days where only one channel has installs
- Aggregated average CPI oscillates between that channel's value

## Root Cause: Small LTV Values

Calibration mismatch:
- Hyper-casual game: ARPDAU ~$0.03–$0.06, D30 retention ~2–5%
- Mid-core mobile game: ARPDAU ~$0.25–$0.50 (US iOS), D30 retention ~8–20%

## Realistic Benchmarks (Mid-Core Mobile Game, 2025)

### CPI by Channel
```python
CHANNEL_CPI = {
    "facebook": 7.50,   # premium audience targeting
    "admob":    5.50,   # broad reach, decent quality
    "moloco":   4.50,   # ML-optimized DSP
    "vungle":   3.00,   # video network, volume play
    "organic":  0.00,
}
```

### ARPDAU (Revenue per Daily Active User)
```python
ARPDAU_BASE = {
    ("US", "ios"):     0.45,   # top market, premium users
    ("US", "android"): 0.32,
    ("GB", "ios"):     0.38,
    ("DE", "ios"):     0.32,
    ("IN", "android"): 0.095,  # emerging market, lower ARPDAU
    ("BR", "android"): 0.120,
}
```

### D30 Retention (decaying trend for "stale model" scenario)
```python
D30_RETENTION = {
    "2025-02": 0.150,   # 15% — good early cohorts
    "2025-06": 0.110,
    "2025-11": 0.070,   # 7%  — retention degrading over time
}
```

### Expected D60 LTV Calculation
```
D60 LTV ≈ ARPDAU × channel_mult × sum_of_retention(D0..D60)
Facebook US iOS: 0.45 × 1.30 × ~17 active-days ≈ $9.9  ✓  (target $8–12)
Vungle US iOS:   0.45 × 0.65 × ~17 × (D30=0.15×0.75) ≈ $3.5  ✓  (target $3–5)
```

## Fix: Realistic CPI Temporal Model

Replace fixed CPI with AR(1) autocorrelated series:

```python
# Pre-generate daily CPI per channel with temporal dynamics
def build_daily_cpi_series(rng):
    AR_PHI = 0.7   # autocorrelation (consecutive days correlated)
    DOW_MULT = [0.97, 1.00, 1.03, 1.06, 1.12, 0.92, 0.88]  # Mon–Sun

    for channel in CHANNELS:
        base = CHANNEL_CPI[channel]
        epsilon = 0.0

        for i, d in enumerate(all_dates):
            # 1. Gradual upward trend (+15% Feb→Nov: market competition grows)
            trend = 1.0 + 0.15 * i / (total_days - 1)

            # 2. Q4 holiday premium (Oct/Nov: holiday advertisers flood auctions)
            if d.month in (10, 11):
                trend *= 1.32

            # 3. Day-of-week (Thu/Fri peak, weekend trough)
            dow_mult = DOW_MULT[d.weekday()]

            # 4. Spend pressure (higher monthly budget → higher auction CPIs)
            spend_ratio = MONTHLY_SPEND[month_key(d)] / avg_spend
            spend_mult = 0.88 + 0.24 * min(max((spend_ratio - 0.5), 0.0), 1.0)

            # 5. AR(1) log-normal noise (correlated, not i.i.d.)
            epsilon = AR_PHI * epsilon + sigma * rng.standard_normal()
            noise_mult = np.exp(epsilon)

            cpi = base * trend * dow_mult * spend_mult * noise_mult
```

### Channel Volatility Parameters
```python
CHANNEL_CPI_VOLATILITY = {
    "facebook": 0.06,   # stable, large auction depth
    "admob":    0.10,
    "moloco":   0.12,
    "vungle":   0.15,   # most volatile, smaller auction
}
```

## Key Insight: Spend ↔ CPI Correlation

In programmatic UA auctions, higher daily/monthly spend means:
- Bidding on more impressions → exhausting cheap inventory → higher marginal CPIs
- More advertisers in Q4 → everyone bids higher → systemic CPI inflation

Model this by making CPI a function of `MONTHLY_SPEND[month]` — months with 20%+ higher
spend should show ~5–8% higher CPIs than low-spend months.

## Rule for Future Synthetic Datasets

When generating synthetic UA data, always calibrate against these targets:
- **Hyper-casual**: CPI $0.30–$1.50, ARPDAU $0.02–$0.05, D30 retention 1–5%
- **Casual**: CPI $1.00–$3.00, ARPDAU $0.05–$0.15, D30 retention 4–10%
- **Mid-core**: CPI $3.00–$8.00, ARPDAU $0.20–$0.50, D30 retention 8–20%
- **Hardcore/RPG**: CPI $5.00–$15.00, ARPDAU $0.50–$2.00, D30 retention 15–30%
