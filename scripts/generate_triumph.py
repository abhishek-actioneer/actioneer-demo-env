#!/usr/bin/env python3
"""
TRIUMPH — Synthetic global gaming dataset generator (USD)

Builds a DuckDB database at data/triumph.duckdb with marketing + finance
summary tables designed for cross‑team questions:
  - Can we scale paid spend from ~$1.5M/mo to $2.5M in Mar 2026?
  - Paid ROAS holds around ~0.9; blended ROAS ~1.6–2.0
  - CPI typically $5–6 (range $4–$8); cohort D90 LTV $4–$12 (net revenue)
  - Chargebacks 3–4% (no refunds/cancellations in schema; we track chargebacks)

Outputs inside DuckDB (all materialized for fast queries):
  - ad_daily              — Daily paid metrics per channel, country
  - installs              — One row per install (scaled; unique user_id)
  - revenue_cohort        — Cohort LTV curve (D0/1/3/7/14/30/60/90)
  - ltv_by_cohort         — Aggregated cohort LTV summary
  - cac_by_channel        — CPI, installs, ROI by month × channel × country
  - monthly_revenue_vs_spend — Paid vs blended net revenue and ROAS by month
  - cohort_retention_actuals — Actual D7/D14/D30 retention (approximate)

Dynamic dataset registration:
  - Writes data/datasets/triumph/config.json so the app auto‑picks it up
    (sourceType=duckdb; no TS changes required).

Optional calibration input:
  - adv_report.csv in project root (columns like date,channel,country,spend,
    impressions,clicks,installs,first_purchases). If present, we blend it to
    steer channel CPI/CPF trends and geo mix.

Usage:
  python3 scripts/generate_triumph.py \
    --start 2025-02-01 --end 2026-02-28 \
    --seed 42 --scale 1.0

Dependencies:
  pip install duckdb pandas numpy pyarrow python-dateutil
"""

from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import duckdb  # type: ignore
import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta


# ────────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────────

def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def month_range(start: date, end: date) -> List[date]:
    cur = date(start.year, start.month, 1)
    out = []
    while cur <= end:
        out.append(cur)
        cur = cur + relativedelta(months=1)
    return out


def days_in_month(d: date) -> int:
    nxt = (d + relativedelta(months=1)).replace(day=1)
    return (nxt - d).days


def daterange(start: date, end: date) -> List[date]:
    n = (end - start).days + 1
    return [start + timedelta(days=i) for i in range(n)]


def iso_week(d: date) -> str:
    return f"{d.isocalendar()[0]}-W{d.isocalendar()[1]:02d}"


def month_key(d: date) -> str:
    return d.strftime("%Y-%m")


# ────────────────────────────────────────────────────────────────────────────────
# Configuration (tuned to requirements)
# ────────────────────────────────────────────────────────────────────────────────

CHANNELS = [
    "google",
    "meta",
    "tiktok",
    "dv360",
    "criteo",
    "apple_search",
    "affiliates",
]

# Base CPI anchors in USD (channel mix produces ~$5–6 avg CPI)
CHANNEL_CPI_BASE = {
    "google": 5.80,
    "meta": 5.40,
    "tiktok": 4.80,
    "dv360": 5.20,
    "criteo": 4.90,
    "apple_search": 6.50,
    "affiliates": 3.80,
}

# Channel spend share (rough starting point; daily noise varies)
CHANNEL_SPEND_SHARE = {
    "google": 0.30,
    "meta": 0.25,
    "tiktok": 0.15,
    "dv360": 0.12,
    "criteo": 0.08,
    "apple_search": 0.05,
    "affiliates": 0.05,
}

# Day-of-week CPI multipliers [Mon..Sun]
DOW_CPI_MULT = [0.97, 1.00, 1.03, 1.06, 1.10, 0.93, 0.88]

# Country mix (global)
COUNTRIES = ["US", "GB", "DE", "FR", "CA", "AU", "BR", "IN"]
COUNTRY_WEIGHTS = {
    "US": 0.40,
    "GB": 0.10,
    "DE": 0.10,
    "FR": 0.08,
    "CA": 0.07,
    "AU": 0.05,
    "BR": 0.10,
    "IN": 0.10,
}

# Platform distribution varies by country
PLATFORM_IOS_PROB = {
    "US": 0.55, "GB": 0.52, "DE": 0.45, "FR": 0.44, "CA": 0.50, "AU": 0.52, "BR": 0.12, "IN": 0.10,
}

# Retention and LTV mechanics
REVENUE_DAYS = [0, 1, 3, 7, 14, 30, 60, 90]

# Chargebacks (applied to net)
CHARGEBACK_RATE = 0.035  # 3.5%


# ────────────────────────────────────────────────────────────────────────────────
# Core math for retention and LTV
# ────────────────────────────────────────────────────────────────────────────────

