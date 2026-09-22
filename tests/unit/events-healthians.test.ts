/**
 * Healthians event-catalog ground-truth validation.
 *
 * The Explorer/Funnels/Retentions UI builds SQL directly from
 * EXPANDED_HEALTHIANS_EVENTS (EventDefinition[]). If an event points at a table
 * that is not produced, a filter/value/date column that does not exist, or a
 * property column that is not in the produced schema, the live Explorer query
 * errors. These tests assert every event resolves to REAL produced columns.
 *
 * The column maps below are hardcoded from the actual produced schema:
 *   - raw_* table columns come from the writeCsv(...) headers in
 *     scripts/generate-healthians.ts
 *   - denormalized view columns come from the SELECT lists in
 *     getHealthiansViewSQL() (src/lib/datasets/healthians-events.ts), which is
 *     exactly what scripts/setup-healthians.ts executes.
 *
 * The user_events event_type set is the full distinct set emitted by the
 * generator's addEvent({ event_type: ... }) calls.
 *
 * No DB connection is opened — pure config/schema consistency.
 */

import { describe, it, expect } from "vitest";
import { EXPANDED_HEALTHIANS_EVENTS } from "@/lib/datasets/healthians-events";

// ─────────────────────────────────────────────────────────────────────────────
// GROUND TRUTH: raw table columns (writeCsv headers in generate-healthians.ts)
// ─────────────────────────────────────────────────────────────────────────────

