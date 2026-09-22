import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { vastuHfcDataset } from "@/lib/datasets/vastu-hfc";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";
import { getPlaybook, upsertPlaybook } from "@/lib/server/playbook-repo";
import type { PlaybookV2 } from "@/lib/playbook-types";

export const VASTU_HFC_DATASET_ID = "vastu-hfc";
// EMI / collections window (Oct 2023 to Mar 2025) for repayment-led funnels & retentions.
const COLLECTIONS_RANGE = { start: "2023-10-01", end: "2025-03-31" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `vh_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, VASTU_HFC_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  const row = result.rows[0] as Record<string, unknown>;
  return Number(row.n) || 0;
}

// ─────────────────────────────────────────────────────────────────────
// SEGMENTS: handcrafted SQL, borrower_id is the entity
// ─────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  {
    slug: "active-borrowers",
    name: "Active Borrowers",
    description: "Borrowers with at least one live, performing loan on the book. The core servicing base.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE loan_status = 'active'",
  },
  {
    slug: "npa-accounts",
    name: "NPA Borrowers (Stage 3)",
    description: "Borrowers with a non-performing loan (90+ DPD, IndAS Stage 3). Highest-priority recovery list.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE stage = 3",
  },
  {
    slug: "dpd-90-plus",
    name: "DPD 90+ Buckets",
    description: "Borrowers whose loan has slipped into the 90/180/360+ DPD buckets. Legal and SARFAESI candidates.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE dpd_bucket IN ('npa_90','npa_180','npa_360_plus')",
  },
  {
    slug: "dpd-30-plus",
    name: "DPD 30+ (SMA-1 / SMA-2 / NPA)",
    description: "Borrowers 30+ days past due across SMA-1, SMA-2 and NPA buckets. Early-warning collections pool.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE dpd_bucket IN ('sma_1','sma_2','npa_90','npa_180','npa_360_plus')",
  },
  {
    slug: "early-delinquent-sma0",
    name: "Early Delinquent (SMA-0, 1-30 DPD)",
    description: "Borrowers in the 1-30 DPD bucket, first-bounce stage where soft-call recovery is most effective.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE dpd_bucket = 'sma_0'",
  },
  {
    slug: "high-ltv",
    name: "High-LTV Borrowers (LTV ≥ 75%)",
    description: "Borrowers with loan-to-value at or above 75%, thinner equity cushion, higher loss-given-default.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE ltv_ratio >= 0.75",
  },
  {
    slug: "ntc-active",
    name: "New-to-Credit Borrowers (Active)",
    description: "Active borrowers with no prior bureau history (NTC). Underwritten on the PULSE income model.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE is_ntc = true AND loan_status = 'active'",
  },
  {
    slug: "hfc-home-loan-active",
    name: "HFC Home-Loan Borrowers (Active)",
    description: "Active home-loan borrowers in the HFC entity: the core housing-finance book.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE entity = 'hfc' AND product_type LIKE 'home%' AND loan_status = 'active'",
  },
  {
    slug: "self-employed-active",
    name: "Self-Employed Borrowers (Active)",
    description: "Active borrowers with self-employed income (~81% of the book); the segment PULSE is built for.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE employment_type LIKE 'self_employed%' AND loan_status = 'active'",
  },
  {
    slug: "ews-active",
    name: "EWS Borrowers (Active)",
    description: "Active borrowers in the EWS income band (< ₹25K/month), priority-sector and affordable-housing focus.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE income_category = 'ews' AND loan_status = 'active'",
  },
  {
    slug: "prepaid-borrowers",
    name: "Prepaid / Early-Closure Borrowers",
    description: "Borrowers who closed a loan early. Prepayment-risk and balance-transfer win-back target.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE loan_status = 'prepaid'",
  },
  {
    slug: "recently-disbursed",
    name: "Recently Disbursed (Q4 FY25)",
    description: "Borrowers disbursed in Jan-Mar 2025. Fresh vintage for onboarding and first-EMI monitoring.",
    sql: "SELECT DISTINCT borrower_id FROM loans_full WHERE disbursement_date >= DATE '2025-01-01'",
  },
];

// ─────────────────────────────────────────────────────────────────────
// FUNNELS: use EventDefinition IDs from vastu-hfc.ts
// ─────────────────────────────────────────────────────────────────────
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
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
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "home-loan-on-time",
    name: "Home Loan → On-Time Repayment",
    description: "Home loan disbursed → first on-time EMI. Activation quality of the housing book over the EMI-tracked window.",
    config: {
      steps: [
        { eventId: "home_loan_disbursed" },
        { eventId: "emi_paid_on_time" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "collections-recovery",
    name: "Collections Call → Resolution",
    description: "Collection call placed → case resolved. Direct cure rate of the collections workflow; most cases need repeated touches, so a single call rarely resolves on its own.",
    config: {
      steps: [
        { eventId: "collection_call" },
        { eventId: "collection_resolved" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "disbursement-to-repayment-lifecycle",
    name: "Disbursement → On-Time → Auto-Debit Lifecycle",
    description: "Full activation journey of a fresh loan: disbursed → EMI billed → EMI paid → paid on time → paid via NACH auto-debit. Each step strips out a weaker cohort, so the final on-NACH share is the book that is both disciplined and on a stable auto-debit mandate.",
    config: {
      steps: [
        { eventId: "loan_disbursed" },
        { eventId: "emi_due" },
        { eventId: "emi_paid" },
        { eventId: "emi_paid_on_time" },
        { eventId: "emi_via_nach" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "two-cycle-repayment-discipline",
    name: "Two-Cycle Repayment Discipline",
    description: "Repayment discipline traced across two consecutive billing cycles: due → paid → paid on time, then due → paid → paid on time again. The drop between the first on-time payment and the next cycle is the early-warning signal that a performing borrower is starting to slip.",
    config: {
      steps: [
        { eventId: "emi_due" },
        { eventId: "emi_paid" },
        { eventId: "emi_paid_on_time" },
        { eventId: "emi_due" },
        { eventId: "emi_paid" },
        { eventId: "emi_paid_on_time" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "collections-cascade-by-entity",
    name: "Collections Cascade by Entity",
    description: "Collection call → promise to pay → case resolved, split by entity (HFC vs Finserve). A deep collections funnel runs low by design (a single call rarely resolves on its own), and the entity breakdown shows where the calling effort converts to a kept promise versus where it stalls.",
    config: {
      steps: [
        { eventId: "collection_call" },
        { eventId: "collection_promise_to_pay" },
        { eventId: "collection_resolved" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: COLLECTIONS_RANGE,
      breakdown: "entity",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────
// RETENTIONS: use EventDefinition IDs from vastu-hfc.ts
// ─────────────────────────────────────────────────────────────────────
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "emi-payment-repeat",
    name: "EMI Payment Repeat",
    description: "Whether a borrower who pays an EMI keeps paying in following cycles. Core repayment-stickiness metric.",
    config: {
      startEventId: "emi_paid",
      returnEventIds: ["emi_paid"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "on-time-payment-retention",
    name: "On-Time Payment Retention",
    description: "Whether borrowers who pay on time stay on time. Tracks erosion of repayment discipline over the book.",
    config: {
      startEventId: "emi_paid_on_time",
      returnEventIds: ["emi_paid_on_time"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "delinquency-cure-retention",
    name: "Delinquency Cure Retention",
    description: "Whether borrowers who miss an EMI come back and pay in a following cycle. The recovery/cure rate of the delinquent pool, a distinct cohort from on-time payers.",
    config: {
      startEventId: "emi_missed",
      returnEventIds: ["emi_paid"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: COLLECTIONS_RANGE,
    },
  },
  {
    slug: "delinquency-cure-vs-on-time",
    name: "Delinquency Cure vs Clean Cure",
    description: "After a missed EMI, two return curves side by side: any payment (a cure) versus an on-time payment in a later cycle (a clean cure). The gap between the two is the share of the recovered pool that comes back but stays chronically late, the cohort that needs sustained collections attention rather than a one-off nudge.",
    config: {
      startEventId: "emi_missed",
      returnEventIds: ["emi_paid", "emi_paid_on_time"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: COLLECTIONS_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, vastuHfcDataset, VASTU_HFC_DATASET_ID);
}

async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, vastuHfcDataset, VASTU_HFC_DATASET_ID);
}

export async function seedVastuHfcSampleWorkspace(userId: string): Promise<{
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
        datasetId: VASTU_HFC_DATASET_ID,
      });
      segmentCount++;
    } catch (err) {
      console.warn(`[vastu-hfc-seed] segment ${segment.slug} failed:`, err);
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
        datasetId: VASTU_HFC_DATASET_ID,
      });
      funnelCount++;
    } catch (err) {
      console.warn(`[vastu-hfc-seed] funnel ${funnel.slug} failed:`, err);
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
        datasetId: VASTU_HFC_DATASET_ID,
      });
      retentionCount++;
    } catch (err) {
      console.warn(`[vastu-hfc-seed] retention ${retention.slug} failed:`, err);
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
// PLAYBOOK 1: Delinquency Roll-Rate & Early-Warning
// ══════════════════════════════════════════════════════════════════════════════

const ROLL_RATE_PLAYBOOK_SLUG = "delinquency-roll-rate";

export function buildVastuRollRatePlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", ROLL_RATE_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Delinquency Roll-Rate & Early-Warning",
    description:
      "Measure month-over-month DPD bucket transitions (roll-forward and cure), build vintage delinquency curves by origination cohort, and surface the branch and product pockets where SMA stress is building before it converts to NPA.",
    category: "Asset Quality",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: VASTU_HFC_DATASET_ID,
    sourceQuery:
      "Show me our delinquency roll-rates from current to SMA to NPA, the vintage cohorts that are deteriorating, and which branches and products are building early-warning stress.",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2025-03-31", group: "Window" },
      { name: "roll_months", label: "Roll-rate window (months)", type: "integer", defaultVal: "6", group: "Window" },
      { name: "min_branch_loans", label: "Min active loans per branch pocket", type: "integer", defaultVal: "50", group: "Output" },
      { name: "watchlist_limit", label: "Watchlist rows", type: "integer", defaultVal: "40", group: "Output" },
    ],
    produces: [
      {
        name: "loan_dpd_panel",
        description:
          "Per-loan monthly worst-delinquency level over the roll-rate window, with the prior-month level for transition analysis.",
        columns: [
          { name: "loan_id", description: "Loan identifier." },
          { name: "bucket_month", description: "Calendar month of the EMI billing cycle." },
          { name: "dpd_level", description: "Worst DPD level for the loan in that month (0 on-time to 4 90+ DPD)." },
          { name: "prev_dpd_level", description: "Worst DPD level in the immediately preceding month." },
        ],
      },
      {
        name: "roll_rate_matrix",
        description: "Roll-forward and cure rates for each starting DPD level, split by entity.",
      },
      {
        name: "vintage_curves",
        description: "Stage 2 and Stage 3 share by origination cohort (FY quarter) with months-on-book seasoning.",
      },
      {
        name: "early_warning_watchlist",
        description: "Branch and product pockets ranked by SMA-1/SMA-2 concentration and overdue value.",
      },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Delinquency Inputs",
        description:
          "Confirm the live book, EMI billing history in the roll-rate window, and DPD bucket coverage all exist before running the analysis.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT
    'live_book_loans' AS check_name,
    COUNT(*) AS record_count
  FROM loans_full
  WHERE loan_status IN ('active', 'npa')
  UNION ALL
  SELECT
    'emi_rows_in_roll_window' AS check_name,
    COUNT(*) AS record_count
  FROM collections_full
  WHERE due_date > CAST({{as_of_date}} AS DATE) - (({{roll_months}} + 1) * INTERVAL '1 month')
    AND due_date <= CAST({{as_of_date}} AS DATE)
  UNION ALL
  SELECT
    'distinct_dpd_buckets' AS check_name,
    COUNT(DISTINCT collection_bucket) AS record_count
  FROM collections_full
  WHERE due_date > CAST({{as_of_date}} AS DATE) - (({{roll_months}} + 1) * INTERVAL '1 month')
    AND due_date <= CAST({{as_of_date}} AS DATE)
)
SELECT
  check_name,
  record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_dpd_panel",
        label: "Build Monthly DPD Panel",
        description:
          "For every loan, compute the worst delinquency level it touched each month, then attach the prior month's level using a window function to set up transition analysis.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["loan_dpd_panel"],
        sql: `WITH loan_month AS (
  SELECT
    loan_id,
    entity,
    product_type,
    CAST(strftime(due_date::DATE, '%Y-%m') || '-01' AS DATE) AS bucket_month,
    MAX(
      CASE collection_bucket
        WHEN 'on_time' THEN 0
        WHEN '1_30' THEN 1
        WHEN '31_60' THEN 2
        WHEN '61_90' THEN 3
        WHEN '90_plus' THEN 4
        ELSE 0
      END
    ) AS dpd_level
  FROM collections_full
  WHERE due_date > CAST({{as_of_date}} AS DATE) - (({{roll_months}} + 1) * INTERVAL '1 month')
    AND due_date <= CAST({{as_of_date}} AS DATE)
  GROUP BY loan_id, entity, product_type, bucket_month
)
SELECT
  loan_id,
  entity,
  product_type,
  bucket_month,
  dpd_level,
  LAG(dpd_level) OVER (PARTITION BY loan_id ORDER BY bucket_month) AS prev_dpd_level,
  LAG(bucket_month) OVER (PARTITION BY loan_id ORDER BY bucket_month) AS prev_bucket_month
FROM loan_month`,
      },
      {
        id: "c3_roll_matrix",
        label: "Compute Roll-Rate Matrix",
        description:
          "From consecutive-month transitions, calculate the share of loans in each DPD level that roll forward to a worse bucket, stay flat, or cure to a better bucket. This is the core leading indicator of NPA formation.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_dpd_panel"],
        outputs: ["roll_rate_matrix"],
        sql: `WITH transitions AS (
  SELECT *
  FROM loan_dpd_panel
  WHERE prev_dpd_level IS NOT NULL
    AND prev_bucket_month = bucket_month - INTERVAL '1 month'
)
SELECT
  entity,
  prev_dpd_level AS from_level,
  CASE prev_dpd_level
    WHEN 0 THEN 'Current'
    WHEN 1 THEN 'SMA-0 (1-30 DPD)'
    WHEN 2 THEN 'SMA-1 (31-60 DPD)'
    WHEN 3 THEN 'SMA-2 (61-90 DPD)'
    WHEN 4 THEN '90+ DPD'
  END AS from_bucket,
  COUNT(*) AS loan_months,
  COUNT(*) FILTER (WHERE dpd_level > prev_dpd_level) AS rolled_forward,
  COUNT(*) FILTER (WHERE dpd_level = prev_dpd_level) AS stayed_flat,
  COUNT(*) FILTER (WHERE dpd_level < prev_dpd_level) AS cured,
  ROUND(COUNT(*) FILTER (WHERE dpd_level > prev_dpd_level) * 100.0 / NULLIF(COUNT(*), 0), 2) AS roll_forward_pct,
  ROUND(COUNT(*) FILTER (WHERE dpd_level = prev_dpd_level) * 100.0 / NULLIF(COUNT(*), 0), 2) AS stay_flat_pct,
  ROUND(COUNT(*) FILTER (WHERE dpd_level < prev_dpd_level) * 100.0 / NULLIF(COUNT(*), 0), 2) AS cure_pct
FROM transitions
GROUP BY entity, prev_dpd_level
ORDER BY entity, prev_dpd_level`,
      },
      {
        id: "c4_vintage_curves",
        label: "Build Vintage Delinquency Curves",
        description:
          "Group the live book by origination FY quarter and measure Stage 2 and Stage 3 share against months-on-book, so deteriorating cohorts stand out from healthy ones at the same seasoning.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["vintage_curves"],
        sql: `WITH base AS (
  SELECT
    entity,
    loan_id,
    stage,
    disbursement_date::DATE AS disbursed_on,
    CASE
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) BETWEEN 4 AND 6 THEN 'Q1'
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) BETWEEN 7 AND 9 THEN 'Q2'
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) BETWEEN 10 AND 12 THEN 'Q3'
      ELSE 'Q4'
    END AS fy_quarter,
    CASE
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) >= 4
        THEN 'FY' || CAST((EXTRACT(YEAR FROM disbursement_date::DATE) + 1) % 100 AS VARCHAR)
      ELSE 'FY' || CAST(EXTRACT(YEAR FROM disbursement_date::DATE) % 100 AS VARCHAR)
    END AS fy
  FROM loans_full
  WHERE loan_status IN ('active', 'npa')
    AND disbursement_date IS NOT NULL
)
SELECT
  entity,
  fy || '-' || fy_quarter AS origination_cohort,
  COUNT(*) AS live_loans,
  date_diff('month', MIN(disbursed_on), CAST({{as_of_date}} AS DATE)) AS cohort_months_on_book,
  COUNT(*) FILTER (WHERE stage = 2) AS stage_2_loans,
  COUNT(*) FILTER (WHERE stage = 3) AS stage_3_loans,
  ROUND(COUNT(*) FILTER (WHERE stage = 2) * 100.0 / NULLIF(COUNT(*), 0), 3) AS stage_2_pct,
  ROUND(COUNT(*) FILTER (WHERE stage = 3) * 100.0 / NULLIF(COUNT(*), 0), 3) AS stage_3_pct
