/**
 * Bulk backfill endpoint for synthetic ticks.
 *
 * POST /api/admin/synthetic/backfill?datasetId=vastu-hfc&until=2026-04-30
 *   Header: x-cron-secret: $CRON_SECRET (or signed-in admin user)
 *
 * Loops runTick(force=true, skipSummaryRefresh=true) until the synthetic
 * clock reaches `until`. Streams NDJSON progress lines so a long-running
 * backfill doesn't appear to hang. After the loop, runs a single summary
 * table refresh so summaries reflect the final state.
 *
 * Useful for taking a freshly-registered dataset (vastu-hfc) from its seed
 * end date to today in one operation. After backfill completes the daily
 * scheduler picks up at 1pm IST as normal — no special handoff needed.
 *
 * Safety
 * ------
 *   - Only callable with the cron secret header OR by a Clerk userId in
 *     SYNTHETIC_ADMIN_USER_IDS.
 *   - Plan must be enabled (otherwise runTick returns 'skipped: plan disabled').
 *     For an explicit one-shot bypass, the caller can flip enabled=true in
 *     the plan file before invoking.
 *   - On error mid-loop the clock stops at the last successful tick. Caller
 *     can rerun the endpoint with the same parameters to resume.
 */

import { auth } from "@clerk/nextjs/server";
import { runTick } from "@/lib/synthetic/tick";
import { getSyntheticPlan } from "@/lib/synthetic/plans";
import { readClock } from "@/lib/synthetic/clock";
import { withConnection } from "@/lib/db";
import { refreshSummaryTables } from "@/lib/synthetic/infrastructure";

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  const isCron = !!expectedSecret && cronSecret === expectedSecret;
  if (isCron) return { ok: true };
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };
  const allow = (process.env.SYNTHETIC_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.includes(userId)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId");
  const untilStr = url.searchParams.get("until");
  const maxTicksRaw = url.searchParams.get("maxTicks");
  const maxTicks = maxTicksRaw ? Math.max(1, Math.min(2000, Number(maxTicksRaw))) : 2000;

  if (!datasetId) {
    return Response.json({ error: "datasetId query param required" }, { status: 400 });
  }
  if (!untilStr) {
    return Response.json({ error: "until=YYYY-MM-DD query param required" }, { status: 400 });
  }
  const until = new Date(`${untilStr}T23:59:59Z`);
  if (isNaN(until.getTime())) {
    return Response.json({ error: `invalid until=${untilStr} (expected YYYY-MM-DD)` }, { status: 400 });
  }
  const plan = getSyntheticPlan(datasetId);
  if (!plan) {
    return Response.json({ error: `no synthetic plan for datasetId=${datasetId}` }, { status: 404 });
  }

  const authz = await authorize(req);
  if (!authz.ok) return Response.json({ error: authz.error }, { status: authz.status });

  // Stream NDJSON progress so the connection doesn't appear to hang.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const startedAt = Date.now();
      send({ type: "start", datasetId, until: untilStr, maxTicks, startedAt: new Date(startedAt).toISOString() });

      let ticksRun = 0;
      let lastClock = await readClock(datasetId);
      send({
        type: "initial_clock",
        currentNow: lastClock.currentNow.toISOString(),
        tickCount: lastClock.tickCount,
      });

      try {
        while (lastClock.currentNow < until && ticksRun < maxTicks) {
          const r = await runTick(datasetId, { force: true, skipSummaryRefresh: true });
          ticksRun++;

          if (r.status === "error") {
            send({ type: "tick_error", iter: ticksRun, error: r.error });
            break;
          }
          if (r.status === "skipped") {
            send({ type: "tick_skipped", iter: ticksRun, reason: r.reason });
            // Skipped means the plan is disabled or guard fired; either way, stop.
            break;
          }

          send({
            type: "tick",
            iter: ticksRun,
            day: r.syntheticNowAfter.slice(0, 10),
            durationMs: r.durationMs,
            rows: r.rowsInserted,
          });

          lastClock = await readClock(datasetId);
        }

        // Run summary refresh + final CHECKPOINT exactly once at the end of
        // the bulk operation. Backfill skips per-tick CHECKPOINTs (those add
        // ~15 min/tick at HFC scale), so this final CHECKPOINT is what makes
        // all the live data durable on disk.
        const summaryStart = Date.now();
        send({ type: "summary_refresh_start" });
        const summaries = await withConnection(datasetId, async (conn) => {
          const result = await refreshSummaryTables(datasetId, conn);
          await conn.run("CHECKPOINT");
          return result;
        });
        send({
          type: "summary_refresh_done",
          durationMs: Date.now() - summaryStart,
          tables: summaries,
        });

        send({
          type: "done",
          ticksRun,
          finalNow: lastClock.currentNow.toISOString(),
          tickCount: lastClock.tickCount,
          totalDurationMs: Date.now() - startedAt,
        });
      } catch (err) {
        send({
          type: "fatal",
          error: err instanceof Error ? err.message : String(err),
          ticksRun,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  return POST(req);
}