const RAW = {
  customers: [
    "customer_id", "signup_date", "archetype", "age", "age_group", "gender",
    "city", "state", "city_tier", "hub_id", "acquisition_channel", "install_platform",
    "device_model_tier", "first_landing_test_category", "days_to_first_booking",
    "referrer_customer_id", "coupon_used_at_signup", "health_goal", "primary_health_concern",
    "chronic_condition", "family_history", "smoking_status", "alcohol_consumption",
    "exercise_frequency", "bmi_category", "on_regular_medication", "last_doctor_visit_timeframe",
    "insurance_provider", "insurance_linked_to_healthians", "family_members_added",
    "books_primarily_for", "total_bookings", "total_spend_inr", "avg_order_value_inr",
    "first_booking_date", "last_booking_date", "days_since_last_booking",
    "most_booked_category", "preferred_slot_band", "preferred_payment_method",
    "cancellation_rate_pct", "report_view_rate_pct", "counseling_uptake_pct",
    "subscription_active", "vitamin_d_status", "vitamin_b12_status", "thyroid_status",
    "glucose_status", "cholesterol_status", "hemoglobin_status", "lifetime_abnormal_flags_count",
    "customer_lifecycle_stage", "ltv_bucket", "nps_category", "push_opt_in", "whatsapp_opt_in", "is_active",
  ],
  bookings: [
    "booking_id", "customer_id", "booking_date", "booking_time", "slot_date", "slot_band",
    "city", "pincode", "hub_id", "address_id", "primary_test_category", "tests_count",
    "advertised_price_inr", "consumables_transport_fee_inr", "hard_copy_fee_inr",
    "diet_consultation_fee_inr", "coupon_discount_inr", "cashback_earned_inr", "total_paid_inr",
    "payment_method", "booking_channel", "patient_age", "patient_gender", "patient_relationship",
    "patient_is_minor", "persons_in_booking", "is_family_bundle", "is_first_booking",
    "is_prescription_driven", "is_subscription_run", "subscription_id", "on_time", "delay_min",
    "no_show", "sample_rejected", "rejection_reason", "tat_hours", "tat_breach",
    "report_viewed", "time_to_view_hours", "counseling_taken", "follow_up_booked",
    "billing_dispute", "cancellation_reason", "booking_status", "city_tier",
  ],
  booking_items: [
    "item_id", "booking_id", "customer_id", "test_slug", "test_name", "test_category",
    "parameters_count", "item_price_inr", "item_type",
  ],
  assignments: [
    "assignment_id", "booking_id", "customer_id", "phlebotomist_id",
    "assigned_at", "arrived_at", "on_time", "delay_min", "no_show",
    "collection_duration_min", "tubes_collected", "communication_issue", "customer_request_repeated",
  ],
  sample_tracking: [
    "sample_id", "booking_id", "phlebotomist_id", "lab_id", "collection_timestamp",
    "dispatch_timestamp", "transit_route", "lab_received_timestamp", "transit_hours",
    "qc_status", "rejection_reason", "processing_started_at", "report_generated_at",
    "tat_hours", "tat_sla_met", "temperature_breach",
  ],
  reports: [
    "report_id", "booking_id", "customer_id", "report_date", "health_score", "health_score_category",
    "critical_params_count", "borderline_params_count", "abnormal_params_count", "keep_watching_params",
    "report_released_at", "notification_sent_at", "notification_channels",
    "report_viewed", "time_to_view_hours", "report_view_platform", "health_karma_viewed",
  ],
  report_results: [
    "result_id", "booking_id", "customer_id", "report_id", "test_slug",
    "parameter_name", "parameter_value", "unit", "reference_low", "reference_high",
    "status", "is_critical", "is_borderline", "is_abnormal",
  ],
  counseling: [
    "session_id", "booking_id", "customer_id", "report_id", "counselor_type",
    "session_date", "days_after_report", "duration_min", "satisfaction_score",
    "tests_discussed", "follow_up_recommended", "follow_up_test_id", "outcome",
  ],
  future_tests: [
    "recommendation_id", "booking_id", "customer_id", "report_id", "test_name", "test_slug",
    "recommended_frequency", "recommended_by", "created_at", "booked_within_window", "followup_booking_id",
  ],
  subscriptions: [
    "subscription_id", "customer_id", "test_slug", "test_name", "frequency_days",
    "start_date", "status", "total_runs_completed", "next_due_date", "adherence_rate_pct",
  ],
  subscription_runs: [
    "run_id", "subscription_id", "customer_id", "booking_id", "run_number",
    "scheduled_date", "actual_date", "status", "days_late",
  ],
  comms_log: [
    "send_id", "customer_id", "booking_id", "channel", "campaign_type", "sent_at",
    "delivered", "opened", "clicked", "converted", "conversion_booking_id",
    "send_cost_inr", "user_segment_at_send", "days_since_last_booking",
  ],
  nps: [
    "response_id", "booking_id", "customer_id", "score", "nps_category",
    "feedback_text", "submitted_at", "days_after_booking",
  ],
  phleb_ratings: [
    "rating_id", "booking_id", "customer_id", "phlebotomist_id",
    "rating", "review_text_sentiment", "submitted_at",
  ],
  support: [
    "ticket_id", "customer_id", "booking_id", "opened_at", "resolved_at", "resolution_days",
    "channel", "category", "city", "city_tier", "root_cause", "escalated", "resolution", "nps_after_resolution",
  ],
  leads: [
    "lead_id", "customer_id", "lead_type", "mobile_hash", "name", "city",
    "test_context_slug", "source_type", "submitted_at", "consent_given", "outcome",
  ],
  lifestyle_profiles: [
    "customer_id", "height_cm", "weight_kg", "bmi", "bmi_category", "physical_activity_freq",
    "smoking_status", "food_preference", "blood_pressure_systolic", "blood_pressure_diastolic",
    "current_medications", "alcohol_consumption", "family_history", "fasting_blood_sugar",
    "postprandial_blood_sugar", "questionnaire_date",
  ],
  phlebotomists: [
    "phlebotomist_id", "city", "city_tier", "hub_id", "experience_months",
    "certification_level", "avg_rating", "is_active", "joined_date",
  ],
};

// Customer context columns added by most _full views (subset of raw_customers,
// always re-aliased with `gender AS customer_gender`).
const CUST_CTX = [
  "city", "city_tier", "state", "archetype", "age_group", "customer_gender",
  "acquisition_channel", "chronic_condition", "customer_lifecycle_stage", "ltv_bucket",
];

