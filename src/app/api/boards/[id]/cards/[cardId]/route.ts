import { auth } from "@clerk/nextjs/server";
import { upsertCard, deleteCard } from "@/lib/server/board-repo";
import type { BoardCard } from "@/lib/board-types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, cardId } = await params;
  let body: BoardCard;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  upsertCard(id, { ...body, id: cardId, boardId: id });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, cardId } = await params;
  deleteCard(id, cardId);
  return Response.json({ ok: true });
}
