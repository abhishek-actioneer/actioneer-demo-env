/**
 * vastu-hfc EVENT CATALOG validation.
 *
 * Asserts the VASTU_EVENTS catalog only references tables/views and columns
 * that the generator (scripts/generate-vastu-hfc.ts) + viewSQL
 * (src/lib/datasets/vastu-hfc.ts) actually produce. A live-erroring demo is
 * unacceptable, so every event.table, dateColumn, valueColumn, property column,
 * and column named inside filterSQL must exist in the hardcoded column map below.
 *
 * The column map is derived directly from the ground-truth scripts:
 *   - raw_loans          -> loans.csv headers
 *   - loans_full         -> raw_loans + borrower/branch/co-lending join columns
 *   - raw_emi_payments   -> emi_payments.csv headers
 *   - collections_full   -> raw_emi_payments + loan/borrower/branch join columns
 *   - raw_collections_actions -> collections_actions.csv headers
 *   - collections_actions_full -> raw_collections_actions + loan join columns
 *   - raw_branches       -> branches.csv headers
 *
 * No DB connection is opened — pure config/schema consistency.
 */

import { describe, it, expect } from "vitest";
import { vastuHfcDataset } from "@/lib/datasets/vastu-hfc";
import type { EventDefinition } from "@/lib/explorer-types";

// ── Ground-truth column sets (hardcoded from generator + viewSQL) ────────────

const RAW_LOANS_COLS = [
  "loan_id", "borrower_id", "branch_id", "entity", "product_type", "disbursement_date",
  "sanctioned_amount", "disbursed_amount", "interest_rate", "tenure_months", "emi_amount",
  "ltv_ratio", "property_value", "sourcing_channel", "co_lending_partner",
  "loan_status", "dpd_bucket", "stage", "overdue_amount", "last_payment_date",
];

const LOANS_FULL_COLS = [
  ...RAW_LOANS_COLS,
  // borrower join
  "borrower_name", "borrower_gender", "borrower_age", "employment_type",
  "monthly_income_inr", "income_category", "industry", "bureau_score", "is_ntc", "property_type",
  // branch join
  "branch_name", "state", "city", "city_tier", "branch_type", "branch_open_date",
  // co-lending join
  "co_lending_partner_name", "co_lending_partner_type",
];

const RAW_EMI_COLS = [
  "payment_id", "loan_id", "due_date", "amount_due", "amount_paid", "paid_date",
  "payment_mode", "bounce", "dpd_at_payment", "collection_bucket",
];

const COLLECTIONS_FULL_COLS = [
  ...RAW_EMI_COLS,
  // loan join
  "borrower_id", "entity", "product_type", "interest_rate", "loan_status",
  "loan_dpd_bucket", "loan_stage", "sourcing_channel", "co_lending_partner",
  // borrower join
  "employment_type", "income_category", "is_ntc",
  // branch join
  "state", "city", "city_tier", "branch_name",
];

const RAW_COLLECTION_ACTIONS_COLS = [
  "action_id", "loan_id", "action_date", "action_type", "dpd_at_action",
  "result", "agent_id", "branch_id",
];

const COLLECTIONS_ACTIONS_FULL_COLS = [
  ...RAW_COLLECTION_ACTIONS_COLS,
  // loan join
  "borrower_id", "entity", "product_type", "loan_status",
];

const RAW_BRANCHES_COLS = [
  "branch_id", "branch_name", "entity", "state", "city", "city_tier",
  "branch_type", "open_date", "employee_count", "monthly_rent_inr", "is_active",
];

const TABLE_COLUMNS: Record<string, Set<string>> = {
  loans_full: new Set(LOANS_FULL_COLS),
  collections_full: new Set(COLLECTIONS_FULL_COLS),
  collections_actions_full: new Set(COLLECTIONS_ACTIONS_FULL_COLS),
  raw_branches: new Set(RAW_BRANCHES_COLS),
};

// Extract bare identifiers referenced in a filterSQL predicate, ignoring SQL
// keywords, string literals, and numbers. Used to validate every column named
// in a filter actually exists on the event's table.
const SQL_KEYWORDS = new Set([
  "and", "or", "not", "in", "is", "null", "like", "true", "false",
  "between", "as", "on",
]);

