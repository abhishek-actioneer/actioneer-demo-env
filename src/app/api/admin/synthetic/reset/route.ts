/**
 * POST /api/admin/synthetic/reset?datasetId=quickhelp
 *
 * Wipes live shards and resets the clock for a sample dataset.
 */

import { auth } from "@clerk/nextjs/server";
import { resetSyntheticState } from "@/lib/synthetic/reset";
import { getSyntheticPlan } from "@/lib/synthetic/plans";

export async function POST(req: Request) {
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

  const result = await resetSyntheticState(datasetId);
  return Response.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
