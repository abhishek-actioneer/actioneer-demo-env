import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getRetention } from "@/lib/server/retention-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileRetentionChurnSegmentSQL } from "@/lib/retention-users-sql";
import { safeStringify } from "@/lib/safe-stringify";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const retention = getRetention(userId, id);
  if (!retention)
    return Response.json({ error: "Retention not found" }, { status: 404 });

  const datasetId = retention.datasetId || req.headers.get("x-dataset-id");
  if (!datasetId)
    return Response.json({ error: "Missing dataset" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId))
    return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const cohort = typeof body.cohort === "string" ? body.cohort : undefined;
  const bucket = typeof body.bucket === "number" ? body.bucket : -1;
  const status =
    body.status === "retained" || body.status === "churned"
      ? body.status
      : "churned";

  if (bucket < 0) {
    return Response.json(
      { error: "Invalid bucket — must be a non-negative number" },
      { status: 400 }
    );
  }

  const dataset = getDataset(datasetId);

  // Generate segment SQL
  const sql = compileRetentionChurnSegmentSQL(
    retention.config,
    dataset,
    cohort,
    bucket,
    status
  );
  if (!sql) {
    return Response.json(
      { error: "Cannot compile retention segment SQL" },
      { status: 400 }
    );
  }

  // Count the users
  const countSql = `SELECT COUNT(*) AS cnt FROM (${sql}) __segment_count`;
  const countResult = await executeSQLInternal(countSql, datasetId);
  const estimatedCount = countResult.error
    ? 0
    : Number(
        (countResult.rows[0] as Record<string, unknown>)?.cnt ?? 0
      );

  // Build suggested name
  const bucketLabel =
    retention.config.mode === "custom"
      ? `Bracket ${bucket}`
      : `Day ${bucket}`;
  const statusLabel = status === "retained" ? "Retained" : "Churned";
  const cohortSuffix = cohort ? ` (Cohort ${cohort})` : "";
  const suggestedName = `${retention.name} - ${statusLabel} by ${bucketLabel}${cohortSuffix}`;

  return new Response(
    safeStringify({ sql, estimatedCount, suggestedName }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
