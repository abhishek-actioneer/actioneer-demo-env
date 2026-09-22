import { auth } from "@clerk/nextjs/server";
import { getFullBoard, upsertBoard, deleteBoard } from "@/lib/server/board-repo";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "Not found" }, { status: 404 });
  const result = getFullBoard(userId, id);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  if (result.board.datasetId !== datasetId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(result);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "Not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const existing = getFullBoard(userId, id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.board.datasetId !== datasetId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  upsertBoard(userId, {
    id,
    name: (body.name as string) || existing.board.name || "Untitled",
    datasetId: existing.board.datasetId,  // header is authoritative; ignore body.datasetId
    description: body.description !== undefined ? (body.description as string) : existing.board.description,
    viewMode: (body.viewMode as "document" | "canvas") || existing.board.viewMode || "document",
    globalTimeRange: body.globalTimeRange !== undefined
      ? (body.globalTimeRange as ({ preset?: "7d" | "30d" | "90d" | "1y" | "custom"; start?: string; end?: string } | undefined))
      : existing.board.globalTimeRange,
    deckId: body.deckId !== undefined ? (body.deckId as string) : existing.board.deckId,
    createdAt: existing.board.createdAt || now,
    updatedAt: now,
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "Not found" }, { status: 404 });
  const existing = getFullBoard(userId, id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.board.datasetId !== datasetId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  deleteBoard(userId, id);
  return Response.json({ ok: true });
}
