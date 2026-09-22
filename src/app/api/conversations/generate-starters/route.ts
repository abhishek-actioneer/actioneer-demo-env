import { auth } from "@clerk/nextjs/server";
import { getDatasetForUser } from "@/lib/datasets";
import { seedStarterChatsForDataset } from "@/lib/server/starter-chats-registry";

// POST /api/conversations/generate-starters — seed handcrafted starter chats
// for a sample dataset so a fresh workspace is never empty. Idempotent.
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const datasetId =
    (body as { datasetId?: string }).datasetId ||
    req.headers.get("x-dataset-id") ||
    "";

  if (!datasetId) {
    return Response.json({ error: "datasetId is required" }, { status: 400 });
  }
  if (!getDatasetForUser(datasetId, userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const seeded = seedStarterChatsForDataset(userId, datasetId);
    return Response.json({ seeded });
  } catch (err) {
    console.error(`[conversations/generate-starters] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Seeding failed: ${message}` }, { status: 500 });
  }
}