FROM base
GROUP BY entity, fy, fy_quarter
ORDER BY entity, origination_cohort`,
      },
      {
        id: "c5_watchlist",
        label: "Rank Early-Warning Pockets",
        description:
          "Score branch and product pockets on SMA-1/SMA-2 concentration and overdue value to produce an actionable watchlist of where collections capacity should move next.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["early_warning_watchlist"],
        sql: `WITH pockets AS (
  SELECT
    entity,
    state,
    branch_name,
    product_type,
    COUNT(*) AS active_loans,
    COUNT(*) FILTER (WHERE dpd_bucket IN ('sma_0', 'sma_1', 'sma_2')) AS sma_loans,
    COUNT(*) FILTER (WHERE dpd_bucket IN ('sma_1', 'sma_2')) AS late_sma_loans,
    COUNT(*) FILTER (WHERE stage = 3) AS npa_loans,
    SUM(overdue_amount) AS overdue_amount,
    SUM(disbursed_amount) AS pocket_aum
  FROM loans_full
  WHERE loan_status IN ('active', 'npa')
  GROUP BY entity, state, branch_name, product_type
  HAVING COUNT(*) >= {{min_branch_loans}}
)
SELECT
  entity,
  state,
  branch_name,
  product_type,
  active_loans,
  sma_loans,
  late_sma_loans,
  npa_loans,
  ROUND(late_sma_loans * 100.0 / NULLIF(active_loans, 0), 2) AS late_sma_pct,
  ROUND(npa_loans * 100.0 / NULLIF(active_loans, 0), 3) AS gnpa_pct,
  ROUND(overdue_amount, 0) AS overdue_amount,
  ROUND(pocket_aum, 0) AS pocket_aum
