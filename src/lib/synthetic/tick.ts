/**
 * Tick handler — runs one synthetic day for a dataset.
 *
 * Day 1 scope: only handles `mode: "generate"` tables. Derived tables come Day 2.
 *
 * Pipeline:
 *   1. Read the synthetic_clock; bail if recently ticked (idempotency).
 *   2. For each table in plan order, generate rows and INSERT into <table>__live.
 *   3. Advance the clock by syntheticHoursPerTick.
 *   4. CHECKPOINT.
 *   5. Push the new "now" into the synchronous cache so prompt substitution sees it.
 *   6. Invalidate listed caches.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { withConnection } from "../db";
import { ensureClock, advanceClock, recordTickFailure } from "./clock";
import { ensureSyntheticInfrastructure, refreshSummaryTables } from "./infrastructure";
import { setNowCache } from "./now-cache";
import { getSyntheticPlan } from "./plans";
import { createRng, hashString } from "./rng";
import { generateValue, sampleTimestamps, sqlLiteral } from "./generators";
import type { GenContext } from "./generators";
import { invalidateCaches } from "./invalidate";
import { recordTickResult } from "./tick-history";
import { dailyVolume } from "./growth";
import {
  deriveBookingEconomics,
  derivePartnerShifts,
  deriveSurveys,
  deriveCommsSends,
  deriveAdMetrics,
  derivePartnerPayouts,
} from "./derivations";
import { applyDailyAgeing } from "./loan-ageing";
import {
  generateNewBorrowers,
  generateNewBranches,
  generateNewEmployees,
  generateNewBorrowings,
  generateNewLoans,
  deriveSeed,
} from "./vastu-hfc-generators";
import {
  applyDailyBorrowingsAmortization,
  applyDailyEmployeeAttrition,
  emitDailyEmis,
  emitDailyCollectionsActions,
  emitMonthEndProvisions,
  applyMonthEndWriteOffs,
  emitQuarterEndAssignments,
  emitQuarterEndNpaMovement,
  applyLoanCompletions,
} from "./vastu-hfc-derivations";
import type { TickResult, SyntheticPlan, TableSynthSpec } from "./types";

/** Skip a tick if the last successful one was less than this many hours ago. */
const IDEMPOTENCY_GUARD_HOURS = 12;

export interface RunTickOptions {
  /** When true, skips the idempotency check (used by burst/backfill). */
  force?: boolean;
  /**
   * When true, skips the summary table refresh inside this tick. Used by
   * the bulk backfill endpoint, which calls a single refresh at the end of
   * the run instead of paying the ~7-30s summary cost on every iteration.
   */
  skipSummaryRefresh?: boolean;
}

