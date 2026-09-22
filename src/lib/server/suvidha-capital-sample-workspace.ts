import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { suvidhaCapitalDataset } from "@/lib/datasets/suvidha-capital";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";
import { getPlaybook, upsertPlaybook } from "@/lib/server/playbook-repo";
import type { PlaybookV2 } from "@/lib/playbook-types";

export const SUVIDHA_CAPITAL_DATASET_ID = "suvidha-capital";
// Full data window (Jun 2024 – May 2026) for origination, repayment & collections journeys.
const DATA_RANGE = { start: "2024-06-01", end: "2026-05-31" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `sc_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, SUVIDHA_CAPITAL_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  const row = result.rows[0] as Record<string, unknown>;
  return Number(row.n) || 0;
}

// ─────────────────────────────────────────────────────────────────────
// SEGMENTS: borrower-grained (borrowers_full), borrower_id is the entity.
// borrowers_full is one row per borrower with rolled-up loan + repayment
// behavior, so segments never double-count multi-loan borrowers.
// ─────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  {
    slug: "active-borrowers",
    name: "Active Borrowers",
    description: "Borrowers with at least one live (active or NPA) loan on the book. The core servicing base.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE active_loans > 0",
  },
  {
    slug: "npa-borrowers",
    name: "NPA Borrowers (Stage 3)",
    description: "Borrowers with a non-performing loan (90+ DPD, IndAS Stage 3). Highest-priority recovery list.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE has_npa = true",
  },
  {
    slug: "dpd-90-plus",
    name: "DPD 90+ Borrowers",
    description: "Borrowers whose worst loan has slipped into the 90/180/360+ DPD buckets. Legal and repossession candidates.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE worst_dpd_bucket IN ('npa_90','npa_180','npa_360_plus')",
  },
  {
    slug: "dpd-30-plus",
    name: "DPD 30+ (SMA-1 / SMA-2 / NPA)",
    description: "Borrowers 30+ days past due across SMA-1, SMA-2 and NPA buckets. Early-warning collections pool.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE worst_dpd_bucket IN ('sma_1','sma_2','npa_90','npa_180','npa_360_plus')",
  },
  {
    slug: "early-delinquent-sma0",
    name: "Early Delinquent (SMA-0, 1-30 DPD)",
    description: "Borrowers whose worst loan is in the 1-30 DPD bucket — first-bounce stage where a soft reminder call is most effective.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE worst_dpd_bucket = 'sma_0'",
  },
  {
    slug: "chronic-bouncers",
    name: "Chronic Bouncers (Bounce Rate ≥ 20%)",
    description: "Borrowers who bounce at least 1 in 5 EMIs across their repayment history (min 6 EMIs). A persistent mandate-quality problem.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE total_emis >= 6 AND bounce_rate_pct >= 20",
  },
  {
    slug: "clean-payers",
    name: "Clean Payers (Zero Bounces)",
    description: "Borrowers with a perfect repayment record (no bounced EMI, min 6 EMIs paid). The most creditworthy base for cross-sell.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE paid_emis >= 6 AND bounced_emis = 0",
  },
  {
    slug: "crosssell-eligible",
    name: "Cross-sell Eligible (Pre-approved Quality)",
    description: "Active borrowers with clean repayment (bounce rate < 5%) and no NPA — the pre-approved target pool for personal-loan cross-sell.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE active_loans > 0 AND has_npa = false AND (bounce_rate_pct < 5 OR bounce_rate_pct IS NULL)",
  },
  {
    slug: "ntc-active",
    name: "New-to-Credit Borrowers (Active)",
    description: "Active borrowers with no prior bureau history (NTC, bureau_score = 0). Underwritten on income and dealer relationship.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE is_ntc = true AND active_loans > 0",
  },
  {
    slug: "self-employed-active",
    name: "Self-Employed Borrowers (Active)",
    description: "Active borrowers with self-employed informal or formal income — the bulk of the consumer-finance book.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE employment_type LIKE 'self_employed%' AND active_loans > 0",
  },
  {
    slug: "ews-borrowers",
    name: "EWS Borrowers (< ₹25K/month)",
    description: "Economically weaker section borrowers — the thinnest-margin, highest-touch collections cohort.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE income_category = 'ews'",
  },
  {
    slug: "two-wheeler-borrowers",
    name: "Two-Wheeler Borrowers",
    description: "Borrowers financing a new or used two-wheeler — the anchor product of the dealer-network book.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE product_type IN ('two_wheeler','used_two_wheeler')",
  },
  {
    slug: "repeat-borrowers",
    name: "Repeat Borrowers",
    description: "Borrowers on their second or third loan with Suvidha — proven relationships and prime cross-sell/upgrade targets.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE is_repeat_borrower = true",
  },
  {
    slug: "repossession-cases",
    name: "Repossession Cases",
    description: "Borrowers who have had a financed asset repossessed after severe delinquency. Legal-recovery and write-off watch.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE ever_repossessed = true",
  },
  {
    slug: "recently-disbursed",
    name: "Recently Disbursed (Last 90 Days)",
    description: "Borrowers disbursed since Mar 2026 — fresh vintage for onboarding, first-EMI monitoring and welcome calls.",
    sql: "SELECT borrower_id FROM borrowers_full WHERE latest_disbursement_date >= DATE '2026-03-01'",
  },
];

// ─────────────────────────────────────────────────────────────────────
// FUNNELS: use EventDefinition IDs from suvidha-capital.ts
// ─────────────────────────────────────────────────────────────────────
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "application-to-disbursed",
    name: "Application → Disbursed",
    description: "Loan application submitted → loan disbursed. The origination funnel: how much of the applied population clears underwriting and actually books a loan.",
    config: {
      steps: [{ eventId: "application_submitted" }, { eventId: "loan_disbursed" }],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "crosssell-offer-to-disbursed",
    name: "Cross-sell: Offer → Accepted → Disbursed",
    description: "Pre-approved personal-loan offer sent → accepted → disbursed. The cross-sell conversion journey; the accepted-to-disbursed gap is the drop-off after intent.",
    config: {
      steps: [
        { eventId: "crosssell_offer_sent" },
        { eventId: "crosssell_accepted" },
        { eventId: "crosssell_disbursed" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "channel",
    },
  },
  {
    slug: "emi-repayment-quality",
    name: "EMI Repayment Quality",
    description: "EMI due → EMI paid → EMI paid on time. Repayment discipline across the serviced book: the gap from paid to on-time is the early-warning signal.",
    config: {
      steps: [
        { eventId: "emi_due" },
        { eventId: "emi_paid" },
        { eventId: "emi_paid_on_time" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "collections-recovery",
    name: "Collections: Call → Promise → Resolved",
    description: "Collection call placed → promise to pay secured → case resolved. The cure cascade of the collections workflow; a single call rarely resolves on its own.",
    config: {
      steps: [
        { eventId: "collection_call" },
        { eventId: "promise_to_pay" },
        { eventId: "collection_resolved" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "disbursement-to-ontime",
    name: "Disbursement → First On-Time EMI",
    description: "Loan disbursed → first on-time EMI. Activation quality of fresh vintages — the share of new loans that start clean on repayment.",
    config: {
      steps: [{ eventId: "loan_disbursed" }, { eventId: "emi_paid_on_time" }],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "delinquency-cascade",
    name: "Delinquency Cascade by Product",
    description: "EMI bounced → collection call → promise to pay → resolved, split by product type. Traces how a bounce converts into recovery effort and eventual cure across the product mix.",
    config: {
      steps: [
        { eventId: "emi_bounced" },
        { eventId: "collection_call" },
        { eventId: "promise_to_pay" },
        { eventId: "collection_resolved" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "product_type",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────
// RETENTIONS: use EventDefinition IDs from suvidha-capital.ts
// ─────────────────────────────────────────────────────────────────────
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "emi-payment-repeat",
    name: "EMI Payment Repeat",
    description: "Whether a borrower who pays an EMI keeps paying in following cycles. Core repayment-stickiness curve.",
    config: {
      startEventId: "emi_paid",
      returnEventIds: ["emi_paid"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "on-time-payment-retention",
    name: "On-Time Payment Retention",
    description: "Whether borrowers who pay on time stay on time. Tracks erosion of repayment discipline across the book.",
    config: {
      startEventId: "emi_paid_on_time",
      returnEventIds: ["emi_paid_on_time"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "delinquency-cure",
    name: "Delinquency Cure",
    description: "After a bounced EMI, two return curves side by side: any subsequent payment (a cure) vs an on-time payment (a clean cure). The gap is the pool that recovers but stays chronically late.",
    config: {
      startEventId: "emi_bounced",
      returnEventIds: ["emi_paid", "emi_paid_on_time"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, suvidhaCapitalDataset, SUVIDHA_CAPITAL_DATASET_ID);
}

async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, suvidhaCapitalDataset, SUVIDHA_CAPITAL_DATASET_ID);
}

export async function seedSuvidhaCapitalSampleWorkspace(userId: string): Promise<{
  segments: number;
  funnels: number;
  retentions: number;
  voiceCampaigns: number;
}> {
  let segmentCount = 0;
  for (const segment of SEGMENTS) {
    try {
      const userCount = await countSegment(segment.sql);
      upsertSegment(userId, {
        id: seedId(userId, "seg", segment.slug),
        name: segment.name,
        description: segment.description,
        sql: segment.sql,
        userCount,
        datasetId: SUVIDHA_CAPITAL_DATASET_ID,
      });
      segmentCount++;
    } catch (err) {
      console.warn(`[suvidha-capital-seed] segment ${segment.slug} failed:`, err);
    }
  }

  let funnelCount = 0;
  for (const funnel of FUNNELS.slice(0, 3)) {
    try {
      const overallConversion = await funnelConversion(funnel.config);
      upsertFunnel(userId, {
        id: seedId(userId, "fun", funnel.slug),
        name: funnel.name,
        description: funnel.description,
        config: funnel.config,
        source: "auto",
        overallConversion,
        datasetId: SUVIDHA_CAPITAL_DATASET_ID,
      });
      funnelCount++;
    } catch (err) {
      console.warn(`[suvidha-capital-seed] funnel ${funnel.slug} failed:`, err);
    }
  }

  let retentionCount = 0;
  for (const retention of RETENTIONS.slice(0, 3)) {
    try {
      const d7 = await d7Retention(retention.config);
      upsertRetention(userId, {
        id: seedId(userId, "ret", retention.slug),
        name: retention.name,
        description: retention.description,
        config: retention.config,
        source: "auto",
        d7Retention: d7,
        datasetId: SUVIDHA_CAPITAL_DATASET_ID,
      });
      retentionCount++;
    } catch (err) {
      console.warn(`[suvidha-capital-seed] retention ${retention.slug} failed:`, err);
    }
  }

  // Voice campaigns are created manually per workspace; not seeded.
  const voiceCampaignCount = 0;

  return {
    segments: segmentCount,
    funnels: funnelCount,
    retentions: retentionCount,
    voiceCampaigns: voiceCampaignCount,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAYBOOK 1: Collections Prioritization & Recovery Watchlist
// ══════════════════════════════════════════════════════════════════════════════

const COLLECTIONS_PLAYBOOK_SLUG = "collections-prioritization";

export function buildSuvidhaCollectionsPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", COLLECTIONS_PLAYBOOK_SLUG);
  return {
    id,
    schemaVersion: 2,
    name: "Collections Prioritization & Recovery Watchlist",
    description:
      "Size the delinquent book by DPD bucket and overdue value, measure how each collection action type converts to a kept promise and a cure, and rank the borrowers where recovery effort should concentrate.",
    category: "Collections",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: SUVIDHA_CAPITAL_DATASET_ID,
    sourceQuery:
      "Show me our delinquent book by DPD bucket and overdue value, which collection actions actually work, and the borrowers we should prioritise for recovery.",
    params: [
      { name: "min_overdue", label: "Min overdue for watchlist (₹)", type: "integer", defaultVal: "10000", group: "Output" },
      { name: "watchlist_limit", label: "Watchlist rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "delinquency_readiness",
        description: "Confirms the live book, EMI ledger and collection-action history all exist before running.",
      },
      {
        name: "dpd_book",
        description: "Loan count and overdue value by DPD bucket across the live book, with each bucket's share.",
      },
      {
        name: "action_effectiveness",
        description: "For each collection action type, volume and the share of actions that secured a promise-to-pay or resolution.",
      },
      {
        name: "recovery_watchlist",
        description: "Highest-overdue delinquent borrowers ranked for recovery, with DPD, product, bounce history and location.",
      },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Collections Inputs",
        description: "Confirm the live book, EMI ledger and collection-action history are all populated.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["delinquency_readiness"],
        sql: `WITH checks AS (
  SELECT 'live_book_loans' AS check_name, COUNT(*) AS record_count FROM loans_full WHERE loan_status IN ('active','npa')
  UNION ALL
  SELECT 'delinquent_loans', COUNT(*) FROM loans_full WHERE loan_status IN ('active','npa') AND dpd_bucket <> 'current'
  UNION ALL
  SELECT 'collection_actions', COUNT(*) FROM collections_actions_full
)
SELECT check_name, record_count, CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status FROM checks`,
      },
      {
        id: "c2_dpd_book",
        label: "Size the Delinquent Book",
        description: "Loan count and overdue value by DPD bucket across the live book, ordered along the roll path with each bucket's share of overdue.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["dpd_book"],
        sql: `WITH b AS (
  SELECT dpd_bucket, COUNT(*) AS loans, SUM(overdue_amount) AS overdue
  FROM loans_full
  WHERE loan_status IN ('active','npa') AND dpd_bucket <> 'current'
  GROUP BY dpd_bucket
)
SELECT
  dpd_bucket,
  loans,
  ROUND(overdue, 0) AS overdue,
  ROUND(100.0 * overdue / SUM(overdue) OVER (), 1) AS pct_of_overdue
FROM b
ORDER BY CASE dpd_bucket
  WHEN 'sma_0' THEN 1 WHEN 'sma_1' THEN 2 WHEN 'sma_2' THEN 3
  WHEN 'npa_90' THEN 4 WHEN 'npa_180' THEN 5 WHEN 'npa_360_plus' THEN 6 ELSE 9 END`,
      },
      {
        id: "c3_action_effectiveness",
        label: "Which Collection Actions Work",
        description: "For each action type, total volume and the share that secured a promise-to-pay or a resolution.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["action_effectiveness"],
        sql: `SELECT
  action_type,
  COUNT(*) AS actions,
  ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'promise_to_pay') / COUNT(*), 1) AS promise_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'resolved') / COUNT(*), 1) AS resolved_rate_pct
