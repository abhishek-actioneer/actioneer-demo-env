import { auth } from "@clerk/nextjs/server";
import { stmts } from "@/lib/meta-db";

// GET /api/conversations — list summaries
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || undefined;
  const s = stmts();

  const rows = datasetId
    ? s.listSummariesByDataset.all(userId, datasetId)
    : s.listSummaries.all(userId);

  return Response.json(rows);
}

// POST /api/conversations — create
export async function POST(req: Request) {
  let body: { id: string; title: string; datasetId?: string; origin?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.id || !body.title) {
    return Response.json({ error: "id and title required" }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const now = Date.now();
  const s = stmts();

  try {
    s.insertOrIgnore.run({
      id: body.id,
      user_id: userId,
      title: body.title,
      dataset_id: body.datasetId || null,
      folder_id: null,
      origin: body.origin || "user",
      created_at: now,
      updated_at: now,
      tags: null,
      pending_actions: null,
      messages: "[]",
    });
  } catch (err: unknown) {
    throw err;
  }

  return Response.json({ ok: true, id: body.id }, { status: 201 });
}