export async function runTick(
  datasetId: string,
  options: RunTickOptions = {},
): Promise<TickResult> {
  const plan = getSyntheticPlan(datasetId);
  const startedAt = new Date();
  const baseResult: Omit<TickResult, "status" | "syntheticNowAfter"> = {
    datasetId,
    startedAt: startedAt.toISOString(),
    completedAt: startedAt.toISOString(),
    durationMs: 0,
    syntheticNowBefore: "",
    rowsInserted: {},
  };

  if (!plan) {
    const r = { ...baseResult, status: "skipped" as const, reason: "no plan", syntheticNowAfter: "" };
    recordTickResult(r);
    return r;
  }
  if (!plan.enabled) {
    const r = { ...baseResult, status: "skipped" as const, reason: "plan disabled", syntheticNowAfter: "" };
    recordTickResult(r);
    return r;
  }

  try {
    return await withConnection(datasetId, async (conn) => {
      // Clock table must exist before infrastructure (dataset_now view depends
      // on synthetic_clock). Both are idempotent.
      await ensureClock(datasetId, conn);
      await ensureSyntheticInfrastructure(datasetId, conn);
      const clockBefore = await readClockRow(conn);

      // Idempotency guard
      if (!options.force && clockBefore.lastTickSucceededAt) {
        const hoursSince =
          (startedAt.getTime() - clockBefore.lastTickSucceededAt.getTime()) / (1000 * 60 * 60);
        if (hoursSince < IDEMPOTENCY_GUARD_HOURS) {
          const skipped: TickResult = {
            ...baseResult,
            status: "skipped",
            reason: `last tick was ${hoursSince.toFixed(1)}h ago (< ${IDEMPOTENCY_GUARD_HOURS}h guard)`,
            syntheticNowBefore: clockBefore.currentNow.toISOString(),
            syntheticNowAfter: clockBefore.currentNow.toISOString(),
          };
          return skipped;
        }
      }

      const windowStart = new Date(clockBefore.currentNow);
      const windowEnd = new Date(
        windowStart.getTime() + plan.cadence.syntheticHoursPerTick * 60 * 60 * 1000,
      );

      const rowsInserted: Record<string, number> = {};
      const seed = hashString(`${datasetId}:${clockBefore.tickCount}`);

      // Wrap the row-mutating section in a transaction so a mid-tick failure
      // doesn't leak partial rows. CREATE OR REPLACE TABLE for summaries also
      // participates so the summaries stay consistent with raw data.
      await conn.run("BEGIN TRANSACTION");
      let summaryTimings: { table: string; ms: number }[];
      try {
        // Generic declarative passes (no-op for fully-imperative datasets).
        // Pass 1: generate tables (no source dependency).
        for (const table of plan.tables) {
          if (table.mode !== "generate") continue;
          const inserted = await insertGeneratedTable(
            conn,
            table,
            plan,
            windowStart,
            windowEnd,
            seed + hashString(table.name),
            clockBefore.baselineNow,
          );
          rowsInserted[table.name] = inserted;
        }

        // Pass 2: derive from source-table rows just inserted.
        // bookingIdWatermark is quickhelp-specific; only resolve it for quickhelp.
        let bookingIdWatermark = 0;
        if (datasetId === "quickhelp") {
          const watermarkR = await conn.run(`SELECT COALESCE(MAX(booking_id), 0) FROM bookings__live`);
          bookingIdWatermark = Number((await watermarkR.getRows())[0][0]);
          for (const table of plan.tables) {
            if (table.mode !== "oneToOneFromBookings") continue;
            const inserted = await insertOneToOneFromBookings(
              conn,
              table,
              bookingIdWatermark,
              seed + hashString(table.name),
            );
            rowsInserted[table.name] = inserted;
          }
        }

        // Pass 3: emit funnel_events for first-time bookings (signup_complete + first_booking
        // pair on the same day, last-touch attribution).
        if (datasetId === "quickhelp") {
          const funnelInserted = await insertFunnelEventsForFirstBookings(
            conn,
            bookingIdWatermark,
            seed + hashString("funnel_events"),
          );
          rowsInserted["funnel_events"] = funnelInserted;

          // Pass 4: forward-carry — emit second_booking_14d for users whose
          // first_booking landed exactly 14 days ago and who have a return
          // booking today. Probabilistic backfill from the plan doc Q3.
          const carryInserted = await insertFunnelEventsForReturnCohort(
            conn,
            windowStart,
            windowEnd,
            seed + hashString("funnel_carry"),
          );
          rowsInserted["funnel_events"] = (rowsInserted["funnel_events"] ?? 0) + carryInserted;

          // Pass 5: cross-table derivations (booking economics, partner shifts,
          // surveys, comms, ads, weekly payouts). Each reads bookings__live
          // above the watermark and emits into its own __live shard.
          rowsInserted["booking_unit_economics"] = await deriveBookingEconomics(
            conn, bookingIdWatermark, seed + hashString("econ"),
          );
          rowsInserted["partner_shifts"] = await derivePartnerShifts(
            conn, bookingIdWatermark, seed + hashString("shifts"),
          );
          rowsInserted["survey_responses"] = await deriveSurveys(
            conn, bookingIdWatermark, seed + hashString("survey"),
          );
          rowsInserted["comms_sends"] = await deriveCommsSends(
            conn, bookingIdWatermark, windowEnd, seed + hashString("comms"),
          );
          rowsInserted["ad_daily_metrics"] = await deriveAdMetrics(
            conn, windowEnd, clockBefore.baselineNow, seed + hashString("ads"),
          );
          rowsInserted["partner_payouts"] = await derivePartnerPayouts(
            conn, windowEnd, seed + hashString("payouts"),
          );
        }

        // ── vastu-hfc orchestration ──────────────────────────────────────────
        // 9-pass pipeline. Each pass is a pure function in
        // vastu-hfc-{generators,derivations,...}.ts. Calendar-gated passes
        // (provisions, write-offs, assignments, NPA movement) no-op when the
        // tick date doesn't match.
        if (datasetId === "vastu-hfc") {
          const baseline = clockBefore.baselineNow;
          const today = windowEnd;

          // Pass A — age unpaid EMIs from prior days. Recomputes
          // dpd_bucket / stage / overdue / status (active → npa transition).
          const ageA = await applyDailyAgeing(conn, today);
          rowsInserted["loans__aged_pre"] = ageA.loansMutated;

          // Pass B — borrowings amortization (every active instrument draws down).
          rowsInserted["borrowings__amortized"] = await applyDailyBorrowingsAmortization(conn, today);

          // Pass C — employee attrition (probabilistic per role).
          rowsInserted["employees__attrited"] = await applyDailyEmployeeAttrition(
            conn, today, deriveSeed(seed, "attrition"),
          );

          // Pass D — independent generators in DAG order:
          //   branches → borrowers → employees → borrowings → loans
          // (loans depend on borrowers + branches existing).
          rowsInserted["branches"] = await generateNewBranches(
            conn, today, baseline, deriveSeed(seed, "branches"),
          );
          rowsInserted["borrowers"] = await generateNewBorrowers(
            conn, today, baseline, deriveSeed(seed, "borrowers"),
          );
          rowsInserted["employees"] = await generateNewEmployees(
            conn, today, baseline, deriveSeed(seed, "employees"),
          );
          rowsInserted["borrowings"] = await generateNewBorrowings(
            conn, today, baseline, deriveSeed(seed, "borrowings"),
          );
          rowsInserted["loans"] = await generateNewLoans(
            conn, today, baseline, deriveSeed(seed, "loans"),
          );

          // Pass E — emit today's EMIs by walking the loan book.
          const emiResult = await emitDailyEmis(conn, today, deriveSeed(seed, "emis"));
          rowsInserted["emi_payments"] = emiResult.inserted;

          // Pass F — re-age after EMIs land so bucket/stage reflect today's
          // outcomes (a loan that paid an unpaid EMI may exit sma_2 → sma_0 etc).
          const ageF = await applyDailyAgeing(conn, today);
          rowsInserted["loans__aged_post"] = ageF.loansMutated;

          // Pass G — collections actions for loans newly in 30+ DPD.
          rowsInserted["collections_actions"] = await emitDailyCollectionsActions(
            conn, today, deriveSeed(seed, "collections"),
          );

          // Pass H — calendar-gated derivations.
          rowsInserted["provisions"] = await emitMonthEndProvisions(conn, today);
          const writeOffs = await applyMonthEndWriteOffs(conn, today, deriveSeed(seed, "writeoffs"));
          if (writeOffs > 0) rowsInserted["loans__written_off"] = writeOffs;
          const assigned = await emitQuarterEndAssignments(conn, today, deriveSeed(seed, "assignments"));
          if (assigned > 0) {
            rowsInserted["assignments"] = 1;
            rowsInserted["loans__assigned"] = assigned;
          }
          rowsInserted["npa_movement"] = await emitQuarterEndNpaMovement(conn, today);

          // Pass I — loan completions (closed when full tenure paid; prepaid is
          // a daily probability roll on healthy loans).
          const completions = await applyLoanCompletions(
            conn, today, deriveSeed(seed, "completions"),
          );
          if (completions.closed > 0) rowsInserted["loans__closed"] = completions.closed;
          if (completions.prepaid > 0) rowsInserted["loans__prepaid"] = completions.prepaid;
        }

        // Refresh summary tables that read from the (now augmented) public views.
        // Backfill mode skips this (single refresh at end of bulk run instead).
        summaryTimings = options.skipSummaryRefresh
          ? []
          : await refreshSummaryTables(datasetId, conn);

        await conn.run("COMMIT");
      } catch (txnErr) {
        await conn.run("ROLLBACK").catch(() => {});
        throw txnErr;
      }

      const completedAt = new Date();
      await advanceClock(
        conn,
        plan.cadence.syntheticHoursPerTick,
        startedAt,
        completedAt,
        rowsInserted,
      );
      // Skip CHECKPOINT during bulk backfill — flushing the WAL after every
      // tick at HFC scale (~150K override rows accumulating) takes 5-15
      // minutes/tick. The backfill endpoint runs one CHECKPOINT at the end
      // alongside the summary refresh, restoring durability.
      if (!options.skipSummaryRefresh) {
        await conn.run("CHECKPOINT");
      }

      // Update synchronous cache so getSystemContext/getSchemaContext immediately see the new now.
      setNowCache(datasetId, windowEnd);

      // Invalidate in-memory caches so the next API call recomputes.
      const invalidated = plan.postTick?.invalidateCaches
        ? invalidateCaches(plan.postTick.invalidateCaches, datasetId)
        : null;

      // Segment refresh runs OUTSIDE this withConnection callback (after the
      // queue releases) — it re-enters withConnection per segment and would
      // deadlock if invoked here.
      const segmentRefresh: { refreshed: number; failed: number; durationMs: number } | null = null;

      const okResult = {
        ...baseResult,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        syntheticNowBefore: windowStart.toISOString(),
        syntheticNowAfter: windowEnd.toISOString(),
        status: "ok" as const,
        rowsInserted,
        summaryRefresh: summaryTimings,
        cacheInvalidation: invalidated,
        segmentRefresh,
      } as TickResult & {
        summaryRefresh: typeof summaryTimings;
        cacheInvalidation: typeof invalidated;
        segmentRefresh: typeof segmentRefresh;
      };
      // recordTickResult and segment refresh happen after the connection releases — see below
      return okResult;
    }).then(async (result) => {
      // Post-connection work: refresh saved-segment counts so drift is visible.
      // Each segment SQL runs through executeSQLInternal which acquires its
      // own withConnection — must happen after the tick's queue slot releases.
      if (result.status === "ok") {
        try {
          const { refreshAllSegmentCounts } = await import("./segment-refresh");
          const refresh = await refreshAllSegmentCounts(datasetId);
          (result as TickResult & { segmentRefresh: { refreshed: number; failed: number; durationMs: number } }).segmentRefresh = {
            refreshed: refresh.refreshed,
            failed: refresh.failed.length,
            durationMs: refresh.durationMs,
          };
          if (refresh.failed.length > 0) {
            console.warn(`[synthetic.tick] ${refresh.failed.length} segment count refreshes failed for ${datasetId}`, refresh.failed.slice(0, 3));
          }
        } catch (err) {
          console.warn(`[synthetic.tick] segment refresh threw for ${datasetId}`, err);
        }
      }
      recordTickResult(result);
      return result;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await withConnection(datasetId, async (conn) => {
        await recordTickFailure(conn, startedAt);
      });
    } catch {
      // ignore — we're already in error path
    }
    const errResult = {
      ...baseResult,
      status: "error" as const,
      error: message,
      syntheticNowAfter: "",
    };
    recordTickResult(errResult);
    return errResult;
  }
}

async function insertGeneratedTable(
  conn: DuckDBConnection,
  table: TableSynthSpec & { mode: "generate" },
  plan: SyntheticPlan,
  windowStart: Date,
  windowEnd: Date,
  seed: number,
  baselineDate: Date,
): Promise<number> {
  const rng = createRng(seed);
  const targetTable = `${table.name}__live`;
  // Volume is shaped by growth curve evaluated at the synthetic date being
  // generated (windowEnd, since the tick covers [windowStart, windowEnd]).
  const rowCount = dailyVolume(table.volume, {
    syntheticDate: windowEnd,
    baselineDate,
    rng,
  });
  if (rowCount === 0) return 0;

  // Determine current max id for sequential id columns
  let idStart = table.idSpace?.startAt ?? 1;
  if (table.idSpace) {
    const r = await conn.run(
      `SELECT COALESCE(MAX(${table.idSpace.column}), 0) FROM ${targetTable}`,
    );
    const rows = await r.getRows();
    const currentMax = Number(rows[0][0]);
    if (currentMax >= idStart) idStart = currentMax + 1;
  }

  const timestamps = sampleTimestamps(rng, rowCount, windowStart, windowEnd);
  const columnNames = Object.keys(table.columns);
  // id-space column is generated outside the column generator map
  const idColumn = table.idSpace?.column;
  const allColumns = idColumn && !columnNames.includes(idColumn)
    ? [idColumn, ...columnNames]
    : columnNames;

  const valueRows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const ctx: GenContext = {
      rng,
      rowTimestamp: timestamps[i],
      rowIndex: i,
      idStart,
    };
    const cells: string[] = [];
    for (const col of allColumns) {
      if (col === idColumn) {
        cells.push(String(idStart + i));
        continue;
      }
      const gen = table.columns[col];
      const value = generateValue(gen, ctx);
      cells.push(sqlLiteral(value));
    }
    valueRows.push(`(${cells.join(", ")})`);
  }

  // Chunk inserts to keep statements reasonable
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    await conn.run(
      `INSERT INTO ${targetTable} (${allColumns.join(", ")}) VALUES ${chunk.join(", ")}`,
    );
    inserted += chunk.length;
  }

  return inserted;
}

