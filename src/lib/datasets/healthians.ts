import { EXPANDED_HEALTHIANS_EVENTS, getHealthiansViewSQL } from "./healthians-events";
import type { DatasetConfig } from "./types";

// ══════════════════════════════════════════════════════════════
// DATASET CONFIG
// ══════════════════════════════════════════════════════════════

export const healthiansDataset: DatasetConfig = {
  id: "healthians",
  label: "Diagnostics",
  companyName: "Healthians",
  dbFile: "data/healthians.duckdb",
  sourceType: "csv",
  setupVersion: "healthians-events-v2",

  primaryTable: "bookings_full",
  userIdField: "customer_id",
  dateField: "booking_date",
  dateRange: { start: "2024-04-01", end: "2026-05-26" },
  currency: "₹",
  entityName: "customers",

  reportMeta: {
    totalEvents: "230K bookings · 2.4M report results · 5.1M events",
    totalUsers: "35K customers",
    dateRangeLabel: "Apr 2024 – May 2026",
    dbName: "healthians.duckdb",
  },

  events: EXPANDED_HEALTHIANS_EVENTS,
  viewSQL: getHealthiansViewSQL,

  suggestedPrompts: [
    "What is our booking completion rate and on-time delivery rate by city tier?",
    "Show the repeat booking rate by customer archetype — which segment is stickiest?",
    "What % of customers view their report, and how does that vary by health score?",
    "Which CRM channel (push vs WhatsApp vs email) drives the most re-bookings?",
    "Show the tax season booking spike — how does Jan–Mar compare to rest of year?",
    "What is the TAT breach rate and how does it correlate with support tickets?",
    "Show Vitamin D deficiency rate across city tiers and age groups",
    "Which test category drives the most counseling uptake?",
  ],

  welcomeSubtitle: "Ask about bookings, operations, report engagement, CRM effectiveness, and clinical insights across your network.",

  // ═══════════════════════════════════════════════════════════
  // DOMAIN HINTS (injected into every SQL generation prompt)
  // ═══════════════════════════════════════════════════════════

  domainHints: `
6. USE bookings_full for booking analysis — pre-joined with customer + test fields. Has: city_tier, archetype, acquisition_channel, chronic_condition, test_slug, test_category, on_time, delay_min, no_show, tat_hours, counseling_taken, follow_up_booked, total_paid_inr.
7. USE reports_full for health outcome analysis — pre-joined with customer + booking context. Has: health_score (0-100), health_score_category (critical/borderline/normal), abnormal_params_count, critical_params_count, report_viewed, time_to_view_hours.
8. USE comms_full for CRM analysis — pre-joined with customer context. Has: channel (push/sms/whatsapp/email/in_app), campaign_type, delivered, opened, clicked, converted, send_cost_inr, user_segment_at_send.
9. USE support_full for complaint analysis. Categories: delayed_report, wrong_result, incomplete_report, phlebotomist_no_show, phlebotomist_late, sample_rejected, billing_dispute, location_not_serviceable, refund_pending.
10. USE user_events_full for clickstream and true sequential funnels — event_timestamp, event_type, platform, channel, test_slug, campaign_type, payment_method, amount_bucket, fee_bucket.
11. USE sample_tracking_full, report_results_full, counseling_full, future_tests_full, subscriptions_full, subscription_runs_full, nps_full, and leads_full when users ask for deeper lifecycle, clinical, subscription, NPS, or lead analysis.
12. CUSTOMER ARCHETYPES: chronic_subscriber (11%, 8 bookings/yr), annual_checker (28%, 1.2/yr), reactive_booker (21%, seasonal), health_anxious (8%, 5/yr, highest counseling), doctor_referred (12%), one_and_done (20%, 1/yr).
13. CITY TIERS: metro (9 cities: Bengaluru, Chennai, Delhi, Gurgaon, Hyderabad, Kolkata, Mumbai, Noida, Pune), tier1 (15 cities), tier2 (14 cities). Metro has 87% on-time vs tier2 72%.
14. PRICING: advertised_price_inr = package price shown. consumables_transport_fee_inr = ₹98 (revealed at checkout). total_paid_inr = actual charge. Avg ₹765 paid vs ₹667 advertised.
15. TAX SEASON: Jan–Mar shows 1.7x booking uplift (Section 80D deduction for preventive health tests). Use EXTRACT(month FROM booking_date) IN (1,2,3).
16. DENGUE SEASON: Jul–Sep shows fever/CBC/dengue bookings spike 2x. Use EXTRACT(month FROM booking_date) IN (7,8,9).
17. OPERATIONAL FAILURE RATES: metro no_show 2.3%, tier2 9.5%. Sample rejection: metro 1.8%, tier2 3.4%. TAT breach: metro 7%, tier2 22%.
18. HEALTH SCORE: 0-100. <50 = critical (15+ points deducted per critical parameter). 50-70 = borderline. 70+ = normal. Use health_score_category for easy filtering.
19. COUNSELING: 18% of bookings → counseling_taken=true. Customers who take counseling rebook at 3.4x rate. Query counseling_conversion_rate from funnel_metrics.
20. VITAMIN D: 73% of customers are deficient. Check vitamin_d_status in raw_customers. Clinical breakdown by city in clinical_summary table.
21. REPORT FUTURE TESTS: future_tests_full has personalised retest recommendations (booked_within_window shows if patient actually rebooked).
22. SUMMARY TABLES TO PREFER:
    - daily_company_kpis: date, bookings, gmv, revenue, on_time_pct, avg_tat_hours
    - city_monthly_kpis: city, city_tier, month, bookings, gmv, on_time_pct, rejection_rate
    - retention_cohorts: cohort_month, activity_month, months_since_signup, active_customers
    - campaign_performance: campaign_type, channel, month, open_rate, conv_rate, total_cost_inr
    - clinical_summary: city_tier, parameter_name, abnormal_pct, avg_value
    - phlebotomist_performance: phlebotomist_id, month, on_time_pct, avg_rating
    - test_popularity: test_slug, month, booking_count, total_revenue
    - funnel_metrics: booking_channel, month, report_view_rate, counseling_conversion_rate
    Use raw views (bookings_full, reports_full, comms_full, user_events_full) for custom cohort and cross-dimensional analysis.
`,

  summaryTableHint: `Use summary tables when they can answer the question:
- OPERATIONS: daily_company_kpis (daily bookings/revenue/on-time), city_monthly_kpis (per-city monthly metrics)
- TEST PERFORMANCE: test_popularity (most booked tests by month)
- FUNNEL: funnel_metrics (booking → collection → report view → counseling conversion by channel/month)
- RETENTION: retention_cohorts (signup cohort → active bookings by months since signup)
- PHLEBOTOMIST: phlebotomist_performance (monthly on-time%, rating, rejection count per phleb)
- CRM: campaign_performance (open/click/conversion rates by campaign type, channel, month)
- CLINICAL: clinical_summary (abnormal rates by city tier and parameter)

Use raw views for custom analysis:
- bookings_full: per-booking analysis, price breakdown, channel comparison, seasonal patterns
- reports_full: health score trends, abnormal finding analysis, engagement patterns
- comms_full: CRM cost/ROI, send timing analysis, segment-level campaign performance
- support_full: ticket category analysis, resolution time, NPS impact
- user_events_full: clickstream and sequential lifecycle funnels with true event timestamps
- sample_tracking_full: collection, lab transit, QC, TAT, and temperature-breach analysis
- report_results_full: per-parameter clinical analysis with customer and booking cuts
- future_tests_full, subscriptions_full, subscription_runs_full, nps_full, leads_full: follow-up, subscription, NPS, and lead analysis`,

  // ═══════════════════════════════════════════════════════════
  // SCHEMA CONTEXT (full schema for LLM text-to-SQL)
  // ═══════════════════════════════════════════════════════════

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

PLATFORM: Healthians — India's largest at-home diagnostics platform
DATE RANGE: 2024-04-01 to 2026-05-26 (26 months)
CURRENCY: INR (₹). All amounts in raw rupees.
PRIMARY ENTITY: customer_id
ACTIVITY TABLE: bookings_full (booking_date is the primary time axis)

═══ DENORMALIZED VIEWS (USE THESE FOR QUERIES) ═══

VIEW: bookings_full (~231K rows)
  Pre-joined: raw_bookings + raw_customers + raw_booking_items (first item)
  -- Booking core
  - booking_id          VARCHAR
  - customer_id         VARCHAR
  - booking_date        DATE        -- when the customer placed the order
  - slot_date           DATE        -- when phlebotomist visits
  - slot_band           VARCHAR     -- 6-8am / 8-10am / 10am-12pm / 12-2pm / 2-4pm / 4-6pm
  - city                VARCHAR
  - city_tier           VARCHAR     -- metro / tier1 / tier2
  - hub_id              INTEGER
  - primary_test_category VARCHAR   -- full_body / diabetes / thyroid / cardiac / fever / kids / senior / etc.
  -- Pricing
  - advertised_price_inr  DOUBLE    -- price shown on package page
  - consumables_transport_fee_inr DOUBLE  -- ₹98 hidden fee (revealed at checkout)
  - coupon_discount_inr   DOUBLE
  - total_paid_inr        DOUBLE    -- actual amount charged
  - payment_method        VARCHAR   -- phonePe_upi / upi_wallet_netbanking / mobikwik / cash_on_collection / card
  - booking_channel       VARCHAR   -- app_android / app_ios / web_self_serve / web_callback / phone_inbound / whatsapp
  -- Patient
  - patient_age           INTEGER   -- may differ from customer age (family bookings)
  - patient_gender        VARCHAR
  - patient_relationship  VARCHAR   -- self / child / spouse / parent / sibling
  -- Operational outcomes
  - on_time               BOOLEAN   -- phlebotomist arrived within 60 min of slot
  - delay_min             INTEGER   -- minutes late (0 if on_time)
  - no_show               BOOLEAN   -- phlebotomist never showed up
  - sample_rejected       BOOLEAN   -- sample failed lab QC
  - tat_hours             DOUBLE    -- booking → report delivery TAT
  - tat_breach            BOOLEAN   -- TAT exceeded SLA (>24h metro, >48h tier2)
  -- Engagement outcomes
  - report_viewed         BOOLEAN
  - time_to_view_hours    DOUBLE
  - counseling_taken      BOOLEAN
  - follow_up_booked      BOOLEAN
  - billing_dispute       BOOLEAN   -- customer disputed charge
  -- Flags
  - is_first_booking      BOOLEAN
  - is_prescription_driven BOOLEAN
  - booking_status        VARCHAR   -- confirmed / completed / cancelled
  -- Customer context (from raw_customers join)
  - archetype             VARCHAR   -- chronic_subscriber / annual_checker / reactive_booker / health_anxious / doctor_referred / one_and_done
  - customer_age          INTEGER
  - age_group             VARCHAR   -- 18-24 / 25-34 / 35-44 / 45-54 / 55+
  - customer_gender       VARCHAR
  - state                 VARCHAR
  - acquisition_channel   VARCHAR   -- organic_search / google_ads / meta_ads / referral_friend / whatsapp_share / doctor_referral
  - chronic_condition     VARCHAR   -- none / diabetes / thyroid / hypertension / pcos / multiple
  - install_platform      VARCHAR   -- android / ios / web
  - subscription_active   BOOLEAN
  - customer_lifecycle_stage VARCHAR -- new / activated / engaged / loyal / at_risk / churned / reactivated
  - ltv_bucket            VARCHAR   -- low / medium / high / super
  - vitamin_d_status      VARCHAR   -- deficient / insufficient / sufficient / not_tested
  - thyroid_status        VARCHAR   -- hypothyroid / hyperthyroid / normal / not_tested
  - glucose_status        VARCHAR   -- diabetic / prediabetic / normal / not_tested
  -- Test context (from raw_booking_items join)
  - test_slug             VARCHAR   -- e.g. "thyroid-package-preventive", "healthians-diabetic-checkup"
  - test_name             VARCHAR
  - test_category         VARCHAR
  - parameters_count      INTEGER   -- number of individual lab values in this test
  - item_price_inr        DOUBLE

VIEW: reports_full (~201K rows)
  Pre-joined: raw_reports + raw_customers + raw_bookings (context)
  - report_id, booking_id, customer_id
  - report_date           DATE
  - health_score          INTEGER   -- 0-100 (100 = all normal, lower = more abnormals)
  - health_score_category VARCHAR   -- critical (<50) / borderline (50-70) / normal (70+)
  - critical_params_count INTEGER   -- parameters flagged as critical (life-threatening)
  - borderline_params_count INTEGER
  - abnormal_params_count INTEGER   -- total out-of-range parameters
  - report_viewed         BOOLEAN
  - time_to_view_hours    DOUBLE
  - report_view_platform  VARCHAR   -- app_android / app_ios / web / null
  - health_karma_viewed   BOOLEAN
  -- Customer context
  - archetype, customer_age, customer_gender, city, city_tier, state, chronic_condition
  -- Booking context
  - slot_band, booking_channel, primary_test_category, tat_hours, tat_breach, on_time

VIEW: comms_full (~788K rows)
  Pre-joined: raw_comms_log + customer context
  - send_id, customer_id, booking_id
  - channel               VARCHAR   -- push / sms / whatsapp / email / in_app
  - campaign_type         VARCHAR   -- annual_checkup_reminder / thyroid_retest / hba1c_retest /
                                    --   dengue_season_alert / tax_deduction_nudge / post_diwali_sugar /
                                    --   reactivation / report_delivery / welcome_series
  - sent_at               TIMESTAMP
  - delivered             BOOLEAN
  - opened                BOOLEAN
  - clicked               BOOLEAN
  - converted             BOOLEAN   -- customer booked within 7 days of click
  - send_cost_inr         DOUBLE    -- per-message cost (WhatsApp > push > SMS > email)
  - user_segment_at_send  VARCHAR   -- new / active / at_risk / churned
  - days_since_last_booking INTEGER
  -- Customer context
  - city, city_tier, archetype, acquisition_channel, is_active

VIEW: support_full (~21K rows)
  Pre-joined: raw_support + customer context
  - ticket_id, customer_id, booking_id
  - opened_at, resolved_at, resolution_days
  - channel               VARCHAR   -- app_chat / phone / email / whatsapp
  - category              VARCHAR   -- delayed_report / wrong_result / incomplete_report /
                                    --   phlebotomist_no_show / phlebotomist_late /
                                    --   sample_rejected / billing_dispute / location_not_serviceable
  - root_cause            VARCHAR   -- phlebotomist / lab_processing / transit / billing_system / capacity
  - escalated             BOOLEAN
  - resolution            VARCHAR   -- resolved / refund_given / rebooked / no_resolution
  - nps_after_resolution  INTEGER   -- 0-10
  -- Customer context
  - city, city_tier, archetype, chronic_condition, is_active

VIEW: phlebotomist_full (~222K rows)
  Pre-joined: raw_assignments + raw_phlebotomists
  - assignment_id, booking_id, customer_id, phlebotomist_id
  - assigned_at, arrived_at, on_time, delay_min, no_show, collection_duration_min
  - communication_issue   BOOLEAN
  - customer_request_repeated BOOLEAN  -- customer specifically requested this phlebotomist again
  - phleb_city, phleb_tier, experience_months, certification_level, avg_rating

VIEW: user_events_full (~5.1M rows)
  Clickstream and lifecycle events with JSON properties extracted into columns.
  Use this for true ordered funnels because event_timestamp is the actual event time.
  - event_id, customer_id, session_id, booking_id
  - event_timestamp      TIMESTAMP
  - event_type           VARCHAR   -- web_visit / app_opened / test_page_viewed / notification_sent / booking_confirmed / report_viewed / etc.
  - platform             VARCHAR   -- android / ios / web / push / sms / whatsapp / email
  - channel              VARCHAR   -- app_android / app_ios / web_self_serve / web_callback / push / whatsapp / etc.
  - test_slug, event_category, campaign_type, source, payment_method
  - amount_inr, fee_inr, amount_bucket, fee_bucket, slot_band, on_time
  - customer context: city, city_tier, state, archetype, age_group, customer_gender, acquisition_channel, chronic_condition, customer_lifecycle_stage, ltv_bucket

VIEW: report_results_full (~2.4M rows)
  Biomarker-level clinical rows joined to report, booking, and customer context.
  - result_id, booking_id, customer_id, report_id, report_date
  - test_slug, parameter_name, parameter_value, unit, status
  - is_critical, is_borderline, is_abnormal
  - health_score_category, city_tier, archetype, age_group, chronic_condition

VIEW: sample_tracking_full (~210K rows)
  Sample collection, lab transit, QC, and report-generation lifecycle.
  - sample_id, booking_id, customer_id, phlebotomist_id, lab_id
  - collection_timestamp, dispatch_timestamp, lab_received_timestamp, processing_started_at, report_generated_at
  - transit_route, transit_hours, qc_status, rejection_reason, tat_hours, tat_sla_met, temperature_breach

VIEW: counseling_full (~75K rows), future_tests_full (~294K rows)
  Counseling sessions and follow-up recommendations with customer/report context.

VIEW: subscriptions_full (~4K rows), subscription_runs_full (~10K rows)
  Chronic-test subscription setup and scheduled run adherence.

VIEW: nps_full (~69K rows), leads_full (~8K rows)
  NPS surveys and lead/callback outcomes with customer and booking context.

VIEW: customers_full (~35K rows)
  raw_customers with gender re-aliased as customer_gender. All profile,
  health-status, lifecycle, and opt-in columns. Use for signup/acquisition
  analysis keyed on signup_date.

VIEW: lifestyle_profiles_full (~35K rows)
  Lifestyle questionnaire (height_cm, weight_kg, bmi, physical_activity_freq,
  food_preference, blood_pressure_*, fasting_blood_sugar, current_medications)
  joined to customer context. questionnaire_date is the time axis.

VIEW: booking_items_full (~242K rows)
  Per-test line items (test_slug, test_name, test_category, parameters_count,
  item_price_inr, item_type: primary / addon_pathology) joined to booking and
  customer context. Use item_type='addon_pathology' for add-on demand.

VIEW: phlebotomist_ratings_full (~138K rows)
  Per-booking phlebotomist ratings (rating 1-5, review_text_sentiment) joined to
  phlebotomist, booking, and customer context. submitted_at is the time axis.

═══ RAW TABLES (for custom/deep analysis) ═══

TABLE: raw_customers (~35K rows)
  Core customer profiles with all 57 columns including:
  - signup_date, archetype, age, gender, city, state, city_tier
  - acquisition_channel, chronic_condition, health_goal, bmi_category
  - total_bookings, total_spend_inr, avg_order_value_inr
  - customer_lifecycle_stage, ltv_bucket, subscription_active
  - vitamin_d_status, thyroid_status, glucose_status, hemoglobin_status

TABLE: raw_report_results (~2.4M rows)
  Individual biomarker measurements — most granular clinical data:
  - result_id, booking_id, customer_id, report_id
  - parameter_name    VARCHAR   -- e.g. "Haemoglobin", "TSH Ultra-Sensitive", "HbA1c", "Vitamin D"
  - parameter_value   VARCHAR   -- numeric value as string
  - unit              VARCHAR   -- g/dL, uIU/mL, %, ng/mL, etc.
  - reference_low, reference_high  DOUBLE
  - status            VARCHAR   -- normal / low / high / critical
  - is_critical       BOOLEAN
  - is_borderline     BOOLEAN
  - is_abnormal       BOOLEAN

TABLE: raw_counseling (~75K rows)
  Post-report counseling sessions:
  - session_id, booking_id, customer_id, report_id
  - counselor_type    VARCHAR   -- ai / human_advisor
  - session_date      DATE
  - days_after_report INTEGER
  - duration_min      INTEGER
  - satisfaction_score INTEGER  -- 1-5
  - outcome           VARCHAR   -- prescription_given / lifestyle_advice / follow_up_tests / normal_dismissed
  - follow_up_recommended BOOLEAN
  - follow_up_test_id VARCHAR

TABLE: raw_future_tests (~294K rows)
  Personalised retest recommendations from Smart Report:
  - recommendation_id, booking_id, customer_id, report_id
  - test_name, test_slug
  - recommended_frequency VARCHAR  -- every_1_month / every_3_months / every_6_months / annually
  - recommended_by        VARCHAR  -- report_advisory / counselor
  - booked_within_window  BOOLEAN  -- did the customer actually rebook?
  - followup_booking_id   VARCHAR

TABLE: raw_subscriptions (~4K rows) + raw_subscription_runs (~10K rows)
  Chronic test subscriptions (11% of customers):
  - subscription_id, customer_id, test_slug, test_name
  - frequency_days    INTEGER   -- 90 (quarterly) / 180 (semi-annual) / 365 (annual)
  - status            VARCHAR   -- active / paused / cancelled
  - adherence_rate_pct DOUBLE

TABLE: raw_nps (~69K rows) — Post-booking NPS surveys
  - response_id, booking_id, customer_id
  - score             INTEGER   -- 0-10
  - nps_category      VARCHAR   -- promoter (9-10) / passive (7-8) / detractor (0-6)
  - days_after_booking INTEGER

TABLE: raw_support (~21K rows) — Customer support tickets (see support_full for pre-joined version)

═══ SUMMARY TABLES (prefer for aggregated queries) ═══

TABLE: daily_company_kpis (786 rows) — date, bookings, gmv, revenue, new_customers, completions, on_time_pct, avg_tat_hours
TABLE: city_monthly_kpis (1092 rows) — city, city_tier, month, bookings, gmv, on_time_pct, avg_tat, rejection_rate
TABLE: test_popularity (318 rows) — test_slug, test_name, test_category, month, booking_count, total_revenue
TABLE: funnel_metrics (156 rows) — booking_channel, month, total_bookings, collections, accepted_samples, reports_viewed, counseling_taken, follow_ups_booked, report_view_rate, counseling_conversion_rate
TABLE: retention_cohorts (676 rows) — cohort_month, activity_month, months_since_signup, active_customers, bookings
TABLE: phlebotomist_performance (14040 rows) — phlebotomist_id, city, city_tier, certification_level, month, collections, on_time_pct, avg_rating, rejection_count
TABLE: campaign_performance (221 rows) — campaign_type, channel, month, sends, delivered, opened, clicked, converted, open_rate, click_rate, conv_rate, total_cost_inr
TABLE: clinical_summary (237 rows) — city_tier, test_slug, parameter_name, total_results, abnormal_pct, critical_pct, avg_value, median_value
`,

  // ═══════════════════════════════════════════════════════════
  // SYSTEM CONTEXT (AI persona for this dataset)
  // ═══════════════════════════════════════════════════════════

  systemContext: `You are Actioneer, an AI-powered analytics assistant for Healthians — India's largest at-home diagnostics platform.

Dataset: ~35K customers, ~231K bookings, ~201K health reports, ~788K CRM messages
Date range: Apr 2024 – May 2026 (26 months)
Revenue model: test package fees (avg ₹765/booking), ₹98 consumables fee on every booking
Phlebotomist fleet: ~540 phlebotomists across 38 cities in 3 tiers

Key analytics domains:
1. CUSTOMER LIFECYCLE — Archetype distribution, acquisition channel LTV, lifecycle stage transitions, churn prediction
2. OPERATIONAL EXCELLENCE — On-time delivery, TAT by city tier, sample quality, phlebotomist performance, no-show root causes
3. CLINICAL INSIGHTS — Population health by parameter, abnormal rates by demographics, Vitamin D/HbA1c/thyroid trends
4. REPORT ENGAGEMENT — Health score distribution, report view rates, counseling uptake, follow-up conversion
5. CRM EFFECTIVENESS — Channel open rates (WhatsApp 94% vs email 24%), campaign ROI, reactivation success, send cost per booking
6. REVENUE & PRICING — Booking value by test/channel/tier, hidden fee impact on billing disputes, seasonal uplift

Key planted patterns in the data:
- Jan–Mar tax season: +70% full-body checkup bookings (Section 80D deduction)
- Jul–Sep dengue season: +2x fever/CBC/dengue test bookings
- Tier2 TAT breach rate: 22% vs metro 7% (overnight routing to hub lab)
- Vitamin D deficiency: 73% of tested customers
- Chronic subscribers (11% of base) generate 38% of revenue
- Counseling → 3.4x repeat booking rate

Response guidelines:
- Use markdown: headers, tables, bold for key numbers
- Cite specific numbers from query results
- Be operational and actionable — what should the business do?
- Note seasonal patterns where relevant
- End with 1-2 suggested follow-up questions
- Currency is INR — use ₹ symbol
- Never use emojis`,

  // ═══════════════════════════════════════════════════════════
  // AGENT SPECS (for deep research / multi-agent mode)
  // ═══════════════════════════════════════════════════════════

  queryDescriptions: {
    "data-quality": [
      "NULL rate check on key outcome fields: report_viewed, counseling_taken, on_time, tat_hours",
      "Booking volume by month — detect data gaps or drops",
      "No-show and sample rejection rates by city tier",
    ],
    "daily-metrics": [
      "Daily and monthly booking volume and revenue from daily_company_kpis",
      "On-time delivery rate trend and average delay_min over time",
      "TAT breach rate trend — are reports getting faster or slower?",
    ],
    "cohort-retention": [
      "Monthly retention cohorts from retention_cohorts table",
      "Repeat booking rate by customer archetype — chronic vs one_and_done",
      "Average days between first and second booking by acquisition channel",
    ],
    "rev-opt": [
      "Revenue by test category and booking channel from test_popularity",
      "Coupon discount impact: avg total_paid_inr with vs without coupon",
      "Billing dispute rate by package price tier — hidden fee impact",
    ],
    "user-segmentation": [
      "Customer archetype distribution and avg bookings/revenue per archetype",
      "Chronic condition prevalence by city tier and age group",
      "Lifecycle stage distribution — how many customers are at-risk or churned?",
    ],
    "geographic": [
      "City-tier operational performance from city_monthly_kpis",
      "State-wise booking concentration and average order value",
      "Phlebotomist on-time rates by city from phlebotomist_performance",
    ],
    "crm-analytics": [
      "Campaign performance by type and channel from campaign_performance",
      "CRM cost efficiency: cost per converted booking by channel",
      "Reactivation campaign success rate for churned customers",
    ],
  },

  multiAgentPrompt: `data-quality|1|NULL rates on report_viewed, counseling_taken, on_time, tat_hours
data-quality|2|Monthly booking volume trend — detect gaps
data-quality|3|No-show and sample rejection rates by city tier

daily-metrics|1|Daily booking volume and revenue from daily_company_kpis
daily-metrics|2|On-time delivery and TAT trends over 26 months
daily-metrics|3|TAT breach rate by city tier

cohort-retention|1|Monthly retention cohort matrix from retention_cohorts
cohort-retention|2|Repeat booking rate by customer archetype
cohort-retention|3|Days between first and second booking by acquisition channel

rev-opt|1|Revenue by test category and city tier from test_popularity
rev-opt|2|Coupon discount and total_paid_inr distribution
rev-opt|3|Billing dispute rate by advertised price tier

user-segmentation|1|Customer archetype distribution and bookings per archetype
user-segmentation|2|Chronic condition prevalence by city tier
user-segmentation|3|Lifecycle stage breakdown — at-risk and churned count

geographic|1|City-tier bookings and on-time pct from city_monthly_kpis
geographic|2|Top and bottom 5 states by revenue and on-time rate
geographic|3|Phlebotomist utilisation and ratings by city tier

crm-analytics|1|Campaign performance by type and channel from campaign_performance
crm-analytics|2|CRM send cost vs conversion by channel
crm-analytics|3|Reactivation campaign conversion for churned customers`,

  // Recreate event-ready views at startup so older self-contained DB files pick
  // up expanded segment/funnel/explorer columns without requiring a full rebuild.
};
