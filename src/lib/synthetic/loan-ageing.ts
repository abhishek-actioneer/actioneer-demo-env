/**
 * Loan ageing state machine for vastu-hfc.
 *
 * The seed loan book has exactly 12 valid (loan_status, dpd_bucket, stage)
 * tuples — confirmed by hand-counting all 187K seed loans. Every UPDATE this
 * module emits MUST land on one of those 12. Anything else is a bug.
 *
 * The 12 valid tuples
 * -------------------
 *   active|current|1            71.9%   ← healthy active
 *   active|sma_0|1               1.2%   ← early warning, 0 DPD with prior lateness
 *   active|sma_1|1               0.9%   ← 1-30 DPD
 *   active|sma_2|2               0.9%   ← 31-60 DPD (stage migrates to 2)
 *   active|npa_90|3              0.85%  ← 60+ DPD, stage 3, NOT YET formal NPA
 *   npa|npa_90|3                 0.08%  ← formally classified at 90+ DPD
 *   npa|npa_180|3                0.05%
 *   npa|npa_360_plus|3           0.03%
 *   written_off|npa_360_plus|3   0.01%  ← terminal
 *   assigned|current|1           6.5%   ← bucket + stage RESET when sold to ARC
 *   closed|current|1            18.9%   ← natural completion
 *   prepaid|current|1            2.4%   ← early payoff
 *
 * Daily ageing pipeline
 * ---------------------
 * Runs at the start of every tick, BEFORE EMI emission. For every active+npa
 * loan with at least one unpaid EMI:
 *   1. Compute new running DPD = today − oldest_unpaid_due_date
 *   2. Recompute dpd_bucket from running DPD
 *   3. Recompute stage from bucket (deterministic)
 *   4. Recompute overdue_amount from sum of unpaid EMI (amount_due − amount_paid)
 *   5. Apply status transition active → npa when bucket = npa_90 AND DPD ≥ 90
 *
 * Override pattern
 * ----------------
 * Mutated loans go into raw_loans__live. The infrastructure view filters seed
 * rows whose loan_id appears in __live. To keep __live single-row-per-loan,
 * this module DELETEs prior __live rows for the same loan_id before INSERTing
 * the new state.
 *
 * Other transitions live elsewhere
 * --------------------------------
 *   - npa → written_off       — month-end pass (rare, ~0.015%/month of book)
 *   - active → closed         — EMI emission when final EMI of tenure paid
 *   - active → prepaid        — EMI emission probabilistic roll
 *   - any → assigned          — quarterly orchestrator (Mar/Jun/Sep/Dec 15)
 *
 * Strict invariants enforced here
 * -------------------------------
 *   - Output state is always one of the 12 valid tuples
 *   - dpd_bucket → stage mapping is deterministic
 *   - status transitions are monotonic in severity (active → npa, never backward)
 *   - last_payment_date is preserved (only EMI emission updates it)
 *   - All 20 loan columns are written to __live (full schema mirror)
 */

import type { DuckDBConnection } from "@duckdb/node-api";

// ── Type aliases ────────────────────────────────────────────────────────────

export type LoanStatus = "active" | "npa" | "written_off" | "assigned" | "closed" | "prepaid";
export type DpdBucket =
  | "current"
  | "sma_0"
  | "sma_1"
  | "sma_2"
  | "npa_90"
  | "npa_180"
  | "npa_360_plus";
export type LoanStage = 1 | 2 | 3;

// ── State machine constants ─────────────────────────────────────────────────

const VALID_STATES_LIST: readonly { status: LoanStatus; bucket: DpdBucket; stage: LoanStage }[] = [
  { status: "active", bucket: "current", stage: 1 },
  { status: "active", bucket: "sma_0", stage: 1 },
  { status: "active", bucket: "sma_1", stage: 1 },
  { status: "active", bucket: "sma_2", stage: 2 },
  { status: "active", bucket: "npa_90", stage: 3 },
  { status: "npa", bucket: "npa_90", stage: 3 },
  { status: "npa", bucket: "npa_180", stage: 3 },
  { status: "npa", bucket: "npa_360_plus", stage: 3 },
  { status: "written_off", bucket: "npa_360_plus", stage: 3 },
  { status: "assigned", bucket: "current", stage: 1 },
  { status: "closed", bucket: "current", stage: 1 },
  { status: "prepaid", bucket: "current", stage: 1 },
];

