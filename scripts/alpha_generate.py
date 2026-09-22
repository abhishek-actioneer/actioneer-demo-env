#!/usr/bin/env python3
"""
alpha_generate.py — Synthetic Alpha dataset generator

Alpha — Western-market racing game
~10.3M installs, Jan 1 2026 – Jun 30 2026

Usage:
  python3 scripts/alpha_generate.py [--scale FLOAT] [--seed INT] [--output DIR]

  --scale  Multiplier on base 4x installs (0.001–1.0), default 1.0
  --seed   Random seed for reproducibility, default 42
  --output Output directory, default data/parquet/alpha

Six engineered scenarios:
  1. CPI↔LTV correlation: Apple Search Ads ($6.80 CPI) → D90 LTV ~$5.60; positive correlation
  2. Fraud/settlement gap: Facebook ~10.5%, Google UAC ~4%, Apple Search Ads ~0.5%
  3. New targeting A/B: Facebook Jan+ is_new_targeting=True → +18% D30 retention
  4. Stale LTV model: D30 retention decays Jan 18% → Jun 11.4% (37% decline)
  5. iOS/Android ARPDAU split: iOS 1.5–1.8x Android; iOS revenue 72% IAP
  6. Geo expansion risk: BR/MX D14/D90 LTV ratio ~0.68 vs US/UK ~0.44

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

DATASET_ID = "alpha"
START_DATE = date(2026, 1, 1)
END_DATE   = date(2026, 6, 30)
NUM_MONTHS = 6

# Base monthly install volume (BQ July 2025 × 4× scale)
BASE_MONTHLY_INSTALLS = 429_507 * 4  # ~1,718,028 per month at scale=1.0

# Monthly ramp-up: +5% per month from Jan to Jun
MONTHLY_RAMP = {
    "2026-01": 1.00,
    "2026-02": 1.05,
    "2026-03": 1.10,
    "2026-04": 1.15,
    "2026-05": 1.20,
    "2026-06": 1.25,
}

REVENUE_PERIODS = [0, 1, 3, 7, 14, 30, 60, 90]


# ── Platform distribution (Western-heavy) ───────────────────────────────────────

# iOS probability by country (unlisted default: 0.40)
PLATFORM_IOS_PROB: dict = {
    "United States":  0.72,
    "United Kingdom": 0.68,
    "Germany":        0.62,
    "France":         0.60,
    "Japan":          0.75,
    "Canada":         0.70,
    "Australia":      0.71,
    "Brazil":         0.30,
    "Mexico":         0.28,
    "South Korea":    0.65,
    "Italy":          0.55,
    "Spain":          0.52,
    "Netherlands":    0.60,
    "Sweden":         0.63,
    "Turkey":         0.25,
}
PLATFORM_IOS_PROB_DEFAULT = 0.40


# ── Countries & weights ─────────────────────────────────────────────────────────

ALL_COUNTRIES = [
    "United States", "United Kingdom", "Germany", "France",
    "Brazil", "Canada", "Australia", "Japan",
    "Mexico", "South Korea", "Italy", "Spain",
    "Netherlands", "Sweden", "Turkey", "Other",
]

COUNTRY_WEIGHTS_PAID = {
    "United States":  0.12,
    "United Kingdom": 0.08,
    "Germany":        0.08,
    "France":         0.07,
    "Brazil":         0.06,
    "Canada":         0.05,
    "Australia":      0.04,
    "Japan":          0.04,
    "Mexico":         0.05,
    "South Korea":    0.04,
    "Italy":          0.04,
    "Spain":          0.04,
    "Netherlands":    0.03,
    "Sweden":         0.03,
    "Turkey":         0.04,
    "Other":          0.19,
}

COUNTRY_WEIGHTS_ORGANIC = {
    "United States":  0.14,
    "United Kingdom": 0.09,
    "Germany":        0.08,
    "France":         0.07,
    "Brazil":         0.07,
    "Canada":         0.05,
    "Australia":      0.04,
    "Japan":          0.05,
    "Mexico":         0.05,
    "South Korea":    0.04,
    "Italy":          0.04,
    "Spain":          0.04,
    "Netherlands":    0.03,
    "Sweden":         0.03,
    "Turkey":         0.04,
    "Other":          0.14,
}

# Emerging markets: bi-phasic retention curve
EMERGING_MARKET_COUNTRIES = {"Brazil", "Mexico", "Turkey", "Other"}


# ── UA Channels ─────────────────────────────────────────────────────────────────

CHANNELS = ["google_uac", "facebook_ads", "apple_search_ads", "organic"]

# ~30% paid installs (vs ~20% in gameramp)
PAID_INSTALL_FRACTION = 0.30

# Paid channel volume shares (android/ios mix determines apple_search_ads eligibility)
CHANNEL_PAID_VOL_SHARE = {
    "google_uac":       0.40,  # broad reach
    "facebook_ads":     0.35,
    "apple_search_ads": 0.25,  # iOS only
}

# CPI anchors (used in AR(1) daily series + for LTV projection)
CHANNEL_CPI_BASE_IOS = {
    "google_uac":       4.50,
    "facebook_ads":     5.20,
    "apple_search_ads": 6.80,
    "organic":          0.0,
}
CHANNEL_CPI_BASE_ANDROID = {
    "google_uac":  2.00,
    "facebook_ads": 2.50,
    "apple_search_ads": None,   # iOS only
    "organic":     0.0,
}

CHANNEL_FRAUD_RANGE = {
    "google_uac":       (0.02, 0.06),
    "facebook_ads":     (0.07, 0.14),
    "apple_search_ads": (0.00, 0.01),
    "organic":          (0.00, 0.02),
}


# ── Retention ───────────────────────────────────────────────────────────────────

# D30 base retention by install month (37% decay Jan→Jun — stale model signal)
D30_RETENTION_BY_MONTH = {
    "2026-01": 0.180,   # launch — new year spike, best cohorts
    "2026-02": 0.165,
    "2026-03": 0.152,
    "2026-04": 0.138,
    "2026-05": 0.125,
    "2026-06": 0.114,   # 37% decline — stale model signal
}

# Channel retention multiplier (higher CPI = better retained users)
CHANNEL_RETENTION_MULT = {
    "apple_search_ads": 1.35,
    "facebook_ads":     1.20,
    "google_uac":       1.05,
    "organic":          1.10,
}

# Geo × platform retention multiplier (relative to US IOS = 1.0)
GEO_RETENTION_MULT: dict = {
    ("United States",  "IOS"):     1.00,
    ("United States",  "ANDROID"): 0.82,
    ("United Kingdom", "IOS"):     0.88,
    ("United Kingdom", "ANDROID"): 0.72,
    ("Germany",        "IOS"):     0.82,
    ("Germany",        "ANDROID"): 0.67,
    ("France",         "IOS"):     0.76,
    ("France",         "ANDROID"): 0.60,
    ("Canada",         "IOS"):     0.92,
    ("Canada",         "ANDROID"): 0.76,
    ("Australia",      "IOS"):     0.90,
    ("Australia",      "ANDROID"): 0.74,
    ("Japan",          "IOS"):     0.95,
    ("Japan",          "ANDROID"): 0.78,
    ("Brazil",         "IOS"):     0.62,
    ("Brazil",         "ANDROID"): 0.52,
    ("Mexico",         "IOS"):     0.60,
    ("Mexico",         "ANDROID"): 0.50,
    ("South Korea",    "IOS"):     0.88,
    ("South Korea",    "ANDROID"): 0.72,
    ("Italy",          "IOS"):     0.74,
    ("Italy",          "ANDROID"): 0.60,
    ("Spain",          "IOS"):     0.72,
    ("Spain",          "ANDROID"): 0.58,
    ("Netherlands",    "IOS"):     0.80,
    ("Netherlands",    "ANDROID"): 0.65,
    ("Sweden",         "IOS"):     0.82,
    ("Sweden",         "ANDROID"): 0.67,
    ("Turkey",         "IOS"):     0.58,
    ("Turkey",         "ANDROID"): 0.46,
    ("Other",          "IOS"):     0.72,
    ("Other",          "ANDROID"): 0.58,
}

# Engagement tier retention multiplier
ENGAGEMENT_RETENTION_MULT = {
    "casual":      0.40,
    "competitive": 0.90,
    "hardcore":    1.85,
}

# Engagement ARPDAU multiplier
ENGAGEMENT_ARPDAU_MULT = {
    "casual":      0.65,
    "competitive": 0.95,
    "hardcore":    1.40,
}


# ── ARPDAU Base (Western-heavy, higher than gameramp) ───────────────────────────

ARPDAU_BASE: dict = {
    ("United States",  "IOS"):     0.55,
    ("United States",  "ANDROID"): 0.38,
    ("United Kingdom", "IOS"):     0.46,
    ("United Kingdom", "ANDROID"): 0.30,
    ("Germany",        "IOS"):     0.41,
    ("Germany",        "ANDROID"): 0.27,
    ("France",         "IOS"):     0.38,
    ("France",         "ANDROID"): 0.24,
    ("Canada",         "IOS"):     0.48,
    ("Canada",         "ANDROID"): 0.32,
    ("Australia",      "IOS"):     0.47,
    ("Australia",      "ANDROID"): 0.31,
    ("Japan",          "IOS"):     0.62,
    ("Japan",          "ANDROID"): 0.40,
    ("Brazil",         "IOS"):     0.18,
    ("Brazil",         "ANDROID"): 0.12,
    ("Mexico",         "IOS"):     0.16,
    ("Mexico",         "ANDROID"): 0.10,
    ("South Korea",    "IOS"):     0.52,
    ("South Korea",    "ANDROID"): 0.35,
    ("Italy",          "IOS"):     0.35,
    ("Italy",          "ANDROID"): 0.22,
    ("Spain",          "IOS"):     0.32,
    ("Spain",          "ANDROID"): 0.20,
    ("Netherlands",    "IOS"):     0.38,
    ("Netherlands",    "ANDROID"): 0.25,
    ("Sweden",         "IOS"):     0.42,
    ("Sweden",         "ANDROID"): 0.28,
    ("Turkey",         "IOS"):     0.14,
    ("Turkey",         "ANDROID"): 0.09,
    ("Other",          "IOS"):     0.22,
    ("Other",          "ANDROID"): 0.14,
}

CHANNEL_ARPDAU_MULT = {
    "apple_search_ads": 1.35,
    "facebook_ads":     1.20,
    "google_uac":       1.05,
    "organic":          1.10,
}


# ── CPI geo × platform multiplier ───────────────────────────────────────────────

CPI_GEO_MULT: dict = {
    ("United States",  "IOS"):     1.00,
    ("United States",  "ANDROID"): 0.44,
    ("United Kingdom", "IOS"):     1.40,
    ("United Kingdom", "ANDROID"): 0.67,
    ("Germany",        "IOS"):     1.51,
    ("Germany",        "ANDROID"): 0.98,
    ("France",         "IOS"):     0.92,
    ("France",         "ANDROID"): 0.44,
    ("Canada",         "IOS"):     1.34,
    ("Canada",         "ANDROID"): 1.17,
    ("Australia",      "IOS"):     1.28,
    ("Australia",      "ANDROID"): 0.82,
    ("Japan",          "IOS"):     1.45,
    ("Japan",          "ANDROID"): 0.95,
    ("Brazil",         "IOS"):     0.45,
    ("Brazil",         "ANDROID"): 0.19,
    ("Mexico",         "IOS"):     0.43,
    ("Mexico",         "ANDROID"): 0.22,
    ("South Korea",    "IOS"):     1.20,
    ("South Korea",    "ANDROID"): 0.85,
    ("Italy",          "IOS"):     0.88,
    ("Italy",          "ANDROID"): 0.55,
    ("Spain",          "IOS"):     0.80,
    ("Spain",          "ANDROID"): 0.50,
    ("Netherlands",    "IOS"):     1.10,
    ("Netherlands",    "ANDROID"): 0.70,
    ("Sweden",         "IOS"):     1.15,
    ("Sweden",         "ANDROID"): 0.75,
    ("Turkey",         "IOS"):     0.35,
    ("Turkey",         "ANDROID"): 0.18,
    ("Other",          "IOS"):     0.50,
    ("Other",          "ANDROID"): 0.22,
}

# Day-of-week CPI multipliers [Mon=0 … Sun=6]
DOW_CPI_MULT = [0.97, 1.00, 1.03, 1.06, 1.12, 0.92, 0.88]

CHANNEL_CPI_VOLATILITY = {
    "google_uac":       0.08,
    "facebook_ads":     0.10,
    "apple_search_ads": 0.05,
    "organic":          0.0,
}


# ── Engagement tiers ────────────────────────────────────────────────────────────

ENGAGEMENT_TIERS = ["casual", "competitive", "hardcore"]

CHANNEL_ENGAGEMENT_DIST = {
    "google_uac":       [0.65, 0.25, 0.10],
    "facebook_ads":     [0.65, 0.25, 0.10],  # old targeting (Jan- onward with new_targeting overrides)
    "apple_search_ads": [0.45, 0.35, 0.20],  # quality users
    "organic":          [0.60, 0.28, 0.12],
}

# Facebook with new 5-game targeting (Jan 2026+): higher engagement mix
FACEBOOK_NEW_TARGETING_ENGAGEMENT_DIST = [0.15, 0.40, 0.45]


# ── In-app ad networks ──────────────────────────────────────────────────────────

AD_NETWORKS     = ["admob_network", "ironsource", "applovin", "facebook_audience"]
AD_NETWORK_PROBS = [0.40, 0.25, 0.20, 0.15]

AD_FORMATS      = ["REWARDED", "INTER"]
AD_FORMAT_PROBS = [0.70, 0.30]

# CPMs by format
REWARDED_CPM = 8.50
INTER_CPM    = 5.20

PLATFORM_FEE = 0.30


# ── App versions ────────────────────────────────────────────────────────────────

APP_VERSIONS = ["1.0.0", "1.1.0", "1.2.0", "1.2.1", "1.3.0"]
APP_VERSION_WEIGHTS = [0.05, 0.10, 0.30, 0.30, 0.25]


# ── Races table ─────────────────────────────────────────────────────────────────

LEVEL_TYPES = ["ClassicRace", "TimeScore", "BeatTheTime",
               "Survival", "Elimination", "Multiplayer", "FreeDrive"]
LEVEL_TYPE_WEIGHTS = [0.45, 0.28, 0.10, 0.09, 0.05, 0.02, 0.01]

CARS = ["SportsCar", "Muscle", "Exotic", "Truck"]
CAR_WEIGHTS = [0.40, 0.25, 0.25, 0.10]

LEVEL_DURATION_LOGNORMAL = {
    "ClassicRace": (3.8, 0.30),
    "TimeScore":   (3.9, 0.30),
    "BeatTheTime": (3.7, 0.28),
    "Survival":    (4.2, 0.35),
    "Elimination": (4.0, 0.32),
    "Multiplayer": (5.8, 0.40),
    "FreeDrive":   (5.5, 0.40),
}

LEVEL_SCORE_LOGNORMAL = {
    "ClassicRace": (7.5, 0.5),
    "TimeScore":   (8.0, 0.4),
    "BeatTheTime": (7.8, 0.45),
    "Survival":    (7.0, 0.6),
    "Elimination": (7.2, 0.55),
}

LEVEL_NAMES = {
    "ClassicRace": ["City Sprint {n}", "Highway Chase {n}", "Mountain Pass {n}", "Coastal Run {n}", "Urban Grid {n}"],
    "TimeScore":   ["Speed Trial {n}", "Time Attack {n}", "Precision Run {n}", "Sprint Challenge {n}"],
    "BeatTheTime": ["Beat the Clock {n}", "Race the Ghost {n}", "Time Pressure {n}"],
    "Survival":    ["Endurance {n}", "Last Lap {n}", "Final Stand {n}"],
    "Elimination": ["Last Place Out {n}", "Knockout {n}", "Elimination Series {n}"],
    "Multiplayer": ["Grand Prix {n}", "Battle Royale {n}", "Team Race {n}"],
    "FreeDrive":   ["Open Road {n}", "Practice Run {n}", "Free Roam {n}"],
}


# ── Frozen D30 model for projected LTV columns (Gap 3 fix) ──────────────────────

# Pre-dataset D30 baseline (hypothetical Oct-Dec 2025 training window)
PRE_DATASET_D30_BASELINE = 0.130

# "Frozen model" D30 retention used for LTV projection at install time.
# Formula: avg of the 3 months prior to install month.
FROZEN_D30_BY_INSTALL_MONTH = {
    "2026-01": 0.130,   # all 3 prior months pre-dataset
    "2026-02": 0.137,   # avg(0.130, 0.130, 0.180) — 2 pre-dataset + Jan
    "2026-03": 0.143,   # avg(0.130, 0.180, 0.165) — 1 pre-dataset + Jan/Feb
    "2026-04": 0.166,   # avg(0.180, 0.165, 0.152) — all in dataset
    "2026-05": 0.152,   # avg(0.165, 0.152, 0.138) — rolling
    "2026-06": 0.138,   # avg(0.152, 0.138, 0.125) — rolling
}

# Power-law extension D30 → D90
D30_TO_D90_POWER_LAW_FACTOR = (30.0 / 90.0) ** 0.65  # ≈ 0.5244


# ─────────────────────────────────────────────────────────────────────────────────
# Core math helpers
# ─────────────────────────────────────────────────────────────────────────────────

def month_key(d: date) -> str:
    return d.strftime("%Y-%m")


def week_key(d: date) -> str:
    return d.strftime("%G-W%V")


def get_arpdau(country: str, platform: str, channel: str) -> float:
    base = ARPDAU_BASE.get(
        (country, platform),
        ARPDAU_BASE.get(("Other", platform), 0.018),
    )
    return base * CHANNEL_ARPDAU_MULT.get(channel, 1.0)


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


def cumulative_ltv_days(up_to_day: int, d30: float, is_emerging: bool = False) -> float:
    """Cumulative LTV from D0 through up_to_day (in units of ARPDAU)."""
    return sum(retention_scalar(d, d30, is_emerging) for d in range(up_to_day + 1))


def last_day_of_month(first_of_month: date) -> date:
    """Return the last day of the month for a given first-of-month date."""
    _, last = calendar.monthrange(first_of_month.year, first_of_month.month)
    return date(first_of_month.year, first_of_month.month, last)


def month_range(start: date, end: date):
    """Yield first-of-month dates from start to end inclusive."""
    cur = start.replace(day=1)
    while cur <= end:
        yield cur
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)


def build_daily_cpi_series(rng: np.random.Generator) -> dict:
    """
    Pre-generate daily CPI per channel using AR(1) autocorrelated noise.
    Returns dict: {(channel, date): cpi_value}
    """
    all_dates = [START_DATE + timedelta(days=i)
                 for i in range((END_DATE - START_DATE).days + 1)]
    total_days = len(all_dates)
    AR_PHI = 0.70

    series = {}
    for channel in CHANNELS:
        base_cpi = CHANNEL_CPI_BASE_IOS.get(channel, 0.0)
        if base_cpi == 0.0:
            for d in all_dates:
                series[(channel, d)] = 0.0
            continue

        sigma = CHANNEL_CPI_VOLATILITY.get(channel, 0.08)
        epsilon = 0.0

        for i, d in enumerate(all_dates):
            trend = 1.0 + 0.10 * i / max(total_days - 1, 1)
            dow_mult = DOW_CPI_MULT[d.weekday()]
            epsilon = AR_PHI * epsilon + sigma * float(rng.standard_normal())
            noise_mult = np.exp(epsilon)
            cpi = base_cpi * trend * dow_mult * noise_mult
            series[(channel, d)] = max(0.50, round(float(cpi), 2))

    return series


# ─────────────────────────────────────────────────────────────────────────────────
# Write helpers
# ─────────────────────────────────────────────────────────────────────────────────

DATE_COLS = {"install_dt", "cohort_date", "calendar_date", "dt"}


def _assert_date_columns(df: pd.DataFrame) -> None:
    """Guard: all date columns must be Python datetime.date objects (dtype=object).
    PyArrow converts datetime.date → date32 but pd.Timestamp → timestamp[us].
    """
    for col in DATE_COLS:
        if col in df.columns:
            assert df[col].dtype == object, (
                f"Column '{col}' must contain Python datetime.date objects (dtype=object), "
                f"got {df[col].dtype}. Do NOT call pd.to_datetime() on date columns."
            )
            first = df[col].dropna().iloc[0] if len(df[col].dropna()) > 0 else None
            if first is not None:
                assert isinstance(first, date), (
                    f"Column '{col}' values must be datetime.date, got {type(first)}"
                )


def write_parquet(df: pd.DataFrame, path: Path, name: str) -> None:
    """Standard single-write helper for all tables except races."""
    path.parent.mkdir(parents=True, exist_ok=True)
    _assert_date_columns(df)
    table = pa.Table.from_pandas(df)
    pq.write_table(table, path, compression="snappy", write_statistics=True)
    mb = path.stat().st_size / 1_048_576
    print(f"  ✓ {name}: {len(df):,} rows → {path.name} ({mb:.1f} MB)")


# ─────────────────────────────────────────────────────────────────────────────────
# Table generators
# ─────────────────────────────────────────────────────────────────────────────────

def gen_installs(scale: float, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate installs table.
    ~10.3M rows at scale=1.0 (with ramp-up).
    Uses install_dt (DATE, not TIMESTAMP), uppercase IOS/ANDROID, full country names.
    """
    country_arr = np.array(ALL_COUNTRIES)
    w_paid = np.array([COUNTRY_WEIGHTS_PAID[c] for c in ALL_COUNTRIES], dtype=float)
    w_paid /= w_paid.sum()
    w_org = np.array([COUNTRY_WEIGHTS_ORGANIC[c] for c in ALL_COUNTRIES], dtype=float)
    w_org /= w_org.sum()

    channels_col: list = []
    dates_col:    list = []
    countries_col: list = []
    platforms_col: list = []
    app_ver_col:  list = []
    fraud_flag_col: list = []
    fraud_rate_col: list = []
    engagement_col: list = []
    new_targeting_col: list = []

    total_target = 0

    for month_start in month_range(START_DATE, END_DATE):
        mk = month_key(month_start)
        month_end = last_day_of_month(month_start)
        days_in_month = (month_end - month_start).days + 1
        ramp = MONTHLY_RAMP.get(mk, 1.0)
        n_month = max(1, int(BASE_MONTHLY_INSTALLS * scale * ramp))
        total_target += n_month

        n_paid = int(n_month * PAID_INSTALL_FRACTION)
        n_organic = n_month - n_paid

        # Date weights: uniform within month (since we don't have monthly spend data here)
        day_offsets = np.arange(days_in_month)

        # ── Paid channels ──
        for channel, vol_share in CHANNEL_PAID_VOL_SHARE.items():
            n = int(n_paid * vol_share)
            if n == 0:
                continue

            day_idx = rng.integers(0, days_in_month, size=n)
            install_dates = [month_start + timedelta(days=int(d)) for d in day_idx]

            countries = rng.choice(country_arr, size=n, p=w_paid)
            ios_p = np.array([PLATFORM_IOS_PROB.get(c, PLATFORM_IOS_PROB_DEFAULT) for c in countries])
            is_ios = rng.random(n) < ios_p

            # apple_search_ads is iOS only — force iOS
            if channel == "apple_search_ads":
                is_ios = np.ones(n, dtype=bool)

            platforms = np.where(is_ios, "IOS", "ANDROID")

            lo, hi = CHANNEL_FRAUD_RANGE[channel]
            f_rates = rng.uniform(lo, hi, size=n)
            f_flags = rng.random(n) < f_rates

            app_vers = rng.choice(APP_VERSIONS, size=n, p=APP_VERSION_WEIGHTS)

            # Engagement tier
            dist = CHANNEL_ENGAGEMENT_DIST.get(channel, [0.65, 0.25, 0.10])
            eng_choices = rng.choice(ENGAGEMENT_TIERS, size=n, p=dist).tolist()

            # is_new_targeting: Facebook Jan 2026+ users
            if channel == "facebook_ads":
                new_targ = np.array(
                    [d >= date(2026, 1, 1) for d in install_dates], dtype=bool
                )
                # Override engagement for new-targeting users (vectorized)
                new_targ_indices = np.where(new_targ)[0]
                if len(new_targ_indices) > 0:
                    new_eng = rng.choice(
                        ENGAGEMENT_TIERS,
                        size=len(new_targ_indices),
                        p=FACEBOOK_NEW_TARGETING_ENGAGEMENT_DIST,
                    )
                    for j, idx in enumerate(new_targ_indices):
                        eng_choices[idx] = new_eng[j]
                    # Apply 1.20× CPI multiplier baked into channel config (captured in campaign generation)
            else:
                new_targ = np.zeros(n, dtype=bool)

            channels_col.extend([channel] * n)
            dates_col.extend(install_dates)
            countries_col.extend(countries.tolist())
            platforms_col.extend(platforms.tolist())
            app_ver_col.extend(app_vers.tolist())
            fraud_flag_col.extend(f_flags.astype(int).tolist())
            fraud_rate_col.extend(np.round(f_rates, 4).tolist())
            engagement_col.extend(eng_choices)
            new_targeting_col.extend(new_targ.astype(int).tolist())

        # ── Organic ──
        n = n_organic
        day_idx = rng.integers(0, days_in_month, size=n)
        install_dates = [month_start + timedelta(days=int(d)) for d in day_idx]
        countries = rng.choice(country_arr, size=n, p=w_org)
        ios_p = np.array([PLATFORM_IOS_PROB.get(c, PLATFORM_IOS_PROB_DEFAULT) for c in countries])
        is_ios = rng.random(n) < ios_p
        platforms = np.where(is_ios, "IOS", "ANDROID")
        lo, hi = CHANNEL_FRAUD_RANGE["organic"]
        f_rates = rng.uniform(lo, hi, size=n)
        f_flags = rng.random(n) < f_rates
        app_vers = rng.choice(APP_VERSIONS, size=n, p=APP_VERSION_WEIGHTS)
        dist_org = CHANNEL_ENGAGEMENT_DIST.get("organic", [0.60, 0.28, 0.12])
        eng_choices_org = rng.choice(ENGAGEMENT_TIERS, size=n, p=dist_org)

        channels_col.extend(["organic"] * n)
        dates_col.extend(install_dates)
        countries_col.extend(countries.tolist())
        platforms_col.extend(platforms.tolist())
        app_ver_col.extend(app_vers.tolist())
        fraud_flag_col.extend(f_flags.astype(int).tolist())
        fraud_rate_col.extend(np.round(f_rates, 4).tolist())
        engagement_col.extend(eng_choices_org.tolist())
        new_targeting_col.extend([0] * n)

    total = len(channels_col)
    shuffled = rng.permutation(total)

    df = pd.DataFrame({
        "user_id":          [f"u_{i:09d}" for i in range(total)],
        "install_dt":       [dates_col[i] for i in shuffled],        # datetime.date → date32
        "channel":          [channels_col[i] for i in shuffled],
        "platform":         [platforms_col[i] for i in shuffled],
        "country":          [countries_col[i] for i in shuffled],
        "app_version":      [app_ver_col[i] for i in shuffled],
        "is_fraud":         [int(fraud_flag_col[i]) for i in shuffled],
        "fraud_rate":       [float(fraud_rate_col[i]) for i in shuffled],
        "engagement_tier":  [engagement_col[i] for i in shuffled],
        "is_new_targeting": [int(new_targeting_col[i]) for i in shuffled],
    })

    df["install_month"] = [d.strftime("%Y-%m") for d in df["install_dt"]]

    print(f"  Generated {len(df):,} install records")
    return df


