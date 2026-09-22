import {
  deepResearchThread,
  normalThread,
  type StarterChat,
} from "@/lib/server/starter-chats";

// ── Normal (quick-answer) threads ─────────────────────────────────────

const sipCancellations = normalThread({
  slug: "why-sips-cancelled",
  title: "Why are SIPs getting cancelled?",
  question:
    "Why are SIPs getting cancelled? Give me the reasons and where to focus.",
  answer: `Of **30,802** SIPs ever created, **10,866 (35.3%)** are now cancelled [cohort-retention:Q1]. The reasons split like this [cohort-retention:Q2]:

| Cancellation reason | SIPs | Share |
| --- | ---: | ---: |
| Returns unsatisfactory | 3,844 | 35.4% |
| Financial constraint | 2,935 | 27.0% |
| Goal achieved | 1,755 | 16.2% |
| Switched platform | 1,239 | 11.4% |
| Unknown | 1,093 | 10.1% |

The single biggest driver is **"returns unsatisfactory" (35.4%)** - investors leaving because the fund underperformed their expectation [cohort-retention:Q2]. And it is concentrated in non-curated funds: **3,204 of those 3,844 (83%)** cancellations were SIPs into funds outside FI Select, our hand-picked list [cohort-retention:Q3]. Non-FI Select SIPs cancel at **37.4%** vs **27.5%** for FI Select [cohort-retention:Q4].

**Most of the damage is early.** Nearly half of all cancellations (**5,061 of 10,866, 46.6%**) happen in the first 3 installments, before the SIP has had any real time to compound [cohort-retention:Q5]. That points at expectation-setting and onboarding, not long-run performance. SIP type matters too: plain **"regular" SIPs cancel at 37.6%**, while step-up **"power SIPs" cancel at just 25.2%** [cohort-retention:Q6], a 12-point gap that mirrors the FI Select effect.

"Goal achieved" (16.2%) is healthy churn, not a leak [cohort-retention:Q2]. The real opportunity is steering new SIPs into FI Select and step-up structures, and intercepting the "returns" leavers with an advisor touch in the first quarter, before they hit the early-churn window.`,
  followUps: [
    "How much better do FI Select SIPs retain?",
    "Which cancellation reasons can an advisor call actually save?",
    "Are cancellations seasonal or steady through the year?",
  ],
  primaryAgent: {
    id: "cohort-retention",
    name: "Cohort & Retention Agent",
    icon: "users",
  },
  work: {
    summary:
      "Reviewed the full SIP book: 35.3% of all SIPs are cancelled, with 'returns unsatisfactory' the top reason, 83% of those leavers in non-curated funds, and 46.6% of all cancellations landing in the first 3 installments.",
    queries: [
        {
          sql: "SELECT COUNT(*) AS total_sips,\n       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cancelled') / COUNT(*), 1) AS cancel_rate_pct\nFROM raw_sips;",
          description: "Overall SIP count and cancellation rate",
          rowCount: 1,
          executionTimeMs: 318,
          columns: ["total_sips", "cancelled", "cancel_rate_pct"],
          data: [{ total_sips: 30802, cancelled: 10866, cancel_rate_pct: 35.3 }],
        },
        {
          sql: "SELECT cancellation_reason,\n       COUNT(*) AS sips,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS share_pct\nFROM raw_sips\nWHERE status = 'cancelled'\nGROUP BY cancellation_reason\nORDER BY sips DESC;",
          description: "Cancelled SIPs split by cancellation reason",
          rowCount: 5,
          executionTimeMs: 287,
          columns: ["cancellation_reason", "sips", "share_pct"],
          data: [
            { cancellation_reason: "returns_unsatisfactory", sips: 3844, share_pct: 35.4 },
            { cancellation_reason: "financial_constraint", sips: 2935, share_pct: 27.0 },
            { cancellation_reason: "goal_achieved", sips: 1755, share_pct: 16.2 },
            { cancellation_reason: "switched_platform", sips: 1239, share_pct: 11.4 },
            { cancellation_reason: "unknown", sips: 1093, share_pct: 10.1 },
          ],
        },
        {
          sql: "SELECT f.is_fi_select,\n       COUNT(*) AS returns_cancels\nFROM raw_sips s\nJOIN raw_funds f ON s.fund_id = f.fund_id\nWHERE s.status = 'cancelled'\n  AND s.cancellation_reason = 'returns_unsatisfactory'\nGROUP BY f.is_fi_select;",
          description: "'Returns unsatisfactory' cancellations by curated vs non-curated fund",
          rowCount: 2,
          executionTimeMs: 372,
          columns: ["is_fi_select", "returns_cancels"],
          data: [
            { is_fi_select: false, returns_cancels: 3204 },
            { is_fi_select: true, returns_cancels: 640 },
          ],
        },
        {
          sql: "SELECT f.is_fi_select,\n       COUNT(*) AS sips,\n       COUNT(*) FILTER (WHERE s.status = 'cancelled') AS cancelled,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'cancelled') / COUNT(*), 1) AS cancel_rate_pct\nFROM raw_sips s\nJOIN raw_funds f ON s.fund_id = f.fund_id\nGROUP BY f.is_fi_select;",
          description: "Cancellation rate: FI Select vs non FI Select funds",
          rowCount: 2,
          executionTimeMs: 401,
          columns: ["is_fi_select", "sips", "cancelled", "cancel_rate_pct"],
          data: [
            { is_fi_select: false, sips: 24226, cancelled: 9060, cancel_rate_pct: 37.4 },
            { is_fi_select: true, sips: 6576, cancelled: 1806, cancel_rate_pct: 27.5 },
          ],
        },
        {
          sql: "WITH c AS (\n  SELECT CASE\n           WHEN total_installments_paid <= 3  THEN '0-3 installments'\n           WHEN total_installments_paid <= 6  THEN '4-6 installments'\n           WHEN total_installments_paid <= 12 THEN '7-12 installments'\n           ELSE '13+ installments'\n         END AS tenure_bucket\n  FROM raw_sips\n  WHERE status = 'cancelled'\n)\nSELECT tenure_bucket,\n       COUNT(*) AS cancels,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS share_pct\nFROM c\nGROUP BY tenure_bucket\nORDER BY MIN(CASE tenure_bucket\n               WHEN '0-3 installments' THEN 1\n               WHEN '4-6 installments' THEN 2\n               WHEN '7-12 installments' THEN 3\n               ELSE 4 END);",
          description: "When cancellations happen, by installments paid at cancel time",
          rowCount: 4,
          executionTimeMs: 354,
          columns: ["tenure_bucket", "cancels", "share_pct"],
          data: [
            { tenure_bucket: "0-3 installments", cancels: 5061, share_pct: 46.6 },
            { tenure_bucket: "4-6 installments", cancels: 1641, share_pct: 15.1 },
            { tenure_bucket: "7-12 installments", cancels: 2656, share_pct: 24.4 },
            { tenure_bucket: "13+ installments", cancels: 1508, share_pct: 13.9 },
          ],
        },
        {
          sql: "SELECT sip_type,\n       COUNT(*) AS sips,\n       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cancelled') / COUNT(*), 1) AS cancel_rate_pct\nFROM raw_sips\nGROUP BY sip_type\nORDER BY cancel_rate_pct DESC;",
          description: "Cancellation rate by SIP structure (regular vs step-up)",
          rowCount: 3,
          executionTimeMs: 297,
          columns: ["sip_type", "sips", "cancelled", "cancel_rate_pct"],
          data: [
            { sip_type: "regular", sips: 23951, cancelled: 9012, cancel_rate_pct: 37.6 },
            { sip_type: "super_savings", sips: 2380, cancelled: 726, cancel_rate_pct: 30.5 },
            { sip_type: "power_sip", sips: 4471, cancelled: 1128, cancel_rate_pct: 25.2 },
          ],
        },
    ],
  },
});

const fundCategoryMix = normalThread({
  slug: "fund-category-inflow-mix",
  title: "Which fund categories drive inflow?",
  question: "Which fund categories drive our inflow, and how is the mix shaped?",
  answer: `Successful purchase inflow (SIP + lumpsum + STP) totals **₹3,070.1M (about ₹3.07B)** [rev-opt:Q1]. The mix is equity-led [rev-opt:Q1]:

| Category | Inflow (₹) | Share |
| --- | ---: | ---: |
| Equity | 879.6M | 28.7% |
| ELSS (tax-saving) | 765.3M | 24.9% |
| Debt | 417.3M | 13.6% |
| DAAF | 283.7M | 9.2% |
| Liquid | 238.6M | 7.8% |
| Global | 163.5M | 5.3% |
| Gold | 161.0M | 5.2% |
| Index | 84.7M | 2.8% |
| Hybrid | 76.3M | 2.5% |

Equity-style categories (equity, ELSS, index, global) carry **61.7%** of inflow, in line with the 55-70% norm for Indian SIP books [rev-opt:Q2]. The standout is **ELSS at 24.9%** [rev-opt:Q1] - unusually large because tax-saving SIP creation runs **3.4x heavier in Jan-Mar (1,186/mo)** than the rest of the year (346/mo) [rev-opt:Q3]. That makes Q4 your biggest acquisition window and ELSS your sharpest seasonal hook.

Two more things shape the book. First, the **rail mix**: SIP installments are **54.2% (₹1,664.3M)** of purchase inflow, lumpsum **38.0% (₹1,167.1M)**, and STP just **7.8%** [rev-opt:Q4]. So the recurring SIP rail is the spine, but lumpsum is a large and lumpier contributor (tax-season and bonus-cycle driven). Second, **inflow is moderately concentrated by AMC**: the top 5 of 18 AMCs (HDFC, SBI, Nippon, Kotak, ICICI) carry **55.5%** of inflow, with HDFC and SBI alone at ~12% each [rev-opt:Q5]. That is healthy diversification rather than single-AMC dependence, but it means the largest five manager relationships move the book.`,
  followUps: [
    "How concentrated is inflow across AMCs and schemes?",
    "Is the ELSS tax-season spike growing year over year?",
    "What share of inflow comes from SIPs vs lumpsum?",
  ],
  primaryAgent: {
    id: "rev-opt",
    name: "Revenue Optimization Agent",
    icon: "dollar",
  },
  work: {
    summary:
      "Measured ₹3,070.1M of successful purchase inflow across 9 fund categories. The book is equity-tilted (61.7%), 54.2% comes through the recurring SIP rail, and the top 5 of 18 AMCs carry 55.5% of inflow.",
    queries: [
        {
          sql: "SELECT f.category,\n       ROUND(SUM(t.amount_inr) / 1e6, 1) AS inflow_m,\n       ROUND(100.0 * SUM(t.amount_inr) / SUM(SUM(t.amount_inr)) OVER (), 1) AS share_pct\nFROM raw_transactions t\nJOIN raw_funds f ON t.fund_id = f.fund_id\nWHERE t.status = 'success'\n  AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\nGROUP BY f.category\nORDER BY inflow_m DESC;",
          description: "Purchase inflow and share by fund category",
          rowCount: 9,
          executionTimeMs: 612,
          columns: ["category", "inflow_m", "share_pct"],
          data: [
            { category: "equity", inflow_m: 879.6, share_pct: 28.7 },
            { category: "elss", inflow_m: 765.3, share_pct: 24.9 },
            { category: "debt", inflow_m: 417.3, share_pct: 13.6 },
            { category: "daaf", inflow_m: 283.7, share_pct: 9.2 },
            { category: "liquid", inflow_m: 238.6, share_pct: 7.8 },
            { category: "global", inflow_m: 163.5, share_pct: 5.3 },
            { category: "gold", inflow_m: 161.0, share_pct: 5.2 },
            { category: "index", inflow_m: 84.7, share_pct: 2.8 },
            { category: "hybrid", inflow_m: 76.3, share_pct: 2.5 },
          ],
        },
        {
          sql: "SELECT ROUND(100.0 * SUM(t.amount_inr) FILTER (\n         WHERE f.category IN ('equity', 'elss', 'global', 'index')\n       ) / SUM(t.amount_inr), 1) AS equity_style_pct\nFROM raw_transactions t\nJOIN raw_funds f ON t.fund_id = f.fund_id\nWHERE t.status = 'success'\n  AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase');",
          description: "Equity-style share of total inflow",
          rowCount: 1,
          executionTimeMs: 544,
          columns: ["equity_style_pct"],
          data: [{ equity_style_pct: 61.7 }],
        },
        {
          sql: "WITH season AS (\n  SELECT CASE WHEN EXTRACT(month FROM s.start_date) IN (1, 2, 3)\n              THEN 'jan_mar' ELSE 'rest' END AS window,\n         COUNT(*) AS sips_created,\n         COUNT(DISTINCT EXTRACT(month FROM s.start_date)) AS n_months\n  FROM raw_sips s\n  JOIN raw_funds f ON s.fund_id = f.fund_id\n  WHERE f.category = 'elss'\n  GROUP BY 1\n)\nSELECT window, sips_created, n_months,\n       ROUND(sips_created::DOUBLE / n_months) AS per_month\nFROM season;",
          description: "ELSS SIP creation per month: Jan-Mar vs rest of year",
          rowCount: 2,
          executionTimeMs: 358,
          columns: ["window", "sips_created", "n_months", "per_month"],
          data: [
            { window: "jan_mar", sips_created: 3559, n_months: 3, per_month: 1186 },
            { window: "rest", sips_created: 3113, n_months: 9, per_month: 346 },
          ],
        },
        {
          sql: "SELECT txn_type,\n       COUNT(*) AS txns,\n       ROUND(SUM(amount_inr) / 1e6, 1) AS inflow_m,\n       ROUND(100.0 * SUM(amount_inr) / SUM(SUM(amount_inr)) OVER (), 1) AS share_pct\nFROM raw_transactions\nWHERE status = 'success'\n  AND txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\nGROUP BY txn_type\nORDER BY inflow_m DESC;",
          description: "Inflow split by purchase rail: SIP vs lumpsum vs STP",
          rowCount: 3,
          executionTimeMs: 488,
          columns: ["txn_type", "txns", "inflow_m", "share_pct"],
          data: [
            { txn_type: "sip_installment", txns: 357531, inflow_m: 1664.3, share_pct: 54.2 },
            { txn_type: "lumpsum", txns: 24295, inflow_m: 1167.1, share_pct: 38.0 },
            { txn_type: "stp_purchase", txns: 16111, inflow_m: 238.7, share_pct: 7.8 },
          ],
        },
        {
          sql: "WITH amc AS (\n  SELECT f.amc_name,\n         SUM(t.amount_inr) AS inflow\n  FROM raw_transactions t\n  JOIN raw_funds f ON t.fund_id = f.fund_id\n  WHERE t.status = 'success'\n    AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\n  GROUP BY f.amc_name\n),\ntot AS (SELECT SUM(inflow) AS grand FROM amc)\nSELECT a.amc_name,\n       ROUND(a.inflow / 1e6, 1) AS inflow_m,\n       ROUND(100.0 * a.inflow / tot.grand, 1) AS share_pct,\n       ROUND(100.0 * SUM(a.inflow) OVER (ORDER BY a.inflow DESC) / tot.grand, 1) AS cumulative_pct\nFROM amc a\nCROSS JOIN tot\nORDER BY a.inflow DESC\nLIMIT 5;",
          description: "Top 5 AMCs by inflow with cumulative share (18 AMCs total)",
          rowCount: 5,
          executionTimeMs: 716,
          columns: ["amc_name", "inflow_m", "share_pct", "cumulative_pct"],
          data: [
            { amc_name: "HDFC Mutual Fund", inflow_m: 387.3, share_pct: 12.6, cumulative_pct: 12.6 },
            { amc_name: "SBI Mutual Fund", inflow_m: 373.4, share_pct: 12.2, cumulative_pct: 24.8 },
            { amc_name: "Nippon India", inflow_m: 342.4, share_pct: 11.2, cumulative_pct: 35.9 },
            { amc_name: "Kotak Mahindra", inflow_m: 302.2, share_pct: 9.8, cumulative_pct: 45.8 },
            { amc_name: "ICICI Prudential", inflow_m: 297.5, share_pct: 9.7, cumulative_pct: 55.5 },
          ],
        },
    ],
  },
});

