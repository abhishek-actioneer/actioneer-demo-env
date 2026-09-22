/**
 * Ingest Seekho Market Intelligence CSVs into baby-sentinel as dynamic datasets.
 *
 * Source: ~/Downloads/Market Intelligence - Seekho/
 * Creates 2 datasets:
 *   1. seekho-market-position — Seekho app metrics + market landscape
 *   2. education-ad-intelligence — Ad network spend data
 *
 * Usage: npx tsx scripts/setup-seekho.ts
 * Requires: OPENAI_API_KEY environment variable
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { saveDynamicDataset } from "../src/lib/datasets/dynamic-registry";
import { enrichDataset } from "../src/lib/datasets/schema-enricher";
import { fileToTableName } from "../src/lib/datasets/utils";
import {
  buildGenericSystemContext,
  buildGenericQueryDescriptions,
  buildGenericMultiAgentPrompt,
  buildEnrichedSystemContext,
} from "../src/lib/datasets/generic-prompts";
import type { DatasetConfig, AgentSpec } from "../src/lib/datasets/types";

const SOURCE_DIR = resolve(
  process.env.HOME || "~",
  "Downloads/Market Intelligence - Seekho",
);
const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

// ── File Mappings ──────────────────────────────────────────────────

interface FileMapping {
  original: string;
  clean: string;
  /** Number of lines to skip at the top (metadata headers from SensorTower) */
  skipLines?: number;
}

interface DatasetDef {
  id: string;
  label: string;
  files: FileMapping[];
}

const DATASETS: DatasetDef[] = [
  {
    id: "seekho-market-position",
    label: "Seekho Market Position",
    files: [
      { original: "App Store Retention (November 2024, India), Detailed.csv", clean: "retention.csv" },
      { original: "App Store Reviews (2025-02-27 - 2026-02-26, India), Detailed.csv", clean: "reviews.csv" },
      { original: "Sensor_Tower_App_Performance_Demographics_All_Time.csv", clean: "demographics.csv" },
      { original: "Sensor_Tower_App_Performance_Publisher_Breakdown_Unified_All_Countries_2012-01-01_to_2026-02-25_daily.csv", clean: "publisher_breakdown.csv", skipLines: 7 },
      { original: "Unified Download Channel by Absolute Downloads (Jan 1, 2023 - Feb 28, 2026, All Countries-Regions).csv", clean: "download_channels.csv" },
      { original: "Unified Downloads (Jan 1, 2023 - Feb 25, 2026, All Countries-Regions), Detailed.csv", clean: "downloads.csv" },
      { original: "Unified Revenue (Jan 1, 2023 - Feb 24, 2026, All Countries-Regions), Detailed.csv", clean: "revenue.csv" },
      { original: "Unified App Overlap (Seekho- Short Learning Videos, Overall), (Nov 1, 2024 - Nov 30, 2024, India), Detailed.csv", clean: "app_overlap.csv" },
      { original: "Unified Market Size Downloads (February 2025 - March 2026, All Countries-Regions), Detailed.csv", clean: "market_size_downloads_global.csv" },
      { original: "Unified Market Size Downloads (February 2025 - March 2026, US), Detailed.csv", clean: "market_size_downloads_us.csv" },
      { original: "Unified Market Size Revenue (February 2025 - March 2026, India), Detailed.csv", clean: "market_size_revenue_india.csv" },
      { original: "Unified Market Size Total Time Spent (February 2025 - February 2026, India), Detailed.csv", clean: "market_size_time_spent_india.csv" },
      { original: "Unified Top Apps Downloads  (Feb 25, 2025 - Feb 24, 2026, IN), Detailed.csv", clean: "top_apps_downloads_india.csv" },
      { original: "Unified Top Apps Revenue  (Feb 25, 2025 - Feb 24, 2026, IN), Detailed.csv", clean: "top_apps_revenue_india.csv" },
      { original: "Unified Top Apps Revenue  (Feb 25, 2025 - Feb 24, 2026, Worldwide), Detailed.csv", clean: "top_apps_revenue_worldwide.csv" },
    ],
  },
  {
    id: "education-ad-intelligence",
    label: "Education Ad Intelligence",
    files: [
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_50Countries_AdMob_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_global_admob.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_50Countries_AppLovin_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_global_applovin.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_50Countries_Meta_Audience_Network_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_global_meta.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_50Countries_Moloco_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_global_moloco.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_IN_AdMob_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_india_admob.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_IN_Apple_Search_Ads_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_india_apple_search.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Education_IN_YouTube_2026-02-01_to_2026-02-28.csv", clean: "advertisers_edu_india_youtube.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Advertisers_Unified_Entertainment_IN_YouTube_2026-02-01_to_2026-02-28.csv", clean: "advertisers_ent_india_youtube.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Publishers_Unified_Education_IN_AdMob_2026-02-01_to_2026-02-28.csv", clean: "publishers_edu_india_admob.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Publishers_Unified_Entertainment_IN_AdMob_2026-02-01_to_2026-02-28.csv", clean: "publishers_ent_india_admob.csv" },
      { original: "Sensor_Tower_App_Advertising_Top_Publishers_Unified_Entertainment_IN_AppLovin_2026-02-01_to_2026-02-28.csv", clean: "publishers_ent_india_applovin.csv" },
    ],
  },
];

