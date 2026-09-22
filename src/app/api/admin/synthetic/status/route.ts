/**
 * GET /api/admin/synthetic/status?datasetId=quickhelp
 *
 * Returns the synthetic clock state plus row counts in seed/live shards.
 * Same auth model as the tick endpoint.
 */

import { auth } from "@clerk/nextjs/server";
import { readClock, ensureClock } from "@/lib/synthetic/clock";
import { getSyntheticPlan } from "@/lib/synthetic/plans";
import { withConnection } from "@/lib/db";
import { getSchemaContext, getSystemContext } from "@/lib/schema";
import { setNowCache } from "@/lib/synthetic/now-cache";
import { ensureSyntheticInfrastructure } from "@/lib/synthetic/infrastructure";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId");
  if (!datasetId) {
    return Response.json({ error: "datasetId required" }, { status: 400 });
  }
  if (!getSyntheticPlan(datasetId)) {
    return Response.json({ error: "no plan for dataset" }, { status: 404 });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  const isCron = !!expectedSecret && cronSecret === expectedSecret;
  if (!isCron) {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const allowlist = (process.env.SYNTHETIC_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowlist.includes(userId)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Ensure synthesis tables exist before any diagnostic queries fire — on a
  // fresh production DB the live shards don't exist until a tick runs, but
  // status should be safe to call any time. Idempotent.
  await withConnection(datasetId, async (conn) => {
    await ensureClock(datasetId, conn);
    await ensureSyntheticInfrastructure(datasetId, conn);
  });

  const clock = await readClock(datasetId);
  // Refresh the synchronous prompt cache so getSchemaContext reflects current clock
  setNowCache(datasetId, clock.currentNow);

  // Dataset-specific row counts and diagnostics. Each dataset queries its own
  // primary fact table — quickhelp's is bookings, vastu-hfc's is loans.
  const datasetSpecific = await readDatasetSpecificCounts(datasetId);

  return Response.json({
    datasetId,
    clock: {
      baselineNow: clock.baselineNow.toISOString(),
      currentNow: clock.currentNow.toISOString(),
      lastTickAttemptedAt: clock.lastTickAttemptedAt?.toISOString() ?? null,
      lastTickSucceededAt: clock.lastTickSucceededAt?.toISOString() ?? null,
      tickCount: clock.tickCount,
      status: clock.status,
    },
    ...datasetSpecific,
    promptPreview: {
      schemaContextHead: getSchemaContext(datasetId).slice(0, 400),
      systemContextHead: getSystemContext(datasetId).slice(0, 400),
    },
    datasetNowSegmentTest: await testDatasetNowAnchor(datasetId),
  });
}

async function readDatasetSpecificCounts(datasetId: string): Promise<Record<string, unknown>> {
  if (datasetId === "quickhelp") {
    const counts = await withConnection(datasetId, async (conn) => {
      const seedR = await conn.run("SELECT COUNT(*) FROM bookings_seed");
      const liveR = await conn.run("SELECT COUNT(*) FROM bookings__live");
      const totalR = await conn.run("SELECT COUNT(*) FROM bookings");
      const dateRangeR = await conn.run(
        "SELECT MIN(booking_date), MAX(booking_date) FROM bookings__live",
      );
      const seed = Number((await seedR.getRows())[0][0]);
      const live = Number((await liveR.getRows())[0][0]);
      const total = Number((await totalR.getRows())[0][0]);
      const range = (await dateRangeR.getRows())[0];
      return { seed, live, total, liveMinDate: range[0], liveMaxDate: range[1] };
    });
    return {
      bookings: counts,
      funnelEvents: await readFunnelDiagnostics(datasetId),
    };
  }

  if (datasetId === "vastu-hfc") {
    return withConnection(datasetId, async (conn) => {
      const loanCount = async (where: string) => {
        const r = await conn.run(`SELECT COUNT(*) FROM raw_loans ${where}`);
        return Number((await r.getRows())[0][0]);
      };
      const liveCount = async (table: string) => {
        const r = await conn.run(`SELECT COUNT(*) FROM raw_${table}__live`);
        return Number((await r.getRows())[0][0]);
      };
      const seedCount = async (table: string) => {
        const r = await conn.run(`SELECT COUNT(*) FROM raw_${table}_seed`);
        return Number((await r.getRows())[0][0]);
      };
      const statusR = await conn.run(`
        SELECT loan_status, COUNT(*) AS n
        FROM raw_loans GROUP BY 1 ORDER BY 2 DESC
      `);
      const statusDist: Record<string, number> = {};
      for (const row of await statusR.getRows()) {
        statusDist[String(row[0])] = Number(row[1]);
      }
      const bucketR = await conn.run(`
        SELECT dpd_bucket, COUNT(*) AS n
        FROM raw_loans GROUP BY 1 ORDER BY 2 DESC
      `);
      const bucketDist: Record<string, number> = {};
      for (const row of await bucketR.getRows()) {
        bucketDist[String(row[0])] = Number(row[1]);
      }
      const liveDateR = await conn.run(
        `SELECT MIN(disbursement_date), MAX(disbursement_date) FROM raw_loans__live`,
      );
      const liveDateRange = (await liveDateR.getRows())[0];

      return {
        loans: {
          seed: await seedCount("loans"),
          live: await liveCount("loans"),
          total: await loanCount(""),
          liveMinDate: liveDateRange[0],
          liveMaxDate: liveDateRange[1],
          statusDistribution: statusDist,
          bucketDistribution: bucketDist,
        },
        liveShardCounts: {
          borrowers: await liveCount("borrowers"),
          branches: await liveCount("branches"),
          employees: await liveCount("employees"),
          borrowings: await liveCount("borrowings"),
          emi_payments: await liveCount("emi_payments"),
          collections_actions: await liveCount("collections_actions"),
          assignments: await liveCount("assignments"),
          provisions: await liveCount("provisions"),
          npa_movement: await liveCount("npa_movement"),
        },
      };
    });
  }

  return {};
}

async function readFunnelDiagnostics(datasetId: string) {
  return withConnection(datasetId, async (conn) => {
    const r = await conn.run(`
      SELECT event_type, COUNT(*) AS n
      FROM funnel_events__live
      GROUP BY 1
      ORDER BY 2 DESC
    `);
    const rows = await r.getRows();
    return Object.fromEntries(rows.map((row) => [String(row[0]), Number(row[1])]));
  });
}

async function testDatasetNowAnchor(datasetId: string) {
  return withConnection(datasetId, async (conn) => {
    const todayR = await conn.run(`SELECT today FROM dataset_now`);
    const today = String((await todayR.getRows())[0][0]);

    if (datasetId === "quickhelp") {
      const r = await conn.run(`
        SELECT COUNT(DISTINCT customer_id)
        FROM bookings
        WHERE booking_date >= (SELECT today FROM dataset_now) - INTERVAL 7 DAY
      `);
      return {
        last7dayUniqueCustomers: Number((await r.getRows())[0][0]),
        datasetToday: today,
      };
    }
    if (datasetId === "vastu-hfc") {
      const r = await conn.run(`
        SELECT COUNT(*)
        FROM raw_loans
        WHERE disbursement_date >= (SELECT today FROM dataset_now) - INTERVAL 7 DAY
      `);
      return {
        last7dayLoansDisbursed: Number((await r.getRows())[0][0]),
        datasetToday: today,
      };
    }
    return { datasetToday: today };
  });
}