// ── Deep-research threads ─────────────────────────────────────────────

const cohortWorth = deepResearchThread({
  slug: "investor-cohort-worth-most",
  title: "Which investor cohort is worth the most?",
  question:
    "Which investor cohort is worth the most to us? I want to know who to acquire and protect, by lifetime value and retention, not just headcount.",
  report: `## Which investor cohort is worth the most

### Executive summary

The instinct on most platforms is to rank investor cohorts by demographics: income band, age, city tier, or acquisition channel. On this book, those cuts are nearly inert. Average lifetime contribution per SIP lands in a tight **₹51K-₹56K** band across all seven acquisition channels, and the still-active rate barely moves (48.8%-50.5%) [user-segmentation:Q1]. Income band is just as flat: from "< 1 lakh" to "> 25 lakhs" the spread on avg invested is only **₹48.2K to ₹53.9K**, and active rate moves less than 2 points [user-segmentation:Q2]. Risk profile shows the same non-result [user-segmentation:Q3].

**The cohorts that actually separate are behavioral: how the investor set up the SIP, not who they are.** Two setup choices, opting into a step-up and choosing a curated FI Select fund, move both lifetime contribution and retention by double digits. A step-up SIP investor is worth **₹64.2K vs ₹49.8K** for a flat SIP (29% more) and retains **16.7 points better** [cohort-retention:Q1]. FI Select investors show the same shape, **₹61.0K vs ₹49.4K** (+24%) and 13.4 points better retention [rev-opt:Q1]. Crucially, when both levers are combined, step-up is the stronger of the two: a step-up SIP into a non-curated fund (₹64.0K) still out-earns a flat SIP into a curated FI Select fund (₹60.3K) [cohort-retention:Q3]. The worst cohort on the book is the one with neither lever: flat, non-curated, at **₹46.9K and just 43.9% active**.

The practical takeaway is that worth on this platform is *manufactured at setup*, not inherited from the lead. That makes it controllable, and it points the acquisition and lifecycle teams at the same lever.

### Methodology and data note

Cohorts are built on the full SIP book of **30,802 SIPs** [data-quality:Q1]. Lifetime value is proxied by \`total_amount_invested\` (cumulative rupees contributed to date) and retention by the share still in \`active\` status. Behavioral cohorts use \`step_up_pct > 0\` (a step-up SIP, which the product brands "power SIP") and the fund-level \`is_fi_select\` flag for curated funds. The book is clean enough to cohort on: every SIP carries a non-null \`fund_id\`, every cancelled SIP has a reason, and 14.5% of SIPs use a step-up [data-quality:Q1][data-quality:Q2]. Demographic cuts join \`raw_sips\` to \`raw_investors\`; fund cuts join to \`raw_funds\`. All figures are point-in-time on the current book.

### Demographic cohorts barely move (the null result)

| Demographic cut | Spread on avg invested | Spread on active % |
| --- | ---: | ---: |
| Acquisition channel (7) | ₹51.1K - ₹56.4K | 48.8% - 50.5% |
| Income band (5) | ₹48.2K - ₹53.9K | 48.4% - 50.4% |
| Risk profile (3) | ₹51.2K - ₹52.9K | 49.2% - 50.1% |
| City tier (2) | ₹51.8K - ₹51.9K | 49.3% - 49.8% |

Across every demographic cut the per-SIP value band is roughly ₹5K wide on a ₹50K base, and retention varies by under two points [user-segmentation:Q1][user-segmentation:Q2][user-segmentation:Q3]. City tier is the flattest of all: T30 and B30 investors are within ₹130 of each other on lifetime value [geographic:Q1]. The slightly higher numbers for "wealth conversations" and "> 25 lakhs" are real but small, and they do not survive once you control for whether the investor set up a step-up. Demographics are a weak signal here.

### SIP behavior cohort x value x retention

| Cohort | SIPs | Avg invested (₹) | Active % | Avg installments |
| --- | ---: | ---: | ---: | ---: |
| Step-up SIP | 4,471 | **64,239** | **63.9%** | 13.5 |
| FI Select fund | 6,576 | 61,019 | 60.2% | 12.7 |
| Flat SIP | 26,331 | 49,782 | 47.2% | 10.8 |
| Non-FI Select fund | 24,226 | 49,400 | 46.8% | 10.8 |

A **step-up SIP investor is worth ₹64.2K vs ₹49.8K** for a flat SIP, **29% more lifetime contribution**, and retains **16.7 points better** (63.9% vs 47.2% still active) [cohort-retention:Q1]. FI Select investors show the same shape: **₹61.0K vs ₹49.4K (+24%)** and **13.4 points better retention** [rev-opt:Q1]. Both cohorts also pay roughly two more installments before they stop, which is where the extra lifetime rupees come from.

### The 2x2: step-up is the stronger lever

| Setup | SIPs | Avg invested (₹) | Active % |
| --- | ---: | ---: | ---: |
| Step-up + FI Select | 971 | **65,041** | **64.1%** |
| Step-up + non-curated | 3,500 | 64,016 | 63.8% |
| Flat + FI Select | 5,605 | 60,322 | 59.6% |
| Flat + non-curated | 20,726 | 46,932 | 43.9% |

Crossing the two levers makes the hierarchy clear [cohort-retention:Q3]. Step-up dominates: even paired with a non-curated fund it beats a flat SIP into a curated one. And the bottom-left cell, flat plus non-curated, is where two-thirds of the book sits (20,726 SIPs) at the lowest value and the worst retention. That single cell is both the largest population and the biggest opportunity.

### Why the value gap is real, not just selection

| Signal | Step-up / FI Select | Flat / Non-FI Select |
| --- | ---: | ---: |
| Still-active rate | 60-64% | 44-47% |
| Cancel "returns unsatisfactory" | n/a | 83% of those cancels concentrate here |
| Avg installments paid | 12.7-13.5 | 10.8 |
| Median lifetime invested (P50) | ₹34,500 (step-up) | ₹23,000 (flat) |

The flat / non-curated cohort doesn't just contribute less per head, it churns earlier (2 fewer installments on average) and supplies the bulk of "returns unsatisfactory" exits [cohort-retention:Q1][cohort-retention:Q2]. The percentile cut confirms this is not a few whales pulling the average: the **median step-up SIP has invested ₹34.5K vs ₹23.0K for the median flat SIP** (50% higher), and the P90 gap is similar (₹160.5K vs ₹126.5K) [cohort-retention:Q4]. The separation holds through the whole distribution, so it is a structural cohort difference, not an outlier artifact.

### Key findings

1. **Demographics are flat on value.** Channel (₹51K-₹56K), income (₹48K-₹54K), risk profile (₹51K-₹53K), and city tier (₹51.8K-₹51.9K) all sit in a narrow band; acquisition source and geography do not predict worth [user-segmentation:Q1][user-segmentation:Q2][user-segmentation:Q3][geographic:Q1].
2. **Step-up SIP is the single most valuable cohort:** ₹64.2K lifetime contribution, 63.9% retention, 29% more value and the stickiest book on the platform [cohort-retention:Q1].
3. **FI Select (curated) investors** are the second-most valuable: ₹61.0K and 60.2% retention, vs ₹49.4K / 46.8% for non-curated [rev-opt:Q1]. By category, **ELSS SIPs carry the highest lifetime value (₹58.2K, 53.1% active)**, reinforcing that the tax-saving cohort both contributes and retains best [rev-opt:Q2].
4. **Step-up beats curation when they conflict:** a step-up into a non-curated fund (₹64.0K) out-earns a flat SIP into a curated fund (₹60.3K) [cohort-retention:Q3].
5. **The flat, non-curated cohort is the leak:** lowest value (₹46.9K), worst retention (43.9%), two-thirds of the book by count, and 83% of "returns unsatisfactory" cancellations [cohort-retention:Q2][cohort-retention:Q3].
6. **The gap is distributional, not driven by whales:** the median step-up SIP has invested 50% more than the median flat SIP [cohort-retention:Q4].

### Risks and caveats

- \`total_amount_invested\` is cumulative-to-date, so older SIPs naturally show more. Step-up SIPs are not systematically older here (their installment counts are only ~2.7 higher), but a tenure-controlled LTV model would tighten the estimate.
- "Worth" is measured on contribution, not margin. FI Select funds may carry different trailing commission, so per-rupee economics could differ from per-rupee inflow.
- The 971-SIP step-up + FI Select cell is small; treat its 64.1% retention as directional, not precise.
- Causality runs partly the other way: committed investors may self-select into step-ups. The recommendation to default step-up is still sound, but expect the lift on *converted* flat investors to be smaller than the raw cohort gap.

### Recommended actions

1. **Make step-up the default** in SIP setup (with an easy opt-out). It is the highest-LTV, highest-retention behavior and currently only 14.5% of SIPs use it [data-quality:Q2]. Even a partial shift on the 26,331 flat SIPs is the largest single value lever available.
2. **Steer new SIPs into FI Select** at the fund-picker step. A curated default lifts both retention and per-investor value, and the two levers stack additively in the 2x2 [cohort-retention:Q3].
3. **Score acquisition on projected setup behavior, not channel.** A paid-search lead who sets up a step-up FI Select SIP is worth far more than the flat channel-level average suggests, so bid and route on predicted setup, not source [user-segmentation:Q1].
4. **Run a save play on the flat + non-curated cell** (20,726 SIPs) showing early churn signals, before they hit "returns unsatisfactory." This is where both the volume and the leak live.

\`\`\`sql
SELECT
  CASE WHEN s.step_up_pct > 0 THEN 'step_up' ELSE 'flat' END AS sip_cohort,
  f.is_fi_select,
  COUNT(*)                                                   AS sips,
  ROUND(AVG(s.total_amount_invested))                        AS avg_invested,
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active')
        / COUNT(*), 1)                                       AS active_pct,
  ROUND(AVG(s.total_installments_paid), 1)                   AS avg_installments
FROM raw_sips s
JOIN raw_funds f ON s.fund_id = f.fund_id
GROUP BY 1, 2
ORDER BY avg_invested DESC;
\`\`\``,
  followUps: [
    "How many flat SIPs could we convert to step-up?",
    "What does retention look like by SIP tenure quarter?",
    "Does FI Select also drive higher lumpsum top-ups?",
  ],
  work: {
    "data-quality": {
      summary:
        "Confirmed the SIP book is clean enough to cohort on: every SIP has a non-null fund_id, and 14.5% of the 30,802 SIPs carry a step-up.",
      queries: [
        {
          sql: "SELECT COUNT(*) AS total_sips,\n       COUNT(*) FILTER (WHERE fund_id IS NULL) AS null_fund_id,\n       COUNT(*) FILTER (WHERE status = 'cancelled' AND cancellation_reason IS NULL) AS cancelled_missing_reason\nFROM raw_sips;",
          description: "Null-rate audit on SIP join keys and cancellation reasons",
          rowCount: 1,
          executionTimeMs: 274,
          columns: ["total_sips", "null_fund_id", "cancelled_missing_reason"],
          data: [{ total_sips: 30802, null_fund_id: 0, cancelled_missing_reason: 0 }],
        },
        {
          sql: "SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE step_up_pct > 0) / COUNT(*), 1) AS step_up_share_pct\nFROM raw_sips;",
          description: "Share of SIPs that use a step-up",
          rowCount: 1,
          executionTimeMs: 233,
          columns: ["step_up_share_pct"],
          data: [{ step_up_share_pct: 14.5 }],
        },
      ],
    },
    "user-segmentation": {
      summary:
        "No demographic cut separates value: channel (₹51K-₹56K), income band (₹48K-₹54K), and risk profile (₹51K-₹53K) all sit in a narrow band with active rate near 49%-50%.",
      queries: [
        {
          sql: "SELECT i.acquisition_channel,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested_per_sip,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips s\nJOIN raw_investors i ON s.investor_id = i.investor_id\nGROUP BY i.acquisition_channel\nORDER BY avg_invested_per_sip DESC;",
          description: "Avg invested per SIP and active rate by acquisition channel",
          rowCount: 7,
          executionTimeMs: 588,
          columns: ["acquisition_channel", "sips", "avg_invested_per_sip", "active_pct"],
          data: [
            { acquisition_channel: "wealth_conversations", sips: 1262, avg_invested_per_sip: 56418, active_pct: 50.2 },
            { acquisition_channel: "calculator", sips: 1846, avg_invested_per_sip: 52858, active_pct: 50.5 },
            { acquisition_channel: "email", sips: 3187, avg_invested_per_sip: 52266, active_pct: 49.5 },
            { acquisition_channel: "social", sips: 3769, avg_invested_per_sip: 51975, active_pct: 50.4 },
            { acquisition_channel: "paid_search", sips: 6849, avg_invested_per_sip: 51794, active_pct: 48.8 },
            { acquisition_channel: "referral", sips: 5550, avg_invested_per_sip: 51545, active_pct: 49.4 },
            { acquisition_channel: "organic", sips: 8339, avg_invested_per_sip: 51082, active_pct: 49.9 },
          ],
        },
        {
          sql: "SELECT i.annual_income,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips s\nJOIN raw_investors i ON s.investor_id = i.investor_id\nGROUP BY i.annual_income\nORDER BY avg_invested DESC;",
          description: "Avg invested per SIP and active rate by income band",
          rowCount: 5,
          executionTimeMs: 561,
          columns: ["annual_income", "sips", "avg_invested", "active_pct"],
          data: [
            { annual_income: "> 25 lakhs", sips: 3756, avg_invested: 53900, active_pct: 50.4 },
            { annual_income: "5-10 lakhs", sips: 8561, avg_invested: 52728, active_pct: 50.1 },
            { annual_income: "10-25 lakhs", sips: 7699, avg_invested: 52091, active_pct: 49.2 },
            { annual_income: "1-5 lakhs", sips: 9324, avg_invested: 50686, active_pct: 49.4 },
            { annual_income: "< 1 lakh", sips: 1462, avg_invested: 48242, active_pct: 48.4 },
          ],
        },
        {
          sql: "SELECT i.risk_profile,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips s\nJOIN raw_investors i ON s.investor_id = i.investor_id\nGROUP BY i.risk_profile\nORDER BY avg_invested DESC;",
          description: "Avg invested per SIP and active rate by risk profile",
          rowCount: 3,
          executionTimeMs: 503,
          columns: ["risk_profile", "sips", "avg_invested", "active_pct"],
          data: [
            { risk_profile: "conservative", sips: 6838, avg_invested: 52867, active_pct: 49.2 },
            { risk_profile: "moderate", sips: 13674, avg_invested: 51866, active_pct: 49.5 },
            { risk_profile: "aggressive", sips: 10290, avg_invested: 51245, active_pct: 50.1 },
          ],
        },
      ],
    },
    "cohort-retention": {
      summary:
        "Step-up SIPs are worth ₹64.2K at 63.9% active vs ₹49.8K / 47.2% for flat. The 2x2 shows step-up beats curation, the worst cell (flat + non-curated) holds two-thirds of the book, and the gap holds at the median.",
      queries: [
        {
          sql: "SELECT CASE WHEN step_up_pct > 0 THEN 'step_up' ELSE 'flat' END AS sip_cohort,\n       COUNT(*) AS sips,\n       ROUND(AVG(total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'active') / COUNT(*), 1) AS active_pct,\n       ROUND(AVG(total_installments_paid), 1) AS avg_installments\nFROM raw_sips\nGROUP BY 1\nORDER BY avg_invested DESC;",
          description: "Value and retention: step-up vs flat SIPs",
          rowCount: 2,
          executionTimeMs: 341,
          columns: ["sip_cohort", "sips", "avg_invested", "active_pct", "avg_installments"],
          data: [
            { sip_cohort: "step_up", sips: 4471, avg_invested: 64239, active_pct: 63.9, avg_installments: 13.5 },
            { sip_cohort: "flat", sips: 26331, avg_invested: 49782, active_pct: 47.2, avg_installments: 10.8 },
          ],
        },
        {
          sql: "SELECT f.is_fi_select,\n       COUNT(*) AS returns_cancels,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 0) AS share_pct\nFROM raw_sips s\nJOIN raw_funds f ON s.fund_id = f.fund_id\nWHERE s.status = 'cancelled'\n  AND s.cancellation_reason = 'returns_unsatisfactory'\nGROUP BY f.is_fi_select\nORDER BY returns_cancels DESC;",
          description: "'Returns unsatisfactory' exits concentrated in non-curated funds",
          rowCount: 2,
          executionTimeMs: 396,
          columns: ["is_fi_select", "returns_cancels", "share_pct"],
          data: [
            { is_fi_select: false, returns_cancels: 3204, share_pct: 83 },
            { is_fi_select: true, returns_cancels: 640, share_pct: 17 },
          ],
        },
        {
          sql: "SELECT CASE WHEN s.step_up_pct > 0 THEN 'step_up' ELSE 'flat' END AS setup,\n       f.is_fi_select,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips s\nJOIN raw_funds f ON s.fund_id = f.fund_id\nGROUP BY 1, 2\nORDER BY avg_invested DESC;",
          description: "2x2: step-up x curated, crossing the two value levers",
          rowCount: 4,
          executionTimeMs: 458,
          columns: ["setup", "is_fi_select", "sips", "avg_invested", "active_pct"],
          data: [
            { setup: "step_up", is_fi_select: true, sips: 971, avg_invested: 65041, active_pct: 64.1 },
            { setup: "step_up", is_fi_select: false, sips: 3500, avg_invested: 64016, active_pct: 63.8 },
            { setup: "flat", is_fi_select: true, sips: 5605, avg_invested: 60322, active_pct: 59.6 },
            { setup: "flat", is_fi_select: false, sips: 20726, avg_invested: 46932, active_pct: 43.9 },
          ],
        },
        {
          sql: "SELECT CASE WHEN step_up_pct > 0 THEN 'step_up' ELSE 'flat' END AS sip_cohort,\n       ROUND(quantile_cont(total_amount_invested, 0.5)) AS p50_invested,\n       ROUND(quantile_cont(total_amount_invested, 0.9)) AS p90_invested,\n       ROUND(MAX(total_amount_invested)) AS max_invested\nFROM raw_sips\nGROUP BY 1\nORDER BY p50_invested DESC;",
          description: "Lifetime-invested percentiles by cohort (gap is distributional, not whale-driven)",
          rowCount: 2,
          executionTimeMs: 412,
          columns: ["sip_cohort", "p50_invested", "p90_invested", "max_invested"],
          data: [
            { sip_cohort: "step_up", p50_invested: 34500, p90_invested: 160500, max_invested: 1177500 },
            { sip_cohort: "flat", p50_invested: 23000, p90_invested: 126500, max_invested: 1150000 },
          ],
        },
      ],
    },
    "rev-opt": {
      summary:
        "FI Select investors are the second-most valuable cohort (₹61.0K, 60.2% active vs ₹49.4K / 46.8%). By fund category, ELSS SIPs carry the highest lifetime value at ₹58.2K and 53.1% active.",
      queries: [
        {
          sql: "SELECT f.is_fi_select,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct,\n       ROUND(AVG(s.total_installments_paid), 1) AS avg_installments\nFROM raw_sips s\nJOIN raw_funds f ON s.fund_id = f.fund_id\nGROUP BY f.is_fi_select\nORDER BY avg_invested DESC;",
          description: "Value and retention: FI Select vs non FI Select funds",
          rowCount: 2,
          executionTimeMs: 421,
          columns: ["is_fi_select", "sips", "avg_invested", "active_pct", "avg_installments"],
          data: [
            { is_fi_select: true, sips: 6576, avg_invested: 61019, active_pct: 60.2, avg_installments: 12.7 },
            { is_fi_select: false, sips: 24226, avg_invested: 49400, active_pct: 46.8, avg_installments: 10.8 },
          ],
        },
        {
          sql: "SELECT f.category,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips s\nJOIN raw_funds f ON s.fund_id = f.fund_id\nGROUP BY f.category\nHAVING COUNT(*) > 500\nORDER BY avg_invested DESC;",
          description: "Lifetime value and retention by fund category (min 500 SIPs)",
          rowCount: 9,
          executionTimeMs: 547,
          columns: ["category", "sips", "avg_invested", "active_pct"],
          data: [
            { category: "elss", sips: 6672, avg_invested: 58153, active_pct: 53.1 },
            { category: "daaf", sips: 3173, avg_invested: 52720, active_pct: 50.9 },
            { category: "equity", sips: 7853, avg_invested: 51403, active_pct: 50.5 },
            { category: "gold", sips: 1886, avg_invested: 49653, active_pct: 47.1 },
            { category: "liquid", sips: 2741, avg_invested: 49383, active_pct: 46.1 },
            { category: "hybrid", sips: 898, avg_invested: 48999, active_pct: 51.2 },
            { category: "global", sips: 1657, avg_invested: 48719, active_pct: 48.3 },
            { category: "debt", sips: 4920, avg_invested: 48694, active_pct: 46.4 },
            { category: "index", sips: 1002, avg_invested: 45683, active_pct: 46.6 },
          ],
        },
      ],
    },
    "geographic": {
      summary:
        "City tier is inert on value too: T30 and B30 investors average ₹51.9K vs ₹51.8K per SIP with near-identical active rates, reinforcing that geography is not a worth signal.",
      queries: [
        {
          sql: "SELECT i.city_tier,\n       COUNT(*) AS sips,\n       ROUND(AVG(s.total_amount_invested)) AS avg_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips s\nJOIN raw_investors i ON s.investor_id = i.investor_id\nGROUP BY i.city_tier\nORDER BY avg_invested DESC;",
          description: "Avg invested per SIP and active rate by city tier",
          rowCount: 2,
          executionTimeMs: 463,
          columns: ["city_tier", "sips", "avg_invested", "active_pct"],
          data: [
            { city_tier: "t30", sips: 20254, avg_invested: 51924, active_pct: 49.8 },
            { city_tier: "b30", sips: 10548, avg_invested: 51797, active_pct: 49.3 },
          ],
        },
      ],
    },
  },
});

