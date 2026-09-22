import { generateJson } from "../llm";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { profileTable, type TableProfile, type ColumnProfile } from "./data-profiler";
import type { SchemaMap, AgentSpec } from "./types";
import { generateMetricDefinitions } from "./metric-generator";
import { generateEventsFromSchema } from "./event-generator";
import {
  buildColumnAnalysisPrompt,
  buildPromptGenerationInput,
  type ColumnAnalysis,
} from "@/lib/prompts/dataset-enrichment";

async function analyzeColumns(profiles: TableProfile[], label: string): Promise<ColumnAnalysis> {
  const prompt = buildColumnAnalysisPrompt(profiles, label);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await generateJson(prompt, {
      label: "schema-enricher-columns",
      timeoutMs: 120_000,
      // Wide multi-table datasets (15+ tables, 200-400 columns) produce large
      // column maps — 4096 truncated mid-JSON and silently degraded enrichment
      maxOutputTokens: 32_768,
    });
  } catch (err) {
    console.warn("[schema-enricher] Failed to parse column analysis JSON, using empty fallback:", err instanceof Error ? err.message : err);
    json = { columns: {}, domain: "general data" };
  }

  // Merge in statistical data from profiler
  const columns = json.columns ?? {};
  for (const table of profiles) {
    for (const col of table.columns) {
      if (columns[col.name]) {
        const meta = columns[col.name];
        meta.nullRate = col.totalCount > 0 ? col.nullCount / col.totalCount : 0;
        meta.sampleValues = col.sampleValues.length > 0 ? col.sampleValues : undefined;
        meta.cardinalityHint = getCardinalityHint(col);
      }
    }
  }

  // Sanitize userIdField/dateField — LLM may return "none", "null", "", or an actual column name
  let userIdField: string | undefined = json.userIdField;
  if (!userIdField || userIdField === "none" || userIdField === "null" || userIdField === "N/A") {
    userIdField = undefined;
  }
  let dateField: string | undefined = json.dateField;
  if (!dateField || dateField === "none" || dateField === "null" || dateField === "N/A") {
    dateField = undefined;
  }

  return {
    columns: columns,
    userIdField,
    dateField,
    domain: json.domain || "general data",
    domainPersona: json.domainPersona || "data analytics assistant",
    domainFocus: json.domainFocus || "Focus on identifying key patterns and actionable insights.",
    currency: json.currency || undefined,
  };
}

function getCardinalityHint(col: ColumnProfile): "low" | "medium" | "high" | "unique" {
  if (col.totalCount === 0) return "low";
  const ratio = col.distinctCount / col.totalCount;
  if (ratio > 0.95) return "unique";
  if (col.distinctCount <= 10) return "low";
  if (col.distinctCount <= 100) return "medium";
  return "high";
}

// ── Step 2: Prompt generation (dynamic agent selection) ──────────────

interface PromptSet {
  domainHints: string;
  summaryTableHint: string;
  agents: AgentSpec[];
  annotatedSchemaContext: string;
  suggestedPrompts: string[];
  welcomeSubtitle: string;
}


