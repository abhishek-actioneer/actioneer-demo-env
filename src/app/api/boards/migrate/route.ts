import { auth } from "@clerk/nextjs/server";
import { migrateBoardsFromLocalStorage } from "@/lib/server/board-repo";
import type { Board, BoardCard, BoardSection, CardConnection, BoardFrame } from "@/lib/board-types";

interface MigrateBoard {
  board: Board;
  cards: BoardCard[];
  sections: BoardSection[];
  connections: CardConnection[];
  frames: BoardFrame[];
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { boards: MigrateBoard[] };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.boards)) return Response.json({ error: "boards array required" }, { status: 400 });
  if (body.boards.length > 50) {
    return Response.json({ error: "Too many boards in migration payload (max 50)" }, { status: 400 });
  }
  const result = migrateBoardsFromLocalStorage(userId, body.boards);
  return Response.json(result);
}