async function insertOneToOneFromBookings(
  conn: DuckDBConnection,
  table: TableSynthSpec & { mode: "oneToOneFromBookings" },
  bookingIdWatermark: number,
  seed: number,
): Promise<number> {
  // Read just-inserted bookings (above pre-tick id watermark).
  const r = await conn.run(`
    SELECT customer_id, booking_date
    FROM bookings__live
    WHERE booking_id > ${bookingIdWatermark}
  `);
  const sourceRows = await r.getRows();
  if (sourceRows.length === 0) return 0;

  const rng = createRng(seed);
  const targetTable = `${table.name}__live`;
  const probability = table.probability ?? 1.0;

  const columnNames = Object.keys(table.columns);
  // Source-derived columns prepended.
  const allColumns = ["customer_id", "session_date", ...columnNames];

  const valueRows: string[] = [];
  for (let i = 0; i < sourceRows.length; i++) {
    if (probability < 1.0 && !rng.bool(probability)) continue;
    const customerId = sourceRows[i][0];
    const bookingDate = sourceRows[i][1];
    const ctx: GenContext = {
      rng,
      rowTimestamp: new Date(formatDateCell(bookingDate) + "T00:00:00Z"),
      rowIndex: i,
      idStart: 0,
    };
    const cells: string[] = [
      sqlLiteral(customerId == null ? null : Number(customerId)),
      sqlLiteral(formatDateCell(bookingDate)),
    ];
    for (const col of columnNames) {
      cells.push(sqlLiteral(generateValue(table.columns[col], ctx)));
    }
    valueRows.push(`(${cells.join(", ")})`);
  }

  if (valueRows.length === 0) return 0;

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    await conn.run(
      `INSERT INTO ${targetTable} (${allColumns.join(", ")}) VALUES ${chunk.join(", ")}`,
    );
    inserted += chunk.length;
  }
  return inserted;
}

