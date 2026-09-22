import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import type { DatasetConfig, SchemaMap } from "./types";
import { buildEnrichedSystemContext } from "@/lib/prompts/schema-generic";
import { fileToTableName } from "./utils";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");
const cache = new Map<string, DatasetConfig>();

function ensureLoaded() {
  if (!existsSync(DATASETS_DIR)) return;

  // Incremental scan: pick up any directories not already in the cache.
  // Self-heals across hot reloads / multiple module instances where a prior
  // upload's reloadDynamicDatasets() didn't reach this instance's cache.
  for (const entry of readdirSync(DATASETS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (cache.has(entry.name)) continue;
    const configPath = join(DATASETS_DIR, entry.name, "config.json");
    if (!existsSync(configPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8")) as DatasetConfig;
      // Migration shim: all existing datasets without sourceType were CSV uploads
      raw.sourceType = raw.sourceType ?? "csv";
      // Legacy CSV datasets may still need viewSQL if CSVs weren't imported.
      // New uploads use CREATE TABLE (materialized) so viewSQL is not needed.
      if (raw.sourceType === "csv" && raw.sourceFiles && raw.sourceFiles.length > 0) {
        const datasetDir = join(DATASETS_DIR, raw.id);
        // Only generate viewSQL if CSV files still exist on disk (legacy datasets)
        const firstCsv = join(datasetDir, raw.sourceFiles[0]);
        if (existsSync(firstCsv)) {
          raw.viewSQL = () =>
            raw.sourceFiles!.map((fileName) => {
              const tableName = fileToTableName(fileName);
              return `CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_csv('${join(datasetDir, fileName)}', auto_detect=true, ignore_errors=true)`;
            });
        }
      }
      raw.isDynamic = true;

      // Overlay schema map if present (enriched fields take priority)
      const schemaMapPath = join(DATASETS_DIR, entry.name, "schema-map.json");
      if (existsSync(schemaMapPath)) {
        try {
          const sm: SchemaMap = JSON.parse(readFileSync(schemaMapPath, "utf-8"));
          if (sm.annotatedSchemaContext) raw.schemaContext = sm.annotatedSchemaContext;
          if (sm.domainHints) raw.domainHints = sm.domainHints;
          if (sm.summaryTableHint) raw.summaryTableHint = sm.summaryTableHint;
          if (sm.multiAgentPrompt) raw.multiAgentPrompt = sm.multiAgentPrompt;
          if (sm.queryDescriptions) raw.queryDescriptions = sm.queryDescriptions;
          if (sm.domainPersona || sm.domainFocus) {
            raw.systemContext = buildEnrichedSystemContext(sm, raw.label, 0);
          }
          if (sm.agents?.length) raw.agents = sm.agents;
          if (sm.userIdField) raw.userIdField = sm.userIdField;
          if (sm.dateField) raw.dateField = sm.dateField;
          if (sm.currency) raw.currency = sm.currency;
          if (sm.suggestedPrompts?.length) raw.suggestedPrompts = sm.suggestedPrompts;
          if (sm.welcomeSubtitle) raw.welcomeSubtitle = sm.welcomeSubtitle;
        } catch {
          // Skip malformed schema map
        }
      }

      // Load auto-generated events if present
      const eventsPath = join(DATASETS_DIR, entry.name, "events.json");
      if (!raw.events?.length && existsSync(eventsPath)) {
        try {
          raw.events = JSON.parse(readFileSync(eventsPath, "utf-8"));
        } catch {
          // Skip malformed events file
        }
      }

      cache.set(raw.id, raw);
    } catch {
      // Skip malformed configs
    }
  }
}

/** Lazily attach events from events.json if missing from a cached config */
function ensureEvents(config: DatasetConfig): void {
  if (config.events?.length) return;
  const eventsPath = join(DATASETS_DIR, config.id, "events.json");
  if (existsSync(eventsPath)) {
    try {
      config.events = JSON.parse(readFileSync(eventsPath, "utf-8"));
    } catch { /* skip malformed */ }
  }
}

export function getDynamicDatasets(): DatasetConfig[] {
  ensureLoaded();
  for (const config of cache.values()) ensureEvents(config);
  return Array.from(cache.values());
}

export function getDynamicDataset(id: string): DatasetConfig | undefined {
  ensureLoaded();
  const config = cache.get(id);
  if (config) ensureEvents(config);
  return config;
}

export function saveDynamicDataset(config: DatasetConfig): void {
  const dir = join(DATASETS_DIR, config.id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Strip non-serializable fields before writing
  const { viewSQL: _viewSQL, ...serializable } = config;
  const configPath = join(dir, "config.json");
  const tmpPath = configPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(serializable, null, 2));
  renameSync(tmpPath, configPath); // atomic on POSIX — crash-safe

  // Update cache — ensureEvents() will lazily load events.json on next read
  cache.set(config.id, config);
}

export function deleteDynamicDataset(id: string): boolean {
  const dir = join(DATASETS_DIR, id);
  if (!existsSync(dir)) return false;

  rmSync(dir, { recursive: true, force: true });
  cache.delete(id);
  return true;
}

/** Force reload from disk (e.g. after upload) */
export function reloadDynamicDatasets(): void {
  cache.clear();
  ensureLoaded();
}
