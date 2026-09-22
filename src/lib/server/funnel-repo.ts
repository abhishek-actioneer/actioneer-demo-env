import { stmts } from "@/lib/meta-db";
import type { SavedFunnel, FunnelConfig } from "@/lib/funnel-types";

// ── Types ──

export interface FunnelRow {
  id: string;
  user_id: string;
  dataset_id: string | null;
  name: string;
  description: string;
  config: string; // JSON
  source: string;
  overall_conversion: number | null;
  created_at: string;
  updated_at: string;
}

function rowToFunnel(row: FunnelRow): SavedFunnel {
  let config: FunnelConfig;
  try {
    config = JSON.parse(row.config);
  } catch {
    config = { steps: [], conversionWindow: "30d", order: "this_order", dateRange: { preset: "30d" } };
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    config,
    source: (row.source as SavedFunnel["source"]) || "manual",
    overallConversion: row.overall_conversion,
    datasetId: row.dataset_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Funnel CRUD ──

export function listFunnels(userId: string, datasetId: string): SavedFunnel[] {
  const s = stmts();
  const rows = s.funnelListByUserDataset.all(userId, datasetId) as FunnelRow[];
  return rows.map(rowToFunnel);
}

export function getFunnel(userId: string, id: string): SavedFunnel | null {
  const s = stmts();
  const row = s.funnelGetById.get(id, userId) as FunnelRow | undefined;
  if (!row) return null;
  return rowToFunnel(row);
}

export function upsertFunnel(userId: string, funnel: {
  id: string;
  name: string;
  description?: string;
  config: FunnelConfig;
  source?: SavedFunnel["source"];
  overallConversion?: number | null;
  datasetId?: string;
}): void {
  const s = stmts();
  const now = new Date().toISOString();
  s.funnelUpsert.run({
    id: funnel.id,
    user_id: userId,
    dataset_id: funnel.datasetId || null,
    name: funnel.name,
    description: funnel.description || "",
    config: JSON.stringify(funnel.config),
    source: funnel.source || "manual",
    overall_conversion: funnel.overallConversion ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function deleteFunnel(userId: string, id: string): boolean {
  const s = stmts();
  return s.funnelDelete.run(id, userId).changes > 0;
}
