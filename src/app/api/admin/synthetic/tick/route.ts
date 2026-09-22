/**
 * Manual tick endpoint. Two auth modes:
 *   1. Cron — header `x-cron-secret: $CRON_SECRET` matches env (used by Vercel/Railway cron)
 *   2. Admin user — Clerk userId in `SYNTHETIC_ADMIN_USER_IDS` env allowlist (comma-separated)
 *
 * POST /api/admin/synthetic/tick?datasetId=quickhelp[&force=true]
 */

import { auth } from "@clerk/nextjs/server";
import { runTick } from "@/lib/synthetic/tick";
import { getSyntheticPlan } from "@/lib/synthetic/plans";
import { getTickHistory } from "@/lib/synthetic/tick-history";

const MAX_BURST_TICKS = 30;

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
  const force = url.searchParams.get("force") === "true";
  const action = url.searchParams.get("action") ?? "tick"; // "tick" | "burst" | "history"
  const ticks = Math.min(Math.max(Number(url.searchParams.get("ticks") ?? 1), 1), MAX_BURST_TICKS);

  if (!datasetId) {
    return Response.json({ error: "datasetId query param required" }, { status: 400 });
  }
  if (!getSyntheticPlan(datasetId)) {
    return Response.json({ error: `no synthetic plan for datasetId=${datasetId}` }, { status: 404 });
  }

  const authz = await authorize(req);
  if (!authz.ok) return Response.json({ error: authz.error }, { status: authz.status });

  if (action === "history") {
    return Response.json({ datasetId, history: getTickHistory(datasetId) });
  }

  if (action === "burst") {
    const results = [];
    for (let i = 0; i < ticks; i++) {
      const r = await runTick(datasetId, { force: true });
      results.push(r);
      if (r.status === "error") break;
    }
    return Response.json({ datasetId, ticks, completed: results.length, results });
  }

  // Default: single tick
  const result = await runTick(datasetId, { force });
  const status = result.status === "error" ? 500 : 200;
  return Response.json(result, { status });
}

export async function GET(req: Request) {
  return POST(req);
}