FROM pockets
ORDER BY late_sma_pct DESC, overdue_amount DESC
LIMIT {{watchlist_limit}}`,
      },
      {
        id: "c6_roll_analysis",
        label: "Diagnose Roll-Rate Signal",
        description:
          "Interpret the roll-rate matrix and vintage curves to separate normal seasonal slippage from genuine credit deterioration.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_roll_matrix", "c4_vintage_curves"],
        outputs: ["roll_rate_diagnosis"],
        prompt: `You are a credit-risk analyst at a housing finance company. Using only the upstream query results, diagnose the delinquency dynamics.

Address:
- the Current to SMA-0 roll-forward rate for each entity, and what it implies about fresh slippage from the performing book;
- how roll-forward rates evolve as loans move into deeper SMA buckets, and where the "point of no return" sits before 90+ DPD;
- cure rates by bucket: which buckets self-heal and which need active collections intervention;
- how HFC (housing) and Finserve (vehicle and MSME) differ in roll dynamics, and why that is consistent with their borrower and product mix;
- which origination cohorts in the vintage curves are seasoning worse than peers at the same months-on-book.

Quote actual percentages and loan-month counts from the tables. Do not invent numbers. Keep the framing operational, not a regulatory filing.`,
      },
      {
        id: "c7_summary",
        label: "Early-Warning Action Brief",
        description:
          "Produce the final executive brief tying roll-rates, vintage deterioration, and the branch/product watchlist into a prioritized collections action plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_roll_matrix", "c4_vintage_curves", "c5_watchlist", "c6_roll_analysis"],
        outputs: ["early_warning_brief"],
        prompt: `Create a rich, executive-ready markdown brief titled "Delinquency Roll-Rate & Early-Warning" for the collections and credit-risk leadership.