async function generatePrompts(
  analysis: ColumnAnalysis,
  profiles: TableProfile[],
  label: string,
): Promise<PromptSet> {
  const prompt = buildPromptGenerationInput(analysis, profiles, label);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await generateJson(prompt, {
      label: "schema-enricher-prompts",
      timeoutMs: 120_000,
      maxOutputTokens: 16_384,
    });
  } catch (err) {
    console.warn("[schema-enricher] Failed to parse prompt generation JSON, using empty fallback:", err instanceof Error ? err.message : err);
    json = {};
  }

  // Validate agents array
  const VALID_IDS = new Set(["data-quality", "daily-metrics", "cohort-retention", "rev-opt", "user-segmentation", "geographic", "crm-analytics", "paid-marketing", "growth-analytics", "unit-economics"]);
  let agents: AgentSpec[] = [];
  if (Array.isArray(json.agents)) {
    agents = json.agents
      .filter((a: AgentSpec) => a.id && VALID_IDS.has(a.id) && Array.isArray(a.queries) && a.queries.length > 0)
      .map((a: AgentSpec) => ({
        id: a.id,
        queries: a.queries.slice(0, 8).map((q) => ({
          description: q.description || `Query`,
          hint: q.hint || "",
        })),
      }));
  }

  // Ensure at least data-quality + rev-opt as fallback
  if (agents.length < 2) {
    agents = [
      { id: "data-quality", queries: [
        { description: "NULL rates & field completeness", hint: "COUNT(*), COUNT(col) for each column" },
        { description: "Volume anomaly detection", hint: "COUNT(*) GROUP BY date column" },
        { description: "Duplicate record check", hint: "COUNT(*) vs COUNT(DISTINCT id)" },
        { description: "Value range validation", hint: "MIN/MAX/AVG for numeric columns" },
      ]},
      { id: "daily-metrics", queries: [
        { description: "Daily volume trends", hint: "COUNT(*) GROUP BY date" },
        { description: "Key metric trends over time", hint: "AVG/SUM of metric columns by date" },
        { description: "Week-over-week comparison", hint: "DATE_TRUNC week, compare consecutive periods" },
        { description: "Peak and trough detection", hint: "ORDER BY metric DESC/ASC LIMIT 10" },
      ]},
      { id: "rev-opt", queries: [
        { description: "Primary metric analysis", hint: "Aggregate primary value metrics" },
        { description: "Dimensional breakdown", hint: "GROUP BY key dimensions" },
        { description: "Top-N ranking", hint: "ORDER BY value DESC LIMIT 20" },
        { description: "Distribution analysis", hint: "NTILE or CASE WHEN for bucketing" },
      ]},
    ];
  }

  // Validate suggestedPrompts
  const suggestedPrompts: string[] = Array.isArray(json.suggestedPrompts)
    ? json.suggestedPrompts.slice(0, 6)
    : [];

  return {
    domainHints: json.domainHints || "",
    summaryTableHint: json.summaryTableHint || `Query the ${profiles[0]?.tableName || "data"} table directly.`,
    agents,
    annotatedSchemaContext: json.annotatedSchemaContext || "",
    suggestedPrompts,
    welcomeSubtitle: json.welcomeSubtitle || `Ask anything about your ${label} data.`,
  };
}

/** Extract the most likely date field from profiled columns */
function findDateFieldFromProfiles(profiles: TableProfile[]): string | undefined {
  const datePatterns = /^(date|time|timestamp|created_?at|updated_?at|event_?at|event_?date|occurred_?at|session_?date|booking_?date)$/i;
  for (const table of profiles) {
    for (const col of table.columns) {
      if (datePatterns.test(col.name)) return col.name;
      if (col.type.toLowerCase().includes("date") || col.type.toLowerCase().includes("timestamp")) return col.name;
    }
  }
  return undefined;
}

/** Inject ENTITY METADATA block into the annotated schema context so all downstream SQL prompts know the key columns. */
function injectEntityMetadata(schema: string, userIdField?: string, dateField?: string): string {
  if (!userIdField && !dateField) return schema;
  const lines: string[] = ["\nENTITY METADATA:"];
  if (userIdField) lines.push(`  Primary entity identifier: ${userIdField} — use this column for SELECT DISTINCT, COUNT(DISTINCT), segment definitions, cohort analysis, and entity-level joins.`);
  if (dateField) lines.push(`  Primary date column: ${dateField} — use this column for time-series analysis, DATE_TRUNC, trend charts, and period filtering. May be stored as VARCHAR — cast with ::TIMESTAMP or strptime() as needed.`);
  return schema + "\n" + lines.join("\n");
}

// ── Orchestrator ─────────────────────────────────────────────────────

export interface EnrichmentInput {
  dbPath: string;
  datasetDir: string;
  tables: { tableName: string; viewSQL?: string[] }[];
  label: string;
}

/**
 * Run the full 2-step enrichment pipeline: profile → analyze → generate prompts.
 * Saves the result to schema-map.json alongside the dataset config.
 */
