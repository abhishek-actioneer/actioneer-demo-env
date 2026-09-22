import { stmts } from "@/lib/meta-db";
import type { SavedRetention, RetentionConfig } from "@/lib/retention-types";

// ── Types ──

export interface RetentionRow {
  id: string;
  user_id: string;
  dataset_id: string | null;
  name: string;
  description: string;
  config: string; // JSON
  source: string;
  d7_retention: number | null;
  created_at: string;
  updated_at: string;
}

function rowToRetention(row: RetentionRow): SavedRetention {
  let config: RetentionConfig;
  try {
    config = JSON.parse(row.config);
  } catch {
    config = {
      startEventId: "",
      returnEventIds: [],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: { preset: "30d" },
    };
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    config,
    source: (row.source as SavedRetention["source"]) || "manual",
    d7Retention: row.d7_retention,
    datasetId: row.dataset_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Retention CRUD ──

export function listRetentions(userId: string, datasetId: string): SavedRetention[] {
  const s = stmts();
  const rows = s.retentionListByUserDataset.all(userId, datasetId) as RetentionRow[];
  return rows.map(rowToRetention);
}

export function getRetention(userId: string, id: string): SavedRetention | null {
  const s = stmts();
  const row = s.retentionGetById.get(id, userId) as RetentionRow | undefined;
  if (!row) return null;
  return rowToRetention(row);
}

export function upsertRetention(userId: string, retention: {
  id: string;
  name: string;
  description?: string;
  config: RetentionConfig;
  source?: SavedRetention["source"];
  d7Retention?: number | null;
  datasetId?: string;
}): void {
  const s = stmts();
  const now = new Date().toISOString();
  s.retentionUpsert.run({
    id: retention.id,
    user_id: userId,
    dataset_id: retention.datasetId || null,
    name: retention.name,
    description: retention.description || "",
    config: JSON.stringify(retention.config),
    source: retention.source || "manual",
    d7_retention: retention.d7Retention ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function deleteRetention(userId: string, id: string): boolean {
  const s = stmts();
  return s.retentionDelete.run(id, userId).changes > 0;
}
