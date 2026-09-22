import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { resolveDataPath } from "@/lib/data-dir";

type RoleplayCollection = "drafts" | "programs" | "scenarios" | "call-scripts";

interface PersistedCollection<T> {
  version: 1;
  items: T[];
}

function collectionPath(datasetId: string, collection: RoleplayCollection): string {
  if (!/^[a-z0-9-]+$/.test(datasetId)) {
    throw new Error(`Invalid dataset id: ${datasetId}`);
  }
  return resolveDataPath("datasets", datasetId, "roleplay", `${collection}.json`);
}

export function readRoleplayCollection<T>(datasetId: string, collection: RoleplayCollection): T[] {
  if (typeof window !== "undefined") return [];

  let path: string;
  try {
    path = collectionPath(datasetId, collection);
  } catch (err) {
    console.error(`[roleplay/${collection}] invalid persistence path:`, err);
    return [];
  }

  if (!existsSync(path)) return [];

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as PersistedCollection<T> | T[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch (err) {
    console.error(`[roleplay/${collection}] could not read persisted data:`, err);
  }

  return [];
}

export function writeRoleplayCollection<T>(datasetId: string, collection: RoleplayCollection, items: T[]): void {
  if (typeof window !== "undefined") return;

  try {
    const path = collectionPath(datasetId, collection);
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.tmp`;
    const payload: PersistedCollection<T> = { version: 1, items };
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    renameSync(tmpPath, path);
  } catch (err) {
    console.error(`[roleplay/${collection}] could not persist data:`, err);
  }
}