def gen_sessions(installs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate sessions table.
    ~2× gameramp sessions/install ratio.
    Session dt is DATE (not TIMESTAMP).
    """
    N = len(installs)
    MAX_SESSION_DAYS = 90  # track sessions up to D90 post-install

    print(f"  Building retention matrix ({N:,} users × {MAX_SESSION_DAYS + 1} days)...")

    # Per-user retention parameters
    d30_arr   = np.array([D30_RETENTION_BY_MONTH.get(m, 0.114) for m in installs["install_month"]], dtype=float)
    ch_mult   = np.array([CHANNEL_RETENTION_MULT.get(c, 1.0) for c in installs["channel"]], dtype=float)
    eng_mult  = np.array([ENGAGEMENT_RETENTION_MULT.get(t, 0.90) for t in installs["engagement_tier"]], dtype=float)
    geo_mult  = np.array([
        GEO_RETENTION_MULT.get(
            (c, p),
            GEO_RETENTION_MULT.get(("Other", p), 0.65),
        )
        for c, p in zip(installs["country"], installs["platform"])
    ], dtype=float)
    is_emerg  = np.array([c in EMERGING_MARKET_COUNTRIES for c in installs["country"]], dtype=bool)

    eff_d30 = (d30_arr * ch_mult * eng_mult * geo_mult)[:, np.newaxis]  # (N, 1)
    eff_d30 = eff_d30.clip(0.0, 1.0)

    n_days = MAX_SESSION_DAYS + 1
    days = np.arange(n_days, dtype=float)

    # Standard power law
    with np.errstate(divide="ignore", invalid="ignore"):
        day_factor = np.where(days == 0, 1.0, (30.0 / np.maximum(days, 1e-9)) ** 0.65)
    standard_ret = eff_d30 * day_factor[np.newaxis, :]

    # Emerging bi-phasic
    with np.errstate(divide="ignore", invalid="ignore"):
        day_factor_55 = np.where(days == 0, 1.0, (30.0 / np.maximum(days, 1e-9)) ** 0.55)
    phase1_ret = eff_d30 * day_factor_55[np.newaxis, :]
    ret14_per_user = eff_d30 * (30.0 / 14) ** 0.55
    with np.errstate(divide="ignore", invalid="ignore"):
        day_factor_18 = np.where(days <= 14, 1.0, (14.0 / np.maximum(days, 1e-9)) ** 1.8)
    phase2_ret = ret14_per_user * day_factor_18[np.newaxis, :]
    emerging_ret = np.where(days[np.newaxis, :] <= 14, phase1_ret, phase2_ret)

    ret_matrix = np.where(is_emerg[:, np.newaxis], emerging_ret, standard_ret)
    ret_matrix = ret_matrix.clip(0.0, 1.0)
    ret_matrix[:, 0] = 1.0  # D0 always active

    # Only keep sessions that fall within the dataset date range
    epoch_start = (START_DATE - date(1970, 1, 1)).days
    install_epochs = np.array([(d - date(1970, 1, 1)).days for d in installs["install_dt"]], dtype=np.int32)
    end_epoch = (END_DATE - date(1970, 1, 1)).days

    max_day_per_user = (end_epoch - install_epochs).clip(min=0)  # max day offset within dataset
    day_indices_grid = np.arange(n_days)[np.newaxis, :]
    in_range_mask = day_indices_grid <= max_day_per_user[:, np.newaxis]
    ret_matrix = ret_matrix * in_range_mask.astype(ret_matrix.dtype)

    rand_matrix = rng.random(ret_matrix.shape)
    active_matrix = rand_matrix < ret_matrix

    user_idx, day_idx = np.where(active_matrix)
    n_sessions = len(user_idx)
    print(f"  Sampling {n_sessions:,} sessions...")

    # Session dt as epoch days → date32 via PyArrow
    session_epochs = install_epochs[user_idx] + day_idx.astype(np.int32)

    # Per-session attributes
    arpdau_arr = np.array([
        get_arpdau(c, p, ch)
        for c, p, ch in zip(installs["country"], installs["platform"], installs["channel"])
    ], dtype=float)
    eng_arpdau = np.array([ENGAGEMENT_ARPDAU_MULT.get(t, 0.95) for t in installs["engagement_tier"]], dtype=float)
    arpdau_arr = arpdau_arr * eng_arpdau
    arpdau_active = arpdau_arr[user_idx]

    duration_secs = np.maximum(30.0, rng.lognormal(3.6, 0.65, n_sessions))
    event_count   = np.maximum(1, rng.integers(3, 25, size=n_sessions))
    ad_rev        = np.maximum(0.0, arpdau_active * (1.0 + rng.normal(0.0, 0.3, n_sessions)))
    iap_flag      = (rng.random(n_sessions) < 0.0015).astype(np.int32)
    iap_rev       = np.where(iap_flag == 1, np.maximum(0.0, rng.lognormal(1.5, 0.8, n_sessions)), 0.0)

    # session_number per user: sort by (user_idx, day_idx) and assign cumulative count
    order = np.lexsort((day_idx, user_idx))
    session_numbers = np.empty(n_sessions, dtype=np.int32)
    prev_user = -1
    counter = 0
    for o in order:
        if user_idx[o] != prev_user:
            counter = 1
            prev_user = user_idx[o]
        else:
            counter += 1
        session_numbers[o] = counter

    # Build PyArrow table directly for date32 accuracy
    dt_array = pa.array(session_epochs, type=pa.date32())

    df = pd.DataFrame({
        "session_id":           [f"as_{i:011d}" for i in range(n_sessions)],
        "user_id":              installs["user_id"].values[user_idx],
        "platform":             installs["platform"].values[user_idx],
        "country":              installs["country"].values[user_idx],
        "app_version":          installs["app_version"].values[user_idx],
        "session_duration_secs": np.round(duration_secs, 2),
        "event_count":          event_count,
        "session_number":       session_numbers,
        "ad_revenue":           np.round(ad_rev, 6),
        "iap_transaction":      iap_flag,
        "iap_revenue_usd":      np.round(iap_rev, 4),
        "install_month":        installs["install_month"].values[user_idx],
        "days_from_install":    day_idx.astype(np.int32),
    })

    # Add dt as object column of datetime.date (will become date32)
    epoch_origin = date(1970, 1, 1)
    df["dt"] = [epoch_origin + timedelta(days=int(e)) for e in session_epochs]

    print(f"  Generated {len(df):,} session records")
    return df


def gen_ad_impressions(sessions: pd.DataFrame, installs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate ad impression events.
    Uses dt DATE (not ts TIMESTAMP).
    Adds reported_revenue, settled_revenue, net_revenue for fraud scenario.
    """
    n_s = len(sessions)
    imps_per_session = rng.integers(2, 5, size=n_s)
    rep_idx = np.repeat(np.arange(n_s), imps_per_session)
    n_imp = len(rep_idx)
    print(f"  Expanding {n_s:,} sessions → {n_imp:,} impression events...")

    # Ad formats and networks
    fmt_codes = rng.choice(len(AD_FORMATS), size=n_imp, p=AD_FORMAT_PROBS)
    formats   = np.array(AD_FORMATS)[fmt_codes]
    networks  = rng.choice(AD_NETWORKS, size=n_imp, p=AD_NETWORK_PROBS)

    # Revenue per impression based on CPM and ad format
    cpm_arr   = np.where(fmt_codes == 0, REWARDED_CPM, INTER_CPM)  # 0=REWARDED, 1=INTER
    base_rev  = (cpm_arr / 1000.0) * rng.lognormal(0.0, 0.25, n_imp)
    reported_revenue = np.maximum(0.0, base_rev)

    # Build fraud rate per impression from user's channel
    # Need channel from installs indexed by sessions' user
    session_user_ids = sessions["user_id"].values[rep_idx]
    user_id_to_channel = dict(zip(installs["user_id"], installs["channel"]))
    channels = np.array([user_id_to_channel.get(uid, "organic") for uid in session_user_ids])

    # Fraud rate midpoints by channel
    fraud_rate_mid = {
        "google_uac":       0.04,
        "facebook_ads":     0.105,
        "apple_search_ads": 0.005,
        "organic":          0.01,
    }
    fraud_rates = np.array([fraud_rate_mid.get(ch, 0.01) for ch in channels])

    is_fraud_session = sessions["ad_revenue"].values[rep_idx] * 0   # placeholder
    # Use per-user fraud flag from installs
    user_id_to_fraud = dict(zip(installs["user_id"], installs["is_fraud"]))
    is_fraud_user = np.array([user_id_to_fraud.get(uid, 0) for uid in session_user_ids], dtype=bool)

    settled_revenue = np.where(is_fraud_user, 0.0, reported_revenue * (1.0 - fraud_rates * rng.uniform(0.5, 1.5, n_imp).clip(0, 1)))
    settled_revenue = np.maximum(0.0, settled_revenue)
    net_revenue     = np.maximum(0.0, settled_revenue * (1.0 - PLATFORM_FEE))

    # Dates: use session dt directly (already DATE)
    session_dates = sessions["dt"].values[rep_idx]  # datetime.date objects

    df = pd.DataFrame({
        "record_id":         [f"ai_{i:012d}" for i in range(n_imp)],
        "dt":                session_dates,  # datetime.date → date32
        "user_id":           session_user_ids,
        "platform":          sessions["platform"].values[rep_idx],
        "country":           sessions["country"].values[rep_idx],
        "app_version":       sessions["app_version"].values[rep_idx],
        "channel":           channels,
        "ad_format":         formats,
        "ad_network":        networks,
        "revenue":           np.round(reported_revenue, 6),    # alias for reported
        "reported_revenue":  np.round(reported_revenue, 6),
        "settled_revenue":   np.round(settled_revenue, 6),
        "net_revenue":       np.round(net_revenue, 6),
        "fraud_rate":        np.round(fraud_rates, 4),
        "install_month":     sessions["install_month"].values[rep_idx],
    })

    print(f"  Generated {len(df):,} ad impression records")
    return df


def gen_revenue(installs: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate cohort-level revenue table (MMP-style).
    Adds d30_projected_ltv and d90_projected_ltv for frozen model scenario.
    """
    print("  Building cohort-level revenue table...")

    grp = (
        installs
        .groupby(["install_dt", "channel", "country", "platform"], observed=True)
        .size()
        .reset_index(name="cohort_installs")
    )

    rows = []
    for _, g in grp.iterrows():
        cohort_date  = g["install_dt"]  # already a datetime.date
        if not isinstance(cohort_date, date):
            cohort_date = cohort_date.date()
        channel      = g["channel"]
        country      = g["country"]
        platform     = g["platform"]
        cohort_size  = int(g["cohort_installs"])
        install_month = month_key(cohort_date)
        install_week  = week_key(cohort_date)

        if install_month not in D30_RETENTION_BY_MONTH:
            continue

        # Apple Search Ads is iOS only — skip ANDROID rows
        if channel == "apple_search_ads" and platform == "ANDROID":
            continue

        geo_ret_mult = GEO_RETENTION_MULT.get(
            (country, platform),
            GEO_RETENTION_MULT.get(("Other", platform), 0.65),
        )
        geo_cpi_mult = CPI_GEO_MULT.get(
            (country, platform),
            CPI_GEO_MULT.get(("Other", platform), 0.22),
        )

        d30_base  = D30_RETENTION_BY_MONTH[install_month] * CHANNEL_RETENTION_MULT.get(channel, 1.0) * geo_ret_mult
        d30_base  = min(d30_base, 1.0)
        is_emerg  = country in EMERGING_MARKET_COUNTRIES
        arpdau    = get_arpdau(country, platform, channel)

        # Frozen model projected LTV (Gap 3 fix)
        frozen_d30 = FROZEN_D30_BY_INSTALL_MONTH.get(install_month, 0.130)
        frozen_d90 = frozen_d30 * D30_TO_D90_POWER_LAW_FACTOR
        d30_projected_ltv = round(arpdau * cumulative_ltv_days(30, frozen_d30, is_emerging=False), 4)
        d90_projected_ltv = round(arpdau * cumulative_ltv_days(90, frozen_d30, is_emerging=False), 4)

        # CPI geo-adjusted
        cpi_ios = CHANNEL_CPI_BASE_IOS.get(channel, 0.0) * geo_cpi_mult
        cpi     = cpi_ios if platform == "IOS" else (CHANNEL_CPI_BASE_ANDROID.get(channel, 0.0) or 0.0) * geo_cpi_mult

        # New-targeting CPI adjustment for Facebook Jan 2026+ cohorts
        if channel == "facebook_ads" and install_month >= "2026-01":
            cpi *= 1.20

        days_elapsed = (END_DATE - cohort_date).days

        # Cumulative LTV cache
        cum_ltv_cache = {}
        running = 0.0
        for d in range(max(REVENUE_PERIODS) + 1):
            running += arpdau * retention_scalar(d, d30_base, is_emerg)
            if d in REVENUE_PERIODS:
                cum_ltv_cache[d] = running

        d90_ltv = cum_ltv_cache.get(90, running)

        for period_day in REVENUE_PERIODS:
            is_observed = period_day <= days_elapsed

            ret      = retention_scalar(period_day, d30_base, is_emerg)
            retained = max(0, int(cohort_size * ret))
            arpu     = arpdau * ret
            total_arpu = cum_ltv_cache.get(period_day, 0.0)
            roi       = total_arpu / cpi if cpi > 0 else 0.0
            total_roi = d90_ltv / cpi    if cpi > 0 else 0.0

            rows.append({
                "cohort_date":         cohort_date,    # datetime.date → date32
                "install_week":        install_week,
                "install_month":       install_month,
                "channel":             channel,
                "country":             country,
                "platform":            platform,
                "os":                  platform,
                "days_from_cohort":    period_day,
                "period":              f"D{period_day}",
                "cohort_installs":     cohort_size,
                "retained_users":      retained,
                "retention_rate":      round(ret, 6),
                "arpu":                round(arpu, 6),
                "total_arpu":          round(total_arpu, 6),
                "arpdau":              round(arpdau, 6),
                "roi":                 round(roi, 4),
                "total_roi":           round(total_roi, 4),
                "is_observed":         is_observed,
                "days_elapsed":        days_elapsed,
                "d30_projected_ltv":   d30_projected_ltv,
                "d90_projected_ltv":   d90_projected_ltv,
            })

    df = pd.DataFrame(rows)
    print(f"  Generated {len(df):,} revenue cohort records")
    return df


def gen_campaign(installs: pd.DataFrame, daily_cpi: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Generate daily campaign spend table."""
    print("  Building campaign spend table...")

    paid = installs[installs["channel"] != "organic"].copy()
    grp = (
        paid
        .groupby(["install_dt", "channel", "country", "platform"], observed=True)
        .size()
        .reset_index(name="installs")
    )

    rows = []
    for _, g in grp.iterrows():
        install_date = g["install_dt"]
        if not isinstance(install_date, date):
            install_date = install_date.date()

        channel   = g["channel"]
        country   = g["country"]
        platform  = g["platform"]
        n_installs = int(g["installs"])

        if n_installs == 0:
            continue

        # Apple Search Ads is iOS only
        if channel == "apple_search_ads" and platform == "ANDROID":
            continue

        mk = month_key(install_date)
        if mk not in D30_RETENTION_BY_MONTH:
            continue

        geo_cpi_mult = CPI_GEO_MULT.get(
            (country, platform),
            CPI_GEO_MULT.get(("Other", platform), 0.22),
        )
        geo_ret_mult = GEO_RETENTION_MULT.get(
            (country, platform),
            GEO_RETENTION_MULT.get(("Other", platform), 0.65),
        )

        base_cpi = (
            CHANNEL_CPI_BASE_IOS.get(channel, 0.0) if platform == "IOS"
            else (CHANNEL_CPI_BASE_ANDROID.get(channel) or 0.0)
        )
        cpi_actual = daily_cpi.get((channel, install_date), base_cpi) * geo_cpi_mult
        cpi        = base_cpi * geo_cpi_mult

        # New-targeting premium
        if channel == "facebook_ads" and mk >= "2026-01":
            # estimate fraction of new-targeting in this cohort
            # Jan+ Facebook: all new-targeting → 1.20× CPI
            cpi_actual *= 1.20
            cpi        *= 1.20

        cost = n_installs * cpi_actual

        clicks      = max(1, int(n_installs / 0.15))
        impressions = max(1, int(clicks / 0.01))
        ecpm        = cost / impressions * 1000 if impressions > 0 else 0.0

        d30_base  = D30_RETENTION_BY_MONTH.get(mk, 0.114) * CHANNEL_RETENTION_MULT.get(channel, 1.0) * geo_ret_mult
        is_emerg  = country in EMERGING_MARKET_COUNTRIES
        arpdau    = get_arpdau(country, platform, channel)
        d90_ltv   = arpdau * cumulative_ltv_days(90, d30_base, is_emerg)
        roi_d90   = d90_ltv / cpi if cpi > 0 else 0.0

        rows.append({
            "cohort_date":  install_date,  # datetime.date → date32
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
    print(f"  Generated {len(df):,} campaign records")
    return df


def get_active_users_for_month(
    installs: pd.DataFrame,
    month_start: date,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """
    Return the subset of users who are active during month_start's month.
    Vectorized: no Python-level per-user loop.
    """
    eligible = installs[installs["install_dt"] <= month_start].copy()
    if len(eligible) == 0:
        return eligible

    # days_since_install at month_start
    install_dts = eligible["install_dt"].values  # datetime.date objects
    days_since = np.array([(month_start - d).days for d in install_dts], dtype=float)

    # Effective D30 retention per user
    base_d30 = np.array([D30_RETENTION_BY_MONTH.get(m, 0.114) for m in eligible["install_month"]], dtype=float)
    ch_mult  = np.array([CHANNEL_RETENTION_MULT.get(c, 1.0) for c in eligible["channel"]], dtype=float)
    eng_mult = np.array([ENGAGEMENT_RETENTION_MULT.get(t, 0.90) for t in eligible["engagement_tier"]], dtype=float)
    geo_mult = np.array([
        GEO_RETENTION_MULT.get(
            (c, p),
            GEO_RETENTION_MULT.get(("Other", p), 0.65),
        )
        for c, p in zip(eligible["country"], eligible["platform"])
    ], dtype=float)

    eff_d30 = (base_d30 * ch_mult * eng_mult * geo_mult).clip(0.0, 1.0)

    d = days_since
    d30 = eff_d30
    is_emerging = np.array([c in EMERGING_MARKET_COUNTRIES for c in eligible["country"]], dtype=bool)

    # Standard power law
    with np.errstate(divide="ignore", invalid="ignore"):
        standard_ret = np.where(
            d == 0, 1.0,
            np.minimum(d30 * (30.0 / np.maximum(d, 1e-9)) ** 0.65, 1.0)
        )

    # Bi-phasic for emerging markets
    with np.errstate(divide="ignore", invalid="ignore"):
        phase1 = np.where(
            d == 0, 1.0,
            np.minimum(d30 * (30.0 / np.maximum(d, 1e-9)) ** 0.55, 1.0)
        )
        ret14 = d30 * (30.0 / 14.0) ** 0.55
        phase2 = np.minimum(ret14 * (14.0 / np.maximum(d, 1e-9)) ** 1.8, 1.0)
        emerging_ret = np.where(d <= 14, phase1, phase2)

    retention_prob = np.where(is_emerging, emerging_ret, standard_ret).clip(0.0, 1.0)
    active_mask = rng.random(len(eligible)) < retention_prob

    return eligible[active_mask].reset_index(drop=True)


def _level_name(level_type: str, idx: int, rng: np.random.Generator) -> str:
    templates = LEVEL_NAMES.get(level_type, ["Level {n}"])
    t = templates[idx % len(templates)]
    n = (idx // len(templates)) + 1
    return t.replace("{n}", str(n))


def gen_races(installs: pd.DataFrame, out_path: Path, rng: np.random.Generator) -> int:
    """
    Generate races table in monthly chunks to avoid OOM.
    Target: ~5.72M rows/month × 6 months = ~34.3M total.
    Uses fully vectorized np.repeat() + columnar construction.
    Returns total row count.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    epoch_origin = date(1970, 1, 1)

    writer = None
    total_rows = 0

    schema = pa.schema([
        ("race_id",            pa.string()),
        ("user_id",            pa.string()),
        ("dt",                 pa.date32()),    # CRITICAL: pa.date32(), not pa.timestamp
        ("platform",           pa.string()),
        ("country",            pa.string()),
        ("app_version",        pa.string()),
        ("level_type",         pa.string()),
        ("result",             pa.string()),
        ("level_duration",     pa.float64()),
        ("score",              pa.float64()),
        ("overtakes",          pa.int32()),
        ("crash_number",       pa.int32()),
        ("is_level_completed", pa.int32()),
        ("car",                pa.string()),
        ("level_name",         pa.string()),
    ])

    try:
        for month_start in month_range(START_DATE, END_DATE):
            month_end = last_day_of_month(month_start)
            month_str = month_start.strftime("%Y-%m")
            days_in_month = (month_end - month_start).days + 1

            # Get active users for this month
            active_users = get_active_users_for_month(installs, month_start, rng)
            n_users = len(active_users)
            if n_users == 0:
                print(f"  races {month_str}: 0 active users, skipping")
                continue

            # ── Vectorized race generation ───────────────────────────────────────
            # Poisson races per user (mean 17.5, gameramp calibrated ratio)
            races_per_user = rng.poisson(17.5, size=n_users).clip(min=1)
            total_races = int(races_per_user.sum())

            # Expand user attributes
            user_idx = np.repeat(np.arange(n_users), races_per_user)
            user_ids  = active_users["user_id"].values[user_idx]
            platforms = active_users["platform"].values[user_idx]
            countries = active_users["country"].values[user_idx]
            app_vers  = active_users["app_version"].values[user_idx]

            # Race dates as epoch days (date32 compatible)
            base_epoch = (month_start - epoch_origin).days
            day_offsets = rng.integers(0, days_in_month, size=total_races)
            race_epochs = (base_epoch + day_offsets).astype(np.int32)
            dt_array = pa.array(race_epochs, type=pa.date32())

            # Level types
            lt_codes = rng.choice(len(LEVEL_TYPES), size=total_races, p=LEVEL_TYPE_WEIGHTS)
            level_types_arr = np.array(LEVEL_TYPES)[lt_codes]
            is_competitive = ~np.isin(level_types_arr, ["Multiplayer", "FreeDrive"])

            # Result: Win/Lose/None
            roll_complete = rng.random(total_races)
            completed = np.where(is_competitive, roll_complete > 0.35, True)
            roll_win = rng.random(total_races)
            result_arr = np.where(
                is_competitive & completed,
                np.where(roll_win > 0.45, "Win", "Lose"),
                None
            )

            # Level duration (vectorized per type)
            level_duration = np.zeros(total_races, dtype=np.float64)
            for i, lt in enumerate(LEVEL_TYPES):
                mask = lt_codes == i
                if mask.sum() == 0:
                    continue
                mu, sigma = LEVEL_DURATION_LOGNORMAL[lt]
                level_duration[mask] = rng.lognormal(mu, sigma, mask.sum())

            # Score (competitive only)
            score_arr = np.full(total_races, np.nan)
            for i, lt in enumerate(LEVEL_TYPES):
                if lt in ("Multiplayer", "FreeDrive"):
                    continue
                mask = lt_codes == i
                if mask.sum() == 0:
                    continue
                mu, sigma = LEVEL_SCORE_LOGNORMAL.get(lt, (7.5, 0.5))
                score_arr[mask] = rng.lognormal(mu, sigma, mask.sum())
            score_arr = np.where(is_competitive, score_arr, np.nan)

            # Overtakes and crashes (competitive only)
            overtakes_arr = np.where(
                is_competitive,
                rng.integers(0, 25, size=total_races),
                -1  # sentinel for NULL
            ).astype(np.int32)
            crash_arr = np.where(
                is_competitive,
                rng.integers(0, 12, size=total_races),
                -1
            ).astype(np.int32)

            # Null mask for overtakes/crashes
            overtakes_pa = pa.array(
                [None if v == -1 else int(v) for v in overtakes_arr],
                type=pa.int32()
            )
            crash_pa = pa.array(
                [None if v == -1 else int(v) for v in crash_arr],
                type=pa.int32()
            )

            # Cars
            car_codes = rng.choice(len(CARS), size=total_races, p=CAR_WEIGHTS)
            cars_arr = np.array(CARS)[car_codes]

            # Level names
            level_names_list = [
                _level_name(level_types_arr[i], i, rng)
                for i in range(total_races)
            ]

            # Bulk UUID generation (RFC 4122 v4)
            raw = rng.integers(0, 256, size=(total_races, 16), dtype=np.uint8)
            raw[:, 6] = (raw[:, 6] & 0x0F) | 0x40  # version 4
            raw[:, 8] = (raw[:, 8] & 0x3F) | 0x80  # variant
            race_ids = [
                f"{b[0]:02x}{b[1]:02x}{b[2]:02x}{b[3]:02x}-"
                f"{b[4]:02x}{b[5]:02x}-{b[6]:02x}{b[7]:02x}-"
                f"{b[8]:02x}{b[9]:02x}-"
                f"{b[10]:02x}{b[11]:02x}{b[12]:02x}{b[13]:02x}{b[14]:02x}{b[15]:02x}"
                for b in raw
            ]

            # Build Arrow table
            table = pa.table({
                "race_id":            pa.array(race_ids, type=pa.string()),
                "user_id":            pa.array(user_ids.tolist(), type=pa.string()),
                "dt":                 dt_array,
                "platform":           pa.array(platforms.tolist(), type=pa.string()),
                "country":            pa.array(countries.tolist(), type=pa.string()),
                "app_version":        pa.array(app_vers.tolist(), type=pa.string()),
                "level_type":         pa.array(level_types_arr.tolist(), type=pa.string()),
                "result":             pa.array(result_arr.tolist(), type=pa.string()),
                "level_duration":     pa.array(level_duration, type=pa.float64()),
                "score":              pa.array([None if np.isnan(v) else float(v) for v in score_arr], type=pa.float64()),
                "overtakes":          overtakes_pa,
                "crash_number":       crash_pa,
                "is_level_completed": pa.array(completed.astype(np.int32).tolist(), type=pa.int32()),
                "car":                pa.array(cars_arr.tolist(), type=pa.string()),
                "level_name":         pa.array(level_names_list, type=pa.string()),
            }, schema=schema)

            if writer is None:
                writer = pq.ParquetWriter(
                    out_path,
                    schema,
                    compression="snappy",
                    write_statistics=True,
                    data_page_size=1024 * 1024,
                )
            writer.write_table(table)
            total_rows += total_races
            del table
            print(f"  races {month_str}: {n_users:,} active users → {total_races:,} races")

    finally:
        if writer:
            writer.close()

    return total_rows


# ─────────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate Alpha synthetic dataset")
    parser.add_argument("--scale",  type=float, default=1.0,
                        help="Scale multiplier (0.001–1.0, default 1.0)")
    parser.add_argument("--seed",   type=int,   default=42,
                        help="Random seed (default 42)")
    parser.add_argument("--output", type=str,   default="data/parquet/alpha",
                        help="Output directory (default data/parquet/alpha)")
    args = parser.parse_args()

    if not (0.001 <= args.scale <= 1.0):
        print("Error: --scale must be between 0.001 and 1.0", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(args.seed)
    print(f"\nAlpha synthetic dataset generator")
    print(f"Scale={args.scale}, seed={args.seed}, output={out_dir}\n")

    # Pre-generate daily CPI series
    print("Pre-computing daily CPI series...")
    daily_cpi = build_daily_cpi_series(rng)

    # 1. Installs
    print("\n1/6  installs")
    installs = gen_installs(args.scale, rng)
    write_parquet(installs, out_dir / "alpha_installs.parquet", "alpha_installs")

    # 2. Sessions
    print("\n2/6  sessions")
    sessions = gen_sessions(installs, rng)
    write_parquet(sessions, out_dir / "alpha_sessions.parquet", "alpha_sessions")

    # 3. Ad impressions
    print("\n3/6  ad_impression_events")
    impressions = gen_ad_impressions(sessions, installs, rng)
    write_parquet(impressions, out_dir / "alpha_ad_impression_events.parquet", "alpha_ad_impression_events")

    # 4. Revenue
    print("\n4/6  revenue")
    revenue = gen_revenue(installs, rng)
    write_parquet(revenue, out_dir / "alpha_revenue.parquet", "alpha_revenue")

    # 5. Campaign
    print("\n5/6  campaign")
    campaign = gen_campaign(installs, daily_cpi, rng)
    write_parquet(campaign, out_dir / "alpha_campaign.parquet", "alpha_campaign")

    # 6. Races (chunked write)
    print("\n6/6  races")
    races_path = out_dir / "alpha_races.parquet"
    total_race_rows = gen_races(installs, races_path, rng)
    mb = races_path.stat().st_size / 1_048_576
    print(f"  ✓ alpha_races: {total_race_rows:,} rows → {races_path.name} ({mb:.1f} MB)")

    # Summary
    print("\n" + "=" * 60)
    print("Dataset summary:")
    print(f"  alpha_installs:             {len(installs):>12,}")
    print(f"  alpha_sessions:             {len(sessions):>12,}")
    print(f"  alpha_ad_impression_events: {len(impressions):>12,}")
    print(f"  alpha_revenue:              {len(revenue):>12,}")
    print(f"  alpha_campaign:             {len(campaign):>12,}")
    print(f"  alpha_races:                {total_race_rows:>12,}")

    # ── Scenario verification ────────────────────────────────────────────────────
    print(f"\nScenario verification (at --scale {args.scale}):")

    # S1: CPI↔LTV: Apple Search Ads should have highest CPI
    if len(campaign) > 0:
        cpi_check = campaign.groupby("channel")["cpi"].mean().sort_values(ascending=False)
        print(f"  S1 CPI ranking: {list(cpi_check.index)}")
        print(f"     (PASS if apple_search_ads first, then facebook_ads, then google_uac)")

    # S2: Fraud/settlement gap
    if len(impressions) > 0:
        total_reported = impressions["reported_revenue"].sum()
        total_settled  = impressions["settled_revenue"].sum()
        ratio = total_settled / total_reported if total_reported > 0 else 0
        status = "PASS" if 0.85 <= ratio <= 0.95 else "WARN"
        print(f"  S2 Settlement ratio: {ratio:.4f} (expected ~0.90) [{status}]")

    # S3: New targeting A/B retention
    if len(revenue) > 0 and "is_new_targeting" not in revenue.columns:
        # Join back through installs
        installs_fb = installs[installs["channel"] == "facebook_ads"][["user_id", "install_dt", "install_month", "is_new_targeting"]].copy()
        rev_d30 = revenue[
            (revenue["channel"] == "facebook_ads") &
            (revenue["install_month"] >= "2026-01") &
            (revenue["days_from_cohort"] == 30)
        ].copy()
        if len(rev_d30) > 0:
            print(f"  S3 Facebook Jan+ D30 retention (overall): {rev_d30['retention_rate'].mean():.4f}")
            print(f"     (vs old: ~0.13, new targeting expected ~0.18+)")

    # S4: Retention decay
    if len(revenue) > 0:
        ret_decay = (
            revenue[revenue["days_from_cohort"] == 30]
            .groupby("install_month")["retention_rate"]
            .mean()
            .sort_index()
        )
        print(f"  S4 Retention decay (Jan→Jun):")
        for month, ret in ret_decay.items():
            status = "PASS" if 0.09 <= ret <= 0.22 else "WARN"
            print(f"     {month}: {ret:.4f} [{status}]")

    # S5: iOS/Android ARPDAU ratio
    if len(revenue) > 0:
        platform_arpdau = (
            revenue[revenue["days_from_cohort"] == 7]
            .groupby("os")["arpdau"]
            .mean()
        )
        ios_arpdau = platform_arpdau.get("IOS", 0)
        android_arpdau = max(platform_arpdau.get("ANDROID", 1), 1e-9)
        ratio_5 = ios_arpdau / android_arpdau
        status = "PASS" if 1.4 <= ratio_5 <= 2.0 else "WARN"
        print(f"  S5 iOS/Android ARPDAU ratio: {ratio_5:.2f} (expected 1.5–1.8) [{status}]")

    # S6: Geo expansion risk
    if len(revenue) > 0:
        ltv_pivot = (
            revenue[revenue["days_from_cohort"].isin([14, 90])]
            .groupby(["country", "days_from_cohort"])["total_arpu"]
            .mean()
            .unstack("days_from_cohort")
        )
        if 14 in ltv_pivot.columns and 90 in ltv_pivot.columns:
            ltv_pivot.columns = ["d14", "d90"]
            ltv_pivot["ratio"] = ltv_pivot["d14"] / ltv_pivot["d90"].replace(0, float("nan"))
            print(f"  S6 D14/D90 LTV ratio by country:")
            for country, row in ltv_pivot.iterrows():
                marker = "← LatAm (expect ~0.68)" if country in {"Brazil", "Mexico"} else ""
                r = row.get("ratio", float("nan"))
                if not isinstance(r, float) or not r != r:  # not NaN
                    print(f"     {country:20s}: {r:.3f} {marker}")

    print(f"\nAll files written to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