FROM collections_actions_full
GROUP BY action_type
ORDER BY actions DESC`,
      },
      {
        id: "c4_watchlist",
        label: "Build Recovery Watchlist",
        description: "Highest-overdue delinquent borrowers ranked for recovery effort, with DPD, product, lifetime bounce history and location.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dpd_book"],
        outputs: ["recovery_watchlist"],
        sql: `SELECT
  bf.borrower_id,
  bf.worst_dpd_bucket,
  bf.max_current_dpd,
  ROUND(bf.total_overdue, 0) AS total_overdue,
  bf.primary_product_type,
  bf.bounced_emis,
  ROUND(bf.bounce_rate_pct, 1) AS bounce_rate_pct,
  bf.state,
  bf.city_tier
FROM borrowers_full bf
WHERE bf.has_npa = true
  AND bf.total_overdue >= {{min_overdue}}
ORDER BY bf.total_overdue DESC
LIMIT {{watchlist_limit}}`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded collections prioritization and recovery watchlist for Suvidha Capital.",
        changes: [
          {
            type: "add",
            cellLabel: "Build Recovery Watchlist",
            cellId: "c4_watchlist",
            detail: "Ranks NPA borrowers by overdue value for recovery effort, with DPD, product, bounce history and location.",
          },
        ],
      },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAYBOOK 2: Cross-sell Targeting & Pre-approved Personal Loans
// ══════════════════════════════════════════════════════════════════════════════

const CROSSSELL_PLAYBOOK_SLUG = "crosssell-targeting";

export function buildSuvidhaCrosssellPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", CROSSSELL_PLAYBOOK_SLUG);
  return {
    id,
    schemaVersion: 2,
    name: "Cross-sell Targeting & Pre-approved Personal Loans",
    description:
      "Measure how the pre-approved personal-loan funnel converts by channel, and build a fresh eligibility pool of clean-repayment borrowers who have not yet been offered — the highest-propensity list for the next campaign.",
    category: "Cross-sell",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: SUVIDHA_CAPITAL_DATASET_ID,
    sourceQuery:
      "How is our pre-approved personal-loan cross-sell converting by channel, and which clean borrowers should we target next?",
    params: [
      { name: "min_ontime_rate", label: "Min on-time rate for eligibility (%)", type: "integer", defaultVal: "90", group: "Eligibility" },
      { name: "target_limit", label: "Target list rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "crosssell_readiness",
        description: "Confirms cross-sell offers and the borrower base exist before running.",
      },
      {
        name: "channel_funnel",
        description: "Offer → accepted → disbursed conversion for each outreach channel (Saathi app, SMS, telecalling).",
      },
      {
        name: "target_pool",
        description: "Clean-repayment active borrowers with no live cross-sell offer — ranked eligibility list for the next campaign.",
      },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Cross-sell Inputs",
        description: "Confirm the cross-sell offer history and borrower base are populated.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["crosssell_readiness"],
        sql: `WITH checks AS (
  SELECT 'crosssell_offers' AS check_name, COUNT(*) AS record_count FROM crosssell_full
  UNION ALL
  SELECT 'borrowers', COUNT(*) FROM borrowers_full
  UNION ALL
  SELECT 'clean_active_borrowers', COUNT(*) FROM borrowers_full WHERE active_loans > 0 AND has_npa = false
)
SELECT check_name, record_count, CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status FROM checks`,
      },
      {
        id: "c2_channel_funnel",
        label: "Cross-sell Funnel by Channel",
        description: "Offer → accepted → disbursed conversion for each outreach channel.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["channel_funnel"],
        sql: `SELECT
  channel,
  COUNT(*) AS offers,
  COUNT(*) FILTER (WHERE accepted_date IS NOT NULL) AS accepted,
  COUNT(*) FILTER (WHERE status = 'disbursed') AS disbursed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE accepted_date IS NOT NULL) / COUNT(*), 1) AS accept_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'disbursed') / COUNT(*), 1) AS conversion_pct