// ── UTF-16 → UTF-8 Conversion ─────────────────────────────────────

function convertToUtf8(buffer: Buffer): string {
  // UTF-16 LE BOM: 0xFF 0xFE
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").slice(1); // skip BOM char
  }
  // UTF-8 BOM: 0xEF 0xBB 0xBF
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf8").slice(1);
  }
  return buffer.toString("utf8");
}

// ── Detect special columns (mirrors upload route logic) ────────────

function detectSpecialColumns(columns: { name: string; type: string }[]) {
  let dateField: string | undefined;
  let userIdField: string | undefined;

  for (const col of columns) {
    const lower = col.name.toLowerCase();
    if (
      !dateField &&
      (lower.includes("date") || lower.includes("time") || lower.includes("timestamp") || lower.includes("created_at"))
    ) {
      if (col.type.includes("DATE") || col.type.includes("TIMESTAMP") || col.type.includes("TIME")) {
        dateField = col.name;
      }
    }
    if (
      !userIdField &&
      (lower.includes("user_id") || lower.includes("customer_id") || lower.includes("entity_id") || lower === "id")
    ) {
      userIdField = col.name;
    }
  }

  return { dateField, userIdField };
}

// ── Main ───────────────────────────────────────────────────────────

interface TableInfo {
  tableName: string;
  fileName: string;
  columns: { name: string; type: string }[];
  rowCount: number;
}

