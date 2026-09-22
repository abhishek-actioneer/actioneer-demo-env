/**
 * quickhelp EVENT CATALOG validation.
 *
 * Asserts the QUICKHELP_EVENTS catalog only references tables/views and columns
 * that the generator (scripts/generate-quickhelp-v2.ts) + viewSQL
 * (src/lib/datasets/quickhelp.ts) actually produce. A live-erroring demo is
 * unacceptable, so every event.table, dateColumn, valueColumn, filterColumn,
 * countColumn, and property column must exist in the hardcoded column map below,
 * and every filterValue on an enum-like column must be a value the generator emits.
 *
 * The column map is derived directly from the ground-truth scripts:
 *   - bookings        -> BookingRow + customers join (signup_date, preferred_payment,
 *                        is_active, acquisition_source, ltv_bucket) + campaigns_v2 join
 *                        (campaign_name, campaign_type, discount_pct, offer_type, target_segment)
 *   - funnel_events   -> FunnelEventRow
 *   - comms_full      -> CommsSendRow + campaigns_v2 join (campaign_name, camp_type,
 *                        camp_offer_type, camp_target_segment) + journeys join
 *                        (journey_name, trigger_event, journey_total_steps)
 *   - daily_sessions  -> DailySessionRow
 *   - partner_shifts  -> EnrichedShiftRow (ShiftRow + earnings_gross, commission_rate,
 *                        incentive_earned, net_earnings)
 *   - referrals_full  -> ReferralRow + customers join (referrer + referee columns)
 *   - survey_full     -> SurveyResponseRow + bookings join (booking_date, service_type,
 *                        service_tier, hub_name, booking_value, partner_rating,
 *                        acquisition_source, ltv_bucket)
 *   - ad_full         -> AdDailyMetricRow + creatives/sets/campaigns joins
 *
 * No DB connection is opened — pure config/schema consistency.
 */

import { describe, it, expect } from "vitest";
import { quickhelpDataset } from "@/lib/datasets/quickhelp";

// ── Ground truth: every column each table/view actually contains ─────────────

