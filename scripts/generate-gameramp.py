#!/usr/bin/env python3
"""
generate-gameramp.py — Synthetic GameRamp dataset generator

Presto — casual/mid-core mobile puzzle game
~300K users, Aug 1, 2025 – Feb 28, 2026

Usage:
  python3 scripts/generate-gameramp.py [--scale FLOAT] [--seed INT] [--output DIR]

  --scale  Fraction of full dataset (0.01–1.0), default 0.1 → ~30K users
  --seed   Random seed for reproducibility, default 42
  --output Output directory, default data/parquet/gameramp

Six engineered scenarios:
  1. CPI↔LTV correlation: facebook $7.50 CPI → D30 RoAS ~77%; vungle $3.00 → D30 RoAS ~70%; breakeven D60 for facebook/admob/moloco, ~D75 for vungle
  2. Fraud/settlement: vungle ~17% invalid traffic, reported≠settled revenue
  3. Cohort vs calendar: first-month UA spend >> early closed revenue; D180 LTV much larger
  4. Stale LTV model: D30 retention decays Aug 2025→Feb 2026 (15%→8.1%)
  5. ARPDAU dilution: total ad revenue grows, ARPDAU stays flat (~$0.028)
  6. Geo expansion risk: IN/BR D14 LTV overshoots D90 LTV by 30–40%

Fraud model: impression stuffing — fraud users generate sessions with reported_revenue > 0
but settled_revenue = 0, creating a visible gap in Finance's settled revenue reports.

Dependencies:
  pip install pandas numpy pyarrow
"""

import argparse
import calendar
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


# ── Date range ──────────────────────────────────────────────────────────────────

START_DATE = date(2025, 8, 1)
END_DATE   = date(2026, 2, 28)
TOTAL_DAYS = (END_DATE - START_DATE).days + 1  # 212 days
ALL_DATES  = [START_DATE + timedelta(days=i) for i in range(TOTAL_DAYS)]

FULL_SCALE_USERS = 300_000
SESSION_DAYS = 30  # track sessions D0–D30 post-install


# ── Channel configuration ───────────────────────────────────────────────────────

CHANNELS = ["facebook", "admob", "vungle", "moloco", "organic"]

# Scenario 1: CPI drives quality — higher CPI ↔ higher LTV players
# Mid-core mobile racing game CPI range: $3–$8
CHANNEL_CPI = {
    "facebook": 7.50,
    "admob":    5.50,
    "moloco":   4.50,
    "vungle":   3.00,
    "organic":  0.00,
}

CHANNEL_SPEND_SHARE = {
    "facebook": 0.60,
    "admob":    0.20,
    "vungle":   0.12,
    "moloco":   0.08,
}

# Paid install volume weight = spend_share / cpi (normalized)
_raw_vol = {ch: CHANNEL_SPEND_SHARE[ch] / CHANNEL_CPI[ch] for ch in CHANNEL_SPEND_SHARE}
_total_vol = sum(_raw_vol.values())
CHANNEL_PAID_VOL_SHARE = {ch: v / _total_vol for ch, v in _raw_vol.items()}


# ── Fraud (Scenario 2) ──────────────────────────────────────────────────────────

# Per-user fraud rates sampled uniformly within range
# Fraud users = impression stuffing: reported_revenue > 0, settled_revenue = 0
CHANNEL_FRAUD_RANGE = {
    "facebook": (0.04, 0.08),
    "admob":    (0.08, 0.14),
    "vungle":   (0.14, 0.20),
    "moloco":   (0.11, 0.17),
    "organic":  (0.02, 0.05),
}
CHANNEL_FRAUD_MID = {ch: (lo + hi) / 2 for ch, (lo, hi) in CHANNEL_FRAUD_RANGE.items()}


# ── Retention (Scenarios 1 & 4) ─────────────────────────────────────────────────

# D30 base retention by install month — gentle improvement as UA targeting matures
D30_RETENTION = {
    "2025-08": 0.100,
    "2025-09": 0.103,
    "2025-10": 0.107,
    "2025-11": 0.111,
    "2025-12": 0.114,
    "2026-01": 0.117,
    "2026-02": 0.120,   # +20% over 7 months — D7 LTV gently growing
}

# Post-D7 daily LTV multiplier by install month — long-tail monetization deteriorating
# as cohort user quality shifts toward lower-engagement installs over time.
# D7 LTV is unaffected; D30/D7 ratio shrinks from ~2.5x to ~1.9x by Feb.
LONG_TAIL_MULT = {
    "2025-08": 1.00,
    "2025-09": 0.93,
    "2025-10": 0.87,
    "2025-11": 0.81,
    "2025-12": 0.74,
    "2026-01": 0.67,
    "2026-02": 0.60,
}

# Channel multiplier: higher-CPI channels attract better-retained users
CHANNEL_RETENTION_MULT = {
    "facebook": 1.20,
    "admob":    1.05,
    "organic":  1.10,
    "moloco":   0.95,
    "vungle":   0.75,
}

# Geo × platform retention multiplier (relative to US iOS = 1.0)
# Derived from DAU/Install retention proxy in real MMP data + mid-core market knowledge.
# For mid-core racing (IAP-focused): iOS retains better than Android (players who paid
# more to acquire the game invest more time). Tier-1 markets retain better than emerging.
# Note: EMERGING_GEOS bi-phasic curve handles retention SHAPE; this handles the LEVEL.
GEO_RETENTION_MULT: dict = {
    # Tier 1 — premium markets
    ("US",     "ios"):     1.00,
    ("US",     "android"): 0.82,
    ("CA",     "ios"):     0.92,
    ("CA",     "android"): 0.76,
    ("GB",     "ios"):     0.88,
    ("GB",     "android"): 0.72,
    # Tier 2 — mature European markets
    ("DE",     "ios"):     0.82,
    ("DE",     "android"): 0.67,
    ("FR",     "ios"):     0.76,
    ("FR",     "android"): 0.60,
    # Tier 3 — emerging markets (lower absolute retention; bi-phasic curve also applied)
    ("BR",     "ios"):     0.62,
    ("BR",     "android"): 0.52,
    ("MX",     "ios"):     0.60,
    ("MX",     "android"): 0.50,
    ("IN",     "ios"):     0.52,
    ("IN",     "android"): 0.44,
    ("ID",     "ios"):     0.55,
    ("ID",     "android"): 0.46,
    # Fallback
    ("others", "ios"):     0.72,
    ("others", "android"): 0.58,
}