The brief must include:
1. A one-paragraph headline answer stating, as of {{as_of_date}}, the Current to SMA roll-forward rate and the deepest bucket from which loans still cure, separately for HFC and Finserve.
2. A roll-rate matrix table per entity: starting bucket, loan-months observed, roll-forward %, stay-flat %, and cure %.
3. At least two charts when the upstream rows support them:
   - roll-forward % by starting DPD bucket (HFC vs Finserve);
   - Stage 3 % by origination cohort from the vintage curves.
4. A vintage section naming the specific cohorts deteriorating fastest relative to their months-on-book.
5. An early-warning watchlist section: the top branch and product pockets by late-SMA concentration and overdue value, with a recommended action for each tier (intensify calling, field visits, restructure review).
6. A short SQL provenance note naming the source views used: collections_full and loans_full.

Use raw counts and rupee overdue values from the data. Keep recommendations operational and compliant: no assumptions about recovery beyond what the cure rates show.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded delinquency roll-rate and early-warning analysis for Vastu HFC.",
        changes: [
          {
            type: "add",
            cellLabel: "Roll-Rate Matrix",
            cellId: "c3_roll_matrix",
            detail: "Computes month-over-month DPD transitions to expose roll-forward and cure rates by bucket and entity.",
          },
        ],
      },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAYBOOK 2: Collections Effectiveness
// ══════════════════════════════════════════════════════════════════════════════

const COLLECTIONS_PLAYBOOK_SLUG = "collections-effectiveness";

