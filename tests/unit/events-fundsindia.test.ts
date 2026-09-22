/**
 * FundsIndia event-catalog ground-truth validation.
 *
 * The Explorer/Funnels/Retentions UI builds SQL directly from
 * FUNDSINDIA_EVENTS (EventDefinition[]). If an event points at a table that
 * is not produced, a filter/value/date column that does not exist, or a
 * property column that is not in the produced schema, the live Explorer query
 * errors. These tests assert every event resolves to REAL produced columns.
 *
 * The column maps below are hardcoded from the actual produced schema:
 *   - raw_* table columns come from the writeCsv(...) headers in
 *     scripts/generate-fundsindia.ts
 *   - denormalized view columns come from the SELECT lists in
 *     getFundsIndiaViewSQL() (src/lib/datasets/fundsindia-events.ts), which is
 *     exactly what scripts/setup-fundsindia.ts executes.
 *
 * The user_events event_name set is the full distinct set emitted by the
 * generator's addEvent({ event_name: ... }) calls.
 *
 * No DB connection is opened — pure config/schema consistency.
 */

import { describe, it, expect } from "vitest";
import { FUNDSINDIA_EVENTS } from "@/lib/datasets/fundsindia-events";
import type { EventDefinition } from "@/lib/explorer-types";

// ─────────────────────────────────────────────────────────────────────────────
// GROUND TRUTH: produced column maps (table/view -> Set<column>)
// ─────────────────────────────────────────────────────────────────────────────

