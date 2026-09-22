import { auth } from "@clerk/nextjs/server";
import {
  listPlaybookSummaries,
  upsertPlaybook,
  migratePlaybooksFromLocalStorage,
} from "@/lib/server/playbook-repo";
import { seedPlaybooksForDataset } from "@/lib/server/playbook-seed-registry";
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

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id");
  if (!datasetId)
    return Response.json({ error: "x-dataset-id required" }, { status: 400 });

  let seeded = 0;
  try {
    seeded = seedPlaybooksForDataset(userId, datasetId);
  } catch (err) {
    console.error("[playbooks-api] seed failed", { userId, datasetId, err });
  }
  if (seeded > 0) {
    console.log("[playbooks-api] seed", { userId, datasetId, seeded });
  }

  const summaries = listPlaybookSummaries(userId, datasetId);
  console.log("[playbooks-api] list", { userId, datasetId, count: summaries.length });
  return Response.json(summaries);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: { playbook?: AnyPlaybook; migrate?: AnyPlaybook[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Migration: bulk import from localStorage
  if (body.migrate && Array.isArray(body.migrate)) {
    console.log("[playbooks-api] migrate:start", { userId, count: body.migrate.length });
    const result = migratePlaybooksFromLocalStorage(userId, body.migrate);
    console.log("[playbooks-api] migrate:done", { userId, result });
    return Response.json(result);
  }

  // Single upsert
  if (!body.playbook || !body.playbook.id || !body.playbook.name) {
    return Response.json(
      { error: "playbook with id and name required" },
      { status: 400 }
    );
  }

  console.log("[playbooks-api] create/upsert", { userId, playbook: summarizePlaybookForLog(body.playbook) });
  upsertPlaybook(userId, body.playbook);
  return Response.json({ ok: true, id: body.playbook.id }, { status: 201 });
}
