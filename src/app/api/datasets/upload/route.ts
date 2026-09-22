import { auth } from "@clerk/nextjs/server";
import {
  createWriteStream,
  mkdirSync,
  existsSync,
  rmSync,
  openSync,
  readSync,
  closeSync,
  renameSync,
} from "fs";
import { resolve, join, basename } from "path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import busboy from "busboy";
import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import { saveDynamicDataset, getDynamicDatasets, getDynamicDataset, deleteDynamicDataset, reloadDynamicDatasets } from "@/lib/datasets/dynamic-registry";
import {
  buildGenericSystemContext,
  buildGenericQueryDescriptions,
  buildGenericMultiAgentPrompt,
  buildEnrichedSystemContext,
} from "@/lib/prompts/schema-generic";
import { enrichDataset } from "@/lib/datasets/schema-enricher";
import { loadSchemaMap } from "@/lib/datasets/schema-loader";
import { generateSegmentsForDataset } from "@/lib/server/segment-generator";
import { generateFunnelsForDataset } from "@/lib/server/funnel-generator";
import { generateRetentionsForDataset } from "@/lib/server/retention-generator";
import type { DatasetConfig, AgentSpec, SerializableDatasetConfig } from "@/lib/datasets/types";
import { fileToTableName, slugify } from "@/lib/datasets/utils";
import { getOrCreateInstance, enqueue, isSentinelSystemTable } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");
const MAX_CSV_SIZE = 50 * 1024 * 1024;    // 50 MB per CSV file
const MAX_DUCKDB_SIZE = 150 * 1024 * 1024; // 150 MB for DuckDB files
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;  // 200 MB across all files
const DUCKDB_MAGIC = Buffer.from([0x44, 0x55, 0x43, 0x4b]); // "DUCK"
const SAFE_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Escape single quotes in a SQL string literal */
function escapeSqlStr(s: string) { return s.replace(/'/g, "''"); }


interface UploadedFile {
  fieldname: string;
  filename: string;
  path: string;
  size: number;
}

interface ParsedUpload {
  label: string;
  files: UploadedFile[];
  error?: string;
}

/** Stream the multipart request to disk via busboy. Returns parsed fields + file paths. */
async function parseUpload(req: Request, destDir: string): Promise<ParsedUpload> {
  const files: UploadedFile[] = [];
  let label = "";
  let parseError: string | undefined;

  const bb = busboy({
    headers: Object.fromEntries(req.headers),
    limits: { fileSize: MAX_DUCKDB_SIZE, files: 10, fields: 20 },
  });

  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    const streamPromises: Promise<void>[] = [];

    bb.on("field", (name, val) => {
      if (name === "label") label = val.trim();
    });

    bb.on("file", (fieldname, fileStream, info) => {
      // Path traversal protection: basename only, sanitize remaining chars
      const safeName = basename(info.filename).replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const destPath = join(destDir, safeName);

      // Confinement check
      if (!destPath.startsWith(destDir + "/")) {
        fileStream.resume(); // drain without saving
        parseError = "Invalid filename";
        return;
      }

      let size = 0;
      let limitHit = false;

      fileStream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        totalBytes += chunk.length;
        if (totalBytes > MAX_TOTAL_SIZE) {
          fileStream.resume(); // drain without saving
          parseError = `Total upload size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB`;
        }
      });
      fileStream.on("limit", () => {
        limitHit = true;
        parseError = `File "${safeName}" exceeds the ${MAX_DUCKDB_SIZE / 1024 / 1024}MB limit`;
      });

      const ws = createWriteStream(destPath);
      fileStream.pipe(ws);

      // Track write completion — busboy "finish" fires before ws "finish"
      const streamDone = new Promise<void>((res, rej) => {
        ws.on("finish", () => {
          if (!limitHit) {
            files.push({ fieldname, filename: safeName, path: destPath, size });
          }
          res();
        });
        ws.on("error", rej);
      });
      streamPromises.push(streamDone);
    });

    bb.on("finish", () => {
      Promise.all(streamPromises).then(() => resolve(), reject);
    });
    bb.on("error", reject);

    const nodeStream = Readable.fromWeb(
      req.body as Parameters<typeof Readable.fromWeb>[0],
    );
    pipeline(nodeStream, bb).catch(reject);
  });

  return { label, files, error: parseError };
}

