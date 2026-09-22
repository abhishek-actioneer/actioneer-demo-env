import { auth } from "@clerk/nextjs/server";
import { upsertConnection, deleteConnection } from "@/lib/server/board-repo";
import type { CardConnection } from "@/lib/board-types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; connId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, connId } = await params;
  let body: CardConnection;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  upsertConnection(id, { ...body, id: connId, boardId: id });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; connId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, connId } = await params;
  deleteConnection(id, connId);
  return Response.json({ ok: true });
}
