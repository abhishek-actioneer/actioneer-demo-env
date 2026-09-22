import { getDb, stmts } from "@/lib/meta-db";
import type { AnyPlaybook, PlaybookSummary } from "@/lib/playbook-types";
import { isPlaybookV2, toPlaybookSummary } from "@/lib/playbook-types";


function safeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  return value;
}

// ── Playbook CRUD ──

export function listPlaybookSummaries(userId: string, datasetId: string): PlaybookSummary[] {
  const s = stmts();
  const rows = s.playbookListByUserDataset.all(userId, datasetId) as Array<{
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    schema_version: number;
    dataset_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    category: r.category || "Analytics",
    owner: "",
    ownerInitials: "",
    lastRun: "",
    lastRunStatus: "never" as const,
    usedBy: "Manual Only",
  }));
}

export function getPlaybook(userId: string, id: string): AnyPlaybook | null {
  const s = stmts();
  const row = s.playbookGetById.get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  try {
    const data = JSON.parse(row.data as string) as AnyPlaybook;
    return data;
  } catch {
    return null;
  }
}

export function upsertPlaybook(userId: string, playbook: AnyPlaybook): void {
  const s = stmts();
  const now = new Date().toISOString();
  s.playbookUpsert.run({
    id: playbook.id,
    user_id: userId,
    dataset_id: playbook.datasetId || null,
    name: playbook.name,
    description: playbook.description || null,
    category: playbook.category || "Analytics",
    schema_version: isPlaybookV2(playbook) ? 2 : 1,
    data: JSON.stringify(playbook, safeReplacer),
    created_at: now,
    updated_at: now,
  });
}

export function deletePlaybook(userId: string, id: string): boolean {
  const s = stmts();
  return s.playbookDelete.run(id, userId).changes > 0;
}

export function migratePlaybooksFromLocalStorage(
  userId: string,
  playbooks: AnyPlaybook[]
): { imported: number; skipped: number } {
  const db = getDb();
  const s = stmts();
  let imported = 0;
  let skipped = 0;

  const tx = db.transaction((items: AnyPlaybook[]) => {
    for (const pb of items) {
      const now = new Date().toISOString();
      const result = s.playbookInsertIgnore.run({
        id: pb.id,
        user_id: userId,
        dataset_id: pb.datasetId || null,
        name: pb.name,
        description: pb.description || null,
        category: pb.category || "Analytics",
        schema_version: isPlaybookV2(pb) ? 2 : 1,
        data: JSON.stringify(pb, safeReplacer),
        created_at: now,
        updated_at: now,
      });
      if (result.changes > 0) imported++;
      else skipped++;
    }
  });
  tx(playbooks);

  return { imported, skipped };
}
