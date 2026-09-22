import {
  deepResearchThread,
  normalThread,
  type StarterChat,
} from "@/lib/server/starter-chats";

// Authored demo threads for the vastu-hfc dataset: a housing-finance lender
// running two books (HFC = housing, Finserve = vehicle/MSME). Every figure is
// pulled from the dataset's own DuckDB and validated. Magnitudes use K/M/B.

const normals: StarterChat[] = [
  normalThread({
    slug: "gnpa-and-dpd-overdue",
    title: "How healthy is the book, and which DPD bucket holds the overdue?",
    question:
      "What's our GNPA right now, and which DPD bucket is carrying the most overdue value?",
    primaryAgent: { id: "data-quality", name: "Data Quality Agent", icon: "shield" },
    answer: `## Book health at a glance

Consolidated **GNPA is 1.42%**: 1,913 Stage-3 loans against 135,125 live (active + NPA) accounts, sitting on ₹205.2M of total overdue [data-quality:Q1]. That is a healthy headline for a two-book lender, but the average hides a sharp split between the secured housing book and the higher-yield vehicle/MSME book.

| Entity | Live loans | Stage-3 | GNPA | Share of NPA stock |
|---|---|---|---|---|
| HFC (housing) | 78,092 | 798 | **1.02%** | 41.7% |
| Finserve (vehicle/MSME) | 57,033 | 1,115 | **1.96%** | 58.3% |

Finserve runs GNPA at roughly 2x the housing book despite carrying only 42% of live accounts [data-quality:Q2]. So while the consolidated number looks calm, **58.3% of the Stage-3 stock sits on the smaller book** [data-quality:Q2]. The two books are really two different risk profiles wearing one consolidated number.

## Where the overdue value sits

Across the delinquent population there is **₹205.2M of overdue spread over four DPD buckets**, and the weight is concentrated at the deepest end [data-quality:Q3]. Reading the cumulative column makes the concentration unmistakable:

| DPD bucket | Loans | Overdue | Share | Cumulative |
|---|---|---|---|---|
| sma_0 (1-30 DPD) | 2,307 | ₹15.5M | 8% | 8% |
| sma_1 (31-60 DPD) | 1,608 | ₹31.7M | 15% | 23% |
| sma_2 (61-90 DPD) | 1,687 | ₹54.8M | 27% | 50% |
| npa_90 (90-180 DPD) | 1,735 | **₹103.2M** | 50% | 100% |

The **npa_90 bucket alone holds half of all overdue value** on the smallest loan count of the four [data-quality:Q3]. The three pre-NPA SMA buckets together (₹102.0M) hold almost exactly as much as the single NPA bucket (₹103.2M). That is the signature of late-stage hardening: tickets get larger and cures get rarer as accounts age, so value piles up at the back of the curve.

## The two books carry the overdue differently

A closer cut of the two deepest buckets shows the housing book is not immune, it just carries fewer but heavier tickets [data-quality:Q4]:

| Entity | Bucket | Loans | Overdue | Avg overdue/loan |
|---|---|---|---|---|
| HFC | npa_90 | 780 | ₹55.5M | ₹71.2K |
| Finserve | npa_90 | 955 | ₹47.7M | ₹49.9K |
| HFC | sma_2 | 804 | ₹35.2M | ₹43.7K |
| Finserve | sma_2 | 883 | ₹19.6M | ₹22.2K |

Finserve has more delinquent accounts, but each housing ticket in NPA is ~1.4x heavier (₹71.2K vs ₹49.9K) [data-quality:Q4]. So Finserve is the volume problem and HFC is the ticket-size problem: a single housing NPA costs more to carry than a single Finserve one.

## The cushion: collection efficiency is holding

The reason GNPA stays calm despite the overdue stock is that scheduled-EMI collection efficiency is running **94.4% in March 2025**, with the bounce rate easing from 32.4% in October to 29.0% and average DPD-at-payment falling from 11.2 days to 6.8 [data-quality:Q5]. The book is collecting current dues well even as the back-book hardens.

## What this means for the desk

The sma_2 bucket (1,687 loans, ₹54.8M) is the last gate before NPA classification [data-quality:Q3]. Stemming the flow out of sma_2 before it rolls into npa_90 is where collections effort moves GNPA most, because every account saved there avoids a much larger overdue ticket landing in the NPA bucket. Finserve is the book to watch on volume (58.3% of the NPA stock, ~2x the housing GNPA) [data-quality:Q2], while HFC deserves a second look on ticket size given its ₹71.2K average NPA exposure [data-quality:Q4].`,
    followUps: [
      "Which branches are driving the Finserve GNPA?",
      "How many sma_2 loans are about to roll into NPA this month?",
      "What does the NPA trend look like over the last 8 quarters?",
    ],
    work: {
      queries: [
        {
          sql: "SELECT COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live_loans, COUNT(*) FILTER (WHERE stage = 3) AS stage_3, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct, ROUND(SUM(overdue_amount) FILTER (WHERE dpd_bucket IN ('sma_0','sma_1','sma_2','npa_90')) / 1e6, 1) AS total_overdue_m FROM loans_full",
          description: "Consolidated GNPA (Stage-3 over live accounts) and total overdue across all DPD buckets.",
          rowCount: 1,
          executionTimeMs: 441,
          columns: ["live_loans", "stage_3", "gnpa_pct", "total_overdue_m"],
          data: [{ live_loans: 135125, stage_3: 1913, gnpa_pct: 1.42, total_overdue_m: 205.2 }],
        },
        {
          sql: "WITH base AS (SELECT entity, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live, COUNT(*) FILTER (WHERE stage = 3) AS s3 FROM loans_full GROUP BY entity) SELECT entity, live AS live_loans, s3 AS stage_3, ROUND(100.0 * s3 / live, 2) AS gnpa_pct, ROUND(100.0 * s3 / SUM(s3) OVER (), 1) AS share_of_npa FROM base ORDER BY entity",
          description: "Per-entity GNPA with each book's window share of the total Stage-3 stock.",
          rowCount: 2,
          executionTimeMs: 503,
          columns: ["entity", "live_loans", "stage_3", "gnpa_pct", "share_of_npa"],
          data: [
            { entity: "finserve", live_loans: 57033, stage_3: 1115, gnpa_pct: 1.96, share_of_npa: 58.3 },
            { entity: "hfc", live_loans: 78092, stage_3: 798, gnpa_pct: 1.02, share_of_npa: 41.7 },
          ],
        },
        {
          sql: "WITH b AS (SELECT dpd_bucket, COUNT(*) AS loans, SUM(overdue_amount) AS od FROM loans_full WHERE dpd_bucket IN ('sma_0','sma_1','sma_2','npa_90') GROUP BY dpd_bucket) SELECT dpd_bucket, loans, ROUND(od / 1e6, 1) AS overdue_m, ROUND(100.0 * od / SUM(od) OVER (), 0) AS pct_overdue, ROUND(100.0 * SUM(od) OVER (ORDER BY CASE dpd_bucket WHEN 'sma_0' THEN 1 WHEN 'sma_1' THEN 2 WHEN 'sma_2' THEN 3 ELSE 4 END) / SUM(od) OVER (), 0) AS cum_pct FROM b ORDER BY CASE dpd_bucket WHEN 'sma_0' THEN 1 WHEN 'sma_1' THEN 2 WHEN 'sma_2' THEN 3 ELSE 4 END",
          description: "Overdue by DPD bucket with each bucket's share and a running cumulative share along the roll path.",
          rowCount: 4,
          executionTimeMs: 612,
          columns: ["dpd_bucket", "loans", "overdue_m", "pct_overdue", "cum_pct"],
          data: [
            { dpd_bucket: "sma_0", loans: 2307, overdue_m: 15.5, pct_overdue: 8, cum_pct: 8 },
            { dpd_bucket: "sma_1", loans: 1608, overdue_m: 31.7, pct_overdue: 15, cum_pct: 23 },
            { dpd_bucket: "sma_2", loans: 1687, overdue_m: 54.8, pct_overdue: 27, cum_pct: 50 },
            { dpd_bucket: "npa_90", loans: 1735, overdue_m: 103.2, pct_overdue: 50, cum_pct: 100 },
          ],
        },
        {
          sql: "SELECT entity, dpd_bucket, COUNT(*) AS loans, ROUND(SUM(overdue_amount) / 1e6, 1) AS overdue_m, ROUND(AVG(overdue_amount) / 1e3, 1) AS avg_overdue_k FROM loans_full WHERE dpd_bucket IN ('sma_2','npa_90') GROUP BY entity, dpd_bucket ORDER BY dpd_bucket, entity",
          description: "The two deepest buckets split by entity, with average overdue per loan to expose ticket-size differences.",
          rowCount: 4,
          executionTimeMs: 487,
          columns: ["entity", "dpd_bucket", "loans", "overdue_m", "avg_overdue_k"],
          data: [
            { entity: "finserve", dpd_bucket: "npa_90", loans: 955, overdue_m: 47.7, avg_overdue_k: 49.9 },
            { entity: "hfc", dpd_bucket: "npa_90", loans: 780, overdue_m: 55.5, avg_overdue_k: 71.2 },
            { entity: "finserve", dpd_bucket: "sma_2", loans: 883, overdue_m: 19.6, avg_overdue_k: 22.2 },
            { entity: "hfc", dpd_bucket: "sma_2", loans: 804, overdue_m: 35.2, avg_overdue_k: 43.7 },
          ],
        },
        {
          sql: "SELECT strftime(month, '%Y-%m') AS month, ROUND(collection_efficiency_pct, 1) AS coll_eff, ROUND(bounce_rate_pct, 1) AS bounce_rate, ROUND(avg_dpd, 1) AS avg_dpd FROM collection_efficiency ORDER BY month DESC LIMIT 6",
          description: "Scheduled-EMI collection efficiency, bounce rate and average DPD over the last six months.",
          rowCount: 6,
          executionTimeMs: 318,
          columns: ["month", "coll_eff", "bounce_rate", "avg_dpd"],
          data: [
            { month: "2025-03", coll_eff: 94.4, bounce_rate: 29, avg_dpd: 6.8 },
            { month: "2025-02", coll_eff: 94.4, bounce_rate: 29, avg_dpd: 7.6 },
            { month: "2025-01", coll_eff: 94.5, bounce_rate: 29, avg_dpd: 8.4 },
            { month: "2024-12", coll_eff: 95.6, bounce_rate: 29.1, avg_dpd: 8.3 },
            { month: "2024-11", coll_eff: 95.2, bounce_rate: 32.2, avg_dpd: 10.1 },
            { month: "2024-10", coll_eff: 95.2, bounce_rate: 32.4, avg_dpd: 11.2 },
          ],
        },
      ],
      summary:
        "Pulled consolidated and per-entity GNPA, the overdue distribution by DPD bucket with cumulative share, an entity-by-bucket ticket-size cut, and the collection-efficiency trend. Headline GNPA is 1.42%, Finserve holds 58.3% of the NPA stock at ~2x the housing rate, half the overdue sits in npa_90, and collection efficiency holds at 94.4%.",
    },
  }),
  normalThread({
    slug: "disbursement-trend-h2-fy25",
    title: "How has disbursement trended over the last 6 months?",
    question: "How has disbursement trended over the last 6 months of FY25?",
    primaryAgent: { id: "daily-metrics", name: "Daily Metrics Agent", icon: "bar-chart" },
    answer: `## Disbursement is growing, steadily

New business grew every month through H2 FY25 in both volume and value, with no flat patches [daily-metrics:Q1]. The month-on-month column shows the back-half acceleration:

| Month | Loans | Disbursed | MoM value growth |
|---|---|---|---|
| Oct 2024 | 6,696 | ₹5.31B | - |
| Nov 2024 | 6,787 | ₹5.39B | +1.5% |
| Dec 2024 | 6,879 | ₹5.46B | +1.5% |
| Jan 2025 | 7,323 | ₹5.87B | +7.4% |
| Feb 2025 | 7,418 | ₹6.05B | +3.1% |
| Mar 2025 | 7,514 | ₹6.10B | +0.8% |

That is **+12.2% loan volume and +14.9% disbursed value** from Oct to Mar [daily-metrics:Q1]. The single biggest step came in January (+7.4% MoM), the start of the fiscal-year-end push, when monthly value jumped from ₹5.46B in Dec to ₹5.87B [daily-metrics:Q1]. March closed at ₹6.10B across 7,514 loans, the book's highest monthly run-rate in the period.

## The growth is tilting toward the safer book

Disbursed value rose faster than loan count (14.9% vs 12.2%), so average ticket size edged up as well [daily-metrics:Q1]. More importantly, the **home-loan share of new business ticked up from 41.7% in Oct to 42.7% in Mar** [daily-metrics:Q2]. Housing is the lower-risk, secured side of the book (it runs ~1.0% GNPA versus ~2.0% on Finserve), so the mix shift means the growth is coming from the part of the book that is cheapest to hold and least likely to slip into NPA.

## What actually drove the Q4 lift

Breaking the Dec-to-Mar increment by product confirms the quality tilt: housing products supplied the bulk of the added volume [daily-metrics:Q3]:

| Product | Dec loans | Mar loans | Added |
|---|---|---|---|
| home_purchase | 1,847 | 2,063 | +216 |
| home_construction | 531 | 654 | +123 |
| msme | 826 | 896 | +70 |
| home_improvement | 432 | 490 | +58 |
| lap_residential | 555 | 608 | +53 |

home_purchase and home_construction together added 339 loans of the lift, more than 4x the MSME contribution [daily-metrics:Q3]. The growth is concentrated in the cleanest, lowest-yield products.

## The yield trade-off is intact

Looking at Q4 (Jan-Mar) disbursal by entity, housing carried the value while accepting the lower rate [daily-metrics:Q4]:

| Entity | Loans | Wtd avg rate | Disbursed |
|---|---|---|---|
| HFC (housing) | 12,255 | 15.15% | ₹13.43B |
| Finserve | 10,000 | 20.60% | ₹4.58B |

HFC disbursed almost 3x the value of Finserve at roughly two-thirds the rate [daily-metrics:Q4]. That is the housing-finance bargain: lower coupon in exchange for a book that runs at half the loss rate.

## Read for the desk

A steady upward run-rate with a quality-positive mix shift is the best version of growth a housing-finance book can show: more volume, larger tickets, and a rising secured share all at once. The watch-item is whether the Q4 surge held its credit standards, since fiscal-year-end pushes can loosen underwriting; the vintage data (2025 disbursals running lower GNPA than 2022-2024) suggests it did [daily-metrics:Q5].`,
    followUps: [
      "Is the disbursement quality holding as volume grows?",
      "Which products drove the Q4 disbursement lift?",
      "How does new-loan yield compare across the two books?",
    ],
    work: {
      queries: [
        {
          sql: "WITH m AS (SELECT month, SUM(loan_count) AS loans, SUM(total_amount) AS amt FROM monthly_disbursements WHERE month >= DATE '2024-10-01' GROUP BY month) SELECT strftime(month, '%Y-%m') AS month, loans, ROUND(amt / 1e9, 2) AS disbursed_b, ROUND(100.0 * (amt - LAG(amt) OVER (ORDER BY month)) / LAG(amt) OVER (ORDER BY month), 1) AS mom_growth_pct FROM m ORDER BY month",
          description: "Monthly disbursement volume and value with a LAG-based month-on-month value growth rate.",
          rowCount: 6,
          executionTimeMs: 547,
          columns: ["month", "loans", "disbursed_b", "mom_growth_pct"],
          data: [
            { month: "2024-10", loans: 6696, disbursed_b: 5.31, mom_growth_pct: null },
            { month: "2024-11", loans: 6787, disbursed_b: 5.39, mom_growth_pct: 1.5 },
            { month: "2024-12", loans: 6879, disbursed_b: 5.46, mom_growth_pct: 1.5 },
            { month: "2025-01", loans: 7323, disbursed_b: 5.87, mom_growth_pct: 7.4 },
            { month: "2025-02", loans: 7418, disbursed_b: 6.05, mom_growth_pct: 3.1 },
            { month: "2025-03", loans: 7514, disbursed_b: 6.1, mom_growth_pct: 0.8 },
          ],
        },
        {
          sql: "SELECT strftime(month, '%Y-%m') AS month, ROUND(100.0 * SUM(loan_count) FILTER (WHERE product_type LIKE 'home%') / SUM(loan_count), 1) AS home_loan_share FROM monthly_disbursements WHERE month IN (DATE '2024-10-01', DATE '2025-03-01') GROUP BY month ORDER BY month",
          description: "Home-loan share of new disbursement, comparing the first and last month of the period.",
          rowCount: 2,
          executionTimeMs: 351,
          columns: ["month", "home_loan_share"],
          data: [
            { month: "2024-10", home_loan_share: 41.7 },
            { month: "2025-03", home_loan_share: 42.7 },
          ],
        },
        {
          sql: "WITH p AS (SELECT product_type, SUM(loan_count) FILTER (WHERE month = DATE '2024-12-01') AS dec_loans, SUM(loan_count) FILTER (WHERE month = DATE '2025-03-01') AS mar_loans FROM monthly_disbursements GROUP BY product_type) SELECT product_type, dec_loans, mar_loans, mar_loans - dec_loans AS delta FROM p WHERE dec_loans IS NOT NULL ORDER BY delta DESC LIMIT 5",
          description: "Product-level contribution to the Q4 lift, comparing December to March loan counts.",
          rowCount: 5,
          executionTimeMs: 488,
          columns: ["product_type", "dec_loans", "mar_loans", "delta"],
          data: [
            { product_type: "home_purchase", dec_loans: 1847, mar_loans: 2063, delta: 216 },
            { product_type: "home_construction", dec_loans: 531, mar_loans: 654, delta: 123 },
            { product_type: "msme", dec_loans: 826, mar_loans: 896, delta: 70 },
            { product_type: "home_improvement", dec_loans: 432, mar_loans: 490, delta: 58 },
            { product_type: "lap_residential", dec_loans: 555, mar_loans: 608, delta: 53 },
          ],
        },
        {
          sql: "SELECT entity, SUM(loan_count) AS loans, ROUND(SUM(avg_rate * loan_count) / SUM(loan_count), 2) AS wtd_avg_rate, ROUND(SUM(total_amount) / 1e9, 2) AS disbursed_b FROM monthly_disbursements WHERE month >= DATE '2025-01-01' GROUP BY entity ORDER BY entity",
          description: "Q4 (Jan to Mar) disbursal by entity with a volume-weighted average rate.",
          rowCount: 2,
          executionTimeMs: 372,
          columns: ["entity", "loans", "wtd_avg_rate", "disbursed_b"],
          data: [
            { entity: "finserve", loans: 10000, wtd_avg_rate: 20.6, disbursed_b: 4.58 },
            { entity: "hfc", loans: 12255, wtd_avg_rate: 15.15, disbursed_b: 13.43 },
          ],
        },
        {
          sql: "SELECT EXTRACT(year FROM disbursement_date) AS vintage_year, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3 AND entity = 'finserve') / NULLIF(COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND entity = 'finserve'), 0), 2) AS finserve_gnpa, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3 AND entity = 'hfc') / NULLIF(COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND entity = 'hfc'), 0), 2) AS hfc_gnpa FROM loans_full GROUP BY vintage_year ORDER BY vintage_year",
          description: "GNPA by disbursement vintage and entity, to confirm newer cohorts are not deteriorating.",
          rowCount: 4,
          executionTimeMs: 661,
          columns: ["vintage_year", "finserve_gnpa", "hfc_gnpa"],
          data: [
            { vintage_year: 2022, finserve_gnpa: 3.44, hfc_gnpa: 1.01 },
            { vintage_year: 2023, finserve_gnpa: 2.46, hfc_gnpa: 1.04 },
            { vintage_year: 2024, finserve_gnpa: 1.69, hfc_gnpa: 1.04 },
            { vintage_year: 2025, finserve_gnpa: 1.36, hfc_gnpa: 0.94 },
          ],
        },
      ],
      summary:
        "Tracked the H2 FY25 disbursement run-rate with MoM growth, the home-loan mix shift, the product-level Q4 lift, the entity yield trade-off and vintage quality. Volume grew +12.2% and value +14.9%, the lift was led by housing products, and 2025 vintages run cleaner than prior years, so growth has not loosened underwriting.",
    },
  }),
];