const VALID_STATES = new Set(
  VALID_STATES_LIST.map((s) => `${s.status}|${s.bucket}|${s.stage}`),
);

export function validateLoanState(status: string, bucket: string, stage: number): boolean {
  return VALID_STATES.has(`${status}|${bucket}|${stage}`);
}

export function assertValidLoanState(status: string, bucket: string, stage: number): void {
  if (!validateLoanState(status, bucket, stage)) {
    throw new Error(
      `Invalid loan state: status=${status} bucket=${bucket} stage=${stage}. ` +
        `Must be one of the 12 seed-observed tuples.`,
    );
  }
}

// ── DPD bucket transitions ──────────────────────────────────────────────────

/**
 * Compute dpd_bucket from running DPD (days past due).
 *
 *   0       → current (clean) | sma_0 (had prior lateness, now caught up)
 *   1-30    → sma_1
 *   31-60   → sma_2
 *   61-180  → npa_90    (stage 3, on the watchlist; not yet formal NPA)
 *   181-360 → npa_180
 *   361+    → npa_360_plus
 *
 * sma_0 is only reached when a loan WAS late and has caught up to 0 DPD.
 * A loan that has never been late stays at "current".
 */
export function bucketFromDpd(runningDpd: number, hadLateness: boolean): DpdBucket {
  if (runningDpd <= 0) return hadLateness ? "sma_0" : "current";
  if (runningDpd <= 30) return "sma_1";
  if (runningDpd <= 60) return "sma_2";
  if (runningDpd <= 180) return "npa_90";
  if (runningDpd <= 360) return "npa_180";
  return "npa_360_plus";
}

export function stageFromBucket(bucket: DpdBucket): LoanStage {
  switch (bucket) {
    case "current":
    case "sma_0":
    case "sma_1":
      return 1;
    case "sma_2":
      return 2;
    case "npa_90":
    case "npa_180":
    case "npa_360_plus":
      return 3;
  }
}

// ── Status transitions ──────────────────────────────────────────────────────

/**
 * Daily transition rule:
 *   active → npa: when running_dpd ≥ 90 (RBI norm). The bucket may be
 *   npa_90 / npa_180 / npa_360_plus depending on how long the loan has been
 *   delinquent — any of those is a sufficient condition to flip status.
 *
 * Status NEVER moves backward (severity-monotonic). Terminal states
 * (closed, prepaid, written_off, assigned) never transition.
 *
 * Other transitions live in:
 *   - npa → written_off       month-end pass
 *   - active → closed/prepaid EMI emission
 *   - any → assigned          quarterly orchestrator
 */
export function nextStatus(
  currentStatus: LoanStatus,
  bucket: DpdBucket,
  runningDpd: number,
): LoanStatus {
  if (
    currentStatus === "written_off" ||
    currentStatus === "closed" ||
    currentStatus === "prepaid" ||
    currentStatus === "assigned"
  ) {
    return currentStatus;
  }
  if (currentStatus === "active" && runningDpd >= 90) {
    return "npa";
  }
  void bucket;
  return currentStatus;
}

// ── Daily ageing UPDATE pass ────────────────────────────────────────────────

export interface DailyAgeingResult {
  /** Loans whose state was recomputed (had unpaid EMIs to age). */
  loansEvaluated: number;
  /** Loans whose (status, bucket, stage, overdue_amount) actually changed. */
  loansMutated: number;
  /** Counts keyed "<oldBucket>→<newBucket>". */
  bucketTransitions: Record<string, number>;
  /** Counts keyed "<oldStatus>→<newStatus>". */
  statusTransitions: Record<string, number>;
  durationMs: number;
}

const LOAN_COLUMNS = [
  "loan_id",
  "borrower_id",
  "branch_id",
  "entity",
  "product_type",
  "disbursement_date",
  "sanctioned_amount",
  "disbursed_amount",
  "interest_rate",
  "tenure_months",
  "emi_amount",
  "ltv_ratio",
  "property_value",
  "sourcing_channel",
  "co_lending_partner",
  "loan_status",
  "dpd_bucket",
  "stage",
  "overdue_amount",
  "last_payment_date",
] as const;