const funnelLeak = deepResearchThread({
  slug: "activation-funnel-leak",
  title: "Where does our activation funnel leak?",
  question:
    "Where does our signup-to-first-investment funnel leak, and is it onboarding paperwork or something else?",
  report: `## Where the activation funnel leaks

### Executive summary

Across **15,000 tracked signups**, **67.1% activate** (reach a first investment) [daily-metrics:Q1]. The common worry is that onboarding paperwork (PAN, KYC, FATCA) is bleeding users. The data says the opposite: paperwork clears cleanly at **94.9%+**, and the leak is concentrated in two specific, fixable steps that sit *around and after* verification, not inside it.

The two real holes are **bank verification (-12.4%, ~1,860 investors)** and **first investment (-14.5%, ~2,190 investors)** [daily-metrics:Q1]. The second is the more important one because it happens *after* a fully activated account: roughly 2,190 people complete KYC, link a bank, get an active account, and then never place a single SIP or lumpsum. That is not a compliance problem, it is an activation-and-nudge problem. Confirming the same shape from the investor table, **6,021 of 38,371 activated accounts (15.7%) have an activated date but no first-investment date** [daily-metrics:Q2], a standing pool of "ready but idle" users.

Two cuts tell us this is a product problem, not an acquisition-mix problem. Activation varies only **66.1% to 69.5% across all seven channels** [user-segmentation:Q1] and only **67.0% vs 67.3% across city tiers** [geographic:Q1], both far too tight to explain the leak. And when we look at *where inside the SIP-setup flow* people abandon, one step dominates: **mandate authorization accounts for 34.6% of all in-flow drops**, ahead of amount entry (23.4%) and date selection (19.1%) [cohort-retention:Q1]. The friction is the bank mandate, both as a verification step and as the final hurdle before money moves.

### Funnel (all signups)

| Step | Investors | % of signups | Step drop |
| --- | ---: | ---: | ---: |
| Signups | 15,000 | 100% | - |
| PAN confirmed | 15,000 | 100% | 0 |
| KYC submitted | 15,000 | 100% | 0 |
| KYC verified | 14,231 | 94.9% | -5.1% |
| Bank verified | 12,369 | 82.5% | **-12.4%** |
| Account activated | 12,259 | 81.7% | -0.7% |
| First investment | 10,067 | 67.1% | **-14.5%** |

Two steps carry almost the entire leak [daily-metrics:Q1]:

- **Bank verification (-12.4%):** ~1,860 investors finish KYC but never link a bank. This is the largest single onboarding drop [daily-metrics:Q1].
- **First investment (-14.5%):** ~2,190 investors fully activate (KYC + bank done) and still never place a first SIP or lumpsum. This is the biggest leak overall and it sits *after* all paperwork [daily-metrics:Q1].

### Methodology and data note

The step funnel sums the \`investor_funnel\` aggregate table, which is complete: **336 channel-by-tier-by-cohort rows, zero null signup counts, 7 channels, and 2 city tiers** [data-quality:Q1]. As a sanity check on the "paperwork is fine" claim, KYC verified rates are flat at **86.4%-86.6% across DigiLocker, Aadhaar OTP, and physical methods** [data-quality:Q2], so verification method is not a hidden bottleneck. The "activated but never invested" pool is cross-checked directly against \`raw_investors\` date columns [daily-metrics:Q2]. The in-flow abandonment cut comes from \`raw_user_events\`, restricted to rows that carry both a \`step_name\` and a \`drop_reason\` so each drop is attributed to a real step [cohort-retention:Q1]. Channel and tier activation cuts also come off \`investor_funnel\` so the denominators reconcile to the same 15,000 signups. We also confirmed activation is stable over time: signup-cohort activation holds in a **64.2%-70.2% band from Jul 2025 through May 2026** with no recent regression [user-segmentation:Q2], and bank-link verified rates are near-identical across auto-detect (73.3%) and manual entry (72.3%) [geographic:Q2].

### Activation by acquisition channel

| Channel | Signups | Bank verified | First invested | Activation % |
| --- | ---: | ---: | ---: | ---: |
| Wealth conversations | 623 | 524 | 433 | **69.5%** |
| Calculator | 894 | 735 | 614 | 68.7% |
| Paid search | 3,325 | 2,755 | 2,249 | 67.6% |
| Referral | 2,705 | 2,240 | 1,822 | 67.4% |
| Email | 1,493 | 1,224 | 999 | 66.9% |
| Social | 1,844 | 1,520 | 1,229 | 66.6% |
| Organic | 4,116 | 3,371 | 2,721 | 66.1% |

(by acquisition channel [user-segmentation:Q1])

### Activation by city tier

| City tier | Signups | KYC verified | Bank verified | First invested | Activation % |
| --- | ---: | ---: | ---: | ---: | ---: |
| B30 (smaller cities) | 5,043 | 4,778 | 4,161 | 3,393 | 67.3% |
| T30 (top 30 cities) | 9,957 | 9,453 | 8,208 | 6,674 | 67.0% |

Tier is essentially flat, with the same bank-verification drop in both (B30 loses ~12% at bank-link, T30 ~13%) [geographic:Q1]. Smaller-city investors are not the weak link here, which rules out a geographic or trust explanation for the leak.

### Where inside the SIP-setup flow people abandon

| Abandon step | Drops | Share of in-flow drops |
| --- | ---: | ---: |
| Mandate authorization | 4,147 | **34.6%** |
| Amount entered | 2,808 | 23.4% |
| Date selected | 2,286 | 19.1% |
| KYC required | 1,352 | 11.3% |
| Bank verification | 848 | 7.1% |
| KYC | 536 | 4.5% |

Mandate authorization is the single biggest abandon point inside the SIP-setup flow [cohort-retention:Q1]. Combined with the bank-verification step, **bank/mandate friction explains over 40% of in-flow drops**. The recorded reasons at the mandate step break down as **distracted (35.3%), bank_issue (27.8%), not_sure (22.0%), and technical_error (14.9%)** [cohort-retention:Q2], a roughly even mix of UX drop-off and genuine bank-rail failures, exactly the kind of step that a fallback flow and a same-session retry can recover.

### Key findings

1. **Paperwork is healthy.** PAN, KYC submission, and KYC verification clear at 94.9%+. The "I can't get verified" story is not the problem [daily-metrics:Q1].
2. **The two real leaks are bank-link and first-investment** - together ~4,050 investors lost, and the larger of the two (first investment) happens *after* a fully activated account [daily-metrics:Q1].
3. **A standing pool of 6,021 activated-but-idle accounts** (15.7% of activated) confirms the post-activation leak from a second data source [daily-metrics:Q2].
4. **Channel spread is tight (66.1%-69.5%)** and tier spread tighter still (67.0% vs 67.3%), so this is a product/lifecycle problem, not an acquisition-mix or geographic one [user-segmentation:Q1][geographic:Q1].
5. **Mandate authorization is the #1 in-flow abandon step (34.6%)**; bank/mandate friction explains over 40% of SIP-setup drops [cohort-retention:Q1].
6. **Intent-led channels lead slightly:** wealth conversations and calculator (people who came to plan) activate ~3 points higher than organic [user-segmentation:Q1].

### Risks and caveats

- The 15,000-signup funnel is a tracked cohort, not the full 50,000-investor base; treat the rates as representative of recent acquisition, not the entire historical book.
- Step drops are net (signup-to-step), so "step drop" percentages assume no re-entry; a small number of users likely complete a step in a later session, which would slightly understate true completion.
- "Activated but never invested" includes very recent activations that may simply not have invested *yet*; a tenure filter (e.g. activated 30+ days ago) would size the genuinely stuck pool more precisely.

### Recommended actions

1. **Fix the bank-link and mandate steps together** - the single largest onboarding drop plus the #1 in-flow abandon point. Audit AA / penny-drop / mandate failures and add a fallback flow plus a same-session retry for the ~1,860 who stall at bank-link and the 4,147 who drop at mandate authorization.
2. **Build a first-investment nudge** for the ~2,190 fully-activated-never-invested segment (and the broader 6,021 idle-activated pool) - a one-tap "start your first SIP" with a pre-filled FI Select default.
3. **Lead acquisition with intent surfaces** (calculator, wealth conversations) since they convert highest, rather than chasing cheaper organic volume.
4. **Do not over-invest in tier-specific onboarding** - B30 and T30 activate within 0.3 points, so a single product fix serves both.

\`\`\`sql
SELECT
  acquisition_channel,
  SUM(signups)                                          AS signups,
  SUM(kyc_verified)                                     AS kyc_verified,
  SUM(bank_verified)                                    AS bank_verified,
  SUM(account_activated)                                AS activated,
  SUM(first_invested)                                   AS first_invested,
  ROUND(100.0 * SUM(first_invested) / SUM(signups), 1)  AS activation_pct
FROM investor_funnel
GROUP BY acquisition_channel
ORDER BY activation_pct DESC;
\`\`\``,
  followUps: [
    "How long do the never-invested-but-activated accounts sit idle?",
    "Does the bank-link drop differ by bank or link method?",
    "What's the activation gap by city tier?",
  ],
  work: {
    "data-quality": {
      summary:
        "The funnel table is complete: 336 channel-by-cohort rows, zero null signup counts, and 7 acquisition channels, so step-level drop-offs can be trusted.",
      queries: [
        {
          sql: "SELECT COUNT(*) AS rows_in_table,\n       COUNT(*) FILTER (WHERE signups IS NULL) AS null_signups,\n       COUNT(DISTINCT acquisition_channel) AS channels\nFROM investor_funnel;",
          description: "Completeness check on the funnel aggregate table",
          rowCount: 1,
          executionTimeMs: 211,
          columns: ["rows_in_table", "null_signups", "channels"],
          data: [{ rows_in_table: 336, null_signups: 0, channels: 7 }],
        },
        {
          sql: "SELECT kyc_method,\n       COUNT(*) AS investors,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE kyc_status = 'verified') / COUNT(*), 1) AS verified_pct\nFROM raw_investors\nGROUP BY kyc_method\nORDER BY investors DESC;",
          description: "KYC verified rate by method (paperwork is not the bottleneck)",
          rowCount: 3,
          executionTimeMs: 287,
          columns: ["kyc_method", "investors", "verified_pct"],
          data: [
            { kyc_method: "digilocker", investors: 36252, verified_pct: 86.5 },
            { kyc_method: "aadhaar_otp", investors: 8934, verified_pct: 86.4 },
            { kyc_method: "physical", investors: 4814, verified_pct: 86.6 },
          ],
        },
      ],
    },
    "daily-metrics": {
      summary:
        "Of 15,000 signups, 67.1% reach a first investment. Paperwork clears at 94.9%+, but bank-link (-12.4%) and first-investment (-14.5%) carry almost the entire leak; 6,021 activated accounts have never invested.",
      queries: [
        {
          sql: "SELECT SUM(signups) AS signups,\n       SUM(pan_confirmed) AS pan_confirmed,\n       SUM(kyc_submitted) AS kyc_submitted,\n       SUM(kyc_verified) AS kyc_verified,\n       SUM(bank_verified) AS bank_verified,\n       SUM(account_activated) AS account_activated,\n       SUM(first_invested) AS first_invested,\n       ROUND(100.0 * SUM(first_invested) / SUM(signups), 1) AS activation_pct\nFROM investor_funnel;",
          description: "Signup-to-first-investment funnel, all steps",
          rowCount: 1,
          executionTimeMs: 296,
          columns: [
            "signups",
            "pan_confirmed",
            "kyc_submitted",
            "kyc_verified",
            "bank_verified",
            "account_activated",
            "first_invested",
            "activation_pct",
          ],
          data: [
            {
              signups: 15000,
              pan_confirmed: 15000,
              kyc_submitted: 15000,
              kyc_verified: 14231,
              bank_verified: 12369,
              account_activated: 12259,
              first_invested: 10067,
              activation_pct: 67.1,
            },
          ],
        },
        {
          sql: "SELECT COUNT(*) FILTER (WHERE account_activated_date IS NOT NULL) AS activated,\n       COUNT(*) FILTER (WHERE account_activated_date IS NOT NULL\n                          AND first_investment_date IS NULL) AS activated_never_invested,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE account_activated_date IS NOT NULL\n                                       AND first_investment_date IS NULL)\n             / COUNT(*) FILTER (WHERE account_activated_date IS NOT NULL), 1) AS idle_pct\nFROM raw_investors;",
          description: "Activated-but-never-invested pool, cross-checked against raw_investors",
          rowCount: 1,
          executionTimeMs: 264,
          columns: ["activated", "activated_never_invested", "idle_pct"],
          data: [{ activated: 38371, activated_never_invested: 6021, idle_pct: 15.7 }],
        },
      ],
    },
    "user-segmentation": {
      summary:
        "Activation barely varies by acquisition channel (66.1%-69.5%). Intent-led surfaces (wealth conversations, calculator) lead organic by ~3 points, confirming this is a product, not acquisition-mix, problem.",
      queries: [
        {
          sql: "SELECT acquisition_channel,\n       SUM(signups) AS signups,\n       SUM(bank_verified) AS bank_verified,\n       SUM(first_invested) AS first_invested,\n       ROUND(100.0 * SUM(first_invested) / SUM(signups), 1) AS activation_pct\nFROM investor_funnel\nGROUP BY acquisition_channel\nORDER BY activation_pct DESC;",
          description: "Activation rate by acquisition channel",
          rowCount: 7,
          executionTimeMs: 437,
          columns: ["acquisition_channel", "signups", "bank_verified", "first_invested", "activation_pct"],
          data: [
            { acquisition_channel: "wealth_conversations", signups: 623, bank_verified: 524, first_invested: 433, activation_pct: 69.5 },
            { acquisition_channel: "calculator", signups: 894, bank_verified: 735, first_invested: 614, activation_pct: 68.7 },
            { acquisition_channel: "paid_search", signups: 3325, bank_verified: 2755, first_invested: 2249, activation_pct: 67.6 },
            { acquisition_channel: "referral", signups: 2705, bank_verified: 2240, first_invested: 1822, activation_pct: 67.4 },
            { acquisition_channel: "email", signups: 1493, bank_verified: 1224, first_invested: 999, activation_pct: 66.9 },
            { acquisition_channel: "social", signups: 1844, bank_verified: 1520, first_invested: 1229, activation_pct: 66.6 },
            { acquisition_channel: "organic", signups: 4116, bank_verified: 3371, first_invested: 2721, activation_pct: 66.1 },
          ],
        },
        {
          sql: "SELECT STRFTIME(DATE_TRUNC('month', cohort_month), '%b %Y') AS cohort,\n       SUM(signups) AS signups,\n       ROUND(100.0 * SUM(first_invested) / SUM(signups), 1) AS activation_pct\nFROM investor_funnel\nWHERE cohort_month >= DATE '2025-07-01'\nGROUP BY DATE_TRUNC('month', cohort_month)\nORDER BY DATE_TRUNC('month', cohort_month);",
          description: "Activation rate by signup cohort month (stable, no recent regression)",
          rowCount: 11,
          executionTimeMs: 471,
          columns: ["cohort", "signups", "activation_pct"],
          data: [
            { cohort: "Jul 2025", signups: 534, activation_pct: 67.6 },
            { cohort: "Aug 2025", signups: 534, activation_pct: 68.7 },
            { cohort: "Sep 2025", signups: 534, activation_pct: 65.2 },
            { cohort: "Oct 2025", signups: 534, activation_pct: 67.0 },
            { cohort: "Nov 2025", signups: 454, activation_pct: 68.5 },
            { cohort: "Dec 2025", signups: 534, activation_pct: 64.2 },
            { cohort: "Jan 2026", signups: 914, activation_pct: 70.2 },
            { cohort: "Feb 2026", signups: 1097, activation_pct: 66.9 },
            { cohort: "Mar 2026", signups: 975, activation_pct: 68.0 },
            { cohort: "Apr 2026", signups: 609, activation_pct: 66.8 },
            { cohort: "May 2026", signups: 609, activation_pct: 68.5 },
          ],
        },
      ],
    },
    "geographic": {
      summary:
        "Activation is flat across city tiers: B30 67.3% vs T30 67.0%, with the same ~12-13 point bank-verification drop in both, ruling out a geographic explanation for the leak.",
      queries: [
        {
          sql: "SELECT city_tier,\n       SUM(signups) AS signups,\n       SUM(kyc_verified) AS kyc_verified,\n       SUM(bank_verified) AS bank_verified,\n       SUM(first_invested) AS first_invested,\n       ROUND(100.0 * SUM(first_invested) / SUM(signups), 1) AS activation_pct\nFROM investor_funnel\nGROUP BY city_tier\nORDER BY activation_pct DESC;",
          description: "Activation funnel by city tier (T30 vs B30)",
          rowCount: 2,
          executionTimeMs: 388,
          columns: ["city_tier", "signups", "kyc_verified", "bank_verified", "first_invested", "activation_pct"],
          data: [
            { city_tier: "b30", signups: 5043, kyc_verified: 4778, bank_verified: 4161, first_invested: 3393, activation_pct: 67.3 },
            { city_tier: "t30", signups: 9957, kyc_verified: 9453, bank_verified: 8208, first_invested: 6674, activation_pct: 67.0 },
          ],
        },
        {
          sql: "SELECT bank_link_method,\n       COUNT(*) AS investors,\n       COUNT(*) FILTER (WHERE bank_link_status = 'verified') AS verified,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE bank_link_status = 'verified') / COUNT(*), 1) AS verified_pct\nFROM raw_investors\nGROUP BY bank_link_method\nORDER BY investors DESC;",
          description: "Bank-link verified rate by method (auto-detect vs manual entry)",
          rowCount: 2,
          executionTimeMs: 312,
          columns: ["bank_link_method", "investors", "verified", "verified_pct"],
          data: [
            { bank_link_method: "upi_auto_detect", investors: 37902, verified: 27782, verified_pct: 73.3 },
            { bank_link_method: "manual_entry", investors: 12098, verified: 8745, verified_pct: 72.3 },
          ],
        },
      ],
    },
    "cohort-retention": {
      summary:
        "Inside the SIP-setup flow, mandate authorization is the #1 abandon step (34.6% of in-flow drops); combined with bank verification, bank/mandate friction explains over 40% of drops. Mandate drops split distracted / bank_issue / not_sure.",
      queries: [
        {
          sql: "SELECT step_name,\n       COUNT(*) AS drops,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS share_pct\nFROM raw_user_events\nWHERE drop_reason IS NOT NULL\n  AND step_name IS NOT NULL\nGROUP BY step_name\nORDER BY drops DESC;",
          description: "SIP-setup flow abandonment by step (events with a recorded drop reason)",
          rowCount: 6,
          executionTimeMs: 612,
          columns: ["step_name", "drops", "share_pct"],
          data: [
            { step_name: "mandate_authorization", drops: 4147, share_pct: 34.6 },
            { step_name: "amount_entered", drops: 2808, share_pct: 23.4 },
            { step_name: "date_selected", drops: 2286, share_pct: 19.1 },
            { step_name: "kyc_required", drops: 1352, share_pct: 11.3 },
            { step_name: "bank_verification", drops: 848, share_pct: 7.1 },
            { step_name: "kyc", drops: 536, share_pct: 4.5 },
          ],
        },
        {
          sql: "SELECT drop_reason,\n       COUNT(*) AS drops,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS share_pct\nFROM raw_user_events\nWHERE step_name = 'mandate_authorization'\n  AND drop_reason IS NOT NULL\nGROUP BY drop_reason\nORDER BY drops DESC;",
          description: "Why investors abandon at the mandate-authorization step",
          rowCount: 4,
          executionTimeMs: 423,
          columns: ["drop_reason", "drops", "share_pct"],
          data: [
            { drop_reason: "distracted", drops: 1464, share_pct: 35.3 },
            { drop_reason: "bank_issue", drops: 1153, share_pct: 27.8 },
            { drop_reason: "not_sure", drops: 912, share_pct: 22.0 },
            { drop_reason: "technical_error", drops: 618, share_pct: 14.9 },
          ],
        },
      ],
    },
  },
});

