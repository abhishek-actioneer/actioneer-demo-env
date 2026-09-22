/**
 * Ingest the YesBank_Cards_Demo CSV bundle as a shared-sample dynamic dataset.
 *
 * Mirrors scripts/setup-hdfc-creditfraud.ts: materialized tables → customer_id
 * stamping → LLM enrichment → saveDynamicDataset. Registered with isSample: true
 * (no ownerId) so it is visible to every account and appears in onboarding.
 *
 * Source: ~/Downloads/Archives/YesBank_Cards_Demo/
 * Creates: data/datasets/yesbank-cards/ (duckdb + config.json + schema-map.json + events.json)
 *
 * Usage: npx tsx scripts/setup-yesbank-cards.ts
 * Requires in .env.local: OPENAI_API_KEY (enrichment)
 */

import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { getOrCreateInstance } from "../src/lib/db";
import { saveDynamicDataset } from "../src/lib/datasets/dynamic-registry";
import { enrichDataset } from "../src/lib/datasets/schema-enricher";
import { fileToTableName } from "../src/lib/datasets/utils";
import {
  buildGenericSystemContext,
  buildGenericQueryDescriptions,
  buildGenericMultiAgentPrompt,
  buildEnrichedSystemContext,
} from "../src/lib/prompts/schema-generic";
import type { DatasetConfig, AgentSpec } from "../src/lib/datasets/types";

const SOURCE_DIR = resolve(process.env.HOME || "~", "Downloads/Archives/YesBank_Cards_Demo");
const DATASET_ID = "yesbank-cards";
const LABEL = "YesBank Cards Growth";
const DATASET_DIR = resolve(process.cwd(), "data/datasets", DATASET_ID);

// data_dictionary and hero_case_index are included as tables on purpose:
// the dictionary carries propensity-event definitions and join keys the LLM
// agents can quote, and the hero index drives the suggested demo walkthrough.
const CSV_FILES = [
  "transactions.csv",
  "statements.csv",
  "campaign_history.csv",
  "propensity_events.csv",
  "card_lifecycle_events.csv",
  "cards.csv",
  "customers.csv",
  "product_holdings.csv",
  "service_tickets.csv",
  "merchants.csv",
  "offers_catalog.csv",
  "data_dictionary.csv",
  "hero_case_index.csv",
  "calendar_events.csv",
];

// Card-keyed tables that need customer_id denormalized via cards so
// funnel/retention SQL (which groups by the dataset userIdField) works.
const CARD_KEYED_TABLES = ["transactions", "statements", "card_lifecycle_events"];

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue
      .replace(/^export\s+/, "")
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  }
}