// ─────────────────────────────────────────────────────────────────────────────
// GROUND TRUTH: produced view column maps (getHealthiansViewSQL SELECT lists)
// ─────────────────────────────────────────────────────────────────────────────

const COLS: Record<string, string[]> = {
  // customers_full = SELECT c.*, c.gender AS customer_gender
  customers_full: [...RAW.customers, "customer_gender"],

  // bookings_full = explicit booking cols + buckets + customer ctx + booking_items (primary)
  bookings_full: [
    "booking_id", "customer_id", "booking_date", "booking_time", "slot_date", "slot_band",
    "city", "city_tier", "hub_id", "address_id", "primary_test_category",
    "tests_count", "advertised_price_inr", "consumables_transport_fee_inr",
    "hard_copy_fee_inr", "diet_consultation_fee_inr", "coupon_discount_inr",
    "cashback_earned_inr", "total_paid_inr", "payment_method", "booking_channel",
    "patient_age", "patient_gender", "patient_relationship", "patient_is_minor",
    "persons_in_booking", "is_family_bundle", "is_first_booking", "is_prescription_driven",
    "is_subscription_run", "subscription_id", "on_time", "delay_min", "no_show",
    "sample_rejected", "rejection_reason", "tat_hours", "tat_breach", "report_viewed",
    "time_to_view_hours", "counseling_taken", "follow_up_booked", "billing_dispute",
    "cancellation_reason", "booking_status",
    "price_bucket", "fee_bucket", "coupon_bucket", "delay_bucket", "tat_bucket",
    "archetype", "customer_age", "age_group", "customer_gender", "state",
    "acquisition_channel", "install_platform", "device_model_tier", "health_goal",
    "primary_health_concern", "chronic_condition", "family_history", "smoking_status",
    "alcohol_consumption", "exercise_frequency", "bmi_category", "on_regular_medication",
    "last_doctor_visit_timeframe", "insurance_provider", "insurance_linked_to_healthians",
    "family_members_added", "books_primarily_for", "total_bookings", "most_booked_category",
    "preferred_slot_band", "preferred_payment_method", "subscription_active",
    "vitamin_d_status", "vitamin_b12_status", "thyroid_status", "glucose_status",
    "cholesterol_status", "hemoglobin_status", "lifetime_abnormal_flags_count",
    "customer_lifecycle_stage", "ltv_bucket", "nps_category", "push_opt_in",
    "whatsapp_opt_in", "is_active",
    "test_slug", "test_name", "test_category", "parameters_count", "item_price_inr", "item_type",
  ],

  // booking_items_full = bi.* + booking/customer ctx + item_price_bucket
  booking_items_full: [
    ...RAW.booking_items,
    "booking_date", "booking_channel", "city", "city_tier", "slot_band",
    "state", "archetype", "customer_lifecycle_stage", "ltv_bucket",
    "acquisition_channel", "age_group", "customer_gender", "chronic_condition",
    "item_price_bucket",
  ],

  // reports_full = explicit report cols + buckets + customer ctx + booking ctx + test ctx
  reports_full: [
    "report_id", "booking_id", "customer_id", "report_date", "health_score",
    "health_score_category", "critical_params_count", "borderline_params_count",
    "abnormal_params_count", "keep_watching_params", "report_released_at",
    "notification_sent_at", "notification_channels", "report_viewed",
    "time_to_view_hours", "report_view_platform", "health_karma_viewed",
    "critical_bucket", "abnormal_bucket",
    "archetype", "customer_age", "age_group", "customer_gender",
    "city", "city_tier", "state", "acquisition_channel", "chronic_condition",
    "customer_lifecycle_stage", "ltv_bucket", "vitamin_d_status", "vitamin_b12_status",
    "thyroid_status", "glucose_status", "cholesterol_status", "hemoglobin_status",
    "slot_band", "booking_channel", "primary_test_category", "tat_hours",
    "tat_breach", "on_time", "test_slug", "test_name", "test_category",
  ],

  // report_results_full = rr.* + report ctx + customer ctx + booking ctx
  report_results_full: [
    ...RAW.report_results,
    "report_date", "health_score_category", "report_viewed",
    "city", "city_tier", "state", "archetype", "age_group",
    "customer_gender", "acquisition_channel", "chronic_condition",
    "customer_lifecycle_stage", "ltv_bucket", "vitamin_d_status", "vitamin_b12_status",
    "thyroid_status", "glucose_status", "cholesterol_status", "hemoglobin_status",
    "booking_channel", "primary_test_category",
  ],

  // phlebotomist_full = explicit assignment cols + delay_bucket + NULL rating/sentiment +
  //   phleb cols + booking/customer ctx
  phlebotomist_full: [
    "assignment_id", "booking_id", "customer_id", "phlebotomist_id",
    "assigned_at", "arrived_at", "on_time", "delay_min", "no_show",
    "collection_duration_min", "tubes_collected", "communication_issue",
    "customer_request_repeated", "delay_bucket",
    "rating", "review_text_sentiment",
    "phleb_city", "phleb_tier", "hub_id", "experience_months", "certification_level", "avg_rating",
    "slot_date", "slot_band", "booking_channel", "primary_test_category",
    "city", "city_tier", "state", "archetype", "age_group",
    "customer_gender", "acquisition_channel", "chronic_condition",
    "customer_lifecycle_stage", "ltv_bucket",
  ],

  // phlebotomist_ratings_full = pr.* + phleb cols + booking/customer ctx + NULLs
  phlebotomist_ratings_full: [
    ...RAW.phleb_ratings,
    "phleb_city", "phleb_tier", "certification_level",
    "booking_channel", "primary_test_category", "slot_band", "city", "city_tier",
    "state", "archetype", "age_group", "customer_gender",
    "acquisition_channel", "chronic_condition", "customer_lifecycle_stage", "ltv_bucket",
    "communication_issue", "customer_request_repeated", "delay_bucket",
  ],

  // sample_tracking_full = st.* + booking ctx + test ctx + tat_bucket + customer ctx
  sample_tracking_full: [
    ...RAW.sample_tracking,
    "customer_id", "booking_date", "booking_channel", "primary_test_category",
    "slot_band", "city", "city_tier", "on_time", "no_show", "sample_rejected",
    "test_slug", "test_name", "test_category", "tat_bucket",
    "state", "archetype", "age_group", "customer_gender",
    "acquisition_channel", "chronic_condition", "customer_lifecycle_stage", "ltv_bucket",
  ],

  // comms_full = explicit comms cols + send_cost_bucket + customer ctx + is_active
  comms_full: [
    "send_id", "customer_id", "booking_id", "channel", "campaign_type",
    "sent_at", "delivered", "opened", "clicked", "converted",
    "conversion_booking_id", "send_cost_inr", "user_segment_at_send", "days_since_last_booking",
    "send_cost_bucket",
    ...CUST_CTX, "is_active",
  ],

  // counseling_full = cs.* + duration_bucket + customer ctx
  counseling_full: [
    ...RAW.counseling, "duration_bucket", ...CUST_CTX,
  ],

  // future_tests_full = ft.* + report ctx + customer ctx
  future_tests_full: [
    ...RAW.future_tests,
    "health_score_category", "abnormal_params_count", "critical_params_count",
    ...CUST_CTX,
  ],

  // subscriptions_full = s.* + frequency_bucket + adherence_bucket + customer ctx
  subscriptions_full: [
    ...RAW.subscriptions, "frequency_bucket", "adherence_bucket", ...CUST_CTX,
  ],

  // subscription_runs_full = explicit run cols (status AS run_status) + days_late_bucket +
  //   subscription_status + sub cols + customer ctx
  subscription_runs_full: [
    "run_id", "subscription_id", "customer_id", "booking_id", "run_number",
    "scheduled_date", "actual_date", "run_status", "days_late", "days_late_bucket",
    "subscription_status", "test_slug", "test_name", "frequency_days",
    ...CUST_CTX,
  ],

  // support_full = explicit support cols + buckets + customer ctx + is_active
  support_full: [
    "ticket_id", "customer_id", "booking_id", "opened_at", "resolved_at",
    "resolution_days", "channel", "category", "city", "city_tier",
    "root_cause", "escalated", "resolution", "nps_after_resolution",
    "resolution_bucket", "nps_after_resolution_bucket",
    "state", "archetype", "age_group", "customer_gender",
    "acquisition_channel", "chronic_condition", "customer_lifecycle_stage", "ltv_bucket", "is_active",
  ],

  // nps_full = n.* + score_bucket + booking ctx + customer ctx
  nps_full: [
    ...RAW.nps, "score_bucket",
    "booking_channel", "primary_test_category", "city", "city_tier",
    "state", "archetype", "age_group", "customer_gender",
    "acquisition_channel", "chronic_condition", "customer_lifecycle_stage", "ltv_bucket",
  ],

  // leads_full = l.* + city_tier + customer ctx (NOTE: l.* already has city)
  leads_full: [
    ...RAW.leads,
    "city_tier", "state", "archetype", "age_group", "customer_gender",
    "acquisition_channel", "chronic_condition", "customer_lifecycle_stage", "ltv_bucket",
  ],

  // lifestyle_profiles_full = lp.* + customer ctx
  lifestyle_profiles_full: [
    ...RAW.lifestyle_profiles, ...CUST_CTX,
  ],

  // user_events_full = derived JSON columns + customer ctx
  user_events_full: [
    "event_id", "customer_id", "session_id", "booking_id", "event_timestamp",
    "event_type", "platform", "channel", "test_slug", "event_category",
    "campaign_type", "source", "payment_method", "amount_inr", "fee_inr",
    "slot_band", "on_time", "amount_bucket", "fee_bucket",
    ...CUST_CTX,
  ],
};

