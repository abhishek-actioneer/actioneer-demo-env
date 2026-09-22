/**
 * Per-dataset synthetic infrastructure setup.
 *
 * Creates the seed-view alias, the __live shard tables, and the public union
 * views. Called at the start of every tick so it is idempotent and recovers
 * from server restarts where readyCache may have skipped re-running the
 * dataset's viewSQL.
 *
 * Per-dataset DDL is hand-coded here rather than derived from the plan because
 * each dataset has a different existing view shape (e.g. `bookings` is already
 * a JOIN). Adding a new dataset means adding a function here.
 */

import type { DuckDBConnection } from "@duckdb/node-api";

const SETUP: Record<string, (conn: DuckDBConnection) => Promise<void>> = {
  quickhelp: setupQuickhelp,
  "vastu-hfc": setupVastuHfc,
};

export async function ensureSyntheticInfrastructure(
  datasetId: string,
  conn: DuckDBConnection,
): Promise<void> {
  const fn = SETUP[datasetId];
  if (!fn) throw new Error(`No synthetic infrastructure setup for dataset: ${datasetId}`);
  await fn(conn);
}

/**
 * Shared: create the `dataset_now` single-row view exposing the synthetic
 * clock to SQL. Saved segment / saved funnel SQL anchor relative date filters
 * to (SELECT today FROM dataset_now) so counts drift naturally as ticks land.
 *
 * Idempotent — called by every dataset's setup function and on every tick.
 * Depends on synthetic_clock existing (ensureClock runs before this).
 */