FROM crosssell_full
GROUP BY channel
ORDER BY offers DESC`,
      },
      {
        id: "c3_target_pool",
        label: "Build Next-Campaign Target Pool",
        description: "Active borrowers with strong on-time repayment and no NPA who have never received a cross-sell offer — ranked by repayment quality and exposure.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["target_pool"],
        sql: `SELECT
  bf.borrower_id,
  bf.income_category,
  bf.employment_type,
  ROUND(bf.ontime_rate_pct, 1) AS ontime_rate_pct,
  bf.paid_emis,
  ROUND(bf.active_exposure, 0) AS active_exposure,
  bf.state,
  bf.city_tier
FROM borrowers_full bf
WHERE bf.active_loans > 0
  AND bf.has_npa = false
  AND bf.paid_emis >= 6
  AND bf.ontime_rate_pct >= {{min_ontime_rate}}
  AND bf.borrower_id NOT IN (SELECT borrower_id FROM crosssell_full)
ORDER BY bf.ontime_rate_pct DESC, bf.active_exposure DESC
LIMIT {{target_limit}}`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded cross-sell targeting and pre-approved personal-loan pool for Suvidha Capital.",
        changes: [
          {
            type: "add",
            cellLabel: "Build Next-Campaign Target Pool",
            cellId: "c3_target_pool",
            detail: "Builds a clean-repayment, no-NPA, never-offered borrower pool ranked for the next cross-sell campaign.",
          },
        ],
      },
    ],
  };
}

export function seedSuvidhaCapitalPlaybooks(userId: string): number {
  const playbooks = [
    buildSuvidhaCollectionsPlaybook(userId),
    buildSuvidhaCrosssellPlaybook(userId),
  ];
  let seeded = 0;
  for (const playbook of playbooks) {
    if (getPlaybook(userId, playbook.id)) continue;
    upsertPlaybook(userId, playbook);
    seeded += 1;
  }
  return seeded;
}