const COL_SETS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(COLS).map(([t, cols]) => [t, new Set(cols)]),
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUND TRUTH: full distinct user_events event_type set emitted by generator
// (scripts/generate-healthians.ts addEvent({ event_type: ... }))
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_TYPES = new Set<string>([
  // booking journey (app + web)
  "app_opened", "test_page_viewed", "book_now_tapped", "otp_verified",
  "slot_selected", "payment_completed", "booking_confirmed",
  "web_visit", "book_now_clicked", "consumables_fee_revealed", "lead_form_submitted",
  // operational chain
  "phlebotomist_assigned", "phlebotomist_en_route", "phlebotomist_arrived",
  "sample_collected", "sample_received_at_lab", "report_generated",
  "report_notification_sent", "report_viewed", "health_score_viewed",
  "abnormal_flag_clicked", "counseling_started", "counseling_completed", "follow_up_booked",
  // CRM notification events
  "notification_sent", "notification_opened", "notification_clicked",
  // browse sessions
  "category_browsed",
]);

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract bare identifiers referenced in a filterSQL predicate. */
function columnsInSQL(sql: string): string[] {
  const noStrings = sql.replace(/'[^']*'/g, " ");
  const tokens = noStrings.match(/[a-z_][a-z0-9_]*/gi) ?? [];
  const KEYWORDS = new Set([
    "and", "or", "not", "in", "is", "null", "true", "false", "between",
    "like", "as", "case", "when", "then", "else", "end",
  ]);
  return tokens.filter((t) => !KEYWORDS.has(t.toLowerCase()));
}