def retention_scalar(day: int, d30: float) -> float:
    if day == 0:
        return 1.0
    # Power-law decay anchored at D30
    return float(min(d30 * (30.0 / max(day, 1)) ** 0.65, 1.0))


def cumulative_ltv(arpdau: float, d30: float, up_to_day: int) -> float:
    return float(sum(arpdau * retention_scalar(d, d30) for d in range(up_to_day + 1)))


# ────────────────────────────────────────────────────────────────────────────────
# Generation
# ────────────────────────────────────────────────────────────────────────────────

@dataclass
class RunnerCfg:
    start: date
    end: date
    seed: int
    scale: float
    out_db: str
    project_root: str


def build_monthly_spend(start: date, end: date) -> Dict[str, float]:
    """Linear upward drift from $750k (Feb 2025) → $1.5M (Feb 2026)."""
    months = month_range(start, end)
    n = len(months)
    start_spend = 750_000.0
    end_spend = 1_500_000.0
    drift = np.linspace(start_spend, end_spend, n)
    out = {month_key(m): float(x) for m, x in zip(months, drift)}
    return out


def maybe_read_adv_report(project_root: str) -> Optional[pd.DataFrame]:
    path = os.path.join(project_root, "adv_report.csv")
    if os.path.exists(path):
        try:
            df = pd.read_csv(path)
            # Normalize expected columns if present
            lower = {c.lower(): c for c in df.columns}
            # minimally require date, channel, country, spend
            needed = ["date", "channel", "country", "spend"]
            if all(k in lower for k in needed):
                # Coerce date
                df[lower["date"]] = pd.to_datetime(df[lower["date"]]).dt.date
                return df
        except Exception:
            return None
    return None


def build_daily_ad_metrics(cfg: RunnerCfg, monthly_spend: Dict[str, float], adv: Optional[pd.DataFrame]) -> pd.DataFrame:
    rng = np.random.default_rng(cfg.seed)

    # Country and channel arrays for sampling
    countries = np.array(COUNTRIES)
    country_p = np.array([COUNTRY_WEIGHTS[c] for c in COUNTRIES], dtype=float)
    country_p /= country_p.sum()

    channels = np.array(CHANNELS)
    ch_spend_share = np.array([CHANNEL_SPEND_SHARE[ch] for ch in CHANNELS], dtype=float)
    ch_spend_share /= ch_spend_share.sum()

    # Precompute per-day base CPI with AR(1) noise per channel
    AR_PHI = 0.72
    cpi_series: Dict[Tuple[str, date], float] = {}
    epsilon = {ch: 0.0 for ch in CHANNELS}

    dates = daterange(cfg.start, cfg.end)
    for ch in CHANNELS:
        base = CHANNEL_CPI_BASE[ch]
        vol = {  # channel volatility for CPI noise
            "google": 0.07, "meta": 0.08, "tiktok": 0.10,
            "dv360": 0.09, "criteo": 0.09, "apple_search": 0.06, "affiliates": 0.05,
        }[ch]
        for i, d in enumerate(dates):
            # Gradual upward drift + small Q4 (Nov) seasonal uptick
            span = max(1, (cfg.end - cfg.start).days)
            trend = 1.0 + 0.15 * (i / span)  # +15% across the period
            if d.month == 11:
                trend *= 1.10
            dow = DOW_CPI_MULT[d.weekday()]
            epsilon[ch] = AR_PHI * epsilon[ch] + vol * float(rng.standard_normal())
            noise = math.exp(epsilon[ch])
            cpi = base * trend * dow * noise
            cpi_series[(ch, d)] = float(np.clip(cpi, 4.0, 8.0))

    rows = []
    for d in dates:
        mk = month_key(d)
        month_total = monthly_spend.get(mk, 0.0) * cfg.scale
        if month_total <= 0:
            continue

        # Split month total to daily baseline (uniform over days in month)
        dim = days_in_month(date(d.year, d.month, 1))
        base_day_budget = month_total / dim

        # Day-of-week budget modulation and random noise
        dow_mult = [0.96, 1.00, 1.02, 1.06, 1.10, 0.90, 0.88][d.weekday()]
        day_budget = base_day_budget * dow_mult * float(np.clip(rng.normal(1.0, 0.08), 0.85, 1.18))

        # Allocate to channels
        # Optionally blend historical adv_report if provided (country/channel share)
        ch_weights = ch_spend_share.copy()
        if adv is not None:
            adv_slice = adv[adv[adv.columns[0]].astype(str) == str(d)]  # date column is lower-cased earlier
            # If we can’t easily match, we’ll skip blending for this day
            if not adv_slice.empty:
                hist = adv_slice.groupby(adv.columns[1])[adv.columns[3]].sum()  # channel, spend
                hist = hist.reindex(CHANNELS).fillna(0.0).values
                if hist.sum() > 0:
                    hist = hist / hist.sum()
                    ch_weights = 0.6 * ch_weights + 0.4 * hist
        ch_weights = ch_weights / ch_weights.sum()

        # Country weights per day
        country_weights = country_p.copy()
        if adv is not None:
            adv_slice = adv[adv[adv.columns[0]].astype(str) == str(d)]
            if not adv_slice.empty:
                hist = adv_slice.groupby(adv.columns[2])[adv.columns[3]].sum()  # country, spend
                hist = hist.reindex(COUNTRIES).fillna(0.0).values
                if hist.sum() > 0:
                    hist = hist / hist.sum()
                    country_weights = 0.6 * country_weights + 0.4 * hist
        country_weights = country_weights / country_weights.sum()

        # Sample per-channel allocations
        for ch, ch_w in zip(channels, ch_weights):
            ch_spend = float(day_budget * ch_w)
            if ch_spend <= 0:
                continue

            # CPI for the channel/day
            cpi = cpi_series[(ch, d)]
            installs = int(max(0, ch_spend / max(cpi, 0.01)))

            # Derive impressions/clicks with simple CTR/CTI model
            # CTR ~ 1.1% (varies by channel); CTI (click->install) ~ 12–18%
            ctr = {
                "google": 0.012, "meta": 0.011, "tiktok": 0.013,
                "dv360": 0.010, "criteo": 0.009, "apple_search": 0.020, "affiliates": 0.018,
            }[ch]
            cti = {
                "google": 0.16, "meta": 0.15, "tiktok": 0.14,
                "dv360": 0.13, "criteo": 0.12, "apple_search": 0.18, "affiliates": 0.20,
            }[ch]
            clicks = max(1, int(installs / max(cti, 1e-6)))
            impressions = max(1, int(clicks / max(ctr, 1e-6)))

            # Split installs by country/platform
            # We’ll record country‑level ad rows by splitting day spend across countries
            for country, w in zip(countries, country_weights):
                part_spend = ch_spend * float(w)
                if part_spend < 50:
                    continue
                part_cpi = cpi  # simple — CPI geo effects embedded in noise
                part_installs = int(max(0, part_spend / max(part_cpi, 0.01)))
                part_clicks = max(1, int(part_installs / max(cti, 1e-6)))
                part_impr = max(1, int(part_clicks / max(ctr, 1e-6)))

                rows.append({
                    "date": d,
                    "channel": ch,
                    "country": country,
                    "spend_usd": round(part_spend, 2),
                    "impressions": int(part_impr),
                    "clicks": int(part_clicks),
                    "installs": int(part_installs),
                    "cpi": round(part_cpi, 2),
                })

    ad_daily = pd.DataFrame(rows)
    return ad_daily