# ── ARPDAU (Scenarios 1 & 5) ────────────────────────────────────────────────────

# ARPDAU calibrated from real MMP data (Food Truck Chef casual → scaled to mid-core).
# Ratios derived from Total ARPDAU medians per country × OS (n≥10 rows), normalised to
# US iOS = 1.0, then scaled to mid-core anchor US iOS = $0.450.
# iOS > Android for mid-core (IAP-heavy; casual shows opposite due to ad-revenue skew).
# Emerging market values corrected down from prior over-estimate; iOS variants added.
ARPDAU_BASE: dict = {
    # Calibrated so D30 RoAS lands 70–85% per channel (join fix applied in summary tables).
    # All values are 2.4× the real-data anchor to hit target economics.
    ("US",     "ios"):     1.080,   # anchor — 1.00× (was 0.450)
    ("US",     "android"): 0.768,   # 0.71×
    ("CA",     "ios"):     0.864,   # 0.80×
    ("CA",     "android"): 0.636,   # 0.59×
    ("GB",     "ios"):     0.768,   # 0.71×
    ("GB",     "android"): 0.612,   # 0.57×
    ("DE",     "ios"):     0.504,   # 0.47×
    ("DE",     "android"): 0.408,   # 0.38×
    ("FR",     "ios"):     0.444,   # 0.41×
    ("FR",     "android"): 0.228,   # 0.21×
    ("IN",     "ios"):     0.108,   # 0.10×
    ("IN",     "android"): 0.072,   # 0.07×
    ("BR",     "ios"):     0.228,   # 0.21×
    ("BR",     "android"): 0.156,   # 0.14×
    ("MX",     "ios"):     0.240,   # 0.22×
    ("MX",     "android"): 0.163,   # 0.15×
    ("ID",     "ios"):     0.163,   # 0.15×
    ("ID",     "android"): 0.067,   # 0.06×
    ("others", "ios"):     0.420,   # 0.39×
    ("others", "android"): 0.228,   # 0.21×
}

# Higher-CPI channels attract higher-monetizing users
CHANNEL_ARPDAU_MULT = {
    "facebook": 1.30,
    "admob":    1.10,
    "organic":  1.05,
    "moloco":   0.90,
    "vungle":   0.65,
}


# ── Engagement tiers (Scenario 7) ────────────────────────────────────────────

# Engagement tier: based on games completed in first 7 days post-install
# "low"    = 0-2 completions
# "medium" = 3-4 completions
# "high"   = 5+  completions (the proposed new targeting threshold)
ENGAGEMENT_TIERS = ["low", "medium", "high"]

CHANNEL_ENGAGEMENT_DIST = {
    #              low    med    high
    "facebook": [0.30,  0.40,  0.30],  # current 3-game targeting → 30% high
    "admob":    [0.40,  0.38,  0.22],
    "moloco":   [0.45,  0.35,  0.20],
    "vungle":   [0.55,  0.32,  0.13],  # volume play → mostly low engagement
    "organic":  [0.25,  0.38,  0.37],  # word-of-mouth → most engaged
}

# Facebook with 5-game targeting: more engaged cohort, ~20% CPI premium
FACEBOOK_NEW_TARGETING_ENGAGEMENT_DIST = [0.15, 0.40, 0.45]

# Retention multiplier applied on top of channel × geo base retention
ENGAGEMENT_RETENTION_MULT = {
    "low":    0.40,   # 0-2 games: churn fast
    "medium": 0.90,   # 3-4 games: close to baseline
    "high":   1.85,   # 5+ games: nearly 2× baseline retention
}

# ARPDAU multiplier — engaged players watch more ads
ENGAGEMENT_ARPDAU_MULT = {
    "low":    0.65,
    "medium": 0.95,
    "high":   1.40,
}


# ── Geography (Scenario 6) ──────────────────────────────────────────────────────

# Emerging geos: bi-phasic curve — promising D7–D14, crashes after D14
# D14 LTV overshoots D90 LTV by ~30–40% relative to mature markets
EMERGING_GEOS = {"IN", "BR", "ID", "MX"}

ALL_COUNTRIES = ["US", "GB", "DE", "CA", "FR", "IN", "BR", "MX", "ID", "others"]

PLATFORM_IOS_PROB = {
    "US": 0.55, "GB": 0.52, "CA": 0.54, "DE": 0.45, "FR": 0.45,
    "IN": 0.05, "BR": 0.10, "MX": 0.15, "ID": 0.08, "others": 0.20,
}

COUNTRY_WEIGHTS_PAID = {
    "US": 0.25, "IN": 0.20, "BR": 0.13, "DE": 0.07, "GB": 0.07,
    "CA": 0.05, "FR": 0.04, "MX": 0.06, "ID": 0.06, "others": 0.07,
}
COUNTRY_WEIGHTS_ORGANIC = {
    "US": 0.22, "IN": 0.22, "BR": 0.14, "DE": 0.06, "GB": 0.06,
    "CA": 0.04, "FR": 0.04, "MX": 0.07, "ID": 0.07, "others": 0.08,
}


# ── Monthly spend (Scenario 3) ───────────────────────────────────────────────────

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


# ── Devices ─────────────────────────────────────────────────────────────────────

IOS_DEVICES = [
    "iPhone 12", "iPhone 13", "iPhone 14", "iPhone 15",
    "iPhone 13 Pro", "iPhone 14 Pro", "iPad Air", "iPad Pro",
]
ANDROID_DEVICES = [
    "Samsung Galaxy S21", "Samsung Galaxy S22", "Samsung Galaxy S23",
    "Google Pixel 6", "Google Pixel 7", "Xiaomi Mi 11",
    "Oppo A74", "Vivo Y21", "OnePlus 9", "Realme 8",
]


