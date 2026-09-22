import { auth } from "@clerk/nextjs/server";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { getDataset } from "@/lib/datasets";
import { enrichDataset, loadSchemaMap } from "@/lib/datasets/schema-enricher";
import { saveDynamicDataset, reloadDynamicDatasets } from "@/lib/datasets/dynamic-registry";
import { buildEnrichedSystemContext } from "@/lib/prompts/schema-generic";
import { fileToTableName } from "@/lib/datasets/utils";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const ds = getDataset(id);
    if (!ds.isDynamic) {
      return Response.json({ error: "Cannot enrich static datasets" }, { status: 400 });
    }
    if (ds.ownerId && ds.ownerId !== userId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const datasetDir = join(DATASETS_DIR, id);
    const dbPath = resolve(process.cwd(), ds.dbFile);

    if (!existsSync(dbPath)) {
      return Response.json({ error: "Database file not found" }, { status: 404 });
    }

    // Build view SQL from source files
    const sourceFiles = ds.sourceFiles || [];
    const viewSQLStatements = sourceFiles.map((fileName) => {
      const tn = fileToTableName(fileName);
      return `CREATE OR REPLACE VIEW ${tn} AS SELECT * FROM read_csv('${join(datasetDir, fileName)}', auto_detect=true, ignore_errors=true)`;
    });

    const tables = sourceFiles.map((fileName) => ({
      tableName: fileToTableName(fileName),
      viewSQL: viewSQLStatements,
    }));

    if (tables.length === 0) {
      // Fallback: use primaryTable
      tables.push({ tableName: ds.primaryTable, viewSQL: viewSQLStatements });
    }

    const schemaMap = await enrichDataset({
      dbPath,
      datasetDir,
      tables,
      label: ds.label,
    });

    // Update config with enriched data
    ds.schemaContext = schemaMap.annotatedSchemaContext;
    ds.systemContext = buildEnrichedSystemContext(schemaMap, ds.label, 0);
    ds.domainHints = schemaMap.domainHints;
    ds.summaryTableHint = schemaMap.summaryTableHint;
    ds.multiAgentPrompt = schemaMap.multiAgentPrompt;
    ds.queryDescriptions = schemaMap.queryDescriptions;
    ds.agents = schemaMap.agents;
    ds.suggestedPrompts = schemaMap.suggestedPrompts;
    ds.welcomeSubtitle = schemaMap.welcomeSubtitle;

    saveDynamicDataset(ds);
    reloadDynamicDatasets();

    return Response.json({ success: true, domain: schemaMap.domain, schemaMap });
  } catch (err) {
    console.error(`[enrich] Error for ${id}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Enrichment failed: ${message}` }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify visibility
  const ds = getDataset(id);
  if (ds.ownerId && ds.ownerId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const datasetDir = join(DATASETS_DIR, id);
  const schemaMap = loadSchemaMap(datasetDir);

  if (!schemaMap) {
    return Response.json({ error: "No schema map found" }, { status: 404 });
  }

  return Response.json(schemaMap);
}