def gen_installs(ad_daily: pd.DataFrame, cfg: RunnerCfg) -> pd.DataFrame:
    rng = np.random.default_rng(cfg.seed + 1)
    # Aggregate installs by day × channel × country for user_id synthesis
    grp = (
        ad_daily.groupby(["date", "channel", "country"], observed=True)["installs"]
        .sum()
        .reset_index()
    )

    # Generate platform split and user rows
    rows = []
    uid = 1
    for _, r in grp.iterrows():
        d = r["date"]
        ch = r["channel"]
        co = r["country"]
        n = int(r["installs"])  # may be large; we can sample if scale < 1
        n = int(n * cfg.scale)
        if n <= 0:
            continue
        ios_p = PLATFORM_IOS_PROB.get(co, 0.4)
        is_ios = rng.random(n) < ios_p
        for i in range(n):
            rows.append({
                "user_id": f"u_{uid:08d}",
                "install_date": d,
                "install_week": iso_week(d),
                "install_month": month_key(d),
                "channel": ch,
                "country": co,
                "platform": "ios" if is_ios[i] else "android",
            })
            uid += 1

    return pd.DataFrame(rows)


def gen_revenue_cohort(installs: pd.DataFrame, ad_daily: pd.DataFrame, cfg: RunnerCfg) -> pd.DataFrame:
    rng = np.random.default_rng(cfg.seed + 2)

    # Build CPI by (date, channel) for paid ROI targeting
    cpi_map = (
        ad_daily.groupby(["date", "channel"], observed=True)[["spend_usd", "installs"]]
        .sum()
        .reset_index()
    )
    cpi_map["cpi"] = cpi_map["spend_usd"] / cpi_map["installs"].clip(lower=1)
    cpi_lookup = {(r["date"], r["channel"]): float(r["cpi"]) for _, r in cpi_map.iterrows()}

    # Effective D30 base retention per month (casual racing): decays slightly
    months = sorted(installs["install_month"].unique())
    base_d30_seq = np.linspace(0.14, 0.10, len(months))  # 14% → 10%
    d30_map = {m: float(x) for m, x in zip(months, base_d30_seq)}

    # Channel LTV quality multipliers (paid vs organic differences applied later)
    ch_quality = {
        "google": 1.05,
        "meta": 1.00,
        "tiktok": 0.95,
        "dv360": 0.92,
        "criteo": 0.90,
        "apple_search": 1.08,
        "affiliates": 0.98,
    }

    # For paid cohorts, we target ~0.9 ROAS at D90 (net revenue / paid spend)
    # => avg D90 LTV ~= 0.9 * CPI with jitter, clipped within $4–$12
    # For organic/ref, we set higher D90 LTV so blended ROAS lands ~1.6–2.0.

    # Group installs by cohort
    grp = (
        installs.groupby(["install_date", "install_month", "install_week", "channel", "country", "platform"], observed=True)
        ["user_id"].count().reset_index().rename(columns={"user_id": "cohort_installs"})
    )

    rows = []
    for _, g in grp.iterrows():
        cohort_date = g["install_date"]
        install_month = g["install_month"]
        install_week = g["install_week"]
        channel = g["channel"]
        country = g["country"]
        platform = g["platform"]
        n = int(g["cohort_installs"])  # cohort size
        if n <= 0:
            continue

        # Base D30 retention
        d30 = d30_map.get(install_month, 0.12)

        # Paid vs organic targeting via channel name
        is_paid = channel in CHANNELS
        # Look up CPI for paid; fallback to channel base
        cpi = cpi_lookup.get((cohort_date, channel), CHANNEL_CPI_BASE.get(channel, 5.5))

        # Target D90 LTV
        if is_paid:
            target_d90 = float(np.clip(0.9 * cpi * float(np.clip(np.random.normal(1.0, 0.08), 0.85, 1.15)), 4.0, 12.0))
        else:
            # Organic/referral (if any created later) — not used here; installs come from paid only in this generator
            target_d90 = 1.6 * cpi

        # Convert target D90 LTV to arpdau via inverse of cumulative LTV approx
        # Use channel quality multiplier to spread around target
        quality = ch_quality.get(channel, 1.0)
        # Estimate denominator ~ sum(retention_scalar(d, d30)) over 0..90
        denom = sum(retention_scalar(d, d30) for d in range(91))
        arpdau = (target_d90 / max(denom, 1e-9)) * quality

        # Build records for requested REVENUE_DAYS
        running = 0.0
        ltv_by_day = {}
        for d in range(max(REVENUE_DAYS) + 1):
            daily = arpdau * retention_scalar(d, d30)
            running += daily
            if d in REVENUE_DAYS:
                ltv_by_day[d] = running

        # Apply chargebacks (reduce net by 3.5%, roughly constant across days)
        def net_after_chargeback(x: float) -> float:
            return max(0.0, x * (1.0 - CHARGEBACK_RATE))

        for day in REVENUE_DAYS:
            total_ltv = net_after_chargeback(ltv_by_day.get(day, running))
            ret = retention_scalar(day, d30)
            arpu_today = net_after_chargeback(arpdau * ret)
            rows.append({
                "cohort_date": cohort_date,
                "install_week": install_week,
                "install_month": install_month,
                "channel": channel,
                "country": country,
                "platform": platform,
                "days_from_cohort": int(day),
                "period": f"D{day}",
                "cohort_installs": n,
                "retained_users": int(n * ret),
                "retention_rate": round(ret, 6),
                "arpu": round(arpu_today, 6),
                "total_arpu": round(total_ltv, 6),
                "arpdau": round(arpdau, 6),
            })

    revenue = pd.DataFrame(rows)
    return revenue


