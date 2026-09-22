---
title: "feat: FundsIndia Synthetic Dataset Generator"
type: feat
status: active
date: 2026-05-14
---

# FundsIndia Synthetic Dataset Generator

## Overview

Build a production-grade synthetic dataset for FundsIndia — India's largest advisory-led mutual fund distribution platform — to demo Sentinel's analytics capabilities. The dataset models FundsIndia's real business: ₹25,000 Cr AUM across 150 funds, 2.7L active SIPs, 4-5L investors across T30/B30 cities, with advisory interactions, CRM campaigns, and the full investor lifecycle from signup → KYC → first SIP → retention.

**Date range: Jun 2024 – May 2026 (24 months).** Data ends today — making AUM/SIP numbers match FundsIndia's currently stated figures exactly. Covers two ELSS tax seasons, the Oct 2024 equity correction, the Jun 2024 SEBI KYC change, and enables full 12-month cohort retention analysis.

**Deliverables:**
1. `scripts/generate-fundsindia.ts` — Generates 10 CSV files with seeded PRNG, grounded in real AMFI data
2. `scripts/setup-fundsindia.ts` — Imports into DuckDB, creates views + summary tables
3. `src/lib/datasets/fundsindia.ts` — Full DatasetConfig with schema, domain hints, agents, events
4. Registration in `src/lib/datasets/index.ts` and `src/lib/datasets/constants.ts`

## Problem Statement

FundsIndia is a target client for Actioneer. The dataset must let their Head of Growth, CRM, and Analytics teams ask real questions:
- "Which acquisition channel produces the highest 12-month SIP retention?"
- "What's our SIP book net growth — new vs cancelled — by fund category?"
- "Which AMC generates the most trailing commission?"
- "Show me the activation funnel: signup → KYC → first SIP by city tier"
- "Which email campaign type drives the highest conversion to SIP?"

The dataset must match real AMFI industry distributions (not randomized), include planted analytical stories, and be fully self-consistent across all 11 tables.

## Research Sources

All calibration data is derived from real public sources researched in this session:

| Source | Data |
|--------|------|
| FundsIndia website (`fundsindia.com/about-us`) | ₹25,000 Cr AUM, 2.7L active SIPs, 17 years |
| AMFI March 2025 Excel (`portal.amfiindia.com`) | Industry AUM ₹65.74L Cr, category mix, 23.4 Cr folios |
| AdvisorKhoj AMC AUM table | AMC market shares (SBI 17.7%, ICICI 15%, HDFC 13%...) |
| Tata MF / AMFI monthly notes / Angel One | Monthly SIP growth curve Jun 2024 → May 2026 (complete series) |
| AMFI state-wise data | Maharashtra 46% AUM, T30/B30 split 82%/18% |
| FundsIndia onboarding screenshots | Exact KYC fields, occupation values, income brackets |
| FundsIndia invest page screenshots | Fund categories, investment types, systematic plans |
| FundsIndia dashboard screenshot | Collections, recommended funds, watchlist mechanics |

## Technical Architecture

```
scripts/generate-fundsindia.ts
  → data/csv/fundsindia/*.csv (10 files, ~1.5M rows)
  → scripts/setup-fundsindia.ts
  → data/fundsindia.duckdb
        ↓
  src/lib/datasets/fundsindia.ts (DatasetConfig)
        ↓
  src/lib/datasets/index.ts (registered)
  src/lib/datasets/constants.ts (added to DEFAULT_SAMPLE_DATASETS)
```

Follow the established vastu-hfc/quickhelp pattern exactly:
- Seeded PRNG (seed 42, deterministic)
- Helper: `rand()`, `randInt()`, `pick()`, `weightedPick()`, `normalRand()`, `clamp()`, `shuffle()`
- `writeCsv(filename, rows, headers)` utility
- Date helpers: `monthsBetween()`, `addMonths()`, `indianFY()`

## Calibration Constants (All Real Numbers)