const events = EXPANDED_HEALTHIANS_EVENTS;

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

describe("healthians events: catalog integrity", () => {
  it("has events", () => {
    expect(events.length).toBeGreaterThan(50);
  });

  it("event IDs are unique", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const e of events) {
      if (seen.has(e.id)) dups.push(e.id);
      seen.add(e.id);
    }
    expect(dups).toEqual([]);
  });

  it("has at least one funnelEligible event", () => {
    const eligible = events.filter((e) => e.funnelEligible !== false);
    expect(eligible.length).toBeGreaterThanOrEqual(1);
  });

  it("every event has a non-empty displayName and category", () => {
    const bad = events.filter((e) => !e.displayName || !e.category);
    expect(bad.map((e) => e.id)).toEqual([]);
  });
});

describe("healthians events: every event resolves to a produced table", () => {
  it("all event.table values are in the produced column map", () => {
    const known = new Set(Object.keys(COL_SETS));
    const unknownTables = [
      ...new Set(events.filter((e) => !known.has(e.table)).map((e) => e.table)),
    ].sort();
    expect(
      unknownTables,
      `events reference tables not in the produced column map: ${unknownTables.join(", ")}`,
    ).toEqual([]);
  });
});

describe("healthians events: every property column is real", () => {
  const failures: string[] = [];
  for (const e of events) {
    const cols = COL_SETS[e.table];
    if (!cols) continue;
    for (const p of e.properties) {
      if (!cols.has(p.column)) {
        failures.push(`${e.id} (${e.table}).property "${p.column}"`);
      }
    }
  }
  it("all property columns exist in their event's table", () => {
    expect(failures.sort()).toEqual([]);
  });
});