def build_duckdb(cfg: RunnerCfg, ad_daily: pd.DataFrame, installs: pd.DataFrame, revenue: pd.DataFrame) -> None:
    os.makedirs(os.path.dirname(cfg.out_db), exist_ok=True)
    con = duckdb.connect(cfg.out_db)

    # Import tables
    con.execute("PRAGMA threads=4")
    con.register("ad_daily_df", ad_daily)
    con.register("installs_df", installs)
    con.register("revenue_df", revenue)

    con.execute("CREATE OR REPLACE TABLE ad_daily AS SELECT * FROM ad_daily_df")
    con.execute("CREATE OR REPLACE TABLE installs AS SELECT * FROM installs_df")
    con.execute("CREATE OR REPLACE TABLE revenue_cohort AS SELECT * FROM revenue_df")

    # ── Creative catalog and daily breakdown (simple split 50/30/20 per channel) ──
    con.execute(
        """
        CREATE OR REPLACE TABLE ad_creative_catalog AS
        SELECT * FROM (
          VALUES
            ('google',        1001, 'square',    'Speed Rush',     1),
            ('google',        1002, 'landscape', 'Nitro Nights',   2),
            ('google',        1003, 'portrait',  'Drift Kings',    3),
            ('meta',          1101, 'square',    'City Sprint',    1),
            ('meta',          1102, 'portrait',  'Turbo Neon',     2),
            ('meta',          1103, 'landscape', 'Pixel Raceway',  3),
            ('tiktok',        1201, 'vertical',  'Swipe N Race',   1),
            ('tiktok',        1202, 'vertical',  'Tap to Drift',   2),
            ('tiktok',        1203, 'vertical',  'Daily Challenges',3),
            ('dv360',         1301, 'banner',    'World Tour',     1),
            ('dv360',         1302, 'banner',    'Pro Cup',        2),
            ('dv360',         1303, 'banner',    'Rally Rush',     3),
            ('criteo',        1401, 'banner',    'Garage Upgrade', 1),
            ('criteo',        1402, 'banner',    'New Cars Drop',  2),
            ('criteo',        1403, 'banner',    'League Season',  3),
            ('apple_search',  1501, 'search',    'Race Now',       1),
            ('apple_search',  1502, 'search',    'Tune & Race',    2),
            ('apple_search',  1503, 'search',    'PVP Events',     3),
            ('affiliates',    1601, 'native',    'Invite Bonus',   1),
            ('affiliates',    1602, 'native',    'Starter Pack',   2),
            ('affiliates',    1603, 'native',    'VIP Bundle',     3)
        ) AS t(channel, creative_id, format, headline, creative_rank);

        CREATE OR REPLACE TABLE ad_creative_daily AS
        WITH split AS (
          SELECT a.date, a.channel, a.country, a.spend_usd, a.impressions, a.clicks, a.installs, a.cpi,
                 c.creative_id, c.format, c.headline, c.creative_rank,
                 CASE c.creative_rank WHEN 1 THEN 0.50 WHEN 2 THEN 0.30 ELSE 0.20 END AS share
          FROM ad_daily a
          JOIN ad_creative_catalog c ON a.channel = c.channel
        )
        SELECT
          date, channel, country, creative_id, format, headline,
          ROUND(spend_usd * share, 2)            AS spend_usd,
          CAST(ROUND(impressions * share) AS INT) AS impressions,
          CAST(ROUND(clicks * share) AS INT)      AS clicks,
          CAST(ROUND(installs * share) AS INT)    AS installs,
          CASE WHEN ROUND(installs * share) > 0 THEN ROUND((spend_usd * share) / NULLIF(ROUND(installs * share), 0), 2) ELSE 0 END AS cpi
        FROM split
        ORDER BY date, channel, country, creative_id;
        """
    )

    # ── Campaign catalog and daily breakdown (simple split 60/40 per channel) ──
    con.execute(
        """
        CREATE OR REPLACE TABLE ad_campaign_catalog AS
        SELECT * FROM (
          VALUES
            ('google',        2001, 'Scale Up Core', 1),
            ('google',        2002, 'Seasonal Boost', 2),
            ('meta',          2101, 'Scale Up Core', 1),
            ('meta',          2102, 'Seasonal Boost', 2),
            ('tiktok',        2201, 'Scale Up Core', 1),
            ('tiktok',        2202, 'Seasonal Boost', 2),
            ('dv360',         2301, 'Scale Up Core', 1),
            ('dv360',         2302, 'Seasonal Boost', 2),
            ('criteo',        2401, 'Scale Up Core', 1),
            ('criteo',        2402, 'Seasonal Boost', 2),
            ('apple_search',  2501, 'Scale Up Core', 1),
            ('apple_search',  2502, 'Seasonal Boost', 2),
            ('affiliates',    2601, 'Scale Up Core', 1),
            ('affiliates',    2602, 'Seasonal Boost', 2)
        ) AS t(channel, campaign_id, campaign_name, campaign_rank);

        CREATE OR REPLACE TABLE ad_campaign_daily AS
        WITH split AS (
          SELECT a.date, a.channel, a.country, a.spend_usd, a.impressions, a.clicks, a.installs, a.cpi,
                 c.campaign_id, c.campaign_name, c.campaign_rank,
                 CASE c.campaign_rank WHEN 1 THEN 0.60 ELSE 0.40 END AS share
          FROM ad_daily a
          JOIN ad_campaign_catalog c ON a.channel = c.channel
        )
        SELECT
          date, channel, country, campaign_id, campaign_name,
          ROUND(spend_usd * share, 2)             AS spend_usd,
          CAST(ROUND(impressions * share) AS INT)  AS impressions,
          CAST(ROUND(clicks * share) AS INT)       AS clicks,
          CAST(ROUND(installs * share) AS INT)     AS installs,
          CASE WHEN ROUND(installs * share) > 0 THEN ROUND((spend_usd * share) / NULLIF(ROUND(installs * share), 0), 2) ELSE 0 END AS cpi
        FROM split
        ORDER BY date, channel, country, campaign_id;
        """
    )

    # Summary: LTV by cohort
    con.execute(
        """
        CREATE OR REPLACE TABLE ltv_by_cohort AS
        SELECT
          cohort_date, install_week, install_month, channel, country, platform,
          days_from_cohort, period,
          SUM(cohort_installs) AS cohort_installs,
          AVG(retention_rate) AS avg_retention,
          AVG(arpu) AS avg_arpu,
          AVG(total_arpu) AS avg_projected_ltv,
          AVG(arpdau) AS avg_arpdau
        FROM revenue_cohort
        GROUP BY 1,2,3,4,5,6,7,8
        ORDER BY cohort_date, channel, country, days_from_cohort
        """
    )

    # Summary: CAC & ROI per channel × country × month
    con.execute(
        """
        CREATE OR REPLACE TABLE cac_by_channel AS
        WITH c AS (
          SELECT DATE_TRUNC('month', date)::DATE AS month, channel, country,
                 SUM(spend_usd) AS total_spend,
                 SUM(installs) AS installs,
                 CASE WHEN SUM(installs) > 0 THEN SUM(spend_usd) / SUM(installs) ELSE 0 END AS cpi
          FROM ad_daily GROUP BY 1,2,3
        ),
        l AS (
          SELECT DATE_TRUNC('month', cohort_date)::DATE AS month, channel, country,
                 AVG(CASE WHEN days_from_cohort = 90 THEN total_arpu END) AS d90_ltv
          FROM revenue_cohort GROUP BY 1,2,3
        )
        SELECT c.month, c.channel, c.country, c.total_spend, c.installs, ROUND(c.cpi, 2) AS cpi,
               ROUND(COALESCE(l.d90_ltv, 0), 4) AS avg_d90_ltv,
               CASE WHEN c.cpi > 0 THEN ROUND(COALESCE(l.d90_ltv, 0) / c.cpi, 3) ELSE 0 END AS roi_d90
        FROM c LEFT JOIN l USING (month, channel, country)
        ORDER BY c.month, c.channel, c.country
        """
    )

    # Summary: Paid vs blended net revenue and ROAS (by month)
    # Paid revenue approximation = D90 LTV earned from paid cohorts in this month
    # Blended revenue adds organic/referral uplift modeled as a multiplier on paid spend.
    # We target paid ROAS ~0.9 and blended ROAS ~1.6–2.0 overall.
    con.execute(
        """
        CREATE OR REPLACE TABLE monthly_revenue_vs_spend AS
        WITH spend AS (
          SELECT DATE_TRUNC('month', date)::DATE AS month,
                 SUM(spend_usd) AS paid_spend
          FROM ad_daily GROUP BY 1
        ),
        paid_rev AS (
          SELECT DATE_TRUNC('month', cohort_date)::DATE AS month,
                 SUM(CASE WHEN days_from_cohort = 90 THEN cohort_installs * total_arpu ELSE 0 END) AS paid_net_revenue_d90
          FROM revenue_cohort
          GROUP BY 1
        )
        SELECT s.month,
               s.paid_spend,
               COALESCE(pr.paid_net_revenue_d90, 0) AS paid_net_revenue_d90,
               -- Blend factor tuned to land ~1.6–2.0 blended ROAS overall
               ROUND(COALESCE(pr.paid_net_revenue_d90, 0) * 1.9, 2) AS blended_net_revenue_d90,
               CASE WHEN s.paid_spend > 0 THEN ROUND(COALESCE(pr.paid_net_revenue_d90, 0) / s.paid_spend, 3) ELSE 0 END AS roas_paid,
               CASE WHEN s.paid_spend > 0 THEN ROUND((COALESCE(pr.paid_net_revenue_d90, 0) * 1.9) / s.paid_spend, 3) ELSE 0 END AS roas_blended
        FROM spend s
        LEFT JOIN paid_rev pr USING (month)
        ORDER BY s.month
        """
    )

    # Approximate actual retention from installs (no session table to keep DB size sane)
    con.execute(
        """
        CREATE OR REPLACE TABLE cohort_retention_actuals AS
        WITH cohorts AS (
          SELECT install_month, channel, country, platform, COUNT(*) AS cohort_size
          FROM installs GROUP BY 1,2,3,4
        ),
        model AS (
          SELECT install_month, channel, country, platform,
                 AVG(CASE WHEN days_from_cohort BETWEEN 6 AND 8 THEN retention_rate END) AS d7_ret,
                 AVG(CASE WHEN days_from_cohort BETWEEN 13 AND 15 THEN retention_rate END) AS d14_ret,
                 AVG(CASE WHEN days_from_cohort BETWEEN 28 AND 30 THEN retention_rate END) AS d30_ret
          FROM revenue_cohort GROUP BY 1,2,3,4
        )
        SELECT c.install_month, c.channel, c.country, c.platform,
               c.cohort_size,
               ROUND(c.cohort_size * COALESCE(m.d7_ret, 0)) AS d7_active,
               ROUND(c.cohort_size * COALESCE(m.d14_ret, 0)) AS d14_active,
               ROUND(c.cohort_size * COALESCE(m.d30_ret, 0)) AS d30_active,
               ROUND(COALESCE(m.d7_ret, 0), 4) AS d7_retention,
               ROUND(COALESCE(m.d14_ret, 0), 4) AS d14_retention,
               ROUND(COALESCE(m.d30_ret, 0), 4) AS d30_retention
        FROM cohorts c LEFT JOIN model m USING (install_month, channel, country, platform)
        ORDER BY install_month, channel, country
        """
    )

    con.execute("CHECKPOINT")
    con.close()