function escapeSqlStr(s: string) {
  return s.replace(/'/g, "''");
}

interface TableInfo {
  tableName: string;
  fileName: string;
  columns: { name: string; type: string }[];
  rowCount: number;
}

async function main() {
  loadEnvFile(resolve(".env"));
  loadEnvFile(resolve(".env.local"));

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing — add it to .env.local");
    process.exit(1);
  }
  if (!existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(`${LABEL} → ${DATASET_DIR}`);
  console.log("Registered as shared sample (isSample, no owner)\n");

  if (existsSync(DATASET_DIR)) {
    console.log("Removing existing dataset directory");
    rmSync(DATASET_DIR, { recursive: true, force: true });
  }
  mkdirSync(DATASET_DIR, { recursive: true });

  // ── Step 1: materialize CSVs into a self-contained .duckdb ──────────
  console.log("Step 1: Importing CSVs into DuckDB (transactions.csv is 237MB — takes a while)...");
  const dbPath = join(DATASET_DIR, `${DATASET_ID}.duckdb`);
  const instance = await getOrCreateInstance(dbPath);
  const conn = await instance.connect();

  const tables: TableInfo[] = [];
  for (const fileName of CSV_FILES) {
    const csvPath = join(SOURCE_DIR, fileName);
    if (!existsSync(csvPath)) {
      console.warn(`  SKIP (missing): ${fileName}`);
      continue;
    }
    const tableName = fileToTableName(fileName);
    await conn.run(
      `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${escapeSqlStr(csvPath)}', auto_detect=true, ignore_errors=true)`,
    );

    const descRows = await (await conn.run(`DESCRIBE ${tableName}`)).getRows();
    const columns = descRows.map((row) => ({ name: String(row[0]), type: String(row[1]) }));
    const countRows = await (await conn.run(`SELECT COUNT(*) FROM ${tableName}`)).getRows();
    const rowCount = Number(countRows[0][0]);

    tables.push({ tableName, fileName, columns, rowCount });
    console.log(`  ✓ ${tableName}: ${rowCount.toLocaleString()} rows, ${columns.length} cols`);
  }

  if (tables.length === 0) {
    console.error("No tables imported — aborting.");
    process.exit(1);
  }

  // Denormalize customer_id onto card-keyed tables so funnel/retention SQL
  // (which groups every event table by the dataset userIdField) can resolve it.
  // Runs BEFORE enrichment so the profiler sees the stamped columns.
  console.log("\n  Stamping customer_id onto card-keyed tables...");
  for (const t of CARD_KEYED_TABLES) {
    await conn.run(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS customer_id VARCHAR`);
    await conn.run(`UPDATE ${t} SET customer_id = c.customer_id FROM cards c WHERE ${t}.card_id = c.card_id`);
    // Refresh the recorded columns so enrichment sees customer_id
    const info = tables.find((x) => x.tableName === t);
    if (info) {
      const descRows = await (await conn.run(`DESCRIBE ${t}`)).getRows();
      info.columns = descRows.map((row) => ({ name: String(row[0]), type: String(row[1]) }));
    }
  }

  await conn.run("CHECKPOINT");

  tables.sort((a, b) => b.rowCount - a.rowCount);
  const primary = tables[0];
  const secondaryTables = tables.slice(1);
  console.log(`\n  Primary table: ${primary.tableName} (${primary.rowCount.toLocaleString()} rows)`);

  // ── Step 2: LLM schema enrichment ───────────────────────────────────
  console.log("\nStep 2: LLM schema enrichment (writes schema-map.json, metrics.json, events.json)...");

  const defaultSummaryHint = `Query the ${primary.tableName} table for primary data. Secondary tables available: ${secondaryTables.map((t) => t.tableName).join(", ")}. JOIN them using shared columns when needed.`;

  let schemaContext: string;
  let systemContext: string;
  let queryDescriptions: Record<string, string[]>;
  let multiAgentPrompt: string;
  let domainHints: string | undefined;
  let summaryTableHint: string;
  let agents: AgentSpec[] | undefined;
  let suggestedPrompts: string[] | undefined;
  let welcomeSubtitle: string | undefined;
  let currency: string | undefined;
  let userIdField: string | undefined;
  let dateField: string | undefined;

  try {
    const schemaMap = await enrichDataset({
      dbPath,
      datasetDir: DATASET_DIR,
      tables: tables.map((t) => ({ tableName: t.tableName })),
      label: LABEL,
    });

    schemaContext = schemaMap.annotatedSchemaContext;
    systemContext = buildEnrichedSystemContext(schemaMap, LABEL, primary.rowCount);
    queryDescriptions = schemaMap.queryDescriptions;
    multiAgentPrompt = schemaMap.multiAgentPrompt;
    agents = schemaMap.agents;
    domainHints = schemaMap.domainHints;
    summaryTableHint = schemaMap.summaryTableHint || defaultSummaryHint;
    suggestedPrompts = schemaMap.suggestedPrompts;
    welcomeSubtitle = schemaMap.welcomeSubtitle;
    currency = schemaMap.currency;
    userIdField = schemaMap.userIdField;
    dateField = schemaMap.dateField;
    console.log(`  Enrichment complete — domain: "${schemaMap.domain}", userIdField: ${userIdField ?? "none"}, dateField: ${dateField ?? "none"}`);
  } catch (err) {
    console.warn("  Enrichment failed, using generic prompts:", err);
    schemaContext = `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)\n\n`;
    schemaContext += `PRIMARY TABLE: ${primary.tableName} (~${primary.rowCount.toLocaleString()} rows)\n`;
    for (const col of primary.columns) {
      schemaContext += `  - ${col.name.padEnd(25)} ${col.type}\n`;
    }
    for (const sec of secondaryTables) {
      schemaContext += `\nSECONDARY TABLE: ${sec.tableName} (~${sec.rowCount.toLocaleString()} rows)\n`;
      for (const col of sec.columns) {
        schemaContext += `  - ${col.name.padEnd(25)} ${col.type}\n`;
      }
    }
    systemContext = buildGenericSystemContext(LABEL, schemaContext, primary.rowCount);
    queryDescriptions = buildGenericQueryDescriptions();
    multiAgentPrompt = buildGenericMultiAgentPrompt(primary.tableName);
    summaryTableHint = defaultSummaryHint;
  }

  // ── Step 3: date range + user count from enriched fields ────────────
  let dateRange: { start: string; end: string } | undefined;
  if (dateField) {
    try {
      const dq = `"${dateField.replace(/"/g, '""')}"`;
      const rows = await (await conn.run(
        `SELECT MIN(${dq})::VARCHAR, MAX(${dq})::VARCHAR FROM ${primary.tableName}`,
      )).getRows();
      if (rows[0]) dateRange = { start: String(rows[0][0]), end: String(rows[0][1]) };
    } catch { /* not critical */ }
  }
  const dateRangeLabel = dateRange ? `${dateRange.start} to ${dateRange.end}` : "All available data";

  let totalUsers = "N/A";
  try {
    const rows = await (await conn.run(`SELECT COUNT(DISTINCT customer_id) FROM customers`)).getRows();
    totalUsers = `${Number(rows[0][0]).toLocaleString()} unique customers`;
  } catch { /* not critical */ }

  // ── Step 4: save config ─────────────────────────────────────────────
  console.log("\nStep 3: Saving config.json...");

  const config: DatasetConfig = {
    id: DATASET_ID,
    label: LABEL,
    dbFile: `data/datasets/${DATASET_ID}/${DATASET_ID}.duckdb`,
    primaryTable: primary.tableName,
    userIdField,
    dateField,
    dateRange,
    isDynamic: true,
    // Shared sample: no ownerId, visible to all accounts (see getAllDatasetsForUser)
    isSample: true,
    sourceType: "csv",
    // Source CSVs stay in Downloads — they are NOT copied into the dataset dir,
    // so the registry's legacy viewSQL regeneration is skipped (tables are materialized).
    sourceFiles: tables.map((t) => t.fileName),
    schemaContext,
    systemContext,
    agents,
    queryDescriptions,
    multiAgentPrompt,
    domainHints,
    reportMeta: {
      totalEvents: `${primary.rowCount.toLocaleString()} rows`,
      totalUsers,
      dateRangeLabel,
      dbName: `${DATASET_ID}.duckdb`,
    },
    summaryTableHint,
    suggestedPrompts,
    welcomeSubtitle,
    currency,
  };

  saveDynamicDataset(config);
  console.log(`  ✓ Saved ${DATASET_DIR}/config.json`);
  console.log(`\nDone. Next steps:`);
  console.log(`  npx tsx scripts/populate-dataset-starters.ts ${DATASET_ID}   # segments/funnels/retentions`);
  console.log(`  Restart the dev server and pick "${LABEL}" from the dataset switcher.`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
