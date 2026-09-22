import { auth } from "@clerk/nextjs/server";
import { bulkUpsertCards } from "@/lib/server/board-repo";
import type { BoardCard } from "@/lib/board-types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: { cards: BoardCard[] };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.cards)) return Response.json({ error: "cards array required" }, { status: 400 });
  bulkUpsertCards(id, body.cards.map(c => ({ ...c, boardId: id })));
  return Response.json({ ok: true });
}