export async function ensureDatasetNowView(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE OR REPLACE VIEW dataset_now AS
    SELECT current_now AS now, current_now::DATE AS today FROM synthetic_clock
  `);
}

async function setupQuickhelp(conn: DuckDBConnection): Promise<void> {
  // Use this helper to create _seed views that point directly at the CSV file,
  // so the public name can be redefined as `_seed UNION ALL __live` without
  // creating a circular reference.
  // NB: dataDir must match what viewSQL uses; we hard-code the CSV path here
  // because synthesis infrastructure runs on every tick and needs to be
  // idempotent with respect to the dataset's normal viewSQL.
  const csv = (name: string) =>
    `read_csv('${process.cwd()}/data/csv/${name}.csv', auto_detect=true)`;
  // ── bookings: seed view + live shard + union view ────────────────────────
  await conn.run(`
    CREATE OR REPLACE VIEW bookings_seed AS
    SELECT
      b.*,
      c.signup_date, c.preferred_payment, c.is_active, c.acquisition_source, c.ltv_bucket,
      camp.campaign_name, camp.campaign_type, camp.discount_pct, camp.offer_type, camp.target_segment
    FROM raw_bookings b
    LEFT JOIN raw_customers c USING (customer_id)
    LEFT JOIN campaigns_v2 camp USING (campaign_id)
  `);
  await conn.run(`CREATE TABLE IF NOT EXISTS bookings__live AS SELECT * FROM bookings_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW bookings AS
    SELECT * FROM bookings_seed
    UNION ALL
    SELECT * FROM bookings__live
  `);

  // ── daily_sessions: rename existing pass-through view, add live shard ────
  // The original viewSQL defines `daily_sessions` as `SELECT * FROM raw_daily_sessions`.
  // We mirror that pattern in `daily_sessions_seed` and replace the public view.
  await conn.run(`CREATE OR REPLACE VIEW daily_sessions_seed AS SELECT * FROM raw_daily_sessions`);
  await conn.run(`CREATE TABLE IF NOT EXISTS daily_sessions__live AS SELECT * FROM daily_sessions_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW daily_sessions AS
    SELECT * FROM daily_sessions_seed
    UNION ALL
    SELECT * FROM daily_sessions__live
  `);

  // ── funnel_events: same pattern — DDL only for now, generation lands Day 3 ─
  await conn.run(`CREATE OR REPLACE VIEW funnel_events_seed AS SELECT * FROM raw_funnel_events`);
  await conn.run(`CREATE TABLE IF NOT EXISTS funnel_events__live AS SELECT * FROM funnel_events_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW funnel_events AS
    SELECT * FROM funnel_events_seed
    UNION ALL
    SELECT * FROM funnel_events__live
  `);

  // Pattern for each table below: rebind raw_X to (raw_X_seed UNION ALL raw_X__live)
  // so EVERY query (raw, public view, summary table) sees both. The _seed view
  // points at the CSV directly (not via raw_X) to avoid circular reference.

  // booking_unit_economics — 1:1 with each new booking
  await conn.run(`CREATE OR REPLACE VIEW raw_booking_unit_economics_seed AS SELECT * FROM ${csv("booking_unit_economics")}`);
  await conn.run(`CREATE TABLE IF NOT EXISTS raw_booking_unit_economics__live AS SELECT * FROM raw_booking_unit_economics_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW raw_booking_unit_economics AS
    SELECT * FROM raw_booking_unit_economics_seed
    UNION ALL
    SELECT * FROM raw_booking_unit_economics__live
  `);
  // bookings_economics joins bookings (already unioned) with raw_booking_unit_economics (now unioned)
  await conn.run(`
    CREATE OR REPLACE VIEW bookings_economics AS
    SELECT
      b.*,
      e.commission_rate, e.commission_earned, e.partner_payout,
      e.payment_processing_fee, e.gst_on_commission,
      e.promo_discount_funded, e.referral_reward_cost, e.support_cost_allocated,
      e.contribution_margin, e.contribution_margin_pct
    FROM bookings b
    JOIN raw_booking_unit_economics e USING (booking_id)
  `);

  // partner_shifts — derived from new bookings (1 shift per partner per day)
  await conn.run(`CREATE OR REPLACE VIEW partner_shifts_seed AS SELECT * FROM ${csv("partner_shifts")}`);
  await conn.run(`CREATE TABLE IF NOT EXISTS partner_shifts__live AS SELECT * FROM partner_shifts_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW partner_shifts AS
    SELECT * FROM partner_shifts_seed
    UNION ALL
    SELECT * FROM partner_shifts__live
  `);

  // raw_survey_responses — ~20% of completed bookings produce a survey
  await conn.run(`CREATE OR REPLACE VIEW raw_survey_responses_seed AS SELECT * FROM ${csv("survey_responses")}`);
  await conn.run(`CREATE TABLE IF NOT EXISTS raw_survey_responses__live AS SELECT * FROM raw_survey_responses_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW raw_survey_responses AS
    SELECT * FROM raw_survey_responses_seed
    UNION ALL
    SELECT * FROM raw_survey_responses__live
  `);

  // raw_comms_sends — onboarding journey + active campaign sends, ~10x bookings volume
  await conn.run(`CREATE OR REPLACE VIEW raw_comms_sends_seed AS SELECT * FROM ${csv("comms_sends")}`);
  await conn.run(`CREATE TABLE IF NOT EXISTS raw_comms_sends__live AS SELECT * FROM raw_comms_sends_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW raw_comms_sends AS
    SELECT * FROM raw_comms_sends_seed
    UNION ALL
    SELECT * FROM raw_comms_sends__live
  `);

  // raw_ad_daily_metrics — per creative × per day
  await conn.run(`CREATE OR REPLACE VIEW raw_ad_daily_metrics_seed AS SELECT * FROM ${csv("ad_daily_metrics")}`);
  await conn.run(`CREATE TABLE IF NOT EXISTS raw_ad_daily_metrics__live AS SELECT * FROM raw_ad_daily_metrics_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW raw_ad_daily_metrics AS
    SELECT * FROM raw_ad_daily_metrics_seed
    UNION ALL
    SELECT * FROM raw_ad_daily_metrics__live
  `);

  // raw_partner_payouts — weekly aggregation (Wednesday roll-up)
  await conn.run(`CREATE OR REPLACE VIEW raw_partner_payouts_seed AS SELECT * FROM ${csv("partner_payouts")}`);
  await conn.run(`CREATE TABLE IF NOT EXISTS raw_partner_payouts__live AS SELECT * FROM raw_partner_payouts_seed LIMIT 0`);
  await conn.run(`
    CREATE OR REPLACE VIEW raw_partner_payouts AS
    SELECT * FROM raw_partner_payouts_seed
    UNION ALL
    SELECT * FROM raw_partner_payouts__live
  `);
  // partner_payouts (public) is just an alias of raw_partner_payouts in seed viewSQL
  await conn.run(`CREATE OR REPLACE VIEW partner_payouts AS SELECT * FROM raw_partner_payouts`);

  await ensureDatasetNowView(conn);
}

/**
 * Vastu HFC infrastructure — sets up 10 __live shards alongside the existing
 * seed views. Pattern matches quickhelp:
 *   - raw_<table>_seed view → reads CSV directly (avoids circular reference)
 *   - raw_<table>__live table → empty schema-mirror, accumulates synthesized rows
 *   - raw_<table> view → seed UNION ALL live (re-binds the public name)
 *
 * Denormalized views in the dataset's own viewSQL (loans_full, collections_full,
 * collections_actions_full, branches_full) read raw_* and resolve at query time,
 * so they auto-pick-up live rows after rebinding — no rewrite needed there.
 *
 * Skipped (seed-only by design):
 *   - raw_co_lending_partners — 10 rows, glacial change rate
 *   - raw_disbursements — pre-aggregated rollup, replaced by summaryTableSQL.monthly_disbursements
 *   - funding_full — view alias of raw_borrowings, auto-resolves
 *
 * Idempotent — runs at the start of every tick.
 */
async function setupVastuHfc(conn: DuckDBConnection): Promise<void> {
  const csv = (name: string) =>
    `read_csv('${process.cwd()}/data/csv/vastu-hfc/${name}.csv', auto_detect=true, ignore_errors=true)`;

  // Two table classes:
  //
  //   APPEND-ONLY (UNION ALL): rows are immutable events; no override needed.
  //     - emi_payments       (each EMI is an immutable ledger entry)
  //     - collections_actions (each action is an immutable event)
  //     - assignments         (quarterly batch sale, immutable once recorded)
  //     - provisions          (monthly snapshot, immutable)
  //     - npa_movement        (quarterly snapshot, immutable)
  //     - borrowers           (treat as immutable post-creation)
  //
  //   MUTABLE (override pattern): seed rows whose state evolves over time.
  //     The seed view filters out any id that exists in __live, so a new row
  //     in __live with the same id supersedes the seed row exactly once.
  //     Within __live, the ageing orchestrator DELETEs the prior row before
  //     INSERTing the new one so each id appears at most once.
  //
  //     - loans      (loan_status, dpd_bucket, stage, overdue_amount, last_payment_date all evolve)
  //     - branches   (is_active flips)
  //     - employees  (is_active flips on attrition)
  //     - borrowings (outstanding_amount_cr amortizes each tick; matures at end)

  const APPEND_ONLY: { name: string }[] = [
    { name: "borrowers" },
    { name: "emi_payments" },
    { name: "collections_actions" },
    { name: "assignments" },
    { name: "provisions" },
    { name: "npa_movement" },
  ];
  const MUTABLE: { name: string; idColumn: string }[] = [
    { name: "loans", idColumn: "loan_id" },
    { name: "branches", idColumn: "branch_id" },
    { name: "employees", idColumn: "employee_id" },
    { name: "borrowings", idColumn: "borrowing_id" },
  ];

  for (const { name } of APPEND_ONLY) {
    await conn.run(`CREATE OR REPLACE VIEW raw_${name}_seed AS SELECT * FROM ${csv(name)}`);
    await conn.run(`CREATE TABLE IF NOT EXISTS raw_${name}__live AS SELECT * FROM raw_${name}_seed LIMIT 0`);
    await conn.run(`
      CREATE OR REPLACE VIEW raw_${name} AS
      SELECT * FROM raw_${name}_seed
      UNION ALL
      SELECT * FROM raw_${name}__live
    `);
  }

  for (const { name, idColumn } of MUTABLE) {
    await conn.run(`CREATE OR REPLACE VIEW raw_${name}_seed AS SELECT * FROM ${csv(name)}`);
    await conn.run(`CREATE TABLE IF NOT EXISTS raw_${name}__live AS SELECT * FROM raw_${name}_seed LIMIT 0`);
    await conn.run(`
      CREATE OR REPLACE VIEW raw_${name} AS
      SELECT * FROM raw_${name}_seed
      WHERE ${idColumn} NOT IN (SELECT ${idColumn} FROM raw_${name}__live)
      UNION ALL
      SELECT * FROM raw_${name}__live
    `);
  }

  await ensureDatasetNowView(conn);
}

/**
 * Refresh ALL summary tables defined by the dataset config.
 *
 * Strategy: pull `summaryTableSQL` straight from the dataset registry and
 * re-execute every CREATE OR REPLACE TABLE statement. Because every summary
 * derives from views/raw tables we've now rebound to UNION seed + live, the
 * rebuilt summary picks up live data automatically — no SQL duplication here.
 *
 * Cost: ~400ms per summary × 17 summaries ≈ 7s on quickhelp at current scale.
 * Acceptable for a daily tick; will revisit if Railway times out.
 */
export async function refreshSummaryTables(
  datasetId: string,
  conn: DuckDBConnection,
): Promise<{ table: string; ms: number; ok: boolean; error?: string }[]> {
  const { getDataset } = await import("../datasets");
  const ds = getDataset(datasetId);
  const sqls = ds.summaryTableSQL ?? [];
  const results: { table: string; ms: number; ok: boolean; error?: string }[] = [];
  for (const sql of sqls) {
    const match = sql.match(/CREATE\s+OR\s+REPLACE\s+TABLE\s+(\w+)/i);
    const table = match?.[1] ?? "unknown";
    const start = Date.now();
    try {
      await conn.run(sql);
      results.push({ table, ms: Date.now() - start, ok: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ table, ms: Date.now() - start, ok: false, error });
      console.warn(`[synthetic.refreshSummary] ${table} failed:`, error);
    }
  }
  return results;
}