// ── CSV upload ─────────────────────────────────────────────────────────────────

interface TableInfo {
  tableName: string;
  fileName: string;
  columns: { name: string; type: string }[];
  rowCount: number;
}

async function handleCSVUpload(options: {
  id: string;
  label: string;
  datasetDir: string;
  files: UploadedFile[];
  ownerId: string;
}): Promise<SerializableDatasetConfig> {
  const { id, label, datasetDir, files, ownerId } = options;

  // Per-file CSV size cap
  for (const f of files) {
    if (f.size > MAX_CSV_SIZE) {
      throw Object.assign(
        new Error(
          `File "${f.filename}" exceeds the 50MB CSV limit (${(f.size / 1024 / 1024).toFixed(1)}MB)`,
        ),
        { status: 400 },
      );
    }
  }

  const dbPath = join(datasetDir, `${id}.duckdb`);
  const instance = await getOrCreateInstance(dbPath);
  const conn = await instance.connect();

  const tables: TableInfo[] = [];
  for (const { filename, path: csvPath } of files) {
    const tableName = fileToTableName(filename);
    if (!SAFE_TABLE_NAME.test(tableName)) {
      throw Object.assign(new Error(`Invalid table name for file "${filename}"`), { status: 400 });
    }
    // Import CSV into DuckDB table (materialized — faster queries, single .duckdb file)
    await conn.run(
      `CREATE TABLE IF NOT EXISTS ${tableName} AS SELECT * FROM read_csv('${escapeSqlStr(csvPath)}', auto_detect=true, ignore_errors=true)`,
    );

    const descResult = await conn.run(`DESCRIBE ${tableName}`);
    const descRows = await descResult.getRows();
    const columns: { name: string; type: string }[] = descRows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
    }));

    const countResult = await conn.run(`SELECT COUNT(*) FROM ${tableName}`);
    const countRows = await countResult.getRows();
    tables.push({ tableName, fileName: filename, columns, rowCount: Number(countRows[0][0]) });
  }

  // Flush WAL to .duckdb file, then delete source CSVs (data is now materialized)
  await conn.run("CHECKPOINT");
  for (const { path: csvPath } of files) {
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(csvPath);
    } catch { /* non-critical — CSV just takes extra space */ }
  }

  tables.sort((a, b) => b.rowCount - a.rowCount);

  const primary = tables[0];
  const secondaryTables = tables.slice(1);

  // dateField and userIdField are determined by LLM enrichment below
  const defaultSummaryHint =
    tables.length > 1
      ? `Query the ${primary.tableName} table for primary data. Secondary tables available: ${secondaryTables.map((t) => t.tableName).join(", ")}. JOIN them using shared columns when needed.`
      : `Query the ${primary.tableName} table directly. There are no pre-materialized summary tables.`;

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
    console.log(`[upload] running LLM schema enrichment for "${label}"`);

    const schemaMap = await enrichDataset({
      dbPath,
      datasetDir,
      // Tables are materialized (CREATE TABLE) — no viewSQL needed
      tables: tables.map((t) => ({ tableName: t.tableName })),
      label,
    });

    schemaContext = schemaMap.annotatedSchemaContext;
    systemContext = buildEnrichedSystemContext(schemaMap, label, primary.rowCount);
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
    console.log(`[upload] enrichment complete — domain: "${schemaMap.domain}", userIdField: "${userIdField ?? "none"}", dateField: "${dateField ?? "none"}"`);
  } catch (enrichErr) {
    console.warn(`[upload] LLM enrichment failed, using generic prompts:`, enrichErr);
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
    systemContext = buildGenericSystemContext(label, schemaContext, primary.rowCount);
    queryDescriptions = buildGenericQueryDescriptions();
    multiAgentPrompt = buildGenericMultiAgentPrompt(primary.tableName);
    summaryTableHint = defaultSummaryHint;
  }

  // Compute date range after enrichment (dateField may be a VARCHAR column the LLM identified)
  let dateRange: { start: string; end: string } | undefined;
  if (dateField) {
    try {
      const dq = `"${dateField.replace(/"/g, '""')}"`;
      const rangeResult = await conn.run(
        `SELECT MIN(${dq})::VARCHAR, MAX(${dq})::VARCHAR FROM ${primary.tableName}`,
      );
      const rangeRows = await rangeResult.getRows();
      if (rangeRows[0]) {
        dateRange = { start: String(rangeRows[0][0]), end: String(rangeRows[0][1]) };
      }
    } catch { /* Not critical */ }
  }
  const dateRangeLabel = dateRange ? `${dateRange.start} to ${dateRange.end}` : "All available data";

  const config: DatasetConfig = {
    id,
    label,
    dbFile: `data/datasets/${id}/${id}.duckdb`,
    primaryTable: primary.tableName,
    userIdField,
    dateField,
    dateRange,
    ownerId,
    isDynamic: true,
    sourceType: "csv",
    sourceFiles: files.map((f) => f.filename),
    schemaContext,
    systemContext,
    agents,
    queryDescriptions,
    multiAgentPrompt,
    domainHints,
    reportMeta: {
      totalEvents: `${primary.rowCount.toLocaleString()} rows`,
      totalUsers: userIdField ? "auto-detected" : "N/A",
      dateRangeLabel,
      dbName: `${id}.duckdb`,
    },
    summaryTableHint,
    suggestedPrompts,
    welcomeSubtitle,
    currency,
  };

  if (userIdField) {
    try {
      const userCountResult = await conn.run(
        `SELECT COUNT(DISTINCT ${userIdField}) FROM ${primary.tableName}`,
      );
      const userCountRows = await userCountResult.getRows();
      config.reportMeta.totalUsers = `${Number(userCountRows[0][0]).toLocaleString()} unique ${userIdField.replace(/_/g, " ")}s`;
    } catch { /* Not critical */ }
  }

  saveDynamicDataset(config);

  const { viewSQL: _viewSQL, ...serializable } = config;
  return serializable;
}