export function buildVastuCollectionsPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", COLLECTIONS_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Collections Effectiveness",
    description:
      "Trace the bounce to action to promise-to-pay to cure funnel, measure how each collection action type and agent converts stress into recovery, and quantify the next-month cure rate on bounced loans so the team can see where effort actually moves money.",
    category: "Collections",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: VASTU_HFC_DATASET_ID,
    sourceQuery:
      "How effective are our collections? Show me the bounce to call to promise-to-pay to cure funnel, which agents and action types work best, and our cure rate on bounced loans.",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2025-03-31", group: "Window" },
      { name: "lookback_days", label: "Bounce lookback (days)", type: "integer", defaultVal: "180", group: "Window" },
      { name: "action_window_days", label: "Action follow-up window (days)", type: "integer", defaultVal: "45", group: "Window" },
      { name: "min_agent_actions", label: "Min actions per agent", type: "integer", defaultVal: "30", group: "Output" },
    ],
    produces: [
      {
        name: "bounced_loans",
        description: "Loans with a bounced EMI inside the lookback window, with the first bounce date and overdue value.",
        columns: [
          { name: "loan_id", description: "Loan identifier." },
          { name: "first_bounce_date", description: "Earliest bounced EMI due date in the window." },
          { name: "bounced_amount_due", description: "EMI amount on the bounced installment." },
        ],
      },
      {
        name: "collections_funnel",
        description: "Bounce to action to promise-to-pay to recovery stage counts and step conversion rates by entity.",
      },
      {
        name: "action_type_effectiveness",
        description: "Outcome mix and success rate for each collection action type (call, field visit, notices, SARFAESI).",
      },
      {
        name: "agent_effectiveness",
        description: "Per-agent action volume, promise-to-pay and recovery counts, and success rate.",
      },
      {
        name: "cure_rate",
        description: "Share of bounced loans that return to on-time status the following month, by entity.",
      },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Collections Inputs",
        description:
          "Confirm bounced EMIs, collection actions in the window, and agent coverage all exist before running the funnel.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT
    'bounced_emis_in_window' AS check_name,
    COUNT(*) AS record_count
  FROM collections_full
  WHERE bounce = true
    AND due_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
    AND due_date <= CAST({{as_of_date}} AS DATE)
  UNION ALL
  SELECT
    'collection_actions_in_window' AS check_name,
    COUNT(*) AS record_count
  FROM collections_actions_full
  WHERE action_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
    AND action_date <= CAST({{as_of_date}} AS DATE)
  UNION ALL
  SELECT
    'distinct_agents' AS check_name,
    COUNT(DISTINCT agent_id) AS record_count
  FROM collections_actions_full
)
SELECT
  check_name,
  record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_bounced_loans",
        label: "Build Bounced Loan Base",
        description:
          "Identify every loan with at least one bounced EMI in the lookback window and capture the first bounce date that starts the recovery clock.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["bounced_loans"],
        sql: `SELECT
  loan_id,
  entity,
  product_type,
  state,
  branch_name,
  MIN(due_date) AS first_bounce_date,
  COUNT(*) AS bounced_installments,
  SUM(amount_due) AS bounced_amount_due
FROM collections_full
WHERE bounce = true
  AND due_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
  AND due_date <= CAST({{as_of_date}} AS DATE)
GROUP BY loan_id, entity, product_type, state, branch_name`,
      },
      {
        id: "c3_funnel",
        label: "Build Recovery Funnel",
        description:
          "Join bounced loans to collection actions taken within the follow-up window to measure the bounce to action to promise-to-pay to recovery conversion at each step.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_bounced_loans"],
        outputs: ["collections_funnel"],
        sql: `WITH bounced AS (
  SELECT * FROM bounced_loans
),
actioned AS (
  SELECT DISTINCT b.loan_id
  FROM bounced b
  JOIN collections_actions_full a
    ON a.loan_id = b.loan_id
   AND a.action_date >= b.first_bounce_date
   AND a.action_date <= b.first_bounce_date + ({{action_window_days}} * INTERVAL '1 day')
),
promised AS (
  SELECT DISTINCT b.loan_id
  FROM bounced b
  JOIN collections_actions_full a
    ON a.loan_id = b.loan_id
   AND a.result = 'promise_to_pay'
   AND a.action_date >= b.first_bounce_date
   AND a.action_date <= b.first_bounce_date + ({{action_window_days}} * INTERVAL '1 day')
),
recovered AS (
  SELECT DISTINCT b.loan_id
  FROM bounced b
  JOIN collections_actions_full a
    ON a.loan_id = b.loan_id
   AND a.result IN ('resolved', 'partial_payment')
   AND a.action_date >= b.first_bounce_date
   AND a.action_date <= b.first_bounce_date + ({{action_window_days}} * INTERVAL '1 day')
)
SELECT
  b.entity,
  COUNT(DISTINCT b.loan_id) AS bounced_loans,
  COUNT(DISTINCT ac.loan_id) AS actioned_loans,
  COUNT(DISTINCT p.loan_id) AS promise_to_pay_loans,
  COUNT(DISTINCT r.loan_id) AS recovered_loans,
  ROUND(COUNT(DISTINCT ac.loan_id) * 100.0 / NULLIF(COUNT(DISTINCT b.loan_id), 0), 2) AS action_coverage_pct,
  ROUND(COUNT(DISTINCT p.loan_id) * 100.0 / NULLIF(COUNT(DISTINCT ac.loan_id), 0), 2) AS action_to_ptp_pct,
  ROUND(COUNT(DISTINCT r.loan_id) * 100.0 / NULLIF(COUNT(DISTINCT p.loan_id), 0), 2) AS ptp_to_recovery_pct,
  ROUND(SUM(b.bounced_amount_due), 0) AS bounced_amount_due
FROM bounced b
LEFT JOIN actioned ac ON b.loan_id = ac.loan_id
LEFT JOIN promised p ON b.loan_id = p.loan_id
LEFT JOIN recovered r ON b.loan_id = r.loan_id
GROUP BY b.entity
ORDER BY b.entity`,
      },
      {
        id: "c4_action_effectiveness",
        label: "Score Action Types",
        description:
          "Break every collection action in the window by type and outcome to show which levers (calls, field visits, demand notices, legal, SARFAESI) convert stress into a promise or a payment.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["action_type_effectiveness"],
        sql: `WITH acts AS (
  SELECT *
  FROM collections_actions_full
  WHERE action_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
    AND action_date <= CAST({{as_of_date}} AS DATE)
)
SELECT
  entity,
  action_type,
  COUNT(*) AS actions,
  COUNT(DISTINCT loan_id) AS loans_touched,
  ROUND(AVG(dpd_at_action), 1) AS avg_dpd_at_action,
  COUNT(*) FILTER (WHERE result = 'promise_to_pay') AS promise_to_pay,
  COUNT(*) FILTER (WHERE result = 'partial_payment') AS partial_payment,
  COUNT(*) FILTER (WHERE result = 'resolved') AS resolved,
  COUNT(*) FILTER (WHERE result = 'no_contact') AS no_contact,
  COUNT(*) FILTER (WHERE result IN ('dispute', 'escalated')) AS dispute_or_escalated,
  ROUND(
    COUNT(*) FILTER (WHERE result IN ('promise_to_pay', 'partial_payment', 'resolved')) * 100.0 / NULLIF(COUNT(*), 0),
    2
  ) AS success_pct
FROM acts
GROUP BY entity, action_type
ORDER BY entity, success_pct DESC`,
      },
      {
        id: "c5_agent_effectiveness",
        label: "Rank Agent Effectiveness",
        description:
          "Measure each collection agent's volume, promise-to-pay and recovery counts, and success rate so coaching and case allocation can follow proven performers.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["agent_effectiveness"],
        sql: `WITH acts AS (
  SELECT *
  FROM collections_actions_full
  WHERE action_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
    AND action_date <= CAST({{as_of_date}} AS DATE)
)
SELECT
  agent_id,
  entity,
  COUNT(*) AS actions,
  COUNT(DISTINCT loan_id) AS loans_touched,
  ROUND(AVG(dpd_at_action), 1) AS avg_dpd_at_action,
  COUNT(*) FILTER (WHERE result = 'promise_to_pay') AS promise_to_pay,
  COUNT(*) FILTER (WHERE result IN ('partial_payment', 'resolved')) AS recovered,
  ROUND(
    COUNT(*) FILTER (WHERE result IN ('promise_to_pay', 'partial_payment', 'resolved')) * 100.0 / NULLIF(COUNT(*), 0),
    2
  ) AS success_pct
FROM acts
GROUP BY agent_id, entity
HAVING COUNT(*) >= {{min_agent_actions}}
ORDER BY success_pct DESC, actions DESC
LIMIT 40`,
      },
      {
        id: "c6_cure_rate",
        label: "Measure Next-Month Cure",
        description:
          "For loans that bounced in a month, measure the share that returned to on-time status the very next billing cycle, the cleanest read on whether collections effort is sticking.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["cure_rate"],
        sql: `WITH bounced AS (
  SELECT DISTINCT
    loan_id,
    entity,
    CAST(strftime(due_date::DATE, '%Y-%m') || '-01' AS DATE) AS bounce_month
  FROM collections_full
  WHERE bounce = true
    AND due_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
    AND due_date <= CAST({{as_of_date}} AS DATE)
),
next_month AS (
  SELECT
    loan_id,
    CAST(strftime(due_date::DATE, '%Y-%m') || '-01' AS DATE) AS bucket_month,
    MAX(CASE WHEN collection_bucket = 'on_time' THEN 1 ELSE 0 END) AS cured
  FROM collections_full
  GROUP BY loan_id, bucket_month
)
SELECT
  b.entity,
  COUNT(*) AS bounced_loan_months,
  COUNT(*) FILTER (WHERE n.cured = 1) AS cured_next_month,
  COUNT(*) FILTER (WHERE n.loan_id IS NULL) AS no_billing_next_month,
  ROUND(COUNT(*) FILTER (WHERE n.cured = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS cure_rate_pct
FROM bounced b
LEFT JOIN next_month n
  ON n.loan_id = b.loan_id
 AND n.bucket_month = b.bounce_month + INTERVAL '1 month'
GROUP BY b.entity
ORDER BY b.entity`,
      },
      {
        id: "c7_analysis",
        label: "Diagnose Collections Effectiveness",
        description:
          "Interpret the funnel, action-type, agent, and cure-rate results to locate the leakiest step and the highest-leverage intervention.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_funnel", "c4_action_effectiveness", "c5_agent_effectiveness", "c6_cure_rate"],
        outputs: ["collections_diagnosis"],
        prompt: `You are a collections strategy lead at a housing finance company. Using only the upstream query results, diagnose collections effectiveness.

Address:
- where the funnel leaks most: bounce to action coverage, action to promise-to-pay, or promise-to-pay to recovery, and what that says about capacity versus conversion;
- which action types earn the best success rate at which DPD depth, and whether early calls beat late legal or SARFAESI escalation;
- the spread between the best and weakest agents, and what reallocating cases toward top performers could be worth;
- how the next-month cure rate compares between HFC and Finserve, and what that implies about self-cure versus active recovery;
- the single highest-leverage change the team should make next quarter.

Quote actual counts, rupee amounts, and percentages from the tables. Do not fabricate numbers.`,
      },
      {
        id: "c8_summary",
        label: "Collections Effectiveness Brief",
        description:
          "Produce the final executive brief with the funnel, action and agent leaderboards, cure rate, and a prioritized operating plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_funnel", "c4_action_effectiveness", "c5_agent_effectiveness", "c6_cure_rate", "c7_analysis"],
        outputs: ["collections_brief"],
        prompt: `Create a rich, executive-ready markdown brief titled "Collections Effectiveness" for collections leadership.

The brief must include:
1. A one-paragraph headline answer stating, for the {{lookback_days}}-day window ending {{as_of_date}}, the bounced-loan count, the action coverage rate, and the next-month cure rate, split HFC vs Finserve.
2. A funnel table per entity: bounced loans, actioned loans, promise-to-pay loans, recovered loans, with the step conversion rates.
3. At least two charts when the upstream rows support them:
   - success rate by action type;
   - next-month cure rate by entity.
4. An action-type section identifying which levers convert best at which DPD depth.
5. An agent section naming top and bottom performers from the agent table and the success-rate spread between them.
6. A prioritized operating plan: where to add capacity, which action sequence to standardize, and how to reallocate cases toward proven agents.
7. A short SQL provenance note naming the source views: collections_full and collections_actions_full.

Use raw counts, rupee values, and percentages from the data. Keep recommendations operational and compliant; do not promise recovery beyond what the cure rate shows.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded collections effectiveness funnel and agent analysis for Vastu HFC.",
        changes: [
          {
            type: "add",
            cellLabel: "Recovery Funnel",
            cellId: "c3_funnel",
            detail: "Builds the bounce to action to promise-to-pay to recovery funnel with step conversion rates by entity.",
          },
        ],
      },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAYBOOK 3: Prepayment & Run-off Risk
// ══════════════════════════════════════════════════════════════════════════════

const PREPAY_PLAYBOOK_SLUG = "prepayment-runoff";

export function buildVastuPrepaymentPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", PREPAY_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Prepayment & Run-off Risk",
    description:
      "Quantify foreclosure and early-closure behavior by product, sourcing channel, rate band, and origination vintage, measure how fast prepaid loans run off the book, and flag the high-yield segments whose run-off most threatens AUM and net interest income.",
    category: "Portfolio",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: VASTU_HFC_DATASET_ID,
    sourceQuery:
      "Where are we losing the book to prepayment and foreclosure? Show me prepay rates by product, vintage and rate band, how fast loans run off, and which high-yield segments are most at risk.",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2025-03-31", group: "Window" },
      { name: "min_segment_loans", label: "Min loans per segment", type: "integer", defaultVal: "200", group: "Output" },
      { name: "risk_limit", label: "Run-off risk rows", type: "integer", defaultVal: "30", group: "Output" },
    ],
    produces: [
      {
        name: "prepay_by_product",
        description: "Prepayment and closure rates, run-off value, and average months-to-prepay by entity and product.",
        columns: [
          { name: "product_type", description: "Loan product." },
          { name: "prepay_rate_pct", description: "Prepaid loans as a share of all originated loans." },
          { name: "avg_months_to_prepay", description: "Average tenure elapsed before early closure." },
        ],
      },
      {
        name: "prepay_by_segment",
        description: "Prepay rate by sourcing channel and interest-rate band to expose rate-sensitive run-off.",
      },
      {
        name: "prepay_vintage",
        description: "Prepay rate by origination cohort and months-on-book seasoning.",
      },
      {
        name: "runoff_risk",
        description: "High-yield, high-prepay segments ranked by AUM exposed to run-off.",
      },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Run-off Inputs",
        description:
          "Confirm the originated book, prepaid loans, and last-payment dates needed for run-off timing all exist before running the analysis.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT
    'originated_loans' AS check_name,
    COUNT(*) AS record_count
  FROM loans_full
  WHERE disbursement_date IS NOT NULL
    AND disbursement_date::DATE <= CAST({{as_of_date}} AS DATE)
  UNION ALL
  SELECT
    'prepaid_loans' AS check_name,
    COUNT(*) AS record_count
  FROM loans_full
  WHERE loan_status = 'prepaid'
  UNION ALL
  SELECT
    'closed_loans' AS check_name,
    COUNT(*) AS record_count
  FROM loans_full
  WHERE loan_status = 'closed'
)
SELECT
  check_name,
  record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_prepay_product",
        label: "Prepay by Product",
        description:
          "Compute prepay and closure rates, run-off value, and average months-to-prepay for each entity and product to find where the book is leaking fastest.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["prepay_by_product"],
        sql: `SELECT
  entity,
  product_type,
  COUNT(*) AS total_loans,
  COUNT(*) FILTER (WHERE loan_status = 'prepaid') AS prepaid_loans,
  COUNT(*) FILTER (WHERE loan_status = 'closed') AS closed_loans,
  ROUND(COUNT(*) FILTER (WHERE loan_status = 'prepaid') * 100.0 / NULLIF(COUNT(*), 0), 2) AS prepay_rate_pct,
  ROUND(
    (COUNT(*) FILTER (WHERE loan_status = 'prepaid') + COUNT(*) FILTER (WHERE loan_status = 'closed')) * 100.0
      / NULLIF(COUNT(*), 0),
    2
  ) AS exit_rate_pct,
  ROUND(AVG(interest_rate), 2) AS avg_yield,
  ROUND(
    AVG(date_diff('month', disbursement_date::DATE, last_payment_date::DATE))
      FILTER (WHERE loan_status = 'prepaid' AND last_payment_date IS NOT NULL),
    1
  ) AS avg_months_to_prepay,
  ROUND(SUM(disbursed_amount) FILTER (WHERE loan_status = 'prepaid'), 0) AS prepaid_disbursed_amount