const nachVsUpi = deepResearchThread({
  slug: "nach-vs-upi-sip-failure",
  title: "Is NACH quietly killing our SIP book?",
  question:
    "Is our NACH mandate quietly killing the SIP book? Compare installment failure rates by payment mode and tell me what it costs us.",
  report: `## NACH vs UPI: hidden involuntary SIP churn

### Executive summary

Yes, NACH is the weak link. Across **370,937** SIP installment attempts, the failure rate on NACH mandates is **6.32%, which is 3.4x the 1.87% rate on UPI autopay** and the near-identical 1.92% on netbanking [daily-metrics:Q1]. Because UPI and netbanking land on the same clean ~1.9% baseline, the problem is specific to the NACH rail itself, not to autopay as a concept. Every failed installment is an involuntary miss: a dunning event, a possible cancellation trigger, and lost compounding on a contribution that should have cleared.

The cost is concentrated and recoverable. NACH is only **28% of installment attempts but 56% of all 11,534 failed installments** [daily-metrics:Q1]. Holding NACH to the UPI baseline would have cleared roughly **4,571 of its 6,487 failures** [daily-metrics:Q2], so the bulk of NACH failure is "excess," not unavoidable. The gap is also persistent, not a one-off: across the last four quarters the NACH-to-UPI fail-rate gap has stayed in a **4.35 to 5.07 point band**, even widening to 5.07 points in Q1 2026 [daily-metrics:Q3]. This is a structural rail problem that compounds quarter after quarter.

The migration target is well-defined. **8,575 SIPs (28% of the 30,802-SIP book) still run on NACH** [cohort-retention:Q1], and their headline retention is about the same as UPI today (48.9% vs 49.9% active), which makes them a clean, low-risk population to move *before* a failed installment triggers a cancellation. Ticket size is not a blocker: NACH and UPI SIPs have essentially the same median (₹3,000) and average ticket (₹4,377 vs ₹4,521) [rev-opt:Q1], so very few NACH SIPs are too large for the UPI autopay cap. The target is also geographically even, NACH is 28.2% of SIPs in B30 cities and 27.6% in T30 [geographic:Q1], so a single migration campaign serves the whole book rather than a region.

### Installment failure by payment mode

| Payment mode | Installments | Failed | Fail rate |
| --- | ---: | ---: | ---: |
| NACH | 102,633 | 6,487 | **6.32%** |
| UPI autopay | 201,135 | 3,754 | 1.87% |
| Netbanking | 67,169 | 1,293 | 1.92% |

NACH alone accounts for **6,487 of 11,534 failed installments (56%)** despite being only **28%** of attempts [daily-metrics:Q1]. UPI and netbanking sit near 1.9%, the clean baseline. The **4.45-point gap** between NACH and UPI is pure recoverable churn risk.

### Methodology and data note

Failure rates are computed on \`raw_transactions\` filtered to \`txn_type = 'sip_installment'\`, of which there are **370,937 of 462,517 transactions** [data-quality:Q1]; status is a clean three-state field (**96.39% success, 3.11% failed, 0.50% pending**), so per-mode splits are reliable [data-quality:Q2]. Mode comparisons use the \`payment_mode\` column; the bank-level cut joins to \`raw_investors.bank_name\`. The quarterly trend uses \`date_trunc('quarter', txn_date)\` from Jul 2025 onward, and "excess failures" are computed as NACH failures minus what the UPI baseline rate would have produced on the same volume. Ticket-size comparisons use \`quantile_cont\` for the median.

### Failure trend by quarter (the gap is persistent)

| Quarter | NACH fail % | UPI fail % | Gap (pts) |
| --- | ---: | ---: | ---: |
| 2025-Q3 | 6.53% | 2.12% | 4.41 |
| 2025-Q4 | 6.52% | 1.73% | 4.79 |
| 2026-Q1 | 6.89% | 1.82% | 5.07 |
| 2026-Q2 | 6.22% | 1.87% | 4.35 |

NACH sits in a 6.2%-6.9% band every quarter while UPI never leaves ~1.7%-2.1% [daily-metrics:Q3]. There is no sign of NACH self-correcting, which is why a migration is the right lever rather than waiting for the rail to improve.

### NACH failure by bank (failures cluster, but everywhere)

| Rank | Bank | NACH installments | Failed | Fail rate |
| --- | --- | ---: | ---: | ---: |
| 1 | Axis Bank | 12,408 | 833 | **6.71%** |
| 1 | PNB | 3,846 | 258 | **6.71%** |
| 3 | Yes Bank | 3,881 | 249 | 6.42% |
| 4 | HDFC Bank | 26,520 | 1,700 | 6.41% |
| 5 | Kotak Bank | 8,059 | 501 | 6.22% |
| 6 | ICICI Bank | 18,475 | 1,147 | 6.21% |

Axis and PNB top the table at 6.71%, but the striking thing is how *tight* the band is: every major bank sits between 6.2% and 6.7% on NACH [user-segmentation:Q1]. This is not one bad bank dragging the average, it is the NACH rail underperforming uniformly, which again argues for moving off the rail rather than renegotiating one sponsor-bank relationship.

### Mandate mix on active SIPs

| Mandate type | SIPs | Still active | Active % |
| --- | ---: | ---: | ---: |
| UPI autopay | 22,227 | 11,091 | 49.9% |
| NACH | 8,575 | 4,196 | 48.9% |

NACH still carries **8,575 SIPs (28% of the book)** on the higher-failure rail [cohort-retention:Q1]. Those mandates retain about the same headline rate today (NACH cancels at 35.5% vs UPI 35.2%, essentially identical) [cohort-retention:Q2], but each NACH SIP is structurally more exposed to a failed-installment cancellation event. The risk is latent, not yet visible in headline cancel rates, which is exactly why migrating now is cheaper than waiting for the failures to convert into churn.

### What it costs

At a 6.32% NACH fail rate vs a 1.87% UPI baseline, roughly **4,571 of the 6,487 NACH failures are "excess"** - installments that would likely have cleared on UPI [daily-metrics:Q2]. Each excess failure is a dunning event, a possible cancellation trigger, and lost compounding on a missed contribution. On the median ₹3,000 ticket, that is millions of rupees of inflow per cycle bouncing for rail reasons alone.

### Key findings

1. **NACH fails at 6.32%, 3.4x UPI's 1.87%.** Netbanking matches UPI, so the problem is specifically the NACH rail, not autopay in general [daily-metrics:Q1].
2. **NACH is 28% of attempts but 56% of all failed installments**, wildly over-represented in failures [daily-metrics:Q1].
3. **The gap is persistent (4.35-5.07 points every quarter)** and is not self-correcting [daily-metrics:Q3].
4. **Failures are uniform across banks (6.2%-6.7%)**, so it is a rail problem, not a single-sponsor problem [user-segmentation:Q1].
5. **8,575 SIPs (28% of the book) still sit on NACH**, a migratable population at the same median ticket as UPI [cohort-retention:Q1][rev-opt:Q1].
6. **~4,571 excess failures** are attributable to the NACH-vs-UPI gap, recoverable involuntary churn [daily-metrics:Q2].

### Risks and caveats

- Some NACH usage is structural (UPI autopay has a per-mandate cap, currently around ₹100K per debit). The median NACH ticket of ₹3,000 is far under any cap, so the migratable share is large, but a small high-ticket tail may have to stay on NACH [rev-opt:Q1].
- The failure-to-cancellation link is inferred, not directly traced here; a follow-up should measure how many cancellations occur within N days of a failed installment to size the true churn cost.
- Bank-level rates use the investor's primary bank, which is a close but not perfect proxy for the actual debit account on each mandate.

### Recommended actions

1. **Run a NACH-to-UPI autopay migration campaign** on the 8,575 NACH SIPs (excluding the small high-ticket tail above the UPI cap), the single cleanest lever to cut involuntary failures.
2. **Default new SIP mandates to UPI autopay** in the setup flow; reserve NACH only for amounts above the UPI autopay cap.
3. **Add same-day retry plus a nudge on NACH failures** so a single bounce doesn't cascade into a cancellation, and prioritize retry logic for the highest-failure banks (Axis, PNB, HDFC by volume).

\`\`\`sql
SELECT
  payment_mode,
  COUNT(*)                                                       AS installments,
  COUNT(*) FILTER (WHERE status = 'failed')                      AS failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed')
        / COUNT(*), 2)                                           AS fail_rate_pct
FROM raw_transactions
WHERE txn_type = 'sip_installment'
GROUP BY payment_mode
ORDER BY installments DESC;
\`\`\``,
  followUps: [
    "How many cancellations follow a failed installment?",
    "What's the failure rate by bank on NACH?",
    "Would defaulting new SIPs to UPI hit our higher-ticket SIPs?",
  ],
  work: {
    "data-quality": {
      summary:
        "Of 462,517 transactions, 370,937 are SIP installments. Status is clean (success / failed / pending only), so the per-mode failure split is reliable.",
      queries: [
        {
          sql: "SELECT txn_type, COUNT(*) AS txns\nFROM raw_transactions\nGROUP BY txn_type\nORDER BY txns DESC;",
          description: "Transaction count by type",
          rowCount: 4,
          executionTimeMs: 318,
          columns: ["txn_type", "txns"],
          data: [
            { txn_type: "sip_installment", txns: 370937 },
            { txn_type: "redemption", txns: 50469 },
            { txn_type: "lumpsum", txns: 25000 },
            { txn_type: "stp_purchase", txns: 16111 },
          ],
        },
        {
          sql: "SELECT status,\n       COUNT(*) AS installments,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS share_pct\nFROM raw_transactions\nWHERE txn_type = 'sip_installment'\nGROUP BY status\nORDER BY installments DESC;",
          description: "SIP installment status distribution (clean three-state field)",
          rowCount: 3,
          executionTimeMs: 397,
          columns: ["status", "installments", "share_pct"],
          data: [
            { status: "success", installments: 357531, share_pct: 96.39 },
            { status: "failed", installments: 11534, share_pct: 3.11 },
            { status: "pending", installments: 1872, share_pct: 0.50 },
          ],
        },
      ],
    },
    "daily-metrics": {
      summary:
        "NACH installments fail at 6.32% vs 1.87% on UPI and 1.92% on netbanking (3.4x). NACH is 28% of attempts but 56% of all 11,534 failed installments, ~4,571 of them excess, and the gap holds 4.35-5.07 points every quarter.",
      queries: [
        {
          sql: "SELECT payment_mode,\n       COUNT(*) AS installments,\n       COUNT(*) FILTER (WHERE status = 'failed') AS failed,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed') / COUNT(*), 2) AS fail_rate_pct\nFROM raw_transactions\nWHERE txn_type = 'sip_installment'\nGROUP BY payment_mode\nORDER BY installments DESC;",
          description: "SIP installment failure rate by payment mode",
          rowCount: 3,
          executionTimeMs: 642,
          columns: ["payment_mode", "installments", "failed", "fail_rate_pct"],
          data: [
            { payment_mode: "upi", installments: 201135, failed: 3754, fail_rate_pct: 1.87 },
            { payment_mode: "nach", installments: 102633, failed: 6487, fail_rate_pct: 6.32 },
            { payment_mode: "netbanking", installments: 67169, failed: 1293, fail_rate_pct: 1.92 },
          ],
        },
        {
          sql: "WITH base AS (\n  SELECT\n    COUNT(*) FILTER (WHERE payment_mode = 'nach') AS nach_attempts,\n    COUNT(*) FILTER (WHERE payment_mode = 'nach' AND status = 'failed') AS nach_failed,\n    ROUND(100.0 * COUNT(*) FILTER (WHERE payment_mode = 'upi' AND status = 'failed')\n          / NULLIF(COUNT(*) FILTER (WHERE payment_mode = 'upi'), 0), 4) AS upi_fail_rate\n  FROM raw_transactions\n  WHERE txn_type = 'sip_installment'\n)\nSELECT nach_attempts, nach_failed,\n       ROUND(nach_attempts * upi_fail_rate / 100.0) AS expected_at_upi_rate,\n       nach_failed - ROUND(nach_attempts * upi_fail_rate / 100.0) AS excess_failures\nFROM base;",
          description: "Excess NACH failures vs the UPI baseline rate",
          rowCount: 1,
          executionTimeMs: 588,
          columns: ["nach_attempts", "nach_failed", "expected_at_upi_rate", "excess_failures"],
          data: [{ nach_attempts: 102633, nach_failed: 6487, expected_at_upi_rate: 1916, excess_failures: 4571 }],
        },
        {
          sql: "WITH q AS (\n  SELECT STRFTIME(DATE_TRUNC('quarter', txn_date), '%Y') || '-Q' || QUARTER(txn_date) AS qtr,\n         DATE_TRUNC('quarter', txn_date) AS q_sort,\n         payment_mode,\n         ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed') / COUNT(*), 2) AS fr\n  FROM raw_transactions\n  WHERE txn_type = 'sip_installment'\n    AND txn_date >= DATE '2025-07-01'\n  GROUP BY 1, 2, payment_mode\n)\nSELECT qtr,\n       MAX(fr) FILTER (WHERE payment_mode = 'nach') AS nach_fail_pct,\n       MAX(fr) FILTER (WHERE payment_mode = 'upi') AS upi_fail_pct,\n       ROUND(MAX(fr) FILTER (WHERE payment_mode = 'nach')\n             - MAX(fr) FILTER (WHERE payment_mode = 'upi'), 2) AS gap_pts\nFROM q\nGROUP BY qtr, q_sort\nORDER BY q_sort;",
          description: "NACH vs UPI failure-rate gap by quarter",
          rowCount: 4,
          executionTimeMs: 731,
          columns: ["qtr", "nach_fail_pct", "upi_fail_pct", "gap_pts"],
          data: [
            { qtr: "2025-Q3", nach_fail_pct: 6.53, upi_fail_pct: 2.12, gap_pts: 4.41 },
            { qtr: "2025-Q4", nach_fail_pct: 6.52, upi_fail_pct: 1.73, gap_pts: 4.79 },
            { qtr: "2026-Q1", nach_fail_pct: 6.89, upi_fail_pct: 1.82, gap_pts: 5.07 },
            { qtr: "2026-Q2", nach_fail_pct: 6.22, upi_fail_pct: 1.87, gap_pts: 4.35 },
          ],
        },
      ],
    },
    "user-segmentation": {
      summary:
        "NACH failures are uniform across banks: every major bank sits between 6.2% and 6.7%, with Axis and PNB tied at the top (6.71%), confirming a rail problem rather than a single-sponsor problem.",
      queries: [
        {
          sql: "WITH b AS (\n  SELECT i.bank_name,\n         COUNT(*) AS installments,\n         COUNT(*) FILTER (WHERE t.status = 'failed') AS failed,\n         ROUND(100.0 * COUNT(*) FILTER (WHERE t.status = 'failed') / COUNT(*), 2) AS fail_rate_pct\n  FROM raw_transactions t\n  JOIN raw_investors i ON t.investor_id = i.investor_id\n  WHERE t.txn_type = 'sip_installment'\n    AND t.payment_mode = 'nach'\n  GROUP BY i.bank_name\n  HAVING COUNT(*) >= 2000\n)\nSELECT RANK() OVER (ORDER BY fail_rate_pct DESC) AS rk,\n       bank_name, installments, failed, fail_rate_pct\nFROM b\nORDER BY rk\nLIMIT 6;",
          description: "NACH failure rate by bank, ranked (banks with 2,000+ NACH installments)",
          rowCount: 6,
          executionTimeMs: 668,
          columns: ["rk", "bank_name", "installments", "failed", "fail_rate_pct"],
          data: [
            { rk: 1, bank_name: "PNB", installments: 3846, failed: 258, fail_rate_pct: 6.71 },
            { rk: 1, bank_name: "Axis Bank", installments: 12408, failed: 833, fail_rate_pct: 6.71 },
            { rk: 3, bank_name: "Yes Bank", installments: 3881, failed: 249, fail_rate_pct: 6.42 },
            { rk: 4, bank_name: "HDFC Bank", installments: 26520, failed: 1700, fail_rate_pct: 6.41 },
            { rk: 5, bank_name: "Kotak Bank", installments: 8059, failed: 501, fail_rate_pct: 6.22 },
            { rk: 6, bank_name: "ICICI Bank", installments: 18475, failed: 1147, fail_rate_pct: 6.21 },
          ],
        },
      ],
    },
    "rev-opt": {
      summary:
        "NACH and UPI SIPs share the same median ticket (₹3,000) and near-identical average (₹4,377 vs ₹4,521), so the vast majority of NACH SIPs fit under the UPI autopay cap and can migrate.",
      queries: [
        {
          sql: "SELECT payment_mode,\n       COUNT(*) AS installments,\n       ROUND(AVG(amount_inr)) AS avg_ticket,\n       ROUND(quantile_cont(amount_inr, 0.5)) AS median_ticket,\n       ROUND(quantile_cont(amount_inr, 0.95)) AS p95_ticket\nFROM raw_transactions\nWHERE txn_type = 'sip_installment'\nGROUP BY payment_mode\nORDER BY avg_ticket DESC;",
          description: "Installment ticket-size distribution by payment mode",
          rowCount: 3,
          executionTimeMs: 524,
          columns: ["payment_mode", "installments", "avg_ticket", "median_ticket", "p95_ticket"],
          data: [
            { payment_mode: "netbanking", installments: 67169, avg_ticket: 4552, median_ticket: 3000, p95_ticket: 13000 },
            { payment_mode: "upi", installments: 201135, avg_ticket: 4521, median_ticket: 3000, p95_ticket: 13000 },
            { payment_mode: "nach", installments: 102633, avg_ticket: 4377, median_ticket: 3000, p95_ticket: 13000 },
          ],
        },
      ],
    },
    "cohort-retention": {
      summary:
        "8,575 SIPs (28% of the 30,802-SIP book) still run on NACH mandates, with retention near identical to UPI today, so they are a clean migration target before failures trigger cancellations.",
      queries: [
        {
          sql: "SELECT mandate_type,\n       COUNT(*) AS sips,\n       COUNT(*) FILTER (WHERE status = 'active') AS active,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'active') / COUNT(*), 1) AS active_pct\nFROM raw_sips\nGROUP BY mandate_type\nORDER BY sips DESC;",
          description: "Mandate mix and active rate across the SIP book",
          rowCount: 2,
          executionTimeMs: 304,
          columns: ["mandate_type", "sips", "active", "active_pct"],
          data: [
            { mandate_type: "upi_autopay", sips: 22227, active: 11091, active_pct: 49.9 },
            { mandate_type: "nach", sips: 8575, active: 4196, active_pct: 48.9 },
          ],
        },
        {
          sql: "SELECT mandate_type,\n       COUNT(*) AS sips,\n       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cancelled') / COUNT(*), 1) AS cancel_rate_pct\nFROM raw_sips\nGROUP BY mandate_type\nORDER BY sips DESC;",
          description: "Cancellation rate by mandate type (near-identical today, the latent risk)",
          rowCount: 2,
          executionTimeMs: 318,
          columns: ["mandate_type", "sips", "cancelled", "cancel_rate_pct"],
          data: [
            { mandate_type: "upi_autopay", sips: 22227, cancelled: 7822, cancel_rate_pct: 35.2 },
            { mandate_type: "nach", sips: 8575, cancelled: 3044, cancel_rate_pct: 35.5 },
          ],
        },
      ],
    },
    "geographic": {
      summary:
        "The NACH-heavy book is spread evenly across geographies: NACH is 28.2% of SIPs in B30 cities and 27.6% in T30, so the migration target is not concentrated in one tier.",
      queries: [
        {
          sql: "SELECT i.city_tier,\n       COUNT(*) FILTER (WHERE s.mandate_type = 'nach') AS nach_sips,\n       COUNT(*) FILTER (WHERE s.mandate_type = 'upi_autopay') AS upi_sips,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE s.mandate_type = 'nach') / COUNT(*), 1) AS nach_share_pct\nFROM raw_sips s\nJOIN raw_investors i ON s.investor_id = i.investor_id\nGROUP BY i.city_tier\nORDER BY nach_share_pct DESC;",
          description: "NACH vs UPI mandate share by city tier",
          rowCount: 2,
          executionTimeMs: 421,
          columns: ["city_tier", "nach_sips", "upi_sips", "nach_share_pct"],
          data: [
            { city_tier: "b30", nach_sips: 2975, upi_sips: 7573, nach_share_pct: 28.2 },
            { city_tier: "t30", nach_sips: 5600, upi_sips: 14654, nach_share_pct: 27.6 },
          ],
        },
      ],
    },
  },
});