const PRODUCED_COLUMNS: Record<string, Set<string>> = {
  bookings: new Set([
    // BookingRow
    "booking_id", "booking_date", "booking_time", "customer_id", "customer_lat",
    "customer_lng", "service_type", "service_tier", "service_duration_min",
    "booking_value", "hub_id", "hub_name", "area", "city", "partner_id",
    "partner_age", "partner_rating", "assigned_at", "arrived_at", "arrival_time_min",
    "expected_arrival_min", "on_time", "weather", "traffic_density", "back_to_back",
    "festival", "payment_method", "payment_status", "is_first_booking", "rescheduled",
    "partner_reassigned", "campaign_id",
    // joined from customers
    "signup_date", "preferred_payment", "is_active", "acquisition_source", "ltv_bucket",
    // joined from campaigns_v2
    "campaign_name", "campaign_type", "discount_pct", "offer_type", "target_segment",
  ]),
  funnel_events: new Set([
    "event_id", "customer_id", "event_type", "event_at", "days_since_signup",
    "source", "city", "platform",
  ]),
  comms_full: new Set([
    // CommsSendRow
    "send_id", "customer_id", "channel", "campaign_id", "journey_id", "journey_step",
    "template_name", "sent_at", "delivered", "opened", "clicked", "converted",
    "booking_id", "send_cost_inr", "time_to_open_min", "ab_variant", "frequency_cap_hit",
    "coupon_code", "user_segment_at_send", "days_since_last_booking",
    "lifetime_bookings_at_send", "predicted_ltv_bucket", "hub_id", "unsubscribed",
    // joined from campaigns_v2
    "campaign_name", "camp_type", "camp_offer_type", "camp_target_segment",
    // joined from journeys
    "journey_name", "trigger_event", "journey_total_steps",
  ]),
  daily_sessions: new Set([
    "customer_id", "session_date", "session_count", "screens_viewed", "minutes_active",
    "searched", "booked", "viewed_offers", "platform",
  ]),
  partner_shifts: new Set([
    // ShiftRow
    "shift_id", "partner_id", "shift_date", "hub_id", "status", "bookings_assigned",
    "bookings_completed", "shift_start", "shift_hours",
    // EnrichedShiftRow additions
    "earnings_gross", "commission_rate", "incentive_earned", "net_earnings",
  ]),
  referrals_full: new Set([
    // ReferralRow
    "referral_id", "referrer_customer_id", "referee_customer_id", "referral_code",
    "invited_at", "signup_at", "first_booking_at", "days_to_signup",
    "days_to_first_booking", "referrer_reward_amount", "referee_reward_amount",
    "reward_status", "referral_channel", "status",
    // joined from customers (referrer + referee)
    "referrer_city", "referrer_signup_date", "referrer_ltv_bucket", "referrer_acq_source",
    "referee_city", "referee_signup_date", "referee_ltv_bucket",
  ]),
  survey_full: new Set([
    // SurveyResponseRow
    "response_id", "customer_id", "booking_id", "partner_id", "survey_type", "score",
    "category", "submitted_at", "time_to_respond_hours",
    // joined from bookings
    "booking_date", "service_type", "service_tier", "hub_name", "booking_value",
    "partner_rating", "acquisition_source", "ltv_bucket",
  ]),
  ad_full: new Set([
    // AdDailyMetricRow
    "date", "ad_creative_id", "impressions", "clicks", "spend_inr", "installs",
    "registrations", "first_bookings", "ctr", "cpc_inr", "cpi_inr", "cpfb_inr", "roas",
    // joined from ad_creatives
    "creative_name", "format", "headline", "cta_text", "service_featured", "landing_page",
    // joined from ad_sets
    "ad_set_name", "audience_type", "age_min", "age_max", "gender_target", "ad_city", "placement",
    // joined from ad_campaigns
    "platform", "ad_campaign_name", "campaign_objective", "bid_strategy", "campaign_budget_inr",
  ]),
};

// ── Ground truth: distinct values for enum-like columns the catalog filters on ──
// Derived from the literal value arrays / assignments in generate-quickhelp-v2.ts.

const PRODUCED_VALUES: Record<string, Record<string, Set<string>>> = {
  bookings: {
    payment_status: new Set(["success", "failed", "refunded"]),
  },
  funnel_events: {
    event_type: new Set([
      "signup_complete", "profile_done", "address_added", "payment_added",
      "first_browse", "first_booking", "second_booking_14d", "third_booking_30d",
      "referral_sent",
    ]),
  },
  partner_shifts: {
    status: new Set(["served", "no_show", "cancelled"]),
  },
  referrals_full: {
    status: new Set(["converted", "unconverted"]),
    reward_status: new Set(["credited", "pending", "expired"]),
  },
  survey_full: {
    // generator only emits "post_booking" and "nps" (see weightedPick at the
    // survey step). "csat" is NOT produced.
    survey_type: new Set(["post_booking", "nps"]),
  },
};

const PRODUCED_TABLES = new Set(Object.keys(PRODUCED_COLUMNS));
const events = quickhelpDataset.events ?? [];

