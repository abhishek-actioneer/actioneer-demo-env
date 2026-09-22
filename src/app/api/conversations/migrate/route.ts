import { auth } from "@clerk/nextjs/server";
import { getDb, stmts } from "@/lib/meta-db";

interface MigrateConversation {
  id: string;
  title: string;
  messages: unknown[];
  createdAt: number;
  updatedAt: number;
  origin?: string;
  datasetId?: string;
  folderId?: string;
  tags?: unknown;
  pendingActions?: unknown;
}

// POST /api/conversations/migrate — bulk import from localStorage
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: { conversations?: MigrateConversation[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.conversations || !Array.isArray(body.conversations)) {
    return Response.json({ error: "conversations array required" }, { status: 400 });
  }

  const db = getDb();
  const s = stmts();
  let imported = 0;
  let skipped = 0;

  // Strip volatile variants from messages
  const stripVolatile = (messages: unknown[]) =>
    messages.filter((message) => {
      if (!message || typeof message !== "object") {
        return true;
      }
      const m = message as { variant?: unknown };
      return m.variant !== "gathering" && m.variant !== "streaming";
    });

  // Batch insert in a transaction for performance
  const insertBatch = db.transaction((convs: MigrateConversation[]) => {
    for (const conv of convs) {
      if (!conv.id || !conv.title) {
        skipped++;
        continue;
      }
      const stripped = stripVolatile(conv.messages || []);
      const result = s.insertOrIgnore.run({
        id: conv.id,
        user_id: userId,
        title: conv.title,
        dataset_id: conv.datasetId || null,
        folder_id: conv.folderId || null,
        origin: conv.origin || "user",
        created_at: conv.createdAt || Date.now(),
        updated_at: conv.updatedAt || Date.now(),
        tags: conv.tags ? JSON.stringify(conv.tags) : null,
        pending_actions: conv.pendingActions ? JSON.stringify(conv.pendingActions) : null,
        messages: JSON.stringify(stripped),
      });
      if (result.changes > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
  });

  // Process in batches of 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < body.conversations.length; i += BATCH_SIZE) {
    const batch = body.conversations.slice(i, i + BATCH_SIZE);
    insertBatch(batch);
  }

  return Response.json({ imported, skipped });
}