describe("healthians events: dateColumn / countColumn / valueColumn are real", () => {
  const failures: string[] = [];
  for (const e of events) {
    const cols = COL_SETS[e.table];
    if (!cols) continue;
    if (e.dateColumn && !cols.has(e.dateColumn)) {
      failures.push(`${e.id} (${e.table}).dateColumn "${e.dateColumn}"`);
    }
    if (e.valueColumn && e.valueColumn !== "*" && !cols.has(e.valueColumn)) {
      failures.push(`${e.id} (${e.table}).valueColumn "${e.valueColumn}"`);
    }
    if (e.countColumn && e.countColumn !== "*" && !cols.has(e.countColumn)) {
      failures.push(`${e.id} (${e.table}).countColumn "${e.countColumn}"`);
    }
  }
  it("all date/value/count columns exist in their event's table", () => {
    expect(failures.sort()).toEqual([]);
  });
});

describe("healthians events: filterColumn/filterValue are valid", () => {
  it("user_events filterValues are real event_type literals", () => {
    const bad: string[] = [];
    for (const e of events) {
      if (e.table !== "user_events_full") continue;
      if (e.filterColumn === "event_type" && e.filterValue) {
        if (!EVENT_TYPES.has(e.filterValue)) {
          bad.push(`${e.id} -> "${e.filterValue}"`);
        }
      }
    }
    expect(bad.sort()).toEqual([]);
  });

  it("every filterColumn references a real column in the event's table", () => {
    const bad: string[] = [];
    for (const e of events) {
      const cols = COL_SETS[e.table];
      if (!cols || !e.filterColumn) continue;
      if (!cols.has(e.filterColumn)) bad.push(`${e.id} (${e.table}).filterColumn "${e.filterColumn}"`);
    }
    expect(bad.sort()).toEqual([]);
  });
});

describe("healthians events: filterSQL only references real columns", () => {
  const failures: string[] = [];
  for (const e of events) {
    if (!e.filterSQL) continue;
    const cols = COL_SETS[e.table];
    if (!cols) continue;
    for (const ref of columnsInSQL(e.filterSQL)) {
      if (!cols.has(ref)) failures.push(`${e.id} (${e.table}): "${ref}" in [${e.filterSQL}]`);
    }
  }
  it("all filterSQL column references exist in the event's table", () => {
    expect([...new Set(failures)].sort()).toEqual([]);
  });
});

describe("healthians events: backed coverage of the booking lifecycle", () => {
  const has = (id: string) => events.some((e) => e.id === id);
  for (const id of [
    "booking", "first_booking", "repeat_booking", "completed_booking",
    "cancelled_booking", "report_viewed", "counseling_session",
    "sample_rejected", "no_show", "support_ticket", "nps_response",
  ]) {
    it(`has a backed event "${id}"`, () => {
      expect(has(id), `no event with id '${id}'`).toBe(true);
    });
  }
});
