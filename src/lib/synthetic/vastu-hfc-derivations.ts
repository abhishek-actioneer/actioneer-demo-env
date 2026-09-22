/**
 * Derivations for vastu-hfc — everything that doesn't generate independently.
 *
 * Each function is calendar-aware: month-end, FY-quarter-end, and quarterly
 * assignment date checks are inside the function so the orchestrator can call
 * them unconditionally and they no-op when not applicable.
 *
 * Pipeline order (enforced by orchestrator in tick.ts):
 *
 *   Pass A: applyDailyAgeing (loan-ageing.ts)              — age unpaid prior EMIs
 *   Pass B: applyDailyBorrowingsAmortization               — borrowings outstanding draws down
 *   Pass C: applyDailyEmployeeAttrition                    — flips is_active=false
 *   Pass D: generators (branches, borrowers, employees, borrowings, loans)
 *   Pass E: emitDailyEmis                                  — walk loan book, emit due EMIs
 *   Pass F: applyDailyAgeing AGAIN                          — recompute state after EMIs
 *   Pass G: emitDailyCollectionsActions                    — derived from late EMIs in this tick
 *   Pass H (calendar-gated):
 *     - emitMonthEndProvisions                              — last day of synthetic month
 *     - applyMonthEndWriteOffs                              — last day of synthetic month
 *     - emitQuarterEndAssignments                           — Mar/Jun/Sep/Dec 15
 *     - emitQuarterEndNpaMovement                           — last day of FY quarter
 *
 * Calendar rules
 * --------------
 * Month-end:    today's day == last day of month
 * Q-end:        today's day == last day of FY-quarter month (Mar/Jun/Sep/Dec)
 * Assignment:   today is exactly the 15th of Mar/Jun/Sep/Dec
 *
 * Each derivation returns the count of rows inserted/updated for tick telemetry.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { createRng, type Rng } from "./rng";
import { sqlLiteral } from "./generators";
import { validateLoanState, type DpdBucket } from "./loan-ageing";

// ────────────────────────────────────────────────────────────────────────────
// Constants and catalogs
// ────────────────────────────────────────────────────────────────────────────

const PCR_STAGE_1 = 0.005; // 0.5% standard provision
const PCR_STAGE_2 = 0.15;
const PCR_STAGE_3 = 0.35;

// Per-tick prepayment probability per active loan (back-solved from seed:
// 4,588 prepaid / 187K seed loans / ~36 months ≈ 0.07%/month → 0.0023%/day).
const PREPAY_DAILY_PROB = 0.000023;

// Per-tick write-off probability for npa_360_plus loans (rare, monthly pass).
// 28 written_off / 187K / 36 months ≈ 0.04%/month for the eligible pool.
const WRITEOFF_MONTHLY_PROB = 0.0004;

// Daily attrition rates by employee function_type. Monthly rates from industry
// norms for NBFC field staff, divided by 30.
const ATTRITION_DAILY: Record<string, number> = {
  collections: 0.0007,    // 2.0%/month
  sales: 0.0005,          // 1.5%/month
  operations: 0.00027,    // 0.8%/month
  credit: 0.00027,
  legal_technical: 0.00027,
  ho: 0.00020,            // 0.6%/month — head office is stickier
};

// Action type → (DPD floor, weight) for collections actions.
const ACTION_TYPE_BY_DPD = [
  { type: "sms_reminder",  dpdFloor: 30,  weight: 15 },
  { type: "call",          dpdFloor: 30,  weight: 30 },
  { type: "field_visit",   dpdFloor: 30,  weight: 20 },
  { type: "demand_notice", dpdFloor: 60,  weight: 18 },
  { type: "legal_notice",  dpdFloor: 90,  weight: 12 },
  { type: "sarfaesi",      dpdFloor: 90,  weight:  5 },
];

// Observed (action, result) joint distribution from seed.
const ACTION_RESULT_WEIGHTS: Record<string, { value: string; weight: number }[]> = {
  call:          [{ value: "no_contact", weight: 31 }, { value: "promise_to_pay", weight: 26 }, { value: "partial_payment", weight: 14 }, { value: "dispute", weight: 10 }, { value: "escalated", weight: 9 },  { value: "resolved", weight: 10 }],
  sms_reminder:  [{ value: "no_contact", weight: 31 }, { value: "promise_to_pay", weight: 25 }, { value: "partial_payment", weight: 15 }, { value: "dispute", weight:  9 }, { value: "escalated", weight: 10 }, { value: "resolved", weight: 10 }],
  field_visit:   [{ value: "no_contact", weight: 29 }, { value: "promise_to_pay", weight: 25 }, { value: "partial_payment", weight: 15 }, { value: "dispute", weight: 10 }, { value: "escalated", weight: 10 }, { value: "resolved", weight: 11 }],
  demand_notice: [{ value: "no_contact", weight: 30 }, { value: "promise_to_pay", weight: 24 }, { value: "partial_payment", weight: 15 }, { value: "dispute", weight:  9 }, { value: "escalated", weight: 11 }, { value: "resolved", weight: 11 }],
  legal_notice:  [{ value: "no_contact", weight: 30 }, { value: "promise_to_pay", weight: 24 }, { value: "partial_payment", weight: 16 }, { value: "dispute", weight:  9 }, { value: "escalated", weight: 11 }, { value: "resolved", weight: 10 }],
  sarfaesi:      [{ value: "no_contact", weight: 30 }, { value: "promise_to_pay", weight: 27 }, { value: "partial_payment", weight: 14 }, { value: "dispute", weight: 10 }, { value: "escalated", weight: 10 }, { value: "resolved", weight:  9 }],
};

// Payment mode distribution (when paid).
const PAYMENT_MODE_WEIGHTS = [
  { value: "nach",   weight: 55 },
  { value: "upi",    weight: 20 },
  { value: "cash",   weight: 15 },
  { value: "cheque", weight:  5 },
  { value: "neft",   weight:  5 },
];

// Assignment buyer rotation.
const ASSIGNMENT_BUYERS = [
  { name: "State Bank of India",         type: "bank", mrr: 10 },
  { name: "HDFC Bank",                   type: "bank", mrr: 10 },
  { name: "ICICI Bank",                  type: "bank", mrr: 10 },
  { name: "Bank of Baroda",              type: "bank", mrr: 10 },
  { name: "Asset Reconstruction Company", type: "arc", mrr:  0 },
];

// Approximate LIVE EMI count per active loan that passes the per-loan ageing
// model. Per-bucket outcome distributions: rows are current bucket, cells
// are outcome probabilities. Sums to 1.00 per row.
//
//   outcome legend:
//     on_time → paid_date = due+0..3 days, amount=full, dpd_at_payment=0
//     late_30 → paid_date = due+1..30,   amount=full, bucket=1_30
//     late_60 → paid_date = due+31..60,  amount=full, bucket=31_60
//     late_90 → paid_date = due+61..90,  amount=full, bucket=61_90
//     unpaid  → paid_date = NULL, amount=0, bucket=90_plus, dpd computed in ageing
const EMI_OUTCOME_BY_BUCKET: Record<DpdBucket, { value: string; weight: number }[]> = {
  current:       [{ value: "on_time", weight: 95 }, { value: "late_30", weight:  4 }, { value: "late_60", weight:  1 }, { value: "late_90", weight: 0 }, { value: "unpaid", weight:  0 }],
  sma_0:         [{ value: "on_time", weight: 90 }, { value: "late_30", weight:  9 }, { value: "late_60", weight:  1 }, { value: "late_90", weight: 0 }, { value: "unpaid", weight:  0 }],
  sma_1:         [{ value: "on_time", weight: 60 }, { value: "late_30", weight: 30 }, { value: "late_60", weight:  8 }, { value: "late_90", weight: 1 }, { value: "unpaid", weight:  1 }],
  sma_2:         [{ value: "on_time", weight: 40 }, { value: "late_30", weight: 30 }, { value: "late_60", weight: 22 }, { value: "late_90", weight: 6 }, { value: "unpaid", weight:  2 }],
  npa_90:        [{ value: "on_time", weight: 25 }, { value: "late_30", weight: 20 }, { value: "late_60", weight: 20 }, { value: "late_90", weight: 15 }, { value: "unpaid", weight: 20 }],
  npa_180:       [{ value: "on_time", weight: 15 }, { value: "late_30", weight: 15 }, { value: "late_60", weight: 15 }, { value: "late_90", weight: 15 }, { value: "unpaid", weight: 40 }],
  npa_360_plus:  [{ value: "on_time", weight: 10 }, { value: "late_30", weight: 10 }, { value: "late_60", weight: 10 }, { value: "late_90", weight: 10 }, { value: "unpaid", weight: 60 }],
};

// ────────────────────────────────────────────────────────────────────────────
// Calendar helpers
// ────────────────────────────────────────────────────────────────────────────

function isMonthEnd(d: Date): boolean {
  const next = new Date(d);
  next.setUTCDate(d.getUTCDate() + 1);
  return next.getUTCMonth() !== d.getUTCMonth();
}

function isFyQuarterEnd(d: Date): boolean {
  const month = d.getUTCMonth() + 1;
  return isMonthEnd(d) && (month === 3 || month === 6 || month === 9 || month === 12);
}

function isAssignmentDay(d: Date): boolean {
  const month = d.getUTCMonth() + 1;
  return d.getUTCDate() === 15 && (month === 3 || month === 6 || month === 9 || month === 12);
}

function fyQuarterLabel(d: Date): string {
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  // Indian FY: Apr-Mar. Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.
  let q: number, fyEndYear: number;
  if (month >= 4 && month <= 6)        { q = 1; fyEndYear = year + 1; }
  else if (month >= 7 && month <= 9)   { q = 2; fyEndYear = year + 1; }
  else if (month >= 10 && month <= 12) { q = 3; fyEndYear = year + 1; }
  else                                  { q = 4; fyEndYear = year; }
  const fy = String(fyEndYear).slice(2);
  return `FY${fy}-Q${q}`;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pickWeighted<T>(rng: Rng, items: { value: T; weight: number }[]): T {
  return rng.weighted(items);
}

async function chunkInsert(
  conn: DuckDBConnection,
  table: string,
  columns: string,
  valueRows: string[],
): Promise<number> {
  if (valueRows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    await conn.run(`INSERT INTO ${table} (${columns}) VALUES ${chunk.join(", ")}`);
    inserted += chunk.length;
  }
  return inserted;
}

async function nextIdStart(
  conn: DuckDBConnection,
  table: string,
  idColumn: string,
  seedFloor: number,
): Promise<number> {
  const r = await conn.run(`SELECT COALESCE(MAX(${idColumn}), 0) FROM ${table}`);
  const currentMax = Number((await r.getRows())[0][0]);
  return Math.max(seedFloor, currentMax + 1);
}

// ────────────────────────────────────────────────────────────────────────────
// Pass B: Borrowings amortization
// ────────────────────────────────────────────────────────────────────────────

/**
 * Daily amortization on every active borrowing.
 * outstanding_amount_cr -= sanctioned/(tenure_months) per period.
 * The per-period decrement applies on payment-frequency days; for simplicity
 * we approximate as: outstanding -= sanctioned / total_periods every day,
 * scaled to daily fraction. Sets to 0 when maturity_date <= today.
 *
 * Override pattern: writes new rows to raw_borrowings__live, deduping prior overrides.
 */
