/**
 * GET /api/synthetic/clock?datasetId=quickhelp
 *
 * Public endpoint — returns the synthetic clock state for a sample dataset.
 * Auth: any signed-in user can read (the data is shared demo content).
 * Returns null clock for datasets without a synthesis plan (uploaded datasets,
 * other samples without a plan).
 */

import { auth } from "@clerk/nextjs/server";
import { readClock } from "@/lib/synthetic/clock";
import { getSyntheticPlan } from "@/lib/synthetic/plans";
import { getDataset } from "@/lib/datasets";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId");
  if (!datasetId) return Response.json({ error: "datasetId required" }, { status: 400 });

  let dataset;
  try {
    dataset = getDataset(datasetId);
  } catch {
    return Response.json({ error: "unknown dataset" }, { status: 404 });
  }

  // Only sample datasets (no ownerId) participate in synthesis.
  const isSample = !dataset.ownerId;
  const plan = getSyntheticPlan(datasetId);

  if (!isSample || !plan) {
    return Response.json({
      datasetId,
      synthesisEnabled: false,
      clock: null,
    });
  }

  const clock = await readClock(datasetId);
  // Compute next-tick estimate: lastTickSucceededAt + intervalHours.
  const intervalMs = plan.cadence.intervalHours * 60 * 60 * 1000;
  const nextEstimateAt = clock.lastTickSucceededAt
    ? new Date(clock.lastTickSucceededAt.getTime() + intervalMs).toISOString()
    : null;

  // Staleness: if last successful tick is older than 1.5 × interval, mark stale.
  const realNow = Date.now();
  const lastSuccessMs = clock.lastTickSucceededAt?.getTime();
  const isStale = lastSuccessMs ? realNow - lastSuccessMs > 1.5 * intervalMs : false;
  const neverTicked = !clock.lastTickSucceededAt;

  return Response.json({
    datasetId,
    synthesisEnabled: true,
    cadence: plan.cadence,
    clock: {
      currentNow: clock.currentNow.toISOString(),
      baselineNow: clock.baselineNow.toISOString(),
      lastTickSucceededAt: clock.lastTickSucceededAt?.toISOString() ?? null,
      lastTickAttemptedAt: clock.lastTickAttemptedAt?.toISOString() ?? null,
      tickCount: clock.tickCount,
      status: clock.status,
      nextEstimateAt,
      neverTicked,
      isStale,
      lastDeltas: clock.lastDeltas,
    },
  });
}