FROM loans_full
WHERE disbursement_date IS NOT NULL
GROUP BY entity, product_type
ORDER BY prepay_rate_pct DESC`,
      },
      {
        id: "c3_prepay_segment",
        label: "Prepay by Channel & Rate Band",
        description:
          "Break prepay rate by sourcing channel and interest-rate band to test whether higher-rate or particular-channel loans foreclose faster, the classic rate-refinance run-off signal.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["prepay_by_segment"],
        sql: `WITH base AS (
  SELECT
    entity,
    sourcing_channel,
    loan_status,
    disbursed_amount,
    CASE
      WHEN interest_rate < 14 THEN '1. <14%'
      WHEN interest_rate < 18 THEN '2. 14-18%'
      WHEN interest_rate < 22 THEN '3. 18-22%'
      ELSE '4. 22%+'
    END AS rate_band
  FROM loans_full
  WHERE disbursement_date IS NOT NULL
)
SELECT
  entity,
  sourcing_channel,
  rate_band,
  COUNT(*) AS total_loans,
  COUNT(*) FILTER (WHERE loan_status = 'prepaid') AS prepaid_loans,
  ROUND(COUNT(*) FILTER (WHERE loan_status = 'prepaid') * 100.0 / NULLIF(COUNT(*), 0), 2) AS prepay_rate_pct,
  ROUND(SUM(disbursed_amount) FILTER (WHERE loan_status = 'prepaid'), 0) AS prepaid_disbursed_amount
