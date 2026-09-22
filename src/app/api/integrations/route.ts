import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { executeSQLPrepared } from "@/lib/sql-executor";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import type { Integration } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const datasetId = searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await executeSQLPrepared("SELECT * FROM sentinel_integrations ORDER BY name", [], datasetId);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  const integrations: Integration[] = result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    icon: row.icon as string,
    description: row.description as string,
    connected: Boolean(row.connected),
    lastSynced: row.last_synced ? String(row.last_synced) : undefined,
  }));

  return Response.json(integrations);
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { id: string; connected: boolean };
  const { id, connected } = body;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  if (!id || typeof connected !== "boolean") {
    return Response.json({ error: "id and connected are required" }, { status: 400 });
  }

  const lastSynced = connected ? ", last_synced = CURRENT_TIMESTAMP" : "";
  const result = await executeSQLPrepared(
    `UPDATE sentinel_integrations SET connected = $1${lastSynced} WHERE id = $2`,
    [connected, id],
    datasetId,
  );
  if (result.error) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({ success: true });
}