// ── DuckDB upload ──────────────────────────────────────────────────────────────

async function handleDuckDBUpload(options: {
  id: string;
  label: string;
  datasetDir: string;
  file: UploadedFile;
  ownerId: string;
}): Promise<SerializableDatasetConfig> {
  const { id, label, datasetDir, file, ownerId } = options;
  const dbPath = join(datasetDir, `${id}.duckdb`);

  // Rename to canonical path if needed (e.g., user uploaded "raw.duckdb" for id "my-dataset")
  if (file.path !== dbPath) {
    renameSync(file.path, dbPath);
  }

  // Validate magic bytes ("DUCK") — located at byte offset 8 (after 8-byte block checksum)
  const header = Buffer.alloc(4);
  const fd = openSync(dbPath, "r");
  try {
    readSync(fd, header, 0, 4, 8);
  } finally {
    closeSync(fd);
  }
  if (!header.equals(DUCKDB_MAGIC)) {
    throw Object.assign(new Error("File is not a valid DuckDB database"), { status: 400 });
  }

  // Phase 1: isolated read-only inspection instance (never registered in shared pool)
  const inspectInstance = await DuckDBInstance.create(dbPath, {
    access_mode: "READ_ONLY",
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    threads: "1",
  });

  let allTableNames: string[] = [];
  const tableColumns: Record<string, { name: string; type: string }[]> = {};
  let primaryTable: string;
  const rowCounts: Record<string, number> = {};

  let inspectConn: DuckDBConnection | undefined;
  try {
    inspectConn = await inspectInstance.connect();

    // Enumerate base tables only (skip views — they may reference external CSV paths
    // that don't exist on this machine)
    const showResult = await inspectConn.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE'",
    );
    const showRows = showResult.getRowObjects() as Array<{ table_name: string }>;

    // Validate names — skip any with unsafe characters
    allTableNames = showRows
      .map((r) => r.table_name)
      .filter((name) => {
        const ok = SAFE_TABLE_NAME.test(name);
        if (!ok) console.warn(`[upload] skipping table "${name}" — unsafe name`);
        return ok;
      });

    if (allTableNames.length === 0) {
      throw Object.assign(
        new Error("No base tables found in the DuckDB file (only views were present)"),
        { status: 400 },
      );
    }

    // IMPORTANT: filter sentinel system tables BEFORE the UNION ALL COUNT query.
    // If not filtered here, sentinel tables contaminate: countRows (may win primaryTable
    // selection), tablesToDescribe, tableColumns, and enrichDataset() table list.
    allTableNames = allTableNames.filter((name) => {
      if (isSentinelSystemTable(name)) {
        console.warn(`[upload] skipping sentinel system table "${name}"`);
        return false;
      }
      return true;
    });

    if (allTableNames.length === 0) {
      throw Object.assign(
        new Error("No user data tables found in the DuckDB file (only sentinel system tables were present)"),
        { status: 400 },
      );
    }

    // Batch COUNT via single UNION ALL query (one round-trip instead of N)
    const unionSQL = allTableNames
      .map((t) => `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM "${t.replace(/"/g, '""')}"`)
      .join(" UNION ALL ");
    const countResult = await inspectConn.runAndReadAll(unionSQL);
    const countRows = countResult.getRowObjects() as Array<{ tbl: string; cnt: bigint }>;
    countRows.sort((a, b) => (b.cnt > a.cnt ? 1 : b.cnt < a.cnt ? -1 : 0));

    for (const row of countRows) {
      rowCounts[row.tbl] = Number(row.cnt);
    }

    if (countRows.length === 0) {
      throw Object.assign(
        new Error("No row-count results returned for user data tables — the file may be empty"),
        { status: 400 },
      );
    }
    primaryTable = countRows[0].tbl;

    // DESCRIBE each table (capped at 20 by row count, already sorted)
    const tablesToDescribe = countRows.slice(0, 20).map((r) => r.tbl);
    for (const tableName of tablesToDescribe) {
      const quoted = `"${tableName.replace(/"/g, '""')}"`;
      const descResult = await inspectConn.runAndReadAll(`DESCRIBE ${quoted}`);
      const descRows = descResult.getRowObjects() as Array<{
        column_name: string;
        column_type: string;
      }>;
      tableColumns[tableName] = descRows.map((r) => ({
        name: r.column_name,
        type: r.column_type,
      }));
    }
  } finally {
    inspectConn?.closeSync();
    inspectInstance.closeSync(); // discard — never add to globalThis
  }

  // Build table info for all described tables (sorted by row count desc)
  const allTableInfo = Object.entries(tableColumns)
    .map(([tableName, columns]) => ({ tableName, columns, rowCount: rowCounts[tableName] ?? 0 }))
    .sort((a, b) => b.rowCount - a.rowCount);

  primaryTable = allTableInfo[0]?.tableName ?? primaryTable;

  // dateField and userIdField are determined by LLM enrichment below
  const primaryColumns = tableColumns[primaryTable] ?? [];
  const primaryRowCount = rowCounts[primaryTable] ?? 0;
  const secondaryNames = allTableNames.filter((t) => t !== primaryTable);

  const defaultSummaryHint =
    secondaryNames.length > 0
      ? `Query the ${primaryTable} table for primary data. Secondary tables available: ${secondaryNames.join(", ")}. JOIN them using shared columns when needed.`
      : `Query the ${primaryTable} table directly. There are no pre-materialized summary tables.`;

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
    console.log(`[upload] running LLM schema enrichment for DuckDB dataset "${label}"`);
    const schemaMap = await enrichDataset({
      dbPath,
      datasetDir,
      // Pass ALL tables (up to 20) — required for cross-table JOIN generation
      tables: allTableNames.slice(0, 20).map((t) => ({ tableName: t, viewSQL: undefined })),
      label,
    });

    schemaContext = schemaMap.annotatedSchemaContext;
    systemContext = buildEnrichedSystemContext(schemaMap, label, primaryRowCount);
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
    console.log(`[upload] enrichment complete — domain: "${schemaMap.domain}", userIdField: "${userIdField ?? "none"}", dateField: "${dateField ?? "none"}"`);
  } catch (enrichErr) {
    console.warn(`[upload] LLM enrichment failed, using generic prompts:`, enrichErr);
    schemaContext = `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)\n\n`;
    schemaContext += `PRIMARY TABLE: ${primaryTable} (~${primaryRowCount.toLocaleString()} rows)\n`;
    for (const col of primaryColumns) {
      schemaContext += `  - ${col.name.padEnd(25)} ${col.type}\n`;
    }
    for (const secName of secondaryNames) {
      const secCols = tableColumns[secName] ?? [];
      schemaContext += `\nSECONDARY TABLE: ${secName} (~${(rowCounts[secName] ?? 0).toLocaleString()} rows)\n`;
      for (const col of secCols) {
        schemaContext += `  - ${col.name.padEnd(25)} ${col.type}\n`;
      }
    }
    systemContext = buildGenericSystemContext(label, schemaContext, primaryRowCount);
    queryDescriptions = buildGenericQueryDescriptions();
    multiAgentPrompt = buildGenericMultiAgentPrompt(primaryTable);
    summaryTableHint = defaultSummaryHint;
  }

  const config: DatasetConfig = {
    id,
    label,
    dbFile: `data/datasets/${id}/${id}.duckdb`,
    primaryTable,
    userIdField,
    dateField,
    dateRange: undefined,
    ownerId,
    isDynamic: true,
    sourceType: "duckdb",
    sourceFiles: [file.filename],
    schemaContext,
    systemContext,
    agents,
    queryDescriptions,
    multiAgentPrompt,
    domainHints,
    reportMeta: {
      totalEvents: `${primaryRowCount.toLocaleString()} rows`,
      totalUsers: userIdField ? "auto-detected" : "N/A",
      dateRangeLabel: "All available data",
      dbName: `${id}.duckdb`,
    },
    summaryTableHint,
    suggestedPrompts,
    welcomeSubtitle,
    currency,
  };

  // Phase 2: single production query for both date range and user count
  if (dateField || userIdField) {
    await enqueue(id, async () => {
      const prodInstance = await getOrCreateInstance(dbPath);
      const prodConn = await prodInstance.connect();
      try {
        const quoted = `"${primaryTable.replace(/"/g, '""')}"`;
        const parts: string[] = [];
        if (dateField) {
          const dq = `"${dateField.replace(/"/g, '""')}"`;
          parts.push(`MIN(${dq})::VARCHAR AS date_min`, `MAX(${dq})::VARCHAR AS date_max`);
        }
        if (userIdField) {
          const uq = `"${userIdField.replace(/"/g, '""')}"`;
          parts.push(`COUNT(DISTINCT ${uq}) AS user_count`);
        }
        const row = (await (await prodConn.run(
          `SELECT ${parts.join(", ")} FROM ${quoted}`
        )).getRows())[0];
        if (row && dateField) {
          const dateRange = { start: String(row[0]), end: String(row[1]) };
          config.dateRange = dateRange;
          config.reportMeta.dateRangeLabel = `${dateRange.start} to ${dateRange.end}`;
        }
        if (row && userIdField) {
          const idx = dateField ? 2 : 0;
          config.reportMeta.totalUsers = `${Number(row[idx]).toLocaleString()} unique ${userIdField.replace(/_/g, " ")}s`;
        }
      } catch { /* Not critical */ } finally {
        prodConn.closeSync();
      }
    });
  }

  saveDynamicDataset(config);

  const { viewSQL: _viewSQL, ...serializable } = config;
  return serializable;
}