export async function applyDailyBorrowingsAmortization(
  conn: DuckDBConnection,
  today: Date,
): Promise<number> {
  const todayStr = formatDate(today);

  // Fetch all currently-outstanding borrowings (outstanding > 0).
  const r = await conn.run(`
    SELECT borrowing_id, source_type, lender_name, sanctioned_amount_cr,
           outstanding_amount_cr, interest_rate, start_date, maturity_date,
           is_fixed_rate, repayment_frequency
    FROM raw_borrowings
    WHERE outstanding_amount_cr > 0
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const idsToUpdate: number[] = [];
  const newRows: string[] = [];

  for (const row of rows) {
    const borrowingId = Number(row[0]);
    const sourceType = String(row[1]);
    const lenderName = String(row[2]);
    const sanctioned = Number(row[3]);
    let outstanding = Number(row[4]);
    const interestRate = Number(row[5]);
    const startDate = String(row[6]).slice(0, 10);
    const maturityDate = String(row[7]).slice(0, 10);
    const isFixedRate = String(row[8]) === "true";
    const repaymentFreq = String(row[9]);

    // Estimate total tenure days from start to maturity.
    const tenureDays = Math.max(
      30,
      Math.round((new Date(maturityDate).getTime() - new Date(startDate).getTime()) / 86_400_000),
    );

    // Per-day amortization = sanctioned / tenureDays.
    const dailyDraw = sanctioned / tenureDays;

    if (today >= new Date(maturityDate)) {
      outstanding = 0;
    } else {
      outstanding = Math.max(0, outstanding - dailyDraw);
    }
    outstanding = Math.round(outstanding * 100) / 100;

    idsToUpdate.push(borrowingId);
    newRows.push(`(${borrowingId}, ${sqlLiteral(sourceType)}, ${sqlLiteral(lenderName)}, ${sanctioned}, ${outstanding}, ${interestRate}, '${startDate}', '${maturityDate}', ${isFixedRate ? "true" : "false"}, ${sqlLiteral(repaymentFreq)})`);
  }

  // Override dedup: remove prior __live rows for these borrowings.
  const CHUNK = 1000;
  for (let i = 0; i < idsToUpdate.length; i += CHUNK) {
    const ids = idsToUpdate.slice(i, i + CHUNK).join(",");
    await conn.run(`DELETE FROM raw_borrowings__live WHERE borrowing_id IN (${ids})`);
  }

  const cols = "borrowing_id, source_type, lender_name, sanctioned_amount_cr, outstanding_amount_cr, interest_rate, start_date, maturity_date, is_fixed_rate, repayment_frequency";
  return chunkInsert(conn, "raw_borrowings__live", cols, newRows);
  void todayStr; // todayStr used in header comment only; suppress unused
}

// ────────────────────────────────────────────────────────────────────────────
// Pass C: Employee attrition
// ────────────────────────────────────────────────────────────────────────────

/**
 * Daily attrition pass. For each active employee, roll a per-function daily
 * probability of leaving. If attriting, write override row with is_active=false.
 *
 * Function-specific monthly rates (collections 2.0%, sales 1.5%, others 0.8%,
 * ho 0.6%) divided by 30 → daily probabilities.
 */
export async function applyDailyEmployeeAttrition(
  conn: DuckDBConnection,
  today: Date,
  seed: number,
): Promise<number> {
  const rng = createRng(seed);

  const r = await conn.run(`
    SELECT employee_id, branch_id, function_type, join_date, gender, age, annual_ctc_lakh
    FROM raw_employees WHERE is_active = true
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const idsToFlip: number[] = [];
  const newRows: string[] = [];

  for (const row of rows) {
    const fn = String(row[2]);
    const dailyP = ATTRITION_DAILY[fn] ?? 0.00027;
    if (!rng.bool(dailyP)) continue;

    const empId = Number(row[0]);
    const branchId = Number(row[1]);
    const joinDate = String(row[3]).slice(0, 10);
    const gender = String(row[4]);
    const age = Number(row[5]);
    const ctc = Number(row[6]);

    idsToFlip.push(empId);
    newRows.push(`(${empId}, ${branchId}, ${sqlLiteral(fn)}, '${joinDate}', ${sqlLiteral(gender)}, ${age}, ${ctc}, false)`);
  }

  if (idsToFlip.length === 0) return 0;

  const CHUNK = 1000;
  for (let i = 0; i < idsToFlip.length; i += CHUNK) {
    const ids = idsToFlip.slice(i, i + CHUNK).join(",");
    await conn.run(`DELETE FROM raw_employees__live WHERE employee_id IN (${ids})`);
  }

  const cols = "employee_id, branch_id, function_type, join_date, gender, age, annual_ctc_lakh, is_active";
  return chunkInsert(conn, "raw_employees__live", cols, newRows);
  void today;
}

// ────────────────────────────────────────────────────────────────────────────
// Pass E: Daily EMI emission
// ────────────────────────────────────────────────────────────────────────────

export interface EmiEmissionResult {
  inserted: number;
  byOutcome: Record<string, number>;
}

/**
 * Walk the loan book and emit one EMI per active+npa loan whose next
 * scheduled due_date == today. The "next due_date" is computed as
 * MAX(due_date) per loan + 1 month, or disbursement_date + 1 month for loans
 * with no EMI history yet. Loans whose paid-EMI count >= tenure_months are
 * skipped (loan should transition to closed via separate logic).
 *
 * Per-EMI outcome decided by the loan's CURRENT dpd_bucket (Markov chain).
 * Outcomes:
 *   on_time → amount_paid=full,  paid_date=due+0..3,  bucket='on_time'
 *   late_30 → amount_paid=full,  paid_date=due+1..30, bucket='1_30'
 *   late_60 → amount_paid=full,  paid_date=due+31..60, bucket='31_60'
 *   late_90 → amount_paid=full,  paid_date=due+61..90, bucket='61_90'
 *   unpaid  → amount_paid=0,     paid_date=NULL,       bucket='90_plus'
 *
 * For "late_*" outcomes we still emit at the actual paid_date. If paid_date
 * is in the future relative to today, we still record it — DuckDB doesn't
 * care, and historical analysis treats due_date as the canonical event date.
 *
 * Strict invariants:
 *   - paid_date IS NULL ⇔ amount_paid=0
 *   - bucket deterministic from dpd_at_payment
 */
export async function emitDailyEmis(
  conn: DuckDBConnection,
  today: Date,
  seed: number,
): Promise<EmiEmissionResult> {
  const todayStr = formatDate(today);
  const rng = createRng(seed);

  // Disbursement-anchored EMI scheduling.
  //
  // Each loan's monthly EMI is due on the day-of-month matching its
  // disbursement_date.day. Today's eligible loans are:
  //
  //   - status active|npa
  //   - today.day_of_month == disbursement_date.day_of_month
  //   - emis_so_far (paid + unpaid recorded) < tenure_months   [haven't reached end]
  //   - emis_so_far < expected_through_today                   [behind schedule]
  //
  // The third clause catches up loans whose seed EMI history was truncated
  // (seed caps at ~18 months back) without emitting a flood: at most one
  // EMI per loan per tick day. Day-of-month edge cases (29-31 in shorter
  // months) skip naturally — that month's EMI is missed, which is fine for
  // synthesis quality and matches occasional real-world skip behavior.
  const r = await conn.run(`
    WITH emi_count AS (
      SELECT loan_id, COUNT(*) AS emis_so_far
      FROM raw_emi_payments GROUP BY loan_id
    )
    SELECT
      l.loan_id, l.emi_amount, l.dpd_bucket, l.tenure_months,
      COALESCE(c.emis_so_far, 0) AS emis_so_far
    FROM raw_loans l
    LEFT JOIN emi_count c USING (loan_id)
    WHERE l.loan_status IN ('active', 'npa')
      AND EXTRACT(DAY FROM l.disbursement_date::DATE) = EXTRACT(DAY FROM DATE '${todayStr}')
      AND COALESCE(c.emis_so_far, 0) < l.tenure_months
      AND COALESCE(c.emis_so_far, 0) < DATE_DIFF('month', l.disbursement_date::DATE, DATE '${todayStr}')
  `);
  const dueLoans = await r.getRows();
  if (dueLoans.length === 0) {
    return { inserted: 0, byOutcome: {} };
  }

  const startId = await nextIdStart(conn, "raw_emi_payments__live", "payment_id", 2_000_000);
  const valueRows: string[] = [];
  const byOutcome: Record<string, number> = {};

  for (let i = 0; i < dueLoans.length; i++) {
    const loanId = Number(dueLoans[i][0]);
    const emiAmount = Number(dueLoans[i][1]);
    const currentBucket = String(dueLoans[i][2]) as DpdBucket;

    const outcomeWeights = EMI_OUTCOME_BY_BUCKET[currentBucket] ?? EMI_OUTCOME_BY_BUCKET.current;
    const outcome = pickWeighted(rng, outcomeWeights);
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;

    let paidDate: string | null = null;
    let amountPaid = 0;
    let dpd = 0;
    let bucket = "on_time";

    switch (outcome) {
      case "on_time":
        dpd = rng.int(0, 3);
        paidDate = formatDate(new Date(today.getTime() + dpd * 86_400_000));
        amountPaid = emiAmount;
        bucket = "on_time";
        break;
      case "late_30":
        dpd = rng.int(1, 30);
        paidDate = formatDate(new Date(today.getTime() + dpd * 86_400_000));
        amountPaid = emiAmount;
        bucket = "1_30";
        break;
      case "late_60":
        dpd = rng.int(31, 60);
        paidDate = formatDate(new Date(today.getTime() + dpd * 86_400_000));
        amountPaid = emiAmount;
        bucket = "31_60";
        break;
      case "late_90":
        dpd = rng.int(61, 90);
        paidDate = formatDate(new Date(today.getTime() + dpd * 86_400_000));
        amountPaid = emiAmount;
        bucket = "61_90";
        break;
      case "unpaid":
        // Running DPD computed by ageing pass. For the EMI row, dpd_at_payment
        // captures the point-in-time where it stopped accruing. Use a high value
        // to mark severe distress at emission time; downstream queries should
        // join to running state via the loan's bucket if they need real DPD.
        paidDate = null;
        amountPaid = 0;
        dpd = 91; // placeholder DPD floor for 90_plus bucket
        bucket = "90_plus";
        break;
    }

    const paymentMode = amountPaid > 0 ? pickWeighted(rng, PAYMENT_MODE_WEIGHTS) : "nach";
    const bounce = bucket === "on_time" ? "false" : "true";
    const paymentId = startId + i;

    valueRows.push(
      `(${paymentId}, ${loanId}, '${todayStr}', ${emiAmount}, ${amountPaid}, ${paidDate ? `'${paidDate}'` : "NULL"}, '${paymentMode}', ${bounce}, ${dpd}, '${bucket}')`,
    );
  }

  const cols = "payment_id, loan_id, due_date, amount_due, amount_paid, paid_date, payment_mode, bounce, dpd_at_payment, collection_bucket";
  const inserted = await chunkInsert(conn, "raw_emi_payments__live", cols, valueRows);

  return { inserted, byOutcome };
}

// ────────────────────────────────────────────────────────────────────────────
// Pass G: Collections actions for late EMIs
// ────────────────────────────────────────────────────────────────────────────

/**
 * Emit collections actions for loans whose state warrants a follow-up TODAY.
 *
 * Strategy: for each active+npa loan with running_dpd >= 30, emit ~0-1 action
 * with daily probability ramping by DPD severity. Calibrated against seed:
 * 19K total actions / 36 months ≈ 528/month, ~7,500 eligible loans → 0.23%/day
 * average. Cap at 1%/day to avoid overshoot at extreme DPD.
 *
 * Action_type sampled from action types whose dpdFloor <= running_dpd
 * (sarfaesi only at 90+ DPD). Result from observed (action, result) joint
 * distribution.
 */
export async function emitDailyCollectionsActions(
  conn: DuckDBConnection,
  today: Date,
  seed: number,
): Promise<number> {
  const todayStr = formatDate(today);
  const rng = createRng(seed);

  // Loans with truly unpaid EMIs (paid_date NULL AND amount_paid=0). This
  // tightens the pool from ~58K (any shortfall, including 1-rupee partials)
  // to ~15K (genuinely missed EMIs) — matching what a real collections team
  // would actually pursue.
  const r = await conn.run(`
    WITH unpaid AS (
      SELECT loan_id, MIN(due_date) AS oldest_due
      FROM raw_emi_payments
      WHERE amount_paid = 0 AND paid_date IS NULL
      GROUP BY loan_id
    )
    SELECT
      l.loan_id, l.branch_id,
      DATE_DIFF('day', u.oldest_due, DATE '${todayStr}') AS running_dpd
    FROM raw_loans l JOIN unpaid u USING (loan_id)
    WHERE l.loan_status IN ('active','npa')
      AND DATE_DIFF('day', u.oldest_due, DATE '${todayStr}') >= 30
  `);
  const eligible = await r.getRows();
  if (eligible.length === 0) return 0;

  // Active collection agents (employee_id pool).
  const agentR = await conn.run(`
    SELECT employee_id FROM raw_employees
    WHERE is_active = true AND function_type = 'collections'
  `);
  const agents = (await agentR.getRows()).map((row) => Number(row[0]));
  if (agents.length === 0) return 0;

  const startId = await nextIdStart(conn, "raw_collections_actions__live", "action_id", 100_000);
  const valueRows: string[] = [];
  let counter = 0;

  for (const row of eligible) {
    const loanId = Number(row[0]);
    const branchId = Number(row[1]);
    const dpd = Number(row[2]);
    // Calibrated against seed: 19K actions / 36 months ≈ 528/month, against
    // ~15K truly-unpaid loans (post-pool-tightening). Target avg 0.12%/day.
    const dailyP = Math.min(0.002, Math.max(0.00005, dpd / 100000));
    if (!rng.bool(dailyP)) continue;

    const eligibleActions = ACTION_TYPE_BY_DPD.filter((a) => a.dpdFloor <= dpd);
    if (eligibleActions.length === 0) continue;
    const action = pickWeighted(rng, eligibleActions.map((a) => ({ value: a.type, weight: a.weight })));

    const result = pickWeighted(rng, ACTION_RESULT_WEIGHTS[action]);
    const agentId = agents[rng.int(0, agents.length - 1)];

    valueRows.push(`(${startId + counter}, ${loanId}, '${todayStr}', '${action}', ${dpd}, '${result}', ${agentId}, ${branchId})`);
    counter++;
  }

  const cols = "action_id, loan_id, action_date, action_type, dpd_at_action, result, agent_id, branch_id";
  return chunkInsert(conn, "raw_collections_actions__live", cols, valueRows);
}

// ────────────────────────────────────────────────────────────────────────────
// Pass H: Calendar-gated derivations (month-end / quarter-end / assignments)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Emit one month-end provisions snapshot per entity (2 rows total).
 * No-op unless today is the last day of the synthetic month.
 *
 * Schema: month, entity, stage_1_exposure_cr, stage_2_exposure_cr,
 * stage_3_exposure_cr, stage_1_provision_cr, stage_2_provision_cr,
 * stage_3_provision_cr, pcr_stage_1, pcr_stage_2, pcr_stage_3,
 * total_ecl_cr, write_offs_cr, recoveries_cr.
 */
export async function emitMonthEndProvisions(
  conn: DuckDBConnection,
  today: Date,
): Promise<number> {
  if (!isMonthEnd(today)) return 0;
  const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;

  // Stage exposures by entity from the active loan book (active|npa only).
  const r = await conn.run(`
    SELECT entity, stage,
           SUM(disbursed_amount) / 1.0e7 AS exposure_cr
    FROM raw_loans
    WHERE loan_status IN ('active','npa')
    GROUP BY 1, 2
  `);
  const stageRows = await r.getRows();

  const exposureByEntity: Record<string, { 1: number; 2: number; 3: number }> = {
    hfc: { 1: 0, 2: 0, 3: 0 },
    finserve: { 1: 0, 2: 0, 3: 0 },
  };
  for (const row of stageRows) {
    const ent = String(row[0]);
    const st = Number(row[1]) as 1 | 2 | 3;
    if (!exposureByEntity[ent]) continue;
    exposureByEntity[ent][st] = Math.round(Number(row[2]) * 100) / 100;
  }

  // Write-offs THIS month: loans whose status transitioned to written_off
  // in the current month. We approximate by the live shard: written_off rows
  // in __live whose last_payment_date falls in this month. (Override pattern
  // doesn't carry a transition timestamp; this is a heuristic.)
  // Recoveries: small fraction of stage_3 exposure recovered (~0.5%).
  const writeOffR = await conn.run(`
    SELECT entity, SUM(disbursed_amount) / 1.0e7
    FROM raw_loans__live
    WHERE loan_status = 'written_off'
      AND last_payment_date >= DATE '${monthStart}'
      AND last_payment_date <= DATE '${formatDate(today)}'
    GROUP BY entity
  `);
  const writeOffsByEntity: Record<string, number> = { hfc: 0, finserve: 0 };
  for (const row of await writeOffR.getRows()) {
    writeOffsByEntity[String(row[0])] = Math.round(Number(row[1]) * 100) / 100;
  }

  const valueRows: string[] = [];
  for (const entity of ["hfc", "finserve"]) {
    const e = exposureByEntity[entity];
    const s1Prov = Math.round(e[1] * PCR_STAGE_1 * 100) / 100;
    const s2Prov = Math.round(e[2] * PCR_STAGE_2 * 100) / 100;
    const s3Prov = Math.round(e[3] * PCR_STAGE_3 * 100) / 100;
    const totalEcl = Math.round((s1Prov + s2Prov + s3Prov) * 100) / 100;
    const writeOffs = writeOffsByEntity[entity] ?? 0;
    const recoveries = Math.round(e[3] * 0.005 * 100) / 100;
    valueRows.push(
      `('${monthStart}', '${entity}', ${e[1]}, ${e[2]}, ${e[3]}, ${s1Prov}, ${s2Prov}, ${s3Prov}, 0.5, 15, 35, ${totalEcl}, ${writeOffs}, ${recoveries})`,
    );
  }

  const cols = "month, entity, stage_1_exposure_cr, stage_2_exposure_cr, stage_3_exposure_cr, stage_1_provision_cr, stage_2_provision_cr, stage_3_provision_cr, pcr_stage_1, pcr_stage_2, pcr_stage_3, total_ecl_cr, write_offs_cr, recoveries_cr";
  return chunkInsert(conn, "raw_provisions__live", cols, valueRows);
}

/**
 * Apply rare write-offs to npa_360_plus loans on month-end. Probabilistic per
 * eligible loan (~0.04%/month). Sets status='written_off' (bucket and stage
 * unchanged at npa_360_plus / 3 — that's the single valid terminal tuple).
 */
export async function applyMonthEndWriteOffs(
  conn: DuckDBConnection,
  today: Date,
  seed: number,
): Promise<number> {
  if (!isMonthEnd(today)) return 0;
  const rng = createRng(seed);

  const r = await conn.run(`
    SELECT loan_id FROM raw_loans
    WHERE loan_status = 'npa' AND dpd_bucket = 'npa_360_plus'
  `);
  const eligible = (await r.getRows()).map((row) => Number(row[0]));
  if (eligible.length === 0) return 0;

  const todayStr = formatDate(today);
  const toWriteOff: number[] = [];
  for (const id of eligible) {
    if (rng.bool(WRITEOFF_MONTHLY_PROB)) toWriteOff.push(id);
  }
  if (toWriteOff.length === 0) return 0;

  // For each, fetch full row + UPDATE via override pattern.
  const idList = toWriteOff.join(",");
  await conn.run(`DELETE FROM raw_loans__live WHERE loan_id IN (${idList})`);
  await conn.run(`
    INSERT INTO raw_loans__live
    SELECT
      loan_id, borrower_id, branch_id, entity, product_type, disbursement_date,
      sanctioned_amount, disbursed_amount, interest_rate, tenure_months, emi_amount,
      ltv_ratio, property_value, sourcing_channel, co_lending_partner,
      'written_off' AS loan_status,
      'npa_360_plus' AS dpd_bucket,
      3 AS stage,
      overdue_amount,
      DATE '${todayStr}' AS last_payment_date
    FROM raw_loans
    WHERE loan_id IN (${idList})
  `);

  // Validate output state.
  for (const _ of toWriteOff) {
    if (!validateLoanState("written_off", "npa_360_plus", 3)) {
      throw new Error("write-off produced invalid state");
    }
  }
  return toWriteOff.length;
}

/**
 * Quarterly batch sale of NPA loans to ARC/banks.
 * No-op unless today is exactly Mar/Jun/Sep/Dec 15.
 *
 * Picks ~1,500 loans from the npa_90/180/360_plus pool (target — actual count
 * depends on pool size at this date). Flips status='assigned' with bucket
 * RESET to 'current' and stage=1 (matches seed pattern). Writes one
 * assignment row aggregating the batch.
 */
export async function emitQuarterEndAssignments(
  conn: DuckDBConnection,
  today: Date,
  seed: number,
): Promise<number> {
  if (!isAssignmentDay(today)) return 0;
  const rng = createRng(seed);
  const todayStr = formatDate(today);

  // Eligible pool: loans currently in npa state.
  const r = await conn.run(`
    SELECT loan_id, disbursed_amount, ltv_ratio, tenure_months, disbursement_date
    FROM raw_loans
    WHERE loan_status = 'npa'
    ORDER BY hash(loan_id * ${seed})
    LIMIT 1500
  `);
  const pool = await r.getRows();
  if (pool.length === 0) return 0;

  const buyer = ASSIGNMENT_BUYERS[rng.int(0, ASSIGNMENT_BUYERS.length - 1)];

  let totalDisbursed = 0;
  let totalLtv = 0;
  let totalResidual = 0;
  let totalHolding = 0;
  let count = 0;
  const idList: number[] = [];

  for (const row of pool) {
    const loanId = Number(row[0]);
    const disbursed = Number(row[1]);
    const ltv = Number(row[2]);
    const tenure = Number(row[3]);
    const disbursementDate = new Date(String(row[4]).slice(0, 10));
    const monthsHeld = Math.round(
      (today.getTime() - disbursementDate.getTime()) / (30 * 86_400_000),
    );
    const residual = Math.max(0, tenure - monthsHeld);
    totalDisbursed += disbursed;
    totalLtv += ltv * disbursed;
    totalResidual += residual * disbursed;
    totalHolding += monthsHeld * disbursed;
    count++;
    idList.push(loanId);
  }

  const amountAssigned = Math.round((totalDisbursed * 0.85) / 1e7 * 100) / 100; // 15% haircut, in crore
  const avgLtv = totalDisbursed > 0 ? Math.round((totalLtv / totalDisbursed) * 1000) / 1000 : 0;
  const wtdResidual = totalDisbursed > 0 ? Math.round(totalResidual / totalDisbursed) : 0;
  const wtdHolding = totalDisbursed > 0 ? Math.round(totalHolding / totalDisbursed) : 0;

  // Override loans → assigned/current/1.
  const ids = idList.join(",");
  await conn.run(`DELETE FROM raw_loans__live WHERE loan_id IN (${ids})`);
  await conn.run(`
    INSERT INTO raw_loans__live
    SELECT
      loan_id, borrower_id, branch_id, entity, product_type, disbursement_date,
      sanctioned_amount, disbursed_amount, interest_rate, tenure_months, emi_amount,
      ltv_ratio, property_value, sourcing_channel, co_lending_partner,
      'assigned' AS loan_status,
      'current' AS dpd_bucket,
      1 AS stage,
      0 AS overdue_amount,
      DATE '${todayStr}' AS last_payment_date
    FROM raw_loans
    WHERE loan_id IN (${ids})
  `);

  // Insert the batch row.
  const startId = await nextIdStart(conn, "raw_assignments__live", "assignment_id", 1_000);
  const cols = "assignment_id, transaction_date, buyer_type, buyer_name, loan_count, amount_assigned_cr, mrr_pct, avg_ltv, wtd_avg_residual_maturity_months, wtd_avg_holding_period_months";
  await conn.run(`
    INSERT INTO raw_assignments__live (${cols})
    VALUES (${startId}, '${todayStr}', '${buyer.type}', ${sqlLiteral(buyer.name)}, ${count}, ${amountAssigned}, ${buyer.mrr}, ${avgLtv}, ${wtdResidual}, ${wtdHolding})
  `);

  return count;
}

/**
 * FY-quarter end NPA movement snapshot, 2 rows (per entity).
 *
 * opening_gnpa_cr = previous quarter's closing for this entity (continuous chain).
 * additions_cr   = sum of disbursed/1cr for loans flipping into stage_3 in this quarter.
 * upgradations_cr = stage_3 → stage_1/2 movements (rare).
 * write_offs_cr  = sum from written_off this quarter.
 * recoveries_cr  = small fraction of stage_3 exposure (~0.6%).
 * closing        = opening + add - upgrade - writeoff - recoveries.
 * gnpa_pct       = closing / total_outstanding × 100.
 *
 * No-op unless today is Mar/Jun/Sep/Dec last day.
 */
export async function emitQuarterEndNpaMovement(
  conn: DuckDBConnection,
  today: Date,
): Promise<number> {
  if (!isFyQuarterEnd(today)) return 0;
  const quarter = fyQuarterLabel(today);

  // Total outstanding by entity (active|npa book) for gnpa_pct denominator.
  const totalR = await conn.run(`
    SELECT entity, SUM(disbursed_amount) / 1.0e7
    FROM raw_loans WHERE loan_status IN ('active','npa') GROUP BY 1
  `);
  const totalByEntity: Record<string, number> = { hfc: 0, finserve: 0 };
  for (const row of await totalR.getRows()) {
    totalByEntity[String(row[0])] = Number(row[1]);
  }

  // Current stage_3 exposure by entity.
  const npaR = await conn.run(`
    SELECT entity, SUM(disbursed_amount) / 1.0e7
    FROM raw_loans WHERE stage = 3 GROUP BY 1
  `);
  const npaByEntity: Record<string, number> = { hfc: 0, finserve: 0 };
  for (const row of await npaR.getRows()) {
    npaByEntity[String(row[0])] = Number(row[1]);
  }

  // Previous quarter's closing GNPA per entity from the most recent existing row.
  const prevR = await conn.run(`
    SELECT entity, closing_gnpa_cr
    FROM raw_npa_movement
    QUALIFY ROW_NUMBER() OVER (PARTITION BY entity ORDER BY quarter DESC) = 1
  `);
  const prevByEntity: Record<string, number> = { hfc: 0, finserve: 0 };
  for (const row of await prevR.getRows()) {
    prevByEntity[String(row[0])] = Number(row[1]);
  }

  const valueRows: string[] = [];
  for (const entity of ["hfc", "finserve"]) {
    const opening = prevByEntity[entity] ?? 0;
    const closing = Math.round((npaByEntity[entity] ?? 0) * 100) / 100;
    // Heuristic decomposition (we don't have transition history at quarter granularity):
    //   additions = max(0, closing - opening) + (recoveries + write_offs + upgradations)
    //   write_offs ≈ 0.10 of closing
    //   recoveries ≈ 0.06 of closing
    //   upgradations ≈ 0.05 of closing
    const writeOffs = Math.round(closing * 0.10 * 100) / 100;
    const recoveries = Math.round(closing * 0.06 * 100) / 100;
    const upgradations = Math.round(closing * 0.05 * 100) / 100;
    const additions = Math.round((closing - opening + writeOffs + recoveries + upgradations) * 100) / 100;
    const total = totalByEntity[entity] ?? 0;
    const gnpaPct = total > 0 ? Math.round((closing / total) * 10000) / 100 : 0;

    valueRows.push(
      `('${quarter}', '${entity}', ${opening}, ${Math.max(0, additions)}, ${upgradations}, ${writeOffs}, ${recoveries}, ${closing}, ${gnpaPct})`,
    );
  }

  const cols = "quarter, entity, opening_gnpa_cr, additions_cr, upgradations_cr, write_offs_cr, recoveries_cr, closing_gnpa_cr, gnpa_pct";
  return chunkInsert(conn, "raw_npa_movement__live", cols, valueRows);
}

// ────────────────────────────────────────────────────────────────────────────
// Loan transition: closed and prepaid (called from EMI emission completion)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect loans whose tenure has fully elapsed (final EMI was today's EMI)
 * and transition them to status='closed' with bucket='current', stage=1.
 *
 * Also rolls a daily prepayment probability per active loan; eligible loans
 * flip to status='prepaid' with bucket='current', stage=1, last_payment_date=today.
 */
export async function applyLoanCompletions(
  conn: DuckDBConnection,
  today: Date,
  seed: number,
): Promise<{ closed: number; prepaid: number }> {
  const todayStr = formatDate(today);
  const rng = createRng(seed);

  // Closures: loans whose paid EMI count >= tenure_months.
  const closeR = await conn.run(`
    WITH paid_count AS (
      SELECT loan_id, COUNT(*) AS paid_n
      FROM raw_emi_payments WHERE amount_paid >= amount_due GROUP BY loan_id
    )
    SELECT l.loan_id FROM raw_loans l
    JOIN paid_count p USING (loan_id)
    WHERE l.loan_status = 'active' AND p.paid_n >= l.tenure_months
  `);
  const toClose = (await closeR.getRows()).map((row) => Number(row[0]));

  // Prepayments: random sample of active|current|1 loans.
  const prepayR = await conn.run(`
    SELECT loan_id FROM raw_loans
    WHERE loan_status = 'active' AND dpd_bucket = 'current'
  `);
  const prepayPool = (await prepayR.getRows()).map((row) => Number(row[0]));
  const toPrepay: number[] = [];
  for (const id of prepayPool) {
    if (rng.bool(PREPAY_DAILY_PROB)) toPrepay.push(id);
  }

  const writeStatus = async (ids: number[], status: string): Promise<number> => {
    if (ids.length === 0) return 0;
    const list = ids.join(",");
    await conn.run(`DELETE FROM raw_loans__live WHERE loan_id IN (${list})`);
    await conn.run(`
      INSERT INTO raw_loans__live
      SELECT
        loan_id, borrower_id, branch_id, entity, product_type, disbursement_date,
        sanctioned_amount, disbursed_amount, interest_rate, tenure_months, emi_amount,
        ltv_ratio, property_value, sourcing_channel, co_lending_partner,
        '${status}' AS loan_status,
        'current' AS dpd_bucket,
        1 AS stage,
        0 AS overdue_amount,
        DATE '${todayStr}' AS last_payment_date
      FROM raw_loans
      WHERE loan_id IN (${list})
    `);
    return ids.length;
  };

  const closed = await writeStatus(toClose, "closed");
  const prepaid = await writeStatus(toPrepay, "prepaid");

  return { closed, prepaid };
}
