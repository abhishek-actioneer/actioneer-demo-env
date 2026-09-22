import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";
import { auth } from "@clerk/nextjs/server";
import { getDatasetForUser } from "@/lib/datasets";
import { getAllEntries } from "@/lib/knowledge-store";
import type { KnowledgeEntry } from "@/lib/knowledge-types";
import { isKnowledgeDatasetCleared, listPersistedKnowledge } from "@/lib/server/knowledge-repo";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

/** Load knowledge entries from disk (knowledge.json) if available */
function loadFromDisk(datasetId: string): KnowledgeEntry[] | null {
  const filePath = join(DATASETS_DIR, datasetId, "knowledge.json");
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!datasetId) {
    return Response.json({ error: "x-dataset-id header required" }, { status: 400 });
  }

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  // Curated disk entries remain the shared dataset baseline. User-created
  // entries (including complete scraper-rendered pages) live in SQLite.
  const datasetCleared = isKnowledgeDatasetCleared(userId, datasetId);
  const memoryEntries = datasetCleared ? [] : getAllEntries(datasetId);
  const diskEntries = datasetCleared ? [] : (loadFromDisk(datasetId) ?? []);
  const persistedEntries = listPersistedKnowledge(userId, datasetId);
  const merged = new Map<string, KnowledgeEntry>();
  for (const entry of [...diskEntries, ...memoryEntries, ...persistedEntries]) {
    merged.set(entry.id, entry);
  }
  return Response.json({ entries: Array.from(merged.values()) });
}
