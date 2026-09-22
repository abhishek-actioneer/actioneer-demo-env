import { auth } from "@clerk/nextjs/server";
import { upsertSection, deleteSection } from "@/lib/server/board-repo";
import type { BoardSection } from "@/lib/board-types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sectionId } = await params;
  let body: BoardSection;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  upsertSection(id, { ...body, id: sectionId, boardId: id });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sectionId } = await params;
  deleteSection(id, sectionId);
  return Response.json({ ok: true });
}
