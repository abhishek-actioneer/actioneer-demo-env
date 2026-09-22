import { auth } from "@clerk/nextjs/server";
import { stmts } from "@/lib/meta-db";

// GET /api/conversations/[id] — full conversation
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const s = stmts();
  const row = s.getById.get(id, userId) as Record<string, unknown> | undefined;

  if (!row) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Parse JSON fields
  let messages: unknown[] = [];
  let tags: unknown = null;
  let pendingActions: unknown = null;
  try {
    messages = JSON.parse(row.messages as string);
  } catch {
    // empty
  }
  try {
    if (row.tags) tags = JSON.parse(row.tags as string);
  } catch {
    // empty
  }
  try {
    if (row.pending_actions) pendingActions = JSON.parse(row.pending_actions as string);
  } catch {
    // empty
  }

  return Response.json({
    id: row.id,
    title: row.title,
    datasetId: row.dataset_id,
    folderId: row.folder_id,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    tags,
    pendingActions,
  });
}

// PATCH /api/conversations/[id] — partial update
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.messages !== undefined) {
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: "messages must be an array" }, { status: 400 });
    }
    try {
      JSON.stringify(body.messages);
    } catch {
      return Response.json({ error: "messages contains non-serializable data" }, { status: 400 });
    }
  }

  const s = stmts();
  const existing = s.getById.get(id, userId) as Record<string, unknown> | undefined;
  const now = Date.now();

  // If only messages are being updated (most common case), use the optimized statement
  if (body.messages !== undefined &&
      body.title === undefined &&
      body.folderId === undefined &&
      body.datasetId === undefined &&
      body.tags === undefined &&
      body.pendingActions === undefined) {
    s.upsertMessages.run({
      id,
      user_id: userId,
      title: (existing?.title as string) ?? "Untitled",
      dataset_id: (existing?.dataset_id as string | null) ?? null,
      origin: (existing?.origin as string) ?? "user",
      created_at: (existing?.created_at as number) ?? now,
      updated_at: now,
      messages: JSON.stringify(body.messages),
      tags: existing?.tags ? (existing.tags as string) : null,
      pending_actions: existing?.pending_actions ? (existing.pending_actions as string) : null,
    });
  } else {
    s.upsertFull.run({
      id,
      user_id: userId,
      title: body.title !== undefined ? (body.title as string) : (existing?.title as string) ?? "Untitled",
      dataset_id: body.datasetId !== undefined ? (body.datasetId as string | null) : (existing?.dataset_id as string | null ?? null),
      folder_id: body.folderId !== undefined ? (body.folderId as string | null) : (existing?.folder_id as string | null ?? null),
      origin: (existing?.origin as string) ?? "user",
      created_at: (existing?.created_at as number) ?? now,
      updated_at: now,
      tags: body.tags !== undefined ? JSON.stringify(body.tags) : (existing?.tags as string | null ?? null),
      pending_actions: body.pendingActions !== undefined ? JSON.stringify(body.pendingActions) : (existing?.pending_actions as string | null ?? null),
      messages: body.messages !== undefined ? JSON.stringify(body.messages) : (existing?.messages as string ?? "[]"),
    });
  }

  return Response.json({ ok: true });
}

// DELETE /api/conversations/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const s = stmts();
  const result = s.deleteById.run(id, userId);

  if (result.changes === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