export async function enrichDataset(input: EnrichmentInput): Promise<SchemaMap> {
  const { dbPath, datasetDir, tables, label } = input;

  // Step 0: Profile all tables
  console.log(`[schema-enricher] profiling ${tables.length} table(s) for "${label}"`);
  const allViewSQL = tables.flatMap((t) => t.viewSQL || []);
  const profiles: TableProfile[] = [];
  for (const table of tables) {
    const profile = await profileTable(dbPath, table.tableName, allViewSQL.length > 0 ? allViewSQL : undefined);
    profiles.push(profile);
  }

  // Step 1: Column-level analysis
  console.log(`[schema-enricher] step 1: analyzing columns`);
  const columnAnalysis = await analyzeColumns(profiles, label);
  console.log(`[schema-enricher] detected domain: "${columnAnalysis.domain}"`);

  // Step 2: Prompt generation
  console.log(`[schema-enricher] step 2: generating prompts`);
  const promptSet = await generatePrompts(columnAnalysis, profiles, label);

  // Derive backward-compat fields from agents
  const multiAgentPrompt = promptSet.agents
    .flatMap((a) => a.queries.map((q, i) => `${a.id}|${i + 1}| — ${q.description}`))
    .join("\n");
  const queryDescriptions: Record<string, string[]> = {};
  for (const agent of promptSet.agents) {
    queryDescriptions[agent.id] = agent.queries.map((q) => q.description);
  }

  // Assemble SchemaMap
  const schemaMap: SchemaMap = {
    columns: columnAnalysis.columns,
    userIdField: columnAnalysis.userIdField,
    dateField: columnAnalysis.dateField,
    domain: columnAnalysis.domain,
    domainPersona: columnAnalysis.domainPersona,
    domainFocus: columnAnalysis.domainFocus,
    currency: columnAnalysis.currency,
    domainHints: promptSet.domainHints,
    summaryTableHint: promptSet.summaryTableHint,
    agents: promptSet.agents,
    multiAgentPrompt,
    queryDescriptions,
    annotatedSchemaContext: injectEntityMetadata(
      promptSet.annotatedSchemaContext,
      columnAnalysis.userIdField,
      columnAnalysis.dateField,
    ),
    suggestedPrompts: promptSet.suggestedPrompts,
    welcomeSubtitle: promptSet.welcomeSubtitle,
  };

  // Save schema map to disk
  const mapPath = join(datasetDir, "schema-map.json");
  writeFileSync(mapPath, JSON.stringify(schemaMap, null, 2));
  console.log(`[schema-enricher] saved schema map to ${mapPath}`);

  // Step 3: Generate metric definitions
  console.log(`[schema-enricher] step 3: generating metric definitions`);
  try {
    const metrics = await generateMetricDefinitions(schemaMap, label);
    if (metrics.length > 0) {
      const metricsPath = join(datasetDir, "metrics.json");
      writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
      console.log(`[schema-enricher] saved ${metrics.length} metric definitions to ${metricsPath}`);
    } else {
      console.warn(`[schema-enricher] no metrics generated for "${label}"`);
    }
  } catch (err) {
    console.error(`[schema-enricher] metric generation failed (non-fatal):`, err);
  }

  // Step 4: Generate events via LLM
  console.log(`[schema-enricher] step 4: generating events via LLM`);
  try {
    const eventsDateField = columnAnalysis.dateField || findDateFieldFromProfiles(profiles);
    const events = await generateEventsFromSchema(schemaMap, label, eventsDateField);
    if (events.length > 0) {
      const eventsPath = join(datasetDir, "events.json");
      writeFileSync(eventsPath, JSON.stringify(events, null, 2));
      console.log(`[schema-enricher] saved ${events.length} LLM-generated events to ${eventsPath}`);
    } else {
      console.warn(`[schema-enricher] no events generated for "${label}"`);
    }
  } catch (err) {
    console.error(`[schema-enricher] event generation failed (non-fatal):`, err);
  }

  return schemaMap;
}

/** Load a schema map from disk (if it exists) */
export function loadSchemaMap(datasetDir: string): SchemaMap | null {
  const mapPath = join(datasetDir, "schema-map.json");
  if (!existsSync(mapPath)) return null;
  try {
    return JSON.parse(readFileSync(mapPath, "utf-8"));
  } catch {
    return null;
  }
}
