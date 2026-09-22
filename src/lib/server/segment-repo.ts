import { getDb, stmts } from "@/lib/meta-db";
import type { Segment } from "@/lib/types";
import { deleteActivityForSegment } from "@/lib/server/segment-activity-repo";
import type { SegmentBuilderConfig } from "@/lib/segment-builder-types";

// ── Types ──

export interface SegmentRow {
  id: string;
  name: string;
  sql: string;
  description: string;
  user_count: number;
  push_status: string;
  config: string | null;
  source_conversation_id: string | null;
  dataset_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSegment(row: SegmentRow): Segment {
  let pushStatus: Record<string, "idle" | "pushing" | "synced" | "error"> = {};
  try {
    pushStatus = JSON.parse(row.push_status || "{}");
  } catch { /* ignore */ }
  let config: SegmentBuilderConfig | undefined;
  try {
    config = row.config ? JSON.parse(row.config) as SegmentBuilderConfig : undefined;
  } catch { /* ignore */ }

  return {
    id: row.id,
    name: row.name,
    sql: row.sql.trim().replace(/;+\s*$/, ""),
    config,
    description: row.description || "",
    userCount: row.user_count || 0,
    pushStatus,
    createdAt: row.created_at,
    sourceConversationId: row.source_conversation_id || undefined,
  };
}

// ── Segment CRUD ──

export function listSegments(userId: string, datasetId: string): Segment[] {
  const s = stmts();
  const rows = s.segmentListByUserDataset.all(userId, datasetId) as SegmentRow[];
  return rows.map(rowToSegment);
}

export function getSegment(userId: string, id: string): Segment | null {
  const s = stmts();
  const row = s.segmentGetById.get(id, userId) as SegmentRow | undefined;
  if (!row) return null;
  return rowToSegment(row);
}

export function upsertSegment(userId: string, segment: {
  id: string;
  name: string;
  sql: string;
  description?: string;
  userCount?: number;
  pushStatus?: Record<string, string>;
  config?: SegmentBuilderConfig;
  sourceConversationId?: string;
  datasetId?: string;
}): void {
  const s = stmts();
  const now = new Date().toISOString();
  s.segmentUpsert.run({
    id: segment.id,
    user_id: userId,
    dataset_id: segment.datasetId || null,
    name: segment.name,
    sql: segment.sql,
    description: segment.description || "",
    user_count: segment.userCount ?? 0,
    push_status: JSON.stringify(segment.pushStatus || {}),
    config: segment.config ? JSON.stringify(segment.config) : null,
    source_conversation_id: segment.sourceConversationId || null,
    created_at: now,
    updated_at: now,
  });
}

export function updatePushStatus(
  userId: string,
  id: string,
  pushStatus: Record<string, string>
): boolean {
  const s = stmts();
  const now = new Date().toISOString();
  return s.segmentUpdatePushStatus.run({
    id,
    user_id: userId,
    push_status: JSON.stringify(pushStatus),
    updated_at: now,
  }).changes > 0;
}

export function deleteSegment(userId: string, id: string): boolean {
  const s = stmts();
  const deleted = s.segmentDelete.run(id, userId).changes > 0;
  if (deleted) deleteActivityForSegment(userId, id);
  return deleted;
}

export function migrateSegmentsFromDuckDB(
  userId: string,
  segments: Array<{
    id: string;
    name: string;
    sql: string;
    description?: string;
    userCount?: number;
    pushStatus?: string;
    config?: SegmentBuilderConfig;
    sourceConversationId?: string;
    datasetId?: string;
    createdAt?: string;
  }>
): { imported: number; skipped: number } {
  const db = getDb();
  const s = stmts();
  let imported = 0;
  let skipped = 0;

  const tx = db.transaction(
    (
      items: typeof segments
    ) => {
      for (const seg of items) {
        const now = new Date().toISOString();
        const result = s.segmentInsertIgnore.run({
          id: seg.id,
          user_id: userId,
          dataset_id: seg.datasetId || null,
          name: seg.name,
          sql: seg.sql,
          description: seg.description || "",
          user_count: seg.userCount ?? 0,
          push_status: seg.pushStatus || "{}",
          config: seg.config ? JSON.stringify(seg.config) : null,
          source_conversation_id: seg.sourceConversationId || null,
          created_at: seg.createdAt || now,
          updated_at: now,
        });
        if (result.changes > 0) imported++;
        else skipped++;
      }
    }
  );
  tx(segments);

  return { imported, skipped };
}