def write_dynamic_dataset_config(cfg: RunnerCfg, start: date, end: date) -> None:
    ds_dir = os.path.join(cfg.project_root, "data", "datasets", "triumph")
    os.makedirs(ds_dir, exist_ok=True)
    config = {
        "id": "triumph",
        "label": "TRIUMPH",
        "dbFile": "data/triumph.duckdb",
        "sourceType": "duckdb",
        "primaryTable": "installs",
        "userIdField": "user_id",
        "dateField": "install_date",
        "dateRange": {"start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d")},
        "currency": "$",
        "summaryTableHint": (
            "Prefer summary tables when possible: ltv_by_cohort, monthly_revenue_vs_spend, "
            "cac_by_channel, cohort_retention_actuals. Net revenue is post-chargeback; do not use the word take rate."
        ),
        "domainHints": (
            "Paid ROAS hovers near 0.9 at D90; blended ROAS is ~1.6–2.0 because organic/referral cohorts add revenue without spend. "
            "Chargebacks ~3–4% reduce net revenue. CPI typically $5–6 (range $4–$8). D90 LTV ranges $4–$12 depending on channel/country/platform."
        ),
        "welcomeSubtitle": "Analyze paid vs blended performance, CPI/CAC, and cohort LTV to decide scaling to $2.5M/mo.",
        "reportMeta": {
            "dbName": "triumph.duckdb",
            "dateRangeLabel": f"{start.strftime('%b %Y')} – {end.strftime('%b %Y')}",
        },
        "schemaContext": f"""DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

GAME: TRIUMPH — mobile UA analytics dataset
DATE RANGE: {start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')}
CHANNELS: facebook, admob, moloco, vungle, organic
COUNTRIES: US, GB, DE, CA, FR, IN, BR, MX, ID, others
PLATFORMS: ios, android

RAW TABLES:

TABLE: ad_daily (daily ad spend / performance)
  - date             DATE     -- calendar date
  - channel          VARCHAR  -- facebook | admob | moloco | vungle | organic
  - country          VARCHAR
  - spend_usd        DOUBLE   -- daily UA spend in USD
  - impressions      INTEGER
  - clicks           INTEGER
  - installs         INTEGER
  - cpi              DOUBLE   -- cost per install (spend_usd / installs)

TABLE: installs (one row per user)
  - user_id          VARCHAR  -- unique user identifier
  - install_date     DATE
  - install_week     VARCHAR  -- ISO week e.g. "2025-W06"
  - install_month    VARCHAR  -- e.g. "2025-02"
  - channel          VARCHAR
  - country          VARCHAR
  - platform         VARCHAR  -- ios | android

TABLE: revenue_cohort (cohort-level revenue / retention by day-offset)
  - cohort_date      DATE
  - install_week     VARCHAR
  - install_month    VARCHAR
  - channel          VARCHAR
  - country          VARCHAR
  - platform         VARCHAR
  - days_from_cohort INTEGER   -- 0, 1, 3, 7, 14, 30, 60, 90
  - period           VARCHAR   -- "D0", "D7", "D30", etc.
  - cohort_installs  INTEGER
  - retained_users   INTEGER
  - retention_rate   DOUBLE
  - arpu             DOUBLE    -- revenue per installed user on this day
  - total_arpu       DOUBLE    -- cumulative LTV from D0 through this day
  - arpdau           DOUBLE    -- revenue per daily active user

PRE-MATERIALISED SUMMARY TABLES (prefer these for aggregated queries):

TABLE: ltv_by_cohort
  - cohort_date, install_week, install_month, channel, country, platform
  - days_from_cohort, period
  - cohort_installs, avg_retention, avg_arpu, avg_projected_ltv, avg_arpdau

TABLE: cac_by_channel
  - month            DATE     -- first day of month; filter: month = '2025-08-01'::DATE
  - channel, country
  - total_spend, installs, cpi
  - avg_d90_ltv, roi_d90

TABLE: monthly_revenue_vs_spend
  - month            DATE     -- first day of month
  - paid_spend                -- total paid UA spend that month
  - paid_net_revenue_d90      -- net revenue from paid cohorts at D90
  - blended_net_revenue_d90   -- net revenue from all cohorts (paid + organic) at D90
  - roas_paid                 -- paid_net_revenue_d90 / paid_spend
  - roas_blended              -- blended_net_revenue_d90 / paid_spend

TABLE: cohort_retention_actuals
  - install_month, channel, country, platform
  - cohort_size
  - d7_active, d14_active, d30_active
  - d7_retention, d14_retention, d30_retention

TABLE: ad_creative_daily (creative-level performance)
  - date, channel, country
  - creative_id, format, headline
  - spend_usd, impressions, clicks, installs, cpi

TABLE: ad_campaign_daily (campaign-level performance)
  - date, channel, country
  - campaign_id, campaign_name
  - spend_usd, impressions, clicks, installs, cpi
""",
    }
    tmp = os.path.join(ds_dir, "config.json.tmp")
    with open(tmp, "w") as f:
        json.dump(config, f, indent=2)
    os.replace(tmp, os.path.join(ds_dir, "config.json"))


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate TRIUMPH DuckDB dataset")
    ap.add_argument("--start", default="2025-02-01", help="Start date (YYYY-MM-DD)")
    ap.add_argument("--end", default="2026-02-28", help="End date (YYYY-MM-DD)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--scale", type=float, default=1.0, help="Scale factor (0.1..1.0) for row counts")
    args = ap.parse_args()

    start = parse_date(args.start)
    end = parse_date(args.end)
    if start > end:
        raise SystemExit("--start must be <= --end")
    if not (0.01 <= args.scale <= 1.0):
        raise SystemExit("--scale must be between 0.01 and 1.0")

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    out_db = os.path.join(project_root, "data", "triumph.duckdb")
    cfg = RunnerCfg(start=start, end=end, seed=args.seed, scale=args.scale, out_db=out_db, project_root=project_root)

    print("TRIUMPH synthetic generator")
    print(f"Range: {start} → {end} | seed={args.seed} | scale={args.scale}")

    # 1) Monthly budgets (750k → 1.5M)
    monthly = build_monthly_spend(start, end)

    # 2) Optional calibration
    adv = maybe_read_adv_report(project_root)
    if adv is not None:
        print("Found adv_report.csv — blending channel/country shares where applicable.")
    else:
        print("adv_report.csv not found in repo root — using defaults.")

    # 3) Daily ad metrics
    print("Generating daily ad metrics...")
    ad_daily = build_daily_ad_metrics(cfg, monthly, adv)
    print(f"  ad_daily rows: {len(ad_daily):,}")

    # 4) Installs (user-level; can be large — gated by --scale)
    print("Generating installs (user-level)...")
    installs = gen_installs(ad_daily, cfg)
    print(f"  installs rows: {len(installs):,}")

    # 5) Cohort revenue (D90 LTV net, paid ROAS ~0.9 in aggregate)
    print("Computing revenue cohort curves...")
    revenue = gen_revenue_cohort(installs, ad_daily, cfg)
    print(f"  revenue_cohort rows: {len(revenue):,}")

    # 6) Build DuckDB and summaries
    print("Writing DuckDB and materialized summaries...")
    build_duckdb(cfg, ad_daily, installs, revenue)
    print(f"  ✓ Wrote {cfg.out_db}")

    # 7) Dynamic dataset config
    print("Writing dynamic dataset config (data/datasets/triumph/config.json)...")
    write_dynamic_dataset_config(cfg, start, end)
    print("  ✓ Dataset registered: triumph")

    # 8) Quick ROAS check
    con = duckdb.connect(cfg.out_db, read_only=True)
    paid = con.execute("SELECT SUM(paid_spend), SUM(paid_net_revenue_d90) FROM monthly_revenue_vs_spend").fetchone()
    blended = con.execute("SELECT SUM(paid_spend), SUM(blended_net_revenue_d90) FROM monthly_revenue_vs_spend").fetchone()
    con.close()
    if paid and blended and paid[0] and blended[0]:
        paid_roas = float(paid[1]) / float(paid[0]) if paid[0] else 0.0
        blended_roas = float(blended[1]) / float(blended[0]) if blended[0] else 0.0
        print(f"Paid ROAS (sum):    {paid_roas:.3f} (target ~0.9)")
        print(f"Blended ROAS (sum): {blended_roas:.3f} (target ~1.6–2.0)")

    print("Done. Launch the app and select dataset: TRIUMPH")


if __name__ == "__main__":
    main()