const preRedemptionSave = deepResearchThread({
  slug: "pre-redemption-save",
  title: "Are advisor calls saving redemptions?",
  question:
    "When investors signal they want to redeem, do our pre-redemption advisor calls actually save them? Quantify the save and the value protected.",
  report: `## Pre-redemption save: the highest-leverage retention play

### Executive summary

When an at-risk investor signals they want to redeem and is intercepted with a pre-redemption advisor call, **65.5% stay invested** (55.2% fully follow the advice to stay, another 10.3% partially reduce instead of fully exiting) [rev-opt:Q1]. Only a third redeem anyway. That is a strong, real save on people who had already decided to leave, and it translates directly into protected balances: across the 2,964 calls, **₹227.1M of portfolio value stayed put** (followed plus partial) against **₹114.7M that walked** [rev-opt:Q3].

Two structural facts shape how to deploy this. First, the play is **100% human-handled**: every one of the 2,964 calls was run by a live advisor, none by the automated "Money Mitr" assistant [rev-opt:Q2]. That is why the close rate is high, but it also caps throughput, advisor time is the binding constraint. Second, the addressable pipeline dwarfs current usage: **24,198 goals sit at-risk or off-track**, holding ₹1,129.4M of current value, yet only 2,964 calls have ever fired [user-segmentation:Q1]. The save play is reaching a small slice of the redemption-risk surface.

One nuance matters for capacity planning. The save rate is **remarkably flat across portfolio-value quartiles (64.2% to 67.3%)** [user-segmentation:Q2], which means a high-value investor is not meaningfully easier (or harder) to save than a low-value one. So prioritizing advisor time by balance does not cost you save *rate*, it simply concentrates the limited human supply on the rupees most worth protecting. The right design is automated triggering plus value-based routing, with a low-cost automated message backstopping the long tail. Encouragingly, the play already scales: monthly call volume roughly doubled from **127 (Oct 2025) to 257 (May 2026)** while the save rate held in the high-50s to high-60s, so adding capacity has not diluted effectiveness [daily-metrics:Q1].

### Pre-redemption call outcomes

| Outcome | Calls | Share |
| --- | ---: | ---: |
| Followed (stayed invested) | 1,636 | 55.2% |
| Partial (reduced redemption) | 306 | 10.3% |
| Ignored (redeemed anyway) | 1,022 | 34.5% |
| **Total** | **2,964** | **100%** |

**55.2% fully followed** and another **10.3% partially** held back, so **65.5% (1,942 of 2,964)** of intercepted investors were saved or partly saved [rev-opt:Q1]. Only a third redeemed anyway. Every one of these calls was handled by a **human advisor** (0 were automated), which is why the close rate is high but the channel is capacity-constrained [rev-opt:Q2].

### Methodology and data note

All save rates come from \`raw_advisory\`, which is complete: **20,000 sessions, zero null outcomes, across 5 session types** [data-quality:Q1]. The pre-redemption cut filters \`session_type = 'pre_redemption_call'\`; the comparison set uses \`recommendation_type\` across all sessions. "Save rate" is followed plus partial; "follow rate" (used in the comparison table below) is followed only, which is the stricter metric. Protected value sums \`portfolio_value_at_time\` by outcome [rev-opt:Q3]. The value-quartile cut uses \`NTILE(4)\` over portfolio value [user-segmentation:Q2], and the goal pipeline comes from \`raw_goals\` joined on status and current value [user-segmentation:Q1]. Every pre-redemption call in the data was \`triggered_by = 'redemption_request'\`, so this is a reactive, intent-driven play today [data-quality:Q2].

### Value protected by the play

| Outcome | Calls | Portfolio value (₹) | Avg balance (₹) |
| --- | ---: | ---: | ---: |
| Followed | 1,636 | 190.9M | 116,691 |
| Partial | 306 | 36.2M | 118,179 |
| Ignored | 1,022 | 114.7M | 112,219 |

The saved-and-partial calls protected **₹227.1M** in standing portfolio value; the ignored calls represent **₹114.7M** that left [rev-opt:Q3]. Average balances are nearly identical across outcomes (~₹112K-₹118K), which is the first hint that value does not predict save success.

### Save rate by portfolio-value quartile (the flat curve)

| Value quartile | Calls | Balance range (₹) | Save rate |
| --- | ---: | --- | ---: |
| Q1 (lowest) | 741 | 651 - 41,856 | 65.0% |
| Q2 | 741 | 41,933 - 64,395 | 65.5% |
| Q3 | 741 | 64,447 - 143,357 | **67.3%** |
| Q4 (highest) | 741 | 143,549 - 1,394,617 | 64.2% |

Save rate barely moves across the value distribution (64.2%-67.3%) [user-segmentation:Q2]. This is operationally important: it means you should route by *value at stake*, not by *probability of saving*, because the probability is roughly constant. The biggest balances are saved just as reliably as the smallest, so they are where the limited human-advisor hours pay off most.

### How redemption-intent advice compares to other advisory

| Recommendation | Followed | Ignored | Partial | Follow rate |
| --- | ---: | ---: | ---: | ---: |
| Stay invested | 1,004 | 622 | 365 | 50.4% |
| Increase SIP | 2,502 | 1,564 | 992 | 49.5% |
| Fund switch | 1,918 | 1,292 | 820 | 47.6% |
| Add ELSS | 1,476 | 915 | 601 | 49.3% |
| Start SIP | 1,782 | 1,085 | 737 | 49.4% |

Generic advisory recommendations land around a **~48-50% follow rate** (followed only) [cohort-retention:Q1]. On the same strict followed-only basis, pre-redemption calls convert at 55.2%, and on the looser saved-or-partial basis at 65.5%. Either way, **redemption-intent calls outperform routine advisory**: investors who have already decided to leave are *more* persuadable in a live conversation than the general book is for routine nudges, because the call meets a real, urgent moment. (Note: on a saved-or-partial basis, several routine session types also reach ~70% because partial counts heavily there [cohort-retention:Q2]; the edge of pre-redemption calls is sharpest on the strict follow metric and on the urgency of the moment.)

### Where the goal pipeline feeds this

| Goal status | Goals | Flagged at risk |
| --- | ---: | ---: |
| On track | 35,191 | 0 |
| At risk | 13,993 | 13,993 |
| Off track | 10,205 | 10,205 |
| Achieved | 5,611 | 0 |

There are **24,198 goals flagged at-risk or off-track**, holding **₹1,129.4M** of current value, a large pipeline of redemption-risk moments [user-segmentation:Q1]. Only 2,964 pre-redemption calls have been made, so the save play is reaching a small slice of the addressable risk.

### Key findings

1. **65.5% of pre-redemption calls save the investor** (55.2% fully + 10.3% partial), and on the strict followed-only basis they still beat every routine advisory type (55.2% vs ~48-50%) [rev-opt:Q1][cohort-retention:Q1].
2. **₹227.1M of portfolio value was protected** by saved-and-partial calls, vs ₹114.7M that walked [rev-opt:Q3].
3. **100% human-handled.** The high close rate depends on a live advisor, so the channel is capacity-limited [rev-opt:Q2].
4. **Save rate is flat across value quartiles (64.2%-67.3%)** [user-segmentation:Q2], so route by balance at stake, not by save probability.
5. **24,198 goals (₹1,129.4M) sit at-risk/off-track** but only 2,964 calls have fired, the play is massively under-deployed relative to the risk pipeline [user-segmentation:Q1].
6. **The play is reactive today** (100% triggered by a redemption request) [data-quality:Q2], so there is room to fire it earlier, on the at-risk goal signal, before the redemption button is pressed.

### Risks and caveats

- These are correlations, not a controlled experiment: investors who accept a call may be more save-able to begin with. The true causal lift is likely below the 65.5% headline, so a holdout test would size the real incremental save.
- "Value protected" is the standing balance at call time, not the amount that would otherwise have been redeemed; some "saved" investors might have only partially redeemed anyway, which would lower the true protected figure.
- The flat-by-quartile result is reassuring but the top quartile spans a very wide balance range (up to ₹1.39M); within it, the handful of largest accounts deserve bespoke handling rather than the average treatment.

### Recommended actions

1. **Trigger a pre-redemption call automatically** the moment redemption intent (or an at-risk/off-track goal) is detected, closing the gap between 24,198 at-risk goals and 2,964 calls. Move from reactive (redemption-request only) to proactive (at-risk-goal) triggering.
2. **Route live advisor hours by balance at stake**, not by predicted save rate, since save rate is flat across value (64-67%) but protected rupees scale with balance [user-segmentation:Q2].
3. **Backstop the long tail with an automated "stay invested" message** (the Money Mitr assistant, currently unused for this play) for low-balance at-risk investors, reserving the 65.5%-close human calls for the high-value tail.

\`\`\`sql
SELECT
  outcome,
  COUNT(*)                                            AS calls,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)  AS share_pct
FROM raw_advisory
WHERE session_type = 'pre_redemption_call'
GROUP BY outcome
ORDER BY calls DESC;
\`\`\``,
  followUps: [
    "What portfolio value is protected by the saved investors?",
    "How fast must the call fire after intent to keep the save rate?",
    "Could an automated message match human save rates on small balances?",
  ],
  work: {
    "data-quality": {
      summary:
        "All 20,000 advisory sessions have a non-null outcome across 5 session types, so save-rate splits are complete with no missing-outcome bias.",
      queries: [
        {
          sql: "SELECT COUNT(*) AS sessions,\n       COUNT(*) FILTER (WHERE outcome IS NULL) AS null_outcome,\n       COUNT(DISTINCT session_type) AS session_types\nFROM raw_advisory;",
          description: "Completeness check on advisory session outcomes",
          rowCount: 1,
          executionTimeMs: 244,
          columns: ["sessions", "null_outcome", "session_types"],
          data: [{ sessions: 20000, null_outcome: 0, session_types: 5 }],
        },
        {
          sql: "SELECT triggered_by,\n       COUNT(*) AS calls\nFROM raw_advisory\nWHERE session_type = 'pre_redemption_call'\nGROUP BY triggered_by\nORDER BY calls DESC;",
          description: "What triggers a pre-redemption call (today: 100% reactive)",
          rowCount: 1,
          executionTimeMs: 251,
          columns: ["triggered_by", "calls"],
          data: [{ triggered_by: "redemption_request", calls: 2964 }],
        },
      ],
    },
    "rev-opt": {
      summary:
        "Pre-redemption calls save 65.5% of intercepted investors (55.2% fully + 10.3% partial), all human-handled, protecting ₹227.1M in portfolio value against ₹114.7M that walked.",
      queries: [
        {
          sql: "SELECT outcome,\n       COUNT(*) AS calls,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS share_pct\nFROM raw_advisory\nWHERE session_type = 'pre_redemption_call'\nGROUP BY outcome\nORDER BY calls DESC;",
          description: "Pre-redemption call outcomes and shares",
          rowCount: 3,
          executionTimeMs: 357,
          columns: ["outcome", "calls", "share_pct"],
          data: [
            { outcome: "followed", calls: 1636, share_pct: 55.2 },
            { outcome: "ignored", calls: 1022, share_pct: 34.5 },
            { outcome: "partial", calls: 306, share_pct: 10.3 },
          ],
        },
        {
          sql: "SELECT advisor_type, COUNT(*) AS calls\nFROM raw_advisory\nWHERE session_type = 'pre_redemption_call'\nGROUP BY advisor_type;",
          description: "Advisor type handling pre-redemption calls",
          rowCount: 1,
          executionTimeMs: 268,
          columns: ["advisor_type", "calls"],
          data: [{ advisor_type: "human_advisor", calls: 2964 }],
        },
        {
          sql: "SELECT outcome,\n       COUNT(*) AS calls,\n       ROUND(SUM(portfolio_value_at_time) / 1e6, 1) AS portfolio_value_m,\n       ROUND(AVG(portfolio_value_at_time)) AS avg_balance\nFROM raw_advisory\nWHERE session_type = 'pre_redemption_call'\nGROUP BY outcome\nORDER BY calls DESC;",
          description: "Portfolio value protected vs walked, by call outcome",
          rowCount: 3,
          executionTimeMs: 433,
          columns: ["outcome", "calls", "portfolio_value_m", "avg_balance"],
          data: [
            { outcome: "followed", calls: 1636, portfolio_value_m: 190.9, avg_balance: 116691 },
            { outcome: "ignored", calls: 1022, portfolio_value_m: 114.7, avg_balance: 112219 },
            { outcome: "partial", calls: 306, portfolio_value_m: 36.2, avg_balance: 118179 },
          ],
        },
      ],
    },
    "cohort-retention": {
      summary:
        "Routine advisory follows at ~48%-50% (followed only), below pre-redemption's 55.2%. On a saved-or-partial basis several routine types reach ~70%, so the pre-redemption edge is sharpest on the strict follow metric and the urgency of the moment.",
      queries: [
        {
          sql: "SELECT recommendation_type,\n       COUNT(*) FILTER (WHERE outcome = 'followed') AS followed,\n       COUNT(*) FILTER (WHERE outcome = 'ignored') AS ignored_n,\n       COUNT(*) FILTER (WHERE outcome = 'partial') AS partial_n,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'followed') / COUNT(*), 1) AS follow_rate_pct\nFROM raw_advisory\nGROUP BY recommendation_type\nORDER BY followed DESC;",
          description: "Follow rate by advisory recommendation type",
          rowCount: 6,
          executionTimeMs: 489,
          columns: ["recommendation_type", "followed", "ignored_n", "partial_n", "follow_rate_pct"],
          data: [
            { recommendation_type: "increase_sip", followed: 2502, ignored_n: 1564, partial_n: 992, follow_rate_pct: 49.5 },
            { recommendation_type: "fund_switch", followed: 1918, ignored_n: 1292, partial_n: 820, follow_rate_pct: 47.6 },
            { recommendation_type: "start_sip", followed: 1782, ignored_n: 1085, partial_n: 737, follow_rate_pct: 49.4 },
            { recommendation_type: "add_elss", followed: 1476, ignored_n: 915, partial_n: 601, follow_rate_pct: 49.3 },
            { recommendation_type: "rebalance", followed: 1126, ignored_n: 707, partial_n: 492, follow_rate_pct: 48.4 },
            { recommendation_type: "stay_invested", followed: 1004, ignored_n: 622, partial_n: 365, follow_rate_pct: 50.4 },
          ],
        },
        {
          sql: "SELECT session_type,\n       COUNT(*) AS sessions,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('followed', 'partial')) / COUNT(*), 1) AS save_rate_pct\nFROM raw_advisory\nGROUP BY session_type\nORDER BY save_rate_pct DESC;",
          description: "Saved-or-partial rate by advisory session type",
          rowCount: 5,
          executionTimeMs: 412,
          columns: ["session_type", "sessions", "save_rate_pct"],
          data: [
            { session_type: "fund_selection", sessions: 3869, save_rate_pct: 70.0 },
            { session_type: "risk_assessment", sessions: 2437, save_rate_pct: 69.9 },
            { session_type: "portfolio_review", sessions: 5063, save_rate_pct: 69.6 },
            { session_type: "goal_planning", sessions: 5667, save_rate_pct: 69.5 },
            { session_type: "pre_redemption_call", sessions: 2964, save_rate_pct: 65.5 },
          ],
        },
      ],
    },
    "user-segmentation": {
      summary:
        "24,198 goals (₹1,129.4M of current value) sit at-risk or off-track against only 2,964 calls. Save rate is flat across value quartiles (64.2%-67.3%), so route by balance at stake, not by save probability.",
      queries: [
        {
          sql: "SELECT status,\n       COUNT(*) AS goals,\n       COUNT(*) FILTER (WHERE flagged_at_risk_date IS NOT NULL) AS flagged_at_risk,\n       ROUND(SUM(current_value_inr) / 1e6, 1) AS current_value_m\nFROM raw_goals\nGROUP BY status\nORDER BY goals DESC;",
          description: "Goal pipeline by status, at-risk flag, and current value",
          rowCount: 4,
          executionTimeMs: 401,
          columns: ["status", "goals", "flagged_at_risk", "current_value_m"],
          data: [
            { status: "on_track", goals: 35191, flagged_at_risk: 0, current_value_m: 1804.3 },
            { status: "at_risk", goals: 13993, flagged_at_risk: 13993, current_value_m: 679.1 },
            { status: "off_track", goals: 10205, flagged_at_risk: 10205, current_value_m: 450.3 },
            { status: "achieved", goals: 5611, flagged_at_risk: 0, current_value_m: 522.7 },
          ],
        },
        {
          sql: "WITH q AS (\n  SELECT outcome,\n         portfolio_value_at_time AS pv,\n         NTILE(4) OVER (ORDER BY portfolio_value_at_time) AS value_quartile\n  FROM raw_advisory\n  WHERE session_type = 'pre_redemption_call'\n)\nSELECT value_quartile,\n       COUNT(*) AS calls,\n       ROUND(MIN(pv)) AS min_balance,\n       ROUND(MAX(pv)) AS max_balance,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('followed', 'partial')) / COUNT(*), 1) AS save_rate_pct\nFROM q\nGROUP BY value_quartile\nORDER BY value_quartile;",
          description: "Save rate by portfolio-value quartile (the flat curve)",
          rowCount: 4,
          executionTimeMs: 547,
          columns: ["value_quartile", "calls", "min_balance", "max_balance", "save_rate_pct"],
          data: [
            { value_quartile: 1, calls: 741, min_balance: 651, max_balance: 41856, save_rate_pct: 65.0 },
            { value_quartile: 2, calls: 741, min_balance: 41933, max_balance: 64395, save_rate_pct: 65.5 },
            { value_quartile: 3, calls: 741, min_balance: 64447, max_balance: 143357, save_rate_pct: 67.3 },
            { value_quartile: 4, calls: 741, min_balance: 143549, max_balance: 1394617, save_rate_pct: 64.2 },
          ],
        },
      ],
    },
    "daily-metrics": {
      summary:
        "Pre-redemption call volume is scaling (127/month in Oct 2025 to 257/month by May 2026) while the save rate holds in the high-50s to high-60s, so the play scales without losing effectiveness.",
      queries: [
        {
          sql: "SELECT STRFTIME(DATE_TRUNC('month', session_date), '%b %Y') AS month,\n       COUNT(*) AS calls,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('followed', 'partial')) / COUNT(*), 1) AS save_rate_pct\nFROM raw_advisory\nWHERE session_type = 'pre_redemption_call'\n  AND session_date >= DATE '2025-10-01'\n  AND session_date <  DATE '2026-06-01'\nGROUP BY DATE_TRUNC('month', session_date)\nORDER BY DATE_TRUNC('month', session_date);",
          description: "Monthly pre-redemption call volume and save rate",
          rowCount: 8,
          executionTimeMs: 458,
          columns: ["month", "calls", "save_rate_pct"],
          data: [
            { month: "Oct 2025", calls: 127, save_rate_pct: 68.5 },
            { month: "Nov 2025", calls: 136, save_rate_pct: 65.4 },
            { month: "Dec 2025", calls: 152, save_rate_pct: 66.4 },
            { month: "Jan 2026", calls: 142, save_rate_pct: 66.2 },
            { month: "Feb 2026", calls: 156, save_rate_pct: 69.2 },
            { month: "Mar 2026", calls: 190, save_rate_pct: 68.4 },
            { month: "Apr 2026", calls: 217, save_rate_pct: 57.6 },
            { month: "May 2026", calls: 257, save_rate_pct: 61.1 },
          ],
        },
      ],
    },
  },
});