FROM base
GROUP BY entity, sourcing_channel, rate_band
HAVING COUNT(*) >= {{min_segment_loans}}
ORDER BY prepay_rate_pct DESC`,
      },
      {
        id: "c4_prepay_vintage",
        label: "Prepay by Vintage",
        description:
          "Group loans by origination FY quarter and measure prepay rate against months-on-book so cohorts that run off early stand out from those that season normally.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["prepay_vintage"],
        sql: `WITH base AS (
  SELECT
    entity,
    loan_status,
    disbursed_amount,
    disbursement_date::DATE AS disbursed_on,
    CASE
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) BETWEEN 4 AND 6 THEN 'Q1'
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) BETWEEN 7 AND 9 THEN 'Q2'
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) BETWEEN 10 AND 12 THEN 'Q3'
      ELSE 'Q4'
    END AS fy_quarter,
    CASE
      WHEN EXTRACT(MONTH FROM disbursement_date::DATE) >= 4
        THEN 'FY' || CAST((EXTRACT(YEAR FROM disbursement_date::DATE) + 1) % 100 AS VARCHAR)
      ELSE 'FY' || CAST(EXTRACT(YEAR FROM disbursement_date::DATE) % 100 AS VARCHAR)
    END AS fy
  FROM loans_full
  WHERE disbursement_date IS NOT NULL
)
SELECT
  entity,
  fy || '-' || fy_quarter AS origination_cohort,
  COUNT(*) AS total_loans,
  date_diff('month', MIN(disbursed_on), CAST({{as_of_date}} AS DATE)) AS cohort_months_on_book,
  COUNT(*) FILTER (WHERE loan_status = 'prepaid') AS prepaid_loans,
  ROUND(COUNT(*) FILTER (WHERE loan_status = 'prepaid') * 100.0 / NULLIF(COUNT(*), 0), 2) AS prepay_rate_pct,
  ROUND(SUM(disbursed_amount) FILTER (WHERE loan_status = 'prepaid'), 0) AS prepaid_disbursed_amount
