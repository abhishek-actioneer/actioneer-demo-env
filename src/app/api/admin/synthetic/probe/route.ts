/**
 * GET /api/admin/synthetic/probe?datasetId=quickhelp
 *
 * Diagnostic: runs canonical "last 7 days" queries against the public bookings
 * view to verify live shard rows show up under the same query patterns the
 * LLM will generate. Admin-gated.
 */

import { auth } from "@clerk/nextjs/server";
import { withConnection } from "@/lib/db";
import { ensureClock } from "@/lib/synthetic/clock";
import { ensureSyntheticInfrastructure } from "@/lib/synthetic/infrastructure";
import { readClock } from "@/lib/synthetic/clock";
import { getSyntheticPlan } from "@/lib/synthetic/plans";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId");
  if (!datasetId) return Response.json({ error: "datasetId required" }, { status: 400 });
  if (!getSyntheticPlan(datasetId)) return Response.json({ error: "no plan" }, { status: 404 });

  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  if (!isCron) {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const allow = (process.env.SYNTHETIC_ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim());
    if (!allow.includes(userId)) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const clock = await readClock(datasetId);
  const nowDate = clock.currentNow.toISOString().slice(0, 10);

  // Ensure infra exists — probe queries dataset_now view + live shards.
  await withConnection(datasetId, async (conn) => {
    await ensureClock(datasetId, conn);
    await ensureSyntheticInfrastructure(datasetId, conn);
  });

  const result = await withConnection(datasetId, async (conn) => {
    // Last 7 days from synthetic now
    const last7R = await conn.run(`
      SELECT COUNT(*) AS bookings, SUM(booking_value) AS gmv
      FROM bookings
      WHERE booking_date >= DATE '${nowDate}' - INTERVAL 7 DAY
        AND booking_date <= DATE '${nowDate}'
    `);
    const last7Rows = await last7R.getRows();

    // Per-day breakdown for the live window
    const perDayR = await conn.run(`
      SELECT booking_date, COUNT(*) AS bookings, ROUND(SUM(booking_value), 0) AS gmv
      FROM bookings
      WHERE booking_date >= DATE '${nowDate}' - INTERVAL 7 DAY
      GROUP BY 1
      ORDER BY 1
    `);
    const perDayRows = await perDayR.getRows();

    // Verify summary table refresh — daily_metrics should agree with bookings view
    const summaryR = await conn.run(`
      SELECT date, total_bookings, revenue
      FROM daily_metrics
      WHERE date >= DATE '${nowDate}' - INTERVAL 7 DAY
      ORDER BY date
    `);
    const summaryRows = await summaryR.getRows();

    // Verify cross-table consistency — daily_sessions count for live window
    const sessionsR = await conn.run(`
      SELECT session_date, COUNT(*)
      FROM daily_sessions
      WHERE session_date >= DATE '${nowDate}' - INTERVAL 7 DAY
        AND session_date <= DATE '${nowDate}'
      GROUP BY 1
      ORDER BY 1
    `);
    const sessionsRows = await sessionsR.getRows();

    return {
      last7d: {
        bookings: Number(last7Rows[0][0]),
        gmv: Number(last7Rows[0][1] ?? 0),
      },
      perDay: perDayRows.map((r) => ({
        date: String(r[0]),
        bookings: Number(r[1]),
        gmv: Number(r[2] ?? 0),
      })),
      dailyMetricsSummary: summaryRows.map((r) => ({
        date: String(r[0]),
        total_bookings: Number(r[1]),
        revenue: Number(r[2] ?? 0),
      })),
      dailySessionsLive: sessionsRows.map((r) => ({
        date: String(r[0]),
        sessions: Number(r[1]),
      })),
    };
  });

  return Response.json({
    datasetId,
    syntheticNow: nowDate,
    query: "last 7 days bookings vs per-day breakdown — verifies live rows surface in WHERE booking_date >= now() - 7d patterns",
    ...result,
  });
}