const aumGrowth = deepResearchThread({
  slug: "aum-growth-and-mix",
  title: "What's driving AUM growth and the fund mix?",
  question:
    "What's driving our inflow growth over the last few months, and how is the fund-category mix shaped? Where should we focus the book?",
  report: `## Inflow growth and fund mix

### Executive summary

Monthly purchase inflow has nearly **doubled from ₹107.2M (Jul 2025) to ₹235.5M (Mar 2026)**, a clear tax-season acceleration into Q4 [daily-metrics:Q1]. Over the whole window the book has taken **₹3,070.1M in gross inflow** [rev-opt:Q1] against **₹863.3M redeemed**, a healthy **3.6x** inflow-to-redemption ratio [rev-opt:Q3]. The growth is not coming from new heads: the active-contributor base is flat at ~11.3K-11.7K all year [daily-metrics:Q1], so the entire lift is **deepening contribution per investor** through lumpsum and ELSS top-ups, the classic Indian tax-season pattern where existing investors front-load before the March 31 deadline.

The acceleration is concentrated and recent. Month-on-month growth was a sleepy 0.2%-4.9% from Jul through Nov, then stepped up hard: **+12.8% in Dec, +16.6% Jan, +30.2% Feb, +15.3% Mar** [daily-metrics:Q2]. The mechanism is unambiguous when you split the rails: through the tax season **SIP installment inflow stays flat at ~₹66-69M/month while lumpsum inflow explodes from ₹53.4M (Dec) to ₹147.5M (Mar)** [user-segmentation:Q2]. The recurring SIP rail is steady; the entire Q4 surge is discretionary lumpsum top-ups, overwhelmingly ELSS, from investors already on the book. Redemptions also rose over the same window (from ₹38.5M in Jul to ₹61.4M in Mar) but far more slowly than inflow, so net flows widened [rev-opt:Q5]. On a net basis (gross inflow minus redemptions by category), **ELSS leads at ₹730.5M net**, followed by equity (₹511.5M) and debt (₹401.2M) [rev-opt:Q4]. The one category that is net-negative is **liquid at -₹132.5M**: investors use it as a parking lot, paying in and pulling out, which is expected behavior for a cash-management sleeve, not a leak.

So the book is healthy, equity-tilted, and seasonally powered by ELSS. The opportunity is to (a) capture the Q4 window deliberately rather than passively, (b) make ELSS top-ups frictionless for existing investors, and (c) smooth the flat Jul-Nov off-season so growth is less hostage to the tax calendar.

### Monthly inflow trend

| Month | Inflow (₹) | MoM growth | Active SIP contributors |
| --- | ---: | ---: | ---: |
| Jul 2025 | 107.2M | - | 11,690 |
| Aug 2025 | 112.5M | +4.9% | 11,581 |
| Sep 2025 | 115.9M | +3.0% | 11,426 |
| Oct 2025 | 116.1M | +0.2% | 11,392 |
| Nov 2025 | 119.2M | +2.7% | 11,275 |
| Dec 2025 | 134.5M | +12.8% | 11,258 |
| Jan 2026 | 156.9M | +16.6% | 11,278 |
| Feb 2026 | 204.2M | +30.2% | 11,383 |
| Mar 2026 | 235.5M | +15.3% | 11,649 |

Inflow rises **+120% from Jul to Mar** while the active-contributor base is roughly flat [daily-metrics:Q1][daily-metrics:Q2]. The MoM column makes the seasonality unmissable: nothing happens until December, then four months of double-digit growth as ELSS top-ups land before the deadline.

### Methodology and data note

Inflow sums \`raw_transactions\` for the three purchase types (\`sip_installment\`, \`lumpsum\`, \`stp_purchase\`) at \`status = 'success'\`; redemptions are \`txn_type = 'redemption'\`. The log is clean for trend work: **447,508 of 462,517 transactions are successful**, the rest failed or pending [data-quality:Q1]. Monthly and MoM figures use \`date_trunc('month', txn_date)\` with a \`LAG\` window for the growth rate [daily-metrics:Q2]; the category mix joins to \`raw_funds.category\` [rev-opt:Q1]; net flows subtract per-category redemptions from per-category inflow [rev-opt:Q4]. The ELSS seasonality cut counts \`raw_sips\` creations by start-month [user-segmentation:Q1].

### Fund-category mix

| Category | Inflow (₹) | Share | Style |
| --- | ---: | ---: | --- |
| Equity | 879.6M | 28.7% | equity |
| ELSS | 765.3M | 24.9% | equity (tax) |
| Debt | 417.3M | 13.6% | debt |
| DAAF | 283.7M | 9.2% | hybrid |
| Liquid | 238.6M | 7.8% | debt |
| Global | 163.5M | 5.3% | equity |
| Gold | 161.0M | 5.2% | commodity |
| Index | 84.7M | 2.8% | equity |
| Hybrid | 76.3M | 2.5% | hybrid |

(by category [rev-opt:Q1])

Equity-style categories (equity + ELSS + global + index) are **61.7%** of inflow, within the 55-70% norm [rev-opt:Q2]. **ELSS at 24.9% is the seasonal engine:** tax-saving SIP creation runs **1,186/month in Jan-Mar vs 346/month the rest of the year (3.4x)** [user-segmentation:Q1], which is exactly what powers the Feb-Mar inflow spike.

### Net flows by category (where money actually sticks)

| Category | Gross inflow (₹) | Redeemed (₹) | Net (₹) |
| --- | ---: | ---: | ---: |
| ELSS | 765.3M | 34.8M | **730.5M** |
| Equity | 879.6M | 368.1M | 511.5M |
| Debt | 417.3M | 16.1M | 401.2M |
| DAAF | 283.7M | 11.9M | 271.7M |
| Gold | 161.0M | 6.8M | 154.2M |
| Global | 163.5M | 46.9M | 116.6M |
| Index | 84.7M | 4.1M | 80.7M |
| Hybrid | 76.3M | 3.5M | 72.8M |
| Liquid | 238.6M | 371.1M | **-132.5M** |

Net of redemptions, **ELSS is the stickiest category by far** (₹730.5M net, a 22x inflow-to-outflow ratio) because the 3-year lock-in mechanically suppresses redemptions [rev-opt:Q4]. Equity has the largest gross outflow (₹368.1M) as investors take profits and rebalance, but still nets ₹511.5M positive. **Liquid is net-negative (-₹132.5M)**, which is healthy: it is a cash-parking sleeve, not a buy-and-hold category, so money flowing back out is the product working as intended.

### Key findings

1. **Inflow nearly doubled Jul to Mar (+120%)** on a flat contributor base, growth is depth, not new heads [daily-metrics:Q1].
2. **The acceleration is all in Q4:** MoM growth jumps to +12.8% (Dec), +16.6% (Jan), +30.2% (Feb), +15.3% (Mar) as ELSS top-ups land before the deadline [daily-metrics:Q2].
3. **ELSS is the seasonal lever:** 24.9% of inflow, 3.4x heavier SIP creation in Jan-Mar, and the stickiest net category at ₹730.5M [rev-opt:Q1][rev-opt:Q4][user-segmentation:Q1].
4. **The book is appropriately equity-tilted (61.7%)** and diversified across 9 categories, with debt + liquid (21.4%) providing ballast [rev-opt:Q2].
5. **Liquid is net-negative by design (-₹132.5M)**, a cash-parking sleeve rather than a leak; every other category nets positive [rev-opt:Q4].
6. **Redemptions are rising but slower than inflow** (₹38.5M to ₹61.4M Jul to Mar), so net flows widened through the tax season [rev-opt:Q5].

### Risks and caveats

- "Inflow" is gross purchases, not AUM. True AUM also moves with NAV (market returns), which is not modeled here; a falling market could grow inflow while AUM shrinks.
- The +120% Jul-to-Mar figure is partly a seasonal artifact; year-on-year the ELSS spike is the right lens, and the data here covers a single tax cycle, so do not annualize the March run-rate.
- Equity's large redemption (₹368.1M) bears watching: it is healthy profit-taking today, but if the gross-to-redeem ratio compresses further it would erode the net-positive story.

### Recommended actions

1. **Front-load acquisition and reactivation spend into Q4** (Dec-Mar) when both intent and ticket size peak, the ELSS deadline does the selling.
2. **Build an ELSS top-up flow** for existing investors in Jan-Mar; the growth is depth-driven and ELSS is the stickiest net category, so make deepening one tap.
3. **Smooth the off-season** (Jul-Nov sits flat at ~₹110M-₹120M with sub-5% MoM growth) with step-up SIP nudges so growth isn't entirely tax-cycle dependent [daily-metrics:Q2].

\`\`\`sql
SELECT
  STRFTIME(DATE_TRUNC('month', t.txn_date), '%b %Y')                AS month,
  ROUND(SUM(t.amount_inr) / 1e6, 1)                                 AS inflow_m,
  COUNT(DISTINCT t.investor_id)
    FILTER (WHERE t.txn_type = 'sip_installment')                   AS active_sippers
FROM raw_transactions t
WHERE t.status = 'success'
  AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')
  AND t.txn_date >= DATE '2025-07-01'
  AND t.txn_date <  DATE '2026-04-01'
GROUP BY DATE_TRUNC('month', t.txn_date)
ORDER BY DATE_TRUNC('month', t.txn_date);
\`\`\``,
  followUps: [
    "Is the ELSS tax-season spike growing year over year?",
    "How concentrated is inflow across AMCs and schemes?",
    "What's the net inflow after redemptions by category?",
  ],
  work: {
    "data-quality": {
      summary:
        "The transaction log is clean for trend work: 447,508 of 462,517 transactions are successful, with only failed and pending statuses otherwise, so monthly inflow sums are reliable.",
      queries: [
        {
          sql: "SELECT status, COUNT(*) AS txns\nFROM raw_transactions\nGROUP BY status\nORDER BY txns DESC;",
          description: "Transaction status distribution",
          rowCount: 3,
          executionTimeMs: 301,
          columns: ["status", "txns"],
          data: [
            { status: "success", txns: 447508 },
            { status: "failed", txns: 13137 },
            { status: "pending", txns: 1872 },
          ],
        },
      ],
    },
    "daily-metrics": {
      summary:
        "Monthly purchase inflow climbs from ₹107.2M (Jul 2025) to ₹235.5M (Mar 2026), +120%, while active SIP contributors stay flat (~11.3K-11.7K), so growth is depth per investor, not headcount.",
      queries: [
        {
          sql: "SELECT STRFTIME(DATE_TRUNC('month', t.txn_date), '%b %Y') AS month,\n       ROUND(SUM(t.amount_inr) / 1e6, 1) AS inflow_m,\n       COUNT(DISTINCT t.investor_id) FILTER (WHERE t.txn_type = 'sip_installment') AS active_sippers\nFROM raw_transactions t\nWHERE t.status = 'success'\n  AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\n  AND t.txn_date >= DATE '2025-07-01'\n  AND t.txn_date <  DATE '2026-04-01'\nGROUP BY DATE_TRUNC('month', t.txn_date)\nORDER BY DATE_TRUNC('month', t.txn_date);",
          description: "Monthly purchase inflow and active SIP contributors",
          rowCount: 9,
          executionTimeMs: 924,
          columns: ["month", "inflow_m", "active_sippers"],
          data: [
            { month: "Jul 2025", inflow_m: 107.2, active_sippers: 11690 },
            { month: "Aug 2025", inflow_m: 112.5, active_sippers: 11581 },
            { month: "Sep 2025", inflow_m: 115.9, active_sippers: 11426 },
            { month: "Oct 2025", inflow_m: 116.1, active_sippers: 11392 },
            { month: "Nov 2025", inflow_m: 119.2, active_sippers: 11275 },
            { month: "Dec 2025", inflow_m: 134.5, active_sippers: 11258 },
            { month: "Jan 2026", inflow_m: 156.9, active_sippers: 11278 },
            { month: "Feb 2026", inflow_m: 204.2, active_sippers: 11383 },
            { month: "Mar 2026", inflow_m: 235.5, active_sippers: 11649 },
          ],
        },
        {
          sql: "WITH m AS (\n  SELECT DATE_TRUNC('month', txn_date) AS mo,\n         SUM(amount_inr) AS inflow\n  FROM raw_transactions\n  WHERE status = 'success'\n    AND txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\n    AND txn_date >= DATE '2025-07-01'\n    AND txn_date <  DATE '2026-04-01'\n  GROUP BY 1\n)\nSELECT STRFTIME(mo, '%b %Y') AS month,\n       ROUND(inflow / 1e6, 1) AS inflow_m,\n       ROUND(100.0 * (inflow - LAG(inflow) OVER (ORDER BY mo))\n             / LAG(inflow) OVER (ORDER BY mo), 1) AS mom_growth_pct\nFROM m\nORDER BY mo;",
          description: "Month-on-month inflow growth (LAG window) showing the Q4 acceleration",
          rowCount: 9,
          executionTimeMs: 871,
          columns: ["month", "inflow_m", "mom_growth_pct"],
          data: [
            { month: "Jul 2025", inflow_m: 107.2, mom_growth_pct: null },
            { month: "Aug 2025", inflow_m: 112.5, mom_growth_pct: 4.9 },
            { month: "Sep 2025", inflow_m: 115.9, mom_growth_pct: 3.0 },
            { month: "Oct 2025", inflow_m: 116.1, mom_growth_pct: 0.2 },
            { month: "Nov 2025", inflow_m: 119.2, mom_growth_pct: 2.7 },
            { month: "Dec 2025", inflow_m: 134.5, mom_growth_pct: 12.8 },
            { month: "Jan 2026", inflow_m: 156.9, mom_growth_pct: 16.6 },
            { month: "Feb 2026", inflow_m: 204.2, mom_growth_pct: 30.2 },
            { month: "Mar 2026", inflow_m: 235.5, mom_growth_pct: 15.3 },
          ],
        },
      ],
    },
    "rev-opt": {
      summary:
        "Gross purchase inflow is ₹3,070.1M across 9 categories (61.7% equity-style) against ₹863.3M redeemed (3.6x). Net of redemptions ELSS leads at ₹730.5M and liquid is net-negative (-₹132.5M) by design.",
      queries: [
        {
          sql: "SELECT f.category,\n       ROUND(SUM(t.amount_inr) / 1e6, 1) AS inflow_m,\n       ROUND(100.0 * SUM(t.amount_inr) / SUM(SUM(t.amount_inr)) OVER (), 1) AS share_pct\nFROM raw_transactions t\nJOIN raw_funds f ON t.fund_id = f.fund_id\nWHERE t.status = 'success'\n  AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\nGROUP BY f.category\nORDER BY inflow_m DESC;",
          description: "Purchase inflow and share by fund category",
          rowCount: 9,
          executionTimeMs: 631,
          columns: ["category", "inflow_m", "share_pct"],
          data: [
            { category: "equity", inflow_m: 879.6, share_pct: 28.7 },
            { category: "elss", inflow_m: 765.3, share_pct: 24.9 },
            { category: "debt", inflow_m: 417.3, share_pct: 13.6 },
            { category: "daaf", inflow_m: 283.7, share_pct: 9.2 },
            { category: "liquid", inflow_m: 238.6, share_pct: 7.8 },
            { category: "global", inflow_m: 163.5, share_pct: 5.3 },
            { category: "gold", inflow_m: 161.0, share_pct: 5.2 },
            { category: "index", inflow_m: 84.7, share_pct: 2.8 },
            { category: "hybrid", inflow_m: 76.3, share_pct: 2.5 },
          ],
        },
        {
          sql: "SELECT ROUND(100.0 * SUM(t.amount_inr) FILTER (\n         WHERE f.category IN ('equity', 'elss', 'global', 'index')\n       ) / SUM(t.amount_inr), 1) AS equity_style_pct\nFROM raw_transactions t\nJOIN raw_funds f ON t.fund_id = f.fund_id\nWHERE t.status = 'success'\n  AND t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase');",
          description: "Equity-style share of total inflow",
          rowCount: 1,
          executionTimeMs: 558,
          columns: ["equity_style_pct"],
          data: [{ equity_style_pct: 61.7 }],
        },
        {
          sql: "SELECT ROUND(SUM(amount_inr) / 1e6, 1) AS redeemed_m\nFROM raw_transactions\nWHERE status = 'success'\n  AND txn_type = 'redemption';",
          description: "Total successful redemption outflow",
          rowCount: 1,
          executionTimeMs: 412,
          columns: ["redeemed_m"],
          data: [{ redeemed_m: 863.3 }],
        },
        {
          sql: "WITH flows AS (\n  SELECT f.category,\n         SUM(t.amount_inr) FILTER (\n           WHERE t.txn_type IN ('sip_installment', 'lumpsum', 'stp_purchase')\n         ) AS inflow,\n         SUM(t.amount_inr) FILTER (WHERE t.txn_type = 'redemption') AS outflow\n  FROM raw_transactions t\n  JOIN raw_funds f ON t.fund_id = f.fund_id\n  WHERE t.status = 'success'\n  GROUP BY f.category\n)\nSELECT category,\n       ROUND(inflow / 1e6, 1) AS inflow_m,\n       ROUND(COALESCE(outflow, 0) / 1e6, 1) AS outflow_m,\n       ROUND((inflow - COALESCE(outflow, 0)) / 1e6, 1) AS net_m\nFROM flows\nORDER BY net_m DESC;",
          description: "Net flow by category (gross inflow minus redemptions)",
          rowCount: 9,
          executionTimeMs: 743,
          columns: ["category", "inflow_m", "outflow_m", "net_m"],
          data: [
            { category: "elss", inflow_m: 765.3, outflow_m: 34.8, net_m: 730.5 },
            { category: "equity", inflow_m: 879.6, outflow_m: 368.1, net_m: 511.5 },
            { category: "debt", inflow_m: 417.3, outflow_m: 16.1, net_m: 401.2 },
            { category: "daaf", inflow_m: 283.7, outflow_m: 11.9, net_m: 271.7 },
            { category: "gold", inflow_m: 161.0, outflow_m: 6.8, net_m: 154.2 },
            { category: "global", inflow_m: 163.5, outflow_m: 46.9, net_m: 116.6 },
            { category: "index", inflow_m: 84.7, outflow_m: 4.1, net_m: 80.7 },
            { category: "hybrid", inflow_m: 76.3, outflow_m: 3.5, net_m: 72.8 },
            { category: "liquid", inflow_m: 238.6, outflow_m: 371.1, net_m: -132.5 },
          ],
        },
        {
          sql: "SELECT STRFTIME(DATE_TRUNC('month', txn_date), '%b %Y') AS month,\n       ROUND(SUM(amount_inr) / 1e6, 1) AS redeemed_m\nFROM raw_transactions\nWHERE status = 'success'\n  AND txn_type = 'redemption'\n  AND txn_date >= DATE '2025-07-01'\n  AND txn_date <  DATE '2026-04-01'\nGROUP BY DATE_TRUNC('month', txn_date)\nORDER BY DATE_TRUNC('month', txn_date);",
          description: "Monthly redemption outflow trend (rising but slower than inflow)",
          rowCount: 9,
          executionTimeMs: 596,
          columns: ["month", "redeemed_m"],
          data: [
            { month: "Jul 2025", redeemed_m: 38.5 },
            { month: "Aug 2025", redeemed_m: 40.9 },
            { month: "Sep 2025", redeemed_m: 43.4 },
            { month: "Oct 2025", redeemed_m: 44.6 },
            { month: "Nov 2025", redeemed_m: 50.4 },
            { month: "Dec 2025", redeemed_m: 52.3 },
            { month: "Jan 2026", redeemed_m: 56.7 },
            { month: "Feb 2026", redeemed_m: 54.3 },
            { month: "Mar 2026", redeemed_m: 61.4 },
          ],
        },
      ],
    },
    "user-segmentation": {
      summary:
        "ELSS SIP creation runs 1,186/month in Jan-Mar vs 346/month the rest of the year (3.4x), which is what drives the Feb-Mar inflow spike from existing investors.",
      queries: [
        {
          sql: "WITH season AS (\n  SELECT CASE WHEN EXTRACT(month FROM s.start_date) IN (1, 2, 3)\n              THEN 'jan_mar' ELSE 'rest' END AS window,\n         COUNT(*) AS sips_created,\n         COUNT(DISTINCT EXTRACT(month FROM s.start_date)) AS n_months\n  FROM raw_sips s\n  JOIN raw_funds f ON s.fund_id = f.fund_id\n  WHERE f.category = 'elss'\n  GROUP BY 1\n)\nSELECT window, sips_created, n_months,\n       ROUND(sips_created::DOUBLE / n_months) AS per_month\nFROM season;",
          description: "ELSS SIP creation per month: Jan-Mar vs rest of year",
          rowCount: 2,
          executionTimeMs: 369,
          columns: ["window", "sips_created", "n_months", "per_month"],
          data: [
            { window: "jan_mar", sips_created: 3559, n_months: 3, per_month: 1186 },
            { window: "rest", sips_created: 3113, n_months: 9, per_month: 346 },
          ],
        },
        {
          sql: "SELECT STRFTIME(DATE_TRUNC('month', txn_date), '%b %Y') AS month,\n       ROUND(SUM(amount_inr) FILTER (WHERE txn_type = 'sip_installment') / 1e6, 1) AS sip_m,\n       ROUND(SUM(amount_inr) FILTER (WHERE txn_type = 'lumpsum') / 1e6, 1) AS lumpsum_m\nFROM raw_transactions\nWHERE status = 'success'\n  AND txn_date >= DATE '2025-12-01'\n  AND txn_date <  DATE '2026-04-01'\nGROUP BY DATE_TRUNC('month', txn_date)\nORDER BY DATE_TRUNC('month', txn_date);",
          description: "SIP vs lumpsum inflow through the tax season (lumpsum drives the spike)",
          rowCount: 4,
          executionTimeMs: 624,
          columns: ["month", "sip_m", "lumpsum_m"],
          data: [
            { month: "Dec 2025", sip_m: 65.6, lumpsum_m: 53.4 },
            { month: "Jan 2026", sip_m: 65.8, lumpsum_m: 74.1 },
            { month: "Feb 2026", sip_m: 66.6, lumpsum_m: 121.2 },
            { month: "Mar 2026", sip_m: 68.5, lumpsum_m: 147.5 },
          ],
        },
      ],
    },
  },
});

export const FUNDSINDIA_STARTER_CHATS: StarterChat[] = [
  sipCancellations,
  fundCategoryMix,
  cohortWorth,
  funnelLeak,
  nachVsUpi,
  preRedemptionSave,
  aumGrowth,
];
