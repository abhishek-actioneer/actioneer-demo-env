import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";
import { getDataset } from "@/lib/datasets";
import type { SchemaMap } from "@/lib/datasets/types";

export const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

/**
 * Load a SchemaMap for the given dataset.
 * Returns null when no schema data is available.
 * Routes should return a 404 response when this returns null.
 */
export function loadSchemaMap(datasetId: string): SchemaMap | null {
  const ds = getDataset(datasetId);
  const schemaMapPath = join(DATASETS_DIR, datasetId, "schema-map.json");
  if (existsSync(schemaMapPath)) {
    return JSON.parse(readFileSync(schemaMapPath, "utf-8")) as SchemaMap;
  }
  if (ds.schemaContext) {
    return {
      columns: {},
      userIdField: ds.userIdField,
      dateField: ds.dateField,
      domain: ds.label,
      domainPersona: "",
      domainFocus: "",
      domainHints: ds.domainHints || "",
      summaryTableHint: ds.summaryTableHint || "",
      agents: ds.agents || [],
      multiAgentPrompt: ds.multiAgentPrompt || "",
      queryDescriptions: ds.queryDescriptions || {},
      annotatedSchemaContext: ds.schemaContext,
      suggestedPrompts: ds.suggestedPrompts || [],
      welcomeSubtitle: ds.welcomeSubtitle || "",
    };
  }
  return null;
}