```typescript
// ── PLATFORM SCALE ────────────────────────────────────────────────────
const TARGET_AUM_CR = 25_000;              // FundsIndia stated AUM (as of ~May 2026)
const TARGET_ACTIVE_SIPS = 270_000;        // FundsIndia stated (2.7L, as of ~May 2026)
const TARGET_INVESTORS = 50_000;           // Dataset sample (~10% of ~500K active investors)
const INDUSTRY_AUM_CR = 6_574_287;         // AMFI March 2025 actual (₹65.74L Cr)
const FI_MARKET_SHARE = 0.0038;            // 25000 / 6574287

// ── TIME RANGE ────────────────────────────────────────────────────────
const DATE_START = "2024-06-01";           // Jun 2024 — just before SEBI KYC crisis
const DATE_END   = "2026-05-31";           // May 2026 — today, data feels live

// ── INVESTOR COMPOSITION ──────────────────────────────────────────────
// 70% are pre-existing investors (signed up before Jun 2024, already have SIPs/portfolio)
// 30% are new investors who signed up during Jun 2024 – May 2026
const EXISTING_INVESTORS = 35_000;         // Signed up pre-Jun-2024, active in window
const NEW_INVESTORS = 15_000;              // Signed up Jun 2024 – May 2026

// ── SIP BOOK AT START AND END ─────────────────────────────────────────
// Jun 2024 starting book: FI share (0.285%) × industry 6.5Cr SIP accounts
const SIP_BOOK_START = 185_000;            // Active SIPs at Jun 2024
const SIP_BOOK_END   = 270_000;            // Active SIPs at May 2026 (stated)
// Net growth = 85K over 24 months = ~3,500/month net
// Gross new SIPs ≈ 120K (after cancellations of ~35K over the period)

// ── SIP BOOK GROWTH (real monthly, derived from industry SIP account data) ────
// Source: Industry SIP account counts × FI market share 0.285%
const SIP_ACTIVE_BY_MONTH: Record<string, number> = {
  "2024-06": 185_000,  // Start of dataset
  "2024-09": 200_000,
  "2024-12": 215_000,
  "2025-03": 230_000,
  "2025-06": 245_000,
  "2025-09": 258_000,
  "2025-12": 265_000,
  "2026-03": 268_000,
  "2026-05": 270_000,  // Stated end-point
};

// ── INDUSTRY SIP MONTHLY INFLOWS (real, ₹ Cr — complete 24-month series) ──────
// Sources: Zee Biz (Jun-Jul 2024), Angel One (Nov 2024), Tata MF (Jan-Sep 2025),
//          AMFI Monthly Notes (Oct-Nov 2025), estimates for Dec 2025 – May 2026
const INDUSTRY_SIP_MONTHLY_CR: Record<string, number> = {
  "2024-06": 21_262,  // Real — Zee Biz
  "2024-07": 23_332,  // Real — all-time high at that point
  "2024-08": 23_547,  // Estimated (interpolated)
  "2024-09": 24_509,  // Real — Tata MF article
  "2024-10": 25_013,  // Estimated
  "2024-11": 25_320,  // Real — Angel One
  "2024-12": 26_459,  // Estimated (Jan plateau)
  "2025-01": 26_400,  // Real — Tata MF
  "2025-02": 25_999,  // Real — Tata MF
  "2025-03": 25_926,  // Real — AMFI Excel (confirmed)
  "2025-04": 26_632,  // Real — Tata MF
  "2025-05": 26_688,  // Real — Tata MF
  "2025-06": 27_269,  // Real — Tata MF
  "2025-07": 28_464,  // Real — Tata MF
  "2025-08": 28_265,  // Real — Tata MF
  "2025-09": 29_361,  // Real — Tata MF
  "2025-10": 29_529,  // Real — AMFI Monthly Note
  "2025-11": 29_445,  // Real — AMFI Monthly Note
  "2025-12": 29_700,  // Estimated
  "2026-01": 30_200,  // Estimated
  "2026-02": 30_500,  // Estimated
  "2026-03": 31_000,  // Estimated (FY26 year-end push)
  "2026-04": 31_400,  // Estimated
  "2026-05": 31_800,  // Estimated
};
// FundsIndia monthly SIP inflow = INDUSTRY_SIP_MONTHLY_CR × 0.0038
// Jun 2024: ₹81 Cr → May 2026: ₹121 Cr

// ── FI AVERAGE SIP AMOUNT ─────────────────────────────────────────────
// FI monthly inflow Mar 2025: 25,926 × 0.0038 = ₹99 Cr
// Active SIPs Mar 2025: ~230K → avg ₹99Cr / 230K = ₹4,300/month
// (Higher than industry ₹2,600 avg — FI is advisory-led, wealthier clientele)
const AVG_SIP_AMOUNT_INR = 4_300;         // Calibrated to Mar 2025 actuals

// ── CATEGORY MIX (FundsIndia platform, adjusted from AMFI industry) ───
// Industry equity 44.9%, but FI is advisory-led → more equity
// Industry ETF/index 17.5%, but FI is regular-plan → less passive
const FI_CATEGORY_MIX = {
  equity_largecap:     0.10,
  equity_midcap:       0.09,
  equity_smallcap:     0.08,
  equity_flexicap:     0.10,
  equity_multicap:     0.05,
  equity_sectoral:     0.06,
  elss:                0.09,   // Higher than industry 3.5% — FI pushes 80C
  daaf:                0.07,   // Balanced Advantage — advisory recommended
  hybrid_aggressive:   0.05,
  debt:                0.13,   // Lower than industry 23.2% — advisory equity bias
  liquid:              0.08,   // Super Savings product
  global:              0.02,   // International funds
  index:               0.03,   // Much lower than industry 17.5% — no trail
  gold:                0.05,
};

// ── AMC MARKET SHARE (real, from AdvisorKhoj July 2025) ───────────────
const AMC_WEIGHTS = {
  "SBI Mutual Fund":              0.177,
  "ICICI Prudential":             0.150,
  "HDFC Mutual Fund":             0.130,
  "Nippon India":                 0.097,
  "Kotak Mahindra":               0.082,
  "Aditya Birla Sun Life":        0.063,
  "Axis Mutual Fund":             0.052,
  "UTI Mutual Fund":              0.056,
  "Mirae Asset":                  0.035,
  "Parag Parikh":                 0.030,  // FI Select overweighted
  "DSP Mutual Fund":              0.031,
  "Tata Mutual Fund":             0.032,
  "Franklin Templeton":           0.015,
};

// ── GEOGRAPHIC DISTRIBUTION (AMFI state-wise folio data) ──────────────
const STATE_WEIGHTS = [
  { state: "Maharashtra",      weight: 0.18, tier: "t30", cities: ["Mumbai", "Pune", "Thane", "Nagpur"] },
  { state: "Karnataka",        weight: 0.12, tier: "t30", cities: ["Bengaluru", "Mysuru", "Hubli"] },
  { state: "Delhi",            weight: 0.10, tier: "t30", cities: ["New Delhi", "Gurgaon", "Noida", "Faridabad"] },
  { state: "Tamil Nadu",       weight: 0.08, tier: "t30", cities: ["Chennai", "Coimbatore", "Madurai"] },
  { state: "Gujarat",          weight: 0.07, tier: "mix", cities: ["Ahmedabad", "Surat", "Vadodara", "Rajkot"] },
  { state: "Rajasthan",        weight: 0.05, tier: "b30", cities: ["Jaipur", "Jodhpur", "Udaipur", "Ratlam"] },
  { state: "Uttar Pradesh",    weight: 0.05, tier: "mix", cities: ["Lucknow", "Kanpur", "Agra", "Varanasi"] },
  { state: "West Bengal",      weight: 0.04, tier: "t30", cities: ["Kolkata", "Howrah", "Durgapur"] },
  { state: "Telangana",        weight: 0.04, tier: "t30", cities: ["Hyderabad", "Warangal", "Karimnagar"] },
  { state: "Andhra Pradesh",   weight: 0.03, tier: "b30", cities: ["Visakhapatnam", "Vijayawada", "Tirupati"] },
  { state: "Madhya Pradesh",   weight: 0.04, tier: "b30", cities: ["Indore", "Bhopal", "Jabalpur"] },
  { state: "Punjab",           weight: 0.03, tier: "b30", cities: ["Chandigarh", "Ludhiana", "Amritsar"] },
  { state: "Haryana",          weight: 0.03, tier: "mix", cities: ["Gurgaon", "Faridabad", "Panipat"] },
  { state: "Kerala",           weight: 0.03, tier: "b30", cities: ["Kochi", "Thiruvananthapuram", "Calicut"] },
  { state: "Others",           weight: 0.11, tier: "b30", cities: ["Patna", "Bhubaneswar", "Dehradun", "Shimla"] },
];

// ── OCCUPATION VALUES (from FundsIndia KYC screen, actual field values) ─
const OCCUPATION_WEIGHTS = {
  "Private Sector":   0.38,
  "Business":         0.22,
  "Government":       0.15,
  "Professional":     0.10,
  "Retired":          0.08,
  "Homemaker":        0.05,
  "Student":          0.02,
};

// ── INCOME BRACKETS (from FundsIndia KYC, actual dropdown values) ──────
const INCOME_BRACKETS = [
  { label: "< 1 lakh",      weight: 0.05, midpoint: 75_000 },
  { label: "1-5 lakhs",     weight: 0.30, midpoint: 300_000 },
  { label: "5-10 lakhs",    weight: 0.28, midpoint: 750_000 },
  { label: "10-25 lakhs",   weight: 0.25, midpoint: 1_750_000 },
  { label: "> 25 lakhs",    weight: 0.12, midpoint: 4_000_000 },
];
```

## Generation Order & Table Specifications

Dependencies flow downward. Generate in this order.

`fund_views.csv` and `watchlist.csv` from the old model are **replaced** by `user_events.csv` — a Mixpanel-style flat event log that captures all user behaviors across all surfaces (pre-login discovery, calculator interactions, onboarding steps, investment flows, campaign clicks, abandonment signals).

```
Step 1:  funds.csv               (~150 rows)      — no dependencies
Step 2:  investors.csv           (~50,000 rows)   — no dependencies
Step 3:  sips.csv                (~120,000 rows)  — depends on investors, funds
Step 4:  transactions.csv        (~350,000 rows)  — depends on sips, investors, funds
Step 5:  systematic_plans.csv    (~12,000 rows)   — depends on investors, funds
Step 6:  goals.csv               (~65,000 rows)   — depends on investors, funds
Step 7:  comms_log.csv           (~300,000 rows)  — depends on investors, sips
Step 8:  advisory_sessions.csv   (~20,000 rows)   — depends on investors, sips
Step 9:  support_tickets.csv     (~10,000 rows)   — depends on investors
Step 10: user_events.csv         (~1,500,000 rows)— depends on ALL above (references IDs)
```

**Row count reduction vs 3-year plan:** ~1.5M total rows vs ~2.5M previously. Faster generation (<5 min), smaller DuckDB (<500MB), queries faster.

**Note on `user_events.csv` generation:** Build this last because it references fund_ids, sip_ids, goal_ids from all prior tables. Cross-reference campaign sends from comms_log to generate corresponding email_opened/email_clicked events. Cross-reference sip_created outcomes to backfill sip_flow_started events.

---

### Step 1: `funds.csv` (~150 rows)

The fund master table. Use REAL fund names from AMFI NAVAll.txt. Weight by actual AMC market share. Only Regular Growth plans (FundsIndia is regular plan distributor — no direct plans).