/**
 * Emit funnel_events for new bookings flagged is_first_booking=true.
 * Pairs signup_complete + first_booking on the same day. Source attribution
 * mirrors the booking's acquisition_source. Day 4 will add forward-carry for
 * D14/D30 cohort events via a pending_events queue.
 */
async function insertFunnelEventsForFirstBookings(
  conn: DuckDBConnection,
  bookingIdWatermark: number,
  seed: number,
): Promise<number> {
  const r = await conn.run(`
    SELECT customer_id, booking_date, booking_time, acquisition_source, city
    FROM bookings__live
    WHERE booking_id > ${bookingIdWatermark}
      AND is_first_booking = TRUE
  `);
  const sourceRows = await r.getRows();
  if (sourceRows.length === 0) return 0;

  const rng = createRng(seed);
  // event_id space — sit well above seed max (seed has ~86K events).
  const watermarkR = await conn.run(`SELECT COALESCE(MAX(event_id), 1000000) FROM funnel_events__live`);
  let nextId = Number((await watermarkR.getRows())[0][0]) + 1;
  if (nextId < 1_000_000) nextId = 1_000_000;

  const valueRows: string[] = [];
  for (const row of sourceRows) {
    const customerId = Number(row[0]);
    const dateStr = formatDateCell(row[1]);
    const timeStr = formatTimeCell(row[2]);
    const eventAt = `${dateStr}T${timeStr}`;
    const source = row[3] == null ? "organic" : String(row[3]);
    const city = row[4] == null ? "Urban" : String(row[4]);
    const platform = rng.weighted([
      { value: "ios", weight: 45 },
      { value: "android", weight: 55 },
    ]);

    // Pair: signup_complete (days_since_signup=0) + first_booking (same day)
    valueRows.push(
      `(${nextId++}, ${customerId}, 'signup_complete', '${eventAt}', 0, '${source}', '${city}', '${platform}')`,
    );
    valueRows.push(
      `(${nextId++}, ${customerId}, 'first_booking', '${eventAt}', 0, '${source}', '${city}', '${platform}')`,
    );
  }

  if (valueRows.length === 0) return 0;
  const cols = "event_id, customer_id, event_type, event_at, days_since_signup, source, city, platform";
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    await conn.run(`INSERT INTO funnel_events__live (${cols}) VALUES ${chunk.join(", ")}`);
    inserted += chunk.length;
  }
  return inserted;
}

