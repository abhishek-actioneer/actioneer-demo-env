import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { healthiansDataset } from "@/lib/datasets/healthians";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";
import { getPlaybook, upsertPlaybook } from "@/lib/server/playbook-repo";
import type { PlaybookV2 } from "@/lib/playbook-types";

export const HEALTHIANS_DATASET_ID = "healthians";
const DATA_RANGE = { start: "2024-04-01", end: "2026-05-26" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `hl_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, HEALTHIANS_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  const row = result.rows[0] as Record<string, unknown>;
  return Number(row.n) || 0;
}

// ─────────────────────────────────────────────────────────────────────
// SEGMENTS: handcrafted SQL, customer_id is the entity
// ─────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  {
    slug: "chronic-subscribers",
    name: "Chronic Disease Subscribers",
    description: "Customers with active recurring test subscriptions (HbA1c, thyroid, etc.), highest LTV segment.",
    sql: "SELECT DISTINCT customer_id FROM raw_subscriptions WHERE status = 'active'",
  },
  {
    slug: "diabetic-patients",
    name: "Diabetic Customers",
    description: "Customers with known diabetes, heavy users of HbA1c and glucose tests.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE chronic_condition = 'diabetes' OR glucose_status = 'diabetic'",
  },
  {
    slug: "thyroid-patients",
    name: "Thyroid Patients",
    description: "Customers with thyroid disorders, recurring TSH testing.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE chronic_condition = 'thyroid' OR thyroid_status IN ('hypothyroid','hyperthyroid')",
  },
  {
    slug: "vitamin-d-deficient",
    name: "Vitamin D Deficient",
    description: "Customers with Vitamin D deficiency, primary supplement and retest target.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE vitamin_d_status IN ('deficient','severely_deficient')",
  },
  {
    slug: "high-value-customers",
    name: "High Value Customers",
    description: "Customers in the top LTV bucket: premium offers, executive packages.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE ltv_bucket IN ('high','vip')",
  },
  {
    slug: "at-risk-churn",
    name: "At-Risk of Churn",
    description: "Customers who haven't booked in 60+ days but were previously active. Reactivation target.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE customer_lifecycle_stage = 'at_risk'",
  },
  {
    slug: "lapsed-churned",
    name: "Lapsed / Churned Customers",
    description: "Customers with no booking in 180+ days. Win-back campaign target.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE customer_lifecycle_stage = 'churned'",
  },
  {
    slug: "family-bookers",
    name: "Family Bookers",
    description: "Customers who book tests for family members (children, elderly parents).",
    sql: "SELECT DISTINCT customer_id FROM bookings_full WHERE patient_relationship != 'self'",
  },
  {
    slug: "abnormal-result-unfollowed",
    name: "Abnormal Result: No Follow-up",
    description: "Customers with abnormal report findings who haven't booked a follow-up test. Highest conversion opportunity.",
    sql: "SELECT DISTINCT r.customer_id FROM reports_full r WHERE r.abnormal_params_count >= 1 AND r.critical_params_count = 0 AND NOT EXISTS (SELECT 1 FROM bookings_full b WHERE b.customer_id = r.customer_id AND b.follow_up_booked = true AND b.booking_date > r.report_date)",
  },
  {
    slug: "metro-premium",
    name: "Metro Premium Customers",
    description: "Customers in metro cities with high-value bookings, executive package upsell target.",
    sql: "SELECT DISTINCT customer_id FROM raw_customers WHERE city_tier = 'metro' AND ltv_bucket IN ('high','vip')",
  },
];

// ─────────────────────────────────────────────────────────────────────
// FUNNELS: use EventDefinition IDs from healthians.ts
// ─────────────────────────────────────────────────────────────────────
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "first-booking-to-engagement",
    name: "First Booking → Engagement Funnel",
    description: "First booking → report viewed → counseling → follow-up booked. The core retention chain.",
    config: {
      steps: [
        { eventId: "first_booking" },
        { eventId: "report_viewed" },
        { eventId: "counseling_session" },
        { eventId: "follow_up_booked" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "booking-lifecycle",
    name: "Booking Lifecycle",
    description: "Booking placed → phlebotomist assigned → sample collected → report generated. The operational fulfillment chain.",
    config: {
      // Operational fulfillment only. report_viewed is keyed on report_date (not the
      // report_generated event timestamp), so anchoring it as the final step within a
      // fixed window understates viewing to ~10%, contradicting the 84.8% true view
      // rate. Report viewing is already captured in first-booking-to-engagement.
      steps: [
        { eventId: "booking" },
        { eventId: "phlebotomist_assigned" },
        { eventId: "sample_collected" },
        { eventId: "report_generated" },
      ],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "crm-conversion",
    name: "CRM Campaign Conversion",
    description: "Notification sent → opened → clicked → booking confirmed. Channel ROI funnel.",
    config: {
      steps: [
        { eventId: "notification_sent" },
        { eventId: "notification_opened" },
        { eventId: "notification_clicked" },
        { eventId: "booking_confirmed" },
      ],
      conversionWindow: "7d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "abnormal-to-followup",
    name: "Abnormal Finding → Follow-up",
    description: "Customer with abnormal report → clicks abnormal flag → books follow-up.",
    config: {
      steps: [
        { eventId: "abnormal_report" },
        { eventId: "abnormal_flag_clicked" },
        { eventId: "follow_up_booked" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "report-to-action-pathway",
    name: "Report → Clinical Action Pathway",
    description: "The full clinical-to-revenue journey, split by city tier: booking → report generated → report viewed → abnormal flag clicked → counseling → follow-up booked. Shows where the funnel leaks between a finding and the patient acting on it. Strict ordered, 90-day window.",
    config: {
      // 6-step ordered journey on event timestamps. report_viewed and counseling
      // anchor on their own date columns; the strict-order + 90d window keeps the
      // chain monotonic and believable (~8% reach a booked follow-up). Metro tracks
      // slightly ahead of tier2 on clinical follow-through, which matches the data.
      steps: [
        { eventId: "booking" },
        { eventId: "report_generated" },
        { eventId: "report_viewed" },
        { eventId: "abnormal_flag_clicked" },
        { eventId: "counseling_session" },
        { eventId: "follow_up_booked" },
      ],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
      breakdown: "city_tier",
      countingMethod: "uniques",
    },
  },
  {
    slug: "browse-to-fulfillment",
    name: "Browse → Fulfillment Journey",
    description: "Six-step browse-to-fulfillment path split by city tier: test page viewed → book now tapped → slot selected → OTP verified → payment completed → booking confirmed. Uses any-order matching within a 7-day window so a customer who completes the journey across a couple of sessions still counts.",
    config: {
      steps: [
        { eventId: "test_page_viewed" },
        { eventId: "book_now_tapped" },
        { eventId: "slot_selected" },
        { eventId: "otp_verified" },
        { eventId: "payment_completed" },
        { eventId: "booking_confirmed" },
      ],
      conversionWindow: "7d",
      order: "any_order",
      dateRange: DATA_RANGE,
      breakdown: "city_tier",
    },
  },
  {
    slug: "checkout-completion",
    name: "Checkout Completion",
    description: "Same-day checkout completion split by city tier: book now tapped → slot selected → OTP verified → payment completed → booking confirmed. Any-order within a 1-day window isolates the in-session checkout, where roughly half of started checkouts complete and tier performance is near-parity.",
    config: {
      steps: [
        { eventId: "book_now_tapped" },
        { eventId: "slot_selected" },
        { eventId: "otp_verified" },
        { eventId: "payment_completed" },
        { eventId: "booking_confirmed" },
      ],
      conversionWindow: "1d",
      order: "any_order",
      dateRange: DATA_RANGE,
      breakdown: "city_tier",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────
// RETENTIONS: use EventDefinition IDs from healthians.ts
// ─────────────────────────────────────────────────────────────────────
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "booking-repeat",
    name: "Booking Repeat Retention",
    description: "Of first-time bookers, the share who return for another test. Diagnostics is low-frequency, so this is a cumulative repeat curve: most chronic-care customers retest over the following months, not within a week.",
    config: {
      startEventId: "first_booking",
      returnEventIds: ["booking"],
      // Cumulative return ("on or after"). Diagnostics customers retest over months,
      // not days, so exact-day retention is ~0 and reads as broken; the cumulative
      // repeat curve is the believable, on-story read.
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "subscriber-adherence",
    name: "Subscription Adherence",
    description: "Whether subscribers stick with their scheduled retests.",
    config: {
      startEventId: "subscription_started",
      returnEventIds: ["booking"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "report-engagement",
    name: "Report Engagement Retention",
    description: "Of customers who view a report, the share who return to view future reports: a cumulative engagement-repeat curve across the relationship.",
    config: {
      startEventId: "report_viewed",
      returnEventIds: ["report_viewed"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "first-booking-rebook-and-counsel",
    name: "First Booking → Rebook & Counseling",
    description: "Of first-time bookers, the cumulative share who come back for another test and, separately, who take a counseling session. Two return curves on one cohort show that re-booking runs well ahead of counseling uptake, which is the lever to pull. Diagnostics is low-frequency, so this is an on-or-after cumulative read, not exact-day.",
    config: {
      startEventId: "first_booking",
      // Two return events on the same cohort: any repeat booking, and counseling.
      returnEventIds: ["booking", "counseling_session"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "abnormal-result-recovery",
    name: "Abnormal Result → View & Follow-up",
    description: "Of customers with an abnormal finding, the cumulative share who open the report and, separately, who book a recommended follow-up test. The gap between viewing and booking is the patient-safety and revenue-recovery opportunity. On-or-after cumulative read across the relationship.",
    config: {
      startEventId: "abnormal_report",
      // Two return events on the same cohort: report viewed, and a booked follow-up.
      returnEventIds: ["report_viewed", "follow_up_booked"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, healthiansDataset, HEALTHIANS_DATASET_ID);
}

async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, healthiansDataset, HEALTHIANS_DATASET_ID);
}

// ─────────────────────────────────────────────────────────────────────
// PLAYBOOKS (V2 DAG workflows)
// SQL cells reference upstream outputs by their `outputs` name, which the
// DAG executor materialises as queryable tables (same pattern as FundsIndia).
// ─────────────────────────────────────────────────────────────────────

const ABNORMAL_FOLLOWUP_SLUG = "abnormal-to-followup-conversion";
const REPEAT_ENGINE_SLUG = "repeat-subscription-engine";
const CRM_ROI_SLUG = "crm-channel-roi";

export function buildHealthiansAbnormalFollowupPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", ABNORMAL_FOLLOWUP_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Abnormal Result to Follow-up Conversion",
    description: "Trace the clinical-to-revenue leak: customers whose reports surface abnormal or critical findings, then through report viewing, counseling, and an actual follow-up booking. Quantifies the drop-off at each stage by test category and city tier, and surfaces the highest-value customers with an unactioned abnormal result.",
    category: "Clinical Revenue",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: HEALTHIANS_DATASET_ID,
    sourceQuery: "Of customers who got an abnormal or critical finding, how many viewed the report, took counseling, and booked a recommended follow-up test, and where does the funnel leak by package and city tier?",
    params: [
      { name: "lookback_start", label: "Report window start", type: "date", defaultVal: "2024-04-01", group: "Window" },
      { name: "lookback_end", label: "Report window end", type: "date", defaultVal: "2026-05-26", group: "Window" },
      { name: "priority_limit", label: "Priority customer rows", type: "integer", defaultVal: "50", group: "Output" },
    ],
    produces: [
      {
        name: "abnormal_reports_base",
        description: "Report-level base of abnormal and critical findings with view, counseling, and follow-up flags and clinical context.",
        columns: [
          { name: "report_id", description: "Health report identifier." },
          { name: "severity", description: "critical when any critical parameter, else abnormal." },
          { name: "report_viewed", description: "Whether the customer opened the report." },
          { name: "counseled", description: "Whether a counseling session was logged against this report." },
          { name: "followup_booked", description: "Whether a recommended follow-up test was booked within window." },
        ],
      },
      { name: "abnormal_funnel_kpis", description: "Headline funnel: abnormal reports, viewed, counseled, follow-up booked, plus stage conversion rates and attributed follow-up revenue." },
      { name: "followup_by_category", description: "Abnormal-to-follow-up conversion split by primary test category." },
      { name: "followup_leak_by_tier", description: "Stage-by-stage funnel split by city tier to locate the largest operational leak." },
      { name: "priority_unactioned_customers", description: "Highest-value customers with a viewed abnormal report but no follow-up booking, ranked for outreach." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Clinical Inputs",
        description: "Confirm abnormal reports, counseling sessions, and follow-up recommendation records exist in the selected window.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'abnormal_reports' AS check_name, COUNT(*) AS record_count
  FROM reports_full
  WHERE abnormal_params_count > 0
    AND report_date BETWEEN CAST({{lookback_start}} AS DATE) AND CAST({{lookback_end}} AS DATE)
  UNION ALL
  SELECT 'critical_reports', COUNT(*)
  FROM reports_full
  WHERE critical_params_count > 0
    AND report_date BETWEEN CAST({{lookback_start}} AS DATE) AND CAST({{lookback_end}} AS DATE)
  UNION ALL
  SELECT 'counseling_sessions', COUNT(*) FROM counseling_full
  UNION ALL
  SELECT 'followup_recommendations', COUNT(*) FROM future_tests_full
)
SELECT check_name, record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_abnormal_base",
        label: "Build Abnormal Finding Base",
        description: "Assemble the report-level base of abnormal and critical findings, joining report viewing, counseling presence, and follow-up booking within window.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["abnormal_reports_base"],
        sql: `WITH abn AS (
  SELECT
    r.report_id,
    r.booking_id,
    r.customer_id,
    r.report_date,
    r.city_tier,
    r.archetype,
    r.age_group,
    r.ltv_bucket,
    r.chronic_condition,
    r.primary_test_category,
    r.report_viewed,
    r.abnormal_params_count,
    r.critical_params_count,
    CASE WHEN r.critical_params_count > 0 THEN 'critical' ELSE 'abnormal' END AS severity
  FROM reports_full r
  WHERE r.abnormal_params_count > 0
    AND r.report_date BETWEEN CAST({{lookback_start}} AS DATE) AND CAST({{lookback_end}} AS DATE)
),
counseled AS (
  SELECT DISTINCT report_id FROM counseling_full WHERE report_id IS NOT NULL
),
followup AS (
  SELECT report_id, ANY_VALUE(followup_booking_id) AS followup_booking_id
  FROM future_tests_full
  WHERE booked_within_window = true
  GROUP BY report_id
)
SELECT
  a.report_id,
  a.booking_id,
  a.customer_id,
  a.report_date,
  a.city_tier,
  a.archetype,
  a.age_group,
  a.ltv_bucket,
  a.chronic_condition,
  a.primary_test_category,
  a.severity,
  a.abnormal_params_count,
  a.critical_params_count,
  a.report_viewed,
  (cs.report_id IS NOT NULL) AS counseled,
  (f.report_id IS NOT NULL) AS followup_booked,
  f.followup_booking_id
FROM abn a
LEFT JOIN counseled cs ON a.report_id = cs.report_id
LEFT JOIN followup f ON a.report_id = f.report_id`,
      },
      {
        id: "c3_funnel_kpis",
        label: "Size the Clinical Funnel",
        description: "Compute the abnormal to view to counseling to follow-up funnel with stage conversion rates and follow-up revenue attribution.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_abnormal_base"],
        outputs: ["abnormal_funnel_kpis"],
        sql: `WITH base AS (
  SELECT * FROM abnormal_reports_base
),
followup_rev AS (
  SELECT
    COUNT(*) AS followup_bookings_matched,
    ROUND(SUM(b.total_paid_inr), 0) AS followup_revenue_inr
  FROM base a
  JOIN bookings_full b ON a.followup_booking_id = b.booking_id
  WHERE a.followup_booked = true
)
SELECT
  COUNT(*) AS abnormal_reports,
  COUNT(*) FILTER (WHERE severity = 'critical') AS critical_reports,
  COUNT(*) FILTER (WHERE report_viewed = true) AS reports_viewed,
  COUNT(*) FILTER (WHERE counseled = true) AS counseled,
  COUNT(*) FILTER (WHERE followup_booked = true) AS followup_booked,
  ROUND(COUNT(*) FILTER (WHERE report_viewed = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS view_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE counseled = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE report_viewed = true), 0), 1) AS counseling_rate_of_viewed_pct,
  ROUND(COUNT(*) FILTER (WHERE followup_booked = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS followup_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE followup_booked = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE counseled = true), 0), 1) AS followup_rate_of_counseled_pct,
  fr.followup_bookings_matched,
  fr.followup_revenue_inr,
  ROUND(fr.followup_revenue_inr * 1.0 / NULLIF(fr.followup_bookings_matched, 0), 0) AS avg_followup_value_inr
