import { auth } from "@clerk/nextjs/server";
import { listForecastSeeds, upsertForecastSeed, deleteForecastSeed } from "@/lib/server/forecast-repo";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId") || req.headers.get("x-dataset-id") || "";
  if (!datasetId) return Response.json({ error: "datasetId required" }, { status: 400 });

  const seeds = listForecastSeeds(userId, datasetId);
  return Response.json(seeds);
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, datasetId, modelData, seedData } = body;
  if (!id || !datasetId) {
    return Response.json({ error: "id and datasetId required" }, { status: 400 });
  }

  upsertForecastSeed(userId, {
    id,
    datasetId,
    modelData: typeof modelData === "string" ? modelData : JSON.stringify(modelData ?? {}),
    seedData: typeof seedData === "string" ? seedData : JSON.stringify(seedData ?? {}),
    updatedAt: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  deleteForecastSeed(userId, id);
  return Response.json({ ok: true });
}
