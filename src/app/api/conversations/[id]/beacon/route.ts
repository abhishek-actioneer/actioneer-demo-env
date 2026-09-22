import { auth } from "@clerk/nextjs/server";
import { stmts } from "@/lib/meta-db";

// POST /api/conversations/[id]/beacon
// Lightweight endpoint for navigator.sendBeacon during page unload.
// Accepts {messages: ChatMessage[]} and writes to SQLite.
// No meaningful response needed — sendBeacon is fire-and-forget.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 401 });

  const { id } = await params;

  let body: { messages?: unknown[]; tags?: unknown; pendingActions?: unknown; title?: string; datasetId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(null, { status: 400 });
  }

  // Strip volatile variants (gathering, streaming) before persisting
  const stripped = body.messages.filter((m) => {
    if (typeof m === "object" && m !== null) {
      const msg = m as { variant?: unknown };
      return msg.variant !== "gathering" && msg.variant !== "streaming";
    }
    return true;
  });

  const s = stmts();
  const now = Date.now();

  try {
    s.upsertMessages.run({
      id,
      user_id: userId,
      title: body.title || "Untitled",
      dataset_id: body.datasetId || null,
      origin: "user",
      created_at: now,
      updated_at: now,
      messages: JSON.stringify(stripped),
      tags: body.tags ? JSON.stringify(body.tags) : null,
      pending_actions: body.pendingActions ? JSON.stringify(body.pendingActions) : null,
    });
  } catch (err) {
    console.error("[beacon:conversation] save failed:", err);
  }

  return new Response(null, { status: 204 });
}