FROM base
CROSS JOIN followup_rev fr
GROUP BY fr.followup_bookings_matched, fr.followup_revenue_inr`,
      },
      {
        id: "c4_by_category",
        label: "Conversion by Test Category",
        description: "Break abnormal-to-follow-up conversion by primary test category to find which clinical packages leak most revenue.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_abnormal_base"],
        outputs: ["followup_by_category"],
        sql: `SELECT
  primary_test_category,
  COUNT(*) AS abnormal_reports,
  COUNT(*) FILTER (WHERE severity = 'critical') AS critical_reports,
  COUNT(*) FILTER (WHERE report_viewed = true) AS reports_viewed,
  COUNT(*) FILTER (WHERE counseled = true) AS counseled,
  COUNT(*) FILTER (WHERE followup_booked = true) AS followup_booked,
  ROUND(COUNT(*) FILTER (WHERE followup_booked = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS followup_conv_pct,
  COUNT(*) FILTER (WHERE report_viewed = true AND followup_booked = false) AS viewed_no_followup
FROM abnormal_reports_base
GROUP BY primary_test_category
ORDER BY abnormal_reports DESC`,
      },
      {
        id: "c5_leak_by_tier",
        label: "Leak by City Tier",
        description: "Stage-by-stage funnel split by city tier, exposing where metro and tier2 operations diverge in clinical follow-through.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_abnormal_base"],
        outputs: ["followup_leak_by_tier"],
        sql: `SELECT
  city_tier,
  COUNT(*) AS abnormal_reports,
  ROUND(COUNT(*) FILTER (WHERE report_viewed = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS view_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE counseled = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE report_viewed = true), 0), 1) AS counseling_of_viewed_pct,
  ROUND(COUNT(*) FILTER (WHERE followup_booked = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS followup_rate_pct,
  COUNT(*) FILTER (WHERE severity = 'critical' AND report_viewed = false) AS critical_unviewed,
  COUNT(*) FILTER (WHERE report_viewed = true AND followup_booked = false) AS viewed_no_followup
FROM abnormal_reports_base
GROUP BY city_tier
ORDER BY abnormal_reports DESC`,
      },
      {
        id: "c6_priority_customers",
        label: "Rank Unactioned Customers",
        description: "Surface the highest-value customers who viewed an abnormal or critical report but never booked a follow-up, for compliant clinical outreach.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_abnormal_base"],
        outputs: ["priority_unactioned_customers"],
        sql: `WITH unactioned AS (
  SELECT
    customer_id,
    MAX(report_date) AS last_abnormal_report_date,
    COUNT(*) AS abnormal_reports,
    SUM(critical_params_count) AS total_critical_params,
    SUM(abnormal_params_count) AS total_abnormal_params,
    ANY_VALUE(city_tier) AS city_tier,
    ANY_VALUE(archetype) AS archetype,
    ANY_VALUE(ltv_bucket) AS ltv_bucket,
    ANY_VALUE(chronic_condition) AS chronic_condition,
    MAX(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS has_critical
  FROM abnormal_reports_base
  WHERE report_viewed = true
    AND followup_booked = false
    AND counseled = false
  GROUP BY customer_id
)
SELECT
  customer_id,
  city_tier,
  archetype,
  ltv_bucket,
  chronic_condition,
  abnormal_reports,
  total_abnormal_params,
  total_critical_params,
  (has_critical = 1) AS has_critical_finding,
  last_abnormal_report_date,
  date_diff('day', last_abnormal_report_date, CAST({{lookback_end}} AS DATE)) AS days_since_last_abnormal
FROM unactioned
ORDER BY has_critical DESC, total_critical_params DESC, total_abnormal_params DESC, customer_id
LIMIT {{priority_limit}}`,
      },
      {
        id: "c7_analysis",
        label: "Diagnose the Leak",
        description: "Interpret where the abnormal-to-follow-up funnel leaks and which categories and tiers cost the most.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_funnel_kpis", "c4_by_category", "c5_leak_by_tier", "c6_priority_customers"],
        outputs: ["abnormal_followup_diagnosis"],
        prompt: `Analyze the abnormal-result to follow-up funnel using only the upstream query results.

Focus on:
- the headline conversion: of abnormal reports, what share are viewed, counseled, and converted to a booked follow-up, and the attributed follow-up revenue;
- which stage is the biggest leak (view, counseling, or follow-up booking);
- which test categories convert worst relative to volume, and which carry the most viewed-but-unactioned reports;
- how metro, tier1, and tier2 differ, including critical reports that were never viewed;
- the size and clinical risk of the unactioned priority customer list.

Use actual numbers. Treat this as a patient-safety and revenue-recovery question. Do not give individual medical advice; recommend compliant operational nudges only.`,
      },
      {
        id: "c8_summary",
        label: "Clinical Recovery Brief",
        description: "Produce the executive brief with funnel KPIs, charts, leak diagnosis, and a prioritized recovery plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_funnel_kpis", "c4_by_category", "c5_leak_by_tier", "c6_priority_customers", "c7_analysis"],
        outputs: ["abnormal_followup_brief"],
        prompt: `Create a rich, executive-ready markdown brief on the abnormal-result to follow-up funnel.

The brief must include:
1. A one-paragraph direct answer stating the abnormal report base, the overall follow-up conversion rate, and the attributed follow-up revenue.
2. A compact funnel KPI table: abnormal reports, viewed, counseled, follow-up booked, with stage conversion rates and follow-up revenue.
3. At least two charts when supported by the data:
   - follow-up conversion by test category;
   - the funnel leak (view rate, counseling rate, follow-up rate) by city tier.
4. A leak section naming the single largest drop-off stage and the categories and tiers that lose the most.
5. A recovery-action section: who to contact first (the unactioned priority customers), which clinical packages to target, and the compliant nudge angle (report reminder, counseling offer, retest scheduling).
6. A short SQL provenance note naming the source views: reports_full, counseling_full, future_tests_full, and bookings_full.

Use raw rupee values. Keep all recommendations compliant: operational reminders and scheduling nudges only, never personalized medical advice or diagnosis.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded abnormal-result to follow-up conversion analysis for Healthians.",
        changes: [
          {
            type: "add",
            cellLabel: "Abnormal finding base",
            cellId: "c2_abnormal_base",
            detail: "Joins abnormal and critical reports to viewing, counseling, and within-window follow-up booking.",
          },
        ],
      },
    ],
  };
}

export function buildHealthiansRepeatEnginePlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", REPEAT_ENGINE_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "Repeat & Subscription Engine",
    description: "Map the repeat-revenue engine: first-to-second booking conversion and timing by archetype, the chronic-care subscription book and its run adherence, and realized lifetime value per archetype. Identifies which segments compound and which leak after a single visit.",
    category: "Retention",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: HEALTHIANS_DATASET_ID,
    sourceQuery: "Which customer archetypes repeat, how fast do they come back for a second test, how adherent are chronic subscribers to their scheduled runs, and what is realized LTV by archetype?",
    params: [
      { name: "cohort_start", label: "First-booking cohort start", type: "date", defaultVal: "2024-04-01", group: "Cohort" },
      { name: "cohort_end", label: "First-booking cohort end", type: "date", defaultVal: "2026-05-26", group: "Cohort" },
    ],
    produces: [
      {
        name: "customer_booking_journey",
        description: "Per-customer journey: first and second booking dates, total bookings, realized spend, subscription flag, and archetype.",
        columns: [
          { name: "customer_id", description: "Healthians customer identifier." },
          { name: "first_booking_date", description: "Date of first completed or placed booking." },
          { name: "second_booking_date", description: "Date of second booking, null if never repeated." },
          { name: "total_bookings", description: "Lifetime booking count in the dataset." },
          { name: "realized_spend_inr", description: "Sum of total_paid_inr across the customer's bookings." },
        ],
      },
      { name: "repeat_kpis", description: "Headline repeat rate, median days to second booking, repeat-customer share, and revenue concentration." },
      { name: "repeat_by_archetype", description: "First-to-second conversion, timing, and realized LTV split by customer archetype." },
      { name: "subscription_adherence", description: "Subscription book size and scheduled-run adherence by status and frequency." },
      { name: "ltv_by_archetype_ltvbucket", description: "Realized spend matrix across archetype and LTV bucket." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check Repeat Inputs",
        description: "Confirm bookings, subscription, and subscription-run records exist for the cohort window.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'bookings_in_window' AS check_name, COUNT(*) AS record_count
  FROM bookings_full
  WHERE booking_date BETWEEN CAST({{cohort_start}} AS DATE) AND CAST({{cohort_end}} AS DATE)
  UNION ALL
  SELECT 'first_bookings', COUNT(*) FROM bookings_full WHERE is_first_booking = true
  UNION ALL
  SELECT 'subscriptions', COUNT(*) FROM raw_subscriptions
  UNION ALL
  SELECT 'subscription_runs', COUNT(*) FROM raw_subscription_runs
)
SELECT check_name, record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_journey",
        label: "Build Customer Journey",
        description: "Order each customer's bookings to derive first and second booking dates, lifetime counts, and realized spend.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["customer_booking_journey"],
        sql: `WITH ordered AS (
  SELECT
    customer_id,
    booking_date,
    booking_id,
    total_paid_inr,
    archetype,
    ltv_bucket,
    city_tier,
    acquisition_channel,
    subscription_active,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY booking_date, booking_id) AS booking_rank
  FROM bookings_full
),
firsts AS (
  SELECT customer_id, booking_date AS first_booking_date, archetype, ltv_bucket, city_tier,
         acquisition_channel, subscription_active
  FROM ordered WHERE booking_rank = 1
),
seconds AS (
  SELECT customer_id, booking_date AS second_booking_date FROM ordered WHERE booking_rank = 2
),
totals AS (
  SELECT customer_id, COUNT(*) AS total_bookings, ROUND(SUM(total_paid_inr), 0) AS realized_spend_inr
  FROM ordered GROUP BY customer_id
)
SELECT
  f.customer_id,
  f.first_booking_date,
  s.second_booking_date,
  f.archetype,
  f.ltv_bucket,
  f.city_tier,
  f.acquisition_channel,
  f.subscription_active,
  t.total_bookings,
  t.realized_spend_inr,
  (s.second_booking_date IS NOT NULL) AS repeated,
  date_diff('day', f.first_booking_date, s.second_booking_date) AS days_to_second
FROM firsts f
LEFT JOIN seconds s ON f.customer_id = s.customer_id
LEFT JOIN totals t ON f.customer_id = t.customer_id
WHERE f.first_booking_date BETWEEN CAST({{cohort_start}} AS DATE) AND CAST({{cohort_end}} AS DATE)`,
      },
      {
        id: "c3_repeat_kpis",
        label: "Size the Repeat Engine",
        description: "Compute overall repeat rate, timing to second booking, and revenue concentration in repeat customers.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_journey"],
        outputs: ["repeat_kpis"],
        sql: `SELECT
  COUNT(*) AS cohort_customers,
  COUNT(*) FILTER (WHERE repeated = true) AS repeat_customers,
  ROUND(COUNT(*) FILTER (WHERE repeated = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS repeat_rate_pct,
  ROUND(MEDIAN(days_to_second) FILTER (WHERE repeated = true), 0) AS median_days_to_second,
  ROUND(AVG(days_to_second) FILTER (WHERE repeated = true), 0) AS avg_days_to_second,
  ROUND(AVG(total_bookings), 2) AS avg_lifetime_bookings,
  ROUND(SUM(realized_spend_inr), 0) AS total_realized_spend_inr,
  ROUND(SUM(realized_spend_inr) FILTER (WHERE repeated = true) * 100.0 / NULLIF(SUM(realized_spend_inr), 0), 1) AS repeat_revenue_share_pct,
  ROUND(SUM(realized_spend_inr) FILTER (WHERE subscription_active = true) * 100.0 / NULLIF(SUM(realized_spend_inr), 0), 1) AS subscriber_revenue_share_pct
FROM customer_booking_journey`,
      },
      {
        id: "c4_by_archetype",
        label: "Repeat by Archetype",
        description: "First-to-second conversion, timing, lifetime bookings, and realized LTV by archetype.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_journey"],
        outputs: ["repeat_by_archetype"],
        sql: `SELECT
  archetype,
  COUNT(*) AS cohort_customers,
  COUNT(*) FILTER (WHERE repeated = true) AS repeat_customers,
  ROUND(COUNT(*) FILTER (WHERE repeated = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS repeat_rate_pct,
  ROUND(MEDIAN(days_to_second) FILTER (WHERE repeated = true), 0) AS median_days_to_second,
  ROUND(AVG(total_bookings), 2) AS avg_lifetime_bookings,
  ROUND(AVG(realized_spend_inr), 0) AS avg_realized_ltv_inr,
  ROUND(SUM(realized_spend_inr), 0) AS total_realized_spend_inr
FROM customer_booking_journey
GROUP BY archetype
ORDER BY total_realized_spend_inr DESC`,
      },
      {
        id: "c5_subscription_adherence",
        label: "Subscription Adherence",
        description: "Chronic-care subscription book size and scheduled-run adherence by status and frequency band.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["subscription_adherence"],
        sql: `WITH runs AS (
  SELECT
    s.subscription_id,
    s.status AS subscription_status,
    s.adherence_rate_pct,
    CASE WHEN s.frequency_days <= 90 THEN 'quarterly'
         WHEN s.frequency_days <= 180 THEN 'half_yearly'
         ELSE 'annual' END AS frequency_band,
    sr.run_id,
    sr.status AS run_status
  FROM raw_subscriptions s
  LEFT JOIN raw_subscription_runs sr ON s.subscription_id = sr.subscription_id
)
SELECT
  subscription_status,
  frequency_band,
  COUNT(DISTINCT subscription_id) AS subscriptions,
  ROUND(AVG(adherence_rate_pct), 1) AS avg_adherence_pct,
  COUNT(run_id) AS scheduled_runs,
  COUNT(run_id) FILTER (WHERE run_status = 'completed') AS completed_runs,
  COUNT(run_id) FILTER (WHERE run_status = 'late') AS late_runs,
  COUNT(run_id) FILTER (WHERE run_status = 'skipped') AS skipped_runs,
  ROUND(COUNT(run_id) FILTER (WHERE run_status = 'completed') * 100.0 / NULLIF(COUNT(run_id), 0), 1) AS run_completion_pct
FROM runs
GROUP BY subscription_status, frequency_band
ORDER BY subscriptions DESC`,
      },
      {
        id: "c6_ltv_matrix",
        label: "LTV Matrix",
        description: "Realized-spend matrix across archetype and LTV bucket to locate the most valuable repeat cohorts.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_journey"],
        outputs: ["ltv_by_archetype_ltvbucket"],
        sql: `SELECT
  archetype,
  ltv_bucket,
  COUNT(*) AS customers,
  ROUND(AVG(total_bookings), 2) AS avg_lifetime_bookings,
  ROUND(AVG(realized_spend_inr), 0) AS avg_realized_ltv_inr,
  ROUND(SUM(realized_spend_inr), 0) AS total_realized_spend_inr,
  ROUND(COUNT(*) FILTER (WHERE repeated = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS repeat_rate_pct
FROM customer_booking_journey
GROUP BY archetype, ltv_bucket
ORDER BY total_realized_spend_inr DESC
LIMIT 30`,
      },
      {
        id: "c7_analysis",
        label: "Diagnose Repeat Engine",
        description: "Interpret which archetypes compound, how fast they return, and where subscription adherence leaks.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c3_repeat_kpis", "c4_by_archetype", "c5_subscription_adherence", "c6_ltv_matrix"],
        outputs: ["repeat_engine_diagnosis"],
        prompt: `Analyze the repeat and subscription engine using only the upstream query results.

Focus on:
- overall repeat rate, median days to second booking, and how concentrated revenue is in repeat customers and active subscribers;
- which archetypes have the strongest repeat behavior and fastest return, and which leak after one visit;
- subscription run adherence by status and frequency, including late and skipped runs;
- where the highest realized LTV sits in the archetype by LTV bucket matrix.

Use actual numbers. Frame this as a retention and lifecycle question: which segments to defend, which to convert from one-and-done, and where subscription adherence needs operational support.`,
      },
      {
        id: "c8_summary",
        label: "Retention Engine Brief",
        description: "Produce the executive brief with repeat KPIs, archetype and subscription charts, and a prioritized retention plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c3_repeat_kpis", "c4_by_archetype", "c5_subscription_adherence", "c6_ltv_matrix", "c7_analysis"],
        outputs: ["repeat_engine_brief"],
        prompt: `Create a rich, executive-ready markdown brief on the repeat and subscription engine.

The brief must include:
1. A one-paragraph direct answer stating the cohort size, overall repeat rate, median days to second booking, and repeat revenue share.
2. A compact KPI table: cohort customers, repeat customers, repeat rate, median days to second, avg lifetime bookings, repeat revenue share, subscriber revenue share.
3. At least two charts when supported by the data:
   - repeat rate or realized LTV by archetype;
   - subscription run completion by status or frequency band.
4. A segment section naming which archetypes compound and which leak after one visit, with the timing implications for re-engagement.
5. An action section: which archetypes to defend, how to convert one-and-done customers, and where subscription adherence needs intervention.
6. A short SQL provenance note naming the sources: bookings_full, raw_subscriptions, and raw_subscription_runs.

Use raw rupee values. Keep recommendations operational and compliant: scheduling reminders and lifecycle nudges, no medical advice.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded repeat and subscription engine analysis for Healthians.",
        changes: [
          {
            type: "add",
            cellLabel: "Customer journey",
            cellId: "c2_journey",
            detail: "Derives first and second booking timing, lifetime bookings, and realized spend per customer.",
          },
        ],
      },
    ],
  };
}

export function buildHealthiansCrmRoiPlaybook(userId: string, now = new Date().toISOString()): PlaybookV2 {
  const id = seedId(userId, "pb", CRM_ROI_SLUG);

  return {
    id,
    schemaVersion: 2,
    name: "CRM Channel ROI",
    description: "Compare WhatsApp, push, SMS, and email across the full send to open to click to booking chain. Attributes downstream booking revenue to each channel using a post-click window, computes cost per converted booking and return on spend, and breaks performance by campaign type and lifecycle segment.",
    category: "CRM",
    version: "1.0",
    approvalStatus: "approved",
    owner: "Actioneer",
    ownerInitials: "A",
    datasetId: HEALTHIANS_DATASET_ID,
    sourceQuery: "Which CRM channel drives the best return: send to open to click to booking, cost per converted booking, attributed revenue, and which campaign types and lifecycle segments perform best per channel?",
    params: [
      { name: "window_start", label: "Send window start", type: "date", defaultVal: "2024-04-01", group: "Window" },
      { name: "window_end", label: "Send window end", type: "date", defaultVal: "2026-05-26", group: "Window" },
      { name: "attribution_days", label: "Post-click attribution days", type: "integer", defaultVal: "7", group: "Attribution" },
    ],
    produces: [
      {
        name: "channel_funnel",
        description: "Per-channel send, delivered, opened, clicked, converted counts and total send cost.",
        columns: [
          { name: "channel", description: "CRM channel: whatsapp, push, sms, email, in_app." },
          { name: "sends", description: "Messages sent in window." },
          { name: "clicked", description: "Messages clicked." },
          { name: "total_cost_inr", description: "Total send cost across the channel." },
        ],
      },
      { name: "channel_revenue", description: "Attributed booking revenue per channel via post-click window join, with cost per converted booking and return on spend." },
      { name: "channel_by_campaign", description: "Channel by campaign-type open, click, and conversion performance." },
      { name: "channel_by_segment", description: "Channel performance split by lifecycle segment at send time." },
    ],
    cells: [
      {
        id: "c1_readiness",
        label: "Check CRM Inputs",
        description: "Confirm comms sends and downstream bookings exist for the selected send window.",
        type: "sql",
        role: "guardrail",
        status: "idle",
        dependsOn: [],
        outputs: ["readiness_check"],
        sql: `WITH checks AS (
  SELECT 'sends_in_window' AS check_name, COUNT(*) AS record_count
  FROM comms_full
  WHERE CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
  UNION ALL
  SELECT 'clicks_in_window', COUNT(*)
  FROM comms_full
  WHERE clicked = true
    AND CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
  UNION ALL
  SELECT 'bookings_total', COUNT(*) FROM bookings_full
  UNION ALL
  SELECT 'distinct_channels', COUNT(DISTINCT channel) FROM comms_full
)
SELECT check_name, record_count,
  CASE WHEN record_count > 0 THEN 'ok' ELSE 'empty' END AS status