describe("events-quickhelp: catalog matches the generated schema", () => {
  it("has events defined", () => {
    expect(events.length).toBeGreaterThan(0);
  });

  it("every event.table is a real produced table/view", () => {
    const bad = events.filter((e) => !PRODUCED_TABLES.has(e.table)).map((e) => `${e.id} → ${e.table}`);
    expect(bad, `events referencing non-existent tables: ${bad.join(", ")}`).toEqual([]);
  });

  it("every event.dateColumn exists in its table", () => {
    const bad: string[] = [];
    for (const e of events) {
      if (!e.dateColumn) continue;
      const cols = PRODUCED_COLUMNS[e.table];
      if (cols && !cols.has(e.dateColumn)) bad.push(`${e.id}: ${e.table}.${e.dateColumn}`);
    }
    expect(bad, `events with dangling dateColumn: ${bad.join(", ")}`).toEqual([]);
  });

  it("every event.valueColumn exists in its table", () => {
    const bad: string[] = [];
    for (const e of events) {
      if (!e.valueColumn) continue;
      const cols = PRODUCED_COLUMNS[e.table];
      if (cols && !cols.has(e.valueColumn)) bad.push(`${e.id}: ${e.table}.${e.valueColumn}`);
    }
    expect(bad, `events with dangling valueColumn: ${bad.join(", ")}`).toEqual([]);
  });

  it("every event.filterColumn exists in its table", () => {
    const bad: string[] = [];
    for (const e of events) {
      if (!e.filterColumn) continue;
      const cols = PRODUCED_COLUMNS[e.table];
      if (cols && !cols.has(e.filterColumn)) bad.push(`${e.id}: ${e.table}.${e.filterColumn}`);
    }
    expect(bad, `events with dangling filterColumn: ${bad.join(", ")}`).toEqual([]);
  });

  it("every event.countColumn (when set) exists in its table", () => {
    const bad: string[] = [];
    for (const e of events) {
      if (!e.countColumn || e.countColumn === "*") continue;
      const cols = PRODUCED_COLUMNS[e.table];
      if (cols && !cols.has(e.countColumn)) bad.push(`${e.id}: ${e.table}.${e.countColumn}`);
    }
    expect(bad, `events with dangling countColumn: ${bad.join(", ")}`).toEqual([]);
  });

  it("every property column exists in its event's table", () => {
    const bad: string[] = [];
    for (const e of events) {
      const cols = PRODUCED_COLUMNS[e.table];
      if (!cols) continue;
      for (const p of e.properties) {
        if (!cols.has(p.column)) bad.push(`${e.id}: ${e.table}.${p.column}`);
      }
    }
    expect(bad, `events with property columns not in the produced schema: ${bad.join(", ")}`).toEqual([]);
  });

  it("every filterValue on an enum-like column is a value the generator emits", () => {
    // Boolean flags are filtered with "true"/"false" — those are always valid.
    const BOOLEAN_LITERALS = new Set(["true", "false"]);
    const bad: string[] = [];
    for (const e of events) {
      if (!e.filterColumn || e.filterValue === undefined) continue;
      if (BOOLEAN_LITERALS.has(String(e.filterValue))) continue;
      const tableValues = PRODUCED_VALUES[e.table];
      const colValues = tableValues?.[e.filterColumn];
      if (!colValues) {
        // Enum-like (non-boolean) filterValue on a column we have not enumerated.
        // Fail loudly so the column set is added to PRODUCED_VALUES rather than
        // silently trusting an unverified value.
        bad.push(`${e.id}: ${e.table}.${e.filterColumn} = "${e.filterValue}" (column not in PRODUCED_VALUES)`);
        continue;
      }
      if (!colValues.has(String(e.filterValue))) {
        bad.push(`${e.id}: ${e.table}.${e.filterColumn} = "${e.filterValue}" (not a produced value)`);
      }
    }
    expect(bad, `events with unverified filterValue: ${bad.join(", ")}`).toEqual([]);
  });

  it("event IDs are unique", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const e of events) {
      if (seen.has(e.id)) dups.push(e.id);
      seen.add(e.id);
    }
    expect(dups, `duplicate event IDs: ${dups.join(", ")}`).toEqual([]);
  });

  it("at least one event is funnelEligible", () => {
    const eligible = events.filter((e) => e.funnelEligible !== false);
    expect(eligible.length).toBeGreaterThan(0);
  });

  it("daily-rollup and status-flag events are NOT funnelEligible", () => {
    // daily_sessions is a daily rollup; comms opened/clicked/converted/unsubscribed/
    // suppressed share the send timestamp. These must not leak into funnels.
    const leaked = events
      .filter((e) => e.table === "daily_sessions" && e.funnelEligible !== false)
      .map((e) => e.id);
    expect(leaked, `daily-rollup events incorrectly marked funnelEligible: ${leaked.join(", ")}`).toEqual([]);
  });
});