const COLS = {
  // raw_investors — writeCsv("investors.csv", ...) headers
  raw_investors: [
    "investor_id", "signup_date", "pan_confirmed_date", "kyc_submitted_date",
    "bank_verified_date", "account_activated_date", "first_investment_date", "demat_opened_date",
    "name", "age", "gender", "city", "state", "city_tier",
    "occupation", "annual_income", "investor_type", "risk_profile", "acquisition_channel",
    "kyc_status", "kyc_method", "bank_name", "bank_link_method", "bank_link_status",
    "nomination_preference", "is_pep", "foreign_tax_liable",
    "mf_account_active", "demat_account_active", "aa_consent_given", "is_active",
  ],

  // transactions_full — getFundsIndiaViewSQL() SELECT list
  transactions_full: [
    "txn_id", "investor_id", "fund_id", "sip_id", "goal_id",
    "txn_date", "txn_type", "amount_inr", "units", "nav_at_txn",
    "status", "channel", "payment_mode", "amount_range",
    "fund_name", "amc_name", "fund_category", "fund_subcategory",
    "risk_level", "trailing_commission_pct", "return_1y", "return_3y", "return_5y",
    "is_fi_select", "fi_star_rating",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "signup_date", "account_activated_date",
    "investor_type", "kyc_status", "kyc_method", "bank_name", "bank_link_method",
  ],

  // sips_full — getFundsIndiaViewSQL() SELECT list
  sips_full: [
    "sip_id", "investor_id", "fund_id", "start_date", "end_date", "frequency",
    "amount_inr", "step_up_pct", "step_up_frequency", "sip_type", "status",
    "mandate_type", "cancellation_reason", "total_installments_paid",
    "total_amount_invested", "amount_range",
    "fund_name", "amc_name", "fund_category", "fund_subcategory",
    "risk_level", "trailing_commission_pct", "is_fi_select", "fi_star_rating",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "signup_date", "account_activated_date",
    "investor_type", "kyc_status", "kyc_method", "bank_name", "bank_link_method",
  ],

  // sips_ending_soon — "SELECT s.*, ..." from sips_full + extra derived columns
  sips_ending_soon: [] as string[], // filled below = sips_full + extras

  // goals_full — getFundsIndiaViewSQL() SELECT list
  goals_full: [
    "goal_id", "investor_id", "goal_type", "target_amount_inr", "target_date",
    "monthly_sip_needed_inr", "current_value_inr", "created_date", "status",
    "created_by", "flagged_at_risk_date", "achieved_date", "target_bucket",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "investor_type", "kyc_status", "kyc_method",
    "bank_name", "bank_link_method",
  ],

  // comms_full — getFundsIndiaViewSQL() SELECT list
  comms_full: [
    "comm_id", "investor_id", "channel", "campaign_type", "sent_at",
    "delivered", "opened", "clicked", "converted", "action_taken",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "investor_type", "kyc_status", "kyc_method",
    "bank_name", "bank_link_method", "is_active",
  ],

  // advisory_full — getFundsIndiaViewSQL() SELECT list
  advisory_full: [
    "session_id", "investor_id", "session_date", "advisor_type", "session_type",
    "duration_min", "recommendation_type", "outcome", "portfolio_value_at_time",
    "triggered_by", "portfolio_value_bucket",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "investor_type", "kyc_status", "kyc_method",
    "bank_name", "bank_link_method",
  ],

  // support_full — getFundsIndiaViewSQL() SELECT list
  support_full: [
    "ticket_id", "investor_id", "created_at", "resolved_at", "category", "channel",
    "priority", "status", "resolution_hours", "nps_score", "resolution_bucket",
    "nps_bucket",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "investor_type", "kyc_status", "kyc_method",
    "bank_name", "bank_link_method", "is_active",
  ],

  // systematic_plans_full — getFundsIndiaViewSQL() SELECT list
  systematic_plans_full: [
    "plan_id", "investor_id", "plan_type", "source_fund_id", "target_fund_id",
    "amount_inr", "frequency", "start_date", "end_date", "status",
    "installments_completed", "amount_range",
    "source_fund_name", "source_amc_name", "source_fund_category", "source_fund_subcategory",
    "target_fund_name", "target_amc_name", "target_fund_category", "target_fund_subcategory",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "investor_type", "kyc_status", "kyc_method",
    "bank_name", "bank_link_method",
  ],

  // user_events_full — getFundsIndiaViewSQL() SELECT list
  user_events_full: [
    "event_id", "event_name", "investor_id", "anonymous_id", "session_id",
    "event_timestamp", "platform", "page_path", "source_medium",
    "fund_id", "fund_category", "fund_subcategory", "amc_name",
    "risk_level", "is_fi_select", "fi_star_rating",
    "calculator_type", "calc_input_amount", "calc_result_amount",
    "article_slug", "campaign_type", "search_query",
    "amount_inr", "amount_range", "sip_id", "goal_type", "step_name", "drop_reason",
    "city_tier", "risk_profile", "occupation", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age", "investor_type", "kyc_status", "kyc_method",
    "bank_name", "bank_link_method", "signup_date", "bank_verified_date",
    "account_activated_date",
  ],

  // investor_fund_positions — derived view (cashflows CTE + final SELECT *)
  investor_fund_positions: [
    "investor_id", "fund_id", "fund_name", "amc_name", "fund_category", "fund_subcategory",
    "risk_level", "is_fi_select", "fi_star_rating",
    "city_tier", "risk_profile", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age",
    "first_purchase_date", "last_purchase_date", "last_activity_date", "last_redemption_date",
    "purchase_count", "sip_installment_count", "lumpsum_count", "stp_purchase_count",
    "redemption_count", "linked_sip_count",
    "gross_purchased_inr", "redeemed_inr", "net_invested_inr",
    "gross_units_purchased", "redeemed_units", "net_units",
    "has_sip_investment", "has_lumpsum_investment", "has_stp_investment",
    "has_purchase_in_window", "has_redemption_in_window", "is_current_holding",
    "position_status", "position_size_bucket", "is_sip_linked", "is_repeat_buyer",
  ],

  // investor_portfolio_summary — derived view (base CTE + dominant + final SELECT)
  investor_portfolio_summary: [
    "investor_id", "city_tier", "risk_profile", "acquisition_channel", "annual_income",
    "state", "city", "gender", "age",
    "first_purchase_date", "last_purchase_date", "last_activity_date", "last_redemption_date",
    "position_count", "current_fund_count", "current_category_count", "current_amc_count",
    "ever_bought_fund_count", "purchase_count", "sip_installment_count", "lumpsum_count",
    "stp_purchase_count", "redemption_count",
    "gross_purchased_inr", "redeemed_inr", "net_activity_inr", "net_invested_inr", "net_units",
    "fi_select_current_count", "elss_current_count", "equity_current_count",
    "debt_current_count", "liquid_current_count", "sip_linked_current_count",
    "repeat_position_count", "dominant_current_category", "dominant_current_amc",
    "has_current_holding", "has_purchase_in_window", "has_redemption_in_window",
    "has_fi_select_holding", "has_elss_holding", "has_sip_linked_holding",
    "portfolio_status", "portfolio_value_bucket", "portfolio_breadth_bucket",
  ],
};