# ── Ad networks ─────────────────────────────────────────────────────────────────

AD_FORMATS       = ["rewarded", "interstitial"]
AD_FORMAT_PROBS  = [0.60, 0.40]

AD_NETWORKS      = ["admob_network", "unity_ads", "ironsource", "applovin", "facebook_audience"]
AD_NETWORK_PROBS = [0.30, 0.25, 0.20, 0.15, 0.10]


# ── Platform fee ─────────────────────────────────────────────────────────────

# Net revenue = settled_revenue × (1 - platform_fee)
# Using 30% as a standardised mediation take-rate for finance demo purposes.
PLATFORM_FEE = {
    "ios":     0.30,
    "android": 0.30,
}


# ── Revenue periods ──────────────────────────────────────────────────────────────

REVENUE_PERIODS = [0, 1, 3, 7, 14, 30, 60, 90]


# Day-of-week CPI multipliers [Mon=0 … Sun=6]
# Weekday competition peaks Thu/Fri; weekend advertisers pull back
DOW_CPI_MULT = [0.97, 1.00, 1.03, 1.06, 1.12, 0.92, 0.88]

# Per-channel AR(1) noise σ (higher = more volatile CPI)
CHANNEL_CPI_VOLATILITY = {
    "facebook": 0.06,
    "admob":    0.10,
    "moloco":   0.12,
    "vungle":   0.15,
    "organic":  0.0,
}

# CPI geo × platform multiplier (relative to US iOS = 1.0)
# Derived from Facebook eCPI medians per country × OS in real MMP data (n≥5 rows),
# normalised to US iOS median ($0.912). The build_daily_cpi_series base values represent
# the US iOS reference; this multiplier scales them per (country, platform) at row level.
# Pattern: DE/GB/CA are premium markets (CPI > US); LATAM/APAC tier-3 are 10-45% of US.
# iOS vs Android: emerging markets show 2-4× iOS premium on CPI (scarce iOS inventory);
# premium markets iOS ≈ Android or slight iOS premium.
CPI_GEO_MULT: dict = {
    # Tier 1 — premium (CPI at or above US iOS baseline)
    ("US",     "ios"):     1.00,
    ("US",     "android"): 0.73,   # real: $0.667 / $0.912 = 0.73
    ("CA",     "ios"):     1.34,   # real: $1.219 / $0.912 = 1.34
    ("CA",     "android"): 1.17,   # real: $1.063 / $0.912 = 1.17
    ("GB",     "ios"):     1.40,   # real: $1.276 / $0.912 = 1.40
    ("GB",     "android"): 0.67,   # real: $0.607 / $0.912 = 0.67
    # Tier 2 — mature European markets
    ("DE",     "ios"):     1.51,   # real: $1.380 / $0.912 = 1.51
    ("DE",     "android"): 0.98,   # real: $0.896 / $0.912 = 0.98
    ("FR",     "ios"):     0.92,   # real: $0.843 / $0.912 = 0.92
    ("FR",     "android"): 0.44,   # real: $0.399 / $0.912 = 0.44
    # Tier 3 — emerging markets (low absolute CPI; large iOS/Android spread)
    ("BR",     "ios"):     0.45,   # real: $0.412 / $0.912 = 0.45
    ("BR",     "android"): 0.19,   # real: $0.170 / $0.912 = 0.19
    ("MX",     "ios"):     0.43,   # real: $0.393 / $0.912 = 0.43
    ("MX",     "android"): 0.22,   # real: $0.202 / $0.912 = 0.22
    ("IN",     "ios"):     0.11,   # real: $0.102 / $0.912 = 0.11
    ("IN",     "android"): 0.09,   # real: $0.078 / $0.912 = 0.09
    ("ID",     "ios"):     0.46,   # real: $0.419 / $0.912 = 0.46
    ("ID",     "android"): 0.11,   # real: $0.103 / $0.912 = 0.11
    # Fallback
    ("others", "ios"):     0.50,
    ("others", "android"): 0.22,
}


# ─────────────────────────────────────────────────────────────────────────────────
# Core math
# ─────────────────────────────────────────────────────────────────────────────────

def month_key(d: date) -> str:
    return d.strftime("%Y-%m")


def week_key(d: date) -> str:
    return d.strftime("%G-W%V")


def get_arpdau(country: str, platform: str, channel: str) -> float:
    base = ARPDAU_BASE.get(
        (country, platform),
        ARPDAU_BASE.get(("others", platform), 0.018),
    )
    return base * CHANNEL_ARPDAU_MULT[channel]


def retention_scalar(d: int, d30: float, is_emerging: bool) -> float:
    """Scalar retention probability at day d for a segment."""
    if d == 0:
        return 1.0
    if is_emerging:
        if d <= 14:
            return min(d30 * (30.0 / d) ** 0.55, 1.0)
        ret14 = d30 * (30.0 / 14) ** 0.55
        return min(ret14 * (14.0 / d) ** 1.8, 1.0)
    return min(d30 * (30.0 / d) ** 0.65, 1.0)


def cumulative_ltv(arpdau: float, d30: float, is_emerging: bool, up_to_day: int) -> float:
    """Cumulative LTV from D0 through up_to_day."""
    return sum(arpdau * retention_scalar(d, d30, is_emerging) for d in range(up_to_day + 1))


