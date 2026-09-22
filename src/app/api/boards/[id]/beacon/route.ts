import { auth } from "@clerk/nextjs/server";
import { upsertBoard, bulkUpsertCards } from "@/lib/server/board-repo";
import { getDb } from "@/lib/meta-db";
import type { Board, BoardCard } from "@/lib/board-types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 401 });

  const { id } = await params;
  let body: { board?: Board; cards?: BoardCard[] };
  try { body = await req.json(); } catch { return new Response(null, { status: 400 }); }

  try {
    const db = getDb();
    db.transaction(() => {
      if (body.board) upsertBoard(userId, { ...body.board, id });
      if (body.cards && Array.isArray(body.cards)) {
        bulkUpsertCards(id, body.cards.map((c: BoardCard) => ({ ...c, boardId: id })));
      }
    })();
  } catch (err) { console.error("[beacon:board] save failed:", err); }

  return new Response(null, { status: 204 });
}
