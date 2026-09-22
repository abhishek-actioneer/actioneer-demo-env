import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getFunnel } from "@/lib/server/funnel-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileFunnelDropoffSegmentSQL } from "@/lib/funnel-users-sql";
import { safeStringify } from "@/lib/safe-stringify";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const funnel = getFunnel(userId, id);
  if (!funnel) return Response.json({ error: "Funnel not found" }, { status: 404 });

  const datasetId = funnel.datasetId || req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "Missing dataset" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId))
    return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const step = typeof body.step === "number" ? body.step : -1;

  if (step < 1 || step >= funnel.config.steps.length) {
    return Response.json(
      { error: "Invalid step index — must be between 1 and the last step" },
      { status: 400 }
    );
  }

  const dataset = getDataset(datasetId);
  const events = dataset.events ?? [];

  // Generate drop-off segment SQL
  const sql = compileFunnelDropoffSegmentSQL(funnel.config, dataset, step);
  if (!sql) {
    return Response.json({ error: "Cannot compile drop-off segment SQL" }, { status: 400 });
  }

  // Count the drop-off users
  const countSql = `SELECT COUNT(*) AS cnt FROM (${sql}) __dropoff_count`;
  const countResult = await executeSQLInternal(countSql, datasetId);
  const estimatedCount = countResult.error
    ? 0
    : Number((countResult.rows[0] as Record<string, unknown>)?.cnt ?? 0);

  // Build suggested name
  const stepEvent = events.find((e) => e.id === funnel.config.steps[step].eventId);
  const stepLabel = funnel.config.steps[step].label || stepEvent?.displayName || `Step ${step + 1}`;
  const suggestedName = `${funnel.name} - Dropped at ${stepLabel}`;

  return new Response(
    safeStringify({ sql, estimatedCount, suggestedName }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
