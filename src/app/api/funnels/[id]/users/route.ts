import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getFunnel } from "@/lib/server/funnel-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileFunnelUsersSQL, compileFunnelUsersCountSQL } from "@/lib/funnel-users-sql";
import { safeStringify } from "@/lib/safe-stringify";

export async function GET(
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

  const url = new URL(req.url);
  const step = parseInt(url.searchParams.get("step") ?? "0", 10);
  const status = (url.searchParams.get("status") ?? "dropped") as "converted" | "dropped";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  if (status !== "converted" && status !== "dropped") {
    return Response.json({ error: "Invalid status — must be 'converted' or 'dropped'" }, { status: 400 });
  }

  const dataset = getDataset(datasetId);

  // Compile user list query
  const usersSql = compileFunnelUsersSQL(funnel.config, dataset, step, status, limit, offset);
  if (!usersSql) {
    return new Response(
      safeStringify({ users: [], total: 0, step, status }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Compile count query
  const countSql = compileFunnelUsersCountSQL(funnel.config, dataset, step, status);

  // Execute both
  const [usersResult, countResult] = await Promise.all([
    executeSQLInternal(usersSql, datasetId),
    countSql ? executeSQLInternal(countSql, datasetId) : Promise.resolve({ rows: [{ total: 0 }], error: null }),
  ]);

  if (usersResult.error) {
    return Response.json({ error: usersResult.error }, { status: 422 });
  }

  const total = countResult.error ? 0 : Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0);
  const users = (usersResult.rows as Record<string, unknown>[]).map((row) => ({
    uid: String(row.uid ?? ""),
  }));

  return new Response(
    safeStringify({ users, total, step, status }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
