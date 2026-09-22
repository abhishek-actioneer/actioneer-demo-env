import { auth } from "@clerk/nextjs/server";
import {
  getPlaybook,
  upsertPlaybook,
  deletePlaybook,
} from "@/lib/server/playbook-repo";
import { isPlaybookV2, type AnyPlaybook } from "@/lib/playbook-types";

function summarizePlaybookForLog(playbook: AnyPlaybook) {
  if (!isPlaybookV2(playbook)) {
    return {
      id: playbook.id,
      name: playbook.name,
      schemaVersion: 1,
      datasetId: playbook.datasetId,
      cellCount: playbook.cells.length,
    };
  }
  const sqlCells = playbook.cells.filter((cell) => cell.type === "sql");
  return {
    id: playbook.id,
    name: playbook.name,
    schemaVersion: 2,
    datasetId: playbook.datasetId,
    cellCount: playbook.cells.length,
    sqlCount: sqlCells.length,
    missingSql: sqlCells.filter((cell) => !cell.sql?.trim()).map((cell) => cell.id),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const playbook = getPlaybook(userId, id);
  if (!playbook) {
    console.log("[playbooks-api] get:not_found", { userId, id });
    return Response.json({ error: "Playbook not found" }, { status: 404 });
  }
  console.log("[playbooks-api] get", { userId, playbook: summarizePlaybookForLog(playbook) });
  return Response.json(playbook);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Ensure the id in URL matches the body
  const playbook = { ...body, id } as AnyPlaybook;
  console.log("[playbooks-api] put", { userId, playbook: summarizePlaybookForLog(playbook) });
  upsertPlaybook(userId, playbook);
  return Response.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Get existing, merge, upsert (create-on-miss)
  const existing = getPlaybook(userId, id);
  if (existing) {
    const merged = { ...existing, ...body, id };
    const playbook = merged as AnyPlaybook;
    console.log("[playbooks-api] patch:update", { userId, playbook: summarizePlaybookForLog(playbook) });
    upsertPlaybook(userId, playbook);
  } else {
    // Create on miss — client may believe it exists
    const playbook = { ...body, id } as AnyPlaybook;
    console.log("[playbooks-api] patch:create_on_miss", { userId, playbook: summarizePlaybookForLog(playbook) });
    upsertPlaybook(userId, playbook);
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  console.log("[playbooks-api] delete", { userId, id });
  deletePlaybook(userId, id);
  return Response.json({ ok: true });
}
