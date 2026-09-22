import { auth } from "@clerk/nextjs/server";
import { listBoardSummaries, upsertBoard } from "@/lib/server/board-repo";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "x-dataset-id required" }, { status: 400 });
  const summaries = listBoardSummaries(userId, datasetId);
  return Response.json(summaries);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id: string; name: string; datasetId: string; description?: string; viewMode?: string; deckId?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id || !body.name || !body.datasetId) return Response.json({ error: "id, name, datasetId required" }, { status: 400 });
  const now = new Date().toISOString();
  upsertBoard(userId, {
    id: body.id, name: body.name, datasetId: body.datasetId,
    description: body.description, viewMode: (body.viewMode as "document" | "canvas") || "document",
    deckId: body.deckId, createdAt: now, updatedAt: now,
  });
  return Response.json({ ok: true, id: body.id }, { status: 201 });
}