def build_retention_matrix(
    d30_arr: np.ndarray,          # (N,)
    ch_mult_arr: np.ndarray,      # (N,)
    geo_mult_arr: np.ndarray,     # (N,) geo × platform retention multiplier
    is_emerging_arr: np.ndarray,  # (N,) bool
    n_days: int,
) -> np.ndarray:
    """
    Vectorized retention matrix shape (N, n_days).
    retention[u, d] = probability user u is active on day d post-install.
    Effective D30 = d30_base × channel_mult × geo_platform_mult.
    """
    N = len(d30_arr)
    days = np.arange(n_days, dtype=float)  # (n_days,)

    # Effective D30 per user (N, 1) — now includes geo × platform multiplier
    eff_d30 = (d30_arr * ch_mult_arr * geo_mult_arr)[:, np.newaxis]  # (N, 1)

    # Standard power law: ret = d30 * (30/d)^0.65, d=0 → 1.0
    with np.errstate(divide="ignore", invalid="ignore"):
        day_factor = np.where(days == 0, 1.0, (30.0 / np.maximum(days, 1e-9)) ** 0.65)  # (n_days,)
    standard_ret = eff_d30 * day_factor[np.newaxis, :]  # (N, n_days)

    # Emerging geo: bi-phasic
    # Phase 1 (d<=14): power 0.55
    # Phase 2 (d>14):  ret14 * (14/d)^1.8
    with np.errstate(divide="ignore", invalid="ignore"):
        day_factor_55 = np.where(days == 0, 1.0, (30.0 / np.maximum(days, 1e-9)) ** 0.55)
    phase1_ret = eff_d30 * day_factor_55[np.newaxis, :]  # (N, n_days)

    ret14_per_user = eff_d30 * (30.0 / 14) ** 0.55  # (N, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        day_factor_18 = np.where(days <= 14, 1.0, (14.0 / np.maximum(days, 1e-9)) ** 1.8)
    phase2_ret = ret14_per_user * day_factor_18[np.newaxis, :]

    emerging_ret = np.where(days[np.newaxis, :] <= 14, phase1_ret, phase2_ret)

    # Select based on is_emerging flag
    ret = np.where(is_emerging_arr[:, np.newaxis], emerging_ret, standard_ret)
    ret = np.clip(ret, 0.0, 1.0)
    ret[:, 0] = 1.0  # D0 always active
    return ret


def build_daily_cpi_series(rng: np.random.Generator) -> dict:
    """
    Pre-generate daily CPI per channel using AR(1) autocorrelated noise.

    Models realistic UA auction dynamics:
    - Gradual upward drift (+15% Aug→Feb as market competition grows)
    - Day-of-week effect (Thu/Fri peak, Sat/Sun trough)
    - Spend-level correlation (higher monthly spend → higher CPIs via auction pressure)
    - AR(1) noise: ε_t = 0.7*ε_{t-1} + σ*N(0,1) per channel (correlated daily movement)

    Returns dict: {(channel, date): cpi_value}
    """
    avg_spend = sum(MONTHLY_SPEND.values()) / len(MONTHLY_SPEND)
    n = TOTAL_DAYS
    AR_PHI = 0.7

    series = {}

    for channel in CHANNELS:
        base = CHANNEL_CPI[channel]
        if base == 0.0:
            for d in ALL_DATES:
                series[(channel, d)] = 0.0
            continue

        sigma = CHANNEL_CPI_VOLATILITY[channel]
        epsilon = 0.0  # AR(1) state

        for i, d in enumerate(ALL_DATES):
            # 1. Linear upward trend: +15% over the full period (auction competition)
            trend = 1.0 + 0.15 * i / max(n - 1, 1)

            # 2. (no seasonal adjustment — competition modeled via linear trend)

            # 3. Day-of-week
            dow_mult = DOW_CPI_MULT[d.weekday()]

            # 4. Spend pressure: higher-spend months → higher CPIs
            mk = month_key(d)
            month_spend = MONTHLY_SPEND.get(mk, avg_spend)
            # Maps spend ratio to [0.88, 1.12] range
            spend_ratio = month_spend / avg_spend
            spend_mult = 0.88 + 0.24 * min(max((spend_ratio - 0.5) / 1.0, 0.0), 1.0)

            # 5. AR(1) autocorrelated noise (log-space so CPI stays positive)
            epsilon = AR_PHI * epsilon + sigma * float(rng.standard_normal())
            noise_mult = np.exp(epsilon)

            cpi = base * trend * dow_mult * spend_mult * noise_mult
            series[(channel, d)] = max(0.50, round(float(cpi), 2))

    return series


# ─────────────────────────────────────────────────────────────────────────────────
# Table generators
# ─────────────────────────────────────────────────────────────────────────────────

