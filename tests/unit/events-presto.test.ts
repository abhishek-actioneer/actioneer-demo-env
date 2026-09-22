/**
 * presto event-catalog validation.
 *
 * Asserts the PRESTO_EVENTS catalog (exposed via prestoDataset.events)
 * only references tables and columns that the generator actually produces.
 *
 * The PRODUCED_COLUMNS map below is the ground truth, hand-derived from the
 * DataFrame constructors in scripts/generate-presto.py:
 *   - installs              → gen_installs   (df = pd.DataFrame({...}) + install_week/month)
 *   - sessions              → gen_sessions
 *   - ad_impression_events  → gen_ad_impressions
 *   - revenue               → gen_revenue
 *   - campaign              → gen_campaign
 *
 * If the generator schema changes, update PRODUCED_COLUMNS to match.
 * No DB connection is opened — pure config/schema consistency.
 */

import { describe, it, expect } from "vitest";
import { prestoDataset } from "@/lib/datasets/presto";

// ── Ground truth: every column each parquet table actually contains ──────────

const PRODUCED_COLUMNS: Record<string, Set<string>> = {
  installs: new Set([
    "user_id",
    "install_date",
    "channel",
    "platform",
    "country",
    "device_model",
    "is_fraud",
    "fraud_rate",
    "engagement_tier",
    "is_new_targeting",
    "install_week",
    "install_month",
  ]),
  sessions: new Set([
    "session_id",
    "user_id",
    "session_date",
    "install_date",
    "install_week",
    "install_month",
    "channel",
    "platform",
    "country",
    "days_from_install",
    "session_duration_mins",
    "level_reached",
    "level_completed",
    "ad_revenue",
    "is_fraud",
  ]),
  ad_impression_events: new Set([
    "record_id",
    "ts",
    "user_id",
    "session_id",
    "channel",
    "platform",
    "country",
    "ad_format",
    "ad_platform",
    "revenue",
    "fraud_rate",
    "settled_revenue",
    "net_revenue",
    "install_week",
    "install_month",
  ]),
  revenue: new Set([
    "cohort_date",
    "install_week",
    "install_month",
    "channel",
    "country",
    "platform",
    "os",
    "days_from_cohort",
    "period",
    "cohort_installs",
    "retained_users",
    "retention_rate",
    "arpu",
    "total_arpu",
    "arpdau",
    "roi",
    "total_roi",
    "projected_d180_ltv",
    "is_observed",
    "days_elapsed",
  ]),
  campaign: new Set([
    "cohort_date",
    "channel",
    "country",
    "os",
    "cost",
    "installs",
    "impressions",
    "clicks",
    "cpi",
    "ecpm",
    "arpdau",
    "roi",
  ]),
};

const PRODUCED_TABLES = new Set(Object.keys(PRODUCED_COLUMNS));

const events = prestoDataset.events ?? [];

describe("events-presto: catalog matches the generated schema", () => {
  it("has events defined", () => {
    expect(events.length).toBeGreaterThan(0);
  });

  it("every event.table is a real produced table", () => {
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

  it("cohort-rollup events (revenue, campaign) are NOT funnelEligible", () => {
    const rollupTables = new Set(["revenue", "campaign"]);
    const leaked = events
      .filter((e) => rollupTables.has(e.table) && e.funnelEligible !== false)
      .map((e) => e.id);
    expect(leaked, `rollup events incorrectly marked funnelEligible: ${leaked.join(", ")}`).toEqual([]);
  });
});
