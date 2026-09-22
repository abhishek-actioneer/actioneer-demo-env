/**
 * In-process scheduler for synthetic ticks.
 *
 * Strategy:
 *   - Single setInterval registered on first import in a server context.
 *   - Pinned to globalThis to survive Next.js HMR re-evaluation in dev.
 *   - Gated by SYNTHETIC_ENABLED=true (default off in dev).
 *   - In multi-replica deploys, only the replica with SYNTHETIC_LEADER=true
 *     actually fires ticks. Others register the interval but no-op inside.
 *   - On boot, runs a cold-boot catch-up: if last tick > intervalHours ago,
 *     fire one tick immediately (clamped to one — no replay storm).
 *
 * Ticks themselves are also reachable via:
 *   - External cron (Railway/Vercel) hitting /api/admin/synthetic/tick with x-cron-secret
 *   - Manual admin POST to the same endpoint
 * Both paths share the idempotency guard in runTick, so no duplicates.
 */

import { listSyntheticDatasets, getSyntheticPlan } from "./plans";
import { runTick } from "./tick";
import { readClock } from "./clock";

const FLAG_SYMBOL = Symbol.for("baby-sentinel.synthetic.scheduler");

interface SchedulerGlobal {
  [k: symbol]:
    | {
        started: boolean;
        intervalId: NodeJS.Timeout | null;
      }
    | undefined;
}

/** Minimum interval between scheduler wake-ups (ms). Daily cadence checked here. */
const TICK_CADENCE_MS = 15 * 60 * 1000; // 15 min — fine-grained enough for "1pm IST" check

const TARGET_HOUR_UTC = 7;   // 13:00 IST = 07:30 UTC; check window starts at 07:00
const TARGET_MIN_UTC = 30;

export function startSyntheticScheduler(): void {
  if (process.env.SYNTHETIC_ENABLED !== "true") return;
  const isLeader = process.env.SYNTHETIC_LEADER === "true";
  if (!isLeader) {
    console.log("[synthetic.scheduler] SYNTHETIC_ENABLED=true but SYNTHETIC_LEADER!=true — this replica skips ticks");
    return;
  }

  const g = globalThis as SchedulerGlobal;
  const existing = g[FLAG_SYMBOL];
  if (existing?.started) {
    return; // HMR or duplicate import — already registered
  }

  // Cold-boot catch-up — fire after a small delay so the server finishes booting.
  setTimeout(() => {
    void coldBootCatchUp();
  }, 5_000);

  // Periodic check
  const intervalId = setInterval(() => {
    void checkAndTick();
  }, TICK_CADENCE_MS);

  g[FLAG_SYMBOL] = { started: true, intervalId };
  console.log(`[synthetic.scheduler] started (every ${TICK_CADENCE_MS / 60000}m, target ${TARGET_HOUR_UTC}:${String(TARGET_MIN_UTC).padStart(2, "0")} UTC)`);
}

/** Fire ticks if (a) we're inside the daily target window and (b) last tick > 12h ago. */
async function checkAndTick(): Promise<void> {
  const now = new Date();
  const inWindow =
    now.getUTCHours() === TARGET_HOUR_UTC && now.getUTCMinutes() >= TARGET_MIN_UTC && now.getUTCMinutes() < TARGET_MIN_UTC + 30;
  if (!inWindow) return;

  for (const datasetId of listSyntheticDatasets()) {
    try {
      const result = await runTick(datasetId);
      if (result.status === "ok") {
        console.log(`[synthetic.scheduler] tick ok datasetId=${datasetId} now=${result.syntheticNowAfter} rows=${JSON.stringify(result.rowsInserted)}`);
      } else if (result.status === "error") {
        console.error(`[synthetic.scheduler] tick error datasetId=${datasetId} err=${result.error}`);
      }
    } catch (err) {
      console.error(`[synthetic.scheduler] tick threw datasetId=${datasetId}`, err);
    }
  }
}

/** On boot, fire one tick per dataset whose last tick is >= intervalHours ago. */
async function coldBootCatchUp(): Promise<void> {
  for (const datasetId of listSyntheticDatasets()) {
    const plan = getSyntheticPlan(datasetId);
    if (!plan) continue;

    try {
      const clock = await readClock(datasetId);
      const intervalMs = plan.cadence.intervalHours * 60 * 60 * 1000;

      // Never ticked OR last tick older than intervalHours → fire one (clamped).
      const lastSuccessMs = clock.lastTickSucceededAt?.getTime() ?? 0;
      const elapsed = Date.now() - lastSuccessMs;
      if (lastSuccessMs === 0 || elapsed >= intervalMs) {
        console.log(`[synthetic.scheduler] cold-boot catch-up datasetId=${datasetId} (elapsed=${Math.round(elapsed / 3600000)}h)`);
        const result = await runTick(datasetId);
        console.log(`[synthetic.scheduler] cold-boot result datasetId=${datasetId} status=${result.status}`);
      }
    } catch (err) {
      console.error(`[synthetic.scheduler] cold-boot threw datasetId=${datasetId}`, err);
    }
  }
}