// ── Main POST handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: max datasets per user
  const MAX_DATASETS_PER_USER = parseInt(process.env.MAX_DATASETS_PER_USER || "5", 10);
  const userDatasets = getDynamicDatasets().filter((ds) => ds.ownerId === userId);
  if (userDatasets.length >= MAX_DATASETS_PER_USER) {
    return Response.json(
      { error: `You can upload at most ${MAX_DATASETS_PER_USER} datasets. Delete one to upload another.` },
      { status: 429 },
    );
  }

  // Temp directory for streaming files before label/id are known
  const tmpDir = join(DATASETS_DIR, `_upload_tmp_${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  let id: string | undefined;
  let datasetDir: string | undefined;

  try {
    const parsed = await parseUpload(req, tmpDir);

    if (parsed.error) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const { label, files } = parsed;

    if (!label) {
      return Response.json({ error: "A 'label' field is required" }, { status: 400 });
    }

    const slug = slugify(label);
    if (!slug) {
      return Response.json({ error: "Invalid label — cannot generate a valid ID" }, { status: 400 });
    }
    // Prefix with alphanumeric userId hash to prevent cross-user slug collisions
    // Strip non-alphanumeric chars (Clerk IDs have underscores like "user_2x...")
    const userPrefix = userId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();
    id = `${userPrefix}-${slug}`;

    // Check for label collision within this user's datasets only
    const allDatasets = getDynamicDatasets();
    if (allDatasets.some((ds) => ds.id === id || (ds.ownerId === userId && ds.label.toLowerCase() === label.toLowerCase()))) {
      return Response.json({ error: "A dataset with this name already exists" }, { status: 400 });
    }

    // Separate CSV and DuckDB files
    const csvFiles = files.filter((f) => f.filename.toLowerCase().endsWith(".csv"));
    const duckdbFiles = files.filter((f) => f.filename.toLowerCase().endsWith(".duckdb"));

    if (duckdbFiles.length === 0 && csvFiles.length === 0) {
      return Response.json(
        { error: "At least one .csv or .duckdb file is required" },
        { status: 400 },
      );
    }

    if (duckdbFiles.length > 1) {
      return Response.json(
        { error: "Only one .duckdb file can be uploaded at a time" },
        { status: 400 },
      );
    }

    // Create the real dataset directory
    datasetDir = join(DATASETS_DIR, id);
    mkdirSync(datasetDir, { recursive: true });

    // Move relevant files from tmp → datasetDir, update paths
    const relevantFiles = duckdbFiles.length > 0 ? [duckdbFiles[0]] : csvFiles;
    for (const f of relevantFiles) {
      const dest = join(datasetDir, f.filename);
      renameSync(f.path, dest);
      f.path = dest;
    }

    let result: SerializableDatasetConfig;
    if (duckdbFiles.length > 0) {
      result = await handleDuckDBUpload({ id, label, datasetDir, file: duckdbFiles[0], ownerId: userId });
    } else {
      result = await handleCSVUpload({ id, label, datasetDir, files: csvFiles, ownerId: userId });
    }

    // Auto-generate segments — awaited so the client only sees the dataset when ready
    try {
      const schemaMap = loadSchemaMap(id);
      if (schemaMap) {
        const seg = await generateSegmentsForDataset(userId, id, schemaMap, result.userIdField, label);
        console.log(`[upload] auto-generated ${seg.generated} segments for "${label}" (${seg.failed} failed)`);
      }
    } catch (err) {
      console.warn(`[upload] segment auto-generation failed (non-fatal):`, err);
    }

    // Reload registry cache so events.json (written during enrichment) is picked up
    reloadDynamicDatasets();

    // Fire-and-forget: auto-generate funnels + retentions in the background.
    // Not awaited — these involve LLM calls and would block onboarding for 10-30s.
    // The user can navigate to /funnels or /retentions and find them ready (or
    // the page-level lazy auto-gen will fill in if these haven't finished yet).
    const fullDataset = getDynamicDataset(id);
    if (fullDataset && (fullDataset.events?.length ?? 0) > 0) {
      generateFunnelsForDataset(userId, id, fullDataset)
        .then((r) => console.log(`[upload:bg] auto-generated ${r.generated} funnels for "${label}" (${r.failed} failed)`))
        .catch((err) => console.warn(`[upload:bg] funnel auto-generation failed:`, err));
      generateRetentionsForDataset(userId, id, fullDataset)
        .then((r) => console.log(`[upload:bg] auto-generated ${r.generated} retentions for "${label}" (${r.failed} failed)`))
        .catch((err) => console.warn(`[upload:bg] retention auto-generation failed:`, err));
    }

    return Response.json(result);
  } catch (err) {
    console.error("[datasets/upload] Error:", err);
    // Clean up orphaned dataset directory on failure (evicts cache + removes disk dir atomically)
    if (id) {
      deleteDynamicDataset(id);
    } else if (datasetDir && existsSync(datasetDir)) {
      rmSync(datasetDir, { recursive: true, force: true });
    }
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: status === 500 ? `Upload failed: ${message}` : message },
      { status },
    );
  } finally {
    // Always clean up tmp dir
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
