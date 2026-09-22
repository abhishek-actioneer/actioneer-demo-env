import { auth } from "@clerk/nextjs/server";
import { generateText, generateTextStream, type ModelId } from "@/lib/llm";
import { discoverSchema, formatSchemaForLLM } from "@/lib/schema-discovery";
import { CONNECTOR_MAPPING_PROMPT } from "@/lib/connector-categories";
import { getSystemContext } from "@/lib/schema";
import { DEFAULT_DATASET, getDataset, getDatasetForUser } from "@/lib/datasets";
import type { CellRole, NewCellType, PlaybookCellV2, PlaybookParam } from "@/lib/playbook-types";
import {
  reconcilePlaybookCellDependencies,
  validatePlaybookSqlCells,
  type PlaybookSqlValidationResponse,
  type PlaybookSqlValidationResult,
} from "@/lib/server/playbook-sql-validator";
import { z } from "zod/v4";

const CreateRequestSchema = z.object({
  query: z.string().min(1),
  proceedWithout: z.boolean().optional(),
  datasetId: z.string().optional(),
  clientRequestId: z.string().optional(),
});

function logCreate(reqId: string, stage: string, data?: Record<string, unknown>) {
  console.log(`[playbook-create:${reqId}] ${stage}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

function getDatasetQueryGuidance(datasetId: string, tableNames: string[]): string {
  const dataset = getDataset(datasetId);
  const sections: string[] = [];
  const availableTables = tableNames.join(", ");

  sections.push(`Available-table rule: dataset hints can mention broader source tables, but SQL may only reference tables in AVAILABLE TABLES (${availableTables}). If a hinted table is unavailable, use equivalent columns from the listed views.`);

  if (dataset.dateRange) {
    sections.push(`Dataset date range: ${dataset.dateRange.start} to ${dataset.dateRange.end}. Treat DATE '${dataset.dateRange.end}' as the fixed as-of date for relative phrases like "last 30 days", "recent", and follow-up windows. Do not use CURRENT_DATE for static samples. Do not use MAX(date) as the as-of date unless the user explicitly asks for data coverage, because lifecycle/future rows can extend past the intended analysis window.`);
  }

  if (dataset.summaryTableHint?.trim()) {
    sections.push(`Summary-table guidance:\n${dataset.summaryTableHint.trim()}`);
  }

  if (dataset.domainHints?.trim()) {
    sections.push(`Domain SQL guidance:\n${dataset.domainHints.trim()}`);
  }

  sections.push("Literal-value rule: string filters must use exact stored values from the schema guidance, including casing and underscores. Do not convert storage values into display labels inside SQL.");

  return sections.join("\n\n");
}

function reconcileGeneratedCellDependencies(
  cells: PlaybookCellV2[],
  tableNames: string[],
  reqId: string,
  send: (event: Record<string, unknown>) => void,
): PlaybookCellV2[] {
  const { cells: reconciled, inferred } = reconcilePlaybookCellDependencies(cells, tableNames);
  if (inferred.length === 0) return reconciled;

  const reconciledById = new Map(reconciled.map((cell) => [cell.id, cell]));
  for (const change of inferred) {
    const cell = reconciledById.get(change.cellId);
    logCreate(reqId, "dependencies:inferred", {
      cellId: change.cellId,
      added: change.added,
      dependsOn: change.dependsOn,
    });
    send({
      type: "cell_detail",
      cellId: change.cellId,
      sql: cell?.sql,
      outputs: cell?.outputs,
      dependsOn: change.dependsOn,
      repair: true,
      explanation: "Added missing dependencies for upstream playbook outputs referenced by SQL.",
    });
  }
  return reconciled;
}

function summarizeCellsForLog(cells: PlaybookCellV2[]) {
  const sqlCells = cells.filter((cell) => cell.type === "sql");
  const llmCells = cells.filter((cell) => cell.type === "llm");
  return {
    total: cells.length,
    sql: sqlCells.length,
    llm: llmCells.length,
    missingSql: sqlCells.filter((cell) => !cell.sql?.trim()).map((cell) => cell.id),
    missingPrompt: llmCells.filter((cell) => !cell.prompt?.trim()).map((cell) => cell.id),
    byRole: cells.reduce<Record<string, number>>((acc, cell) => {
      acc[cell.role] = (acc[cell.role] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

// ── Phase A: lightweight outline prompt (just DAG structure, no SQL/prompts) ──

function getOutlinePrompt(systemContext: string, schemaText: string, tableNames: string[], queryGuidance: string): string {
  return `${systemContext}

--- AVAILABLE TABLES ---
The ONLY tables you may reference: ${tableNames.join(", ")}

--- FULL SCHEMA ---
${schemaText}

--- DATASET QUERY GUIDANCE ---
${queryGuidance}

--- INSTRUCTIONS ---
You are designing an analytics playbook as a DAG (directed acyclic graph) of execution cells.
Output ONLY the structure — cell IDs, labels, roles, and dependency edges. Do NOT write SQL or LLM prompts.

## Cell Types
- **sql**: Will execute a SQL query
- **llm**: Will call an AI model for analysis/synthesis

## Cell Roles (in order)
- **guardrail**: Validates data availability/quality (prefer llm type; use sql only for a very simple row-count/date-range check)
- **parameter**: Computes dynamic values for downstream cells (sql type)
- **query**: Core analytical SQL queries (sql type)
- **analysis**: Interprets query results (llm type)
- **summary**: Final synthesis/report (llm type, always last)

## Rules
- IDs: "c1", "c2", "c3", etc.
- dependsOn lists cell IDs that must complete first. Cells without shared dependencies run in parallel.
- Typically 5-15 cells. End with a "summary" role cell.
- outputs: list of named output variables the cell produces.
- For each sql cell, include a "tables" field listing which tables from the schema it will query. This grounds each cell to real data.
- The "tables" field may contain only real schema tables from the AVAILABLE TABLES list. Do not put other cells' outputs in "tables".
- If a later cell needs a prior SQL cell's tabular output, add that prior cell to dependsOn and reference the output name in FROM/JOIN.
- Prefer independent query cells that read real dataset tables directly, then connect them to downstream LLM analysis/summary cells. Use SQL-to-SQL chaining only when it is clearly necessary.

## Output Format
Output EXACTLY one JSON object per line (NDJSON). No markdown, no code fences, no extra text.

{"type":"playbook_meta","name":"Concise Playbook Name","description":"1-2 sentence description"}
{"type":"outline_cell","cell":{"id":"c1","type":"llm","role":"guardrail","label":"Set Analysis Scope","description":"Confirm the analysis scope and data sources to inspect","dependsOn":[],"outputs":["scope_notes"],"tables":[]}}
{"type":"outline_cell","cell":{"id":"c2","type":"sql","role":"parameter","label":"Compute Date Range","description":"Calculate analysis period","dependsOn":["c1"],"outputs":["start_date","end_date"],"tables":["bookings"]}}
...more cells...
{"type":"outline_complete"}`;
}

// ── Phase B: detail fill prompt (SQL + LLM prompts for each cell) ──

function getDetailFillPrompt(
  systemContext: string,
  schemaText: string,
  tableNames: string[],
  queryGuidance: string,
  outlineCells: Array<{ id: string; label: string; type: string; role: string; dependsOn: string[]; outputs: string[] }>,
): string {
  return `${systemContext}

--- AVAILABLE TABLES ---
The ONLY tables you may use in SQL: ${tableNames.join(", ")}
If a table is not in this list, it DOES NOT EXIST. Do not reference it.

--- FULL SCHEMA ---
${schemaText}

--- DATASET QUERY GUIDANCE ---
${queryGuidance}

--- INSTRUCTIONS ---
You are filling in the SQL queries and LLM prompts for an analytics playbook.
The DAG structure has already been decided. Your job is to write the implementation for each cell.

## SQL Rules
- SQL cells MUST use ONLY tables and columns listed in the schema above. Any table NOT in the list above does NOT exist.
- SQL must be valid DuckDB SQL (supports CTEs, window functions, INTERVAL syntax, etc.)
- Must be a valid SELECT or WITH query.
- By default, every query-role SQL cell should query real dataset tables directly. Do NOT chain SQL cells through generated outputs unless the downstream query truly needs the upstream table result.
- Date literals must be quoted strings: WHERE col >= '2025-01-01' (NOT bare 2025-01-01)
- Use {{param_name}} for user-configurable values. Use {{column_name}} for values computed by parameter cells.
- Do not read from a cell's own output name. A SQL cell produces its outputs; those names are not available until after the cell finishes.
- To read a prior SQL cell's tabular result, the prior cell must be in dependsOn and the name must be one of that prior cell's outputs. Then use FROM output_name or JOIN output_name.
- If a downstream SQL cell reads an upstream output, the upstream SQL must project every column the downstream SQL references, with exact aliases.
- Never use a playbook output name as a helper table unless it is produced by a prior dependsOn SQL cell.
- Do not invent helper tables named start_date, end_date, analysis_start_date, analysis_end_date, data_status, or similar unless they are listed in AVAILABLE TABLES or are upstream outputs.
- If you need helper relations such as analysis_window, purchase_cohort, inactive_users, or segment_metrics, define them as CTEs inside the same SQL using WITH helper_name AS (...). Do not reference a helper relation unless it is a real table, a local CTE, or a prior dependency output.
- Add inline SQL comments (-- comment) before each logical block.

## LLM Rules
- For LLM cells, write clear instructions in the "prompt" field describing what analysis to perform.
- The prompt should reference what data the cell will receive from its dependencies.
- For the final summary cell, make the prompt explicit that this cell's output is the final user-facing artifact. It should return raw markdown with key findings, recommendations, compact markdown tables when useful, and valid \`\`\`chart fenced JSON blocks when upstream data supports charts.

## Output Format
Output EXACTLY one JSON object per line (NDJSON). No markdown, no code fences, no extra text.
For each cell, output its implementation:

For sql cells:
{"type":"cell_detail","cellId":"c1","sql":"SELECT COUNT(*) AS total_rows FROM bookings","outputs":["total_rows"]}

For llm cells:
{"type":"cell_detail","cellId":"c4","prompt":"Analyze the query results and identify key patterns..."}

After all cells, output params, produces, and completion:
{"type":"params","params":[{"name":"lookback_days","label":"Lookback Days","type":"integer","defaultVal":"30","group":"Date Range"}]}
{"type":"produces","produces":[{"name":"acquisition_summary","description":"Weekly installs by channel and country","columns":[{"name":"week","description":"Week start date"},{"name":"installs","description":"Total installs"},{"name":"channel","description":"Media source"}]}]}
{"type":"generation_complete"}

For produces: list each named output table produced by SQL query cells. Include up to 5 columns per table — name + a short description (under 7 words each). Omit produces if there are no meaningful output tables.

--- PLAYBOOK OUTLINE ---
${outlineCells.map(c => JSON.stringify(c)).join("\n")}`;
}

// ── Shared NDJSON line parser ──

function tryParseLine(
  line: string,
  validTypes: string[],
  sentEvents: Set<string>,
  send: (event: Record<string, unknown>) => void,
): Record<string, unknown> | null {
  let trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("```")) return null;
  if (!trimmed.startsWith("{")) return null;
  const lastBrace = trimmed.lastIndexOf("}");
  if (lastBrace !== trimmed.length - 1 && lastBrace > 0) {
    trimmed = trimmed.slice(0, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (validTypes.includes(parsed.type)) {
      // Deduplicate by cell ID or event type
      const eventKey =
        parsed.type === "outline_cell" ? `outline:${parsed.cell?.id}` :
        parsed.type === "cell_detail" ? `detail:${parsed.cellId}` :
        parsed.type === "cell" ? `cell:${parsed.cell?.id}` :
        parsed.type;
      if (!sentEvents.has(eventKey)) {
        sentEvents.add(eventKey);
        send(parsed);
        return parsed;
      }
    }
  } catch { /* skip unparseable */ }
  return null;
}

// ── Stream an LLM call and parse NDJSON lines ──

async function streamLLMAndParse(
  prompt: string,
  validTypes: string[],
  sentEvents: Set<string>,
  send: (event: Record<string, unknown>) => void,
  modelId?: ModelId,
  options: { label?: string; timeoutMs?: number; maxOutputTokens?: number } = {},
): Promise<Record<string, unknown>[]> {
  const llmStream = await generateTextStream(prompt, {
    modelId,
    label: options.label,
    timeoutMs: options.timeoutMs,
    maxOutputTokens: options.maxOutputTokens,
  });

  let buffer = "";
  const collected: Record<string, unknown>[] = [];

  for await (const text of llmStream) {
    if (!text) continue;
    buffer += text;

    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      const parsed = tryParseLine(line, validTypes, sentEvents, send);
      if (parsed) collected.push(parsed);
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const remaining = buffer.replace(/```\s*$/g, "").trim();
    for (const line of remaining.split("\n")) {
      const parsed = tryParseLine(line, validTypes, sentEvents, send);
      if (parsed) collected.push(parsed);
    }
  }

  return collected;
}

type GeneratedOutlineCell = {
  id?: string;
  label?: string;
  description?: string;
  type?: string;
  role?: string;
  dependsOn?: unknown;
  outputs?: unknown;
  sql?: string;
  prompt?: string;
};

type GeneratedDetailEvent = Record<string, unknown> & {
  cellId?: string;
  sql?: string;
  prompt?: string;
  outputs?: unknown;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeCellType(value: unknown, role: CellRole): NewCellType {
  if (value === "llm" || role === "analysis" || role === "summary") return "llm";
  return "sql";
}

function normalizeCellRole(value: unknown, type: NewCellType, index: number, total: number): CellRole {
  if (
    value === "guardrail" ||
    value === "parameter" ||
    value === "query" ||
    value === "analysis" ||
    value === "summary"
  ) {
    return value;
  }
  if (index === total - 1) return "summary";
  return type === "llm" ? "analysis" : "query";
}

function buildCellsFromOutlineAndDetails(
  outlineCells: GeneratedOutlineCell[],
  detailEvents: GeneratedDetailEvent[],
): PlaybookCellV2[] {
  const detailMap = new Map<string, GeneratedDetailEvent>();
  for (const detail of detailEvents) {
    if (typeof detail.cellId === "string") detailMap.set(detail.cellId, detail);
  }

  return outlineCells.map((raw, index) => {
    const id = raw.id || `c${index + 1}`;
    const detail = detailMap.get(id);
    const role = normalizeCellRole(raw.role, raw.type === "llm" ? "llm" : "sql", index, outlineCells.length);
    const type = normalizeCellType(raw.type, role);
    const outputs = asStringArray(detail?.outputs).length > 0
      ? asStringArray(detail?.outputs)
      : asStringArray(raw.outputs);

    return {
      id,
      type,
      role,
      label: raw.label || `Step ${index + 1}`,
      description: raw.description || "",
      status: "idle",
      dependsOn: asStringArray(raw.dependsOn),
      outputs: outputs.length > 0 ? outputs : [`result_${id}`],
      ...(type === "sql" && (typeof detail?.sql === "string" || typeof raw.sql === "string")
        ? { sql: (detail?.sql as string | undefined) ?? raw.sql }
        : {}),
      ...(type === "llm" && (typeof detail?.prompt === "string" || typeof raw.prompt === "string")
        ? { prompt: (detail?.prompt as string | undefined) ?? raw.prompt }
        : {}),
    };
  });
}

function buildCellsFromSinglePhaseEvents(events: Record<string, unknown>[]): PlaybookCellV2[] {
  const cellEvents = events.filter((event) => event.type === "cell");
  return cellEvents.map((event, index) => {
    const raw = (event.cell ?? {}) as GeneratedOutlineCell;
    const role = normalizeCellRole(raw.role, raw.type === "llm" ? "llm" : "sql", index, cellEvents.length);
    const type = normalizeCellType(raw.type, role);
    const id = raw.id || `c${index + 1}`;
    const outputs = asStringArray(raw.outputs);
    return {
      id,
      type,
      role,
      label: raw.label || `Step ${index + 1}`,
      description: raw.description || "",
      status: "idle",
      dependsOn: asStringArray(raw.dependsOn),
      outputs: outputs.length > 0 ? outputs : [`result_${id}`],
      ...(type === "sql" && typeof raw.sql === "string" ? { sql: raw.sql } : {}),
      ...(type === "llm" && typeof raw.prompt === "string" ? { prompt: raw.prompt } : {}),
    };
  });
}

function summarizeValidationErrors(results: PlaybookSqlValidationResult[]): string {
  return results
    .filter((result) => !result.valid)
    .slice(0, 4)
    .map((result) => `${result.cellId}: ${result.error ?? "Invalid SQL"}`)
    .join("; ");
}

function summarizeValidationForLog(validation: PlaybookSqlValidationResponse) {
  const failed = validation.results.filter((result) => !result.valid);
  return {
    valid: validation.valid,
    sqlTargetCount: validation.sqlTargetCount,
    resultCount: validation.results.length,
    failedCount: failed.length,
    failed: failed.slice(0, 10).map((result) => ({
      cellId: result.cellId,
      error: result.error,
    })),
  };
}

function formatCellForRepairContext(cell: PlaybookCellV2): string {
  const header = `- ${cell.id} [${cell.type}/${cell.role}] ${cell.label}; dependsOn=[${cell.dependsOn.join(",")}]; outputs=[${cell.outputs.join(",")}]`;
  if (cell.type === "sql" && cell.sql?.trim()) {
    return `${header}\nSQL:\n\`\`\`sql\n${cell.sql.trim()}\n\`\`\``;
  }
  if (cell.type === "llm" && cell.prompt?.trim()) {
    return `${header}\nPrompt: ${cell.prompt.trim()}`;
  }
  return header;
}

async function repairInvalidSqlCell(args: {
  cell: PlaybookCellV2;
  cells: PlaybookCellV2[];
  params: PlaybookParam[];
  validationError: string;
  schemaText: string;
  tableNames: string[];
  queryGuidance: string;
  userQuery: string;
  modelId?: ModelId;
}): Promise<{ sql?: string; explanation?: string }> {
  const upstream = args.cells.filter((candidate) => args.cell.dependsOn.includes(candidate.id));
  const upstreamSqlSection = upstream
    .filter((cell) => cell.type === "sql" && cell.sql?.trim())
    .map(formatCellForRepairContext)
    .join("\n\n");
  const prompt = `You are repairing one DuckDB SQL cell in an analytics playbook.

--- USER REQUEST ---
"${args.userQuery}"

--- AVAILABLE TABLES ---
Only these real dataset tables exist: ${args.tableNames.join(", ")}

--- FULL SCHEMA ---
${args.schemaText}

--- DATASET QUERY GUIDANCE ---
${args.queryGuidance}

--- PLAYBOOK CELLS ---
${args.cells.map((cell) => `- ${cell.id} [${cell.type}/${cell.role}] ${cell.label}; dependsOn=[${cell.dependsOn.join(",")}]; outputs=[${cell.outputs.join(",")}]`).join("\n")}

--- CELL TO REPAIR ---
ID: ${args.cell.id}
Label: ${args.cell.label}
Description: ${args.cell.description}
Role: ${args.cell.role}
Depends on: ${args.cell.dependsOn.join(", ") || "(none)"}
Outputs this cell should produce: ${args.cell.outputs.join(", ") || "(none)"}
Params: ${JSON.stringify(args.params)}
Upstream outputs available to this cell: ${upstream.flatMap((cell) => cell.outputs).join(", ") || "(none)"}

--- UPSTREAM SQL DEFINITIONS ---
These define the actual columns available when this cell reads an upstream output.
${upstreamSqlSection || "(none)"}

Current SQL:
\`\`\`sql
${args.cell.sql || "-- missing SQL"}
\`\`\`

Validation error:
${args.validationError}

Rules:
- Return one valid DuckDB SELECT or WITH query only.
- Prefer querying real dataset tables directly.
- Only use FROM/JOIN against an upstream playbook output when the producing cell is listed in dependsOn.
- Never read from this cell's own outputs: ${args.cell.outputs.join(", ") || "(none)"}.
- If the current SQL references a missing helper table, either define that helper as a local CTE in this SQL or replace it with real dataset tables. Do not leave bare helper table names unresolved.
- If a DuckDB binder error says an upstream alias/table does not have a column, inspect the upstream SQL definition and use only columns that the upstream SELECT actually projects.
- Use scalar placeholders like {{start_date}} only when produced by an upstream parameter cell or listed in params.
- Date literals must be quoted strings.
- Do not emit markdown or code fences.

Return JSON only:
{"sql":"SELECT ...","explanation":"brief reason"}`;

  const raw = await generateText(prompt, {
    modelId: args.modelId,
    jsonMode: true,
    timeoutMs: 45_000,
    label: `repair playbook SQL ${args.cell.id}`,
  });

  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()) as {
      sql?: string;
      fixedSql?: string;
      explanation?: string;
    };
    const sql = (parsed.sql ?? parsed.fixedSql ?? "").trim()
      .replace(/^```(?:sql)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return { sql, explanation: parsed.explanation };
  } catch {
    return {};
  }
}

async function validateAndRepairGeneratedCells(args: {
  cells: PlaybookCellV2[];
  params: PlaybookParam[];
  datasetId: string;
  schemaText: string;
  tableNames: string[];
  queryGuidance: string;
  userQuery: string;
  modelId?: ModelId;
  reqId: string;
  send: (event: Record<string, unknown>) => void;
}): Promise<{ cells: PlaybookCellV2[]; validation: Awaited<ReturnType<typeof validatePlaybookSqlCells>> }> {
  let cells = reconcileGeneratedCellDependencies(args.cells, args.tableNames, args.reqId, args.send);
  logCreate(args.reqId, "validation:start", {
    datasetId: args.datasetId,
    cells: summarizeCellsForLog(cells),
    params: args.params.map((param) => param.name),
  });
  let validation = await validatePlaybookSqlCells({
    cells,
    params: args.params,
    datasetId: args.datasetId,
  });
  logCreate(args.reqId, "validation:result", summarizeValidationForLog(validation));

  for (let attempt = 1; attempt <= 2 && !validation.valid; attempt++) {
    const failed = validation.results.filter((result) => !result.valid);
    console.warn(`[playbook-create:${args.reqId}] SQL validation failed attempt ${attempt}: ${summarizeValidationErrors(failed)}`);
    logCreate(args.reqId, "repair:attempt:start", {
      attempt,
      failedCount: failed.length,
      failedCellIds: failed.map((result) => result.cellId),
    });
    args.send({ type: "phase", phase: "repairing_sql" });

    for (const result of failed) {
      const cell = cells.find((candidate) => candidate.id === result.cellId);
      if (!cell || cell.type !== "sql") continue;
      try {
        logCreate(args.reqId, "repair:cell:start", {
          attempt,
          cellId: cell.id,
          label: cell.label,
          role: cell.role,
          dependsOn: cell.dependsOn,
          outputs: cell.outputs,
          sqlLength: cell.sql?.length ?? 0,
          error: result.error,
        });
        const repaired = await repairInvalidSqlCell({
          cell,
          cells,
          params: args.params,
          validationError: result.error ?? "Invalid SQL",
          schemaText: args.schemaText,
          tableNames: args.tableNames,
          queryGuidance: args.queryGuidance,
          userQuery: args.userQuery,
          modelId: args.modelId,
        });
        if (!repaired.sql) {
          logCreate(args.reqId, "repair:cell:no_sql", { attempt, cellId: cell.id });
          continue;
        }
        cells = cells.map((candidate) =>
          candidate.id === cell.id ? { ...candidate, sql: repaired.sql } : candidate
        );
        cells = reconcileGeneratedCellDependencies(cells, args.tableNames, args.reqId, args.send);
        logCreate(args.reqId, "repair:cell:applied", {
          attempt,
          cellId: cell.id,
          repairedSqlLength: repaired.sql.length,
          explanation: repaired.explanation,
        });
        args.send({
          type: "cell_detail",
          cellId: cell.id,
          sql: repaired.sql,
          outputs: cell.outputs,
          repair: true,
          explanation: repaired.explanation,
        });
      } catch (err) {
        console.warn(`[playbook-create:${args.reqId}] Repair failed for ${cell.id}:`, err);
        logCreate(args.reqId, "repair:cell:threw", {
          attempt,
          cellId: cell.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    validation = await validatePlaybookSqlCells({
      cells,
      params: args.params,
      datasetId: args.datasetId,
    });
    logCreate(args.reqId, "repair:attempt:validation", {
      attempt,
      ...summarizeValidationForLog(validation),
    });
  }

  logCreate(args.reqId, "validation:final", summarizeValidationForLog(validation));
  return { cells, validation };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { query, proceedWithout, datasetId: bodyDatasetId, clientRequestId } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const reqId = Math.random().toString(36).slice(2, 8);
  logCreate(reqId, "request:start", {
    userId,
    datasetId,
    model: modelId ?? "default",
    proceedWithout: !!proceedWithout,
    clientRequestId,
    queryLength: query.length,
  });
  console.log(`[playbook-create:${reqId}] === START === userId=${userId} datasetId=${datasetId} model=${modelId ?? "default"} proceedWithout=${!!proceedWithout}`);
  console.log(`[playbook-create:${reqId}] User query: "${query}"`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: Record<string, unknown>) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Stream already closed
        }
      }

      try {
        await runPlaybookGeneration({
          query,
          datasetId,
          modelId,
          proceedWithout: !!proceedWithout,
          clientRequestId,
          reqId,
          send,
        });
      } finally {
        closed = true;
        logCreate(reqId, "request:close_stream");
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Core playbook generation: schema discovery → outline → detail fill → SQL
 * validation/repair. Streams progress via `send` and resolves when generation
 * finishes (it emits its own `generation_complete` / `error` / `done` events).
 * Shared by the HTTP route (POST, which provides a streaming `send`) and headless
 * callers like scripts/verify-dataset.ts (which provide a collecting `send`).
 */
export async function runPlaybookGeneration(args: {
  query: string;
  datasetId: string;
  modelId?: ModelId;
  proceedWithout?: boolean;
  clientRequestId?: string;
  reqId: string;
  send: (event: Record<string, unknown>) => void;
}): Promise<void> {
  const { query, datasetId, modelId, proceedWithout, clientRequestId, reqId, send } = args;
  try {
    send({
      type: "debug",
      stage: "create_stream_started",
      reqId,
      clientRequestId,
      datasetId,
    });
        // ── Start schema discovery ──
        send({ type: "phase", phase: "discovering_schema" });
        console.log(`[playbook-create:${reqId}] Phase 1: discovering schema for datasetId=${datasetId}`);
        const schemaPromise = discoverSchema(datasetId).then((s) => {
          console.log(`[playbook-create:${reqId}] Schema discovered: ${s.tableNames.length} tables — ${s.tableNames.join(", ")}`);
          return s;
        });

        // ── Start connector check in parallel (unless skipped) ──
        // Non-critical: if it times out or fails, proceed without connector suggestions
        const connectorPromise = proceedWithout
          ? Promise.resolve(null)
          : (async () => {
              const schema = await schemaPromise;
              const text = formatSchemaForLLM(schema);
              const connectorPrompt = `${CONNECTOR_MAPPING_PROMPT}\n\n--- USER REQUEST ---\n"${query}"\n\n--- AVAILABLE SCHEMA ---\n${text}`;
              console.log(`[playbook-create:${reqId}] Connector check prompt (length ${connectorPrompt.length}):\n${connectorPrompt}`);
              const rawText = await generateText(
                connectorPrompt,
                { modelId, timeoutMs: 45_000, label: "Connector check" },
              );
              console.log(`[playbook-create:${reqId}] Connector check raw response:\n${rawText}`);
              const jsonStr = rawText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
              try {
                const parsed = JSON.parse(jsonStr) as {
                  missing?: Array<{ description: string; reason: string }>;
                  recommendedCategories?: string[];
                  canProceedWithout?: boolean;
                  degradedDescription?: string;
                };
                console.log(`[playbook-create:${reqId}] Connector check parsed:`, JSON.stringify(parsed));
                return parsed;
              } catch (err) {
                console.warn(`[playbook-create:${reqId}] Connector check JSON parse failed:`, err);
                return {};
              }
            })().catch((err) => {
              console.warn(`[playbook-create:${reqId}] Connector check failed (non-critical):`, err.message);
              return null;
            });

        // ── Await schema (connector check continues in background) ──
        const schema = await schemaPromise;
        const schemaText = formatSchemaForLLM(schema);
        const systemContext = getSystemContext(datasetId);
        const tableNames = schema.tableNames;
        const queryGuidance = getDatasetQueryGuidance(datasetId, tableNames);

        // ── Phase A: Stream outline (fast, ~2-3s) ──
        send({ type: "phase", phase: "planning_outline" });
        send({ type: "outline_start" });

        const sentEvents = new Set<string>();
        const outlinePrompt = `${getOutlinePrompt(systemContext, schemaText, tableNames, queryGuidance)}\n\n--- USER REQUEST ---\n"${query}"`;
        console.log(`[playbook-create:${reqId}] Phase A — OUTLINE prompt (length ${outlinePrompt.length}):\n${outlinePrompt}`);

        let outlineCells: Array<{ id: string; label: string; description: string; type: string; role: string; dependsOn: string[]; outputs: string[] }> = [];
        let outlineFailed = false;

        try {
          const outlineEvents = await streamLLMAndParse(
            outlinePrompt,
            ["playbook_meta", "outline_cell", "outline_complete"],
            sentEvents,
            send,
            modelId,
            { label: "Playbook outline generation", timeoutMs: 60_000, maxOutputTokens: 4_096 },
          );

          outlineCells = outlineEvents
            .filter((e) => e.type === "outline_cell")
            .map((e) => {
              const cell = (e as Record<string, unknown>).cell as typeof outlineCells[number];
              // LLM sometimes outputs role names as type (e.g. "analysis", "summary") — coerce to valid types
              if (!["sql", "llm"].includes(cell.type)) {
                console.log(`[playbook-create:${reqId}] Outline cell ${cell.id} had invalid type "${cell.type}" — coerced to ${["analysis", "summary"].includes(cell.role) ? "llm" : "sql"}`);
                cell.type = ["analysis", "summary"].includes(cell.role) ? "llm" : "sql";
              }
              return cell;
            });

          console.log(`[playbook-create:${reqId}] Phase A complete — ${outlineCells.length} outline cells parsed:`);
          for (const c of outlineCells) {
            console.log(`[playbook-create:${reqId}]   - ${c.id} [${c.type}/${c.role}] "${c.label}" deps=[${c.dependsOn.join(",")}] outputs=[${c.outputs?.join(",") ?? ""}]`);
          }

          // Always send outline_complete even if LLM didn't
          if (!sentEvents.has("outline_complete")) {
            send({ type: "outline_complete" });
          }
        } catch (err) {
          console.warn(`[playbook-create:${reqId}] Outline phase failed, falling back to single-phase:`, err);
          outlineFailed = true;
        }

        // ── Check connector result (should be resolved by now) ──
        if (!proceedWithout) {
          const mapping = await connectorPromise;
          console.log(`[playbook-create:${reqId}] Connector mapping result:`, JSON.stringify(mapping));
          if (mapping && mapping.missing && mapping.missing.length > 0) {
            console.log(`[playbook-create:${reqId}] Connector required — short-circuiting with ${mapping.missing.length} missing connector(s)`);
            send({
              type: "connector_required",
              missing: mapping.missing,
              recommendedCategories: (mapping as Record<string, unknown>).recommendedCategories || [],
              canProceedWithout: mapping.canProceedWithout ?? true,
              degradedDescription: mapping.degradedDescription || undefined,
            });
            send({ type: "done" });
            return;
          }
        }

        const proceedNote = proceedWithout
          ? "\n\nIMPORTANT: The user chose to proceed with only the available data. Generate queries using ONLY the tables listed above."
          : "";

        // ── Fallback: single-phase if outline failed ──
        if (outlineFailed || outlineCells.length === 0) {
          console.log(`[playbook-create:${reqId}] Falling back to SINGLE-PHASE generation (outlineFailed=${outlineFailed}, cells=${outlineCells.length})`);
          send({ type: "phase", phase: "generating_cells" });

          const fullPrompt = `${getPlaybookGenerationPrompt(systemContext, queryGuidance, getDataset(datasetId).dateRange?.end)}\n\n--- AVAILABLE SCHEMA ---\n${schemaText}\n\n--- USER REQUEST ---\n"${query}"${proceedNote}`;
          console.log(`[playbook-create:${reqId}] Single-phase prompt (length ${fullPrompt.length}):\n${fullPrompt}`);

          const singleEvents = await streamLLMAndParse(
            fullPrompt,
            ["playbook_meta", "cell", "params", "produces"],
            sentEvents,
            send,
            modelId,
            { label: "Playbook single-phase generation", timeoutMs: 120_000, maxOutputTokens: 12_000 },
          );

          console.log(`[playbook-create:${reqId}] Single-phase complete — ${singleEvents.length} events emitted`);
          for (const evt of singleEvents) {
            if (evt.type === "cell") {
              const cell = (evt as Record<string, unknown>).cell as Record<string, unknown>;
              console.log(`[playbook-create:${reqId}]   cell ${cell.id} [${cell.type}/${cell.role}] "${cell.label}"${cell.sql ? ` SQL: ${(cell.sql as string).slice(0, 200).replace(/\n/g, " ")}…` : ""}${cell.prompt ? ` PROMPT: ${(cell.prompt as string).slice(0, 200).replace(/\n/g, " ")}…` : ""}`);
            } else if (evt.type === "params") {
              console.log(`[playbook-create:${reqId}]   params:`, JSON.stringify((evt as Record<string, unknown>).params));
            }
          }

          send({ type: "phase", phase: "validating_sql" });
          const singleCells = buildCellsFromSinglePhaseEvents(singleEvents);
          const singleParams = (singleEvents.find((evt) => evt.type === "params")?.params ?? []) as PlaybookParam[];
          logCreate(reqId, "single_phase:before_validation", {
            cells: summarizeCellsForLog(singleCells),
            params: singleParams.map((param) => param.name),
          });
          const { cells: validatedCells, validation } = await validateAndRepairGeneratedCells({
            cells: singleCells,
            params: singleParams,
            datasetId,
            schemaText,
            tableNames,
            queryGuidance,
            userQuery: query,
            modelId,
            reqId,
            send,
          });

          if (!validation.valid) {
            throw new Error(`Generated SQL did not validate after repair attempts: ${summarizeValidationErrors(validation.results)}`);
          }

          logCreate(reqId, "single_phase:generation_complete", {
            cells: summarizeCellsForLog(validatedCells),
          });
          send({ type: "generation_complete", cells: validatedCells });
          send({ type: "done" });
          console.log(`[playbook-create:${reqId}] === END (single-phase) ===`);
          return;
        }

        // ── Phase B: Stream detail fill ──
        send({ type: "phase", phase: "generating_details" });
        send({ type: "detail_start" });

        const detailPrompt = `${getDetailFillPrompt(systemContext, schemaText, tableNames, queryGuidance, outlineCells)}\n\n--- USER REQUEST ---\n"${query}"${proceedNote}`;
        console.log(`[playbook-create:${reqId}] Phase B — DETAIL prompt (length ${detailPrompt.length}):\n${detailPrompt}`);

        const detailEvents = await streamLLMAndParse(
          detailPrompt,
          ["cell_detail", "params", "produces"],
          sentEvents,
          send,
          modelId,
          { label: "Playbook detail generation", timeoutMs: 120_000, maxOutputTokens: 12_000 },
        );

        console.log(`[playbook-create:${reqId}] Phase B complete — ${detailEvents.length} detail events emitted`);
        for (const evt of detailEvents) {
          if (evt.type === "cell_detail") {
            const cellId = evt.cellId as string;
            if (evt.sql) console.log(`[playbook-create:${reqId}]   ${cellId} SQL:\n${evt.sql}`);
            if (evt.prompt) console.log(`[playbook-create:${reqId}]   ${cellId} PROMPT:\n${evt.prompt}`);
          } else if (evt.type === "params") {
            console.log(`[playbook-create:${reqId}]   params:`, JSON.stringify((evt as Record<string, unknown>).params));
          } else if (evt.type === "produces") {
            console.log(`[playbook-create:${reqId}]   produces:`, JSON.stringify((evt as Record<string, unknown>).produces));
          }
        }

        send({ type: "phase", phase: "validating_sql" });
        const params = (detailEvents.find((evt) => evt.type === "params")?.params ?? []) as PlaybookParam[];
        const generatedCells = buildCellsFromOutlineAndDetails(outlineCells, detailEvents as GeneratedDetailEvent[]);
        logCreate(reqId, "two_phase:before_validation", {
          outlineCount: outlineCells.length,
          detailCount: detailEvents.filter((event) => event.type === "cell_detail").length,
          params: params.map((param) => param.name),
          cells: summarizeCellsForLog(generatedCells),
        });
        const { cells: validatedCells, validation } = await validateAndRepairGeneratedCells({
          cells: generatedCells,
          params,
          datasetId,
          schemaText,
          tableNames,
          queryGuidance,
          userQuery: query,
          modelId,
          reqId,
          send,
        });

        if (!validation.valid) {
          throw new Error(`Generated SQL did not validate after repair attempts: ${summarizeValidationErrors(validation.results)}`);
        }

        logCreate(reqId, "two_phase:generation_complete", {
          cells: summarizeCellsForLog(validatedCells),
        });
        send({ type: "detail_complete" });
        send({ type: "generation_complete", cells: validatedCells });
        send({ type: "done" });
        console.log(`[playbook-create:${reqId}] === END (two-phase) ===`);
      } catch (err) {
        console.error(`[playbook-create:${reqId}] FATAL:`, err);
        logCreate(reqId, "request:fatal", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
        });
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
  }
}

// ── Legacy single-phase prompt (used as fallback) ──

function getPlaybookGenerationPrompt(systemContext: string, queryGuidance: string, asOfDate?: string): string {
  const dateAnchorExpression = asOfDate ? `DATE '${asOfDate}'` : "CURRENT_DATE";
  return `${systemContext}

--- DATASET QUERY GUIDANCE ---
${queryGuidance}

You are designing an analytics playbook as a DAG (directed acyclic graph) of execution cells.
The playbook will be rendered as a visual workflow and executed step by step.

## Cell Types
- **sql**: Executes a SQL query against DuckDB. Must be a valid SELECT or WITH query using ONLY tables and columns from the schema below.
- **llm**: Calls an AI model to analyze data. Receives all dependency cell outputs as context. Use for interpretation, scoring, summarization.

## Cell Roles
- **guardrail**: First cell(s). Prefer llm guardrails that set scope and data assumptions. Use SQL only for a very simple row-count/date-range check.
- **parameter**: SQL cell that computes dynamic values for downstream cells (e.g., SELECT ${dateAnchorExpression} AS end_date, ${dateAnchorExpression} - INTERVAL '30' DAY AS start_date). Column names in the result become available as {{column_name}} placeholders in downstream SQL.
- **query**: Core analytical SQL queries — the main data retrieval work.
- **analysis**: LLM cell that interprets query results — identifies patterns, anomalies, findings.
- **summary**: Final LLM cell that synthesizes everything into a report with key findings and recommendations.

## Output Rules
1. Each cell has a unique id: "c1", "c2", "c3", etc.
2. dependsOn lists cell IDs that must complete before this cell runs. Cells with no shared dependencies run in parallel.
3. SQL cells MUST use ONLY tables and columns from the schema provided. Do NOT reference tables that don't exist.
4. Use {{param_name}} for user-configurable values (defined in params). Use {{column_name}} for values computed by parameter cells.
4a. Add inline SQL comments (-- comment) before each logical block, filter clause, or calculated column to explain what it does.
4b. A cell must not query its own output as a table. Only downstream cells can read a SQL cell's output table, and only when the producing cell is in dependsOn.
4c. Do not invent helper tables such as start_date, end_date, analysis_start_date, analysis_end_date, or data_status. They are columns/output names unless listed in the schema.
4d. Prefer independent query cells that read real dataset tables directly. Use SQL-to-SQL chaining only when the downstream SQL truly needs the upstream table output.
4e. If you need helper relations such as analysis_window, purchase_cohort, inactive_users, or segment_metrics, define them as CTEs inside the same SQL using WITH helper_name AS (...). Do not reference unresolved helper table names.
4f. If a downstream SQL cell reads an upstream output, the upstream SQL must project every column the downstream SQL references, with exact aliases.
5. Decide the right number of cells based on the user's request complexity (typically 5-15). Use a mix of sql and llm cells appropriate for the task.
6. The workflow should end with at least one llm cell (role "analysis" or "summary") that interprets the data. The final cell should always be role "summary".
7. For LLM cells, write clear instructions in the "prompt" field describing what analysis to perform.
7a. The final summary cell's prompt must say its output is the final user-facing artifact and should return raw markdown with key findings, recommendations, compact markdown tables when useful, and valid \`\`\`chart fenced JSON blocks when upstream data supports charts.
8. SQL must be valid DuckDB SQL (supports CTEs, window functions, INTERVAL syntax, etc.)

## Output Format
Output EXACTLY one JSON object per line (NDJSON). No markdown, no code fences, no extra text.
First emit metadata, then cells in dependency order, then params:

{"type":"playbook_meta","name":"Concise Playbook Name","description":"1-2 sentence description of what this playbook analyzes"}
{"type":"cell","cell":{"id":"c1","type":"llm","role":"guardrail","label":"Set Analysis Scope","description":"Confirm the analysis scope and data sources to inspect","dependsOn":[],"outputs":["scope_notes"],"prompt":"Review the requested analysis scope and note the key data sources that downstream query cells should inspect."}}
{"type":"cell","cell":{"id":"c2","type":"sql","role":"parameter","label":"Compute Date Range","description":"Calculate analysis period from the dataset as-of date","dependsOn":["c1"],"outputs":["start_date","end_date"],"sql":"SELECT ${dateAnchorExpression} - INTERVAL '30' DAY AS start_date, ${dateAnchorExpression} AS end_date"}}
{"type":"cell","cell":{"id":"c3","type":"sql","role":"query","label":"...","description":"...","dependsOn":["c2"],"outputs":["..."],"sql":"SELECT ..."}}
{"type":"cell","cell":{"id":"c4","type":"llm","role":"analysis","label":"Analyze Results","description":"...","dependsOn":["c3"],"outputs":["findings"],"prompt":"Analyze the query results and identify..."}}
{"type":"cell","cell":{"id":"c5","type":"llm","role":"summary","label":"Final Report","description":"...","dependsOn":["c4"],"outputs":["report"],"prompt":"Synthesize all findings into a final report..."}}
{"type":"params","params":[{"name":"lookback_days","label":"Lookback Days","type":"integer","defaultVal":"30","group":"Date Range"}]}
{"type":"produces","produces":[{"name":"daily_metrics","description":"Daily metrics aggregated by channel","columns":[{"name":"date","description":"Calendar date"},{"name":"installs","description":"Total installs"}]}]}
{"type":"generation_complete"}`;
}
