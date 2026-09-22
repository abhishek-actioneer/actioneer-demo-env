import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getRetention } from "@/lib/server/retention-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import {
  compileRetentionUsersSQL,
  compileRetentionUsersCountSQL,
} from "@/lib/retention-users-sql";
import { safeStringify } from "@/lib/safe-stringify";

export async function GET(
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

  const url = new URL(req.url);
  const cohort = url.searchParams.get("cohort");
  const bucket = parseInt(url.searchParams.get("bucket") ?? "0", 10);
  const status = (url.searchParams.get("status") ?? "churned") as
    | "retained"
    | "churned";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "50", 10),
    200
  );
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  if (!cohort) {
    return Response.json(
      { error: "Missing 'cohort' query parameter (date string)" },
      { status: 400 }
    );
  }
  if (status !== "retained" && status !== "churned") {
    return Response.json(
      { error: "Invalid status — must be 'retained' or 'churned'" },
      { status: 400 }
    );
  }

  const dataset = getDataset(datasetId);

  // Compile user list query
  const usersSql = compileRetentionUsersSQL(
    retention.config,
    dataset,
    cohort,
    bucket,
    status,
    limit,
    offset
  );
  if (!usersSql) {
    return new Response(
      safeStringify({ users: [], total: 0, cohort, bucket, status }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Compile count query
  const countSql = compileRetentionUsersCountSQL(
    retention.config,
    dataset,
    cohort,
    bucket,
    status
  );

  // Execute both in parallel
  const [usersResult, countResult] = await Promise.all([
    executeSQLInternal(usersSql, datasetId),
    countSql
      ? executeSQLInternal(countSql, datasetId)
      : Promise.resolve({ rows: [{ total: 0 }], error: null }),
  ]);

  if (usersResult.error) {
    return Response.json({ error: usersResult.error }, { status: 422 });
  }

  const total = countResult.error
    ? 0
    : Number(
        (countResult.rows[0] as Record<string, unknown>)?.total ?? 0
      );
  const users = (usersResult.rows as Record<string, unknown>[]).map((row) => ({
    uid: String(row.uid ?? ""),
  }));

  return new Response(
    safeStringify({ users, total, cohort, bucket, status }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