function columnsInFilterSQL(filterSQL: string): string[] {
  // Strip single-quoted string literals so values like 'home%' aren't parsed.
  const noStrings = filterSQL.replace(/'[^']*'/g, " ");
  const tokens = noStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  return tokens.filter((t) => !SQL_KEYWORDS.has(t.toLowerCase()));
}

const events: EventDefinition[] = vastuHfcDataset.events ?? [];

describe("vastu-hfc events: every event.table is a produced table/view", () => {
  for (const ev of events) {
    it(`[${ev.id}] table "${ev.table}" exists`, () => {
      expect(TABLE_COLUMNS[ev.table], `unknown table "${ev.table}"`).toBeDefined();
    });
  }
});

describe("vastu-hfc events: every property column exists on its table", () => {
  for (const ev of events) {
    const cols = TABLE_COLUMNS[ev.table];
    for (const prop of ev.properties) {
      it(`[${ev.id}] property "${prop.column}" exists on ${ev.table}`, () => {
        expect(
          cols?.has(prop.column),
          `property "${prop.column}" not a real column of ${ev.table}`,
        ).toBe(true);
      });
    }
  }
});

describe("vastu-hfc events: dateColumn and valueColumn exist on their table", () => {
  for (const ev of events) {
    const cols = TABLE_COLUMNS[ev.table];
    if (ev.dateColumn) {
      it(`[${ev.id}] dateColumn "${ev.dateColumn}" exists on ${ev.table}`, () => {
        expect(cols?.has(ev.dateColumn!), `dateColumn "${ev.dateColumn}" missing`).toBe(true);
      });
    }
    if (ev.valueColumn) {
      it(`[${ev.id}] valueColumn "${ev.valueColumn}" exists on ${ev.table}`, () => {
        expect(cols?.has(ev.valueColumn!), `valueColumn "${ev.valueColumn}" missing`).toBe(true);
      });
    }
  }
});

describe("vastu-hfc events: every column named in filterSQL exists on its table", () => {
  for (const ev of events) {
    if (!ev.filterSQL) continue;
    const cols = TABLE_COLUMNS[ev.table];
    it(`[${ev.id}] filterSQL columns exist on ${ev.table}`, () => {
      const referenced = columnsInFilterSQL(ev.filterSQL!);
      const missing = referenced.filter((c) => !cols?.has(c));
      expect(missing, `filterSQL "${ev.filterSQL}" references unknown columns: ${missing.join(", ")}`).toEqual([]);
    });
  }
});

describe("vastu-hfc events: filterColumn (when used) exists on its table", () => {
  it("every filterColumn references a real column", () => {
    const offenders = events
      .filter((ev) => ev.filterColumn)
      .filter((ev) => !TABLE_COLUMNS[ev.table]?.has(ev.filterColumn!))
      .map((ev) => `${ev.id}:${ev.filterColumn}`);
    expect(offenders, `filterColumn refers to unknown columns: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("vastu-hfc events: ids are unique", () => {
  it("no duplicate event ids", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const ev of events) {
      if (seen.has(ev.id)) dups.push(ev.id);
      seen.add(ev.id);
    }
    expect(dups, `duplicate ids: ${dups.join(", ")}`).toEqual([]);
  });
});

describe("vastu-hfc events: catalog has funnel-eligible events", () => {
  it("at least one event is funnel-eligible (funnelEligible !== false)", () => {
    const eligible = events.filter((e) => e.funnelEligible !== false);
    expect(eligible.length).toBeGreaterThanOrEqual(1);
  });

  it("funnel-eligible events have a borrower_id column (uniques/funnels need it)", () => {
    // borrower_id is the dataset.userIdField — funnel/retention/uniques queries
    // reference it, so any funnel-eligible event's table must expose it.
    const userIdField = vastuHfcDataset.userIdField ?? "borrower_id";
    const offenders = events
      .filter((e) => e.funnelEligible !== false)
      .filter((e) => !TABLE_COLUMNS[e.table]?.has(userIdField))
      .map((e) => e.id);
    expect(offenders, `funnel-eligible events missing ${userIdField}: ${offenders.join(", ")}`).toEqual([]);
  });
});