/**
 * Run the daily ageing UPDATE pass.
 *
 * Strategy:
 *   1. CTE `unpaid` aggregates per-loan oldest unpaid due_date and total
 *      overdue from raw_emi_payments (the union view, so seed + live both count).
 *   2. CTE `recomputed` joins active+npa loans to `unpaid`, computes new
 *      running_dpd, derives new bucket / stage / status entirely in SQL using
 *      CASE expressions that mirror the JS pure functions above.
 *   3. CTE `changed` filters to loans whose (status, bucket, stage,
 *      overdue_amount) actually moved — avoids writing identity overrides.
 *   4. DELETE prior __live rows for affected loan_ids (override dedup).
 *   5. INSERT recomputed rows (full 20-column schema) into raw_loans__live.
 *
 * Returns delta counts for ops/telemetry.
 *
 * Caller must own the connection (no withConnection here — runs inside the
 * tick's transaction so a partial ageing failure rolls back cleanly).
 */
export async function applyDailyAgeing(
  conn: DuckDBConnection,
  today: Date,
): Promise<DailyAgeingResult> {
  const startedAt = Date.now();
  const todayStr = today.toISOString().slice(0, 10);

  // Compute new state for every active/npa loan with unpaid EMIs.
  // Read both old and new state so the caller can build the transition deltas.
  const r = await conn.run(`
    WITH unpaid AS (
      SELECT
        loan_id,
        MIN(due_date)                       AS oldest_unpaid_due,
        SUM(amount_due - amount_paid)       AS overdue_total
      FROM raw_emi_payments
      WHERE amount_paid < amount_due
      GROUP BY loan_id
    ),
    recomputed AS (
      SELECT
        l.loan_id,
        l.loan_status                       AS old_status,
        l.dpd_bucket                        AS old_bucket,
        l.stage                             AS old_stage,
        l.overdue_amount                    AS old_overdue,
        DATE_DIFF('day', u.oldest_unpaid_due, DATE '${todayStr}') AS new_dpd,
        u.overdue_total                     AS new_overdue
      FROM raw_loans l
      JOIN unpaid u USING (loan_id)
      WHERE l.loan_status IN ('active', 'npa')
    ),
    derived AS (
      SELECT
        loan_id,
        old_status, old_bucket, old_stage, old_overdue,
        new_dpd, new_overdue,
        -- new bucket from running DPD (mirrors bucketFromDpd in TS)
        CASE
          WHEN new_dpd <= 0   THEN 'sma_0'        -- by definition, this CTE only sees loans WITH unpaid → had_lateness=true
          WHEN new_dpd <= 30  THEN 'sma_1'
          WHEN new_dpd <= 60  THEN 'sma_2'
          WHEN new_dpd <= 180 THEN 'npa_90'
          WHEN new_dpd <= 360 THEN 'npa_180'
          ELSE 'npa_360_plus'
        END AS new_bucket
      FROM recomputed
    ),
    final_state AS (
      SELECT
        loan_id,
        old_status, old_bucket, old_stage, old_overdue,
        new_overdue, new_dpd,
        new_bucket,
        -- stage from bucket (mirrors stageFromBucket)
        CASE
          WHEN new_bucket IN ('current','sma_0','sma_1') THEN 1
          WHEN new_bucket = 'sma_2'                       THEN 2
          ELSE 3
        END AS new_stage,
        -- status: active → npa whenever DPD ≥ 90 (RBI norm). Bucket may be
        -- npa_90 / npa_180 / npa_360_plus — any of those triggers the flip.
        CASE
          WHEN old_status = 'active' AND new_dpd >= 90 THEN 'npa'
          ELSE old_status
        END AS new_status
      FROM derived
    )
    SELECT
      loan_id,
      old_status, old_bucket, old_stage, old_overdue,
      new_status, new_bucket, new_stage, new_overdue
    FROM final_state
    WHERE old_status <> new_status
       OR old_bucket <> new_bucket
       OR old_stage  <> new_stage
       OR old_overdue <> new_overdue
  `);
  const changedRows = await r.getRows();

  if (changedRows.length === 0) {
    // Still report evaluated count for ops visibility.
    const ev = await conn.run(`
      WITH unpaid AS (
        SELECT loan_id FROM raw_emi_payments
        WHERE amount_paid < amount_due GROUP BY loan_id
      )
      SELECT COUNT(*) FROM raw_loans l JOIN unpaid u USING (loan_id)
      WHERE l.loan_status IN ('active','npa')
    `);
    const evaluated = Number((await ev.getRows())[0][0]);
    return {
      loansEvaluated: evaluated,
      loansMutated: 0,
      bucketTransitions: {},
      statusTransitions: {},
      durationMs: Date.now() - startedAt,
    };
  }

  // Build transition counts before issuing writes.
  const bucketTransitions: Record<string, number> = {};
  const statusTransitions: Record<string, number> = {};
  const changedLoanIds: number[] = [];
  for (const row of changedRows) {
    const loanId = Number(row[0]);
    const oldStatus = String(row[1]);
    const oldBucket = String(row[2]);
    const newStatus = String(row[5]);
    const newBucket = String(row[6]);
    const newStage = Number(row[7]);

    // Validate output state — bug surface if our SQL diverges from VALID_STATES.
    assertValidLoanState(newStatus, newBucket, newStage);

    if (oldBucket !== newBucket) {
      const k = `${oldBucket}→${newBucket}`;
      bucketTransitions[k] = (bucketTransitions[k] ?? 0) + 1;
    }
    if (oldStatus !== newStatus) {
      const k = `${oldStatus}→${newStatus}`;
      statusTransitions[k] = (statusTransitions[k] ?? 0) + 1;
    }
    changedLoanIds.push(loanId);
  }

  // Override dedup: remove any prior __live row for these loans before
  // inserting the new state. Chunked to keep IN-list reasonable.
  const CHUNK = 1000;
  for (let i = 0; i < changedLoanIds.length; i += CHUNK) {
    const ids = changedLoanIds.slice(i, i + CHUNK).join(",");
    await conn.run(`DELETE FROM raw_loans__live WHERE loan_id IN (${ids})`);
  }

  // Now write the new state. We re-read raw_loans (which currently sees seed
  // for all changed loans, since we just deleted their overrides) joined to
  // the same recomputed CTE. Full 20-column schema mirror.
  const cols = LOAN_COLUMNS.join(", ");
  for (let i = 0; i < changedLoanIds.length; i += CHUNK) {
    const ids = changedLoanIds.slice(i, i + CHUNK).join(",");
    await conn.run(`
      INSERT INTO raw_loans__live (${cols})
      WITH unpaid AS (
        SELECT
          loan_id,
          MIN(due_date)                 AS oldest_unpaid_due,
          SUM(amount_due - amount_paid) AS overdue_total
        FROM raw_emi_payments
        WHERE amount_paid < amount_due
        GROUP BY loan_id
      ),
      derived AS (
        SELECT
          l.*,
          DATE_DIFF('day', u.oldest_unpaid_due, DATE '${todayStr}') AS new_dpd,
          u.overdue_total                                            AS new_overdue
        FROM raw_loans l
        JOIN unpaid u USING (loan_id)
        WHERE l.loan_id IN (${ids})
      ),
      final AS (
        SELECT
          d.*,
          CASE
            WHEN new_dpd <= 0   THEN 'sma_0'
            WHEN new_dpd <= 30  THEN 'sma_1'
            WHEN new_dpd <= 60  THEN 'sma_2'
            WHEN new_dpd <= 180 THEN 'npa_90'
            WHEN new_dpd <= 360 THEN 'npa_180'
            ELSE 'npa_360_plus'
          END AS computed_bucket
        FROM derived d
      )
      SELECT
        loan_id, borrower_id, branch_id, entity, product_type, disbursement_date,
        sanctioned_amount, disbursed_amount, interest_rate, tenure_months, emi_amount,
        ltv_ratio, property_value, sourcing_channel, co_lending_partner,
        CASE
          WHEN loan_status = 'active' AND new_dpd >= 90 THEN 'npa'
          ELSE loan_status
        END AS loan_status,
        computed_bucket AS dpd_bucket,
        CASE
          WHEN computed_bucket IN ('current','sma_0','sma_1') THEN 1
          WHEN computed_bucket = 'sma_2'                       THEN 2
          ELSE 3
        END AS stage,
        new_overdue AS overdue_amount,
        last_payment_date
      FROM final
    `);
  }

  return {
    loansEvaluated: changedLoanIds.length,
    loansMutated: changedLoanIds.length,
    bucketTransitions,
    statusTransitions,
    durationMs: Date.now() - startedAt,
  };
}