// sips_ending_soon = all sips_full columns + the view's extra derived columns
COLS.sips_ending_soon = [
  ...COLS.sips_full,
  "as_of_date", "days_to_end", "sip_end_window", "is_ending_soon",
];

const COL_SETS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(COLS).map(([t, cols]) => [t, new Set(cols)]),
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUND TRUTH: full distinct user_events event_name set emitted by generator
// (scripts/generate-fundsindia.ts addEvent({ event_name: ... }))
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_NAMES = new Set<string>([
  "academy_article_viewed", "account_activated", "bank_auto_detect_started",
  "bank_auto_detect_success", "bank_verified", "calculator_computed",
  "calculator_invest_cta_clicked", "calculator_opened", "dashboard_visited",
  "demat_cta_clicked", "email_link_clicked", "email_opened", "fatca_submitted",
  "fund_page_viewed", "fund_searched", "fund_watchlisted", "goal_created",
  "kyc_details_submitted", "kyc_on_hold", "pan_confirmed", "pan_step_loaded",
  "portfolio_visited", "pre_redemption_call_accepted", "pre_redemption_call_declined",
  "pre_redemption_call_offered", "redemption_cancelled", "redemption_completed",
  "redemption_initiated", "signup_started", "sip_amount_entered", "sip_cancelled",
  "sip_created", "sip_flow_abandoned", "sip_flow_started", "sip_fund_selected",
]);

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract bare identifiers referenced in a filterSQL predicate. */
function columnsInSQL(sql: string): string[] {
  // strip string literals so values like 'verified' aren't read as columns
  const noStrings = sql.replace(/'[^']*'/g, " ");
  const tokens = noStrings.match(/[a-z_][a-z0-9_]*/gi) ?? [];
  const KEYWORDS = new Set([
    "and", "or", "not", "in", "is", "null", "true", "false", "between",
    "like", "as", "case", "when", "then", "else", "end",
  ]);
  return tokens.filter((t) => !KEYWORDS.has(t.toLowerCase()));
}

const events = FUNDSINDIA_EVENTS;

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

describe("fundsindia events: catalog integrity", () => {
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

describe("fundsindia events: every event resolves to a produced table", () => {
  it("all event.table values are in the produced schema column map", () => {
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

describe("fundsindia events: every property column is real", () => {
  const failures: string[] = [];
  for (const e of events) {
    const cols = COL_SETS[e.table];
    if (!cols) continue; // covered by the table test above
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

describe("fundsindia events: dateColumn / countColumn / valueColumn are real", () => {
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

describe("fundsindia events: filterColumn/filterValue are valid", () => {
  it("user_events filterValues are real event_name literals", () => {
    const bad: string[] = [];
    for (const e of events) {
      if (e.table !== "user_events_full") continue;
      if (e.filterColumn === "event_name" && e.filterValue) {
        if (!EVENT_NAMES.has(e.filterValue)) {
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

describe("fundsindia events: filterSQL only references real columns", () => {
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

describe("fundsindia events: backed coverage of the SIP status lifecycle", () => {
  // The generator's sipStatus() produces active|cancelled|paused|completed.
  // Each non-active terminal status that carries an end_date should have an event.
  const sipStatuses = (status: string): EventDefinition | undefined =>
    events.find((e) => e.table === "sips_full" && (e.filterSQL ?? "").includes(`status = '${status}'`));

  for (const status of ["cancelled", "paused", "completed"]) {
    it(`has a sips_full event filtering status = '${status}'`, () => {
      expect(sipStatuses(status), `no event covers SIP status '${status}'`).toBeTruthy();
    });
  }
});
