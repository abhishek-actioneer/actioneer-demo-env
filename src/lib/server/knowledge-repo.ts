import { stmts, getDb } from "@/lib/meta-db";
import type { KnowledgeEntry } from "@/lib/knowledge-types";

interface KnowledgeRow {
  id: string;
  title: string | null;
  content: string;
  level: KnowledgeEntry["level"];
  category: KnowledgeEntry["category"];
  priority: KnowledgeEntry["priority"];
  source: KnowledgeEntry["source"];
  date_added: string;
  added_by: string;
  reference_thread: string | null;
  source_conversation_id: string | null;
  source_url: string | null;
}

function fromRow(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title ?? undefined,
    content: row.content,
    level: row.level,
    category: row.category,
    priority: row.priority,
    source: row.source,
    dateAdded: row.date_added,
    addedBy: row.added_by,
    referenceThread: row.reference_thread ?? undefined,
    sourceConversationId: row.source_conversation_id ?? undefined,
    sourceUrl: row.source_url ?? undefined,
  };
}

function params(userId: string, datasetId: string, entry: KnowledgeEntry) {
  return {
    id: entry.id,
    user_id: userId,
    dataset_id: datasetId,
    title: entry.title ?? null,
    content: entry.content,
    level: entry.level,
    category: entry.category,
    priority: entry.priority,
    source: entry.source,
    date_added: entry.dateAdded,
    added_by: entry.addedBy,
    reference_thread: entry.referenceThread ?? null,
    source_conversation_id: entry.sourceConversationId ?? null,
    source_url: entry.sourceUrl ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function listPersistedKnowledge(userId: string, datasetId: string): KnowledgeEntry[] {
  return (stmts().knowledgeListByUserDataset.all(userId, datasetId) as KnowledgeRow[]).map(fromRow);
}

export function upsertPersistedKnowledge(
  userId: string,
  datasetId: string,
  entries: KnowledgeEntry[],
): KnowledgeEntry[] {
  const run = getDb().transaction((items: KnowledgeEntry[]) => {
    for (const entry of items) stmts().knowledgeUpsert.run(params(userId, datasetId, entry));
  });
  run(entries);
  return entries;
}

export function deletePersistedKnowledge(userId: string, datasetId: string, id: string): boolean {
  return stmts().knowledgeDelete.run(id, userId, datasetId).changes > 0;
}

export function isKnowledgeDatasetCleared(userId: string, datasetId: string): boolean {
  return Boolean(stmts().knowledgeDatasetResetGet.get(userId, datasetId));
}

export function clearKnowledgeDataset(userId: string, datasetId: string): number {
  const clear = getDb().transaction(() => {
    const deleted = stmts().knowledgeDeleteByUserDataset.run(userId, datasetId).changes;
    stmts().knowledgeDatasetResetUpsert.run({
      user_id: userId,
      dataset_id: datasetId,
      cleared_at: new Date().toISOString(),
    });
    return deleted;
  });
  return clear();
}