FROM checks`,
      },
      {
        id: "c2_channel_funnel",
        label: "Build Channel Funnel",
        description: "Send to delivered to opened to clicked to converted counts and total cost per channel.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["channel_funnel"],
        sql: `SELECT
  channel,
  COUNT(*) AS sends,
  COUNT(*) FILTER (WHERE delivered = true) AS delivered,
  COUNT(*) FILTER (WHERE opened = true) AS opened,
  COUNT(*) FILTER (WHERE clicked = true) AS clicked,
  COUNT(*) FILTER (WHERE converted = true) AS converted,
  ROUND(COUNT(*) FILTER (WHERE opened = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE delivered = true), 0), 1) AS open_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE clicked = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE opened = true), 0), 1) AS click_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE converted = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE clicked = true), 0), 1) AS click_to_conv_pct,
  ROUND(SUM(send_cost_inr), 2) AS total_cost_inr
FROM comms_full
WHERE CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
GROUP BY channel
ORDER BY sends DESC`,
      },
      {
        id: "c3_channel_revenue",
        label: "Attribute Revenue & ROI",
        description: "Attribute booking revenue to each channel via a post-click window join on customer, then compute cost per converted booking and return on spend.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c2_channel_funnel"],
        outputs: ["channel_revenue"],
        sql: `WITH clicks AS (
  SELECT send_id, customer_id, channel, CAST(sent_at AS DATE) AS click_date, send_cost_inr
  FROM comms_full
  WHERE clicked = true
    AND CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
),
attributed AS (
  SELECT
    k.channel,
    k.send_id,
    MIN(b.total_paid_inr) AS attributed_booking_value
  FROM clicks k
  JOIN bookings_full b
    ON b.customer_id = k.customer_id
    AND b.booking_date >= k.click_date
    AND b.booking_date <= k.click_date + ({{attribution_days}} * INTERVAL '1 day')
  GROUP BY k.channel, k.send_id
),
cost AS (
  SELECT channel, ROUND(SUM(send_cost_inr), 2) AS total_cost_inr
  FROM comms_full
  WHERE CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
  GROUP BY channel
)
SELECT
  c.channel,
  COALESCE(COUNT(a.send_id), 0) AS attributed_bookings,
  COALESCE(ROUND(SUM(a.attributed_booking_value), 0), 0) AS attributed_revenue_inr,
  c.total_cost_inr,
  ROUND(c.total_cost_inr * 1.0 / NULLIF(COUNT(a.send_id), 0), 2) AS cost_per_attributed_booking_inr,
  ROUND(SUM(a.attributed_booking_value) * 1.0 / NULLIF(c.total_cost_inr, 0), 1) AS return_on_spend_x