| Column | Type | Generation Logic |
|--------|------|-----------------|
| fund_id | VARCHAR | `FI_{seq:03}` — e.g. FI_001 |
| fund_name | VARCHAR | Real fund names from AMFI: "SBI Bluechip Fund - Regular Plan - Growth", etc. |
| amc_name | VARCHAR | From AMC_WEIGHTS — 13 AMCs |
| category | VARCHAR | `equity` / `debt` / `elss` / `daaf` / `global` / `liquid` / `sif` |
| subcategory | VARCHAR | `large_cap` / `mid_cap` / `small_cap` / `flexi_cap` / `multicap` / `sectoral` / `elss` / `balanced_advantage` / `multi_asset` / `liquid` / `short_duration` / `corporate_bond` / `gilt` / `us_equity` / `emerging_markets` |
| risk_level | VARCHAR | `very_high` (small/sectoral) / `high` (mid/flexi) / `moderately_high` (large/ELSS) / `moderate` (DAAF) / `low` (debt/liquid) |
| trailing_commission_pct | DOUBLE | equity: 0.8-1.2%, ELSS: 0.9%, debt: 0.3-0.6%, liquid: 0.1-0.2%, DAAF: 0.6-0.9% |
| inception_date | DATE | Real inception dates from AMFI. Pre-2010 for established funds. |
| benchmark_index | VARCHAR | NIFTY_50 / NIFTY_MIDCAP_150 / NIFTY_SMALLCAP_250 / NIFTY_500 / CRISIL_COMPOSITE / S&P_500 |
| return_1y | DOUBLE | Real approximate returns as of Mar 2025. Equity: -5% to +35%, Debt: 6-9% |
| return_3y | DOUBLE | Equity: 12-25%, Debt: 5-8% |
| return_5y | DOUBLE | Equity: 13-22%, Debt: 6-8% |
| fi_star_rating | INTEGER | 1-5 (FI's internal rating — correlated with returns + AUM) |
| is_fi_select | BOOLEAN | ~30 funds (20% of list) — FI's curated shortlist. 5-star equity/DAAF funds. |
| is_trending_now | BOOLEAN | ~15 funds. Recently high-performing. |
| is_investor_favourite | BOOLEAN | ~20 funds. Highest platform_investor_count. |
| is_gold_fund | BOOLEAN | Gold ETFs and Gold FoFs (~5 funds) |
| is_global_fund | BOOLEAN | International/US/EM funds (~8 funds) |
| platform_investor_count | INTEGER | Weighted by AMC share + category popularity. Top fund: ~28K investors. |
| is_elss | BOOLEAN | Derived: category = 'elss'. 80C benefit flagging. |

**Key funds to include by name (from FundsIndia screenshots):**
- Parag Parikh Flexi Cap Fund - Regular Plan - Growth (FI Select, 5★)
- Kotak Large & Midcap Fund - Regular Growth (FI Select, 5★)
- Edelweiss Emerging Markets Opportunities Equity Offshore Fund (Investor Favourite, 5★)
- Kotak Midcap Fund Regular Growth (Investor Favourite, 23.2K investors)
- 360 ONE Quant Fund Regular Growth (11.3K investors)

---

### Step 2: `investors.csv` (~50,000 rows)

Core entity table. Every column from the actual FundsIndia onboarding screens.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| investor_id | VARCHAR | `INV_{seq:06}` |
| signup_date | DATE | Distribution follows SIP_ACTIVE_BY_MONTH growth curve. More signups in later months. |
| pan_confirmed_date | DATE | signup_date + 0-2 days (immediate or next day) |
| kyc_submitted_date | DATE | pan_confirmed_date + 0-5 days. 15% take >3 days (on_hold path). |
| bank_verified_date | DATE | kyc_submitted_date + 0-1 days (instant UPI) or +3 days (manual) |
| account_activated_date | DATE | bank_verified_date + 0-1 days |
| first_investment_date | DATE | NULL for 18% (never invested). Else account_activated_date + 1-30 days. Median: 3 days. |
| demat_opened_date | DATE | NULL for 68%. Else account_activated_date + 7-60 days (cross-sell conversion ~32%). |
| age | INTEGER | Normal dist, mean 34, std 9, range 22-65. Advisory clients skew 28-45. |
| gender | VARCHAR | `male` 62%, `female` 37%, `other` 1% |
| marital_status | VARCHAR | `single` 38%, `married` 62% |
| city | VARCHAR | From STATE_WEIGHTS city lists |
| state | VARCHAR | From STATE_WEIGHTS |
| city_tier | VARCHAR | `t30` 60%, `b30` 40% (AMFI folio distribution) |
| occupation | VARCHAR | From OCCUPATION_WEIGHTS (Private Sector, Business, Government, etc.) |
| annual_income | VARCHAR | From INCOME_BRACKETS — exact FundsIndia dropdown labels |
| investor_type | VARCHAR | `resident` 96%, `nri` 4% |
| risk_profile | VARCHAR | `conservative` 22%, `moderate` 45%, `aggressive` 33% |
| acquisition_channel | VARCHAR | `organic` 28%, `referral` 18%, `paid_search` 22%, `social` 12%, `email` 10%, `wealth_conversations` 10% |
| kyc_status | VARCHAR | `verified` 91%, `on_hold` 6%, `pending` 3%. on_hold spikes after Jun 2024 (SEBI CKYC change). |
| kyc_method | VARCHAR | `digilocker` 72%, `aadhaar_otp` 18%, `physical` 10% |
| bank_name | VARCHAR | HDFC 25%, SBI 22%, ICICI 18%, Axis 12%, Kotak 8%, others 15% |
| bank_link_method | VARCHAR | `upi_auto_detect` 74%, `manual_entry` 26% |
| bank_link_status | VARCHAR | `verified` 92%, `failed` 5%, `pending` 3% |
| nomination_preference | VARCHAR | `opted_out` 71% (as seen in Vimarsh's onboarding), `added` 29% |
| is_pep | BOOLEAN | false 99.7%, true 0.3% |
| foreign_tax_liable | BOOLEAN | false 96%, true 4% |
| mf_account_active | BOOLEAN | true 97%, false 3% (closed/dormant) |
| demat_account_active | BOOLEAN | true 32% (cross-sell conversion) |
| aa_consent_given | BOOLEAN | true 28% (Account Aggregator — "Know Your True Worth" widget) |
| nominee_status | VARCHAR | `added` 29%, `opted_out` 71% |
| is_active | BOOLEAN | true 82%, false 18% (dormant >6 months) |

**Drop-off calibration (activation funnel):**
- signup → pan_confirmed: 96% (4% drop at PAN)
- pan_confirmed → kyc_submitted: 88% (12% drop at KYC — on_hold, confusion)
- kyc_submitted → bank_verified: 93% (7% drop at bank linking)
- bank_verified → account_activated: 99%
- account_activated → first_investment: 82% (18% never invest after opening)

---

### Step 3: `sips.csv` (~120,000 rows)

SIP registrations — the core "book" that drives trailing commission. Number of active SIPs must match SIP_ACTIVE_BY_MONTH curve.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| sip_id | VARCHAR | `SIP_{seq:07}` |
| investor_id | VARCHAR | FK → investors (only investors with first_investment_date) |
| fund_id | VARCHAR | FK → funds. Weighted by FI_CATEGORY_MIX × AMC_WEIGHTS. is_fi_select funds get 2× weight. |
| start_date | DATE | Distribute to match SIP_ACTIVE_BY_MONTH growth targets. Jan-Mar peak (ELSS season). |
| end_date | DATE | NULL if active. Else cancellation date. |
| frequency | VARCHAR | `monthly` 91%, `quarterly` 9% |
| amount_inr | DOUBLE | Log-normal, mean ₹3,700, median ₹2,000. Range ₹500-₹50,000. ELSS SIPs avg ₹4,500 (80C driven). |
| step_up_pct | DOUBLE | NULL for 72%. Else 5% (15%), 10% (9%), 15% (4%). Annual step-up. |
| step_up_frequency | VARCHAR | `annual` (when step_up_pct set) |
| sip_type | VARCHAR | `regular` 78%, `power_sip` 14%, `super_savings` 8% |
| status | VARCHAR | `active` / `paused` / `cancelled` / `completed` |
| mandate_type | VARCHAR | `upi_autopay` 58%, `nach` 42% |
| cancellation_reason | VARCHAR | When cancelled: `returns_unsatisfactory` 35%, `financial_constraint` 28%, `switched_platform` 12%, `goal_achieved` 15%, `unknown` 10% |
| total_installments_paid | INTEGER | Derived from start_date to end_date or current |
| total_amount_invested | DOUBLE | amount_inr × total_installments_paid + step-up adjustments |

**SIP status distribution (by vintage):**
- SIPs started in FY23: active 55%, cancelled 32%, completed 8%, paused 5%
- SIPs started in FY24: active 73%, cancelled 20%, paused 7%
- SIPs started in FY25: active 88%, cancelled 9%, paused 3%

**Planted story:** ELSS SIP creation spikes every Jan-Mar (80C deadline). Cancellations spike after Jun 2024 (market volatility + SEBI KYC changes caused mandate rejections).

---

### Step 4: `transactions.csv` (~500,000 rows)

All investment events. Largest table after fund_views.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| txn_id | VARCHAR | `TXN_{seq:07}` |
| investor_id | VARCHAR | FK → investors |
| fund_id | VARCHAR | FK → funds |
| sip_id | VARCHAR | FK → sips (NULL for lumpsum, switch, SWP) |
| goal_id | VARCHAR | FK → goals (30% of transactions are goal-tagged) |
| txn_date | DATE | For sip_installment: monthly on SIP's start_date day. For lumpsum: random. |
| txn_type | VARCHAR | `sip_installment` 68%, `lumpsum` 12%, `power_sip` 7%, `redemption` 7%, `invest_more` 3%, `switch` 1%, `nfo_purchase` 1%, `swp` 1% |
| amount_inr | DOUBLE | By type: sip_installment = SIP amount, lumpsum log-normal mean ₹45,000, redemption 20-100% of holding |
| units | DOUBLE | amount_inr / nav_at_txn |
| nav_at_txn | DOUBLE | Simulated NAV on txn_date. Start from fund inception NAV, grow by category return. Add daily noise (equity σ=0.8%, debt σ=0.05%). |
| status | VARCHAR | `success` 94%, `failed` 4%, `pending` 2%. NACH fails higher (6%). Jan 2025 spike in failures (bank system issue). |
| channel | VARCHAR | `app` 48%, `web` 32%, `email_link` 12%, `advisor_assisted` 8% |
| payment_mode | VARCHAR | `nach` 45%, `upi` 38%, `netbanking` 12%, `mandate` 5% |

**Consistency rules:**
- Every sip_installment row must have a valid sip_id
- Every SIP with status=active must have an installment every month from start_date to DATE_END
- Failed installments: no units allocated, amount_inr = 0

---

### Step 5: `systematic_plans.csv` (~15,000 rows)

STP, SWP, Super Savings — structurally different from SIPs (fund-to-fund, not bank-to-fund).

| Column | Type | Generation Logic |
|--------|------|-----------------|
| plan_id | VARCHAR | `SPL_{seq:05}` |
| investor_id | VARCHAR | FK → investors |
| plan_type | VARCHAR | `stp` 40%, `swp` 35%, `super_savings` 25% |
| source_fund_id | VARCHAR | STP/super_savings: liquid/short duration fund. SWP: equity fund. |
| target_fund_id | VARCHAR | STP: equity fund. SWP: NULL (goes to bank). super_savings: liquid. |
| amount_inr | DOUBLE | STP: ₹5,000-₹50,000. SWP: ₹5,000-₹25,000/month. |
| frequency | VARCHAR | `monthly` 80%, `weekly` 20% (STP only) |
| start_date | DATE | Random in date range |
| end_date | DATE | NULL if active. Active: 60%. |
| status | VARCHAR | `active` 60%, `completed` 28%, `cancelled` 12% |
| installments_completed | INTEGER | Derived from dates |

---

### Step 6: `goals.csv` (~75,000 rows)

Investment goals — Money Mitr and self-set. Average 1.5 goals per investor with first_investment_date.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| goal_id | VARCHAR | `GOL_{seq:06}` |
| investor_id | VARCHAR | FK → investors |
| goal_type | VARCHAR | `retirement` 28%, `wealth_creation` 22%, `tax_saving` 18%, `education` 12%, `home_purchase` 8%, `emergency_fund` 7%, `vacation` 5% |
| target_amount_inr | DOUBLE | By type: retirement ₹50L-₹5Cr, education ₹10-50L, home ₹20-80L, vacation ₹2-10L |
| target_date | DATE | 1-30 years from created_date. Retirement: 10-30yr. Vacation: 1-3yr. |
| monthly_sip_needed_inr | DOUBLE | Derived: PMT(12%/12, months_to_target, -current_value, target_amount) |
| current_value_inr | DOUBLE | Sum of goal-tagged transaction amounts + simulated returns |
| created_date | DATE | Within 30 days of first_investment_date. Some post-advisor-session. |
| status | VARCHAR | `on_track` 52%, `at_risk` 23%, `off_track` 15%, `achieved` 10% |
| created_by | VARCHAR | `money_mitr` 45%, `advisor` 30%, `self` 25% |
| flagged_at_risk_date | DATE | When status became at_risk/off_track (for funnel analysis) |
| achieved_date | DATE | When goal was marked achieved (only for status=achieved) |

---

### Step 7: `fund_views.csv` (~800,000 rows)

Discovery-to-investment funnel. Largest table. Enables view → watchlist → invest analysis.

**Conversion rates (calibrated):**
- View → Watchlist: 9% overall (12% for equity, 6% for debt)
- Watchlist → Invest (30d): 22%
- View → Direct Invest (no watchlist): 3%
- Overall view → invest: ~5%

| Column | Type | Generation Logic |
|--------|------|-----------------|
| view_id | VARCHAR | `VW_{seq:07}` |
| investor_id | VARCHAR | FK → investors |
| fund_id | VARCHAR | FK → funds. Weighted by platform_investor_count + is_trending_now |
| viewed_at | TIMESTAMP | Distribute across date range. Peaks: Jan-Mar (ELSS season), post-email-campaign send dates. |
| source | VARCHAR | `recommended_funds` 25%, `fi_select` 20%, `trending_now` 15%, `email_link` 12%, `search` 10%, `investor_favourites` 8%, `gold_funds` 5%, `watchlist` 3%, `portfolio_comparison` 2% |
| session_duration_sec | INTEGER | Normal dist, mean 65 sec, std 40. fi_select views longer (mean 95 sec). |
| viewed_returns_tab | BOOLEAN | 72% view returns. Higher for experienced investors (2+ years on platform). |
| viewed_holdings_tab | BOOLEAN | 38% view fund portfolio holdings. More common for large-cap funds. |
| converted_to_watchlist | BOOLEAN | 9% overall. Higher for email_link (14%) and fi_select (13%). |
| converted_to_investment | BOOLEAN | 5% overall. Higher for email_link (11%) and fi_select (9%). |
| conversion_days | INTEGER | NULL if no conversion. Else 0-30 (median 2 days for email_link, 8 days for browse). |

---

### Step 8: `watchlist.csv` (~75,000 rows)

Intermediate funnel state. Derived from fund_views where converted_to_watchlist=true, plus direct adds.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| watchlist_id | VARCHAR | `WL_{seq:06}` |
| investor_id | VARCHAR | FK → investors |
| fund_id | VARCHAR | FK → funds |
| added_date | DATE | From fund_views.viewed_at where converted_to_watchlist=true |
| source | VARCHAR | Same as fund_views.source that generated it |
| converted_to_investment | BOOLEAN | 22% convert within 30 days |
| converted_date | DATE | NULL or date of first transaction in that fund after add_date |

---

### Step 9: `comms_log.csv` (~400,000 rows)

Email/push/SMS/WhatsApp campaigns. ~8 sends per investor per year.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| comm_id | VARCHAR | `CM_{seq:07}` |
| investor_id | VARCHAR | FK → investors. Active investors get more comms. |
| channel | VARCHAR | `email` 48%, `push` 32%, `sms` 12%, `whatsapp` 8% |
| campaign_type | VARCHAR | See campaign taxonomy below |
| sent_at | TIMESTAMP | By campaign type (see seasonal patterns) |
| delivered | BOOLEAN | email 97%, push 84%, sms 98%, whatsapp 96% |
| opened | BOOLEAN | email 22%, push 18%. Higher for personalized campaigns. |
| clicked | BOOLEAN | email 4.2%, push 6.1%. Higher for tax_saving (8.5%) and fund_recommendation (5.3%). |
| converted | BOOLEAN | 1.8% overall. tax_saving 3.4%, sip_nudge 2.1%, market_alert 0.8% |
| action_taken | VARCHAR | When converted: `sip_created` 45%, `lumpsum_done` 32%, `goal_created` 15%, `no_action` 8% |

**Campaign taxonomy with seasonal patterns:**
```
welcome_series          — D+0, D+3, D+7 after account_activated
kyc_reminder            — If kyc_status = on_hold. Daily for 5 days.
nominee_reminder        — Weekly for opted_out investors (first 4 weeks)
sip_nudge               — Monthly, active investors without SIP increase
portfolio_review        — Quarterly to all active investors
fund_recommendation     — Bi-weekly, personalized to risk_profile
tax_saving              — Heavy Jan-Feb-Mar (80C deadline). 3× normal frequency.
market_alert            — Event-driven (market -5%: "What to do?")
wealth_conversations    — Monthly newsletter (seen in dashboard: "Wealth Conversations May 2026")
pre_redemption_call     — Triggers when investor submits redemption (advisor intervention)
dormant_activation      — Investors with no txn in 90+ days
step_up_nudge           — Annual, to SIP investors (anniversary of SIP start)
aa_consent_nudge        — Post-activation, "Know Your True Worth" widget
elss_lapse_warning      — March: "Only X days left to save ₹46,800 in tax"
```

**Planted story:** Tax-saving campaign Jan-Mar drives 40% of annual ELSS SIP creation. Market alert emails in Oct 2024 (market correction) converted 2.3% vs usual 0.8%.

---

### Step 10: `advisory_sessions.csv` (~25,000 rows)

Money Mitr and human advisor interactions. ~0.5 sessions per active investor per year.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| session_id | VARCHAR | `ADV_{seq:05}` |
| investor_id | VARCHAR | FK → investors |
| session_date | DATE | Spread across date range. Peaks: onboarding month, quarterly review, Jan-Mar (tax season). |
| advisor_type | VARCHAR | `money_mitr` 58%, `human_advisor` 42% |
| session_type | VARCHAR | `goal_planning` 28%, `portfolio_review` 25%, `fund_selection` 20%, `risk_assessment` 12%, `pre_redemption_call` 15% |
| duration_min | INTEGER | money_mitr: 3-8 min. human_advisor: 15-45 min (mean 22). |
| recommendation_type | VARCHAR | `increase_sip` 25%, `fund_switch` 20%, `start_sip` 18%, `add_elss` 15%, `rebalance` 12%, `stay_invested` 10% |
| outcome | VARCHAR | `followed` 48%, `partial` 22%, `ignored` 30%. pre_redemption_call: followed=55% (investor stays invested). |
| portfolio_value_at_time | DOUBLE | Sum of investor's holdings at session_date |
| triggered_by | VARCHAR | `comms_click` 35%, `investor_initiated` 40%, `system_alert` 15%, `redemption_request` 10% |

**Planted story:** Human advisor pre-redemption calls have 55% "followed" rate (investor keeps money in). Money Mitr fund_selection sessions have 48% followed rate. Advisor ROI is measurable.

---

### Step 11: `support_tickets.csv` (~12,000 rows)

Customer support cases.

| Column | Type | Generation Logic |
|--------|------|-----------------|
| ticket_id | VARCHAR | `TKT_{seq:05}` |
| investor_id | VARCHAR | FK → investors |
| created_at | TIMESTAMP | Spread across date range. Spike Jun-Jul 2024 (SEBI KYC changes). |
| resolved_at | TIMESTAMP | created_at + resolution_hours. NULL if status=open. |
| category | VARCHAR | `kyc` 25%, `sip_failure` 22%, `bank_mandate` 18%, `redemption` 15%, `login` 8%, `statement` 7%, `complaint` 5% |
| channel | VARCHAR | `in_app` 38%, `phone` 32%, `email` 20%, `chat` 10% |
| priority | VARCHAR | `high` 20%, `medium` 50%, `low` 30% |
| status | VARCHAR | `resolved` 83%, `open` 7%, `escalated` 10% |
| resolution_hours | DOUBLE | kyc: 24-72h, sip_failure: 4-24h, login: 0.5-2h, complaint: 48-96h |
| nps_score | INTEGER | 0-10. Resolved: mean 7.2. Escalated: mean 4.1. |

---

## DuckDB Views (denormalized for LLM queries)

```sql
-- Primary enriched view for investor-level queries
CREATE VIEW investors_full AS
  SELECT i.*,
    COALESCE(p.current_aum, 0) AS current_portfolio_value,
    COALESCE(p.total_invested, 0) AS total_amount_invested,
    COALESCE(p.active_sip_count, 0) AS active_sip_count,
    COALESCE(p.fund_count, 0) AS fund_count
  FROM investors i
  LEFT JOIN investor_portfolio_snapshot p ON i.investor_id = p.investor_id
    AND p.snapshot_month = '2025-03-01';

-- Enriched transactions with fund + investor context
CREATE VIEW transactions_full AS
  SELECT t.*, f.fund_name, f.amc_name, f.category AS fund_category,
         f.subcategory AS fund_subcategory, f.risk_level, f.trailing_commission_pct,
         i.city_tier, i.risk_profile, i.occupation, i.acquisition_channel,
         i.annual_income, i.state, i.city, i.gender
  FROM transactions t
  JOIN funds f ON t.fund_id = f.fund_id
  JOIN investors i ON t.investor_id = i.investor_id;

-- SIPs with fund + investor context
CREATE VIEW sips_full AS
  SELECT s.*, f.fund_name, f.amc_name, f.category AS fund_category,
         f.subcategory AS fund_subcategory, f.trailing_commission_pct,
         i.city_tier, i.risk_profile, i.annual_income, i.acquisition_channel,
         i.state, i.city,
         CASE WHEN s.amount_inr < 2000 THEN '<2K'
              WHEN s.amount_inr < 5000 THEN '2-5K'
              WHEN s.amount_inr < 15000 THEN '5-15K'
              ELSE '>15K' END AS amount_range
  FROM sips s
  JOIN funds f ON s.fund_id = f.fund_id
  JOIN investors i ON s.investor_id = i.investor_id;

-- Fund views with fund + investor context
CREATE VIEW fund_views_full AS
  SELECT fv.*, f.fund_name, f.amc_name, f.category AS fund_category,
         f.subcategory, f.is_fi_select, f.is_trending_now,
         i.city_tier, i.risk_profile, i.acquisition_channel
  FROM fund_views fv
  JOIN funds f ON fv.fund_id = f.fund_id
  JOIN investors i ON fv.investor_id = i.investor_id;

-- Goals with investor context
CREATE VIEW goals_full AS
  SELECT g.*, i.city_tier, i.risk_profile, i.annual_income, i.age
  FROM goals g
  JOIN investors i ON g.investor_id = i.investor_id;

-- Comms with investor context
CREATE VIEW comms_full AS
  SELECT c.*, i.city_tier, i.risk_profile, i.acquisition_channel, i.is_active
  FROM comms_log c
  JOIN investors i ON c.investor_id = i.investor_id;

-- Advisory with investor + portfolio context
CREATE VIEW advisory_full AS
  SELECT a.*, i.city_tier, i.risk_profile, i.occupation
  FROM advisory_sessions a
  JOIN investors i ON a.investor_id = i.investor_id;

-- Support with investor context
CREATE VIEW support_full AS
  SELECT s.*, i.city_tier, i.is_active, i.kyc_status
  FROM support_tickets s
  JOIN investors i ON s.investor_id = i.investor_id;
```

---

## Summary Tables (pre-materialized)

```sql
-- Platform-level monthly KPIs (board dashboard equivalent)
CREATE TABLE monthly_platform_kpis AS
  SELECT month, new_investors, new_sips, cancelled_sips, net_sip_growth,
         active_sips, total_aum_cr, monthly_sip_inflow_cr, monthly_commission_cr,
         avg_sip_amount, lumpsum_inflow_cr, redemption_outflow_cr, net_inflow_cr

-- AUM per fund per month (what FI holds in each fund)
CREATE TABLE fund_platform_aum AS
  SELECT fund_id, fund_name, amc_name, category, month,
         investor_count, active_sip_count, total_units, estimated_aum_cr,
         trailing_commission_earned_cr

-- Trailing commission by AMC per month
CREATE TABLE amc_commission_monthly AS
  SELECT amc_name, month, aum_cr, trailing_commission_pct, commission_earned_cr

-- SIP cohort retention (what % of SIPs from each quarter still active at N months)
CREATE TABLE sip_cohort_retention AS
  SELECT start_quarter, mob_3, mob_6, mob_12, mob_24,
         pct_active_3m, pct_active_6m, pct_active_12m, pct_active_24m

-- Campaign conversion (email/push analytics)
CREATE TABLE campaign_performance AS
  SELECT campaign_type, channel, month, sends, deliveries, opens, clicks,
         conversions, sips_created, lumpsum_done,
         open_rate, click_rate, conversion_rate

-- Investor activation funnel by acquisition channel
CREATE TABLE investor_funnel AS
  SELECT acquisition_channel, city_tier, cohort_month,
         signups, pan_confirmed, kyc_submitted, bank_verified,
         account_activated, first_investment, active_sip,
         pct_to_kyc, pct_to_bank, pct_to_activated, pct_to_invested, pct_to_sip

-- Fund discovery conversion
CREATE TABLE fund_discovery_funnel AS
  SELECT fund_category, source, month,
         views, watchlisted, invested,
         view_to_watchlist_pct, watchlist_to_invest_pct, view_to_invest_pct

-- T30 vs B30 performance
CREATE TABLE city_tier_kpis AS
  SELECT city_tier, month, investor_count, active_sips,
         avg_sip_amount, avg_portfolio_value, equity_allocation_pct,
         sip_retention_12m, elss_adoption_pct

-- Goal achievement rates
CREATE TABLE goal_achievement AS
  SELECT goal_type, created_by, month,
         total_goals, on_track, at_risk, off_track, achieved,
         pct_on_track, median_target_amount, median_current_value

-- Investor portfolio snapshots (monthly, for tracking portfolio growth)
CREATE TABLE investor_portfolio_snapshot AS
  SELECT investor_id, snapshot_month,
         fund_count, total_invested, current_aum, xirr_pct,
         equity_pct, debt_pct, elss_pct, active_sip_count, sip_total_monthly
```

---

## Events Catalog (Analytics Explorer)

### Category 1 — Investor Lifecycle (5 events, all `funnelEligible: true`)

Table: `investors_full`, each event = one date column per investor.

| Event ID | Display Name | Date Column | Filter |
|----------|-------------|-------------|--------|
| `investor_signup` | Signed Up | `signup_date` | — |
| `pan_confirmed` | PAN Confirmed | `pan_confirmed_date` | — |
| `kyc_submitted` | KYC Submitted | `kyc_submitted_date` | `kyc_status != 'pending'` |
| `account_activated` | Account Activated | `account_activated_date` | — |
| `first_investment` | First Investment | `first_investment_date` | `first_investment_date IS NOT NULL` |
| `demat_opened` | Demat Account Opened | `demat_opened_date` | `demat_account_active = true` |
| `kyc_on_hold` | KYC On Hold | `kyc_submitted_date` | `kyc_status = 'on_hold'`, `funnelEligible: false` |

Properties: `city_tier`, `acquisition_channel`, `kyc_method`, `investor_type`, `annual_income`, `occupation`

### Category 2 — Investments (7 events)

Table: `transactions_full`

| Event ID | Display Name | Filter | Funnel? | Value |
|----------|-------------|--------|---------|-------|
| `purchase` | Any Purchase | `txn_type = 'purchase' AND status = 'success'` | ✅ | `amount_inr` |
| `lumpsum_purchase` | Lumpsum Purchase | `txn_type = 'lumpsum' AND status = 'success'` | ✅ | `amount_inr` |
| `sip_installment` | SIP Installment | `txn_type = 'sip_installment' AND status = 'success'` | ✅ (**best retention event**) | `amount_inr` |
| `redemption` | Redemption | `txn_type = 'redemption' AND status = 'success'` | ✅ | `amount_inr` |
| `fund_switch` | Fund Switch | `txn_type = 'switch' AND status = 'success'` | ❌ (same-day) | — |
| `failed_transaction` | Failed Transaction | `status = 'failed'` | ❌ | — |
| `nfo_purchase` | NFO Subscription | `txn_type = 'nfo_purchase' AND status = 'success'` | ✅ | `amount_inr` |

Properties: `fund_category`, `fund_subcategory`, `amc_name`, `channel`, `payment_mode`, `city_tier`, `risk_profile`

### Category 3 — SIP Lifecycle (4 events)

Table: `sips_full`

| Event ID | Display Name | Date Column | Filter | Funnel? |
|----------|-------------|-------------|--------|---------|
| `sip_created` | SIP Created | `start_date` | — | ✅ |
| `sip_cancelled` | SIP Cancelled | `end_date` | `status = 'cancelled'` | ✅ |
| `sip_step_up_created` | Step-Up SIP Created | `start_date` | `sip_type = 'power_sip' OR step_up_pct IS NOT NULL` | ✅ |
| `sip_paused` | SIP Paused | `end_date` | `status = 'paused'` | ❌ |

Properties: `fund_category`, `amc_name`, `sip_type`, `mandate_type`, `amount_range`, `cancellation_reason`

### Category 4 — Fund Discovery (4 events)

Table: `fund_views_full`

| Event ID | Display Name | Filter | Funnel? |
|----------|-------------|--------|---------|
| `fund_viewed` | Fund Page Viewed | — | ✅ |
| `fund_watchlisted` | Fund Watchlisted | `converted_to_watchlist = true` | ✅ |
| `fi_select_viewed` | FI Select Fund Viewed | `source = 'fi_select'` | ✅ |
| `email_cta_viewed` | Viewed via Email CTA | `source = 'email_link'` | ✅ |

Properties: `source`, `fund_category`, `amc_name`, `is_fi_select`, `is_trending_now`, `city_tier`

### Category 5 — Goals (3 events)

Table: `goals_full`

| Event ID | Display Name | Date Column | Filter | Funnel? |
|----------|-------------|-------------|--------|---------|
| `goal_created` | Goal Created | `created_date` | — | ✅ |
| `goal_achieved` | Goal Achieved | `achieved_date` | `status = 'achieved'` | ✅ |
| `goal_at_risk` | Goal Flagged At Risk | `flagged_at_risk_date` | `status IN ('at_risk', 'off_track')` | ❌ |

Properties: `goal_type`, `created_by`

### Category 6 — CRM (5 events)

Table: `comms_full`

| Event ID | Display Name | Filter | Funnel? |
|----------|-------------|--------|---------|
| `comms_sent` | Message Sent | — | ✅ |
| `comms_opened` | Message Opened | `opened = true` | ❌ (same timestamp) |
| `comms_clicked` | Link Clicked | `clicked = true` | ❌ (same timestamp) |
| `comms_converted` | Converted | `converted = true` | ❌ |
| `tax_saving_nudge_sent` | Tax Saving Nudge | `campaign_type = 'tax_saving'` | ✅ |

Properties: `channel`, `campaign_type`, `city_tier`, `risk_profile`

### Category 7 — Advisory (4 events)

Table: `advisory_full`

| Event ID | Display Name | Filter | Funnel? |
|----------|-------------|--------|---------|
| `advisor_session` | Advisor Session | — | ✅ |
| `money_mitr_session` | Money Mitr Session | `advisor_type = 'money_mitr'` | ✅ |
| `human_advisor_session` | Human Advisor Session | `advisor_type = 'human_advisor'` | ✅ |
| `pre_redemption_call` | Pre-Redemption Call | `session_type = 'pre_redemption_call'` | ✅ |

Properties: `advisor_type`, `session_type`, `recommendation_type`, `outcome`, `city_tier`

### Category 8 — Support (3 events)

Table: `support_full`

| Event ID | Display Name | Filter | Funnel? |
|----------|-------------|--------|---------|
| `support_ticket` | Support Ticket Created | — | ✅ |
| `kyc_ticket` | KYC Support Ticket | `category = 'kyc'` | ✅ |
| `sip_failure_ticket` | SIP Failure Ticket | `category = 'sip_failure'` | ✅ |

Properties: `category`, `channel`, `priority`

---

## Planted Analytical Stories

These must be discoverable via natural language queries. All dates are within Jun 2024 – May 2026.

| # | Story | Tables | What the Analyst Finds |
|---|-------|--------|----------------------|
| 1 | **SEBI KYC crisis (Jun–Jul 2024)** | investors, user_events, support_tickets | kyc_status='on_hold' spikes from 3% → 11% in Jun-Jul 2024 after SEBI mandated re-validation of PAN-Aadhaar linking. `kyc_support_ticket` events +180%. Activation funnel (account_activated) drops 22% during the window. Recovers by Sep 2024. |
| 2 | **Oct 2024 equity correction → alert email spike** | user_events, comms_log, transactions | Nifty -9% in Oct 2024. FI sends "Indian Equity Markets Decline — What Should You Do?" email. email open rate 34% (vs 22% avg). `fund_page_viewed` for equity funds +45% in 48h. Email converts at 2.3% vs 0.8% baseline — contra-investors lump-sum buying the dip. |
| 3 | **ELSS tax season — two waves** | sips, transactions, user_events, comms_log | Jan-Mar 2025 AND Jan-Mar 2026 both show ELSS SIP creation 3.2× the monthly average. `elss_calculator_computed` events peak in Feb. Tax-saving email converts at 3.4% vs 1.8% yr avg. ELSS makes up 9% of AUM but 18% of new SIPs in tax season. |
| 4 | **Calculator → highest quality acquisition channel** | user_events | Investors who signed up via `calculator_invest_cta_clicked` have: 72% first-SIP rate (vs 58% organic), avg SIP amount ₹5,200 (vs ₹3,900 organic), 12-month retention 71% (vs 62% organic). SIP calculator is the highest-LTV acquisition source. |
| 5 | **NACH vs UPI mandate: silent SIP killer** | transactions, sips, user_events | NACH mandates fail at 6.2% per installment vs UPI autopay 1.9%. Failed NACH → SIP cancelled within 60 days at 34% rate. `sip_flow_abandoned` at step=mandate_authorization is 28% higher for NACH path. Switch campaign to UPI would recover ~₹4 Cr/month in AUM. |
| 6 | **FI Select → 2× better retention** | user_events, sips | Investors whose first SIP was in an FI Select fund: 76% 12-month retention vs 48% for non-FI-Select first SIP. FI Select page has 95-sec avg session duration vs 45-sec for category browsing. Curation quality directly drives stickiness. |
| 7 | **Pre-redemption call saves 55% of exits** | user_events, advisory_sessions, transactions | `redemption_initiated` events followed by `pre_redemption_call_accepted` result in `redemption_cancelled` 55% of the time. Those who stay invest 2.1× more in next 6 months. `pre_redemption_call_declined` → 93% proceed to redeem. Advisory intervention ROI is measurable. |
| 8 | **Step-up SIPs: 2× retention, 3× AUM contribution** | sips | Power SIP investors have 79% 12-month retention vs 51% regular SIP. By month 24 their avg invested amount is 2.8× their starting amount (compounding step-ups). Only 14% of new SIPs use Power SIP — massive upsell opportunity. |
| 9 | **B30 cities growing 38% YoY — but 40% lower ticket size** | investors, sips, user_events | B30 new investor signups: +38% YoY (Jun 2025 vs Jun 2024). T30: +14%. B30 avg SIP ₹2,400 vs T30 ₹5,800. B30 app traffic share: +12pp. Matches AMFI industry trend of B30 folio growth outpacing T30. |
| 10 | **Dormant reactivation: tax season is the rescue window** | investors, comms_log, user_events | Investors with no activity in 90+ days: 31% make a transaction in Jan-Mar (vs 8% in other months). `dormant_activation` campaign in Jan has highest redemption-prevention effect. Two-thirds of reactivated dormants restart a SIP within 30 days. |
| 11 | **Academy → ELSS conversion pipeline** | user_events | `academy_article_viewed` for elss-related articles → `fund_page_viewed` (ELSS category) within 7 days: 24% conversion. Those who view both an ELSS article AND the ELSS calculator → SIP creation: 41% conversion. Academy is a high-intent, undertracked channel. |
| 12 | **FY26 SIP book growth stalling** | sips, user_events | Net SIP growth (new minus cancelled) slows from +4,200/month in H1 FY25 to +2,800/month in H2 FY25 to +1,900/month by Q4 FY26. Cancellation rate rising (returns_unsatisfactory 40% of reasons in FY26 vs 32% in FY25). FY26 equity markets are flat. |

---

## Calibration Targets

These numbers MUST match when the dataset is queried:

| Metric | Target | Period | Source | Tolerance |
|--------|--------|--------|--------|-----------|
| Active SIPs (May 2026, end) | 2,70,000 | End state | FundsIndia stated | ±2% |
| Active SIPs (Jun 2024, start) | 1,85,000 | Start state | Derived (industry 6.5Cr × 0.285%) | ±5% |
| Total platform AUM (May 2026) | ₹25,000 Cr | End state | FundsIndia stated | ±3% |
| Monthly SIP inflow (Mar 2025) | ₹99 Cr | Mid-point | Derived (₹25,926 Cr × 0.38%) | ±5% |
| Avg SIP amount (Mar 2025) | ₹4,300 | Mid-point | Derived (₹99Cr ÷ 230K) | ±5% |
| New SIPs Jun 2024 – May 2026 | ~1,20,000 | Full period | Derived from net growth + cancellations | ±10% |
| Industry SIP Jun 2024 | ₹21,262 Cr | Anchor | Zee Biz (real) | Exact |
| Industry SIP Mar 2025 | ₹25,926 Cr | Anchor | AMFI Excel (real) | Exact |
| Industry SIP Sep 2025 | ₹29,361 Cr | Anchor | Tata MF (real) | Exact |
| Industry SIP Nov 2025 | ₹29,445 Cr | Anchor | AMFI Monthly Note (real) | Exact |
| Equity + ELSS allocation (FI) | 57% | Any month | Industry adj. | ±3pp |
| ETF/Index allocation | 3% | Any month | Trail bias adj. | ±1pp |
| T30 investors | 60% | Any month | AMFI folio data | ±5pp |
| B30 investors | 40% | Any month | AMFI folio data | ±5pp |
| Maharashtra investors | 18% | Any month | AMFI state-wise data | ±3pp |
| kyc_status='on_hold' (Jun–Jul 2024) | 9–11% | Planted event | SEBI KYC change story | Must spike |
| kyc_status='on_hold' (baseline) | 3% | Normal months | Industry estimate | ±1pp |
| ELSS SIP creation spike (Jan-Mar) | 3.2× monthly avg | Jan-Mar 2025+2026 | Planted story | Must spike |
| Email open rate (baseline) | 22% | Normal | Industry benchmark | ±3pp |
| Email open rate (market alert Oct 2024) | 34% | Oct 2024 | Planted story | ±4pp |
| Email → SIP conversion (baseline) | 1.8% | Normal | Industry benchmark | ±0.5pp |
| NACH mandate failure rate | 6.2% | Any month | Planted story | ±1pp |
| UPI autopay failure rate | 1.9% | Any month | Planted story | ±0.5pp |
| SIP cancellation rate | 9%/year | FY25 | Industry estimate | ±2pp |
| SBI MF weight in fund mix | 17.7% | Any | AMFI AMC data | ±2pp |
| KYC support ticket spike (Jun–Jul 2024) | 180% above baseline | Jun-Jul 2024 | Planted story | Must spike |

---

## Suggested Prompts (Welcome Screen)

```typescript
suggestedPrompts: [
  "What's our SIP book health — new SIPs created vs cancelled by fund category this year?",
  "Which AMC generates the most trailing commission on our platform?",
  "Show me the investor activation funnel: signup → KYC → first SIP by acquisition channel",
  "Compare T30 vs B30 investors — average SIP amount, equity allocation, and 12-month retention",
  "Which email campaign type drives the highest SIP creation rate?",
  "Show me the SIP vintage cohort analysis — what % of SIPs from each quarter are still active?",
]
```

## Welcome Subtitle

```
"Ask anything about your investor base, SIP book health, fund performance, commission revenue, and campaign effectiveness — across FY23 to FY25."
```

---

## Domain Hints (for SQL generation)

Numbered rules to inject into every LLM SQL prompt:

```
6. ACTIVE SIPs = status = 'active'. Use sips_full for enriched queries.
7. SIP INSTALLMENT vs LUMPSUM: txn_type = 'sip_installment' for SIP debits, txn_type = 'lumpsum' for one-time purchases. sip_id IS NULL for lumpsums.
8. COMMISSION CALCULATION: monthly_commission = trailing_commission_pct × estimated_aum_cr / 12. Use amc_commission_monthly table for pre-computed values.
9. AUM ESTIMATE: For any fund, AUM ≈ SUM(units × current_nav). Use fund_platform_aum summary table for monthly AUM.
10. ELSS = tax-saving funds (category = 'elss'). Eligible for 80C deduction up to ₹1.5L. 3-year lock-in. SIP creation spikes Jan-Mar.
11. T30/B30 = city tier in investors table. T30 = top 30 cities by AUM. B30 = all others.
12. INDIAN FISCAL YEAR: April to March. FY23 = Apr 2022 to Mar 2023. Q1 = Apr-Jun, Q4 = Jan-Mar.
13. GOAL ON-TRACK: Use goals.status directly. Do not calculate from target/current — pre-computed.
14. ACTIVATION FUNNEL: All steps are date columns on investors table (signup_date, pan_confirmed_date, kyc_submitted_date, bank_verified_date, account_activated_date, first_investment_date). NULL = dropped off at that step.
15. RETENTION EVENT: sip_installment is the best retention signal (monthly recurrence). For cohort retention, group by DATE_TRUNC('month', first_investment_date) and check for installments at 3/6/12 months.
16. CAMPAIGN ATTRIBUTION: comms_log.converted = true means investor took action same month. For cross-table funnel, join comms_log with transactions on investor_id where txn_date BETWEEN sent_at AND sent_at + INTERVAL 30 DAYS.
17. REGULAR PLANS ONLY: FundsIndia distributes only regular plans. No direct plans. trailing_commission_pct is always > 0.
18. SIP AMOUNT RANGES: Use CASE WHEN amount_inr < 2000 THEN '<2K' WHEN < 5000 THEN '2-5K' WHEN < 15000 THEN '5-15K' ELSE '>15K' END for grouping.
19. CURRENCY: All amounts in INR (Indian Rupees). AUM shown in Crore (1 Cr = 10M INR). trailing_commission_cr = aum_cr × pct / 100 / 12 per month.
20. PREFERRED SUMMARY TABLES:
    - Platform-level: monthly_platform_kpis
    - Fund AUM: fund_platform_aum
    - Commission: amc_commission_monthly
    - SIP retention: sip_cohort_retention
    - Funnel: investor_funnel
    - Campaigns: campaign_performance
    - Discovery: fund_discovery_funnel
    - Geography: city_tier_kpis
    - Goals: goal_achievement
    Use transactions_full / sips_full / investors_full for custom or per-investor queries.
21. INVESTOR STATUS: is_active = false means no transaction in 6+ months. Separate from mf_account_active (account not closed).
22. PRE-REDEMPTION CALLS: advisory_sessions where session_type = 'pre_redemption_call' AND outcome = 'followed' means investor was retained. Outcome = 'ignored' means they redeemed.
```

---

## Agent Specs (Deep Research Mode)

```typescript
agents: [
  { id: "data-quality", queries: [
    { description: "NULL rates in key investor columns", hint: "COUNT(*) FILTER (WHERE ...IS NULL)" },
    { description: "SIP-transaction consistency check", hint: "LEFT JOIN sips on transactions where active SIPs have no recent installment" },
    { description: "AUM reconciliation: fund_platform_aum vs sum of transactions", hint: "GROUP BY fund_id, compare" },
  ]},
  { id: "daily-metrics", queries: [
    { description: "Monthly SIP book net growth (new - cancelled)", hint: "GROUP BY DATE_TRUNC month on sips.start_date vs end_date" },
    { description: "Monthly AUM and trailing commission trend", hint: "FROM monthly_platform_kpis ORDER BY month" },
    { description: "Monthly transaction volume and net inflow", hint: "SUM(purchases) - SUM(redemptions) from transactions_full by month" },
  ]},
  { id: "cohort-retention", queries: [
    { description: "SIP cohort retention at 3/6/12/24 months", hint: "FROM sip_cohort_retention — what % still active" },
    { description: "Investor activation cohort: signup → first SIP by month", hint: "FROM investor_funnel GROUP BY cohort_month" },
    { description: "SIP cancellation rate by fund category and vintage", hint: "FROM sips_full where status=cancelled, GROUP BY category, DATE_TRUNC quarter start_date" },
  ]},
  { id: "rev-opt", queries: [
    { description: "Trailing commission by AMC — top earners", hint: "FROM amc_commission_monthly ORDER BY commission_earned_cr DESC" },
    { description: "Category mix shift over time (equity vs debt vs ELSS)", hint: "FROM fund_platform_aum GROUP BY category, month" },
    { description: "Average SIP amount trend and step-up adoption", hint: "FROM sips_full GROUP BY DATE_TRUNC quarter start_date" },
  ]},
  { id: "user-segmentation", queries: [
    { description: "Acquisition channel quality: 12-month SIP retention by channel", hint: "FROM sip_cohort_retention JOIN investors on acquisition_channel" },
    { description: "Income bracket and risk profile SIP amount distribution", hint: "FROM sips_full GROUP BY annual_income, risk_profile" },
    { description: "T30 vs B30: avg SIP, equity allocation, retention comparison", hint: "FROM city_tier_kpis" },
  ]},
  { id: "geographic", queries: [
    { description: "State-wise investor count and AUM contribution", hint: "FROM investors JOIN fund_platform_aum GROUP BY state" },
    { description: "B30 city SIP growth vs T30 YoY", hint: "FROM city_tier_kpis WHERE city_tier IN ('t30','b30') ORDER BY month" },
    { description: "State with highest SIP cancellation rate", hint: "FROM sips_full GROUP BY state WHERE status='cancelled'" },
  ]},
  { id: "crm-analytics", queries: [
    { description: "Campaign conversion rates by campaign_type", hint: "FROM campaign_performance ORDER BY conversion_rate DESC" },
    { description: "Tax-saving email performance Jan-Mar vs rest of year", hint: "FROM comms_full WHERE campaign_type='tax_saving' vs avg" },
    { description: "Pre-redemption call outcome: retained vs churned", hint: "FROM advisory_full WHERE session_type='pre_redemption_call' GROUP BY outcome" },
  ]},
  { id: "growth-analytics", queries: [
    { description: "Fund discovery funnel: view → watchlist → invest by source", hint: "FROM fund_discovery_funnel ORDER BY view_to_invest_pct DESC" },
    { description: "FI Select fund view-to-invest vs non-FI-Select", hint: "FROM fund_views_full GROUP BY is_fi_select" },
    { description: "Goal creation → SIP creation conversion by created_by", hint: "FROM goals_full JOIN sips_full... WITHIN 30 DAYS" },
  ]},
]
```

---

## File List

| File | Action | Description |
|------|--------|-------------|
| `scripts/generate-fundsindia.ts` | CREATE | Main generator (~3,500 lines) |
| `scripts/setup-fundsindia.ts` | CREATE | DuckDB setup (~300 lines) |
| `scripts/validate-fundsindia.ts` | CREATE | Calibration checker — validates all targets, planted stories, FK integrity (~200 lines) |
| `src/lib/datasets/fundsindia.ts` | CREATE | DatasetConfig (~1,200 lines) |
| `src/lib/datasets/index.ts` | EDIT | Add `fundsindia` to STATIC_DATASETS |
| `src/lib/datasets/constants.ts` | EDIT | Add `"fundsindia"` to DEFAULT_SAMPLE_DATASETS |
| `data/csv/fundsindia/` | CREATE | Output directory for 10 CSV files |
| `data/fundsindia.duckdb` | CREATE | Final DuckDB database |

### CSV Files in `data/csv/fundsindia/`

| File | Rows | Key purpose |
|------|------|-------------|
| `funds.csv` | 150 | Fund master — real names, AMC weights, returns, FI Select flags |
| `investors.csv` | 50,000 | Profiles — 35K pre-existing + 15K new in period |
| `sips.csv` | 120,000 | SIP book — starting 185K, growing to 270K |
| `transactions.csv` | 350,000 | All investment events (SIP installments + lumpsums + redemptions) |
| `systematic_plans.csv` | 12,000 | STP/SWP/Super Savings plans |
| `goals.csv` | 65,000 | Money Mitr + self-set goals |
| `comms_log.csv` | 300,000 | Platform-side sends (email/push/SMS/WhatsApp) |
| `advisory_sessions.csv` | 20,000 | Advisor sessions + Money Mitr interactions |
| `support_tickets.csv` | 10,000 | Support cases (KYC spike planted in Jun-Jul 2024) |
| `user_events.csv` | 1,500,000 | **Mixpanel-style event log** — all user behaviors across 22 surfaces |

---

## Acceptance Criteria

### Functional
- [ ] Generator produces 10 CSV files with correct row counts and column types
- [ ] All FK relationships valid (no orphan investor_id, fund_id, sip_id, event references)
- [ ] All 24 calibration targets match within tolerance (validation script passes)
- [ ] Industry SIP anchors exactly match real data: Jun 2024 ₹21,262 Cr, Mar 2025 ₹25,926 Cr, Sep 2025 ₹29,361 Cr
- [ ] DuckDB setup creates all views and summary tables without errors
- [ ] DatasetConfig loads in the app, LLM generates valid SQL
- [ ] All 6 suggested prompts produce meaningful results
- [ ] All 12 planted analytical stories are discoverable via NL queries
- [ ] Analytics Explorer events work for trends, funnel, retention
- [ ] user_events covers all 22 page surfaces (calculator, academy, fund pages, onboarding steps, investment flows)
- [ ] Jun-Jul 2024 KYC spike visible in support_tickets + investors kyc_status
- [ ] Oct 2024 email alert open rate 34% visible in comms_log
- [ ] Jan-Mar ELSS SIP spike 3.2× baseline visible in both 2025 and 2026

### Non-Functional
- [ ] Generator runs in <6 minutes on standard laptop
- [ ] DuckDB file size <500MB (24 months vs 36 months = smaller)
- [ ] user_events.csv (1.5M rows, largest table) queryable in <3 seconds with proper indexes
- [ ] Seeded PRNG produces identical output on re-run (seed=42)
- [ ] No NULL in required columns
- [ ] Date range strictly within Jun 2024 – May 2026 across all tables

---

## Dependencies & Prerequisites

- Node.js 22+ with tsx runner
- DuckDB node-api (already in project)
- Existing helper patterns from `scripts/generate-quickhelp-v2.ts` (PRNG, writeCsv)
- Real AMFI fund list from `portal.amfiindia.com/spages/NAVAll.txt` (already fetched in research)
- AMFI March 2025 Excel at `/tmp/amfi_mar2025.xls` (already downloaded in research)

## References

| Resource | Contents |
|----------|----------|
| FundsIndia website screenshots (onboarding, invest, dashboard) | Exact field names, values, UI flows |
| AMFI March 2025 Excel | Category-wise AUM, folios, inflows — all real numbers |
| AdvisorKhoj AMC AUM table | AMC market share percentages |
| Tata MF article | Monthly SIP growth curve Apr 2025 - Sep 2025 |
| AMFI state-wise data | Maharashtra 46% AUM, T30 82% / B30 18% folio split |
| AMFI NAVAll.txt (portal.amfiindia.com) | Real fund names and scheme codes across all AMCs |
| FundsIndia KYC review screen | Exact occupation values, income bracket labels |
| FundsIndia invest page | Fund categories, investment types, systematic plans taxonomy |
| This plan document | Session research consolidation |