FROM base
GROUP BY entity, fy, fy_quarter
ORDER BY entity, origination_cohort`,
      },
      {
        id: "c5_runoff_risk",
        label: "Rank Run-off Risk",
        description:
          "Combine prepay rate, yield, and live AUM by product and channel to rank the high-yield segments whose run-off most threatens net interest income.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["runoff_risk"],
        sql: `WITH base AS (
  SELECT
    entity,
    product_type,
    sourcing_channel,
    loan_status,
    interest_rate,
    disbursed_amount
  FROM loans_full
  WHERE disbursement_date IS NOT NULL
)
SELECT
  entity,
  product_type,
  sourcing_channel,
  COUNT(*) AS total_loans,
  COUNT(*) FILTER (WHERE loan_status IN ('active', 'npa')) AS live_loans,
  ROUND(SUM(disbursed_amount) FILTER (WHERE loan_status IN ('active', 'npa')), 0) AS live_aum,
  ROUND(AVG(interest_rate) FILTER (WHERE loan_status IN ('active', 'npa')), 2) AS live_avg_yield,
  COUNT(*) FILTER (WHERE loan_status = 'prepaid') AS prepaid_loans,
  ROUND(COUNT(*) FILTER (WHERE loan_status = 'prepaid') * 100.0 / NULLIF(COUNT(*), 0), 2) AS prepay_rate_pct,
  ROUND(
    SUM(disbursed_amount) FILTER (WHERE loan_status IN ('active', 'npa'))
      * (COUNT(*) FILTER (WHERE loan_status = 'prepaid') * 1.0 / NULLIF(COUNT(*), 0)),
    0
  ) AS aum_at_runoff_risk
FROM base
GROUP BY entity, product_type, sourcing_channel
HAVING COUNT(*) >= {{min_segment_loans}}
ORDER BY aum_at_runoff_risk DESC
LIMIT {{risk_limit}}`,
      },
      {
        id: "c6_analysis",
        label: "Diagnose Run-off Pattern",
        description:
          "Interpret the prepay, segment, vintage, and run-off-risk results to separate healthy churn from value-destroying foreclosure.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c2_prepay_product", "c3_prepay_segment", "c4_prepay_vintage", "c5_runoff_risk"],
        outputs: ["runoff_diagnosis"],
        prompt: `You are a portfolio strategy analyst at a housing finance company. Using only the upstream query results, diagnose prepayment and run-off risk.

Address:
- which products foreclose fastest and how early (average months-to-prepay), and whether that timing points to balance-transfer poaching or genuine borrower deleveraging;
- whether higher-rate or specific-channel loans prepay more, and what that implies about pricing competitiveness and balance-transfer pressure;
- which origination cohorts in the vintage table run off faster than peers at the same months-on-book;
- where the highest live AUM and yield sit against high prepay rates, since that is the run-off that hurts net interest income most;
- one retention lever the business could pull (rate match, top-up offer, relationship outreach) for the most exposed segment.

Quote actual percentages, months, and rupee values from the tables. Do not fabricate numbers. Note any data quirk you see (for example a segment with no recorded months-to-prepay).`,
      },
      {
        id: "c7_summary",
        label: "Prepayment & Run-off Brief",
        description:
          "Produce the final executive brief tying prepay drivers, vintage run-off, and AUM-at-risk into a retention and pricing action plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c2_prepay_product", "c3_prepay_segment", "c4_prepay_vintage", "c5_runoff_risk", "c6_analysis"],
        outputs: ["runoff_brief"],
        prompt: `Create a rich, executive-ready markdown brief titled "Prepayment & Run-off Risk" for portfolio and treasury leadership.

The brief must include:
1. A one-paragraph headline answer stating, as of {{as_of_date}}, the highest-prepay product and its rate, and the total live AUM flagged at run-off risk.
2. A prepay-by-product table: product, prepay rate, average months-to-prepay, average yield, and prepaid disbursed value.
3. At least two charts when the upstream rows support them:
   - prepay rate by product;
   - prepay rate by rate band or sourcing channel.
4. A vintage section naming cohorts running off faster than their seasoning would predict.
5. A run-off-risk section: the top segments by AUM-at-risk, with a recommended retention or pricing response for each.
6. A short SQL provenance note naming the source view: loans_full.

Use raw rupee values, percentages, and month figures from the data. Keep recommendations commercial and compliant; do not assume run-off the data does not show.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded prepayment and run-off risk analysis for Vastu HFC.",
        changes: [
          {
            type: "add",
            cellLabel: "Run-off Risk",
            cellId: "c5_runoff_risk",
            detail: "Ranks high-yield, high-prepay product and channel segments by live AUM exposed to run-off.",
          },
        ],
      },
    ],
  };
}

export function seedVastuHfcPlaybooks(userId: string): number {
  const playbooks = [
    buildVastuRollRatePlaybook(userId),
    buildVastuCollectionsPlaybook(userId),
    buildVastuPrepaymentPlaybook(userId),
  ];
  let seeded = 0;
  for (const playbook of playbooks) {
    if (getPlaybook(userId, playbook.id)) continue;
    upsertPlaybook(userId, playbook);
    seeded += 1;
  }
  return seeded;
}