FROM cost c
LEFT JOIN attributed a ON c.channel = a.channel
GROUP BY c.channel, c.total_cost_inr
ORDER BY attributed_revenue_inr DESC`,
      },
      {
        id: "c4_by_campaign",
        label: "Channel by Campaign",
        description: "Open, click, and conversion performance for each channel and campaign-type combination.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["channel_by_campaign"],
        sql: `SELECT
  campaign_type,
  channel,
  COUNT(*) AS sends,
  ROUND(COUNT(*) FILTER (WHERE opened = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE delivered = true), 0), 1) AS open_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE clicked = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE opened = true), 0), 1) AS click_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE converted = true) * 100.0 / NULLIF(COUNT(*), 0), 2) AS conv_rate_pct,
  ROUND(SUM(send_cost_inr), 2) AS total_cost_inr
FROM comms_full
WHERE CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
GROUP BY campaign_type, channel
HAVING COUNT(*) >= 500
ORDER BY sends DESC
LIMIT 30`,
      },
      {
        id: "c5_by_segment",
        label: "Channel by Lifecycle Segment",
        description: "How each channel performs against the customer's lifecycle segment at send time, including reactivation of churned customers.",
        type: "sql",
        role: "query",
        status: "idle",
        dependsOn: ["c1_readiness"],
        outputs: ["channel_by_segment"],
        sql: `SELECT
  user_segment_at_send,
  channel,
  COUNT(*) AS sends,
  ROUND(COUNT(*) FILTER (WHERE opened = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE delivered = true), 0), 1) AS open_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE clicked = true) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE opened = true), 0), 1) AS click_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE converted = true) * 100.0 / NULLIF(COUNT(*), 0), 2) AS conv_rate_pct
