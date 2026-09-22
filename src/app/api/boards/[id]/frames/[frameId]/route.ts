import { auth } from "@clerk/nextjs/server";
import { upsertFrame, deleteFrame } from "@/lib/server/board-repo";
import type { BoardFrame } from "@/lib/board-types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; frameId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, frameId } = await params;
  let body: BoardFrame;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  upsertFrame(id, { ...body, id: frameId, boardId: id });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; frameId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, frameId } = await params;
  deleteFrame(id, frameId);
  return Response.json({ ok: true });
}
