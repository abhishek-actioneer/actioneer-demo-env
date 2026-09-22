import { stmts } from "@/lib/meta-db";

export interface FolderRow {
  id: string;
  user_id: string;
  dataset_id: string | null;
  name: string;
  created_at: string;
}

export interface FolderData {
  id: string;
  name: string;
  datasetId?: string;
  createdAt: string;
}

function rowToFolder(row: FolderRow): FolderData {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.dataset_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function listFolders(userId: string): FolderData[] {
  const rows = stmts().folderListByUser.all(userId) as FolderRow[];
  return rows.map(rowToFolder);
}

export function upsertFolder(userId: string, folder: FolderData): void {
  stmts().folderUpsert.run({
    id: folder.id,
    user_id: userId,
    dataset_id: folder.datasetId ?? null,
    name: folder.name,
    created_at: folder.createdAt,
  });
}

export function deleteFolder(userId: string, id: string): void {
  stmts().folderDelete.run(id, userId);
}