FROM comms_full
WHERE CAST(sent_at AS DATE) BETWEEN CAST({{window_start}} AS DATE) AND CAST({{window_end}} AS DATE)
  AND user_segment_at_send IS NOT NULL
GROUP BY user_segment_at_send, channel
HAVING COUNT(*) >= 500
ORDER BY user_segment_at_send, sends DESC`,
      },
      {
        id: "c6_analysis",
        label: "Diagnose Channel ROI",
        description: "Interpret which channels and campaign types deliver the best return on spend and which are wasteful.",
        type: "llm",
        role: "analysis",
        status: "idle",
        dependsOn: ["c2_channel_funnel", "c3_channel_revenue", "c4_by_campaign", "c5_by_segment"],
        outputs: ["crm_roi_diagnosis"],
        prompt: `Analyze CRM channel ROI using only the upstream query results.

Focus on:
- the send to open to click to conversion chain per channel, naming which channel has the strongest engagement;
- attributed revenue, cost per attributed booking, and return on spend per channel, separating high-cost-high-return from low-cost-low-return channels;
- which campaign types perform best and worst per channel;
- how channels perform across lifecycle segments, especially reactivation of at-risk and churned customers.

Use actual numbers. The send-cost economics matter: WhatsApp costs more per message than push or SMS, so judge channels on return on spend, not raw conversion alone. Recommend where to shift budget.`,
      },
      {
        id: "c7_summary",
        label: "CRM ROI Brief",
        description: "Produce the executive brief with channel funnel KPIs, ROI charts, and a budget-reallocation plan.",
        type: "llm",
        role: "summary",
        status: "idle",
        dependsOn: ["c1_readiness", "c2_channel_funnel", "c3_channel_revenue", "c4_by_campaign", "c5_by_segment", "c6_analysis"],
        outputs: ["crm_roi_brief"],
        prompt: `Create a rich, executive-ready markdown brief on CRM channel ROI.

