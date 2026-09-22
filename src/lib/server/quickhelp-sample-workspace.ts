import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { quickhelpDataset } from "@/lib/datasets/quickhelp";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";
import { getPlaybook, upsertPlaybook } from "@/lib/server/playbook-repo";
import type { PlaybookV2 } from "@/lib/playbook-types";

export const QUICKHELP_DATASET_ID = "quickhelp";
const DATA_RANGE = { start: "2025-02-01", end: "2026-02-28" } as const;
// Dataset "today" = max booking_date. Relative-date segments anchor here.
const DATASET_NOW = "2026-02-28";

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `qh_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, QUICKHELP_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  const row = result.rows[0] as Record<string, unknown>;
  return Number(row.n) || 0;
}

// ─────────────────────────────────────────────────────────────────────
// SEGMENTS: handcrafted SQL, customer_id is the entity
// ─────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  {
    slug: "repeat-customers",
    name: "Repeat Customers",
    description: "Customers with 2+ lifetime bookings: the habitual-use base that drives retained GMV.",
    sql: "SELECT customer_id FROM bookings GROUP BY customer_id HAVING COUNT(*) >= 2",
  },
  {
    slug: "first-time-recent",
    name: "Recent First-Time Bookers (Last 30 Days)",
    description: "Customers whose first-ever booking was in the last 30 days. Activation nurture target.",
    sql: `SELECT DISTINCT customer_id FROM bookings WHERE is_first_booking = true AND booking_date >= DATE '${DATASET_NOW}' - INTERVAL 30 DAY`,
  },
  {
    slug: "lapsed-churned",
    name: "Lapsed / Churned Customers",
    description: "Customers whose most recent booking was 90+ days ago. Win-back campaign target.",
    sql: `SELECT customer_id FROM bookings GROUP BY customer_id HAVING MAX(booking_date) < DATE '${DATASET_NOW}' - INTERVAL 90 DAY`,
  },
  {
    slug: "dormant-reactivation",
    name: "Dormant: Reactivation Window (60-90 Days)",
    description: "Customers idle 60-90 days, early enough to win back before they fully churn. Reactivation target.",
    sql: `SELECT customer_id FROM bookings GROUP BY customer_id HAVING MAX(booking_date) BETWEEN DATE '${DATASET_NOW}' - INTERVAL 90 DAY AND DATE '${DATASET_NOW}' - INTERVAL 60 DAY`,
  },
  {
    slug: "high-value-customers",
    name: "High-Value Customers",
    description: "Customers in the top LTV buckets (high / whale): premium offers and concierge upsell.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE ltv_bucket IN ('high','whale')",
  },
  {
    slug: "promo-dependent",
    name: "Promo-Dependent Customers",
    description: "Active customers (3+ bookings) where most bookings ride a campaign: margin-dilutive, discount-reliant.",
    sql: "SELECT customer_id FROM bookings GROUP BY customer_id HAVING COUNT(*) >= 3 AND AVG(CASE WHEN campaign_id IS NOT NULL THEN 1.0 ELSE 0.0 END) > 0.5",
  },
  {
    slug: "premium-tier-buyers",
    name: "Premium-Tier Buyers",
    description: "Customers who have booked a premium (120-min) service: highest commission tier.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE service_tier = 'premium'",
  },
  {
    slug: "laundry-category",
    name: "Laundry Service Customers",
    description: "Customers who have booked Laundry: the highest-volume single service type. Cross-sell anchor.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE service_type = 'Laundry'",
  },
  {
    slug: "metro-customers",
    name: "Metropolitan Customers",
    description: "Customers in metro zones where SLA performance is strongest: premium experience upsell.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE city = 'Metropolitian'",
  },
  {
    slug: "semi-urban-underserved",
    name: "Semi-Urban Customers (SLA-Exposed)",
    description: "Semi-urban customers who face the worst on-time rates. Service-recovery and expectation-setting target.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE city = 'Semi-Urban'",
  },
  {
    slug: "referral-acquired",
    name: "Referral-Acquired Customers",
    description: "Customers who joined via the referral program: strong word-of-mouth advocates to re-activate referrals.",
    sql: "SELECT DISTINCT customer_id FROM customers WHERE acquisition_source = 'referral'",
  },
  {
    slug: "cancelled-refunded",
    name: "Cancelled / Refunded Customers",
    description: "Customers with at least one failed or refunded booking: service-recovery and re-engagement target.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE payment_status IN ('failed','refunded')",
  },
  {
    slug: "late-arrival-exposed",
    name: "Late-Arrival Exposed Customers",
    description: "Customers who experienced at least one partner arriving outside the SLA window. Churn-risk and apology-offer target.",
    sql: "SELECT DISTINCT customer_id FROM bookings WHERE on_time = false",
  },
];

// ─────────────────────────────────────────────────────────────────────
// FUNNELS: use EventDefinition IDs from quickhelp.ts
// ─────────────────────────────────────────────────────────────────────
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "aarrr-onboarding",
    name: "Onboarding Funnel (AARRR)",
    description: "Signup → profile → address → payment → first browse → first booking. The core activation chain.",
    config: {
      steps: [
        { eventId: "signup" },
        { eventId: "profile_done" },
        { eventId: "address_added" },
        { eventId: "payment_added" },
        { eventId: "first_browse" },
        { eventId: "first_booking_funnel" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "activation-to-habit",
    name: "Activation → Habit Funnel",
    description: "First booking → 2nd booking (14d) → 3rd booking (30d). The trial-to-habit chain: does a one-time booker turn into a repeat user?",
    config: {
      steps: [
        { eventId: "first_booking_funnel" },
        { eventId: "second_booking_14d" },
        { eventId: "third_booking_30d" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "browse-to-booking",
    name: "Browse → First Booking Funnel",
    description: "First service browse → first booking (within 30 days). Isolates the intent-to-purchase conversion, the single steepest drop in the activation chain.",
    config: {
      steps: [
        { eventId: "first_browse" },
        { eventId: "first_booking_funnel" },
      ],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "lifecycle-signup-to-third-by-city",
    name: "Full Lifecycle Funnel by City Tier",
    description: "Signup → first browse → first booking → 2nd booking → 3rd booking, split by city tier. The complete acquisition-to-habit journey: each added step compounds the drop-off, so the surviving share at the 3rd booking is the true habit-formation rate. The city-tier split shows whether metro, urban, and semi-urban customers form a booking habit at the same rate.",
    config: {
      steps: [
        { eventId: "signup" },
        { eventId: "first_browse" },
        { eventId: "first_booking_funnel" },
        { eventId: "second_booking_14d" },
        { eventId: "third_booking_30d" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "city",
    },
  },
  {
    slug: "activation-core-by-platform",
    name: "Core Activation Funnel by Platform",
    description: "Signup → profile completed → payment added → first booking, split by platform (android / ios / web). The tightest activation chain that ends in revenue, broken out by platform to show whether the app experience converts new signups to first booking equally across devices.",
    config: {
      steps: [
        { eventId: "signup" },
        { eventId: "profile_done" },
        { eventId: "payment_added" },
        { eventId: "first_booking_funnel" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "platform",
    },
  },
  {
    slug: "advocacy-signup-to-referral-by-source",
    name: "Advocacy Funnel (Signup → Referral) by Source",
    description: "Signup → first booking → 2nd booking → 3rd booking → referral sent, split by acquisition source. The deepest journey we track: it follows a brand-new signup all the way to becoming an active advocate who invites someone else. The source split shows which acquisition channels seed customers who eventually refer, the engine behind organic growth.",
    config: {
      steps: [
        { eventId: "signup" },
        { eventId: "first_booking_funnel" },
        { eventId: "second_booking_14d" },
        { eventId: "third_booking_30d" },
        { eventId: "referral_sent" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "source",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────
// RETENTIONS: use EventDefinition IDs from quickhelp.ts
// ─────────────────────────────────────────────────────────────────────
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "first-booking-repeat",
    name: "First-Booking Repeat Retention",
    description: "Of first-time bookers, the share who return for another booking. Home services is low-frequency, so this is a cumulative repeat curve: sticky customers rebook over the following weeks and months.",
    config: {
      startEventId: "first_booking_funnel",
      returnEventIds: ["booking"],
      // Cumulative return ("on or after"). Customers rebook over weeks/months, not
      // days. Exact-day retention is near-zero and reads as broken.
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "signup-activation",
    name: "Signup → First Booking Activation",
    description: "Of new signups, the cumulative share who reach their first booking over time: the signup-to-activation curve.",
    config: {
      startEventId: "signup",
      returnEventIds: ["first_booking_funnel"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "session-to-booking",
    name: "App Session → Booking Retention",
    description: "Of customers who open the app, the cumulative share who go on to make a booking: app-engagement-to-conversion.",
    config: {
      startEventId: "app_session",
      returnEventIds: ["app_booked"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "first-booking-rebook-vs-engagement",
    name: "First-Booking Rebook vs Engagement (Two Signals)",
    description: "Of first-time bookers, two return curves side by side: the share who reach their fast 2nd booking (the 14-day repeat milestone) and the broader cumulative share who place any further booking over the following weeks and months. Comparing the steep early-milestone curve against the slow cumulative rebook curve separates customers who form a habit quickly from those who return only occasionally.",
    config: {
      startEventId: "first_booking_funnel",
      returnEventIds: ["second_booking_14d", "booking"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "signup-activation-by-platform",
    name: "Signup → First Booking Activation by Platform",
    description: "Of new signups, the cumulative share who reach their first booking over time, split by platform (android / ios / web). The weekly cohort curve shows how long activation takes and whether one platform consistently activates new signups faster than the others.",
    config: {
      startEventId: "signup",
      returnEventIds: ["first_booking_funnel"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
      breakdown: "platform",
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, quickhelpDataset, QUICKHELP_DATASET_ID);
}

async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, quickhelpDataset, QUICKHELP_DATASET_ID);
}

// ─────────────────────────────────────────────────────────────────────
// PLAYBOOKS (V2 DAG): repeat/retention, P&L mix, fulfilment/SLA health
// ─────────────────────────────────────────────────────────────────────

const RETENTION_PLAYBOOK_SLUG = "repeat-retention-engine";

export function buildQuickhelpRetentionPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", RETENTION_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Repeat & Retention Engine",
    description: "Trace customers from first to second to third booking by acquisition cohort, measure repeat rate and time-between-bookings by city and service tier, size the active vs churn-risk base, and rank the highest-value at-risk repeat customers for win-back.",
    category: "Retention",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: QUICKHELP_DATASET_ID,
    sourceQuery: "How healthy is our repeat behaviour: what share of first-time bookers come back for a second and third booking, how fast, how does that vary by city and service tier, and which valuable customers are now slipping toward churn?",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2026-02-28", group: "Window" },
      { name: "second_window_days", label: "2nd-booking window (days)", type: "integer", defaultVal: "60", group: "Window" },
      { name: "third_window_days", label: "3rd-booking window (days)", type: "integer", defaultVal: "90", group: "Window" },
      { name: "priority_limit", label: "Priority customer rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "customer_repeat_base",
        description: "Customer-level base: first-booking traits, whether they reached a 2nd and 3rd booking inside the windows, days to next booking, lifetime bookings, lifetime GMV, and days since last booking.",
        columns: [
          { name: "customer_id", description: "Customer identifier." },
          { name: "cohort_month", description: "Month of the customer's first booking." },
          { name: "reached_2nd", description: "1 if a 2nd booking happened within the 2nd-booking window." },
          { name: "reached_3rd", description: "1 if a 3rd booking happened within the 3rd-booking window." },
          { name: "days_since_last_booking", description: "Days from last booking to the as-of date." },
        ],
      },
      { name: "cohort_repeat_curve", description: "First to second to third repeat rates and average days-to-next by first-booking cohort month." },
      { name: "repeat_by_segment", description: "Second-booking repeat rate cut by first city and first service tier." },
      { name: "churn_risk_base", description: "Active, cooling, at-risk, and lapsed buckets across the repeat base with customer counts and GMV at stake." },
      { name: "priority_winback", description: "Highest-value at-risk and lapsed repeat customers ranked for win-back outreach." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Repeat Inputs",
        description: "Confirm bookings exist with multi-booking customers and that first-booking flags are populated for cohort logic.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'total_bookings' AS check_name, COUNT(*) AS record_count FROM bookings
  UNION ALL
  SELECT 'distinct_customers' AS check_name, COUNT(DISTINCT customer_id) AS record_count FROM bookings
  UNION ALL
  SELECT 'repeat_customers_2plus' AS check_name,
    COUNT(*) AS record_count
  FROM (SELECT customer_id FROM bookings GROUP BY customer_id HAVING COUNT(*) >= 2) r
  UNION ALL
  SELECT 'first_booking_flag_rows' AS check_name, COUNT(*) AS record_count FROM bookings WHERE is_first_booking = true
)
SELECT check_name, record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_repeat_base",
        label: "Build Customer Repeat Base",
        description: "Rank each customer's bookings, capture first-booking traits, and flag whether they reached a 2nd booking inside the 2nd-booking window and a 3rd inside the 3rd-booking window.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["customer_repeat_base"],
        sql: `WITH seq AS (
  SELECT
    b.customer_id,
    b.booking_date,
    b.booking_id,
    b.city,
    b.service_tier,
    b.acquisition_source,
    b.campaign_id,
    b.payment_status,
    b.booking_value,
    ROW_NUMBER() OVER (PARTITION BY b.customer_id ORDER BY b.booking_date, b.booking_id) AS booking_rank
  FROM bookings b
),
firsts AS (
  SELECT
    customer_id,
    booking_date AS first_booking_date,
    city AS first_city,
    service_tier AS first_tier,
    acquisition_source AS first_source,
    CASE WHEN campaign_id IS NOT NULL THEN 'promo_first' ELSE 'organic_first' END AS first_acquisition_type
  FROM seq
  WHERE booking_rank = 1
),
lifetime AS (
  SELECT
    customer_id,
    COUNT(*) AS lifetime_bookings,
    MAX(booking_date) AS last_booking_date,
    SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS lifetime_gmv
  FROM seq
  GROUP BY customer_id
)
SELECT
  f.customer_id,
  CAST(DATE_TRUNC('month', f.first_booking_date) AS DATE) AS cohort_month,
  f.first_booking_date,
  f.first_city,
  f.first_tier,
  f.first_source,
  f.first_acquisition_type,
  lt.lifetime_bookings,
  ROUND(lt.lifetime_gmv, 0) AS lifetime_gmv,
  lt.last_booking_date,
  date_diff('day', lt.last_booking_date, CAST({{as_of_date}} AS DATE)) AS days_since_last_booking,
  MAX(CASE WHEN s.booking_rank = 2 AND date_diff('day', f.first_booking_date, s.booking_date) BETWEEN 1 AND {{second_window_days}} THEN 1 ELSE 0 END) AS reached_2nd,
  MAX(CASE WHEN s.booking_rank = 3 AND date_diff('day', f.first_booking_date, s.booking_date) BETWEEN 1 AND {{third_window_days}} THEN 1 ELSE 0 END) AS reached_3rd,
  MIN(CASE WHEN s.booking_rank = 2 THEN date_diff('day', f.first_booking_date, s.booking_date) END) AS days_to_2nd,
  MIN(CASE WHEN s.booking_rank = 3 THEN date_diff('day', f.first_booking_date, s.booking_date) END) AS days_to_3rd