const deeps: StarterChat[] = [
  deepResearchThread({
    slug: "npa-early-warning-rollrate",
    title: "Which borrowers are about to roll into NPA?",
    question:
      "Which accounts are about to roll into NPA, and where should the early-warning team focus before quarter close?",
    report: `## NPA Early-Warning: The Roll-Rate Picture

### Executive summary

**5,602 live loans sit in the SMA pipeline (1-90 DPD), carrying ₹102.0M of overdue** [cohort-retention:Q1]. The sma_2 bucket (61-90 DPD) is the last gate before NPA classification: **1,687 loans, ₹54.8M overdue** [cohort-retention:Q1]. Left alone, a large share of these harden into the npa_90 bucket within one billing cycle, where half the book's total overdue value already sits [cohort-retention:Q1]. The book today has roughly as much overdue value already inside NPA (₹103.2M) as it does in the entire pre-NPA pipeline (₹102.0M), so every roll prevented is a near one-for-one saving against fresh provisioning.

The risk is not evenly spread. It concentrates in the Finserve (vehicle/MSME) book, in the oldest vintages, and in self-employed informal borrowers, and the quarterly NPA-formation trend has been accelerating for five straight quarters. This report locates the pre-close worklist, sizes the roll, and ranks where the early-warning team should spend the next two weeks.

### Methodology and data note

GNPA is computed as Stage-3 loans over live (active + NPA) accounts, consistent with the rest of the book reporting. The SMA pipeline uses the regulatory DPD buckets (sma_0 = 1-30, sma_1 = 31-60, sma_2 = 61-90, npa_90 = 90-180). Overdue value is the sum of \`overdue_amount\` on live loans in each bucket. Quarterly NPA movement is read from the \`npa_quarterly_movement\` table (crore converted to ₹M at 10x). EMI bounce behavior is taken from the payment-level \`collections_full\` table for due dates on or after Jan 2025. All figures were validated against the dataset's own DuckDB.

### SMA pipeline by bucket (the roll path)

| DPD bucket | Stage | Loans | Overdue | Roll risk |
|---|---|---|---|---|
| sma_0 (1-30) | 1 | 2,307 | ₹15.5M | Low, most self-cure |
| sma_1 (31-60) | 1 | 1,608 | ₹31.7M | Medium |
| sma_2 (61-90) | 2 | 1,687 | ₹54.8M | **High, next stop is NPA** |
| npa_90 (90-180) | 3 | 1,735 | ₹103.2M | Already NPA |

The three SMA buckets carry ₹102.0M; the npa_90 bucket carries ₹103.2M on its own [cohort-retention:Q1]. So the book has roughly as much overdue already in NPA as it has in the entire pre-NPA pipeline: every roll prevented is a direct saving.

Ticket size also escalates with age, which is why catching accounts early matters in rupees, not just count. Median overdue per loan rises from ₹16.8K in sma_1 to ₹28.0K in sma_2 to ₹44.7K in npa_90, and the 90th-percentile ticket nearly triples across the same path (₹31.7K to ₹84.7K) [cohort-retention:Q4]. A loan saved in sma_2 avoids a ticket that, untreated, lands ~60% heavier in NPA.

### The roll is concentrated in Finserve

Finserve carries the bulk of the late-stage pipeline despite being the smaller book [cohort-retention:Q2]:

| Entity | sma_0 | sma_1 | sma_2 | npa_90 |
|---|---|---|---|---|
| Finserve | 1,109 | 835 | 883 | 955 |
| HFC | 1,198 | 773 | 804 | 780 |

Finserve holds **52% of sma_2 loans** on **42% of live accounts** [cohort-retention:Q2][data-quality:Q1]: its accounts roll faster and cure slower. The leading indicator confirms it: on payments due since Jan 2025, the Finserve EMI bounce rate runs **34.0%** with average DPD-at-payment of 9.1 days, versus **25.3%** and 6.5 days on the housing book [daily-metrics:Q1]. More bounces upstream means a fuller SMA funnel downstream.

### Vintage tells you where the risk was written

Older Finserve vintages are the most delinquent; the housing book is flat and well-behaved across vintages [data-quality:Q2]:

| Disb. year | Finserve GNPA | HFC GNPA |
|---|---|---|
| 2022 | **3.44%** | 1.01% |
| 2023 | 2.46% | 1.04% |
| 2024 | 1.69% | 1.04% |
| 2025 | 1.36% | 0.94% |

Finserve's 2022 cohort sits at 3.44% GNPA, more than 3x the matching housing vintage, and the deterioration steps down cleanly as cohorts get newer [data-quality:Q2]. The housing book shows no such pattern: every vintage hugs ~1.0%.

### Borrower-segment lens: who rolls

The pipeline is densest among informal-income borrowers, who also make up the bulk of the live base [user-segmentation:Q1]:

| Employment type | Live loans | sma_2 | sma_2 % | GNPA |
|---|---|---|---|---|
| salaried_informal | 11,941 | 160 | **1.34%** | 1.49% |
| self_employed_informal | 89,214 | 1,145 | 1.28% | 1.43% |
| self_employed_formal | 20,549 | 237 | 1.15% | 1.32% |
| salaried_formal | 13,421 | 145 | 1.08% | 1.40% |

Informal-income segments carry both the highest sma_2 rate and the highest GNPA [user-segmentation:Q1]. Self-employed-informal is the single largest pool (89,214 live, 1,145 sma_2 loans), so it should anchor any segment-based worklist. Within Finserve specifically, the LIG income tier holds the most sma_2 loans (590) while the MIG tier carries the highest GNPA (2.10%) [user-segmentation:Q2].

### Geographic lens: where the late Finserve overdue sits

| State | Finserve sma_2 | Finserve npa_90 | Late overdue (sma_2 + npa) |
|---|---|---|---|
| Maharashtra | 135 | 142 | **₹10.4M** |
| Tamil Nadu | 113 | 113 | ₹7.9M |
| Rajasthan | 101 | 87 | ₹6.1M |
| Gujarat | 72 | 84 | ₹5.8M |
| Andhra Pradesh | 75 | 86 | ₹5.6M |

Maharashtra alone carries ₹10.4M of late-stage Finserve overdue, more than the next two states combined [geographic:Q1]. A state-led recovery push should open in Maharashtra and Tamil Nadu.

### Branch-level worklist (sma_2 by overdue)

Ranking branches by sma_2 overdue gives a ready strike-list [cohort-retention:Q3]:

| Branch | Entity | sma_2 loans | Overdue |
|---|---|---|---|
| Indore Branch | HFC | 27 | ₹1.20M |
| Jaipur Micro Branch | HFC | 26 | ₹1.16M |
| Chennai Main Branch | HFC | 25 | ₹1.16M |
| Chennai Finserve Branch | Finserve | 53 | ₹1.13M |
| Pune Finserve Branch | Finserve | 49 | ₹1.09M |

Finserve branches carry roughly twice the sma_2 loan count per branch (49-53) at similar overdue value, meaning smaller, more numerous tickets, which is exactly the profile that responds to early phone-and-field contact [cohort-retention:Q3].

### The trend is the alarm

NPA flow has accelerated on the Finserve book. Quarterly GNPA movement (closing gross-NPA balance) [rev-opt:Q1]:

| Quarter | Finserve closing | HFC closing |
|---|---|---|
| FY24-Q4 | ₹511M | ₹389M |
| FY25-Q1 | ₹696M | ₹402M |
| FY25-Q2 | ₹812M | ₹502M |
| FY25-Q3 | ₹816M | ₹496M |
| FY25-Q4 | **₹918M** | ₹546M |

Reading the quarter-on-quarter change on Finserve makes the acceleration explicit: the closing balance jumped **+₹185M in FY25-Q1** and added another **+₹101M in FY25-Q4**, after a near-flat FY25-Q3 (+₹4M) [rev-opt:Q3]. The book is not stabilizing; it is stepping up.

Across FY25, Finserve booked **₹919M of fresh NPA additions** against only **₹351M of cures + upgrades, a 2.6:1 ratio** [rev-opt:Q2]. HFC ran ₹465M additions vs ₹183M cures (2.5:1) but off a much smaller base [rev-opt:Q2]. The cure side is thin: FY25 Finserve recoveries were just ₹98M against ₹260M of write-offs and ₹253M of upgrades [rev-opt:Q4], so most of the "clearing" is reclassification and charge-off, not cash recovered.

### Provisioning headroom

If the sma_2 stock rolls, the provision cushion absorbs only part of it. At the latest month, Finserve carries ₹378M of Stage-2 exposure provisioned at just 15% PCR, and ₹493M of Stage-3 at 35% PCR [data-quality:Q3]. A wave of sma_2 to npa_90 rolls would force the Stage-3 provision rate (35%) onto exposure currently held at the Stage-2 rate (15%), a ~20-point coverage step-up that lands straight in the P&L.

## Key Findings

- **1,687 sma_2 loans (₹54.8M) are one cycle from NPA** [cohort-retention:Q1]: this is the priority pre-close worklist, and median ticket size jumps ~60% on the roll into NPA [cohort-retention:Q4].
- **Finserve is the engine of the roll**: 52% of sma_2 loans [cohort-retention:Q2], a 34.0% EMI bounce rate [daily-metrics:Q1], the worst vintages (2022 at 3.44% GNPA) [data-quality:Q2], and a 2.6:1 NPA-add-to-cure ratio [rev-opt:Q2].
- **The housing book is stable** across every vintage (0.94%-1.04% GNPA) [data-quality:Q2], so early-warning effort should be disproportionately weighted to Finserve.
- **Self-employed-informal borrowers** carry the densest sma_2 pipeline (1,145 loans) and elevated GNPA (1.43%) [user-segmentation:Q1]; **Maharashtra** holds the most late Finserve overdue (₹10.4M) [geographic:Q1].
- npa_90 already holds **₹103.2M, half of total overdue** [cohort-retention:Q1], and provisioning headroom is thin (Finserve Stage-2 PCR just 15%) [data-quality:Q3]: the cost of letting rolls happen is visible and largely unprovisioned.

## Recommended Actions

1. **Build a pre-close sma_2 worklist** of the 1,687 highest-risk accounts, Finserve first, and assign each to a named officer with a PTP target. Seed it from the branch ranking (Chennai Finserve, Pune Finserve, Indore) [cohort-retention:Q3].
2. **Cap the roll with a weekly KPI**: set a branch-level sma_2 to npa_90 roll-rate target, reviewed weekly not monthly, since the quarterly trend shows the funnel is filling faster than it drains [rev-opt:Q3].
3. **Run a Maharashtra + Tamil Nadu recovery sprint**: these two states hold ₹18.3M of late Finserve overdue between them [geographic:Q1].
4. **Tighten 2022-2023 Finserve vintage servicing**: these cohorts carry 2-3x the housing GNPA and are still seasoning [data-quality:Q2].
5. **Rebalance recovery spend toward cash cure**, given recoveries are only ₹98M against ₹260M of write-offs [rev-opt:Q4]; the book is clearing NPAs by charge-off, not collection.
6. **Pre-provision for the roll**: Finserve Stage-2 sits at 15% PCR against a 35% Stage-3 rate [data-quality:Q3], so model the coverage step-up now rather than taking it as a quarter-end surprise.

\`\`\`sql
-- SMA pipeline by bucket x entity, the live roll-rate worklist
SELECT
  l.entity,
  l.dpd_bucket,
  l.stage,
  COUNT(*)                              AS loans,
  ROUND(SUM(l.overdue_amount) / 1e6, 2) AS overdue_m
FROM loans_full l
WHERE l.loan_status IN ('active', 'npa')
  AND l.dpd_bucket IN ('sma_0', 'sma_1', 'sma_2', 'npa_90')
GROUP BY l.entity, l.dpd_bucket, l.stage
ORDER BY
  CASE l.dpd_bucket
    WHEN 'sma_0' THEN 1 WHEN 'sma_1' THEN 2
    WHEN 'sma_2' THEN 3 ELSE 4 END,
  overdue_m DESC;
\`\`\``,
    followUps: [
      "Give me the named sma_2 worklist for Finserve branches.",
      "What's the sma_2 to npa_90 roll-rate by branch?",
      "Which collection actions actually cure sma_2 accounts?",
      "How much provision do we need if these all roll?",
    ],
    work: {
      "data-quality": {
        queries: [
          {
            sql: "SELECT entity, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live_loans FROM loans_full GROUP BY entity ORDER BY entity",
            description: "Live account base by entity, to size each book's share of the pipeline.",
            rowCount: 2,
            executionTimeMs: 304,
            columns: ["entity", "live_loans"],
            data: [
              { entity: "finserve", live_loans: 57033 },
              { entity: "hfc", live_loans: 78092 },
            ],
          },
          {
            sql: "SELECT EXTRACT(year FROM disbursement_date) AS vintage_year, entity, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY vintage_year, entity ORDER BY entity, vintage_year",
            description: "GNPA by disbursement vintage and entity, to see where the risk was written.",
            rowCount: 8,
            executionTimeMs: 712,
            columns: ["vintage_year", "entity", "gnpa_pct"],
            data: [
              { vintage_year: 2022, entity: "finserve", gnpa_pct: 3.44 },
              { vintage_year: 2023, entity: "finserve", gnpa_pct: 2.46 },
              { vintage_year: 2024, entity: "finserve", gnpa_pct: 1.69 },
              { vintage_year: 2025, entity: "finserve", gnpa_pct: 1.36 },
              { vintage_year: 2022, entity: "hfc", gnpa_pct: 1.01 },
              { vintage_year: 2023, entity: "hfc", gnpa_pct: 1.04 },
              { vintage_year: 2024, entity: "hfc", gnpa_pct: 1.04 },
              { vintage_year: 2025, entity: "hfc", gnpa_pct: 0.94 },
            ],
          },
          {
            sql: "SELECT entity, ROUND(stage_2_exposure_cr * 10, 0) AS s2_exp_m, ROUND(stage_3_exposure_cr * 10, 0) AS s3_exp_m, pcr_stage_2, pcr_stage_3, ROUND(total_ecl_cr * 10, 0) AS total_ecl_m FROM ecl_provisions WHERE month = (SELECT MAX(month) FROM ecl_provisions) ORDER BY entity",
            description: "Latest-month ECL provisioning headroom: Stage-2 and Stage-3 exposure and coverage rates by entity.",
            rowCount: 2,
            executionTimeMs: 334,
            columns: ["entity", "s2_exp_m", "s3_exp_m", "pcr_stage_2", "pcr_stage_3", "total_ecl_m"],
            data: [
              { entity: "finserve", s2_exp_m: 378, s3_exp_m: 493, pcr_stage_2: 15, pcr_stage_3: 35, total_ecl_m: 360 },
              { entity: "hfc", s2_exp_m: 848, s3_exp_m: 802, pcr_stage_2: 12, pcr_stage_3: 40, total_ecl_m: 711 },
            ],
          },
        ],
        summary:
          "Sized the live base per entity, traced GNPA by vintage, and read provisioning headroom. Finserve's 2022 cohort sits at 3.44% (3x housing), and its Stage-2 exposure (₹378M) is held at just 15% PCR against a 35% Stage-3 rate, so a roll wave is largely unprovisioned.",
      },
      "cohort-retention": {
        queries: [
          {
            sql: "SELECT dpd_bucket, stage, COUNT(*) AS loans, ROUND(SUM(overdue_amount) / 1e6, 1) AS overdue_m FROM loans_full WHERE dpd_bucket IN ('sma_0','sma_1','sma_2','npa_90') GROUP BY dpd_bucket, stage ORDER BY dpd_bucket",
            description: "The roll path: loan count, stage and overdue value for each DPD bucket from SMA into NPA.",
            rowCount: 4,
            executionTimeMs: 489,
            columns: ["dpd_bucket", "stage", "loans", "overdue_m"],
            data: [
              { dpd_bucket: "npa_90", stage: 3, loans: 1735, overdue_m: 103.2 },
              { dpd_bucket: "sma_0", stage: 1, loans: 2307, overdue_m: 15.5 },
              { dpd_bucket: "sma_1", stage: 1, loans: 1608, overdue_m: 31.7 },
              { dpd_bucket: "sma_2", stage: 2, loans: 1687, overdue_m: 54.8 },
            ],
          },
          {
            sql: "SELECT entity, dpd_bucket, COUNT(*) AS loans FROM loans_full WHERE dpd_bucket IN ('sma_0','sma_1','sma_2','npa_90') GROUP BY entity, dpd_bucket ORDER BY dpd_bucket, entity",
            description: "SMA-to-NPA pipeline by entity, to locate where the roll is concentrated.",
            rowCount: 8,
            executionTimeMs: 533,
            columns: ["entity", "dpd_bucket", "loans"],
            data: [
              { entity: "finserve", dpd_bucket: "npa_90", loans: 955 },
              { entity: "hfc", dpd_bucket: "npa_90", loans: 780 },
              { entity: "finserve", dpd_bucket: "sma_0", loans: 1109 },
              { entity: "hfc", dpd_bucket: "sma_0", loans: 1198 },
              { entity: "finserve", dpd_bucket: "sma_1", loans: 835 },
              { entity: "hfc", dpd_bucket: "sma_1", loans: 773 },
              { entity: "finserve", dpd_bucket: "sma_2", loans: 883 },
              { entity: "hfc", dpd_bucket: "sma_2", loans: 804 },
            ],
          },
          {
            sql: "WITH s AS (SELECT branch_name, entity, COUNT(*) AS sma2_loans, SUM(overdue_amount) AS od FROM loans_full WHERE dpd_bucket = 'sma_2' GROUP BY branch_name, entity) SELECT branch_name, entity, sma2_loans, ROUND(od / 1e6, 2) AS overdue_m, ROW_NUMBER() OVER (ORDER BY od DESC) AS rnk FROM s ORDER BY od DESC LIMIT 5",
            description: "Branch-level sma_2 worklist ranked by overdue value with a window ROW_NUMBER.",
            rowCount: 5,
            executionTimeMs: 706,
            columns: ["branch_name", "entity", "sma2_loans", "overdue_m", "rnk"],
            data: [
              { branch_name: "Indore Branch", entity: "hfc", sma2_loans: 27, overdue_m: 1.2, rnk: 1 },
              { branch_name: "Jaipur Micro Branch", entity: "hfc", sma2_loans: 26, overdue_m: 1.16, rnk: 2 },
              { branch_name: "Chennai Main Branch", entity: "hfc", sma2_loans: 25, overdue_m: 1.16, rnk: 3 },
              { branch_name: "Chennai Finserve Branch", entity: "finserve", sma2_loans: 53, overdue_m: 1.13, rnk: 4 },
              { branch_name: "Pune Finserve Branch", entity: "finserve", sma2_loans: 49, overdue_m: 1.09, rnk: 5 },
            ],
          },
          {
            sql: "SELECT dpd_bucket, COUNT(*) AS loans, ROUND(quantile_cont(overdue_amount, 0.5) / 1e3, 1) AS median_overdue_k, ROUND(quantile_cont(overdue_amount, 0.9) / 1e3, 1) AS p90_overdue_k FROM loans_full WHERE dpd_bucket IN ('sma_1','sma_2','npa_90') GROUP BY dpd_bucket ORDER BY median_overdue_k",
            description: "Median and 90th-percentile overdue ticket per loan along the sma_1 to npa roll path.",
            rowCount: 3,
            executionTimeMs: 588,
            columns: ["dpd_bucket", "loans", "median_overdue_k", "p90_overdue_k"],
            data: [
              { dpd_bucket: "sma_1", loans: 1608, median_overdue_k: 16.8, p90_overdue_k: 31.7 },
              { dpd_bucket: "sma_2", loans: 1687, median_overdue_k: 28, p90_overdue_k: 52.9 },
              { dpd_bucket: "npa_90", loans: 1735, median_overdue_k: 44.7, p90_overdue_k: 84.7 },
            ],
          },
        ],
        summary:
          "Mapped the SMA-to-NPA roll path by bucket and entity, ranked branches by sma_2 overdue, and traced ticket-size escalation. 1,687 sma_2 loans (₹54.8M) are one cycle from NPA, Finserve holds 52% of them, and median ticket rises ~60% on the roll into NPA.",
      },
      "rev-opt": {
        queries: [
          {
            sql: "SELECT quarter, entity, ROUND(closing_gnpa_cr * 10, 0) AS closing_gnpa_m FROM npa_quarterly_movement WHERE quarter LIKE 'FY25%' OR quarter = 'FY24-Q4' ORDER BY entity, quarter",
            description: "Closing gross-NPA balance by quarter and entity (crore converted to ₹M) over the last five quarters.",
            rowCount: 10,
            executionTimeMs: 421,
            columns: ["quarter", "entity", "closing_gnpa_m"],
            data: [
              { quarter: "FY24-Q4", entity: "finserve", closing_gnpa_m: 511 },
              { quarter: "FY25-Q1", entity: "finserve", closing_gnpa_m: 696 },
              { quarter: "FY25-Q2", entity: "finserve", closing_gnpa_m: 812 },
              { quarter: "FY25-Q3", entity: "finserve", closing_gnpa_m: 816 },
              { quarter: "FY25-Q4", entity: "finserve", closing_gnpa_m: 918 },
              { quarter: "FY24-Q4", entity: "hfc", closing_gnpa_m: 389 },
              { quarter: "FY25-Q1", entity: "hfc", closing_gnpa_m: 402 },
              { quarter: "FY25-Q2", entity: "hfc", closing_gnpa_m: 502 },
              { quarter: "FY25-Q3", entity: "hfc", closing_gnpa_m: 496 },
              { quarter: "FY25-Q4", entity: "hfc", closing_gnpa_m: 546 },
            ],
          },
          {
            sql: "SELECT entity, ROUND(SUM(additions_cr) * 10, 0) AS additions_m, ROUND(SUM(upgradations_cr + recoveries_cr) * 10, 0) AS cures_m, ROUND(SUM(additions_cr) / SUM(upgradations_cr + recoveries_cr), 2) AS add_to_cure FROM npa_quarterly_movement WHERE quarter LIKE 'FY25%' GROUP BY entity ORDER BY entity",
            description: "FY25 NPA additions versus cures (upgrades + recoveries) and the add-to-cure ratio by entity.",
            rowCount: 2,
            executionTimeMs: 398,
            columns: ["entity", "additions_m", "cures_m", "add_to_cure"],
            data: [
              { entity: "finserve", additions_m: 919, cures_m: 351, add_to_cure: 2.62 },
              { entity: "hfc", additions_m: 465, cures_m: 183, add_to_cure: 2.54 },
            ],
          },
          {
            sql: "WITH q AS (SELECT quarter, closing_gnpa_cr FROM npa_quarterly_movement WHERE entity = 'finserve') SELECT quarter, ROUND(closing_gnpa_cr * 10, 0) AS closing_m, ROUND(closing_gnpa_cr * 10 - LAG(closing_gnpa_cr * 10) OVER (ORDER BY quarter), 0) AS qoq_delta_m FROM q WHERE quarter LIKE 'FY25%' OR quarter = 'FY24-Q4' ORDER BY quarter",
            description: "Finserve closing GNPA with a LAG-based quarter-on-quarter change to expose acceleration.",
            rowCount: 5,
            executionTimeMs: 462,
            columns: ["quarter", "closing_m", "qoq_delta_m"],
            data: [
              { quarter: "FY24-Q4", closing_m: 511, qoq_delta_m: 80 },
              { quarter: "FY25-Q1", closing_m: 696, qoq_delta_m: 185 },
              { quarter: "FY25-Q2", closing_m: 812, qoq_delta_m: 116 },
              { quarter: "FY25-Q3", closing_m: 816, qoq_delta_m: 4 },
              { quarter: "FY25-Q4", closing_m: 918, qoq_delta_m: 101 },
            ],
          },
          {
            sql: "SELECT entity, ROUND(SUM(write_offs_cr) * 10, 0) AS writeoffs_m, ROUND(SUM(recoveries_cr) * 10, 0) AS recoveries_m, ROUND(SUM(upgradations_cr) * 10, 0) AS upgrades_m FROM npa_quarterly_movement WHERE quarter LIKE 'FY25%' GROUP BY entity ORDER BY entity",
            description: "FY25 decomposition of NPA clearing into write-offs, cash recoveries and upgrades by entity.",
            rowCount: 2,
            executionTimeMs: 376,
            columns: ["entity", "writeoffs_m", "recoveries_m", "upgrades_m"],
            data: [
              { entity: "finserve", writeoffs_m: 260, recoveries_m: 98, upgrades_m: 253 },
              { entity: "hfc", writeoffs_m: 180, recoveries_m: 56, upgrades_m: 127 },
            ],
          },
        ],
        summary:
          "Traced the quarterly NPA balance, the add-to-cure ratio, the QoQ acceleration and the cure decomposition. Finserve's closing GNPA climbed from ₹511M to ₹918M, jumped +₹185M in FY25-Q1, and is cleared mostly by write-off (₹260M) not cash recovery (₹98M).",
      },
      "daily-metrics": {
        queries: [
          {
            sql: "SELECT entity, COUNT(*) AS payments, ROUND(100.0 * COUNT(*) FILTER (WHERE bounce) / COUNT(*), 1) AS bounce_pct, ROUND(AVG(dpd_at_payment), 1) AS avg_dpd FROM collections_full WHERE due_date >= DATE '2025-01-01' GROUP BY entity ORDER BY entity",
            description: "EMI bounce rate and average DPD-at-payment by entity on recent dues, as a leading indicator of roll pressure.",
            rowCount: 2,
            executionTimeMs: 1244,
            columns: ["entity", "payments", "bounce_pct", "avg_dpd"],
            data: [
              { entity: "finserve", payments: 165179, bounce_pct: 34, avg_dpd: 9.1 },
              { entity: "hfc", payments: 225565, bounce_pct: 25.3, avg_dpd: 6.5 },
            ],
          },
        ],
        summary:
          "Read the EMI bounce rate as a leading indicator. Finserve bounces at 34.0% with 9.1 days average DPD-at-payment versus 25.3% and 6.5 days on housing, so the Finserve funnel is filling faster upstream.",
      },
      "user-segmentation": {
        queries: [
          {
            sql: "SELECT employment_type, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live, COUNT(*) FILTER (WHERE dpd_bucket = 'sma_2') AS sma2, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket = 'sma_2') / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS sma2_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY employment_type ORDER BY sma2_pct DESC",
            description: "sma_2 rate and GNPA by borrower employment type, to find which segment is rolling.",
            rowCount: 4,
            executionTimeMs: 821,
            columns: ["employment_type", "live", "sma2", "sma2_pct", "gnpa_pct"],
            data: [
              { employment_type: "salaried_informal", live: 11941, sma2: 160, sma2_pct: 1.34, gnpa_pct: 1.49 },
              { employment_type: "self_employed_informal", live: 89214, sma2: 1145, sma2_pct: 1.28, gnpa_pct: 1.43 },
              { employment_type: "self_employed_formal", live: 20549, sma2: 237, sma2_pct: 1.15, gnpa_pct: 1.32 },
              { employment_type: "salaried_formal", live: 13421, sma2: 145, sma2_pct: 1.08, gnpa_pct: 1.4 },
            ],
          },
          {
            sql: "SELECT income_category, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live, COUNT(*) FILTER (WHERE dpd_bucket = 'sma_2') AS sma2, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket = 'sma_2') / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS sma2_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full WHERE entity = 'finserve' GROUP BY income_category ORDER BY sma2_pct DESC",
            description: "Finserve sma_2 rate and GNPA by income tier, to locate the densest pipeline within the riskier book.",
            rowCount: 3,
            executionTimeMs: 597,
            columns: ["income_category", "live", "sma2", "sma2_pct", "gnpa_pct"],
            data: [
              { income_category: "ews", live: 9546, sma2: 151, sma2_pct: 1.58, gnpa_pct: 1.84 },
              { income_category: "lig", live: 37893, sma2: 590, sma2_pct: 1.56, gnpa_pct: 1.95 },
              { income_category: "mig", live: 9594, sma2: 142, sma2_pct: 1.48, gnpa_pct: 2.1 },
            ],
          },
        ],
        summary:
          "Cut the sma_2 pipeline by employment type and by Finserve income tier. Informal-income borrowers carry the highest sma_2 rate and GNPA, self-employed-informal is the densest pool (1,145 sma_2 loans), and within Finserve the LIG tier holds the most sma_2 loans (590) while MIG carries the highest GNPA (2.10%).",
      },
      geographic: {
        queries: [
          {
            sql: "SELECT state, COUNT(*) FILTER (WHERE dpd_bucket = 'sma_2') AS sma2, COUNT(*) FILTER (WHERE dpd_bucket = 'npa_90') AS npa90, ROUND(SUM(overdue_amount) FILTER (WHERE dpd_bucket IN ('sma_2','npa_90')) / 1e6, 1) AS late_overdue_m FROM loans_full WHERE entity = 'finserve' GROUP BY state ORDER BY late_overdue_m DESC LIMIT 5",
            description: "Late-stage (sma_2 + npa_90) Finserve overdue by state, to locate a geographic recovery sprint.",
            rowCount: 5,
            executionTimeMs: 743,
            columns: ["state", "sma2", "npa90", "late_overdue_m"],
            data: [
              { state: "Maharashtra", sma2: 135, npa90: 142, late_overdue_m: 10.4 },
              { state: "Tamil Nadu", sma2: 113, npa90: 113, late_overdue_m: 7.9 },
              { state: "Rajasthan", sma2: 101, npa90: 87, late_overdue_m: 6.1 },
              { state: "Gujarat", sma2: 72, npa90: 84, late_overdue_m: 5.8 },
              { state: "Andhra Pradesh", sma2: 75, npa90: 86, late_overdue_m: 5.6 },
            ],
          },
        ],
        summary:
          "Located late Finserve overdue by state. Maharashtra holds ₹10.4M, more than the next two states combined, so a state-led recovery push should open in Maharashtra and Tamil Nadu.",
      },
    },
  }),
  deepResearchThread({
    slug: "collections-effort-waste",
    title: "Where is our collections effort being wasted?",
    question:
      "Where is our collections effort being wasted? I want to know if we're chasing the wrong accounts at the wrong time.",
    report: `## Collections Effectiveness: Effort vs. Outcome

Across **18,836 collection actions**, the team is spending heavily at the wrong end of the delinquency curve [data-quality:Q1]. **37% of all effort goes to accounts already 180+ days overdue** (the hardest to cure) while the early window, where money is most recoverable, gets proportionally less [daily-metrics:Q1].

### Where the effort goes by delinquency phase

| Phase | Actions | Share of effort | Resolved |
|---|---|---|---|
| Early (<=90 DPD) | 8,336 | 44.3% | 9.8% |
| Mid (91-180 DPD) | 3,465 | 18.4% | 9.7% |
| Deep (180+ DPD) | 7,035 | **37.3%** | 10.3% |

Resolution rate is essentially flat (~10%) regardless of how late you intervene [daily-metrics:Q1], which means the late-stage, high-cost actions are not buying better outcomes, just higher cost.

### Cost-heavy actions cluster on the deepest accounts

| Action type | Actions | Avg DPD at action | Resolved | No contact |
|---|---|---|---|---|
| sarfaesi | 1,087 | **226** | 8.8% | 30.1% |
| legal_notice | 2,472 | 198 | 10.4% | 30.1% |
| demand_notice | 3,357 | 163 | 10.4% | 30.3% |
| field_visit | 3,741 | 149 | 10.2% | 29.1% |
| call | 5,422 | 125 | 9.9% | 30.6% |
| sms_reminder | 2,757 | 125 | 9.3% | 30.6% |

The two most expensive channels (**field visits and SARFAESI/legal**) are deployed on accounts averaging 149-226 DPD, and resolve at the same ~10% as a phone call placed at 125 DPD [rev-opt:Q1]. The expensive muscle is being used after the window to recover cheaply has closed.

### One in three contact attempts reaches nobody

**No-contact rate is 30.2% across the book** (5,683 of 18,836 actions) [data-quality:Q1], and it barely moves by channel: 30.6% on calls, 29.1% on field visits, 30.1% on legal [rev-opt:Q1]. That is the single biggest leak: a third of the team's actions produce no conversation at all. It does not improve when the team escalates to field visits or legal, so the contactability problem is upstream, in stale phone/address data, not in effort.

### Where the volume actually is

| Entity / product | Actions | No contact | Productive (PTP/partial/resolved) |
|---|---|---|---|
| HFC home_purchase | 4,200 | 31.8% | 49.3% |
| Finserve used_cv | 4,150 | 30.4% | 50.2% |
| Finserve msme | 2,680 | 29.9% | 48.9% |
| Finserve used_car | 2,542 | 28.3% | 50.2% |

Productive-contact rate sits near 50% wherever the volume is [user-segmentation:Q1], reinforcing that the gap is contactability and timing, not the team's ability to convert a live conversation.

### The full result mix: four in five actions do not close

No-contact is only the first leak. The complete result distribution shows how thin the hard-money tail really is [data-quality:Q2]:

| Result | Actions | Share |
|---|---|---|
| no_contact | 5,683 | 30.2% |
| promise_to_pay | 4,750 | 25.2% |
| partial_payment | 2,787 | 14.8% |
| escalated | 1,886 | 10.0% |
| resolved | 1,876 | 10.0% |
| dispute | 1,854 | 9.8% |

Only **24.8% of actions land a hard money outcome** (10.0% resolved plus 14.8% partial payment) [data-quality:Q2]. The single largest non-contact bucket is promise_to_pay at 25.2%, a soft commitment that needs a second touch to convert, and another 19.8% end in escalation or dispute. Four out of five actions do not close the account on contact, which is where the effort drain compounds.

### Effort is scaling, efficiency is not

Quarterly action volume climbed from 1,059 in Q1 2024 to a peak of 6,309 in Q1 2025, growing 40% to 88% quarter on quarter through the run [daily-metrics:Q2]:

| Quarter | Actions | No-contact % | Resolved % |
|---|---|---|---|
| 2024-Q1 | 1,059 | 30.2% | 7.8% |
| 2024-Q2 | 1,481 | 30.9% | 9.5% |
| 2024-Q3 | 2,211 | 30.1% | 9.9% |
| 2024-Q4 | 3,352 | 30.5% | 10.3% |
| 2025-Q1 | 6,309 | 29.9% | 10.2% |

The no-contact rate never moved off its band (29.9% to 30.9%) and resolution only crept from 7.8% to ~10% [daily-metrics:Q2]. The team is doing far more work each quarter with no gain in contact efficiency, the clearest sign that effort, not demand, is what is scaling.

### Persistence works, but a single-touch tail is abandoned

Cure rate rises sharply with how many times a loan is worked [cohort-retention:Q1]:

| Actions on loan | Loans | Avg actions | Loans cured |
|---|---|---|---|
| 1 | 777 | 1.0 | 9.8% |
| 2-3 | 2,033 | 2.6 | 23.1% |
| 4-6 | 1,727 | 4.5 | 37.3% |
| 7+ | 671 | 7.5 | **56.9%** |

Loans touched once cure 9.8% of the time versus 56.9% for loans touched seven-plus times [cohort-retention:Q1]. But the 777 single-touch loans are effectively abandoned at under 10% cure, while the heavily worked 7+ cohort consumes 5,058 actions. The lesson for sequencing is that one-and-done outreach almost never works, yet a meaningful tail receives exactly that.

### First contact lands too late

Using each loan's first-ever action, the median loan is already 74 to 80 days delinquent before anyone reaches out [user-segmentation:Q2]:

| Entity | Loans | Median first-touch DPD | p75 DPD | First touch after 90 DPD |
|---|---|---|---|---|
| Finserve | 2,833 | 80 | 188 | 39.3% |
| HFC | 2,375 | 74 | 153 | 39.3% |

Nearly 4 in 10 loans (39.3%) are first contacted only after crossing 90 DPD [user-segmentation:Q2], by which point cure odds have collapsed. Late first-touch is an upstream source of the wasted effort downstream: the team is starting the conversation deep in the delinquency curve.

### Branches that reach for the legal lever

A cluster of branches lean hard on legal and SARFAESI while curing very little [rev-opt:Q3]:

| Branch | Actions | Legal/SARFAESI | Legal % | Cures | Legal per cure |
|---|---|---|---|---|---|
| 112 | 66 | 14 | 21.2% | 3 | **4.7** |
| 86 | 68 | 13 | 19.1% | 3 | 4.3 |
| 261 | 147 | 34 | 23.1% | 8 | 4.3 |
| 121 | 87 | 21 | 24.1% | 5 | 4.2 |

Branch 112 issues 14 legal or SARFAESI actions and resolves only 3 loans, a ratio of 4.7 legal actions per cure at a 4.5% cure rate [rev-opt:Q3]. The top offenders all sit at 3.4 or more legal actions per cure, reaching for the costly legal lever instead of effective earlier contact.

### Agent dispersion the average hides

Across the 200 agents with at least 50 actions, the median no-contact rate is 30.4%, but the spread runs from 18.9% at the best to 44.2% at the worst, a 25-point gap [data-quality:Q3]. The 10th-to-90th percentile band alone is 23.6% to 37.1%, so the bottom decile miss contact roughly 1.6x as often as the top decile. That dispersion argues for agent-level coaching and routing, not just a uniform process fix.

### Geographic contactability

No-contact waste is geographically uneven. Delhi tops the table at 33.1%, followed by Uttar Pradesh (32.2%) and Telangana (32.1%), versus 28.6% in Chhattisgarh [geographic:Q1]. Uttar Pradesh is the clearest problem state: high no-contact (32.2%) paired with the weakest cure (8.9%) [geographic:Q1]. By city tier, the top-30 metros are slightly harder to collect in (30.9% no-contact) than beyond-30 cities (29.5%) [geographic:Q2], the denser markets where borrowers are more mobile.

## Key Findings

- **37% of effort lands on 180+ DPD accounts** that resolve no better (10.3%) than early-stage ones [daily-metrics:Q1]: late effort is not buying better cures.
- **No-contact runs at ~30% everywhere** [data-quality:Q1][rev-opt:Q1], and only 24.8% of all actions land a hard money outcome [data-quality:Q2]: the largest single source of wasted actions, and a data-quality problem, not an effort problem.
- **Effort is scaling without efficiency**: quarterly volume rose 6x while the no-contact rate held flat near 30% [daily-metrics:Q2].
- **First contact is chronically late**: 39.3% of loans are first worked only after 90 DPD [user-segmentation:Q2], and single-touch loans cure at under 10% versus 56.9% for 7+ touches [cohort-retention:Q1].
- **Expensive channels are mis-timed**: SARFAESI fires at 226 DPD avg and resolves at 8.8%, the lowest of any channel [rev-opt:Q1], and some branches issue 4-5 legal actions per cure [rev-opt:Q3].
- **Agent and geographic dispersion** are real levers: a 25-point agent no-contact spread [data-quality:Q3] and a 4.5-point state spread led by Delhi and UP [geographic:Q1].

## Recommended Actions

1. **Shift the effort curve earlier.** Move field-visit and call capacity into the sma_1/sma_2 window (31-90 DPD) where the same action has a live account to save, not a charged-off one to chase. First-touch at a median of 74-80 DPD is too late [user-segmentation:Q2].
2. **Fix contactability first.** A ~30% no-contact rate means up to 5,600 wasted touches; run a number/address refresh before the next cycle and re-attempt verified contacts, starting in Delhi and UP [geographic:Q1].
3. **Set a minimum-touch cadence.** Single-touch loans cure at under 10% [cohort-retention:Q1]; mandate at least 3 contacts per delinquent loan before it is parked, so the abandoned tail gets worked.
4. **Gate SARFAESI and legal on evidence, not age.** At 8.8% resolution and 226 DPD SARFAESI is a cost center [rev-opt:Q1]; flag branches running 4+ legal actions per cure for review [rev-opt:Q3].
5. **Coach the bottom-decile agents.** The 25-point no-contact spread [data-quality:Q3] means agent-level routing and training can close more gap than any process change.
6. **Set a contact-rate KPI** per agent alongside resolution, so the team is measured on conversations made, not just actions logged.

\`\`\`sql
-- Effort vs outcome by delinquency phase, with channel timing
WITH phased AS (
  SELECT
    action_type,
    CASE
      WHEN dpd_at_action <= 90  THEN '1_early'
      WHEN dpd_at_action <= 180 THEN '2_mid'
      ELSE '3_deep'
    END AS phase,
    result
  FROM collections_actions_full
)
SELECT
  phase,
  COUNT(*)                                                          AS actions,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)               AS pct_of_effort,
  ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'resolved')
        / COUNT(*), 1)                                             AS resolved_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'no_contact')
        / COUNT(*), 1)                                             AS no_contact_pct
FROM phased
GROUP BY phase
ORDER BY phase;
\`\`\``,
    followUps: [
      "Which agents have the worst no-contact rate?",
      "What's the recovered amount per action by channel?",
      "Which branches over-use SARFAESI relative to cures?",
      "Build a segment of sma_2 accounts to call first.",
    ],
    work: {
      "data-quality": {
        queries: [
          {
            sql: "SELECT COUNT(*) AS total_actions, COUNT(*) FILTER (WHERE result = 'no_contact') AS no_contact, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'no_contact') / COUNT(*), 1) AS no_contact_pct FROM collections_actions_full",
            description: "Total collection actions logged and the share that reached no one.",
            rowCount: 1,
            executionTimeMs: 356,
            columns: ["total_actions", "no_contact", "no_contact_pct"],
            data: [{ total_actions: 18836, no_contact: 5683, no_contact_pct: 30.2 }],
          },
          {
            sql: "SELECT result, COUNT(*) AS actions, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct FROM collections_actions_full GROUP BY result ORDER BY actions DESC",
            description: "Full result-mix breakdown across all collection actions with each result's window share.",
            rowCount: 6,
            executionTimeMs: 421,
            columns: ["result", "actions", "pct"],
            data: [
              { result: "no_contact", actions: 5683, pct: 30.2 },
              { result: "promise_to_pay", actions: 4750, pct: 25.2 },
              { result: "partial_payment", actions: 2787, pct: 14.8 },
              { result: "escalated", actions: 1886, pct: 10 },
              { result: "resolved", actions: 1876, pct: 10 },
              { result: "dispute", actions: 1854, pct: 9.8 },
            ],
          },
          {
            sql: "WITH agg AS (SELECT agent_id, COUNT(*) actions, 100.0 * COUNT(*) FILTER (WHERE result = 'no_contact') / COUNT(*) nc, 100.0 * COUNT(*) FILTER (WHERE result = 'resolved') / COUNT(*) res FROM collections_actions_full GROUP BY agent_id HAVING COUNT(*) >= 50) SELECT COUNT(*) agents, ROUND(quantile_cont(nc, 0.10), 1) p10_nc, ROUND(quantile_cont(nc, 0.50), 1) median_nc, ROUND(quantile_cont(nc, 0.90), 1) p90_nc, ROUND(MIN(nc), 1) min_nc, ROUND(MAX(nc), 1) max_nc, ROUND(quantile_cont(res, 0.50), 1) median_res FROM agg",
            description: "Agent-level no-contact rate dispersion via quantile_cont across agents with 50+ actions.",
            rowCount: 1,
            executionTimeMs: 904,
            columns: ["agents", "p10_nc", "median_nc", "p90_nc", "min_nc", "max_nc", "median_res"],
            data: [{ agents: 200, p10_nc: 23.6, median_nc: 30.4, p90_nc: 37.1, min_nc: 18.9, max_nc: 44.2, median_res: 9.7 }],
          },
        ],
        summary:
          "Sized the action base, the full result mix and the agent-level dispersion. Of 18,836 actions only 24.8% land a hard money outcome (resolved + partial), and agent no-contact ranges from 18.9% to 44.2% around a 30.4% median.",
      },
      "daily-metrics": {
        queries: [
          {
            sql: "WITH phased AS (SELECT CASE WHEN dpd_at_action <= 90 THEN '1_early' WHEN dpd_at_action <= 180 THEN '2_mid' ELSE '3_deep' END AS phase, result FROM collections_actions_full) SELECT phase, COUNT(*) AS actions, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_effort, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'resolved') / COUNT(*), 1) AS resolved_pct FROM phased GROUP BY phase ORDER BY phase",
            description: "Effort and resolution rate by delinquency phase (early <=90, mid 91-180, deep 180+ DPD).",
            rowCount: 3,
            executionTimeMs: 612,
            columns: ["phase", "actions", "pct_of_effort", "resolved_pct"],
            data: [
              { phase: "1_early", actions: 8336, pct_of_effort: 44.3, resolved_pct: 9.8 },
              { phase: "2_mid", actions: 3465, pct_of_effort: 18.4, resolved_pct: 9.7 },
              { phase: "3_deep", actions: 7035, pct_of_effort: 37.3, resolved_pct: 10.3 },
            ],
          },
          {
            sql: "WITH q AS (SELECT date_trunc('quarter', action_date) qd, COUNT(*) actions, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'no_contact') / COUNT(*), 1) nc_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'resolved') / COUNT(*), 1) res_pct FROM collections_actions_full WHERE action_date >= '2024-01-01' AND action_date < '2025-04-01' GROUP BY 1) SELECT strftime(qd, '%Y') || '-Q' || CAST(quarter(qd) AS VARCHAR) qtr, actions, nc_pct, res_pct, ROUND(100.0 * (actions - LAG(actions) OVER (ORDER BY qd)) / LAG(actions) OVER (ORDER BY qd), 1) qoq_pct FROM q ORDER BY qd",
            description: "Quarterly action volume with no-contact and resolution rate and a LAG-based QoQ growth.",
            rowCount: 5,
            executionTimeMs: 688,
            columns: ["qtr", "actions", "nc_pct", "res_pct", "qoq_pct"],
            data: [
              { qtr: "2024-Q1", actions: 1059, nc_pct: 30.2, res_pct: 7.8, qoq_pct: null },
              { qtr: "2024-Q2", actions: 1481, nc_pct: 30.9, res_pct: 9.5, qoq_pct: 39.8 },
              { qtr: "2024-Q3", actions: 2211, nc_pct: 30.1, res_pct: 9.9, qoq_pct: 49.3 },
              { qtr: "2024-Q4", actions: 3352, nc_pct: 30.5, res_pct: 10.3, qoq_pct: 51.6 },
              { qtr: "2025-Q1", actions: 6309, nc_pct: 29.9, res_pct: 10.2, qoq_pct: 88.2 },
            ],
          },
        ],
        summary:
          "Split effort and outcome by delinquency phase and tracked the quarterly volume trend. 37.3% of actions land on 180+ DPD accounts at flat ~10% resolution, and action volume rose 6x from Q1 2024 to Q1 2025 with the no-contact rate stuck near 30% throughout.",
      },
      "rev-opt": {
        queries: [
          {
            sql: "SELECT action_type, COUNT(*) AS actions, ROUND(AVG(dpd_at_action)) AS avg_dpd, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'resolved') / COUNT(*), 1) AS resolved_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'no_contact') / COUNT(*), 1) AS no_contact_pct FROM collections_actions_full GROUP BY action_type ORDER BY avg_dpd DESC",
            description: "Per-channel volume, average DPD at action, resolution and no-contact rate.",
            rowCount: 6,
            executionTimeMs: 547,
            columns: ["action_type", "actions", "avg_dpd", "resolved_pct", "no_contact_pct"],
            data: [
              { action_type: "sarfaesi", actions: 1087, avg_dpd: 226, resolved_pct: 8.8, no_contact_pct: 30.1 },
              { action_type: "legal_notice", actions: 2472, avg_dpd: 198, resolved_pct: 10.4, no_contact_pct: 30.1 },
              { action_type: "demand_notice", actions: 3357, avg_dpd: 163, resolved_pct: 10.4, no_contact_pct: 30.3 },
              { action_type: "field_visit", actions: 3741, avg_dpd: 149, resolved_pct: 10.2, no_contact_pct: 29.1 },
              { action_type: "sms_reminder", actions: 2757, avg_dpd: 125, resolved_pct: 9.3, no_contact_pct: 30.6 },
              { action_type: "call", actions: 5422, avg_dpd: 125, resolved_pct: 9.9, no_contact_pct: 30.6 },
            ],
          },
          {
            sql: "SELECT action_type, entity, COUNT(*) actions, ROUND(AVG(dpd_at_action), 0) avg_dpd, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'resolved') / COUNT(*), 1) res_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'no_contact') / COUNT(*), 1) nc_pct FROM collections_actions_full GROUP BY action_type, entity HAVING COUNT(*) >= 200 ORDER BY action_type, entity",
            description: "Channel timing and outcome split by entity (channels with 200+ actions per entity).",
            rowCount: 12,
            executionTimeMs: 631,
            columns: ["action_type", "entity", "actions", "avg_dpd", "res_pct", "nc_pct"],
            data: [
              { action_type: "call", entity: "finserve", actions: 2908, avg_dpd: 128, res_pct: 10.9, nc_pct: 30.1 },
              { action_type: "call", entity: "hfc", actions: 2514, avg_dpd: 121, res_pct: 8.7, nc_pct: 31.2 },
              { action_type: "demand_notice", entity: "finserve", actions: 1854, avg_dpd: 167, res_pct: 10.5, nc_pct: 30.3 },
              { action_type: "demand_notice", entity: "hfc", actions: 1503, avg_dpd: 159, res_pct: 10.3, nc_pct: 30.3 },
              { action_type: "field_visit", entity: "finserve", actions: 2122, avg_dpd: 153, res_pct: 10.3, nc_pct: 28.4 },
              { action_type: "field_visit", entity: "hfc", actions: 1619, avg_dpd: 144, res_pct: 10.1, nc_pct: 30 },
              { action_type: "legal_notice", entity: "finserve", actions: 1383, avg_dpd: 202, res_pct: 9.5, nc_pct: 30.2 },
              { action_type: "legal_notice", entity: "hfc", actions: 1089, avg_dpd: 193, res_pct: 11.5, nc_pct: 30.1 },
              { action_type: "sarfaesi", entity: "finserve", actions: 618, avg_dpd: 229, res_pct: 8.3, nc_pct: 29.4 },
              { action_type: "sarfaesi", entity: "hfc", actions: 469, avg_dpd: 222, res_pct: 9.6, nc_pct: 30.9 },
              { action_type: "sms_reminder", entity: "finserve", actions: 1506, avg_dpd: 132, res_pct: 9.1, nc_pct: 31.1 },
              { action_type: "sms_reminder", entity: "hfc", actions: 1251, avg_dpd: 116, res_pct: 9.5, nc_pct: 30.1 },
            ],
          },
          {
            sql: "WITH b AS (SELECT branch_id, COUNT(*) actions, COUNT(*) FILTER (WHERE action_type IN ('sarfaesi','legal_notice')) legal_actions, COUNT(*) FILTER (WHERE result = 'resolved') cures FROM collections_actions_full GROUP BY branch_id HAVING COUNT(*) >= 60) SELECT branch_id, actions, legal_actions, ROUND(100.0 * legal_actions / actions, 1) legal_pct, cures, ROUND(100.0 * cures / actions, 1) cure_pct, ROUND(legal_actions * 1.0 / NULLIF(cures, 0), 1) legal_per_cure FROM b ORDER BY legal_per_cure DESC LIMIT 4",
            description: "Branches over-issuing legal/SARFAESI relative to cures, ranked by legal actions per cure.",
            rowCount: 4,
            executionTimeMs: 558,
            columns: ["branch_id", "actions", "legal_actions", "legal_pct", "cures", "cure_pct", "legal_per_cure"],
            data: [
              { branch_id: 112, actions: 66, legal_actions: 14, legal_pct: 21.2, cures: 3, cure_pct: 4.5, legal_per_cure: 4.7 },
              { branch_id: 86, actions: 68, legal_actions: 13, legal_pct: 19.1, cures: 3, cure_pct: 4.4, legal_per_cure: 4.3 },
              { branch_id: 261, actions: 147, legal_actions: 34, legal_pct: 23.1, cures: 8, cure_pct: 5.4, legal_per_cure: 4.3 },
              { branch_id: 121, actions: 87, legal_actions: 21, legal_pct: 24.1, cures: 5, cure_pct: 5.7, legal_per_cure: 4.2 },
            ],
          },
        ],
        summary:
          "Compared channels by timing and outcome, split by entity, and flagged branches over-using legal escalation. Expensive channels (SARFAESI at 226 DPD) resolve no better than a call at 125 DPD, and a cluster of branches issue 4+ legal actions per cure.",
      },
      "user-segmentation": {
        queries: [
          {
            sql: "SELECT entity, product_type, COUNT(*) AS actions, ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'no_contact') / COUNT(*), 1) AS no_contact_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE result IN ('promise_to_pay','partial_payment','resolved')) / COUNT(*), 1) AS productive_pct FROM collections_actions_full GROUP BY entity, product_type ORDER BY actions DESC LIMIT 4",
            description: "Highest-volume entity/product pools with their no-contact and productive-contact rates.",
            rowCount: 4,
            executionTimeMs: 498,
            columns: ["entity", "product_type", "actions", "no_contact_pct", "productive_pct"],
            data: [
              { entity: "hfc", product_type: "home_purchase", actions: 4200, no_contact_pct: 31.8, productive_pct: 49.3 },
              { entity: "finserve", product_type: "used_cv", actions: 4150, no_contact_pct: 30.4, productive_pct: 50.2 },
              { entity: "finserve", product_type: "msme", actions: 2680, no_contact_pct: 29.9, productive_pct: 48.9 },
              { entity: "finserve", product_type: "used_car", actions: 2542, no_contact_pct: 28.3, productive_pct: 50.2 },
            ],
          },
          {
            sql: "WITH firsts AS (SELECT loan_id, entity, dpd_at_action, ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY action_date, action_id) rn FROM collections_actions_full) SELECT entity, COUNT(*) loans, ROUND(quantile_cont(dpd_at_action, 0.25), 0) p25_dpd, ROUND(quantile_cont(dpd_at_action, 0.50), 0) median_dpd, ROUND(quantile_cont(dpd_at_action, 0.75), 0) p75_dpd, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_at_action > 90) / COUNT(*), 1) pct_first_after_90 FROM firsts WHERE rn = 1 GROUP BY entity ORDER BY median_dpd DESC",
            description: "First-action DPD distribution by entity via ROW_NUMBER and quantile_cont, to see when the first touch lands.",
            rowCount: 2,
            executionTimeMs: 812,
            columns: ["entity", "loans", "p25_dpd", "median_dpd", "p75_dpd", "pct_first_after_90"],
            data: [
              { entity: "finserve", loans: 2833, p25_dpd: 54, median_dpd: 80, p75_dpd: 188, pct_first_after_90: 39.3 },
              { entity: "hfc", loans: 2375, p25_dpd: 52, median_dpd: 74, p75_dpd: 153, pct_first_after_90: 39.3 },
            ],
          },
        ],
        summary:
          "Located where the action volume concentrates and when first contact lands. The four largest pools all run ~30% no-contact and ~50% productive, and the median loan is already 74-80 DPD before its first touch, with 39.3% first worked only after 90 DPD.",
      },
      "cohort-retention": {
        queries: [
          {
            sql: "WITH per_loan AS (SELECT loan_id, COUNT(*) n_actions, MAX(CASE WHEN result = 'resolved' THEN 1 ELSE 0 END) cured FROM collections_actions_full GROUP BY loan_id), bucketed AS (SELECT CASE WHEN n_actions = 1 THEN '1' WHEN n_actions <= 3 THEN '2-3' WHEN n_actions <= 6 THEN '4-6' ELSE '7+' END bucket, n_actions, cured FROM per_loan) SELECT bucket, COUNT(*) loans, SUM(n_actions) total_actions, ROUND(AVG(n_actions), 1) avg_actions, ROUND(100.0 * SUM(cured) / COUNT(*), 1) pct_loans_cured FROM bucketed GROUP BY bucket ORDER BY MIN(n_actions)",
            description: "Cure rate by per-loan action-count bucket, to measure the payoff of persistence.",
            rowCount: 4,
            executionTimeMs: 744,
            columns: ["bucket", "loans", "total_actions", "avg_actions", "pct_loans_cured"],
            data: [
              { bucket: "1", loans: 777, total_actions: 777, avg_actions: 1, pct_loans_cured: 9.8 },
              { bucket: "2-3", loans: 2033, total_actions: 5239, avg_actions: 2.6, pct_loans_cured: 23.1 },
              { bucket: "4-6", loans: 1727, total_actions: 7762, avg_actions: 4.5, pct_loans_cured: 37.3 },
              { bucket: "7+", loans: 671, total_actions: 5058, avg_actions: 7.5, pct_loans_cured: 56.9 },
            ],
          },
        ],
        summary:
          "Treated each loan as a cohort and measured cure rate by touch count. Cure climbs from 9.8% at one action to 56.9% at seven-plus, yet 777 single-touch loans are effectively abandoned, so the sequencing lesson is that one-and-done outreach fails.",
      },
      geographic: {
        queries: [
          {
            sql: "SELECT l.state, COUNT(*) actions, ROUND(100.0 * COUNT(*) FILTER (WHERE a.result = 'no_contact') / COUNT(*), 1) nc_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE a.result = 'resolved') / COUNT(*), 1) res_pct, RANK() OVER (ORDER BY 100.0 * COUNT(*) FILTER (WHERE a.result = 'no_contact') / COUNT(*) DESC) nc_rank FROM collections_actions_full a JOIN loans_full l ON a.loan_id = l.loan_id GROUP BY l.state HAVING COUNT(*) >= 300 ORDER BY nc_pct DESC LIMIT 6",
            description: "No-contact and resolution rate by state via a JOIN to loans_full, ranked with a window RANK.",
            rowCount: 6,
            executionTimeMs: 1187,
            columns: ["state", "actions", "nc_pct", "res_pct", "nc_rank"],
            data: [
              { state: "Delhi", actions: 481, nc_pct: 33.1, res_pct: 10.2, nc_rank: 1 },
              { state: "Uttar Pradesh", actions: 1569, nc_pct: 32.2, res_pct: 8.9, nc_rank: 2 },
              { state: "Telangana", actions: 1178, nc_pct: 32.1, res_pct: 11.6, nc_rank: 3 },
              { state: "Gujarat", actions: 1787, nc_pct: 31.4, res_pct: 9.3, nc_rank: 4 },
              { state: "Andhra Pradesh", actions: 1425, nc_pct: 30.8, res_pct: 9.9, nc_rank: 5 },
              { state: "Maharashtra", actions: 2623, nc_pct: 30.5, res_pct: 9.7, nc_rank: 6 },
            ],
          },
          {
            sql: "SELECT l.city_tier, COUNT(*) actions, ROUND(100.0 * COUNT(*) FILTER (WHERE a.result = 'no_contact') / COUNT(*), 1) nc_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE a.result = 'resolved') / COUNT(*), 1) res_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE a.result IN ('promise_to_pay','partial_payment','resolved')) / COUNT(*), 1) productive_pct FROM collections_actions_full a JOIN loans_full l ON a.loan_id = l.loan_id GROUP BY l.city_tier ORDER BY nc_pct DESC",
            description: "Collection outcomes by city tier (T30 metros vs B30 cities) via a multi-table JOIN.",
            rowCount: 2,
            executionTimeMs: 1102,
            columns: ["city_tier", "actions", "nc_pct", "res_pct", "productive_pct"],
            data: [
              { city_tier: "t30", actions: 8437, nc_pct: 30.9, res_pct: 9.9, productive_pct: 49.7 },
              { city_tier: "b30", actions: 10399, nc_pct: 29.5, res_pct: 10, productive_pct: 50.2 },
            ],
          },
        ],
        summary:
          "Cut contactability by geography. No-contact runs highest in Delhi (33.1%) and UP (32.2%, weakest cure at 8.9%), and the top-30 metros are slightly harder to reach (30.9%) than beyond-30 cities (29.5%).",
      },
    },
  }),
  deepResearchThread({
    slug: "home-loan-book-health",
    title: "How healthy is the home-loan book?",
    question:
      "How healthy is the home-loan (HFC) book really: mix, asset quality, yield, and provisioning?",
    report: `## Home-Loan Book Health Check

### Executive summary

The HFC (housing) book is the **stable, low-risk core**: **₹85.14B AUM across 78,092 active loans at 1.02% GNPA** [rev-opt:Q1][data-quality:Q1], roughly half the delinquency of the Finserve book (1.96%) [data-quality:Q1]. The two largest products, home_purchase and home_construction, are 65% of the housing book by count.

What makes the book unusually safe is not one strong product but a uniformly conservative underwriting box: every loan sits below 65% LTV, asset quality is flat across LTV, CIBIL and ticket-size bands, new-to-credit borrowers perform almost identically to credit-tested ones, and geography is well-diversified with no single state above 14% of AUM. The only soft spots (home_improvement, the smaller-city b30 segment, Rajasthan) are contained and immaterial. This report works through mix, asset quality across multiple risk cuts, provisioning, the disbursement trend, the borrower profile and the geographic spread.

### Methodology and data note

Product-level AUM, yield and GNPA are read from the precomputed \`product_performance\` table (GNPA there is Stage-3 over the active-loan base). The borrower-level cuts (LTV, CIBIL, ticket size, employment, income, geography) are computed directly from \`loans_full\` filtered to \`entity = 'hfc'\`; on that base the Stage-3 rate runs a touch lower (~0.7% to 0.85%) than the active-base GNPA of 1.02% because \`loans_full\` includes all loan statuses, so the two should not be compared one-to-one. LTV is stored as a 0 to 1 fraction. New-to-credit borrowers carry a placeholder bureau score, so CIBIL bands exclude them where noted. Provisioning is from \`ecl_provisions\` (crore at 10x to ₹M). All figures validated against the dataset's DuckDB.

### Product mix and asset quality (HFC)

| Product | Active loans | AUM | Avg yield | GNPA |
|---|---|---|---|---|
| home_purchase | 38,750 | ₹52.16B | 14.17% | 1.00% |
| home_construction | 11,876 | ₹13.07B | 14.66% | 0.99% |
| lap_residential | 11,653 | ₹9.38B | 17.17% | 0.99% |
| home_improvement | 9,415 | ₹5.67B | 15.17% | **1.23%** |
| lap_commercial | 3,970 | ₹4.01B | 18.41% | 0.86% |
| micro_housing | 2,428 | ₹0.85B | 17.92% | 1.11% |

home_purchase alone is **₹52.16B (61% of housing AUM)** at a clean 1.00% GNPA and 14.17% yield [rev-opt:Q1]. The slightly weaker spots are home_improvement (1.23%) and micro_housing (1.11%), both small books [rev-opt:Q1].

### Asset quality holds across vintages

Unlike Finserve, the housing book shows **no vintage deterioration**: every cohort sits near 1% GNPA [cohort-retention:Q1]:

| Disbursement year | HFC GNPA | Early DPD (sma_1+sma_2) |
|---|---|---|
| 2022 | 1.01% | 2.15% |
| 2023 | 1.04% | 2.02% |
| 2024 | 1.04% | 2.03% |
| 2025 | 0.94% | 1.83% |

This is the signature of a well-underwritten secured book: delinquency does not climb as cohorts season, and the early-DPD pipeline actually thins on the newest vintage (1.83%) [cohort-retention:Q1].

### Provisioning is conservative

ECL coverage on the housing book (Mar 2025): **Stage-3 exposure ₹802M, provision ₹321M, 40% PCR on Stage-3**, with total ECL of ₹711M [rev-opt:Q2]. The 40% coverage on the worst bucket gives comfortable headroom against the 1.02% GNPA.

### The yield trade-off

Home loans yield 14-15% (the lowest in the group) but that is the point: they buy asset quality [rev-opt:Q1]. The higher-yield housing products (LAP commercial 18.41%, micro_housing 17.92%) carry only marginally different GNPA, so the book is being paid fairly for the small extra risk. Ranking products by AUM share confirms the concentration is benign: home_purchase is 61.3% of AUM and the top three products cover 87.6% cumulatively, all at GNPA under 1.25% [rev-opt:Q3].

### Quality is flat across every risk cut

The clearest evidence of a conservative box is that delinquency barely moves no matter how you slice the book. By LTV, every loan sits below 65% (73% are under 50% LTV at an average of 41.5%), and GNPA holds in a 0.71% to 0.82% band across LTV bands [data-quality:Q2]:

| LTV band | Loans | AUM | Avg LTV | Stage-3 % |
|---|---|---|---|---|
| Under 50% | 76,758 | ₹84.04B | 41.5% | 0.78% |
| 50-60% | 24,931 | ₹27.20B | 53.7% | 0.71% |
| 60-70% | 3,176 | ₹3.46B | 62.6% | 0.82% |

By bureau score the same flatness holds (0.72% to 0.80% across prime bands), so CIBIL is a weak default discriminator here [data-quality:Q3]. By ticket size the book is firmly small-ticket affordable housing: no loan exceeds ~₹22L, and the largest band (₹10-20L, average ₹13.8L) carries ₹78.11B at the lowest GNPA of 0.70% [rev-opt:Q4].

### The new-to-credit book performs

New-to-credit (NTC) borrowers are 30% of the housing book (₹34.52B AUM) yet perform almost identically to credit-tested borrowers: 0.80% Stage-3 versus 0.75%, and 1.53% versus 1.49% on the early-DPD pipeline [cohort-retention:Q2]. That is a strong validation of the lender's surrogate underwriting (income, LTV, property) and of its affordable-housing NTC strategy.

### Borrower-segment lens

By employment, formal self-employed borrowers are the cleanest cohort at 0.58% Stage-3, while salaried-informal is the weakest at 0.85%; the core self-employed-informal pool (₹75.86B AUM) sits at 0.79% [user-segmentation:Q1]. By income tier the risk gradient is shallow and intuitive: EWS at 0.80% steps down to MIG at 0.73%, a 7-basis-point spread, with the LIG tier (₹76.28B, two-thirds of the book) at 0.76% [user-segmentation:Q2]. The lender is pricing the lower-income tiers effectively rather than carrying outsized risk there.

### Disbursement is growing without loosening

The housing book grew disbursements ~41% over the year, from ₹3.21B in Apr 2024 to a record ₹4.54B in Mar 2025, while pricing and risk appetite stayed disciplined: weighted yield held in a 14.78% to 14.91% band and LTV near 45% throughout [daily-metrics:Q1]. Growth came in step-ups (notably +13.4% in Oct 2024 and +9.4% in Jan 2025) rather than any loosening of terms. Book-wide collection efficiency runs a healthy 94% to 96% and average DPD-at-payment more than halved over the year, from 15.4 days to 6.8 [daily-metrics:Q2].

### Geographic spread

AUM is well-diversified: the largest state (Rajasthan) is only 13.7% of the housing book and the top four states together are ~50%, so there is no single-state concentration risk [geographic:Q1]:

| State | Loans | AUM | AUM share | Stage-3 % |
|---|---|---|---|---|
| Rajasthan | 14,272 | ₹15.71B | 13.7% | **0.95%** |
| Maharashtra | 13,860 | ₹15.17B | 13.2% | 0.76% |
| Gujarat | 12,621 | ₹13.80B | 12.0% | 0.69% |
| Madhya Pradesh | 12,121 | ₹13.29B | 11.6% | 0.69% |

Rajasthan is the one watch-item: the biggest book yet the weakest quality at 0.95%, well above peers at 0.69% [geographic:Q1]. By city tier the book splits almost evenly between metros (t30, 49.6%) and smaller cities (b30, 50.4%) at identical ₹10.9L tickets, with b30 running a modest 8-basis-point higher GNPA (0.80% vs 0.72%) [geographic:Q2], the mark of a genuine beyond-30-cities affordable-housing footprint.

### Provisioning is conservative (detail)

ECL coverage on the housing book (Mar 2025): **Stage-3 exposure ₹802M, provision ₹321M, 40% PCR on Stage-3**, with total ECL of ₹711M [rev-opt:Q2]. The 40% coverage on the worst bucket gives comfortable headroom against the 1.02% GNPA.

## Key Findings

- **HFC is the ballast**: ₹85.14B AUM at 1.02% GNPA, half the Finserve rate, with home_purchase (₹52.16B, 61.3% of AUM) the clean anchor at 1.00% [rev-opt:Q1][rev-opt:Q3][data-quality:Q1].
- **Quality is flat across every risk cut**: GNPA holds near 0.7% to 0.8% across LTV [data-quality:Q2], CIBIL [data-quality:Q3] and ticket-size bands [rev-opt:Q4], the signature of a conservative underwriting box (every loan under 65% LTV).
- **No vintage rot**: every cohort 2022-2025 sits at 0.94%-1.04% GNPA [cohort-retention:Q1], and NTC borrowers (30% of the book) perform on par with credit-tested ones [cohort-retention:Q2].
- **Provisioning is conservative** at 40% PCR on Stage-3 (₹321M against ₹802M exposure) [rev-opt:Q2], and disbursement is growing ~41% without loosening pricing or LTV [daily-metrics:Q1].
- The only soft spots (home_improvement at 1.23%, Rajasthan at 0.95%, the b30 segment at 0.80%) are contained and not material to overall quality [rev-opt:Q1][geographic:Q1][geographic:Q2].

## Recommended Actions

1. **Lean into home_purchase growth**: it is the largest, cleanest, most scalable pool (61.3% of AUM at 1.00% GNPA) and the disbursement mix is already tilting toward it [rev-opt:Q3].
2. **Watch home_improvement and Rajasthan**: at 1.23% and 0.95% respectively they are the housing outliers [rev-opt:Q1][geographic:Q1]; review recent Rajasthan vintages before scaling further there.
3. **Hold provisioning discipline**: 40% Stage-3 PCR is healthy [rev-opt:Q2]; resist pressure to release coverage while Finserve NPAs are still climbing.
4. **Keep funding the NTC affordable-housing engine**: NTC borrowers perform on par with credit-tested ones [cohort-retention:Q2], so the surrogate-underwriting model can scale safely into the b30 footprint.
5. **Use the housing book's stability** as funding-cost leverage with lenders and co-lending partners: a 1% GNPA secured book with sub-50% LTV is a strong negotiating asset.

\`\`\`sql
-- Housing book quality by product, joined to current asset-quality flags
SELECT
  pp.product_type,
  pp.active_loans,
  ROUND(pp.aum / 1e9, 2)        AS aum_b,
  ROUND(pp.avg_yield, 2)        AS avg_yield,
  ROUND(pp.gnpa_pct, 2)         AS gnpa_pct
FROM product_performance pp
WHERE pp.entity = 'hfc'
ORDER BY aum_b DESC;
\`\`\``,
    followUps: [
      "How does HFC GNPA compare to Finserve product-by-product?",
      "Is home_improvement deteriorating in recent vintages?",
      "What's our provision coverage trend over the year?",
      "Which housing branches have the cleanest books?",
    ],
    work: {
      "data-quality": {
        queries: [
          {
            sql: "SELECT entity, ROUND(SUM(aum) / 1e9, 2) AS aum_b, SUM(active_loans) AS active_loans, ROUND(100.0 * SUM(stage_3_count) / SUM(active_loans), 2) AS gnpa_pct FROM product_performance GROUP BY entity ORDER BY entity",
            description: "AUM, active loans and GNPA by entity, to frame the housing book against Finserve.",
            rowCount: 2,
            executionTimeMs: 372,
            columns: ["entity", "aum_b", "active_loans", "gnpa_pct"],
            data: [
              { entity: "finserve", aum_b: 26.06, active_loans: 57033, gnpa_pct: 1.96 },
              { entity: "hfc", aum_b: 85.14, active_loans: 78092, gnpa_pct: 1.02 },
            ],
          },
          {
            sql: "WITH b AS (SELECT CASE WHEN ltv_ratio < 0.5 THEN '1_<50' WHEN ltv_ratio < 0.6 THEN '2_50-60' WHEN ltv_ratio < 0.7 THEN '3_60-70' WHEN ltv_ratio < 0.8 THEN '4_70-80' ELSE '5_80+' END AS ltv_band, ltv_ratio, disbursed_amount, stage FROM loans_full WHERE entity = 'hfc') SELECT ltv_band, COUNT(*) AS loans, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(100.0 * AVG(ltv_ratio), 1) AS avg_ltv_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct FROM b GROUP BY ltv_band ORDER BY ltv_band",
            description: "Housing-book Stage-3 rate by LTV band (LTV stored as a 0 to 1 fraction).",
            rowCount: 3,
            executionTimeMs: 624,
            columns: ["ltv_band", "loans", "aum_b", "avg_ltv_pct", "gnpa_pct"],
            data: [
              { ltv_band: "1_<50", loans: 76758, aum_b: 84.04, avg_ltv_pct: 41.5, gnpa_pct: 0.78 },
              { ltv_band: "2_50-60", loans: 24931, aum_b: 27.2, avg_ltv_pct: 53.7, gnpa_pct: 0.71 },
              { ltv_band: "3_60-70", loans: 3176, aum_b: 3.46, avg_ltv_pct: 62.6, gnpa_pct: 0.82 },
            ],
          },
          {
            sql: "WITH b AS (SELECT CASE WHEN bureau_score < 650 THEN '1_<650' WHEN bureau_score < 700 THEN '2_650-700' WHEN bureau_score < 750 THEN '3_700-750' WHEN bureau_score < 800 THEN '4_750-800' ELSE '5_800+' END AS cibil_band, bureau_score, disbursed_amount, stage FROM loans_full WHERE entity = 'hfc' AND bureau_score IS NOT NULL) SELECT cibil_band, COUNT(*) AS loans, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(AVG(bureau_score), 0) AS avg_cibil, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct FROM b GROUP BY cibil_band ORDER BY cibil_band",
            description: "Housing-book Stage-3 rate by bureau-score band (the <650 band pools NTC placeholder scores).",
            rowCount: 5,
            executionTimeMs: 671,
            columns: ["cibil_band", "loans", "aum_b", "avg_cibil", "gnpa_pct"],
            data: [
              { cibil_band: "1_<650", loans: 36074, aum_b: 39.46, avg_cibil: 78, gnpa_pct: 0.78 },
              { cibil_band: "2_650-700", loans: 12999, aum_b: 14.31, avg_cibil: 678, gnpa_pct: 0.72 },
              { cibil_band: "3_700-750", loans: 22787, aum_b: 24.87, avg_cibil: 725, gnpa_pct: 0.8 },
              { cibil_band: "4_750-800", loans: 20763, aum_b: 22.7, avg_cibil: 773, gnpa_pct: 0.73 },
              { cibil_band: "5_800+", loans: 12242, aum_b: 13.37, avg_cibil: 827, gnpa_pct: 0.73 },
            ],
          },
        ],
        summary:
          "Framed the housing book against Finserve and tested asset quality by LTV and CIBIL band. HFC is ₹85.14B AUM at 1.02% GNPA (half of Finserve), every loan sits below 65% LTV, and Stage-3 holds a flat 0.7% to 0.8% across both LTV and bureau-score bands.",
      },
      "rev-opt": {
        queries: [
          {
            sql: "SELECT product_type, active_loans, ROUND(aum / 1e9, 2) AS aum_b, ROUND(avg_yield, 2) AS avg_yield, ROUND(gnpa_pct, 2) AS gnpa_pct FROM product_performance WHERE entity = 'hfc' ORDER BY aum_b DESC",
            description: "Housing-book product mix: active loans, AUM, yield and GNPA per product.",
            rowCount: 6,
            executionTimeMs: 418,
            columns: ["product_type", "active_loans", "aum_b", "avg_yield", "gnpa_pct"],
            data: [
              { product_type: "home_purchase", active_loans: 38750, aum_b: 52.16, avg_yield: 14.17, gnpa_pct: 1.0 },
              { product_type: "home_construction", active_loans: 11876, aum_b: 13.07, avg_yield: 14.66, gnpa_pct: 0.99 },
              { product_type: "lap_residential", active_loans: 11653, aum_b: 9.38, avg_yield: 17.17, gnpa_pct: 0.99 },
              { product_type: "home_improvement", active_loans: 9415, aum_b: 5.67, avg_yield: 15.17, gnpa_pct: 1.23 },
              { product_type: "lap_commercial", active_loans: 3970, aum_b: 4.01, avg_yield: 18.41, gnpa_pct: 0.86 },
              { product_type: "micro_housing", active_loans: 2428, aum_b: 0.85, avg_yield: 17.92, gnpa_pct: 1.11 },
            ],
          },
          {
            sql: "SELECT strftime(month, '%Y-%m') AS month, ROUND(stage_3_exposure_cr * 10, 0) AS stage_3_exposure_m, ROUND(stage_3_provision_cr * 10, 0) AS stage_3_provision_m, pcr_stage_3, ROUND(total_ecl_cr * 10, 0) AS total_ecl_m FROM ecl_provisions WHERE entity = 'hfc' ORDER BY month DESC LIMIT 1",
            description: "Latest-month ECL coverage on the housing book (exposure, provision, PCR and total ECL).",
            rowCount: 1,
            executionTimeMs: 289,
            columns: ["month", "stage_3_exposure_m", "stage_3_provision_m", "pcr_stage_3", "total_ecl_m"],
            data: [{ month: "2025-03", stage_3_exposure_m: 802, stage_3_provision_m: 321, pcr_stage_3: 40, total_ecl_m: 711 }],
          },
          {
            sql: "WITH p AS (SELECT product_type, aum, gnpa_pct FROM product_performance WHERE entity = 'hfc') SELECT product_type, ROUND(aum / 1e9, 2) AS aum_b, ROUND(100.0 * aum / SUM(aum) OVER (), 1) AS aum_share_pct, ROUND(100.0 * SUM(aum) OVER (ORDER BY aum DESC) / SUM(aum) OVER (), 1) AS cum_share_pct, ROW_NUMBER() OVER (ORDER BY aum DESC) AS rnk, ROUND(gnpa_pct, 2) AS gnpa_pct FROM p ORDER BY aum DESC",
            description: "Housing products ranked by AUM with each product's share and a running cumulative share.",
            rowCount: 6,
            executionTimeMs: 446,
            columns: ["product_type", "aum_b", "aum_share_pct", "cum_share_pct", "rnk", "gnpa_pct"],
            data: [
              { product_type: "home_purchase", aum_b: 52.16, aum_share_pct: 61.3, cum_share_pct: 61.3, rnk: 1, gnpa_pct: 1 },
              { product_type: "home_construction", aum_b: 13.07, aum_share_pct: 15.3, cum_share_pct: 76.6, rnk: 2, gnpa_pct: 0.99 },
              { product_type: "lap_residential", aum_b: 9.38, aum_share_pct: 11, cum_share_pct: 87.6, rnk: 3, gnpa_pct: 0.99 },
              { product_type: "home_improvement", aum_b: 5.67, aum_share_pct: 6.7, cum_share_pct: 94.3, rnk: 4, gnpa_pct: 1.23 },
              { product_type: "lap_commercial", aum_b: 4.01, aum_share_pct: 4.7, cum_share_pct: 99, rnk: 5, gnpa_pct: 0.86 },
              { product_type: "micro_housing", aum_b: 0.85, aum_share_pct: 1, cum_share_pct: 100, rnk: 6, gnpa_pct: 1.11 },
            ],
          },
          {
            sql: "WITH b AS (SELECT CASE WHEN disbursed_amount < 1000000 THEN '1_<10L' WHEN disbursed_amount < 2000000 THEN '2_10-20L' WHEN disbursed_amount < 3500000 THEN '3_20-35L' WHEN disbursed_amount < 5000000 THEN '4_35-50L' ELSE '5_50L+' END AS ticket_band, disbursed_amount, stage FROM loans_full WHERE entity = 'hfc') SELECT ticket_band, COUNT(*) AS loans, ROUND(AVG(disbursed_amount) / 100000, 1) AS avg_ticket_lakh, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct FROM b GROUP BY ticket_band ORDER BY ticket_band",
            description: "Housing-book Stage-3 rate by disbursed-ticket-size band (CASE bucketing).",
            rowCount: 3,
            executionTimeMs: 583,
            columns: ["ticket_band", "loans", "avg_ticket_lakh", "aum_b", "gnpa_pct"],
            data: [
              { ticket_band: "1_<10L", loans: 45627, avg_ticket_lakh: 6.7, aum_b: 30.79, gnpa_pct: 0.84 },
              { ticket_band: "2_10-20L", loans: 56560, avg_ticket_lakh: 13.8, aum_b: 78.11, gnpa_pct: 0.7 },
              { ticket_band: "3_20-35L", loans: 2678, avg_ticket_lakh: 21.7, aum_b: 5.81, gnpa_pct: 0.71 },
            ],
          },
        ],
        summary:
          "Detailed the housing product mix, provisioning, AUM concentration and ticket-size risk. home_purchase anchors the book (61.3% of AUM at 1.00% GNPA), Stage-3 is provisioned at a conservative 40% PCR, and no loan exceeds ~₹22L with the ₹10-20L core band cleanest at 0.70%.",
      },
      "cohort-retention": {
        queries: [
          {
            sql: "SELECT EXTRACT(year FROM disbursement_date) AS vintage_year, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket IN ('sma_1','sma_2')) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS early_dpd_pct FROM loans_full WHERE entity = 'hfc' GROUP BY vintage_year ORDER BY vintage_year",
            description: "Housing-book GNPA and early-DPD pipeline by disbursement vintage.",
            rowCount: 4,
            executionTimeMs: 561,
            columns: ["vintage_year", "gnpa_pct", "early_dpd_pct"],
            data: [
              { vintage_year: 2022, gnpa_pct: 1.01, early_dpd_pct: 2.15 },
              { vintage_year: 2023, gnpa_pct: 1.04, early_dpd_pct: 2.02 },
              { vintage_year: 2024, gnpa_pct: 1.04, early_dpd_pct: 2.03 },
              { vintage_year: 2025, gnpa_pct: 0.94, early_dpd_pct: 1.83 },
            ],
          },
          {
            sql: "SELECT CASE WHEN is_ntc THEN 'ntc' ELSE 'existing' END AS borrower_kind, COUNT(*) AS loans, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket IN ('sma_1','sma_2')) / COUNT(*), 2) AS early_dpd_pct FROM loans_full WHERE entity = 'hfc' GROUP BY is_ntc ORDER BY borrower_kind",
            description: "Housing-book Stage-3 and early-DPD for new-to-credit versus credit-tested borrowers.",
            rowCount: 2,
            executionTimeMs: 498,
            columns: ["borrower_kind", "loans", "aum_b", "gnpa_pct", "early_dpd_pct"],
            data: [
              { borrower_kind: "existing", loans: 73279, aum_b: 80.18, gnpa_pct: 0.75, early_dpd_pct: 1.49 },
              { borrower_kind: "ntc", loans: 31586, aum_b: 34.52, gnpa_pct: 0.8, early_dpd_pct: 1.53 },
            ],
          },
        ],
        summary:
          "Checked the housing book for vintage drift and NTC performance. Every cohort 2022-2025 sits at 0.94%-1.04% GNPA, and new-to-credit borrowers (30% of the book) perform almost identically to credit-tested ones (0.80% vs 0.75% Stage-3).",
      },
      "daily-metrics": {
        queries: [
          {
            sql: "WITH m AS (SELECT month, SUM(loan_count) AS loans, SUM(total_amount) AS amt, SUM(total_amount * avg_rate) / SUM(total_amount) AS wavg_rate, SUM(total_amount * avg_ltv) / SUM(total_amount) AS wavg_ltv FROM monthly_disbursements WHERE entity = 'hfc' GROUP BY month) SELECT strftime(month, '%Y-%m') AS month, loans, ROUND(amt / 1e9, 2) AS disb_b, ROUND(wavg_rate, 2) AS avg_rate, ROUND(100.0 * wavg_ltv, 1) AS avg_ltv_pct, ROUND(100.0 * (amt - LAG(amt) OVER (ORDER BY month)) / LAG(amt) OVER (ORDER BY month), 1) AS disb_mom_pct FROM m ORDER BY month DESC LIMIT 6",
            description: "Housing monthly disbursement with volume-weighted rate, LTV and a LAG-based MoM growth.",
            rowCount: 6,
            executionTimeMs: 712,
            columns: ["month", "loans", "disb_b", "avg_rate", "avg_ltv_pct", "disb_mom_pct"],
            data: [
              { month: "2025-03", loans: 4133, disb_b: 4.54, avg_rate: 14.88, avg_ltv_pct: 45.2, disb_mom_pct: 0.4 },
              { month: "2025-02", loans: 4085, disb_b: 4.52, avg_rate: 14.88, avg_ltv_pct: 45, disb_mom_pct: 3.7 },
              { month: "2025-01", loans: 4037, disb_b: 4.36, avg_rate: 14.89, avg_ltv_pct: 45.1, disb_mom_pct: 9.4 },
              { month: "2024-12", loans: 3641, disb_b: 3.99, avg_rate: 14.83, avg_ltv_pct: 44.9, disb_mom_pct: 1.7 },
              { month: "2024-11", loans: 3597, disb_b: 3.92, avg_rate: 14.89, avg_ltv_pct: 44.9, disb_mom_pct: 1.3 },
              { month: "2024-10", loans: 3553, disb_b: 3.87, avg_rate: 14.78, avg_ltv_pct: 45.2, disb_mom_pct: 13.4 },
            ],
          },
          {
            sql: "SELECT strftime(month, '%Y-%m') AS month, ROUND(collection_efficiency_pct, 2) AS ce_pct, ROUND(bounce_rate_pct, 2) AS bounce_pct, ROUND(avg_dpd, 2) AS avg_dpd, ROUND(collection_efficiency_pct - LAG(collection_efficiency_pct) OVER (ORDER BY month), 2) AS ce_mom_chg FROM collection_efficiency ORDER BY month DESC LIMIT 6",
            description: "Book-wide collection efficiency, bounce rate and average DPD with a LAG-based MoM change.",
            rowCount: 6,
            executionTimeMs: 341,
            columns: ["month", "ce_pct", "bounce_pct", "avg_dpd", "ce_mom_chg"],
            data: [
              { month: "2025-03", ce_pct: 94.44, bounce_pct: 29.04, avg_dpd: 6.76, ce_mom_chg: 0.09 },
              { month: "2025-02", ce_pct: 94.35, bounce_pct: 28.97, avg_dpd: 7.57, ce_mom_chg: -0.1 },
              { month: "2025-01", ce_pct: 94.45, bounce_pct: 29.04, avg_dpd: 8.43, ce_mom_chg: -1.17 },
              { month: "2024-12", ce_pct: 95.62, bounce_pct: 29.13, avg_dpd: 8.35, ce_mom_chg: 0.42 },
              { month: "2024-11", ce_pct: 95.2, bounce_pct: 32.22, avg_dpd: 10.1, ce_mom_chg: -0.01 },
              { month: "2024-10", ce_pct: 95.21, bounce_pct: 32.38, avg_dpd: 11.2, ce_mom_chg: -0.46 },
            ],
          },
        ],
        summary:
          "Tracked the housing disbursement run-rate and book-wide collection efficiency. Disbursement grew to a record ₹4.54B in Mar 2025 with weighted rate and LTV held near 14.9% and 45%, and collection efficiency runs 94% to 96% with average DPD more than halving over the year.",
      },
      "user-segmentation": {
        queries: [
          {
            sql: "SELECT employment_type, COUNT(*) AS loans, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(AVG(bureau_score) FILTER (WHERE bureau_score >= 300), 0) AS avg_cibil_scored, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct FROM loans_full WHERE entity = 'hfc' GROUP BY employment_type ORDER BY gnpa_pct DESC",
            description: "Housing-book Stage-3 by employment type with average scored CIBIL.",
            rowCount: 4,
            executionTimeMs: 567,
            columns: ["employment_type", "loans", "aum_b", "avg_cibil_scored", "gnpa_pct"],
            data: [
              { employment_type: "salaried_informal", loans: 9202, aum_b: 10.04, avg_cibil_scored: 741, gnpa_pct: 0.85 },
              { employment_type: "self_employed_informal", loans: 69306, aum_b: 75.86, avg_cibil_scored: 741, gnpa_pct: 0.79 },
              { employment_type: "salaried_formal", loans: 10447, aum_b: 11.48, avg_cibil_scored: 741, gnpa_pct: 0.78 },
              { employment_type: "self_employed_formal", loans: 15910, aum_b: 17.32, avg_cibil_scored: 742, gnpa_pct: 0.58 },
            ],
          },
          {
            sql: "SELECT income_category, COUNT(*) AS loans, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(AVG(monthly_income_inr) / 1000, 1) AS avg_income_k, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct FROM loans_full WHERE entity = 'hfc' GROUP BY income_category ORDER BY gnpa_pct DESC",
            description: "Housing-book Stage-3 by income tier (EWS/LIG/MIG affordable-housing categories).",
            rowCount: 3,
            executionTimeMs: 531,
            columns: ["income_category", "loans", "aum_b", "avg_income_k", "gnpa_pct"],
            data: [
              { income_category: "ews", loans: 17702, aum_b: 19.35, avg_income_k: 19.8, gnpa_pct: 0.8 },
              { income_category: "lig", loans: 69654, aum_b: 76.28, avg_income_k: 36.8, gnpa_pct: 0.76 },
              { income_category: "mig", loans: 17509, aum_b: 19.07, avg_income_k: 58.7, gnpa_pct: 0.73 },
            ],
          },
        ],
        summary:
          "Cut the housing book by borrower segment. Formal self-employed is the cleanest cohort (0.58% Stage-3), the income-tier risk gradient is shallow (EWS 0.80% to MIG 0.73%), and the LIG tier anchors the book at ₹76.28B and 0.76%.",
      },
      geographic: {
        queries: [
          {
            sql: "WITH s AS (SELECT state, COUNT(*) AS loans, SUM(disbursed_amount) AS aum, 100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) AS gnpa FROM loans_full WHERE entity = 'hfc' GROUP BY state) SELECT state, loans, ROUND(aum / 1e9, 2) AS aum_b, ROUND(100.0 * aum / SUM(aum) OVER (), 1) AS aum_share_pct, ROUND(gnpa, 2) AS gnpa_pct, RANK() OVER (ORDER BY aum DESC) AS aum_rank FROM s ORDER BY aum DESC LIMIT 4",
            description: "Top housing states by AUM with AUM share, Stage-3 rate and a window RANK.",
            rowCount: 4,
            executionTimeMs: 689,
            columns: ["state", "loans", "aum_b", "aum_share_pct", "gnpa_pct", "aum_rank"],
            data: [
              { state: "Rajasthan", loans: 14272, aum_b: 15.71, aum_share_pct: 13.7, gnpa_pct: 0.95, aum_rank: 1 },
              { state: "Maharashtra", loans: 13860, aum_b: 15.17, aum_share_pct: 13.2, gnpa_pct: 0.76, aum_rank: 2 },
              { state: "Gujarat", loans: 12621, aum_b: 13.8, aum_share_pct: 12, gnpa_pct: 0.69, aum_rank: 3 },
              { state: "Madhya Pradesh", loans: 12121, aum_b: 13.29, aum_share_pct: 11.6, gnpa_pct: 0.69, aum_rank: 4 },
            ],
          },
          {
            sql: "SELECT city_tier, COUNT(*) AS loans, ROUND(SUM(disbursed_amount) / 1e9, 2) AS aum_b, ROUND(100.0 * SUM(disbursed_amount) / SUM(SUM(disbursed_amount)) OVER (), 1) AS aum_share_pct, ROUND(AVG(disbursed_amount) / 100000, 1) AS avg_ticket_lakh, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*), 2) AS gnpa_pct FROM loans_full WHERE entity = 'hfc' GROUP BY city_tier ORDER BY city_tier",
            description: "Housing-book AUM share, ticket and Stage-3 by city tier (t30 metros vs b30 cities).",
            rowCount: 2,
            executionTimeMs: 612,
            columns: ["city_tier", "loans", "aum_b", "aum_share_pct", "avg_ticket_lakh", "gnpa_pct"],
            data: [
              { city_tier: "b30", loans: 52874, aum_b: 57.78, aum_share_pct: 50.4, avg_ticket_lakh: 10.9, gnpa_pct: 0.8 },
              { city_tier: "t30", loans: 51991, aum_b: 56.93, aum_share_pct: 49.6, avg_ticket_lakh: 10.9, gnpa_pct: 0.72 },
            ],
          },
        ],
        summary:
          "Mapped the housing book geographically. AUM is well-diversified (top state Rajasthan only 13.7%, and the one quality watch-item at 0.95%), and the book splits evenly between metro and smaller-city markets with b30 running a modest 8-basis-point higher GNPA.",
      },
    },
  }),
  deepResearchThread({
    slug: "branch-product-performance",
    title: "Where is delinquency concentrated by branch and product?",
    question:
      "Where should I send collections attention: which branches and products are dragging the book?",
    report: `## Branch & Product Performance: Where the Drag Is

### Executive summary

Delinquency is **structurally concentrated in the Finserve (vehicle/MSME) network**. Every branch in the top-5 GNPA table is a Finserve branch, all running ~2.5-2.8%, roughly double the 1.42% book average [geographic:Q1]. But the rate ranking is only half the story: by absolute Stage-3 count, the top-10 branches (all Finserve) hold over a quarter of the book's entire delinquency, and the two biggest books by volume (Maharashtra and Rajasthan) carry ~27% of all live Stage-3 despite middling rates. Collections capacity should therefore follow both the rate and the volume.

The root cause is product, not place: every Finserve product runs 1.9% to 2.0% GNPA while every housing product sits near 1.0%, and the pattern holds across city tiers, branch ages and vintages. The drag traces specifically to vehicle-and-personal co-lending partners (Tata Capital, TVS Credit, DMI Finance) sourced through the connector channel. This report ranks the worst branches by both rate and absolute count, proves the product-over-geography thesis across several cuts, isolates the partner-level pockets, and tests whether branch age or vintage explains the gap (it does not).

### Methodology and data note

Branch and state GNPA are computed from \`loans_full\` as Stage-3 over live (active + NPA) accounts, with a minimum-size floor (200 live loans for branches, 2,000 for states) so the rate is meaningful. Product, channel and co-lending figures come from the precomputed \`product_performance\`, \`sourcing_channel_performance\` and \`co_lending_performance\` tables plus partner-level cuts of \`loans_full\`. Branch seasoning uses \`branch_open_date\` against a 2025-03-31 reference. The risk-adjusted spread is a yield-minus-loss proxy (yield minus GNPA times an assumed 45% LGD times 12), used only to rank relative product economics. All figures validated against the dataset's DuckDB.

### Highest-GNPA branches (>=200 live loans)

| Branch | State | Live | Stage-3 | GNPA |
|---|---|---|---|---|
| Ludhiana Finserve Branch | Punjab | 825 | 23 | **2.79%** |
| Bengaluru Finserve Branch | Karnataka | 736 | 20 | 2.72% |
| Dwarka Finserve Branch | Delhi | 762 | 20 | 2.62% |
| Rajkot Finserve Branch | Gujarat | 1,534 | 40 | 2.61% |
| Kanpur Finserve Branch | UP | 758 | 19 | 2.51% |

**Rajkot Finserve** is the priority: at 1,534 live loans it carries the largest absolute Stage-3 count (40 accounts) [geographic:Q1], so a focused recovery drive there clears the most overdue value per visit.

### Product is the root cause, not geography

| Entity / product | Active loans | AUM | Avg yield | GNPA |
|---|---|---|---|---|
| Finserve msme | 14,319 | ₹7.92B | 21.49% | **2.03%** |
| Finserve used_car | 14,302 | ₹7.27B | 19.50% | 1.95% |
| Finserve used_cv | 22,730 | ₹9.16B | 20.99% | 1.93% |
| Finserve micro_housing | 5,682 | ₹1.70B | 19.53% | 1.90% |
| HFC home_improvement | 9,415 | ₹5.67B | 15.17% | 1.23% |
| HFC home_purchase | 38,750 | ₹52.16B | 14.17% | 1.00% |

Every Finserve product sits at 1.9-2.0% GNPA; every HFC product sits near or below 1.2% [rev-opt:Q1]. The branches are "bad" because they sell the high-yield, high-risk Finserve products: the 21.49% MSME yield comes with 2x the loss rate [rev-opt:Q1]. The geography test confirms it: Finserve runs an identical 1.91% GNPA in both top-30 metros and beyond-30 cities, so location is not the variable [geographic:Q3].

### Sourcing channel amplifies it

| Entity / channel | Loans | Avg rate | GNPA |
|---|---|---|---|
| Finserve connector | 12,411 | 20.59% | **2.21%** |
| Finserve dsa | 41,174 | 20.59% | 1.95% |
| HFC digital | 10,493 | 15.12% | 1.07% |
| HFC connector | 15,727 | 15.15% | 0.95% |

**Connector-sourced Finserve loans are the single worst pocket at 2.21% GNPA** [user-segmentation:Q1]: the same channel is the *best* on the HFC side (0.95%) [user-segmentation:Q1], so the problem is the Finserve underwriting box, not the channel itself.

### Absolute risk: where the Stage-3 mass actually sits

The rate ranking points at small branches; the absolute-count ranking points at the metros. By Stage-3 count, the worst pockets are large metro Finserve branches, and the top five alone hold 15.1% of all live Stage-3 [data-quality:Q1]:

| Branch | State | Stage-3 | Share | Cumulative |
|---|---|---|---|---|
| Hyderabad Finserve | Telangana | 59 | 3.13% | 3.13% |
| Chennai Finserve | Tamil Nadu | 59 | 3.13% | 6.26% |
| Gurugram Finserve | Haryana | 58 | 3.08% | 9.34% |
| Guntur Finserve | Andhra Pradesh | 57 | 3.02% | 12.36% |
| Pune Finserve | Maharashtra | 51 | 2.71% | 15.07% |

All are Finserve. At the state level, the real Stage-3 mass sits in Maharashtra (14.13% of all live Stage-3) and Rajasthan (12.90%), which together hold over a quarter of all delinquency even though their rate (~1.45%) is only middling [geographic:Q2]. Collections capacity should follow that volume, not just the rate table.

### The Finserve drag is broad, not a handful of outliers

The branch GNPA distribution confirms the problem is structural [data-quality:Q2]:

| Entity | Branches | Median GNPA | p90 GNPA | Branches over 2% |
|---|---|---|---|---|
| Finserve | 40 | 1.93% | 2.44% | **16** |
| HFC | 107 | 1.00% | 1.53% | 4 |

Sixteen of forty Finserve branches (40%) run above 2% GNPA, and the whole distribution sits ~0.9 points above HFC [data-quality:Q2]. This is not a few bad branches; the entire Finserve network is shifted high. Within Finserve, the lighter-footprint sales-office format is the worst branch type at 2.00%, ahead of micro (1.92%) and small (1.83%) [geographic:Q4], hinting that thinner-staffed formats underwrite or collect less tightly.

### Risk-adjusted, the high-GNPA products still earn their keep

Subtracting a loss proxy from yield reorders the picture [rev-opt:Q2]:

| Entity / product | Yield | GNPA | Risk-adj spread |
|---|---|---|---|
| HFC lap_commercial | 18.41% | 0.86% | **13.79%** |
| HFC micro_housing | 17.92% | 1.11% | 11.91% |
| HFC lap_residential | 17.17% | 0.99% | 11.84% |
| Finserve used_cv | 20.99% | 1.93% | 10.59% |
| Finserve msme | 21.49% | 2.03% | 10.55% |
| HFC home_construction | 14.66% | 0.99% | 9.29% |

HFC's low-GNPA LAP products lead, but Finserve used_cv and MSME still rank 4th and 5th because their 21% yields absorb the higher loss rate [rev-opt:Q2]. So the answer is not to exit Finserve products wholesale: it is to fix the worst partner-level pockets while keeping the economics that work.

### The partner-level pockets behind the connector drag

The 2.21% connector GNPA is dragged by specific co-lending partners [user-segmentation:Q2]:

| Partner | Live | Stage-3 | GNPA |
|---|---|---|---|
| TVS Credit | 1,319 | 40 | **3.03%** |
| Utkarsh Small Finance Bank | 670 | 20 | 2.99% |
| Tata Capital | 401 | 11 | 2.74% |
| Northern Arc Capital | 767 | 20 | 2.61% |
| Axis Bank | 1,138 | 29 | 2.55% |

Across the full co-lending book the same names lead: Tata Capital (2.38%), TVS Credit (2.16% on ₹4.12B and 195 NPAs), and the largest co-lent book DMI Finance (₹5.40B, 241 NPAs, 2.03%) [rev-opt:Q3]. Remediation should be partner-targeted, not a blanket connector-channel clampdown.

### It is not branch age, and it is not new underwriting

Two tests rule out the easy explanations. Branch seasoning does not explain the gap: Finserve runs 1.85% to 1.96% across under-1-year, 1-3-year and 3-year-plus branches, and HFC stays a flat 0.97% to 1.08% [cohort-retention:Q1]. And the Finserve vintage curve simply reflects normal aging, with the oldest 2022 cohort at 3.22% stepping down to 1.36% for 2025 [cohort-retention:Q2], so recent underwriting is improving, not deteriorating. The drag is a steady-state property of the mature Finserve book.

### Recent NPA inflow

Tracking monthly fresh-NPA additions in the four largest-Stage-3 states, Maharashtra is the most volatile and the clearest recent re-acceleration: it dropped 10 in January then added 7 in February back to 15 fresh NPAs a month, holding there in March, while Rajasthan oscillates in a tight 10-12 band [daily-metrics:Q1]. Maharashtra is the best candidate for an early collections intervention.

## Key Findings

- **All top-5 GNPA branches are Finserve** (2.5-2.8%); the housing network does not appear until 2.45% (Mysuru, only 408 loans) [geographic:Q1].
- **By absolute count the top-5 branches (all Finserve metros) hold 15% of all Stage-3** [data-quality:Q1], and Maharashtra plus Rajasthan carry ~27% of live Stage-3 at the state level [geographic:Q2]: triage on volume, not just rate.
- **The Finserve drag is broad**: 40% of its branches exceed 2% GNPA versus 4 of 107 HFC branches [data-quality:Q2].
- **Product, not place, is the driver**: Finserve products run 1.9-2.0%, HFC products near 1.0% [rev-opt:Q1], and neither branch age nor vintage explains it [cohort-retention:Q1][cohort-retention:Q2].
- **The connector drag is partner-level**: TVS Credit (3.03%), Utkarsh (2.99%) and Tata Capital lead [user-segmentation:Q2][rev-opt:Q3], so remediation should be partner-targeted.

## Recommended Actions

1. **Send the collections strike team to the highest-absolute-Stage-3 Finserve branches first**: Hyderabad, Chennai, Gurugram and Guntur Finserve top the absolute count [data-quality:Q1], and Maharashtra plus Rajasthan anchor the state-level mass [geographic:Q2].
2. **Fix the partner box, not the channel**: tighten or reprice the worst co-lending partners (TVS Credit, Utkarsh, Tata Capital, DMI) rather than clamping the whole connector channel [user-segmentation:Q2][rev-opt:Q3].
3. **Keep the high-yield Finserve products that earn their keep**: used_cv and MSME still post a healthy risk-adjusted spread [rev-opt:Q2]; reprice the laggards rather than exiting the line.
4. **Do not blame new branches or new loans**: branch age and recent vintages are not the driver [cohort-retention:Q1][cohort-retention:Q2], so target the mature Finserve book.
5. **Leave the housing network alone**: diverting housing collectors to chase Finserve-driven numbers would waste a 1% book.

\`\`\`sql
-- Branch-level GNPA with a minimum-size guard so the rate is meaningful
SELECT
  l.branch_name,
  l.state,
  l.entity,
  COUNT(*) FILTER (WHERE l.loan_status IN ('active','npa'))            AS live_loans,
  COUNT(*) FILTER (WHERE l.stage = 3)                                  AS stage_3,
  ROUND(100.0 * COUNT(*) FILTER (WHERE l.stage = 3)
        / COUNT(*) FILTER (WHERE l.loan_status IN ('active','npa')),
        2)                                                             AS gnpa_pct
FROM loans_full l
GROUP BY l.branch_name, l.state, l.entity
HAVING COUNT(*) FILTER (WHERE l.loan_status IN ('active','npa')) >= 200
ORDER BY gnpa_pct DESC
LIMIT 10;
\`\`\``,
    followUps: [
      "Give me the Rajkot Finserve Stage-3 account list.",
      "How does MSME GNPA compare to its collection cost?",
      "Which Finserve connector partners drive the 2.21% GNPA?",
      "Are the high-GNPA branches new or seasoned?",
    ],
    work: {
      geographic: {
        queries: [
          {
            sql: "SELECT branch_name, state, entity, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live_loans, COUNT(*) FILTER (WHERE stage = 3) AS stage_3, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY branch_name, state, entity HAVING COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) >= 200 ORDER BY gnpa_pct DESC LIMIT 6",
            description: "Highest-GNPA branches with a 200-loan minimum so the rate is meaningful.",
            rowCount: 6,
            executionTimeMs: 934,
            columns: ["branch_name", "state", "entity", "live_loans", "stage_3", "gnpa_pct"],
            data: [
              { branch_name: "Ludhiana Finserve Branch", state: "Punjab", entity: "finserve", live_loans: 825, stage_3: 23, gnpa_pct: 2.79 },
              { branch_name: "Bengaluru Finserve Branch", state: "Karnataka", entity: "finserve", live_loans: 736, stage_3: 20, gnpa_pct: 2.72 },
              { branch_name: "Dwarka Finserve Branch", state: "Delhi", entity: "finserve", live_loans: 762, stage_3: 20, gnpa_pct: 2.62 },
              { branch_name: "Rajkot Finserve Branch", state: "Gujarat", entity: "finserve", live_loans: 1534, stage_3: 40, gnpa_pct: 2.61 },
              { branch_name: "Kanpur Finserve Branch", state: "Uttar Pradesh", entity: "finserve", live_loans: 758, stage_3: 19, gnpa_pct: 2.51 },
              { branch_name: "Mysuru Branch", state: "Karnataka", entity: "hfc", live_loans: 408, stage_3: 10, gnpa_pct: 2.45 },
            ],
          },
          {
            sql: "WITH s AS (SELECT state, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full GROUP BY 1) SELECT state, live, s3, ROUND(100.0 * s3 / live, 2) gnpa, RANK() OVER (ORDER BY 100.0 * s3 / live DESC) rnk, ROUND(100.0 * s3 / SUM(s3) OVER (), 2) pct_of_total_s3 FROM s WHERE live >= 2000 ORDER BY pct_of_total_s3 DESC LIMIT 6",
            description: "State-level GNPA with each state's window share of total live Stage-3, ranked by absolute mass.",
            rowCount: 6,
            executionTimeMs: 1043,
            columns: ["state", "live", "s3", "gnpa", "rnk", "pct_of_total_s3"],
            data: [
              { state: "Maharashtra", live: 17947, s3: 263, gnpa: 1.47, rnk: 7, pct_of_total_s3: 14.13 },
              { state: "Rajasthan", live: 16702, s3: 240, gnpa: 1.44, rnk: 8, pct_of_total_s3: 12.9 },
              { state: "Tamil Nadu", live: 14950, s3: 197, gnpa: 1.32, rnk: 11, pct_of_total_s3: 10.59 },
              { state: "Gujarat", live: 14151, s3: 183, gnpa: 1.29, rnk: 12, pct_of_total_s3: 9.83 },
              { state: "Madhya Pradesh", live: 13520, s3: 164, gnpa: 1.21, rnk: 13, pct_of_total_s3: 8.81 },
              { state: "Uttar Pradesh", live: 11698, s3: 159, gnpa: 1.36, rnk: 9, pct_of_total_s3: 8.54 },
            ],
          },
          {
            sql: "WITH s AS (SELECT entity, city_tier, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full GROUP BY 1,2) SELECT entity, city_tier, live, s3, ROUND(100.0 * s3 / live, 2) gnpa FROM s WHERE live >= 500 ORDER BY entity, gnpa DESC",
            description: "GNPA by city tier and entity, to test whether the Finserve drag is geography-driven.",
            rowCount: 4,
            executionTimeMs: 718,
            columns: ["entity", "city_tier", "live", "s3", "gnpa"],
            data: [
              { entity: "finserve", city_tier: "b30", live: 33167, s3: 633, gnpa: 1.91 },
              { entity: "finserve", city_tier: "t30", live: 23866, s3: 457, gnpa: 1.91 },
              { entity: "hfc", city_tier: "b30", live: 39408, s3: 422, gnpa: 1.07 },
              { entity: "hfc", city_tier: "t30", live: 38684, s3: 373, gnpa: 0.96 },
            ],
          },
          {
            sql: "WITH s AS (SELECT entity, branch_type, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full GROUP BY 1,2) SELECT entity, branch_type, live, s3, ROUND(100.0 * s3 / live, 2) gnpa, RANK() OVER (PARTITION BY entity ORDER BY 100.0 * s3 / live DESC) rnk FROM s WHERE live >= 300 ORDER BY entity, gnpa DESC",
            description: "GNPA by branch type and entity with a per-entity window RANK.",
            rowCount: 7,
            executionTimeMs: 836,
            columns: ["entity", "branch_type", "live", "s3", "gnpa", "rnk"],
            data: [
              { entity: "finserve", branch_type: "sales_office", live: 19230, s3: 384, gnpa: 2, rnk: 1 },
              { entity: "finserve", branch_type: "micro", live: 15433, s3: 297, gnpa: 1.92, rnk: 2 },
              { entity: "finserve", branch_type: "small", live: 22370, s3: 409, gnpa: 1.83, rnk: 3 },
              { entity: "hfc", branch_type: "main", live: 24979, s3: 275, gnpa: 1.1, rnk: 1 },
              { entity: "hfc", branch_type: "small", live: 28091, s3: 278, gnpa: 0.99, rnk: 2 },
              { entity: "hfc", branch_type: "sales_office", live: 10316, s3: 102, gnpa: 0.99, rnk: 3 },
              { entity: "hfc", branch_type: "micro", live: 14706, s3: 140, gnpa: 0.95, rnk: 4 },
            ],
          },
        ],
        summary:
          "Ranked branches by GNPA, located the state-level Stage-3 mass, and cut GNPA by city tier and branch type. The top five branches are all Finserve at 2.5-2.8%, Maharashtra plus Rajasthan hold ~27% of all live Stage-3, Finserve runs an identical 1.91% across both city tiers, and its lighter-footprint sales-office format is the worst branch type at 2.00%.",
      },
      "rev-opt": {
        queries: [
          {
            sql: "SELECT entity, product_type, active_loans, ROUND(aum / 1e9, 2) AS aum_b, ROUND(avg_yield, 2) AS avg_yield, ROUND(gnpa_pct, 2) AS gnpa_pct FROM product_performance ORDER BY gnpa_pct DESC LIMIT 8",
            description: "Products ranked by GNPA across both entities, to test whether place or product drives the drag.",
            rowCount: 8,
            executionTimeMs: 401,
            columns: ["entity", "product_type", "active_loans", "aum_b", "avg_yield", "gnpa_pct"],
            data: [
              { entity: "finserve", product_type: "msme", active_loans: 14319, aum_b: 7.92, avg_yield: 21.49, gnpa_pct: 2.03 },
              { entity: "finserve", product_type: "used_car", active_loans: 14302, aum_b: 7.27, avg_yield: 19.5, gnpa_pct: 1.95 },
              { entity: "finserve", product_type: "used_cv", active_loans: 22730, aum_b: 9.16, avg_yield: 20.99, gnpa_pct: 1.93 },
              { entity: "finserve", product_type: "micro_housing_finserve", active_loans: 5682, aum_b: 1.7, avg_yield: 19.53, gnpa_pct: 1.9 },
              { entity: "hfc", product_type: "home_improvement", active_loans: 9415, aum_b: 5.67, avg_yield: 15.17, gnpa_pct: 1.23 },
              { entity: "hfc", product_type: "micro_housing", active_loans: 2428, aum_b: 0.85, avg_yield: 17.92, gnpa_pct: 1.11 },
              { entity: "hfc", product_type: "home_purchase", active_loans: 38750, aum_b: 52.16, avg_yield: 14.17, gnpa_pct: 1.0 },
              { entity: "hfc", product_type: "lap_residential", active_loans: 11653, aum_b: 9.38, avg_yield: 17.17, gnpa_pct: 0.99 },
            ],
          },
          {
            sql: "SELECT entity, product_type, active_loans, ROUND(avg_yield, 2) yield, ROUND(gnpa_pct, 2) gnpa, ROUND(avg_yield - gnpa_pct * 0.45 * 12, 2) risk_adj_spread, RANK() OVER (ORDER BY avg_yield - gnpa_pct * 0.45 * 12 DESC) rnk FROM product_performance WHERE active_loans >= 2000 ORDER BY risk_adj_spread DESC LIMIT 6",
            description: "Per-product risk-adjusted spread (yield minus a GNPA-based loss proxy) ranked with a window RANK.",
            rowCount: 6,
            executionTimeMs: 438,
            columns: ["entity", "product_type", "active_loans", "yield", "gnpa", "risk_adj_spread", "rnk"],
            data: [
              { entity: "hfc", product_type: "lap_commercial", active_loans: 3970, yield: 18.41, gnpa: 0.86, risk_adj_spread: 13.79, rnk: 1 },
              { entity: "hfc", product_type: "micro_housing", active_loans: 2428, yield: 17.92, gnpa: 1.11, risk_adj_spread: 11.91, rnk: 2 },
              { entity: "hfc", product_type: "lap_residential", active_loans: 11653, yield: 17.17, gnpa: 0.99, risk_adj_spread: 11.84, rnk: 3 },
              { entity: "finserve", product_type: "used_cv", active_loans: 22730, yield: 20.99, gnpa: 1.93, risk_adj_spread: 10.59, rnk: 4 },
              { entity: "finserve", product_type: "msme", active_loans: 14319, yield: 21.49, gnpa: 2.03, risk_adj_spread: 10.55, rnk: 5 },
              { entity: "hfc", product_type: "home_construction", active_loans: 11876, yield: 14.66, gnpa: 0.99, risk_adj_spread: 9.29, rnk: 6 },
            ],
          },
          {
            sql: "SELECT partner_name, partner_type, product_focus, active_loans, ROUND(aum / 1e9, 2) aum_b, ROUND(avg_yield, 2) yield, npa_count, ROUND(gnpa_pct, 2) gnpa, RANK() OVER (ORDER BY gnpa_pct DESC) rnk FROM co_lending_performance WHERE active_loans >= 200 ORDER BY gnpa_pct DESC LIMIT 6",
            description: "Co-lending partners ranked by GNPA from the co_lending_performance table with a window RANK.",
            rowCount: 6,
            executionTimeMs: 372,
            columns: ["partner_name", "partner_type", "product_focus", "active_loans", "aum_b", "yield", "npa_count", "gnpa", "rnk"],
            data: [
              { partner_name: "Tata Capital", partner_type: "nbfc", product_focus: "vehicle", active_loans: 2904, aum_b: 1.33, yield: 20.65, npa_count: 69, gnpa: 2.38, rnk: 1 },
              { partner_name: "TVS Credit", partner_type: "nbfc", product_focus: "vehicle", active_loans: 9022, aum_b: 4.12, yield: 20.59, npa_count: 195, gnpa: 2.16, rnk: 2 },
              { partner_name: "Finnable Credit", partner_type: "fintech", product_focus: "personal", active_loans: 3558, aum_b: 1.62, yield: 20.6, npa_count: 76, gnpa: 2.14, rnk: 3 },
              { partner_name: "DMI Finance", partner_type: "nbfc", product_focus: "personal", active_loans: 11886, aum_b: 5.4, yield: 20.58, npa_count: 241, gnpa: 2.03, rnk: 4 },
              { partner_name: "Northern Arc Capital", partner_type: "nbfc", product_focus: "micro_housing", active_loans: 4970, aum_b: 2.27, yield: 20.56, npa_count: 96, gnpa: 1.93, rnk: 5 },
              { partner_name: "Utkarsh Small Finance Bank", partner_type: "bank", product_focus: "msme", active_loans: 4234, aum_b: 1.93, yield: 20.6, npa_count: 81, gnpa: 1.91, rnk: 6 },
            ],
          },
        ],
        summary:
          "Ranked products by GNPA, by risk-adjusted spread, and the co-lending partners by GNPA. Every Finserve product runs 1.9-2.0% while housing sits near 1.0%, yet used_cv and MSME still earn a healthy risk-adjusted spread, and the delinquency clusters in vehicle/personal partners (Tata Capital, TVS Credit, DMI Finance).",
      },
      "user-segmentation": {
        queries: [
          {
            sql: "SELECT entity, sourcing_channel, COUNT(*) AS loans, ROUND(AVG(interest_rate), 2) AS avg_rate, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY entity, sourcing_channel ORDER BY gnpa_pct DESC",
            description: "GNPA by entity and sourcing channel, to isolate the worst channel-entity pocket.",
            rowCount: 8,
            executionTimeMs: 688,
            columns: ["entity", "sourcing_channel", "loans", "avg_rate", "gnpa_pct"],
            data: [
              { entity: "finserve", sourcing_channel: "connector", loans: 12411, avg_rate: 20.59, gnpa_pct: 2.21 },
              { entity: "finserve", sourcing_channel: "dsa", loans: 41174, avg_rate: 20.59, gnpa_pct: 1.95 },
              { entity: "finserve", sourcing_channel: "direct_sales", loans: 20706, avg_rate: 20.62, gnpa_pct: 1.85 },
              { entity: "finserve", sourcing_channel: "digital", loans: 8206, avg_rate: 20.58, gnpa_pct: 1.84 },
              { entity: "hfc", sourcing_channel: "digital", loans: 10493, avg_rate: 15.12, gnpa_pct: 1.07 },
              { entity: "hfc", sourcing_channel: "dsa", loans: 36689, avg_rate: 15.13, gnpa_pct: 1.05 },
              { entity: "hfc", sourcing_channel: "direct_sales", loans: 41956, avg_rate: 15.13, gnpa_pct: 1.01 },
              { entity: "hfc", sourcing_channel: "connector", loans: 15727, avg_rate: 15.15, gnpa_pct: 0.95 },
            ],
          },
          {
            sql: "WITH s AS (SELECT co_lending_partner_name pn, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full WHERE entity = 'finserve' AND sourcing_channel = 'connector' AND co_lending_partner_name IS NOT NULL GROUP BY 1) SELECT pn AS partner, live, s3, ROUND(100.0 * s3 / live, 2) gnpa FROM s WHERE live >= 200 ORDER BY gnpa DESC LIMIT 5",
            description: "Finserve connector-channel GNPA by co-lending partner, to find which partners drive the 2.21% pocket.",
            rowCount: 5,
            executionTimeMs: 821,
            columns: ["partner", "live", "s3", "gnpa"],
            data: [
              { partner: "TVS Credit", live: 1319, s3: 40, gnpa: 3.03 },
              { partner: "Utkarsh Small Finance Bank", live: 670, s3: 20, gnpa: 2.99 },
              { partner: "Tata Capital", live: 401, s3: 11, gnpa: 2.74 },
              { partner: "Northern Arc Capital", live: 767, s3: 20, gnpa: 2.61 },
              { partner: "Axis Bank", live: 1138, s3: 29, gnpa: 2.55 },
            ],
          },
        ],
        summary:
          "Cut GNPA by channel and entity and drilled the connector channel to partner level. Connector-sourced Finserve is the worst pocket at 2.21% (cleanest on the housing side at 0.95%), and within it TVS Credit (3.03%) and Utkarsh (2.99%) are the partners driving the drag.",
      },
      "data-quality": {
        queries: [
          {
            sql: "WITH b AS (SELECT branch_name, state, entity, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full GROUP BY 1,2,3), r AS (SELECT *, SUM(s3) OVER () tot, SUM(s3) OVER (ORDER BY s3 DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cum, ROW_NUMBER() OVER (ORDER BY s3 DESC) rn FROM b) SELECT rn, branch_name, state, entity, s3, ROUND(100.0 * s3 / tot, 2) pct_of_total, ROUND(100.0 * cum / tot, 2) cum_pct FROM r WHERE rn <= 5 ORDER BY rn",
            description: "Top branches by absolute live Stage-3 count with a running cumulative concentration share.",
            rowCount: 5,
            executionTimeMs: 1124,
            columns: ["rn", "branch_name", "state", "entity", "s3", "pct_of_total", "cum_pct"],
            data: [
              { rn: 1, branch_name: "Hyderabad Finserve Branch", state: "Telangana", entity: "finserve", s3: 59, pct_of_total: 3.13, cum_pct: 3.13 },
              { rn: 2, branch_name: "Chennai Finserve Branch", state: "Tamil Nadu", entity: "finserve", s3: 59, pct_of_total: 3.13, cum_pct: 6.26 },
              { rn: 3, branch_name: "Gurugram Finserve Branch", state: "Haryana", entity: "finserve", s3: 58, pct_of_total: 3.08, cum_pct: 9.34 },
              { rn: 4, branch_name: "Guntur Finserve Branch", state: "Andhra Pradesh", entity: "finserve", s3: 57, pct_of_total: 3.02, cum_pct: 12.36 },
              { rn: 5, branch_name: "Pune Finserve Branch", state: "Maharashtra", entity: "finserve", s3: 51, pct_of_total: 2.71, cum_pct: 15.07 },
            ],
          },
          {
            sql: "WITH b AS (SELECT branch_name, entity, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full GROUP BY 1,2), g AS (SELECT entity, 100.0 * s3 / live gnpa FROM b WHERE live >= 200) SELECT entity, COUNT(*) branches, ROUND(quantile_cont(gnpa, 0.5), 2) median_gnpa, ROUND(quantile_cont(gnpa, 0.9), 2) p90_gnpa, ROUND(MAX(gnpa), 2) max_gnpa, COUNT(*) FILTER (WHERE gnpa >= 2.0) branches_over_2pct FROM g GROUP BY entity ORDER BY entity",
            description: "Branch-level GNPA distribution per entity via quantile_cont, with a count of branches above 2%.",
            rowCount: 2,
            executionTimeMs: 967,
            columns: ["entity", "branches", "median_gnpa", "p90_gnpa", "max_gnpa", "branches_over_2pct"],
            data: [
              { entity: "finserve", branches: 40, median_gnpa: 1.93, p90_gnpa: 2.44, max_gnpa: 2.79, branches_over_2pct: 16 },
              { entity: "hfc", branches: 107, median_gnpa: 1, p90_gnpa: 1.53, max_gnpa: 2.45, branches_over_2pct: 4 },
            ],
          },
        ],
        summary:
          "Measured Stage-3 concentration and the branch GNPA distribution. The top-5 branches by absolute count (all Finserve metros) hold 15% of all Stage-3, and 16 of 40 Finserve branches run above 2% GNPA versus 4 of 107 HFC branches, so the drag is broad-based.",
      },
      "cohort-retention": {
        queries: [
          {
            sql: "WITH s AS (SELECT entity, CASE WHEN DATE_DIFF('day', branch_open_date, DATE '2025-03-31') < 365 THEN '1_under_1yr' WHEN DATE_DIFF('day', branch_open_date, DATE '2025-03-31') < 1095 THEN '2_1to3yr' ELSE '3_over_3yr' END age_bucket, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full GROUP BY 1,2) SELECT entity, age_bucket, live, s3, ROUND(100.0 * s3 / live, 2) gnpa FROM s ORDER BY entity, age_bucket",
            description: "GNPA by branch-age bucket and entity, to test whether high-GNPA branches are simply young.",
            rowCount: 6,
            executionTimeMs: 884,
            columns: ["entity", "age_bucket", "live", "s3", "gnpa"],
            data: [
              { entity: "finserve", age_bucket: "1_under_1yr", live: 13186, s3: 259, gnpa: 1.96 },
              { entity: "finserve", age_bucket: "2_1to3yr", live: 20664, s3: 383, gnpa: 1.85 },
              { entity: "finserve", age_bucket: "3_over_3yr", live: 23183, s3: 448, gnpa: 1.93 },
              { entity: "hfc", age_bucket: "1_under_1yr", live: 14095, s3: 151, gnpa: 1.07 },
              { entity: "hfc", age_bucket: "2_1to3yr", live: 20575, s3: 223, gnpa: 1.08 },
              { entity: "hfc", age_bucket: "3_over_3yr", live: 43422, s3: 421, gnpa: 0.97 },
            ],
          },
          {
            sql: "WITH s AS (SELECT EXTRACT(year FROM disbursement_date) yr, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) live, COUNT(*) FILTER (WHERE loan_status IN ('active','npa') AND stage = 3) s3 FROM loans_full WHERE entity = 'finserve' GROUP BY 1) SELECT yr, live, s3, ROUND(100.0 * s3 / live, 2) gnpa, LAG(ROUND(100.0 * s3 / live, 2)) OVER (ORDER BY yr) prev_gnpa FROM s WHERE live >= 200 ORDER BY yr",
            description: "Finserve GNPA by disbursement vintage with a prior-year LAG, to separate aging from underwriting drift.",
            rowCount: 4,
            executionTimeMs: 641,
            columns: ["yr", "live", "s3", "gnpa", "prev_gnpa"],
            data: [
              { yr: 2022, live: 3604, s3: 116, gnpa: 3.22, prev_gnpa: null },
              { yr: 2023, live: 15472, s3: 364, gnpa: 2.35, prev_gnpa: 3.22 },
              { yr: 2024, live: 28587, s3: 483, gnpa: 1.69, prev_gnpa: 2.35 },
              { yr: 2025, live: 9370, s3: 127, gnpa: 1.36, prev_gnpa: 1.69 },
            ],
          },
        ],
        summary:
          "Tested branch age and disbursement vintage as explanations for the Finserve drag. GNPA is flat across branch-age buckets (1.85-1.96%) and the vintage curve simply reflects aging (2022 at 3.22% down to 2025 at 1.36%), so neither new branches nor recent underwriting explains the drag.",
      },
      "daily-metrics": {
        queries: [
          {
            sql: "WITH agg AS (SELECT state, month, SUM(npa_count) npa FROM state_monthly_kpis WHERE state IN ('Maharashtra','Rajasthan','Andhra Pradesh','Karnataka') GROUP BY 1,2), t AS (SELECT state, month, npa, LAG(npa) OVER (PARTITION BY state ORDER BY month) prev_npa FROM agg) SELECT state, CAST(month AS VARCHAR) mth, npa, prev_npa, npa - prev_npa delta FROM t WHERE month >= DATE '2025-01-01' ORDER BY state, mth",
            description: "Monthly fresh-NPA additions for the four largest-Stage-3 states with a LAG-based month-on-month delta.",
            rowCount: 12,
            executionTimeMs: 723,
            columns: ["state", "mth", "npa", "prev_npa", "delta"],
            data: [
              { state: "Andhra Pradesh", mth: "2025-01-01", npa: 7, prev_npa: 9, delta: -2 },
              { state: "Andhra Pradesh", mth: "2025-02-01", npa: 5, prev_npa: 7, delta: -2 },
              { state: "Andhra Pradesh", mth: "2025-03-01", npa: 7, prev_npa: 5, delta: 2 },
              { state: "Karnataka", mth: "2025-01-01", npa: 5, prev_npa: 2, delta: 3 },
              { state: "Karnataka", mth: "2025-02-01", npa: 3, prev_npa: 5, delta: -2 },
              { state: "Karnataka", mth: "2025-03-01", npa: 3, prev_npa: 3, delta: 0 },
              { state: "Maharashtra", mth: "2025-01-01", npa: 8, prev_npa: 18, delta: -10 },
              { state: "Maharashtra", mth: "2025-02-01", npa: 15, prev_npa: 8, delta: 7 },
              { state: "Maharashtra", mth: "2025-03-01", npa: 15, prev_npa: 15, delta: 0 },
              { state: "Rajasthan", mth: "2025-01-01", npa: 10, prev_npa: 12, delta: -2 },
              { state: "Rajasthan", mth: "2025-02-01", npa: 12, prev_npa: 10, delta: 2 },
              { state: "Rajasthan", mth: "2025-03-01", npa: 10, prev_npa: 12, delta: -2 },
            ],
          },
        ],
        summary:
          "Tracked monthly fresh-NPA inflow in the four largest-Stage-3 states. Maharashtra is the most volatile and shows the clearest recent re-acceleration (back to 15 fresh NPAs a month), making it the best candidate for early intervention.",
      },
    },
  }),
  deepResearchThread({
    slug: "prepayment-runoff-disbursement-quality",
    title: "What's our run-off risk and is new disbursement holding quality?",
    question:
      "What's eating into the book through prepayment and run-off, and is the quality of new disbursement holding as we grow?",
    report: `## Run-Off Risk & Disbursement Quality

### Executive summary

Two forces shape the book's trajectory: **what's leaving** (prepayment, assignment, closure) and **what's coming in** (new disbursement quality). Both are currently healthy, but the home-loan book is where prepayment pressure concentrates. Run-off (closed, assigned, prepaid) is 27.0% of the book by disbursed value, of which prepayment is only 2.7%, so assignment and scheduled closure dominate. Within prepayment, home_purchase prepays at 3.60%, ~1.6x every other product, and at ₹2.55B of run-off principal carrying a 14.15% coupon it is the single largest yield drain.

On the inflow side, quality is holding: weighted LTV and pricing stayed flat through a near-tripling of quarterly volume, the 2025 vintage is the cleanest on both books, and new-to-credit mix has been stable at ~30%. The one watch-item is that early-stage SMA delinquency, while still low, has crept up across vintages, so the newest book looks healthy on hard NPA but is showing slightly more early stress. This report sizes the run-off, locates the prepayment, quantifies the yield walking out the door, profiles who is leaving, and tests whether growth has loosened underwriting.

### Methodology and data note

Run-off composition and prepayment are read from \`loans_full\` by \`loan_status\` (active, closed, assigned, prepaid, npa, written_off). Annualized yield-at-risk on prepaid loans is principal times the loan's interest rate. Assignment detail comes from the \`assignment_summary\` table (amounts in crore). Disbursement-quality trends use \`monthly_disbursements\` with volume-weighted rate and LTV. Cross-vintage comparisons are survivorship-aware: older cohorts have had more elapsed time to run off, so the gradient reflects time, not behavior. New-to-credit borrowers carry a placeholder bureau score; CIBIL bands separate them out where noted. All figures validated against the dataset's DuckDB.

### What's leaving the book

Ranking run-off categories by disbursed value with a cumulative share makes the hierarchy clear [daily-metrics:Q1]:

| Status | Loans | Disbursed value | Share | Cumulative |
|---|---|---|---|---|
| active | 134,828 | ₹111.04B | 72.9% | 72.9% |
| closed (matured) | 35,491 | ₹24.66B | 16.2% | 89.1% |
| assigned (sold down) | 12,130 | ₹12.30B | 8.1% | 97.2% |
| prepaid | 4,588 | ₹4.15B | 2.7% | 99.9% |
| npa | 297 | ₹0.15B | 0.1% | 100% |
| written_off | 28 | ₹0.01B | 0% | 100% |

**Assignment (₹12.30B sold down) is the largest deliberate run-off** [daily-metrics:Q1]: a funding/capital lever, not a leak. Prepayment (₹4.15B across 4,588 loans, just 2.7% of the book by value) is the behavioral run-off to watch [daily-metrics:Q1].

### Assignment is concentrated in two PSU banks

Run-off via assignment is concentrated: Bank of Baroda (₹4.94B, 40.2%) and SBI (₹3.35B, 27.2%) together take 67.4% of all assigned principal, each retaining a 10% MRR on long-residual pools [rev-opt:Q4]:

| Buyer | Type | Loans | Assigned | MRR | Share |
|---|---|---|---|---|---|
| Bank of Baroda | bank | 4,551 | ₹4.94B | 10% | 40.2% |
| State Bank of India | bank | 3,034 | ₹3.35B | 10% | 27.2% |
| Asset Reconstruction Co. | arc | 1,517 | ₹1.68B | 0% | 13.7% |
| ICICI Bank | bank | 1,517 | ₹1.65B | 10% | 13.4% |

The lone ARC sale (₹1.68B at 0% MRR) is the signature of a distressed-pool offload versus the performing co-lending economics of the bank buyers [rev-opt:Q4]. Assignment activity itself grew 32.5% to ₹6.62B in 2024 then fell sharply in the partial 2025 year [rev-opt:Q5], a pullback worth flagging since assignment is the largest non-closure run-off lever.

### Prepayment concentrates in home loans

| Product | Total loans | Prepaid | Prepay rate |
|---|---|---|---|
| home_purchase | 52,618 | 1,893 | **3.60%** |
| home_improvement | 12,530 | 274 | 2.19% |
| used_car | 20,711 | 435 | 2.10% |
| micro_housing | 3,168 | 65 | 2.05% |
| used_cv | 33,010 | 673 | 2.04% |
| lap_residential | 15,544 | 313 | 2.01% |
| msme | 20,529 | 369 | 1.80% |

**home_purchase prepays at 3.60%, well above every other product** [cohort-retention:Q1]. This is the classic housing-finance run-off risk: balance-transfer competition on the lowest-yield (14.17%), most-refinanceable product. It is also the single largest AUM pool (₹52.16B), so even a small rise in prepay materially shrinks the book.

### The yield walking out the door

Prepaid home_purchase loans represent ₹2.55B of run-off principal carrying a 14.15% coupon, roughly **₹360.1M of annual interest yield walking out the door**, by far the largest single drain [rev-opt:Q2]:

| Product | Prepaid loans | Principal | Avg rate | Annual yield lost |
|---|---|---|---|---|
| home_purchase | 1,893 | ₹2.55B | 14.15% | **₹360.1M** |
| used_cv | 673 | ₹0.27B | 21.06% | ₹55.9M |
| home_construction | 309 | ₹0.34B | 14.67% | ₹49.2M |
| used_car | 435 | ₹0.23B | 19.57% | ₹44.2M |
| msme | 369 | ₹0.20B | 21.46% | ₹43.9M |

Higher-rate small-ticket products lose less principal but at steeper coupons, so ₹0.27B of prepaid used_cv still bleeds ₹55.9M of annual yield, more than the ₹0.34B home_construction book [rev-opt:Q2].

### Prepayment is channel-led, not score-led

Direct-sales-sourced loans prepay at 3.45%, nearly double the 1.90% to 1.96% on digital, DSA and connector [rev-opt:Q3]. The channel that sources the highest-quality book also loses borrowers fastest. But prepayment is essentially flat across the CIBIL spectrum, 2.36% at the bottom band up to a peak of just 2.60% [cohort-retention:Q3], so there is no balance-transfer skim of the best names. And the prepaid home_purchase cohort is statistically indistinguishable from the rest of the book on CIBIL (741 vs 741), LTV (0.45 vs 0.451) and rate (14.15% vs 14.17%) [user-segmentation:Q2], confirming prepayment here is not adverse selection of the strongest borrowers.

### Run-off follows a clean seasoning curve

By disbursement vintage, run-off rises monotonically with age: 44.45% of the 2022 cohort has already run off versus 10.31% of 2025 [cohort-retention:Q2], a clean seasoning effect driven by scheduled closures and assignments rather than accelerating prepay (which stays in a 2.27% to 2.67% band across vintages).

### New disbursement quality is holding

As monthly disbursement grew +14.9% (Oct-Mar), credit quality did **not** loosen:

| Channel | Loans | Avg CIBIL | Avg LTV | NTC % | GNPA |
|---|---|---|---|---|---|
| direct_sales | 62,662 | 518 | 0.5 | 30.1% | **1.27%** |
| digital | 18,699 | 518 | 0.5 | 30.1% | 1.39% |
| connector | 28,138 | 522 | 0.6 | 29.6% | 1.48% |
| dsa | 77,863 | 517 | 0.6 | 30.2% | **1.51%** |

DSA (the largest channel) is also the worst on quality (1.51% GNPA, 0.6 LTV) [rev-opt:Q1]. Direct-sales and digital are the cleanest (1.27-1.39%) [rev-opt:Q1]. The vintage data confirms the trend: 2025-disbursed loans run *lower* GNPA than 2022-2024 on both books [data-quality:Q1], so growth has not come at the cost of quality.

### Vintage confirms quality is improving, not eroding

| Disb. year | Finserve GNPA | HFC GNPA |
|---|---|---|
| 2022 | 3.44% | 1.01% |
| 2023 | 2.46% | 1.04% |
| 2024 | 1.69% | 1.04% |
| 2025 | 1.36% | 0.94% |

On both books the newest (2025) cohort is the cleanest, and Finserve's GNPA falls by more than half from the 2022 vintage to 2025 [data-quality:Q1]. Quarterly disbursement volume nearly tripled from ₹7.38B (Q2 2022) to ₹18.01B (Q1 2025) while weighted LTV stayed range-bound at 0.50 to 0.57 and the weighted rate plateaued near 17.6% to 17.9% [daily-metrics:Q2], so pricing and leverage discipline held as the book scaled.

### One watch-item: early-stage stress is creeping

Hard GNPA is contained, but early-stage SMA delinquency has climbed steadily across vintages, from 2.20% on the 2022 cohort to 3.73% on 2025, even as NTC mix held flat at ~30% [data-quality:Q2]:

| Vintage | Loans | NTC % | GNPA | SMA % |
|---|---|---|---|---|
| 2022 | 28,816 | 29.7% | 0.86% | 2.20% |
| 2023 | 60,927 | 30.0% | 1.03% | 2.66% |
| 2024 | 75,364 | 30.2% | 1.08% | 3.34% |
| 2025 | 22,255 | 30.2% | 1.02% | **3.73%** |

The newest book looks healthy on hard NPA yet shows more early-bucket stress [data-quality:Q2], a watch-item for whether 2025 quality is truly holding or simply has not seasoned into NPA yet.

### Run-off is geographically uniform

The expected metro balance-transfer effect does not show up. Prepayment is essentially flat by city tier (t30 metros 2.50% vs b30 cities 2.41%) and by state (the top states span just 2.48% to 2.64%, led by Karnataka and Rajasthan) [geographic:Q1][geographic:Q2]. Total run-off is effectively equal across tiers (27.79% vs 27.93%), so run-off is a structural book-wide phenomenon rather than a localized competitive hotspot.

## Key Findings

- **Run-off is 27% of the book by value but prepayment is only 2.7%** [daily-metrics:Q1]: assignment (₹12.30B) and scheduled closure dominate, with assignment concentrated in BoB and SBI (67.4%) [rev-opt:Q4].
- **home_purchase prepays at 3.60%**, ~1.6x every other product, bleeding ~₹360M of annual yield [cohort-retention:Q1][rev-opt:Q2]: the key behavioral run-off risk.
- **Prepayment is channel-led, not score-led**: direct-sales prepays at 3.45% (double other channels) [rev-opt:Q3], but flat across CIBIL bands [cohort-retention:Q3], and prepaid home borrowers look like the rest of the book [user-segmentation:Q2].
- **New disbursement quality is holding**: 2025 vintages are the cleanest on hard GNPA [data-quality:Q1] and LTV/pricing held flat through 3x volume growth [daily-metrics:Q2], though early-stage SMA is creeping up to 3.73% [data-quality:Q2].
- **DSA is the weakest channel** (1.51% GNPA on the largest volume) [rev-opt:Q1]; direct/digital are materially cleaner.

## Recommended Actions

1. **Build a prepayment-retention play for home_purchase**: it bleeds ~₹360M of annual yield [rev-opt:Q2], so flag borrowers approaching reset/balance-transfer windows, concentrating on the direct-sales channel which prepays fastest [rev-opt:Q3], and pre-empt with a rate review.
2. **Re-mix sourcing toward direct/digital**: at 1.27-1.39% GNPA they beat DSA's 1.51% on the same CIBIL band [rev-opt:Q1]; shifting share improves portfolio quality at constant volume.
3. **Watch the rising SMA pipeline on recent vintages**: early-stage delinquency at 3.73% on the 2025 cohort [data-quality:Q2] could season into NPA, so tighten early-bucket collections before it converts.
4. **Decide the assignment posture deliberately**: assignment is the largest non-closure run-off lever and activity fell sharply in 2025 [rev-opt:Q5]; keep selling down seasoned performing pools to free capital ahead of the rising Finserve NPA additions.

\`\`\`sql
-- Disbursement quality by channel vs realized asset quality
SELECT
  l.sourcing_channel,
  COUNT(*)                                                            AS loans,
  ROUND(AVG(l.bureau_score))                                          AS avg_cibil,
  ROUND(AVG(l.ltv_ratio), 1)                                          AS avg_ltv,
  ROUND(100.0 * COUNT(*) FILTER (WHERE l.is_ntc) / COUNT(*), 1)       AS ntc_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE l.stage = 3)
        / COUNT(*) FILTER (WHERE l.loan_status IN ('active','npa')),
        2)                                                            AS gnpa_pct
FROM loans_full l
GROUP BY l.sourcing_channel
ORDER BY gnpa_pct DESC;
\`\`\``,
    followUps: [
      "Which home_purchase borrowers are likely to prepay next?",
      "What yield are we losing to home_purchase prepayment?",
      "How does DSA quality vary by individual partner?",
      "What's the assignment pipeline by buyer?",
    ],
    work: {
      "daily-metrics": {
        queries: [
          {
            sql: "WITH t AS (SELECT loan_status, COUNT(*) loans, ROUND(SUM(disbursed_amount) / 1e9, 2) disb_b FROM loans_full GROUP BY 1) SELECT loan_status, loans, disb_b, ROUND(100.0 * disb_b / SUM(disb_b) OVER (), 1) pct, ROUND(100.0 * SUM(disb_b) OVER (ORDER BY disb_b DESC) / SUM(disb_b) OVER (), 1) cum_pct FROM t ORDER BY disb_b DESC",
            description: "Run-off composition by disbursed value with each status's share and a running cumulative share.",
            rowCount: 6,
            executionTimeMs: 471,
            columns: ["loan_status", "loans", "disb_b", "pct", "cum_pct"],
            data: [
              { loan_status: "active", loans: 134828, disb_b: 111.04, pct: 72.9, cum_pct: 72.9 },
              { loan_status: "closed", loans: 35491, disb_b: 24.66, pct: 16.2, cum_pct: 89.1 },
              { loan_status: "assigned", loans: 12130, disb_b: 12.3, pct: 8.1, cum_pct: 97.2 },
              { loan_status: "prepaid", loans: 4588, disb_b: 4.15, pct: 2.7, cum_pct: 99.9 },
              { loan_status: "npa", loans: 297, disb_b: 0.15, pct: 0.1, cum_pct: 100 },
              { loan_status: "written_off", loans: 28, disb_b: 0.01, pct: 0, cum_pct: 100 },
            ],
          },
          {
            sql: "WITH t AS (SELECT EXTRACT(year FROM month) yr, EXTRACT(quarter FROM month) q, SUM(loan_count) loans, ROUND(SUM(total_amount) / 1e9, 2) disb_b, ROUND(SUM(avg_rate * loan_count) / SUM(loan_count), 2) wavg_rate, ROUND(SUM(avg_ltv * loan_count) / SUM(loan_count), 3) wavg_ltv FROM monthly_disbursements GROUP BY 1,2) SELECT yr, q, loans, disb_b, wavg_rate, ROUND(wavg_rate - LAG(wavg_rate) OVER (ORDER BY yr, q), 2) rate_chg, wavg_ltv FROM t ORDER BY yr DESC, q DESC LIMIT 5",
            description: "Quarterly disbursement quality (weighted rate and LTV) with a LAG-based rate change.",
            rowCount: 5,
            executionTimeMs: 658,
            columns: ["yr", "q", "loans", "disb_b", "wavg_rate", "rate_chg", "wavg_ltv"],
            data: [
              { yr: 2025, q: 1, loans: 22255, disb_b: 18.01, wavg_rate: 17.6, rate_chg: -0.09, wavg_ltv: 0.555 },
              { yr: 2024, q: 4, loans: 20362, disb_b: 16.16, wavg_rate: 17.69, rate_chg: -0.16, wavg_ltv: 0.558 },
              { yr: 2024, q: 3, loans: 18350, disb_b: 14.3, wavg_rate: 17.85, rate_chg: 0, wavg_ltv: 0.565 },
              { yr: 2024, q: 2, loans: 17567, disb_b: 13.69, wavg_rate: 17.85, rate_chg: 0.29, wavg_ltv: 0.565 },
              { yr: 2024, q: 1, loans: 19085, disb_b: 15.41, wavg_rate: 17.56, rate_chg: -0.1, wavg_ltv: 0.553 },
            ],
          },
        ],
        summary:
          "Mapped run-off composition and the disbursement-quality trend. Run-off (closed, assigned, prepaid) is 27% of the book by value with prepay just 2.7%, and weighted LTV (0.50-0.57) and rate (~17.6-17.9%) held flat as quarterly volume nearly tripled.",
      },
      "cohort-retention": {
        queries: [
          {
            sql: "SELECT product_type, COUNT(*) AS total_loans, COUNT(*) FILTER (WHERE loan_status = 'prepaid') AS prepaid, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'prepaid') / COUNT(*), 2) AS prepay_rate FROM loans_full GROUP BY product_type ORDER BY prepay_rate DESC LIMIT 7",
            description: "Prepayment rate by product, to find where behavioral run-off concentrates.",
            rowCount: 7,
            executionTimeMs: 579,
            columns: ["product_type", "total_loans", "prepaid", "prepay_rate"],
            data: [
              { product_type: "home_purchase", total_loans: 52618, prepaid: 1893, prepay_rate: 3.6 },
              { product_type: "home_improvement", total_loans: 12530, prepaid: 274, prepay_rate: 2.19 },
              { product_type: "used_car", total_loans: 20711, prepaid: 435, prepay_rate: 2.1 },
              { product_type: "micro_housing", total_loans: 3168, prepaid: 65, prepay_rate: 2.05 },
              { product_type: "used_cv", total_loans: 33010, prepaid: 673, prepay_rate: 2.04 },
              { product_type: "lap_residential", total_loans: 15544, prepaid: 313, prepay_rate: 2.01 },
              { product_type: "msme", total_loans: 20529, prepaid: 369, prepay_rate: 1.8 },
            ],
          },
          {
            sql: "SELECT EXTRACT(year FROM disbursement_date) vintage, COUNT(*) total, COUNT(*) FILTER (WHERE loan_status = 'prepaid') prepaid, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'prepaid') / COUNT(*), 2) prepay_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status IN ('prepaid','closed','assigned')) / COUNT(*), 2) runoff_pct FROM loans_full GROUP BY 1 ORDER BY 1",
            description: "Prepay and total run-off rate by disbursement vintage (survivorship-aware).",
            rowCount: 4,
            executionTimeMs: 537,
            columns: ["vintage", "total", "prepaid", "prepay_pct", "runoff_pct"],
            data: [
              { vintage: 2022, total: 28816, prepaid: 770, prepay_pct: 2.67, runoff_pct: 44.45 },
              { vintage: 2023, total: 60927, prepaid: 1575, prepay_pct: 2.59, runoff_pct: 36.19 },
              { vintage: 2024, total: 75364, prepaid: 1707, prepay_pct: 2.27, runoff_pct: 19.98 },
              { vintage: 2025, total: 22255, prepaid: 536, prepay_pct: 2.41, runoff_pct: 10.31 },
            ],
          },
          {
            sql: "WITH b AS (SELECT CASE WHEN is_ntc THEN 'ntc_no_score' WHEN bureau_score < 650 THEN '550-649' WHEN bureau_score < 700 THEN '650-699' WHEN bureau_score < 750 THEN '700-749' WHEN bureau_score < 800 THEN '750-799' ELSE '800+' END band, loan_status FROM loans_full) SELECT band, COUNT(*) total, COUNT(*) FILTER (WHERE loan_status = 'prepaid') prepaid, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'prepaid') / COUNT(*), 2) prepay_pct FROM b GROUP BY 1 ORDER BY 1",
            description: "Prepayment rate by CIBIL band, to test for balance-transfer skim of high-score borrowers.",
            rowCount: 6,
            executionTimeMs: 612,
            columns: ["band", "total", "prepaid", "prepay_pct"],
            data: [
              { band: "550-649", total: 8021, prepaid: 189, prepay_pct: 2.36 },
              { band: "650-699", total: 23338, prepaid: 606, prepay_pct: 2.6 },
              { band: "700-749", total: 40685, prepaid: 990, prepay_pct: 2.43 },
              { band: "750-799", total: 37135, prepaid: 939, prepay_pct: 2.53 },
              { band: "800+", total: 21821, prepaid: 528, prepay_pct: 2.42 },
              { band: "ntc_no_score", total: 56362, prepaid: 1336, prepay_pct: 2.37 },
            ],
          },
        ],
        summary:
          "Ranked prepayment by product, traced run-off by vintage, and tested prepay across CIBIL bands. home_purchase prepays at 3.60% (1.6x other products), run-off follows a clean seasoning curve (44.45% at 2022 vs 10.31% at 2025), and prepay is flat across credit scores so there is no skim of the best names.",
      },
      "rev-opt": {
        queries: [
          {
            sql: "SELECT sourcing_channel, COUNT(*) AS loans, ROUND(AVG(bureau_score)) AS avg_cibil, ROUND(AVG(ltv_ratio), 1) AS avg_ltv, ROUND(100.0 * COUNT(*) FILTER (WHERE is_ntc) / COUNT(*), 1) AS ntc_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY sourcing_channel ORDER BY gnpa_pct DESC",
            description: "Disbursement quality by channel (CIBIL, LTV, NTC mix) against realized GNPA.",
            rowCount: 4,
            executionTimeMs: 705,
            columns: ["sourcing_channel", "loans", "avg_cibil", "avg_ltv", "ntc_pct", "gnpa_pct"],
            data: [
              { sourcing_channel: "dsa", loans: 77863, avg_cibil: 517, avg_ltv: 0.6, ntc_pct: 30.2, gnpa_pct: 1.51 },
              { sourcing_channel: "connector", loans: 28138, avg_cibil: 522, avg_ltv: 0.6, ntc_pct: 29.6, gnpa_pct: 1.48 },
              { sourcing_channel: "digital", loans: 18699, avg_cibil: 518, avg_ltv: 0.5, ntc_pct: 30.1, gnpa_pct: 1.39 },
              { sourcing_channel: "direct_sales", loans: 62662, avg_cibil: 518, avg_ltv: 0.5, ntc_pct: 30.1, gnpa_pct: 1.27 },
            ],
          },
          {
            sql: "SELECT product_type, COUNT(*) prepaid_loans, ROUND(SUM(disbursed_amount) / 1e9, 2) disb_b, ROUND(AVG(interest_rate), 2) avg_rate, ROUND(SUM(disbursed_amount * interest_rate / 100) / 1e6, 1) annual_yield_m FROM loans_full WHERE loan_status = 'prepaid' GROUP BY 1 ORDER BY disb_b DESC LIMIT 5",
            description: "Annualized interest yield lost to prepayment by product (principal times coupon).",
            rowCount: 5,
            executionTimeMs: 588,
            columns: ["product_type", "prepaid_loans", "disb_b", "avg_rate", "annual_yield_m"],
            data: [
              { product_type: "home_purchase", prepaid_loans: 1893, disb_b: 2.55, avg_rate: 14.15, annual_yield_m: 360.1 },
              { product_type: "home_construction", prepaid_loans: 309, disb_b: 0.34, avg_rate: 14.67, annual_yield_m: 49.2 },
              { product_type: "used_cv", prepaid_loans: 673, disb_b: 0.27, avg_rate: 21.06, annual_yield_m: 55.9 },
              { product_type: "lap_residential", prepaid_loans: 313, disb_b: 0.24, avg_rate: 17.14, annual_yield_m: 41.1 },
              { product_type: "used_car", prepaid_loans: 435, disb_b: 0.23, avg_rate: 19.57, annual_yield_m: 44.2 },
            ],
          },
          {
            sql: "SELECT sourcing_channel, COUNT(*) total, COUNT(*) FILTER (WHERE loan_status = 'prepaid') prepaid, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'prepaid') / COUNT(*), 2) prepay_pct FROM loans_full GROUP BY 1 ORDER BY prepay_pct DESC",
            description: "Prepayment rate by sourcing channel.",
            rowCount: 4,
            executionTimeMs: 521,
            columns: ["sourcing_channel", "total", "prepaid", "prepay_pct"],
            data: [
              { sourcing_channel: "direct_sales", total: 62662, prepaid: 2164, prepay_pct: 3.45 },
              { sourcing_channel: "digital", total: 18699, prepaid: 367, prepay_pct: 1.96 },
              { sourcing_channel: "dsa", total: 77863, prepaid: 1521, prepay_pct: 1.95 },
              { sourcing_channel: "connector", total: 28138, prepaid: 536, prepay_pct: 1.9 },
            ],
          },
          {
            sql: "WITH t AS (SELECT buyer_type, buyer_name, SUM(loan_count) loans, ROUND(SUM(amount_assigned_cr), 2) cr, ROUND(AVG(mrr_pct), 2) mrr, ROUND(AVG(wtd_avg_residual_maturity_months), 1) resid FROM assignment_summary GROUP BY 1,2) SELECT buyer_type, buyer_name, loans, cr, mrr, resid, ROUND(100.0 * cr / SUM(cr) OVER (), 1) pct_book FROM t ORDER BY cr DESC LIMIT 4",
            description: "Assignment run-off by buyer with each buyer's window share, MRR and residual maturity.",
            rowCount: 4,
            executionTimeMs: 412,
            columns: ["buyer_type", "buyer_name", "loans", "cr", "mrr", "resid", "pct_book"],
            data: [
              { buyer_type: "bank", buyer_name: "Bank of Baroda", loans: 4551, cr: 494.3, mrr: 10, resid: 153, pct_book: 40.2 },
              { buyer_type: "bank", buyer_name: "State Bank of India", loans: 3034, cr: 334.99, mrr: 10, resid: 148, pct_book: 27.2 },
              { buyer_type: "arc", buyer_name: "Asset Reconstruction Company", loans: 1517, cr: 168.15, mrr: 0, resid: 159, pct_book: 13.7 },
              { buyer_type: "bank", buyer_name: "ICICI Bank", loans: 1517, cr: 164.95, mrr: 10, resid: 152, pct_book: 13.4 },
            ],
          },
          {
            sql: "WITH t AS (SELECT EXTRACT(year FROM transaction_date) yr, SUM(loan_count) loans, ROUND(SUM(amount_assigned_cr), 2) cr FROM assignment_summary GROUP BY 1) SELECT yr, loans, cr, ROUND(cr - LAG(cr) OVER (ORDER BY yr), 2) yoy_cr, ROUND(100.0 * (cr - LAG(cr) OVER (ORDER BY yr)) / LAG(cr) OVER (ORDER BY yr), 1) yoy_pct FROM t ORDER BY yr",
            description: "Assignment volume trend by year with a LAG-based year-on-year change.",
            rowCount: 3,
            executionTimeMs: 388,
            columns: ["yr", "loans", "cr", "yoy_cr", "yoy_pct"],
            data: [
              { yr: 2023, loans: 4551, cr: 499.94, yoy_cr: null, yoy_pct: null },
              { yr: 2024, loans: 6068, cr: 662.45, yoy_cr: 162.51, yoy_pct: 32.5 },
              { yr: 2025, loans: 1511, cr: 67.9, yoy_cr: -594.55, yoy_pct: -89.8 },
            ],
          },
        ],
        summary:
          "Compared channel quality, sized the yield lost to prepayment, and detailed assignment run-off. DSA is the weakest channel (1.51% GNPA), prepaid home_purchase bleeds ~₹360M of annual yield, direct-sales prepays fastest at 3.45%, and assignment concentrates in BoB and SBI (67.4%) with activity falling sharply in 2025.",
      },
      "data-quality": {
        queries: [
          {
            sql: "SELECT EXTRACT(year FROM disbursement_date) AS vintage_year, entity, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY vintage_year, entity ORDER BY entity, vintage_year",
            description: "GNPA by disbursement vintage and entity, to test whether newer loans are eroding in quality.",
            rowCount: 8,
            executionTimeMs: 648,
            columns: ["vintage_year", "entity", "gnpa_pct"],
            data: [
              { vintage_year: 2022, entity: "finserve", gnpa_pct: 3.44 },
              { vintage_year: 2023, entity: "finserve", gnpa_pct: 2.46 },
              { vintage_year: 2024, entity: "finserve", gnpa_pct: 1.69 },
              { vintage_year: 2025, entity: "finserve", gnpa_pct: 1.36 },
              { vintage_year: 2022, entity: "hfc", gnpa_pct: 1.01 },
              { vintage_year: 2023, entity: "hfc", gnpa_pct: 1.04 },
              { vintage_year: 2024, entity: "hfc", gnpa_pct: 1.04 },
              { vintage_year: 2025, entity: "hfc", gnpa_pct: 0.94 },
            ],
          },
          {
            sql: "SELECT EXTRACT(year FROM disbursement_date) vintage, COUNT(*) loans, ROUND(100.0 * COUNT(*) FILTER (WHERE is_ntc) / COUNT(*), 1) ntc_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket LIKE 'npa%') / COUNT(*), 2) gnpa_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket LIKE 'sma%') / COUNT(*), 2) sma_pct FROM loans_full GROUP BY 1 ORDER BY 1",
            description: "NTC share, hard GNPA and early-stage SMA delinquency by disbursement vintage.",
            rowCount: 4,
            executionTimeMs: 593,
            columns: ["vintage", "loans", "ntc_pct", "gnpa_pct", "sma_pct"],
            data: [
              { vintage: 2022, loans: 28816, ntc_pct: 29.7, gnpa_pct: 0.86, sma_pct: 2.2 },
              { vintage: 2023, loans: 60927, ntc_pct: 30, gnpa_pct: 1.03, sma_pct: 2.66 },
              { vintage: 2024, loans: 75364, ntc_pct: 30.2, gnpa_pct: 1.08, sma_pct: 3.34 },
              { vintage: 2025, loans: 22255, ntc_pct: 30.2, gnpa_pct: 1.02, sma_pct: 3.73 },
            ],
          },
        ],
        summary:
          "Confirmed hard GNPA is improving by vintage while watching early-stage stress. The 2025 cohort is the cleanest on hard NPA and NTC mix is stable at ~30%, but SMA delinquency climbs from 2.20% (2022) to 3.73% (2025), a watch-item for whether the newest book has simply not seasoned yet.",
      },
      "user-segmentation": {
        queries: [
          {
            sql: "SELECT entity, sourcing_channel, COUNT(*) loans, ROUND(AVG(bureau_score) FILTER (WHERE is_ntc = false), 0) avg_cibil, ROUND(AVG(ltv_ratio), 3) avg_ltv, ROUND(100.0 * COUNT(*) FILTER (WHERE is_ntc) / COUNT(*), 1) ntc_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'npa') / COUNT(*), 2) npa_pct FROM loans_full GROUP BY 1,2 HAVING COUNT(*) > 500 ORDER BY entity, loans DESC",
            description: "Disbursement quality by entity and channel (CIBIL, LTV, NTC), showing the LTV-policy gap between books.",
            rowCount: 8,
            executionTimeMs: 781,
            columns: ["entity", "sourcing_channel", "loans", "avg_cibil", "avg_ltv", "ntc_pct", "npa_pct"],
            data: [
              { entity: "finserve", sourcing_channel: "dsa", loans: 41174, avg_cibil: 741, avg_ltv: 0.68, ntc_pct: 30.2, npa_pct: 0.35 },
              { entity: "finserve", sourcing_channel: "direct_sales", loans: 20706, avg_cibil: 741, avg_ltv: 0.681, ntc_pct: 29.9, npa_pct: 0.27 },
              { entity: "finserve", sourcing_channel: "connector", loans: 12411, avg_cibil: 742, avg_ltv: 0.68, ntc_pct: 29.7, npa_pct: 0.4 },
              { entity: "finserve", sourcing_channel: "digital", loans: 8206, avg_cibil: 742, avg_ltv: 0.678, ntc_pct: 30.1, npa_pct: 0.24 },
              { entity: "hfc", sourcing_channel: "direct_sales", loans: 41956, avg_cibil: 742, avg_ltv: 0.451, ntc_pct: 30.3, npa_pct: 0.03 },
              { entity: "hfc", sourcing_channel: "dsa", loans: 36689, avg_cibil: 741, avg_ltv: 0.451, ntc_pct: 30.2, npa_pct: 0.03 },
              { entity: "hfc", sourcing_channel: "connector", loans: 15727, avg_cibil: 741, avg_ltv: 0.451, ntc_pct: 29.5, npa_pct: 0.02 },
              { entity: "hfc", sourcing_channel: "digital", loans: 10493, avg_cibil: 741, avg_ltv: 0.45, ntc_pct: 30.1, npa_pct: 0.02 },
            ],
          },
          {
            sql: "SELECT CASE WHEN loan_status = 'prepaid' THEN 'prepaid' ELSE 'rest_of_book' END seg, COUNT(*) loans, ROUND(AVG(bureau_score) FILTER (WHERE is_ntc = false), 0) avg_cibil, ROUND(100.0 * COUNT(*) FILTER (WHERE is_ntc) / COUNT(*), 1) ntc_pct, ROUND(AVG(ltv_ratio), 3) avg_ltv, ROUND(AVG(interest_rate), 2) avg_rate FROM loans_full WHERE product_type = 'home_purchase' GROUP BY 1 ORDER BY 1",
            description: "Prepaid home_purchase borrower profile versus the rest of the book, to test for adverse selection.",
            rowCount: 2,
            executionTimeMs: 547,
            columns: ["seg", "loans", "avg_cibil", "ntc_pct", "avg_ltv", "avg_rate"],
            data: [
              { seg: "prepaid", loans: 1893, avg_cibil: 741, ntc_pct: 29.7, avg_ltv: 0.45, avg_rate: 14.15 },
              { seg: "rest_of_book", loans: 50725, avg_cibil: 741, ntc_pct: 30.2, avg_ltv: 0.451, avg_rate: 14.17 },
            ],
          },
        ],
        summary:
          "Cut disbursement quality by entity-channel and profiled who prepays. The HFC-Finserve quality gap is an LTV-policy difference (0.45 vs 0.68), not borrower selection, and prepaid home_purchase borrowers are indistinguishable from the rest of the book on CIBIL, LTV and rate.",
      },
      geographic: {
        queries: [
          {
            sql: "SELECT city_tier, COUNT(*) total, COUNT(*) FILTER (WHERE loan_status = 'prepaid') prepaid, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'prepaid') / COUNT(*), 2) prepay_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status IN ('prepaid','closed','assigned')) / COUNT(*), 2) runoff_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE dpd_bucket LIKE 'npa%') / COUNT(*), 2) gnpa_pct FROM loans_full GROUP BY 1 ORDER BY prepay_pct DESC",
            description: "Prepay, run-off and GNPA by city tier (metro t30 vs beyond-30 b30).",
            rowCount: 2,
            executionTimeMs: 634,
            columns: ["city_tier", "total", "prepaid", "prepay_pct", "runoff_pct", "gnpa_pct"],
            data: [
              { city_tier: "t30", total: 86644, prepaid: 2164, prepay_pct: 2.5, runoff_pct: 27.79, gnpa_pct: 0.98 },
              { city_tier: "b30", total: 100718, prepaid: 2424, prepay_pct: 2.41, runoff_pct: 27.93, gnpa_pct: 1.06 },
            ],
          },
          {
            sql: "WITH t AS (SELECT state, COUNT(*) total, COUNT(*) FILTER (WHERE loan_status = 'prepaid') prepaid, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status = 'prepaid') / COUNT(*), 2) prepay_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE loan_status IN ('prepaid','closed','assigned')) / COUNT(*), 2) runoff_pct FROM loans_full GROUP BY 1 HAVING COUNT(*) > 2000) SELECT state, total, prepaid, prepay_pct, runoff_pct, ROW_NUMBER() OVER (ORDER BY prepay_pct DESC) rnk FROM t ORDER BY prepay_pct DESC LIMIT 5",
            description: "Prepay rate by state (states with 2,000+ loans) ranked with a window ROW_NUMBER.",
            rowCount: 5,
            executionTimeMs: 712,
            columns: ["state", "total", "prepaid", "prepay_pct", "runoff_pct", "rnk"],
            data: [
              { state: "Karnataka", total: 10800, prepaid: 285, prepay_pct: 2.64, runoff_pct: 27.58, rnk: 1 },
              { state: "Rajasthan", total: 23092, prepaid: 597, prepay_pct: 2.59, runoff_pct: 27.64, rnk: 2 },
              { state: "Delhi", total: 4477, prepaid: 114, prepay_pct: 2.55, runoff_pct: 27.12, rnk: 3 },
              { state: "Uttar Pradesh", total: 16055, prepaid: 409, prepay_pct: 2.55, runoff_pct: 27.12, rnk: 4 },
              { state: "Telangana", total: 12313, prepaid: 311, prepay_pct: 2.53, runoff_pct: 28.2, rnk: 5 },
            ],
          },
        ],
        summary:
          "Cut prepayment and run-off geographically. Prepay is essentially uniform by city tier (t30 2.50% vs b30 2.41%) and by state (2.53-2.64% across the top states), so the expected metro balance-transfer effect does not show up and run-off is a structural book-wide phenomenon.",
      },
    },
  }),
];

export const VASTU_HFC_STARTER_CHATS: StarterChat[] = [...normals, ...deeps];
