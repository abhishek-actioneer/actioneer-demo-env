import { resolve, join } from "path";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { loadSchemaMap } from "@/lib/datasets/schema-loader";
import { saveKnowledgeEntry } from "@/lib/knowledge-store";
import { generateKnowledgeForDataset } from "@/lib/knowledge-generator";
import { z } from "zod/v4";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

const BodySchema = z.object({ datasetId: z.string().min(1) });

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  const datasetId =
    parsed.data?.datasetId || req.headers.get("x-dataset-id") || "";

  if (!datasetId) {
    return Response.json({ error: "datasetId is required" }, { status: 400 });
  }

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const ds = getDataset(datasetId);

    // Prefer the curated knowledge.json shipped on disk. It's reviewed,
    // data-grounded "tribal knowledge" — deterministic and high quality, so it's
    // what every demo should show. The LLM generator below is only a fallback for
    // datasets that don't ship a curated file yet (which is also why brand-new
    // datasets used to hard-fail here: large schemas made the LLM return nothing
    // and there was no curated file to fall back to).
    const diskPath = join(DATASETS_DIR, datasetId, "knowledge.json");
    if (existsSync(diskPath)) {
      try {
        const diskEntries = JSON.parse(readFileSync(diskPath, "utf-8"));
        if (Array.isArray(diskEntries) && diskEntries.length > 0) {
          for (const entry of diskEntries) saveKnowledgeEntry(datasetId, entry);
          return Response.json({ count: diskEntries.length, entries: diskEntries, saved: true, source: "curated" });
        }
      } catch {
        // Corrupt curated file — fall through to LLM generation.
      }
    }

    const schemaMap = loadSchemaMap(datasetId);
    if (!schemaMap) {
      return Response.json(
        { error: "No schema data available. Enrich the dataset first." },
        { status: 404 },
      );
    }

    const entries = await generateKnowledgeForDataset(
      schemaMap,
      datasetId,
      ds.label,
      ds.primaryTable,
    );

    if (entries.length === 0) {
      return Response.json({ error: "No valid knowledge entries generated" }, { status: 500 });
    }

    // Save to in-memory store
    for (const entry of entries) {
      saveKnowledgeEntry(datasetId, entry);
    }

    // Persist to disk so entries survive server restarts
    try {
      const knowledgePath = join(DATASETS_DIR, datasetId, "knowledge.json");
      writeFileSync(knowledgePath, JSON.stringify(entries, null, 2));
      console.log(`[knowledge/generate] Persisted ${entries.length} entries to ${knowledgePath}`);
    } catch (diskErr) {
      console.warn("[knowledge/generate] Failed to persist to disk (non-fatal):", diskErr);
    }

    return Response.json({ count: entries.length, entries, saved: true });
  } catch (err) {
    console.error(`[knowledge/generate] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