FROM firsts f
JOIN lifetime lt ON lt.customer_id = f.customer_id
LEFT JOIN seq s ON s.customer_id = f.customer_id AND s.booking_rank > 1
GROUP BY 1,2,3,4,5,6,7,8,9,10,11`,
      },
      {
        id: "c3_cohort_curve",
        label: "First to Second to Third Cohort Curve",
        description: "For each first-booking cohort month, compute cohort size, 2nd-booking and 3rd-booking repeat rates, and average days to the next booking. Only cohorts old enough to have a fair 2nd-booking window are kept.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_repeat_base"],
        outputs: ["cohort_repeat_curve"],
        sql: `SELECT
  cohort_month,
  COUNT(*) AS cohort_size,
  SUM(reached_2nd) AS reached_2nd,
  ROUND(SUM(reached_2nd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_2nd_pct,
  SUM(reached_3rd) AS reached_3rd,
  ROUND(SUM(reached_3rd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_3rd_pct,
  ROUND(SUM(reached_3rd) * 100.0 / NULLIF(SUM(reached_2nd), 0), 2) AS second_to_third_pct,
  ROUND(AVG(days_to_2nd), 1) AS avg_days_to_2nd,
  ROUND(AVG(days_to_3rd), 1) AS avg_days_to_3rd
FROM customer_repeat_base
WHERE cohort_month <= CAST({{as_of_date}} AS DATE) - ({{second_window_days}} * INTERVAL '1 day')
GROUP BY cohort_month
ORDER BY cohort_month`,
      },
      {
        id: "c4_segment_repeat",
        label: "Repeat Rate by City and Tier",
        description: "Cut the 2nd-booking repeat rate and average days-to-2nd by first city and first service tier to show where habit forms fastest and where it stalls.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_repeat_base"],
        outputs: ["repeat_by_segment"],
        sql: `SELECT * FROM (
  SELECT
    'First city' AS dimension_type,
    first_city AS segment_value,
    COUNT(*) AS cohort_size,
    SUM(reached_2nd) AS reached_2nd,
    ROUND(SUM(reached_2nd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_2nd_pct,
    ROUND(SUM(reached_3rd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_3rd_pct,
    ROUND(AVG(days_to_2nd), 1) AS avg_days_to_2nd
  FROM customer_repeat_base
  GROUP BY first_city
  UNION ALL
  SELECT
    'First service tier' AS dimension_type,
    first_tier AS segment_value,
    COUNT(*) AS cohort_size,
    SUM(reached_2nd) AS reached_2nd,
    ROUND(SUM(reached_2nd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_2nd_pct,
    ROUND(SUM(reached_3rd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_3rd_pct,
    ROUND(AVG(days_to_2nd), 1) AS avg_days_to_2nd
  FROM customer_repeat_base
  GROUP BY first_tier
  UNION ALL
  SELECT
    'First acquisition type' AS dimension_type,
    first_acquisition_type AS segment_value,
    COUNT(*) AS cohort_size,
    SUM(reached_2nd) AS reached_2nd,
    ROUND(SUM(reached_2nd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_2nd_pct,
    ROUND(SUM(reached_3rd) * 100.0 / NULLIF(COUNT(*), 0), 2) AS repeat_3rd_pct,
    ROUND(AVG(days_to_2nd), 1) AS avg_days_to_2nd
  FROM customer_repeat_base
  GROUP BY first_acquisition_type
) seg
ORDER BY dimension_type, cohort_size DESC`,
      },
      {
        id: "c5_churn_risk",
        label: "Size Active vs Churn-Risk Base",
        description: "Bucket the repeat base (2+ lifetime bookings) by days since last booking into active, cooling, at-risk, and lapsed, with customer counts, average lifetime bookings, and GMV at stake.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_repeat_base"],
        outputs: ["churn_risk_base"],
        sql: `WITH bucketed AS (
  SELECT
    customer_id,
    lifetime_bookings,
    lifetime_gmv,
    days_since_last_booking,
    CASE
      WHEN days_since_last_booking <= 30 THEN '1 Active (0 to 30 days)'
      WHEN days_since_last_booking <= 60 THEN '2 Cooling (31 to 60 days)'
      WHEN days_since_last_booking <= 90 THEN '3 At risk (61 to 90 days)'
      ELSE '4 Lapsed (90 plus days)'
    END AS churn_bucket
  FROM customer_repeat_base
  WHERE lifetime_bookings >= 2
)
SELECT
  churn_bucket,
  COUNT(*) AS customers,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_of_repeat_base_pct,
  ROUND(AVG(lifetime_bookings), 1) AS avg_lifetime_bookings,
  ROUND(SUM(lifetime_gmv), 0) AS lifetime_gmv,
  ROUND(AVG(lifetime_gmv), 0) AS avg_lifetime_gmv
FROM bucketed
GROUP BY churn_bucket
ORDER BY churn_bucket`,
      },
      {
        id: "c6_priority_winback",
        label: "Rank Priority Win-Back Customers",
        description: "Return the highest-value at-risk and lapsed repeat customers (61+ days idle) ranked by lifetime GMV to power win-back outreach, export, or a voice campaign.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_repeat_base"],
        outputs: ["priority_winback"],
        sql: `SELECT
  customer_id,
  first_city,
  first_tier,
  first_source,
  lifetime_bookings,
  lifetime_gmv,
  last_booking_date,
  days_since_last_booking,
  CASE
    WHEN days_since_last_booking <= 90 THEN 'At risk (61 to 90 days)'
    ELSE 'Lapsed (90 plus days)'
  END AS churn_bucket
FROM customer_repeat_base
WHERE lifetime_bookings >= 2
  AND days_since_last_booking > 60
ORDER BY lifetime_gmv DESC, lifetime_bookings DESC, customer_id
LIMIT {{priority_limit}}`,
      },
      {
        id: "c7_retention_analysis",
        label: "Diagnose Repeat Health",
        description: "Interpret the cohort curve, segment cuts, and churn-risk base to explain where repeat behaviour is strong, where it decays, and how fast.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_cohort_curve", "c4_segment_repeat", "c5_churn_risk"],
        outputs: ["retention_diagnosis"],
        prompt: `Analyze repeat and retention health using only the upstream query results.

Cover:
- the first to second to third repeat trajectory across cohort months, and whether recent cohorts are improving or decaying;
- how fast customers return (average days to 2nd and 3rd booking) and what that implies for lifecycle timing;
- which first city, first service tier, and acquisition type form a repeat habit fastest and which stall;
- the split of the repeat base across active, cooling, at-risk, and lapsed buckets and how much GMV sits in each.

Use actual numbers from the tables. Be concrete about the operational read for an ops or growth lead. Do not invent figures not present in the data.`,
      },
      {
        id: "c8_retention_summary",
        label: "Repeat & Retention Brief",
        description: "Produce the final executive-ready markdown brief with KPI table, charts, segment read, and a prioritized win-back action plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_cohort_curve", "c4_segment_repeat", "c5_churn_risk", "c6_priority_winback", "c7_retention_analysis"],
        outputs: ["retention_brief"],
        prompt: `Create a rich, executive-ready markdown brief on repeat and retention health.

Include:
1. A one-paragraph direct answer: how strong repeat behaviour is, defined as the share of first-time bookers who reach a 2nd booking within {{second_window_days}} days and a 3rd within {{third_window_days}} days as of {{as_of_date}}.
2. A compact KPI table: latest-cohort 2nd-booking rate, 3rd-booking rate, second-to-third conversion, average days to 2nd, and the active vs at-risk-plus-lapsed split with GMV at stake.
3. At least two charts when upstream rows support them:
   - 2nd and 3rd booking repeat rate by cohort month (trend);
   - repeat rate by city or service tier (bar).
4. A segment section naming the fastest-forming and slowest-forming repeat segments and why they matter.
5. A win-back action section: which customers to contact first (reference the priority list), what angle to use, and what guardrails to keep.
6. A short SQL provenance note naming the core sources: bookings and the derived customer_repeat_base.

Use raw rupee values from the data. Keep recommendations practical and grounded in the numbers.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded repeat and retention engine for QuickHelp.",
        changes: [
          {
            type: "add",
            cellLabel: "Customer repeat base",
            cellId: "c2_repeat_base",
            detail: "Ranks bookings per customer and flags 2nd and 3rd booking inside parameterized windows.",
          },
        ],
      },
    ],
  };
}

const PNL_PLAYBOOK_SLUG = "service-city-pnl-mix";

export function buildQuickhelpPnlPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", PNL_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Service & City P&L / GMV Mix",
    description: "Break GMV and contribution margin by service tier and city, rank service types by margin and promo dependency, quantify how much margin is funded away by promotions, and surface the lowest-margin high-volume pockets that dilute unit economics.",
    category: "Unit Economics",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: QUICKHELP_DATASET_ID,
    sourceQuery: "Where do our GMV and contribution margin actually come from across service tier and city tier, which services are margin-rich versus margin-thin, and how much of our margin is being funded away by promotions?",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2026-02-28", group: "Window" },
      { name: "lookback_days", label: "Lookback window (days)", type: "integer", defaultVal: "180", group: "Window" },
      { name: "thin_margin_pct", label: "Thin-margin threshold (%)", type: "float", defaultVal: "20", group: "Thresholds" },
    ],
    produces: [
      { name: "tier_city_pnl", description: "GMV, AOV, contribution margin, margin %, and promo-funded spend by service tier and city for the lookback window." },
      { name: "service_pnl", description: "Service-type level GMV, contribution margin, margin %, and promo dependency for the lookback window." },
      { name: "promo_dependency", description: "Promo vs organic booking split with GMV, margin, and margin % to quantify promotion reliance." },
      { name: "thin_margin_pockets", description: "High-volume service-tier-by-city pockets whose margin % falls below the thin-margin threshold." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Economics Inputs",
        description: "Confirm the bookings_economics view has rows in the lookback window with populated contribution margin.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH window_rows AS (
  SELECT *
  FROM bookings_economics
  WHERE booking_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
    AND booking_date <= CAST({{as_of_date}} AS DATE)
)
SELECT 'bookings_in_window' AS check_name, COUNT(*) AS record_count FROM window_rows
UNION ALL
SELECT 'paid_bookings_in_window' AS check_name, COUNT(*) AS record_count FROM window_rows WHERE payment_status = 'success'
UNION ALL
SELECT 'rows_with_contribution_margin' AS check_name, COUNT(*) AS record_count FROM window_rows WHERE contribution_margin IS NOT NULL`,
      },
      {
        id: "c2_window_base",
        label: "Build P&L Window Base",
        description: "Filter the economics view to the lookback window once so every downstream cut reads a consistent base.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["pnl_window"],
        sql: `SELECT
  booking_id,
  customer_id,
  service_type,
  service_tier,
  city,
  campaign_id,
  payment_status,
  CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END AS paid_gmv,
  contribution_margin,
  promo_discount_funded,
  commission_earned
FROM bookings_economics
WHERE booking_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
  AND booking_date <= CAST({{as_of_date}} AS DATE)`,
      },
      {
        id: "c3_tier_city_pnl",
        label: "P&L by Tier and City",
        description: "GMV, AOV, contribution margin, margin %, and promo-funded spend by service tier and city.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_window_base"],
        outputs: ["tier_city_pnl"],
        sql: `SELECT
  service_tier,
  city,
  COUNT(*) AS bookings,
  ROUND(SUM(paid_gmv), 0) AS gmv,
  ROUND(AVG(CASE WHEN payment_status = 'success' THEN paid_gmv END), 0) AS aov,
  ROUND(SUM(contribution_margin), 0) AS contribution_margin,
  ROUND(SUM(contribution_margin) * 100.0 / NULLIF(SUM(paid_gmv), 0), 2) AS cm_pct,
  ROUND(SUM(promo_discount_funded), 0) AS promo_funded,
  ROUND(SUM(promo_discount_funded) * 100.0 / NULLIF(SUM(contribution_margin) + SUM(promo_discount_funded), 0), 2) AS promo_share_of_pre_promo_margin_pct,
  ROUND(SUM(paid_gmv) * 100.0 / NULLIF(SUM(SUM(paid_gmv)) OVER (), 0), 2) AS gmv_share_pct
FROM pnl_window
GROUP BY service_tier, city
ORDER BY gmv DESC`,
      },
      {
        id: "c4_service_pnl",
        label: "P&L by Service Type",
        description: "Rank service types by GMV with contribution margin, margin %, and promo dependency to show which services carry the book.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_window_base"],
        outputs: ["service_pnl"],
        sql: `SELECT
  service_type,
  COUNT(*) AS bookings,
  ROUND(SUM(paid_gmv), 0) AS gmv,
  ROUND(AVG(CASE WHEN payment_status = 'success' THEN paid_gmv END), 0) AS aov,
  ROUND(SUM(contribution_margin), 0) AS contribution_margin,
  ROUND(SUM(contribution_margin) * 100.0 / NULLIF(SUM(paid_gmv), 0), 2) AS cm_pct,
  ROUND(COUNT(*) FILTER (WHERE campaign_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0), 2) AS promo_share_pct
FROM pnl_window
GROUP BY service_type
ORDER BY gmv DESC`,
      },
      {
        id: "c5_promo_dependency",
        label: "Quantify Promo Dependency",
        description: "Split promo-attached vs organic bookings and compare GMV, contribution margin, and margin % to measure how much margin promotions consume.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_window_base"],
        outputs: ["promo_dependency"],
        sql: `SELECT
  CASE WHEN campaign_id IS NOT NULL THEN 'Promo-attached' ELSE 'Organic' END AS booking_type,
  COUNT(*) AS bookings,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS booking_share_pct,
  ROUND(SUM(paid_gmv), 0) AS gmv,
  ROUND(SUM(paid_gmv) * 100.0 / NULLIF(SUM(SUM(paid_gmv)) OVER (), 0), 2) AS gmv_share_pct,
  ROUND(SUM(contribution_margin), 0) AS contribution_margin,
  ROUND(SUM(contribution_margin) * 100.0 / NULLIF(SUM(paid_gmv), 0), 2) AS cm_pct,
  ROUND(SUM(promo_discount_funded), 0) AS promo_funded
FROM pnl_window
GROUP BY booking_type
ORDER BY gmv DESC`,
      },
      {
        id: "c6_thin_margin",
        label: "Flag Thin-Margin Pockets",
        description: "Surface tier-by-city pockets whose contribution margin % falls below the thin-margin threshold, ordered by GMV so the costliest pockets surface first.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c3_tier_city_pnl"],
        outputs: ["thin_margin_pockets"],
        sql: `SELECT
  service_tier,
  city,
  bookings,
  gmv,
  contribution_margin,
  cm_pct,
  promo_funded,
  gmv_share_pct
FROM tier_city_pnl
WHERE cm_pct < {{thin_margin_pct}}
ORDER BY gmv DESC`,
      },
      {
        id: "c7_pnl_analysis",
        label: "Diagnose Margin Mix",
        description: "Interpret where GMV and margin concentrate, which services and tiers dilute margin, and how heavily the book leans on promotions.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_tier_city_pnl", "c4_service_pnl", "c5_promo_dependency", "c6_thin_margin"],
        outputs: ["pnl_diagnosis"],
        prompt: `Analyze the service and city P&L mix using only the upstream query results.

Cover:
- which service tier and city combinations carry the most GMV and the most contribution margin, and where those diverge (high GMV, thin margin);
- which service types are margin-rich versus margin-thin and how promo-dependent each is;
- the organic vs promo-attached split and what the margin gap implies about discount reliance;
- the thin-margin pockets that quietly dilute blended unit economics.

Use actual rupee values and percentages from the tables. Frame the read for an ops or finance lead deciding where to protect margin. Do not invent numbers.`,
      },
      {
        id: "c8_pnl_summary",
        label: "Margin Mix Brief",
        description: "Produce the final executive-ready markdown brief with KPI table, charts, margin read, and protect-margin actions.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_tier_city_pnl", "c4_service_pnl", "c5_promo_dependency", "c6_thin_margin", "c7_pnl_analysis"],
        outputs: ["pnl_brief"],
        prompt: `Create a rich, executive-ready markdown brief on the service and city margin mix for the last {{lookback_days}} days as of {{as_of_date}}.

Include:
1. A one-paragraph direct answer naming where GMV and contribution margin concentrate and how promo-dependent the book is.
2. A compact KPI table: total GMV, total contribution margin, blended margin %, promo-funded total, and the promo vs organic margin % gap.
3. At least two charts when upstream rows support them:
   - GMV or contribution margin by service tier and city;
   - margin % by service type or the organic vs promo split.
4. A section naming the margin-rich winners and the thin-margin high-GMV pockets that dilute blended economics.
5. A protect-margin action section: where to trim discounting, where to defend AOV, and which pockets to re-price or re-route.
6. A short SQL provenance note naming the core source: bookings_economics filtered to the lookback window.

Use raw rupee values from the data. Keep recommendations grounded in the numbers.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded service and city P&L / GMV mix for QuickHelp.",
        changes: [
          {
            type: "add",
            cellLabel: "P&L window base",
            cellId: "c2_window_base",
            detail: "Filters bookings_economics to the parameterized lookback window for consistent downstream cuts.",
          },
        ],
      },
    ],
  };
}

const SLA_PLAYBOOK_SLUG = "fulfilment-sla-health";

export function buildQuickhelpSlaPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", SLA_PLAYBOOK_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Fulfilment & SLA Health",
    description: "Measure on-time arrival, arrival delay versus SLA, partner reassignment, no-show and cancellation rates by city and hub, then connect a customer's early on-time experience to whether they rebook, isolating where service quality is costing retention.",
    category: "Operations",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: QUICKHELP_DATASET_ID,
    sourceQuery: "How healthy is fulfilment: where do partners arrive late or get reassigned, where are no-shows and cancellations worst, and does a poor early on-time experience actually reduce whether a customer rebooks?",
    params: [
      { name: "as_of_date", label: "As-of date", type: "date", defaultVal: "2026-02-28", group: "Window" },
      { name: "lookback_days", label: "Lookback window (days)", type: "integer", defaultVal: "180", group: "Window" },
      { name: "rebook_window_days", label: "Rebook window (days)", type: "integer", defaultVal: "90", group: "Window" },
    ],
    produces: [
      { name: "sla_by_hub", description: "On-time rate, average arrival delay, reassignment, refund, and failed-payment rates by city and hub for the lookback window." },
      { name: "partner_reliability", description: "Partner no-show and shift-cancellation rates by hub from partner_shifts." },
      { name: "sla_rebooking_impact", description: "Customer cohort split by early on-time experience and the share who rebook within the rebook window." },
      { name: "service_recovery_targets", description: "Hubs ranked by SLA breach exposure and rebooking risk for service-recovery focus." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Fulfilment Inputs",
        description: "Confirm bookings carry SLA fields in the window and that partner_shifts has status rows.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `SELECT 'bookings_in_window' AS check_name, COUNT(*) AS record_count
FROM bookings
WHERE booking_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
  AND booking_date <= CAST({{as_of_date}} AS DATE)
UNION ALL
SELECT 'rows_with_on_time_flag' AS check_name, COUNT(*) AS record_count
FROM bookings
WHERE on_time IS NOT NULL
  AND booking_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
  AND booking_date <= CAST({{as_of_date}} AS DATE)
UNION ALL
SELECT 'partner_shift_rows' AS check_name, COUNT(*) AS record_count FROM partner_shifts`,
      },
      {
        id: "c2_sla_window",
        label: "Build SLA Window Base",
        description: "Filter bookings to the lookback window once with SLA, payment, and reassignment fields for consistent downstream cuts.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["sla_window"],
        sql: `SELECT
  booking_id,
  customer_id,
  city,
  hub_id,
  hub_name,
  service_tier,
  on_time,
  arrival_time_min,
  expected_arrival_min,
  partner_reassigned,
  payment_status
FROM bookings
WHERE booking_date > CAST({{as_of_date}} AS DATE) - ({{lookback_days}} * INTERVAL '1 day')
  AND booking_date <= CAST({{as_of_date}} AS DATE)`,
      },
      {
        id: "c3_sla_by_hub",
        label: "SLA Health by City and Hub",
        description: "On-time rate, average arrival delay versus SLA target, reassignment, refund, and failed-payment rates by city and hub.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_sla_window"],
        outputs: ["sla_by_hub"],
        sql: `SELECT
  city,
  hub_name,
  COUNT(*) AS bookings,
  ROUND(AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100, 2) AS on_time_pct,
  ROUND(AVG(arrival_time_min), 1) AS avg_arrival_min,
  ROUND(AVG(expected_arrival_min), 1) AS sla_target_min,
  ROUND(AVG(arrival_time_min - expected_arrival_min), 1) AS avg_delay_vs_sla_min,
  ROUND(AVG(CASE WHEN partner_reassigned THEN 1.0 ELSE 0.0 END) * 100, 2) AS reassign_pct,
  ROUND(COUNT(*) FILTER (WHERE payment_status = 'refunded') * 100.0 / NULLIF(COUNT(*), 0), 2) AS refund_pct,
  ROUND(COUNT(*) FILTER (WHERE payment_status = 'failed') * 100.0 / NULLIF(COUNT(*), 0), 2) AS failed_pct
FROM sla_window
GROUP BY city, hub_name
ORDER BY bookings DESC`,
      },
      {
        id: "c4_partner_reliability",
        label: "Partner Reliability by Hub",
        description: "No-show and shift-cancellation rates by hub from partner_shifts, joined to hub names from bookings.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["partner_reliability"],
        sql: `WITH hub_names AS (
  SELECT DISTINCT hub_id, hub_name FROM bookings WHERE hub_name IS NOT NULL
)
SELECT
  ps.hub_id,
  hn.hub_name,
  COUNT(*) AS shifts,
  ROUND(COUNT(*) FILTER (WHERE ps.status = 'no_show') * 100.0 / NULLIF(COUNT(*), 0), 2) AS no_show_pct,
  ROUND(COUNT(*) FILTER (WHERE ps.status = 'cancelled') * 100.0 / NULLIF(COUNT(*), 0), 2) AS cancel_pct,
  ROUND(COUNT(*) FILTER (WHERE ps.status = 'served') * 100.0 / NULLIF(COUNT(*), 0), 2) AS served_pct,
  SUM(ps.bookings_completed) AS bookings_completed
FROM partner_shifts ps
LEFT JOIN hub_names hn ON ps.hub_id = hn.hub_id
GROUP BY ps.hub_id, hn.hub_name
ORDER BY no_show_pct DESC`,
      },
      {
        id: "c5_rebooking_impact",
        label: "Early Experience to Rebooking",
        description: "Split first-time customers by whether their first two bookings were mostly on-time, then compare the share who rebook within the rebook window, isolating the retention cost of poor early SLA.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["sla_rebooking_impact"],
        sql: `WITH seq AS (
  SELECT
    customer_id,
    booking_date,
    booking_id,
    on_time,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY booking_date, booking_id) AS booking_rank
  FROM bookings
),
firsts AS (
  SELECT customer_id, booking_date AS first_booking_date FROM seq WHERE booking_rank = 1
),
early AS (
  SELECT
    f.customer_id,
    AVG(CASE WHEN s.on_time THEN 1.0 ELSE 0.0 END) AS early_on_time_rate,
    MAX(CASE WHEN s.booking_rank > 1 AND date_diff('day', f.first_booking_date, s.booking_date) BETWEEN 1 AND {{rebook_window_days}} THEN 1 ELSE 0 END) AS rebooked
  FROM firsts f
  JOIN seq s ON s.customer_id = f.customer_id AND s.booking_rank <= 2
  GROUP BY f.customer_id
)
SELECT
  CASE WHEN early_on_time_rate >= 0.5 THEN 'Mostly on-time early' ELSE 'Mostly late early' END AS early_experience,
  COUNT(*) AS cohort_size,
  SUM(rebooked) AS rebooked,
  ROUND(SUM(rebooked) * 100.0 / NULLIF(COUNT(*), 0), 2) AS rebook_pct
FROM early
GROUP BY early_experience
ORDER BY early_experience`,
      },
      {
        id: "c6_recovery_targets",
        label: "Rank Service-Recovery Hubs",
        description: "Rank hubs by SLA breach exposure (low on-time, high delay, high reassignment) so service-recovery effort lands where it protects the most bookings.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c3_sla_by_hub", "c4_partner_reliability"],
        outputs: ["service_recovery_targets"],
        sql: `SELECT
  s.city,
  s.hub_name,
  s.bookings,
  s.on_time_pct,
  s.avg_delay_vs_sla_min,
  s.reassign_pct,
  p.no_show_pct,
  p.cancel_pct,
  ROUND((100 - s.on_time_pct) * s.bookings / 100.0, 0) AS estimated_late_bookings
FROM sla_by_hub s
LEFT JOIN partner_reliability p ON s.hub_name = p.hub_name
ORDER BY s.on_time_pct ASC, s.avg_delay_vs_sla_min DESC`,
      },
      {
        id: "c7_sla_analysis",
        label: "Diagnose Fulfilment Health",
        description: "Interpret where SLA breaks down, how unreliable partners map to those hubs, and whether poor early experience suppresses rebooking.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_sla_by_hub", "c4_partner_reliability", "c5_rebooking_impact", "c6_recovery_targets"],
        outputs: ["sla_diagnosis"],
        prompt: `Analyze fulfilment and SLA health using only the upstream query results.

Cover:
- where on-time performance is worst and how far average arrival runs past the SLA target by city and hub;
- how partner no-show and shift-cancellation rates line up with the weakest SLA hubs;
- the rebooking gap between customers who had a mostly on-time early experience versus mostly late, and what that implies for retained GMV;
- which hubs should get service-recovery focus first and why.

Use actual numbers from the tables. Be concrete about the operational read for an ops lead. Do not invent figures.`,
      },
      {
        id: "c8_sla_summary",
        label: "Fulfilment Health Brief",
        description: "Produce the final executive-ready markdown brief with KPI table, charts, the experience-to-rebooking link, and a service-recovery action plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_sla_by_hub", "c4_partner_reliability", "c5_rebooking_impact", "c6_recovery_targets", "c7_sla_analysis"],
        outputs: ["sla_brief"],
        prompt: `Create a rich, executive-ready markdown brief on fulfilment and SLA health for the last {{lookback_days}} days as of {{as_of_date}}.

Include:
1. A one-paragraph direct answer naming overall on-time performance, the worst hubs, and whether poor early experience suppresses rebooking.
2. A compact KPI table: blended on-time rate, average delay versus SLA, reassignment rate, weakest hub no-show rate, and the rebooking gap between on-time and late early experiences.
3. At least two charts when upstream rows support them:
   - on-time rate or average delay by hub;
   - rebooking rate by early on-time experience.
4. A section connecting partner reliability to SLA breaches at the worst hubs.
5. A service-recovery action section: which hubs to fix first, what operational levers to pull (partner supply, routing, expectation-setting), and which customers to proactively apologize to.
6. A short SQL provenance note naming the core sources: bookings (SLA fields) and partner_shifts.

Use the data values directly. Keep recommendations grounded in the numbers.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded fulfilment and SLA health for QuickHelp.",
        changes: [
          {
            type: "add",
            cellLabel: "Early experience to rebooking",
            cellId: "c5_rebooking_impact",
            detail: "Links a customer's early on-time experience to whether they rebook within the rebook window.",
          },
        ],
      },
    ],
  };
}

export function seedQuickhelpPlaybooks(userId: string): number {
  const builders = [
    buildQuickhelpRetentionPlaybook,
    buildQuickhelpPnlPlaybook,
    buildQuickhelpSlaPlaybook,
  ];
  let count = 0;
  for (const build of builders) {
    const playbook = build(userId);
    if (getPlaybook(userId, playbook.id)) continue;
    upsertPlaybook(userId, playbook);
    count++;
  }
  return count;
}

export async function seedQuickhelpSampleWorkspace(userId: string): Promise<{
  segments: number;
  funnels: number;
  retentions: number;
  playbooks: number;
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
        datasetId: QUICKHELP_DATASET_ID,
      });
      segmentCount++;
    } catch (err) {
      console.warn(`[quickhelp-seed] segment ${segment.slug} failed:`, err);
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
        datasetId: QUICKHELP_DATASET_ID,
      });
      funnelCount++;
    } catch (err) {
      console.warn(`[quickhelp-seed] funnel ${funnel.slug} failed:`, err);
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
        datasetId: QUICKHELP_DATASET_ID,
      });
      retentionCount++;
    } catch (err) {
      console.warn(`[quickhelp-seed] retention ${retention.slug} failed:`, err);
    }
  }

  const playbookCount = seedQuickhelpPlaybooks(userId);
  // Voice campaigns are created manually per workspace; not seeded.
  const voiceCampaignCount = 0;

  return {
    segments: segmentCount,
    funnels: funnelCount,
    retentions: retentionCount,
    playbooks: playbookCount,
    voiceCampaigns: voiceCampaignCount,
  };
}