The brief must include:
1. A one-paragraph direct answer naming the best return-on-spend channel and the headline attributed revenue figure.
2. A compact KPI table per channel: sends, open rate, click rate, converted, total cost, attributed revenue, cost per attributed booking, and return on spend.
3. At least two charts when supported by the data:
   - return on spend or attributed revenue by channel;
   - conversion rate by channel and campaign type.
4. A channel section separating high-return channels to scale from wasteful spend to cut, judged on return on spend rather than raw conversion.
5. A reallocation section: where to shift CRM budget, which campaign types to expand, and which lifecycle segments respond best to each channel.
6. A short SQL provenance note naming the sources: comms_full and bookings_full, and stating that revenue is attributed via a {{attribution_days}}-day post-click booking window.

Use raw rupee values. Note that attribution is post-click window based, not last-touch deterministic, so frame revenue as attributed rather than exact.`,
      },
    ],
    runHistory: [],
    changelog: [
      {
        date: now,
        summary: "Seeded CRM channel ROI analysis for Healthians.",
        changes: [
          {
            type: "add",
            cellLabel: "Channel revenue & ROI",
            cellId: "c3_channel_revenue",
            detail: "Attributes booking revenue per channel via a post-click window join and computes return on spend.",
          },
        ],
      },
    ],
  };
}

export function seedHealthiansPlaybooks(userId: string): number {
  const playbooks = [
    buildHealthiansAbnormalFollowupPlaybook(userId),
    buildHealthiansRepeatEnginePlaybook(userId),
    buildHealthiansCrmRoiPlaybook(userId),
  ];
  let count = 0;
  for (const playbook of playbooks) {
    if (getPlaybook(userId, playbook.id)) continue;
    upsertPlaybook(userId, playbook);
    count++;
  }
  return count;
}

export async function seedHealthiansSampleWorkspace(userId: string): Promise<{
  segments: number;
  funnels: number;
  retentions: number;
  playbooks: number;
  voiceCampaigns: number;
}> {
  const playbookCount = seedHealthiansPlaybooks(userId);
  // Voice campaigns are created manually per workspace; not seeded.
  const voiceCampaignCount = 0;

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
        datasetId: HEALTHIANS_DATASET_ID,
      });
      segmentCount++;
    } catch (err) {
      console.warn(`[healthians-seed] segment ${segment.slug} failed:`, err);
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
        datasetId: HEALTHIANS_DATASET_ID,
      });
      funnelCount++;
    } catch (err) {
      console.warn(`[healthians-seed] funnel ${funnel.slug} failed:`, err);
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
        datasetId: HEALTHIANS_DATASET_ID,
      });
      retentionCount++;
    } catch (err) {
      console.warn(`[healthians-seed] retention ${retention.slug} failed:`, err);
    }
  }

  return {
    segments: segmentCount,
    funnels: funnelCount,
    retentions: retentionCount,
    playbooks: playbookCount,
    voiceCampaigns: voiceCampaignCount,
  };
}