async function setupDataset(def: DatasetDef) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Setting up: ${def.label} (${def.id})`);
  console.log(`${"=".repeat(60)}`);

  const datasetDir = join(DATASETS_DIR, def.id);

  // Clean up existing
  if (existsSync(datasetDir)) {
    console.log(`  Removing existing dataset at ${datasetDir}`);
    rmSync(datasetDir, { recursive: true, force: true });
  }
  mkdirSync(datasetDir, { recursive: true });

  // Step 1: Convert and copy CSVs
  console.log(`\n1. Converting ${def.files.length} CSVs to UTF-8...`);
  const savedFiles: { fileName: string; path: string }[] = [];

  for (const file of def.files) {
    const sourcePath = join(SOURCE_DIR, file.original);
    if (!existsSync(sourcePath)) {
      console.warn(`   SKIP (missing): ${file.original}`);
      continue;
    }

    const raw = readFileSync(sourcePath);
    let content = convertToUtf8(raw);
    // Strip metadata header lines (e.g. SensorTower performance CSV preamble)
    if (file.skipLines) {
      const lines = content.split("\n");
      content = lines.slice(file.skipLines).join("\n");
    }
    const destPath = join(datasetDir, file.clean);
    writeFileSync(destPath, content, "utf-8");
    savedFiles.push({ fileName: file.clean, path: destPath });
    console.log(`   ${file.clean} (${(raw.length / 1024).toFixed(0)}KB)`);
  }

  if (savedFiles.length === 0) {
    console.error(`   No files found! Skipping dataset.`);
    return;
  }

  // Step 2: Create DuckDB + views
  console.log(`\n2. Creating DuckDB + views...`);
  const dbPath = join(datasetDir, `${def.id}.duckdb`);
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();

  const tables: TableInfo[] = [];
  let dateField: string | undefined;
  let userIdField: string | undefined;
  let dateRange: { start: string; end: string } | undefined;

  try {
    for (const { fileName, path: csvPath } of savedFiles) {
      const tableName = fileToTableName(fileName);
      await conn.run(
        `CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_csv('${csvPath}', auto_detect=true, ignore_errors=true)`,
      );

      const descResult = await conn.run(`DESCRIBE ${tableName}`);
      const descRows = await descResult.getRows();
      const columns: { name: string; type: string }[] = [];
      for (const row of descRows) {
        columns.push({ name: String(row[0]), type: String(row[1]) });
      }

      const countResult = await conn.run(`SELECT COUNT(*) FROM ${tableName}`);
      const countRows = await countResult.getRows();
      const rowCount = Number(countRows[0][0]);

      tables.push({ tableName, fileName, columns, rowCount });
      console.log(`   ${tableName}: ${rowCount.toLocaleString()} rows, ${columns.length} cols`);
    }

    // Primary table = most rows
    tables.sort((a, b) => b.rowCount - a.rowCount);
    const primary = tables[0];

    // Detect special columns
    ({ dateField, userIdField } = detectSpecialColumns(primary.columns));

    if (dateField) {
      try {
        const rangeResult = await conn.run(
          `SELECT MIN("${dateField}")::VARCHAR, MAX("${dateField}")::VARCHAR FROM ${primary.tableName}`,
        );
        const rangeRows = await rangeResult.getRows();
        if (rangeRows[0]) {
          dateRange = { start: String(rangeRows[0][0]), end: String(rangeRows[0][1]) };
        }
      } catch {
        /* not critical */
      }
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }

  const primary = tables[0];
  const secondaryTables = tables.slice(1);
  const dateRangeLabel = dateRange ? `${dateRange.start} to ${dateRange.end}` : "All available data";

  console.log(`\n   Primary: ${primary.tableName} (${primary.rowCount.toLocaleString()} rows)`);
  if (dateField) console.log(`   Date field: ${dateField} (${dateRangeLabel})`);

  // Step 3: LLM enrichment
  console.log(`\n3. Running LLM schema enrichment (this may take a minute)...`);

  const viewSQLStatements = savedFiles.map(({ fileName, path: csvPath }) => {
    const tn = fileToTableName(fileName);
    return `CREATE OR REPLACE VIEW ${tn} AS SELECT * FROM read_csv('${csvPath}', auto_detect=true, ignore_errors=true)`;
  });

  let schemaContext: string;
  let systemContext: string;
  let queryDescriptions: Record<string, string[]>;
  let multiAgentPrompt: string;
  let domainHints: string | undefined;
  let summaryTableHint: string;
  let agents: AgentSpec[] | undefined;
  let suggestedPrompts: string[] | undefined;
  let welcomeSubtitle: string | undefined;

  const defaultSummaryHint =
    tables.length > 1
      ? `Query the ${primary.tableName} table for primary data. Secondary tables: ${secondaryTables.map((t) => t.tableName).join(", ")}. JOIN using shared columns when needed.`
      : `Query the ${primary.tableName} table directly.`;

  try {
    const schemaMap = await enrichDataset({
      dbPath,
      datasetDir,
      tables: tables.map((t) => ({ tableName: t.tableName, viewSQL: viewSQLStatements })),
      label: def.label,
    });

    schemaContext = schemaMap.annotatedSchemaContext;
    systemContext = buildEnrichedSystemContext(schemaMap, def.label, primary.rowCount);
    queryDescriptions = schemaMap.queryDescriptions;
    multiAgentPrompt = schemaMap.multiAgentPrompt;
    agents = schemaMap.agents;
    domainHints = schemaMap.domainHints;
    summaryTableHint = schemaMap.summaryTableHint || defaultSummaryHint;
    suggestedPrompts = schemaMap.suggestedPrompts;
    welcomeSubtitle = schemaMap.welcomeSubtitle;
    console.log(`   Enrichment complete — domain: "${schemaMap.domain}"`);
  } catch (err) {
    console.warn(`   Enrichment failed, using generic prompts:`, err);
    schemaContext = `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)\n\n`;
    schemaContext += `PRIMARY TABLE: ${primary.tableName} (~${primary.rowCount.toLocaleString()} rows)\n`;
    for (const col of primary.columns) {
      schemaContext += `  - ${col.name.padEnd(30)} ${col.type}\n`;
    }
    for (const sec of secondaryTables) {
      schemaContext += `\nSECONDARY TABLE: ${sec.tableName} (~${sec.rowCount.toLocaleString()} rows)\n`;
      for (const col of sec.columns) {
        schemaContext += `  - ${col.name.padEnd(30)} ${col.type}\n`;
      }
    }
    systemContext = buildGenericSystemContext(def.label, schemaContext, primary.rowCount);
    queryDescriptions = buildGenericQueryDescriptions();
    multiAgentPrompt = buildGenericMultiAgentPrompt(primary.tableName);
    summaryTableHint = defaultSummaryHint;
  }

  // Step 4: Save config
  console.log(`\n4. Saving dataset config...`);

  const config: DatasetConfig = {
    id: def.id,
    label: def.label,
    dbFile: `data/datasets/${def.id}/${def.id}.duckdb`,
    primaryTable: primary.tableName,
    userIdField,
    dateField,
    dateRange,
    isDynamic: true,
    sourceFiles: savedFiles.map((f) => f.fileName),
    schemaContext,
    systemContext,
    agents,
    queryDescriptions,
    multiAgentPrompt,
    domainHints,
    reportMeta: {
      totalEvents: `${primary.rowCount.toLocaleString()} rows in ${primary.tableName}`,
      totalUsers: "N/A",
      dateRangeLabel,
      dbName: `${def.id}.duckdb`,
    },
    summaryTableHint,
    suggestedPrompts,
    welcomeSubtitle,
  };

  saveDynamicDataset(config);
  console.log(`   Saved to ${datasetDir}/config.json`);
  console.log(`   Dataset "${def.label}" ready!`);
}

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY required. Set with: export OPENAI_API_KEY=your_key");
    process.exit(1);
  }

  console.log("Seekho Market Intelligence -> Baby Sentinel");
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Target: ${DATASETS_DIR}`);

  for (const def of DATASETS) {
    await setupDataset(def);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Done! Both datasets created.");
  console.log("Run 'pnpm dev' and switch datasets in the UI to query them.");
  console.log(`${"=".repeat(60)}`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
