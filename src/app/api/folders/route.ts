import { auth } from "@clerk/nextjs/server";
import { listFolders, upsertFolder, deleteFolder } from "@/lib/server/folder-repo";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const folders = listFolders(userId);
  return Response.json(folders);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, name, datasetId, createdAt } = body;
  if (!id || !name) return Response.json({ error: "id and name required" }, { status: 400 });

  upsertFolder(userId, { id, name, datasetId, createdAt: createdAt ?? new Date().toISOString() });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  deleteFolder(userId, id);
  return Response.json({ ok: true });
}