def gen_installs(scale: float, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate installs table.
    ~300K rows at scale=1.0, ~30K at scale=0.1.
    """
    target = max(1, int(FULL_SCALE_USERS * scale))
    print(f"  Target users: {target:,}  (scale={scale})")

    # Build daily date weights proportional to daily UA spend
    date_month_keys = [month_key(d) for d in ALL_DATES]
    month_days = {}
    for mk in set(date_month_keys):
        y, m = int(mk[:4]), int(mk[5:])
        month_days[mk] = calendar.monthrange(y, m)[1]

    daily_spend = np.array([
        MONTHLY_SPEND.get(mk, 0) / month_days.get(mk, 1)
        for mk in date_month_keys
    ], dtype=float)
    paid_date_weights = daily_spend / daily_spend.sum()

    # Organic install dates: 50/50 blend of spend-weighted and uniform
    organic_date_weights = paid_date_weights * 0.5 + np.ones(TOTAL_DAYS) / TOTAL_DAYS * 0.5
    organic_date_weights /= organic_date_weights.sum()

    n_paid    = int(target * 0.65)
    n_organic = target - n_paid

    country_list        = ALL_COUNTRIES
    country_list_arr    = np.array(country_list)
    w_paid_arr          = np.array([COUNTRY_WEIGHTS_PAID[c] for c in country_list], dtype=float)
    w_paid_arr         /= w_paid_arr.sum()
    w_organic_arr       = np.array([COUNTRY_WEIGHTS_ORGANIC[c] for c in country_list], dtype=float)
    w_organic_arr      /= w_organic_arr.sum()

    date_arr = np.array(ALL_DATES)

    channels_col: list = []
    dates_col:    list = []
    countries_col: list = []
    platforms_col: list = []
    devices_col:   list = []
    fraud_flag_col: list = []
    fraud_rate_col: list = []
    engagement_col: list = []
    new_targeting_col: list = []

    # ── Paid channels ──
    for channel, vol_share in CHANNEL_PAID_VOL_SHARE.items():
        n = int(n_paid * vol_share)
        if n == 0:
            continue

        date_idx  = rng.choice(TOTAL_DAYS, size=n, p=paid_date_weights)
        countries = rng.choice(country_list_arr, size=n, p=w_paid_arr)
        ios_p     = np.array([PLATFORM_IOS_PROB.get(c, 0.20) for c in countries])
        is_ios    = rng.random(n) < ios_p
        platforms = np.where(is_ios, "ios", "android")

        ios_devs     = rng.choice(IOS_DEVICES,     size=n)
        android_devs = rng.choice(ANDROID_DEVICES, size=n)
        devices = np.where(is_ios, ios_devs, android_devs)

        lo, hi    = CHANNEL_FRAUD_RANGE[channel]
        f_rates   = rng.uniform(lo, hi, size=n)
        f_flags   = rng.random(n) < f_rates

        channels_col.extend([channel] * n)
        dates_col.extend(date_arr[date_idx].tolist())
        countries_col.extend(countries.tolist())
        platforms_col.extend(platforms.tolist())
        devices_col.extend(devices.tolist())
        fraud_flag_col.extend(f_flags.tolist())
        fraud_rate_col.extend(f_rates.tolist())

        # Engagement tier
        dist = CHANNEL_ENGAGEMENT_DIST.get(channel, [0.40, 0.40, 0.20])
        eng_choices = rng.choice(ENGAGEMENT_TIERS, size=n, p=dist)

        # is_new_targeting: True for Facebook users installed on/after 2026-01-01
        if channel == "facebook":
            new_targ_dates = date_arr[date_idx]
            is_new_targ = np.array(
                [d >= date(2026, 1, 1) for d in new_targ_dates], dtype=bool
            )
            # Override engagement for new-targeting users
            for j in range(n):
                if is_new_targ[j]:
                    eng_choices[j] = rng.choice(
                        ENGAGEMENT_TIERS, p=FACEBOOK_NEW_TARGETING_ENGAGEMENT_DIST
                    )
        else:
            is_new_targ = np.zeros(n, dtype=bool)

        engagement_col.extend(eng_choices.tolist())
        new_targeting_col.extend(is_new_targ.tolist())

    # ── Organic ──
    n = n_organic
    date_idx  = rng.choice(TOTAL_DAYS, size=n, p=organic_date_weights)
    countries = rng.choice(country_list_arr, size=n, p=w_organic_arr)
    ios_p     = np.array([PLATFORM_IOS_PROB.get(c, 0.20) for c in countries])
    is_ios    = rng.random(n) < ios_p
    platforms = np.where(is_ios, "ios", "android")
    ios_devs     = rng.choice(IOS_DEVICES,     size=n)
    android_devs = rng.choice(ANDROID_DEVICES, size=n)
    devices = np.where(is_ios, ios_devs, android_devs)
    lo, hi    = CHANNEL_FRAUD_RANGE["organic"]
    f_rates   = rng.uniform(lo, hi, size=n)
    f_flags   = rng.random(n) < f_rates
    channels_col.extend(["organic"] * n)
    dates_col.extend(date_arr[date_idx].tolist())
    countries_col.extend(countries.tolist())
    platforms_col.extend(platforms.tolist())
    devices_col.extend(devices.tolist())
    fraud_flag_col.extend(f_flags.tolist())
    fraud_rate_col.extend(f_rates.tolist())
    dist_org = CHANNEL_ENGAGEMENT_DIST.get("organic", [0.25, 0.38, 0.37])
    eng_choices_org = rng.choice(ENGAGEMENT_TIERS, size=n, p=dist_org)
    engagement_col.extend(eng_choices_org.tolist())
    new_targeting_col.extend([False] * n)

    total = len(channels_col)
    shuffled = rng.permutation(total)

    df = pd.DataFrame({
        "user_id":       [f"u_{i:08d}" for i in range(total)],
        "install_date":  pd.to_datetime([dates_col[i] for i in shuffled]),
        "channel":       [channels_col[i]  for i in shuffled],
        "platform":      [platforms_col[i] for i in shuffled],
        "country":       [countries_col[i] for i in shuffled],
        "device_model":  [devices_col[i]   for i in shuffled],
        "is_fraud":      [bool(fraud_flag_col[i]) for i in shuffled],
        "fraud_rate":    [round(float(fraud_rate_col[i]), 4) for i in shuffled],
        "engagement_tier":  [engagement_col[i]     for i in shuffled],
        "is_new_targeting": [bool(new_targeting_col[i]) for i in shuffled],
    })

    df["install_week"]  = df["install_date"].dt.strftime("%G-W%V")
    df["install_month"] = df["install_date"].dt.strftime("%Y-%m")

    print(f"  Generated {len(df):,} install records")
    return df


def gen_sessions(installs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate sessions table using vectorized retention sampling.

    Active status for each (user, day) sampled from retention curve.
    Fraud users generate sessions too (impression stuffing model).
    ~1.2M rows at scale=1.0, ~120K at scale=0.1.
    """
    N = len(installs)
    n_days = SESSION_DAYS + 1  # D0–D30

    print(f"  Building retention matrix ({N:,} × {n_days})...")

    # Per-user retention parameters
    d30_arr   = np.array([D30_RETENTION.get(m, 0.020) for m in installs["install_month"]], dtype=float)
    ch_mult   = np.array([CHANNEL_RETENTION_MULT[c] for c in installs["channel"]], dtype=float)
    geo_mult  = np.array([
        GEO_RETENTION_MULT.get(
            (c, p),
            GEO_RETENTION_MULT.get(("others", p), 0.65),
        )
        for c, p in zip(installs["country"], installs["platform"])
    ], dtype=float)
    is_emerg  = np.array([c in EMERGING_GEOS for c in installs["country"]], dtype=bool)
    eng_mult  = np.array(
        [ENGAGEMENT_RETENTION_MULT.get(t, 1.0) for t in installs["engagement_tier"]],
        dtype=float,
    )

    ret_matrix = build_retention_matrix(d30_arr, ch_mult * eng_mult, geo_mult, is_emerg, n_days)

    # Sample active days: Bernoulli(p) per (user, day)
    rand_matrix  = rng.random(ret_matrix.shape)
    active_matrix = rand_matrix < ret_matrix
    active_matrix[:, 0] = True  # D0 always active

    # Filter out sessions that would fall after END_DATE
    install_dates_np = installs["install_date"].values.astype("datetime64[D]")
    max_day_per_user = np.array(
        [(END_DATE - d.astype("M8[D]").astype(date)).days for d in install_dates_np],
        dtype=int,
    )
    day_indices_grid = np.arange(n_days)[np.newaxis, :]  # (1, n_days)
    in_range_mask    = day_indices_grid <= max_day_per_user[:, np.newaxis]
    active_matrix   &= in_range_mask

    # (user_idx, day) pairs where active
    user_idx, day_idx = np.where(active_matrix)
    n_sessions = len(user_idx)
    print(f"  Sampling {n_sessions:,} sessions...")

    # Per-user ARPDAU
    arpdau_arr = np.array(
        [get_arpdau(r.country, r.platform, r.channel) for r in installs.itertuples()],
        dtype=float,
    )
    eng_arpdau_mult = np.array(
        [ENGAGEMENT_ARPDAU_MULT.get(t, 1.0) for t in installs["engagement_tier"]],
        dtype=float,
    )
    arpdau_arr = arpdau_arr * eng_arpdau_mult
    arpdau_active = arpdau_arr[user_idx]

    # Revenue per session (fraud users: reported revenue present, settled=0 handled in impressions)
    noise       = rng.normal(0.0, 0.3, n_sessions)
    ad_revenue  = np.maximum(0.0, arpdau_active * (1.0 + noise))

    # Session metadata
    duration  = np.maximum(1, rng.lognormal(3.5, 0.7, n_sessions)).astype(int)
    level_tried   = rng.integers(1, 51, size=n_sessions)
    completed_flag = rng.random(n_sessions) < 0.75
    level_done     = np.where(completed_flag, level_tried, np.maximum(1, level_tried - 1))

    install_dates_active = install_dates_np[user_idx]
    day_offsets          = day_idx.astype("timedelta64[D]")
    session_dates        = (install_dates_active + day_offsets).astype("datetime64[ms]")

    df = pd.DataFrame({
        "session_id":            [f"s_{i:010d}" for i in range(n_sessions)],
        "user_id":               installs["user_id"].values[user_idx],
        "session_date":          pd.to_datetime(session_dates),
        "install_date":          pd.to_datetime(install_dates_active),
        "install_week":          installs["install_week"].values[user_idx],
        "install_month":         installs["install_month"].values[user_idx],
        "channel":               installs["channel"].values[user_idx],
        "platform":              installs["platform"].values[user_idx],
        "country":               installs["country"].values[user_idx],
        "days_from_install":     day_idx,
        "session_duration_mins": duration,
        "level_reached":         level_tried,
        "level_completed":       level_done,
        "ad_revenue":            np.round(ad_revenue, 6),
        "is_fraud":              installs["is_fraud"].values[user_idx],
    })
    print(f"  Generated {len(df):,} session records")
    return df


def gen_ad_impressions(sessions: pd.DataFrame, installs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate ad impression events.

    Each session produces 2–4 impression records.
    Fraud users: reported_revenue > 0, settled_revenue = 0 (impression stuffing).
    ~2.5M rows at scale=1.0, ~250K at scale=0.1.
    """
    n_s = len(sessions)
    imps_per_session = rng.integers(2, 5, size=n_s)  # 2, 3, or 4
    rep_idx = np.repeat(np.arange(n_s), imps_per_session)
    n_imp = len(rep_idx)
    print(f"  Expanding {n_s:,} sessions → {n_imp:,} impression events...")

    # Revenue per impression: split session revenue evenly + noise
    session_rev = sessions["ad_revenue"].values
    base_rev    = session_rev[rep_idx] / imps_per_session[rep_idx]
    noise       = rng.normal(0.0, 0.10, n_imp)
    impression_rev = np.maximum(0.0, base_rev * (1.0 + noise))

    # Fraud users: settled_revenue = 0
    is_fraud       = sessions["is_fraud"].values[rep_idx]
    settled_rev    = np.where(is_fraud, 0.0, impression_rev)
    platforms_for_fee = sessions["platform"].values[rep_idx]
    fee_arr = np.array([PLATFORM_FEE.get(p, 0.30) for p in platforms_for_fee])
    net_rev = settled_rev * (1.0 - fee_arr)

    channels = sessions["channel"].values[rep_idx]
    fraud_rate_col = np.array([CHANNEL_FRAUD_MID[ch] for ch in channels])

    # Timestamps: session_date + uniform offset within the day
    session_dates_ns = sessions["session_date"].values.astype("datetime64[s]")[rep_idx]
    hour_offset       = rng.integers(0, 86400, size=n_imp).astype("timedelta64[s]")
    timestamps        = (session_dates_ns + hour_offset).astype("datetime64[ms]")

    ad_formats  = rng.choice(AD_FORMATS,   size=n_imp, p=AD_FORMAT_PROBS)
    ad_networks = rng.choice(AD_NETWORKS,  size=n_imp, p=AD_NETWORK_PROBS)

    df = pd.DataFrame({
        "record_id":       [f"imp_{i:012d}" for i in range(n_imp)],
        "ts":              pd.to_datetime(timestamps),
        "user_id":         sessions["user_id"].values[rep_idx],
        "session_id":      sessions["session_id"].values[rep_idx],
        "channel":         channels,
        "platform":        sessions["platform"].values[rep_idx],
        "country":         sessions["country"].values[rep_idx],
        "ad_format":       ad_formats,
        "ad_platform":     ad_networks,
        "revenue":         np.round(impression_rev, 6),
        "fraud_rate":      np.round(fraud_rate_col, 4),
        "settled_revenue": np.round(settled_rev, 6),
        "net_revenue":     np.round(net_rev, 6),
        "install_week":    sessions["install_week"].values[rep_idx],
        "install_month":   sessions["install_month"].values[rep_idx],
    })
    print(f"  Generated {len(df):,} ad impression records")
    return df


def gen_revenue(installs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate cohort-level revenue table (MMP-style, independently from sessions).

    One row per (cohort_date, channel, country, platform, days_from_cohort).
    Scenarios:
      1. CPI↔LTV: D60 LTV monotonically increases with CPI across channels
      3. Cohort accounting: first-month cohort has large projected D180 LTV
      4. Model staleness: D30 retention decreases monotonically Feb→Nov
      6. Geo risk: IN/BR D14 LTV looks good; D90 crashes relative to projection
    """
    print(f"  Building cohort-level revenue table...")

    # Group installs by (cohort_date, channel, country, platform)
    grp = (
        installs
        .groupby(["install_date", "channel", "country", "platform"], observed=True)
        .size()
        .reset_index(name="cohort_installs")
    )

    rows = []
    for _, g in grp.iterrows():
        cohort_date  = g["install_date"].date() if hasattr(g["install_date"], "date") else g["install_date"]
        channel      = g["channel"]
        country      = g["country"]
        platform     = g["platform"]
        cohort_size  = int(g["cohort_installs"])
        install_month = month_key(cohort_date)
        install_week  = week_key(cohort_date)

        if install_month not in D30_RETENTION:
            continue

        geo_ret_mult = GEO_RETENTION_MULT.get(
            (country, platform),
            GEO_RETENTION_MULT.get(("others", platform), 0.65),
        )
        geo_cpi_mult = CPI_GEO_MULT.get(
            (country, platform),
            CPI_GEO_MULT.get(("others", platform), 0.22),
        )
        d30_base  = D30_RETENTION[install_month] * CHANNEL_RETENTION_MULT[channel] * geo_ret_mult
        is_emerg  = country in EMERGING_GEOS
        arpdau    = get_arpdau(country, platform, channel)
        cpi       = CHANNEL_CPI[channel] * geo_cpi_mult  # geo-adjusted CPI for ROI

        # Compute cumulative LTV at each revenue period
        cum_ltv_cache = {}
        running = 0.0
        long_tail_mult = LONG_TAIL_MULT.get(install_month, 1.0)
        for d in range(max(REVENUE_PERIODS) + 1):
            daily = arpdau * retention_scalar(d, d30_base, is_emerg)
            if d > 7:
                daily *= long_tail_mult
            running += daily
            if d in REVENUE_PERIODS:
                cum_ltv_cache[d] = running

        # D90 LTV for ROI denominators
        d90_ltv = cum_ltv_cache.get(90, running)

        days_elapsed = (END_DATE - cohort_date).days

        for period_day in REVENUE_PERIODS:
            # Mark whether this period has actually elapsed for the cohort
            is_observed = period_day <= days_elapsed
            # Do NOT skip — always generate all REVENUE_PERIODS as model projections

            ret      = retention_scalar(period_day, d30_base, is_emerg)
            retained = max(0, int(cohort_size * ret))
            arpu     = arpdau * ret  # revenue per installed user on this specific day
            total_arpu = cum_ltv_cache.get(period_day, 0.0)  # cumulative LTV to this day

            roi       = total_arpu / cpi if cpi > 0 else 0.0
            total_roi = d90_ltv / cpi    if cpi > 0 else 0.0

            # Projected D180 LTV: only meaningful at D90 row
            # Emerging geos project ~2% more past D90 (already largely churned)
            # Mature geos project ~12% more (durable tail)
            if period_day == 90:
                proj_d180 = d90_ltv * (1.02 if is_emerg else 1.12)
            else:
                proj_d180 = None

            rows.append({
                "cohort_date":       cohort_date,
                "install_week":      install_week,
                "install_month":     install_month,
                "channel":           channel,
                "country":           country,
                "platform":          platform,
                "os":                platform,
                "days_from_cohort":  period_day,
                "period":            f"D{period_day}",
                "cohort_installs":   cohort_size,
                "retained_users":    retained,
                "retention_rate":    round(ret, 6),
                "arpu":              round(arpu, 6),        # revenue per installed user today
                "total_arpu":        round(total_arpu, 6),  # cumulative LTV to this day
                "arpdau":            round(arpdau, 6),       # per daily active (constant)
                "roi":               round(roi, 4),
                "total_roi":         round(total_roi, 4),
                "projected_d180_ltv": round(proj_d180, 6) if proj_d180 is not None else None,
                "is_observed":       is_observed,           # True if period has actually elapsed
                "days_elapsed":      days_elapsed,          # days since cohort install date
            })

    df = pd.DataFrame(rows)
    # cohort_date kept as datetime.date → date32 in parquet (no 00:00:00 clutter)
    print(f"  Generated {len(df):,} revenue cohort records")
    return df


def gen_campaign(installs: pd.DataFrame, daily_cpi: dict, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate daily campaign spend table.

    One row per (cohort_date, channel, country, os) with spend derived from
    monthly budget + CPI-implied installs. Scenario 3: monthly totals enforce
    the spend >> closed revenue gap visible to Finance.
    """
    _daily_cpi_series = daily_cpi
    print(f"  Building campaign spend table...")

    paid = installs[installs["channel"] != "organic"].copy()
    grp = (
        paid
        .groupby(["install_date", "channel", "country", "platform"], observed=True)
        .size()
        .reset_index(name="installs")
    )

    rows = []
    for _, g in grp.iterrows():
        install_date = g["install_date"].date() if hasattr(g["install_date"], "date") else g["install_date"]
        channel   = g["channel"]
        country   = g["country"]
        platform  = g["platform"]
        n_installs = int(g["installs"])

        if n_installs == 0:
            continue

        mk = month_key(install_date)
        if mk not in MONTHLY_SPEND:
            continue

        # Geo × platform CPI multiplier (derived from real MMP data)
        geo_cpi_mult = CPI_GEO_MULT.get(
            (country, platform),
            CPI_GEO_MULT.get(("others", platform), 0.22),
        )
        geo_ret_mult = GEO_RETENTION_MULT.get(
            (country, platform),
            GEO_RETENTION_MULT.get(("others", platform), 0.65),
        )

        # Use pre-generated daily CPI (AR(1) with trend, Q4, DOW, spend pressure)
        # scaled by geo × platform multiplier
        cpi_actual = _daily_cpi_series.get((channel, install_date), CHANNEL_CPI[channel]) * geo_cpi_mult
        cpi        = CHANNEL_CPI[channel] * geo_cpi_mult   # geo-adjusted base CPI for ROI
        cost       = n_installs * cpi_actual

        # Derive ecpm from daily spend and simulated impression volume
        # impressions = clicks / ctr; ctr ≈ 1%; clicks = installs / cti; cti ≈ 15%
        clicks      = max(1, int(n_installs / 0.15))  # click-to-install ~15%
        impressions = max(1, int(clicks / 0.01))       # CTR ~1%
        ecpm        = cost / impressions * 1000

        install_month = mk
        d30_base  = D30_RETENTION.get(install_month, 0.020) * CHANNEL_RETENTION_MULT[channel] * geo_ret_mult
        is_emerg  = country in EMERGING_GEOS
        arpdau    = get_arpdau(country, platform, channel)
        d90_ltv   = cumulative_ltv(arpdau, d30_base, is_emerg, 90)
        roi_d90   = d90_ltv / cpi if cpi > 0 else 0.0

        rows.append({
            "cohort_date":  install_date,
            "channel":      channel,
            "country":      country,
            "os":           platform,
            "cost":         round(cost, 2),
            "installs":     n_installs,
            "impressions":  impressions,
            "clicks":       clicks,
            "cpi":          round(cpi_actual, 2),
            "ecpm":         round(ecpm, 2),
            "arpdau":       round(arpdau, 6),
            "roi":          round(roi_d90, 4),
        })

    df = pd.DataFrame(rows)
    # Keep cohort_date as datetime.date → PyArrow writes as date32 (DATE, not TIMESTAMP)
    # This prevents "2025-02-10 00:00:00" clutter on chart axes
    print(f"  Generated {len(df):,} campaign records")
    return df


# ─────────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────────

def write_parquet(df: pd.DataFrame, path: Path, name: str) -> None:
    """Write DataFrame to parquet with progress reporting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df)
    pq.write_table(table, path, compression="snappy")
    mb = path.stat().st_size / 1_048_576
    print(f"  ✓ {name}: {len(df):,} rows → {path.name} ({mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Generate GameRamp synthetic dataset")
    parser.add_argument("--scale",  type=float, default=0.1,
                        help="Fraction of full 300K-user dataset (0.01–1.0, default 0.1)")
    parser.add_argument("--seed",   type=int,   default=42,
                        help="Random seed for reproducibility (default 42)")
    parser.add_argument("--output", type=str,   default="data/parquet/gamerampv2",
                        help="Output directory for parquet files")
    args = parser.parse_args()

    if not (0.001 <= args.scale <= 1.0):
        print("Error: --scale must be between 0.001 and 1.0", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(args.seed)
    print(f"\GameRamp synthetic dataset generator")
    print(f"Scale={args.scale}, seed={args.seed}, output={out_dir}\n")

    # Pre-generate daily CPI series (AR(1) with trend, Q4, DOW, spend pressure)
    print("Pre-computing daily CPI series...")
    daily_cpi = build_daily_cpi_series(rng)

    # 1. Installs
    print("\n1/5  installs")
    installs = gen_installs(args.scale, rng)
    write_parquet(installs, out_dir / "installs.parquet", "installs")

    # 2. Sessions
    print("\n2/5  sessions")
    sessions = gen_sessions(installs, rng)
    write_parquet(sessions, out_dir / "sessions.parquet", "sessions")

    # 3. Ad impressions
    print("\n3/5  ad_impression_events")
    impressions = gen_ad_impressions(sessions, installs, rng)
    write_parquet(impressions, out_dir / "ad_impression_events.parquet", "ad_impression_events")

    # 4. Revenue (independent cohort-level table)
    print("\n4/5  revenue")
    revenue = gen_revenue(installs, rng)
    write_parquet(revenue, out_dir / "revenue.parquet", "revenue")

    # 5. Campaign
    print("\n5/5  campaign")
    campaign = gen_campaign(installs, daily_cpi, rng)
    write_parquet(campaign, out_dir / "campaign.parquet", "campaign")

    # Summary
    print("\n" + "=" * 60)
    print("Dataset summary:")
    print(f"  installs:             {len(installs):>10,}")
    print(f"  sessions:             {len(sessions):>10,}")
    print(f"  ad_impression_events: {len(impressions):>10,}")
    print(f"  revenue:              {len(revenue):>10,}")
    print(f"  campaign:             {len(campaign):>10,}")

    total_ua = campaign["cost"].sum()
    total_settled = impressions["settled_revenue"].sum()
    print(f"\nScenario checks (at scale={args.scale}):")
    print(f"  Total UA spend (all months): ${total_ua:,.0f}")
    print(f"  Total settled ad revenue:    ${total_settled:,.0f}")
    print(f"  Settled/Spend ratio:         {total_settled / total_ua:.2%}" if total_ua > 0 else "")

    # D30 retention check
    ret_check = (
        revenue[revenue["days_from_cohort"] == 30]
        .groupby("install_month")["retention_rate"]
        .mean()
        .sort_index()
    )
    print(f"\n  D30 retention decay (scenario 4):")
    for month, ret in ret_check.items():
        print(f"    {month}: {ret:.4f}")

    # Geo LTV overshoot check
    ltv_check = (
        revenue[revenue["days_from_cohort"].isin([14, 90])]
        .groupby(["country", "days_from_cohort"])["total_arpu"]
        .mean()
        .unstack("days_from_cohort")
        .rename(columns={14: "d14_ltv", 90: "d90_ltv"})
    )
    ltv_check["d14_vs_d90_ratio"] = ltv_check["d14_ltv"] / ltv_check["d90_ltv"].replace(0, float("nan"))
    print(f"\n  Geo D14 vs D90 LTV overshoot (scenario 6):")
    for country, row in ltv_check.iterrows():
        marker = " ← emerging overshoot" if country in EMERGING_GEOS else ""
        print(f"    {country:8s}: D14={row.get('d14_ltv', 0):.4f}  D90={row.get('d90_ltv', 0):.4f}  ratio={row.get('d14_vs_d90_ratio', 0):.2f}{marker}")

    print(f"\nAll files written to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
