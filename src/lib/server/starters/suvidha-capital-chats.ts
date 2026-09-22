import { normalThread, type StarterChat } from "@/lib/server/starter-chats";

// Authored demo threads for the suvidha-capital dataset: a consumer/vehicle
// finance NBFC lending across two-wheelers, consumer durables, used cars and
// pre-approved personal loans through a ~2,500-dealer network. Every figure is
// pulled from the dataset's own DuckDB and validated.

const normals: StarterChat[] = [
  normalThread({
    slug: "book-health-dpd-overdue",
    title: "How healthy is the book, and where does the overdue sit?",
    question: "What's our GNPA right now, and which DPD buckets are carrying the overdue?",
    primaryAgent: { id: "data-quality", name: "Data Quality Agent", icon: "shield" },
    answer: `## Book health at a glance

Consolidated **GNPA is 5.28%**: 8,151 Stage-3 loans against 154,234 live (active + NPA) accounts, on ₹276.9M of total overdue [data-quality:Q1]. For a self-employed, dealer-sourced consumer book that is squarely mid-band for the asset class — but the overdue is hardening at the deep end.

## Where the overdue sits

The six delinquency buckets carry ₹237.7M of the overdue, and it is barbell-shaped — heavy at the early SMA stages (lots of small tickets) and heavy again at the deepest NPA stages (few, large tickets) [data-quality:Q2]:

| DPD bucket | Loans | Overdue | Share |
|---|---|---|---|
| sma_0 (1-30) | 7,958 | ₹47.4M | 20% |
| sma_1 (31-60) | 7,180 | ₹42.6M | 18% |
| sma_2 (61-90) | 3,706 | ₹24.9M | 10% |
| npa_90 (90-180) | 1,114 | ₹23.7M | 10% |
| npa_180 (180-360) | 1,199 | ₹46.5M | 20% |
| npa_360_plus (>360) | 884 | ₹52.6M | 22% |

The two deepest buckets (npa_180 + npa_360_plus) hold **₹99.1M — 42% of delinquent overdue — on just 2,083 loans** [data-quality:Q2]. That is late-stage hardening: as accounts age, cures get rarer and tickets pile up at the back of the curve.

## The cushion

Scheduled-EMI collection efficiency is holding at **93.7%** in the latest month with a bounce rate of 22.1% — steady across the last six months [data-quality:Q1]. The front book is collecting well even as the back book ages, which is what keeps GNPA in the mid-single digits.

The action point is the sma_2 bucket (3,706 loans, ₹24.9M): it is the last gate before NPA classification, so stemming the roll out of sma_2 is where collections effort moves GNPA most.`,
    followUps: [
      "Which product is driving the NPA?",
      "Which dealers have the worst-performing books?",
      "How many sma_2 loans are about to roll into NPA?",
    ],
    work: {
      queries: [
        {
          sql: "SELECT COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live_loans, COUNT(*) FILTER (WHERE stage = 3) AS stage_3, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct, ROUND(SUM(overdue_amount) FILTER (WHERE loan_status IN ('active','npa')) / 1e6, 1) AS overdue_m FROM loans_full",
          description: "Consolidated GNPA (Stage-3 over live accounts) and total overdue value on the live book.",
          rowCount: 1,
          executionTimeMs: 402,
          columns: ["live_loans", "stage_3", "gnpa_pct", "overdue_m"],
          data: [{ live_loans: 154234, stage_3: 8151, gnpa_pct: 5.28, overdue_m: 276.9 }],
        },
        {
          sql: "SELECT dpd_bucket, COUNT(*) AS loans, ROUND(SUM(overdue_amount) / 1e6, 1) AS overdue_m, ROUND(100.0 * SUM(overdue_amount) / SUM(SUM(overdue_amount)) OVER (), 0) AS pct FROM loans_full WHERE loan_status IN ('active','npa') AND dpd_bucket <> 'current' GROUP BY dpd_bucket ORDER BY CASE dpd_bucket WHEN 'sma_0' THEN 1 WHEN 'sma_1' THEN 2 WHEN 'sma_2' THEN 3 WHEN 'npa_90' THEN 4 WHEN 'npa_180' THEN 5 ELSE 6 END",
          description: "Loan count and overdue value by DPD bucket across the delinquent live book, with each bucket's share.",
          rowCount: 6,
          executionTimeMs: 561,
          columns: ["dpd_bucket", "loans", "overdue_m", "pct"],
          data: [
            { dpd_bucket: "sma_0", loans: 7958, overdue_m: 47.4, pct: 20 },
            { dpd_bucket: "sma_1", loans: 7180, overdue_m: 42.6, pct: 18 },
            { dpd_bucket: "sma_2", loans: 3706, overdue_m: 24.9, pct: 10 },
            { dpd_bucket: "npa_90", loans: 1114, overdue_m: 23.7, pct: 10 },
            { dpd_bucket: "npa_180", loans: 1199, overdue_m: 46.5, pct: 20 },
            { dpd_bucket: "npa_360_plus", loans: 884, overdue_m: 52.6, pct: 22 },
          ],
        },
      ],
    },
  }),

  normalThread({
    slug: "gnpa-by-product",
    title: "Which product is driving the NPA?",
    question: "Break our GNPA down by product type — where is the risk concentrated?",
    primaryAgent: { id: "user-segmentation", name: "User Segmentation Agent", icon: "clock" },
    answer: `## The risk is concentrated in one product

The consolidated 5.28% GNPA hides a wide spread across the five products [user-segmentation:Q1]:

| Product | Live loans | Stage-3 | GNPA |
|---|---|---|---|
| Consumer durable | 25,612 | 2,992 | **11.68%** |
| Used two-wheeler | 12,225 | 705 | 5.77% |
| Two-wheeler | 78,334 | 3,553 | 4.54% |
| Personal (cross-sell) | 25,013 | 647 | 2.59% |
| Used car | 13,050 | 254 | 1.95% |

**Consumer durables run GNPA at 11.68% — roughly 2.6x the two-wheeler book and 6x the used-car book** [user-segmentation:Q1]. Small-ticket electronics financing (₹23K average) attracts thin-file, first-time borrowers and is unsecured in practice once the asset depreciates, so it defaults at a structurally higher rate.

Two-wheelers are the volume anchor (78,334 live loans) and hold a respectable 4.54%, but because of their scale they still contribute the largest absolute Stage-3 count (3,553 loans) [user-segmentation:Q1]. Used cars and cross-sell personal loans are the cleanest books.

## What this means

Consumer durables need a tighter underwriting cut or a risk-based pricing uplift — at 11.68% GNPA the segment is likely eroding its own yield. The two-wheeler book is the one to watch on absolute NPA stock given its size, even though its rate looks healthy.`,
    followUps: [
      "What are the top rejection reasons on consumer durable applications?",
      "How does consumer durable GNPA trend by disbursement vintage?",
      "Which dealers source the worst consumer durable loans?",
    ],
    work: {
      queries: [
        {
          sql: "SELECT product_type, COUNT(*) FILTER (WHERE loan_status IN ('active','npa')) AS live_loans, COUNT(*) FILTER (WHERE stage = 3) AS stage_3, ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 3) / COUNT(*) FILTER (WHERE loan_status IN ('active','npa')), 2) AS gnpa_pct FROM loans_full GROUP BY product_type ORDER BY gnpa_pct DESC",
          description: "GNPA by product type: Stage-3 count over live loans for each product.",
          rowCount: 5,
          executionTimeMs: 448,
          columns: ["product_type", "live_loans", "stage_3", "gnpa_pct"],
          data: [
            { product_type: "consumer_durable", live_loans: 25612, stage_3: 2992, gnpa_pct: 11.68 },
            { product_type: "used_two_wheeler", live_loans: 12225, stage_3: 705, gnpa_pct: 5.77 },
            { product_type: "two_wheeler", live_loans: 78334, stage_3: 3553, gnpa_pct: 4.54 },
            { product_type: "personal", live_loans: 25013, stage_3: 647, gnpa_pct: 2.59 },
            { product_type: "used_car", live_loans: 13050, stage_3: 254, gnpa_pct: 1.95 },
          ],
        },
      ],
    },
  }),

  normalThread({
    slug: "crosssell-channel-conversion",
    title: "How is our pre-approved cross-sell converting by channel?",
    question: "How is the personal-loan cross-sell funnel converting, and which channel works best?",
    primaryAgent: { id: "rev-opt", name: "Revenue Optimization Agent", icon: "dollar" },
    answer: `## Cross-sell converts the same everywhere — the app is the volume engine

Across 219,144 pre-approved personal-loan offers, **12.75% convert to a disbursed loan**, worth ₹507 crore of cross-sell disbursement [rev-opt:Q1]. The striking thing is how channel-agnostic the conversion is [rev-opt:Q1]:

| Channel | Offers | Accepted | Disbursed | Accept rate | Conversion |
|---|---|---|---|---|---|
| Saathi app | 131,462 | 23,607 | 16,810 | 18.0% | **12.8%** |
| SMS | 43,944 | 7,873 | 5,627 | 17.9% | 12.8% |
| Telecalling | 43,738 | 7,818 | 5,505 | 17.9% | 12.6% |

All three channels land within 0.2 points of each other on conversion. What differs is scale: **the Saathi app carries 60% of all offers and 60% of disbursals** — it is the distribution engine, not a better-converting one [rev-opt:Q1].

## What this means

Because conversion is flat across channels, the lever is not "shift to the app" — it is offer *quality and volume*. Two moves follow: (1) telecalling ties the app on conversion at a fraction of the volume, so there is untapped headroom to scale outbound calling on the delinquency-clean base; and (2) the ~18% accept-to-~12.8% disburse gap means roughly 3 in 10 accepted offers never fund — the accepted-but-not-disbursed pool is the cheapest re-targeting list you have.`,
    followUps: [
      "Which borrower segments convert best on cross-sell?",
      "How big is the accepted-but-not-disbursed drop-off?",
      "What does cross-sell conversion look like by income category?",
    ],
    work: {
      queries: [
        {
          sql: "SELECT channel, COUNT(*) AS offers, COUNT(*) FILTER (WHERE accepted_date IS NOT NULL) AS accepted, COUNT(*) FILTER (WHERE status = 'disbursed') AS disbursed, ROUND(100.0 * COUNT(*) FILTER (WHERE accepted_date IS NOT NULL) / COUNT(*), 1) AS accept_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'disbursed') / COUNT(*), 1) AS conversion_pct FROM crosssell_full GROUP BY channel ORDER BY offers DESC",
          description: "Cross-sell offer funnel by channel: offers, accepted, disbursed, and accept/conversion rates.",
          rowCount: 3,
          executionTimeMs: 388,
          columns: ["channel", "offers", "accepted", "disbursed", "accept_pct", "conversion_pct"],
          data: [
            { channel: "saathi_app", offers: 131462, accepted: 23607, disbursed: 16810, accept_pct: 18.0, conversion_pct: 12.8 },
            { channel: "sms", offers: 43944, accepted: 7873, disbursed: 5627, accept_pct: 17.9, conversion_pct: 12.8 },
            { channel: "telecalling", offers: 43738, accepted: 7818, disbursed: 5505, accept_pct: 17.9, conversion_pct: 12.6 },
          ],
        },
      ],
    },
  }),
];

export const SUVIDHA_CAPITAL_STARTER_CHATS: StarterChat[] = [...normals];
