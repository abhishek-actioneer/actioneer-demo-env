import { auth } from "@clerk/nextjs/server";
import { listSavedCharts, upsertSavedChart, deleteSavedChart } from "@/lib/server/saved-chart-repo";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId") || req.headers.get("x-dataset-id") || "";
  if (!datasetId) return Response.json({ error: "datasetId required" }, { status: 400 });

  const charts = listSavedCharts(userId, datasetId);
  return Response.json(charts);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, name, datasetId, config, createdAt } = body;
  if (!id || !name || !datasetId || !config) {
    return Response.json({ error: "id, name, datasetId, and config required" }, { status: 400 });
  }

  upsertSavedChart(userId, {
    id,
    name,
    datasetId,
    config: typeof config === "string" ? config : JSON.stringify(config),
    createdAt: createdAt ?? new Date().toISOString(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  deleteSavedChart(userId, id);
  return Response.json({ ok: true });
}