/**
 * Forward-carry: probabilistic D14 retention. For each customer whose
 * first_booking landed 14 days before "today", emit a second_booking_14d
 * funnel event with probability `D14_RETENTION_RATE`. This produces realistic
 * cohort dynamics without requiring the random customer-id sampler to
 * coincidentally re-hit them in the current window.
 */
const D14_RETENTION_RATE = 0.42; // industry-typical D14 for service-booking apps

async function insertFunnelEventsForReturnCohort(
  conn: DuckDBConnection,
  windowStart: Date,
  windowEnd: Date,
  seed: number,
): Promise<number> {
  void windowStart;
  const endStr = windowEnd.toISOString().slice(0, 10);

  const r = await conn.run(`
    SELECT customer_id
    FROM funnel_events__live
    WHERE event_type = 'first_booking'
      AND CAST(event_at AS DATE) = DATE '${endStr}' - INTERVAL 14 DAY
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const rng = createRng(seed);
  const watermarkR = await conn.run(`SELECT COALESCE(MAX(event_id), 1000000) FROM funnel_events__live`);
  let nextId = Number((await watermarkR.getRows())[0][0]) + 1;
  if (nextId < 1_000_000) nextId = 1_000_000;

  const valueRows: string[] = [];
  for (const row of rows) {
    if (!rng.bool(D14_RETENTION_RATE)) continue;
    const customerId = Number(row[0]);
    const platform = rng.weighted([
      { value: "ios", weight: 45 },
      { value: "android", weight: 55 },
    ]);
    valueRows.push(
      `(${nextId++}, ${customerId}, 'second_booking_14d', '${endStr}T12:00:00', 14, 'organic', 'Urban', '${platform}')`,
    );
  }

  if (valueRows.length === 0) return 0;
  const cols = "event_id, customer_id, event_type, event_at, days_since_signup, source, city, platform";
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    await conn.run(`INSERT INTO funnel_events__live (${cols}) VALUES ${chunk.join(", ")}`);
    inserted += chunk.length;
  }
  return inserted;
}

function formatTimeCell(v: unknown): string {
  if (typeof v === "string") {
    const t = v.length === 5 ? `${v}:00` : v.slice(0, 8);
    return t;
  }
  if (typeof v === "object" && v !== null && "micros" in (v as object)) {
    const micros = (v as { micros: bigint }).micros;
    const totalSec = Number(micros / BigInt(1_000_000));
    const h = Math.floor(totalSec / 3600) % 24;
    const m = Math.floor(totalSec / 60) % 60;
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return "12:00:00";
}

function formatDateCell(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  if (typeof v === "object" && v !== null && "days" in (v as object)) {
    const days = Number((v as { days: number }).days);
    const d = new Date(days * 86400_000);
    return d.toISOString().slice(0, 10);
  }
  return String(v);
}

async function readClockRow(conn: DuckDBConnection) {
  const r = await conn.run(`
    SELECT baseline_now, current_now, last_tick_attempted_at, last_tick_succeeded_at, tick_count
    FROM synthetic_clock
  `);
  const rows = await r.getRows();
  const row = rows[0];
  return {
    baselineNow: toDate(row[0]),
    currentNow: toDate(row[1]),
    lastTickAttemptedAt: row[2] == null ? null : toDate(row[2]),
    lastTickSucceededAt: row[3] == null ? null : toDate(row[3]),
    tickCount: Number(row[4]),
  };
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v.replace(" ", "T") + "Z");
  if (typeof v === "object" && v !== null && "micros" in (v as object)) {
    const micros = (v as { micros: bigint }).micros;
    return new Date(Number(micros / BigInt(1000)));
  }
  return new Date(String(v));
}
