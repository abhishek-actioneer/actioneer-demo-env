import { generateTextStream, type ModelId } from "./llm";
import { executeSQL, executeSQLInternal, type QueryResult } from "./sql-executor";
import { getSystemContext } from "./schema";
import { DEFAULT_DATASET, getDataset } from "./datasets";
import { discoverSchema, formatSchemaForLLM } from "./schema-discovery";
import type { Playbook, PlaybookV2, PlaybookCellV2 } from "./playbook-types";
import { substituteParams, buildParamMap, mergeComputedParams } from "./playbook-params";
import {
  buildOutputProducers,
  extractTablesFromPlaybookSQL as extractTablesFromSQL,
  makePlaybookViewName as makeRunViewName,
  preparePlaybookSqlCell,
  quotePlaybookIdent as quoteIdent,
  reconcilePlaybookCellDependencies,
} from "./server/playbook-sql-validator";

type SendFn = (event: Record<string, unknown>) => void;

// ── Shared helpers ──

const FINAL_OUTPUT_FORMAT_INSTRUCTIONS = `Final output requirements:
- This cell is the user-facing final output artifact. Return raw markdown only.
- Start with the direct answer and key findings.
- Include at least one compact markdown table when upstream data contains rows worth comparing.
- Include 1-3 interactive charts when upstream data supports a visualization, using this exact fenced format:
\`\`\`chart
{"type":"bar","title":"Descriptive title","data":[{"label":"A","value":10},{"label":"B","value":20}],"xKey":"label","yKeys":["value"],"yLabels":["Value"]}
\`\`\`
- Valid chart types: bar, line, area, pie, scatter, combo, stacked-area, grouped-bar, funnel.
- Chart values must come from the upstream data in this run. Do not invent or estimate chart data.
- Place charts near the finding they support, not at the end.`;

/** Find any {{placeholder}} tokens in the SQL that aren't satisfied by the param map. */
function findUnresolvedPlaceholders(sql: string, paramMap: Record<string, string>): string[] {
  const unresolved = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (!(m[1] in paramMap)) unresolved.add(m[1]);
  }
  return Array.from(unresolved);
}

async function streamLLMCell(
  send: SendFn,
  cellId: string,
  prompt: string,
  modelId?: ModelId,
  runId?: string,
): Promise<string> {
  let fullText = "";
  const tag = runId ? `[playbook-run:${runId}]` : "[playbook-run]";
  console.log(`${tag} LLM cell ${cellId} prompt (length ${prompt.length}):\n${prompt}`);

  try {
    const stream = await generateTextStream(prompt, { modelId });

    for await (const text of stream) {
      fullText += text;
      send({ type: "text", cellId, delta: text });
    }
    console.log(`${tag} LLM cell ${cellId} response (length ${fullText.length}):\n${fullText}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "LLM call failed";
    console.error(`${tag} LLM cell ${cellId} failed:`, errorMsg);
    send({ type: "text", cellId, delta: `\n\nError: ${errorMsg}` });
    fullText += `\n\nError: ${errorMsg}`;
  }

  return fullText;
}

// ── V2 DAG Executor ──

/** Format a cell's output for injection into downstream LLM prompts */
function formatCellOutput(cellId: string, label: string, output: unknown): string {
  if (!output) return `${label}: (no output)`;

  // QueryResult from SQL cells
  if (typeof output === "object" && output !== null && "columns" in output) {
    const qr = output as QueryResult;
    if (qr.error) return `${label}: FAILED — ${qr.error}`;
    const preview = qr.rows.slice(0, 20);
    return `${label} (${qr.rowCount} rows, ${qr.executionTimeMs}ms):\nColumns: ${qr.columns.join(", ")}\n${JSON.stringify(preview, (_k, v) => typeof v === "bigint" ? Number(v) : v, 2)}`;
  }

  // String from LLM cells
  if (typeof output === "string") {
    return `${label}:\n${output}`;
  }

  return `${label}: ${JSON.stringify(output)}`;
}

/** Build context string from all dependency cell outputs */
function buildDependencyContext(
  cell: PlaybookCellV2,
  allCells: PlaybookCellV2[],
  context: Record<string, unknown>
): string {
  const sections: string[] = [];
  for (const depId of cell.dependsOn) {
    const depCell = allCells.find((c) => c.id === depId);
    if (!depCell) continue;
    sections.push(formatCellOutput(depId, depCell.label, context[depId]));
  }
  return sections.join("\n\n---\n\n");
}

/** Build context from every transitive upstream dependency, preserving cell order. */
function buildUpstreamContext(
  cell: PlaybookCellV2,
  allCells: PlaybookCellV2[],
  context: Record<string, unknown>
): string {
  const cellMap = new Map(allCells.map((item) => [item.id, item]));
  const upstreamIds = new Set<string>();

  function visit(cellId: string) {
    if (upstreamIds.has(cellId)) return;
    const current = cellMap.get(cellId);
    if (!current) return;
    upstreamIds.add(cellId);
    for (const depId of current.dependsOn) visit(depId);
  }

  for (const depId of cell.dependsOn) visit(depId);

  return allCells
    .filter((item) => upstreamIds.has(item.id) && context[item.id] != null)
    .map((item) => formatCellOutput(item.id, item.label, context[item.id]))
    .join("\n\n---\n\n");
}

/** Build the full LLM prompt for a cell based on its role and dependencies */
function buildLLMPrompt(
  cell: PlaybookCellV2,
  depContext: string,
  paramMap: Record<string, string>,
  schemaText: string,
  playbookName: string,
  systemContext?: string
): string {
  const prefix = systemContext ? `${systemContext}\n\n` : "";
  const base = `${prefix}You are executing a step in the playbook "${playbookName}".
Step: "${cell.label}" — ${cell.description}
Parameters: ${JSON.stringify(paramMap)}

`;

  // Use the cell's custom prompt if provided, then append renderer-facing
  // requirements for the terminal summary cell.
  const baseInstruction = cell.prompt?.trim() || getRoleDefaultPrompt(cell.role);
  const instruction = cell.role === "summary"
    ? `${baseInstruction}\n\n${FINAL_OUTPUT_FORMAT_INSTRUCTIONS}`
    : baseInstruction;

  const contextSection = depContext
    ? `\n--- UPSTREAM DATA ---\n${depContext}\n`
    : "";

  return `${base}${instruction}${contextSection}`;
}

/** Default prompts for each cell role when no custom prompt is provided */
function getRoleDefaultPrompt(role: string): string {
  switch (role) {
    case "guardrail":
      return "Validate the data availability and quality. Check that the expected tables and columns exist. Report any issues concisely. If everything looks good, confirm readiness in 2-3 sentences.";
    case "analysis":
      return "Analyze the query results below. Identify key patterns, trends, anomalies, and notable findings. Be specific — cite actual numbers from the data. Keep it concise and structured.";
    case "summary":
      return `Provide the final output based on all upstream analysis:

1. **Key Findings** — 3-5 specific findings with actual numbers
2. **Recommendations** — 3-4 actionable improvements with specific targets

Use markdown formatting. Be specific — cite real numbers.`;
    default:
      return "Process the upstream data and provide your analysis.";
  }
}

/** Compute topological levels from cell dependencies */
function topologicalLevels(cells: PlaybookCellV2[]): PlaybookCellV2[][] {
  const cellMap = new Map(cells.map((c) => [c.id, c]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const c of cells) {
    inDegree.set(c.id, c.dependsOn.filter((d) => cellMap.has(d)).length);
    for (const dep of c.dependsOn) {
      if (!cellMap.has(dep)) continue;
      const list = adj.get(dep) ?? [];
      list.push(c.id);
      adj.set(dep, list);
    }
  }

  const levels: PlaybookCellV2[][] = [];
  let queue = cells.filter((c) => (inDegree.get(c.id) ?? 0) === 0);

  while (queue.length > 0) {
    levels.push(queue);
    const nextQueue: PlaybookCellV2[] = [];
    for (const cell of queue) {
      for (const childId of adj.get(cell.id) ?? []) {
        const newDeg = (inDegree.get(childId) ?? 1) - 1;
        inDegree.set(childId, newDeg);
        if (newDeg === 0) {
          nextQueue.push(cellMap.get(childId)!);
        }
      }
    }
    queue = nextQueue;
  }

  return levels;
}

export async function runPlaybookV2(
  send: SendFn,
  playbook: PlaybookV2,
  paramOverrides?: Record<string, string>,
  modelId?: ModelId,
  datasetId?: string,
) {
  const runId = Math.random().toString(36).slice(2, 8);
  const resolvedDatasetId = datasetId || DEFAULT_DATASET;
  console.log(`[playbook-run:${runId}] === V2 START === playbook="${playbook.name}" id=${playbook.id} datasetId=${resolvedDatasetId} cells=${playbook.cells.length} model=${modelId ?? "default"}`);
  console.log(`[playbook-run:${runId}] Param overrides:`, JSON.stringify(paramOverrides ?? {}));

  let paramMap = buildParamMap(playbook.params ?? [], paramOverrides);
  console.log(`[playbook-run:${runId}] Resolved paramMap:`, JSON.stringify(paramMap));

  const schema = await discoverSchema(resolvedDatasetId);
  const schemaText = formatSchemaForLLM(schema);
  const availableTables = schema.tableNames.map((t) => t.toLowerCase());
  const dataset = getDataset(resolvedDatasetId);
  const fallbackScalarValue = `'${dataset.dateRange?.start ?? new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0]}'`;
  console.log(`[playbook-run:${runId}] Schema for ${resolvedDatasetId}: ${availableTables.length} tables — ${availableTables.join(", ")}`);

  // Backstop: re-infer any missing dependsOn edges so the playbook runs against
  // the same dependency graph it was validated with. Guards against playbooks
  // persisted before the create route's reconciled deps were carried to the client.
  const { cells: allCells, inferred: inferredDeps } = reconcilePlaybookCellDependencies(
    playbook.cells,
    schema.tableNames,
  );
  if (inferredDeps.length > 0) {
    console.log(`[playbook-run:${runId}] Reconciled ${inferredDeps.length} missing dependency edge(s):`, JSON.stringify(inferredDeps));
  }

  const context: Record<string, unknown> = {};
  const completed = new Set<string>();
  const failed = new Set<string>();
  const remaining = new Set(allCells.map((c) => c.id));
  const outputViewByName = new Map<string, string>();
  const createdRunViews: string[] = [];
  const runViewPrefix = `__pb_run_${runId}`;
  const outputProducers = buildOutputProducers(
    allCells
      .filter((cell) => cell.type === "sql")
      .map((cell) => ({
        id: cell.id,
        label: cell.label,
        role: cell.role,
        dependsOn: cell.dependsOn,
        outputs: cell.outputs,
        sql: cell.sql,
      })),
  );

  // Execute cells level by level
  const levels = topologicalLevels(allCells);
  console.log(`[playbook-run:${runId}] Topological levels: ${levels.length} levels — ${levels.map(l => `[${l.map(c => c.id).join(",")}]`).join(" → ")}`);

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx];
    console.log(`[playbook-run:${runId}] === Level ${levelIdx + 1}/${levels.length} === executing ${level.length} cell(s) in parallel: ${level.map(c => c.id).join(", ")}`);
    // Execute all cells at this level in parallel
    await Promise.allSettled(
      level.map(async (cell) => {
        // Check if any dependency failed
        const blockedBy = cell.dependsOn.filter((d) => failed.has(d));
        if (blockedBy.length > 0) {
          console.log(`[playbook-run:${runId}] Cell ${cell.id} BLOCKED by failed deps: ${blockedBy.join(", ")}`);
          send({
            type: "cell_start",
            cellId: cell.id,
            label: cell.label,
          });
          send({
            type: "cell_result",
            cellId: cell.id,
            content: `Blocked — depends on failed cell(s)`,
            error: `Blocked by: ${blockedBy.join(", ")}`,
            footer: "Blocked",
          });
          failed.add(cell.id);
          remaining.delete(cell.id);
          return;
        }

        console.log(`[playbook-run:${runId}] Cell ${cell.id} START [${cell.type}/${cell.role}] "${cell.label}"`);
        send({ type: "cell_start", cellId: cell.id, label: cell.label });

        try {
          let success = true;

          if (cell.type === "sql") {
            success = await executeSQLCell(
              send,
              cell,
              paramMap,
              availableTables,
              context,
              resolvedDatasetId,
              runId,
              outputViewByName,
              runViewPrefix,
              createdRunViews,
              outputProducers,
              fallbackScalarValue,
            );

            // If this is a parameter cell, merge computed values
            if (success && cell.role === "parameter") {
              const result = context[cell.id] as QueryResult | undefined;
              if (result && !result.error) {
                paramMap = mergeComputedParams(paramMap, result);
                console.log(`[playbook-run:${runId}] Cell ${cell.id} parameter — merged computed params, paramMap now:`, JSON.stringify(paramMap));
              }
            }

          } else if (cell.type === "llm") {
            const depContext = cell.role === "summary"
              ? buildUpstreamContext(cell, allCells, context)
              : buildDependencyContext(cell, allCells, context);
            const prompt = buildLLMPrompt(cell, depContext, paramMap, schemaText, playbook.name, getSystemContext(resolvedDatasetId));
            const text = await streamLLMCell(send, cell.id, prompt, modelId, runId);
            context[cell.id] = text;

            send({
              type: "cell_result",
              cellId: cell.id,
              content: text.length > 100 ? text.slice(0, 100) + "..." : text,
              footer: "Done",
            });
          }

          if (success) {
            completed.add(cell.id);
            console.log(`[playbook-run:${runId}] Cell ${cell.id} COMPLETED`);
          } else {
            failed.add(cell.id);
            console.log(`[playbook-run:${runId}] Cell ${cell.id} FAILED`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Cell execution failed";
          console.error(`[playbook-run:${runId}] Cell ${cell.id} THREW:`, msg);
          send({
            type: "cell_result",
            cellId: cell.id,
            error: msg,
            footer: "Error",
          });
          failed.add(cell.id);
        }

        remaining.delete(cell.id);
      })
    );
  }
  console.log(`[playbook-run:${runId}] === V2 END === completed=${completed.size} failed=${failed.size} remaining=${remaining.size}`);

  // Report any remaining cells (shouldn't happen with valid DAG)
  for (const cellId of remaining) {
    send({
      type: "cell_result",
      cellId,
      error: "Could not execute — circular dependency or missing upstream",
      footer: "Error",
    });
  }

  for (const viewName of createdRunViews.reverse()) {
    await executeSQLInternal(`DROP VIEW IF EXISTS ${quoteIdent(viewName)}`, resolvedDatasetId);
  }

  send({ type: "done" });
}

/** Returns true if cell executed successfully, false on error */
async function executeSQLCell(
  send: SendFn,
  cell: PlaybookCellV2,
  paramMap: Record<string, string>,
  availableTables: string[],
  context: Record<string, unknown>,
  datasetId: string,
  runId?: string,
  outputViewByName: Map<string, string> = new Map(),
  runViewPrefix = "__pb_run",
  createdRunViews: string[] = [],
  outputProducers = buildOutputProducers([{
    id: cell.id,
    label: cell.label,
    role: cell.role,
    dependsOn: cell.dependsOn,
    outputs: cell.outputs,
    sql: cell.sql,
  }]),
  fallbackScalarValue = "'1970-01-01'",
): Promise<boolean> {
  const tag = runId ? `[playbook-run:${runId}]` : "[playbook-run]";
  if (!cell.sql) {
    console.log(`${tag} Cell ${cell.id} has no SQL defined`);
    send({
      type: "cell_result",
      cellId: cell.id,
      error: "No SQL query defined",
      footer: "Error",
    });
    context[cell.id] = { columns: [], rows: [], rowCount: 0, executionTimeMs: 0, error: "No SQL" } as QueryResult;
    return false;
  }

  console.log(`${tag} Cell ${cell.id} raw SQL:\n${cell.sql}`);

  const prepared = preparePlaybookSqlCell({
    cell: {
      id: cell.id,
      label: cell.label,
      role: cell.role,
      dependsOn: cell.dependsOn,
      outputs: cell.outputs,
      sql: cell.sql,
    },
    paramMap,
    realTables: new Set(availableTables.map((table) => table.toLowerCase())),
    outputProducers,
    outputViewByName,
    fallbackScalarValue,
    // Match validation: an unresolved parameter-cell scalar falls back to a safe
    // dataset date rather than hard-failing, so a validated playbook runs the same way.
    allowScalarOutputFallback: true,
  });

  if ("error" in prepared) {
    console.warn(`${tag} Cell ${cell.id} ${prepared.error} (paramMap keys: ${Object.keys(paramMap).join(", ")})`);
    send({
      type: "cell_result",
      cellId: cell.id,
      rowCount: 0,
      timeMs: 0,
      columns: [],
      preview: [],
      error: prepared.error,
      footer: "Error",
    });
    context[cell.id] = { columns: [], rows: [], rowCount: 0, executionTimeMs: 0, error: prepared.error } as QueryResult;
    return false;
  }

  const resolvedSql = prepared.sql;
  if (resolvedSql !== cell.sql) {
    console.log(`${tag} Cell ${cell.id} resolved SQL (after substitution):\n${resolvedSql}`);
  }
  const result = await executeSQL(resolvedSql, datasetId);
  console.log(`${tag} Cell ${cell.id} result: ${result.error ? `ERROR — ${result.error}` : `${result.rowCount} rows · ${result.executionTimeMs}ms · cols=[${result.columns.join(", ")}]`}`);

  // Materialize each declared output as a run-local VIEW so downstream cells can
  // do `FROM <output_name>` without colliding with stale/global DuckDB views.
  if (!result.error && prepared.tableOutputs.length > 0) {
    for (const output of prepared.tableOutputs) {
      const viewName = makeRunViewName(runViewPrefix, cell.id, output);
      try {
        await executeSQLInternal(`CREATE OR REPLACE VIEW ${quoteIdent(viewName)} AS ${resolvedSql}`, datasetId);
        availableTables.push(viewName.toLowerCase());
        outputViewByName.set(output.toLowerCase(), viewName);
        createdRunViews.push(viewName);
        console.log(`${tag} Cell ${cell.id} materialized output "${output}" as run-local VIEW "${viewName}"`);
      } catch (err) {
        console.warn(`${tag} Cell ${cell.id} could not materialize "${output}":`, err);
      }
    }
  }

  // Sanitize BigInt values in preview rows before sending
  const preview = sanitizeRows(result.rows.slice(0, 10));

  context[cell.id] = result;

  send({
    type: "cell_result",
    cellId: cell.id,
    rowCount: result.rowCount,
    timeMs: result.executionTimeMs,
    columns: result.columns,
    preview,
    error: result.error || undefined,
    content: result.error
      ? `Error: ${result.error}`
      : `${result.rowCount} rows · ${result.executionTimeMs}ms`,
    footer: result.error ? "Error" : "Done",
  });

  return !result.error;
}

/** Deep-convert any BigInt values to Number in row data */
function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k] = typeof v === "bigint" ? Number(v) : v;
    }
    return clean;
  });
}

// ── V1 Executor (backward compat) ──

interface NodeQueryResult {
  nodeId: string;
  label: string;
  result: QueryResult;
}

export async function runPlaybookV1(
  send: SendFn,
  playbook: Playbook,
  paramOverrides?: Record<string, string>,
  modelId?: ModelId,
  datasetId?: string,
) {
  const runId = Math.random().toString(36).slice(2, 8);
  const resolvedDatasetId = datasetId || DEFAULT_DATASET;
  console.log(`[playbook-run:${runId}] === V1 START === playbook="${playbook.name}" id=${playbook.id} datasetId=${resolvedDatasetId} model=${modelId ?? "default"}`);
  console.log(`[playbook-run:${runId}] Param overrides:`, JSON.stringify(paramOverrides ?? {}));

  const paramMap = buildParamMap(playbook.params ?? [], paramOverrides);
  console.log(`[playbook-run:${runId}] Resolved paramMap:`, JSON.stringify(paramMap));

  const sqlCell = playbook.cells.find((c) => c.type === "sql-group");
  const sqlNodes = sqlCell?.nodes ?? [];
  console.log(`[playbook-run:${runId}] SQL nodes: ${sqlNodes.length} — ${sqlNodes.map(n => n.id).join(", ")}`);

  send({ type: "cell_start", cellId: "cell1_init", label: "Initialize" });

  const schema = await discoverSchema(resolvedDatasetId);
  const availableTableNames = schema.tableNames.map((t) => t.toLowerCase());
  console.log(`[playbook-run:${runId}] Schema for ${resolvedDatasetId}: ${availableTableNames.length} tables — ${availableTableNames.join(", ")}`);

  await streamLLMCell(
    send,
    "cell1_init",
    `${getSystemContext(resolvedDatasetId)}

You are initializing a playbook called "${playbook.name}".
Description: ${playbook.description}

Parameters: ${JSON.stringify(paramMap)}

You are about to run ${sqlNodes.length} SQL queries against a real dataset (DuckDB).

Briefly describe (3-4 sentences) what this playbook will analyze based on the query names: ${sqlNodes.map((n) => n.label).join(", ")}. Be concise and professional. Do not use markdown headers or bullet points — just flowing text.`,
    modelId,
    runId,
  );

  const validNodes: typeof sqlNodes = [];
  const skippedNodes: typeof sqlNodes = [];

  for (const node of sqlNodes) {
    if (!node.sql) {
      console.log(`[playbook-run:${runId}] Node ${node.id} has no SQL — skipped`);
      skippedNodes.push(node);
      continue;
    }
    console.log(`[playbook-run:${runId}] Node ${node.id} "${node.label}" raw SQL:\n${node.sql}`);
    const referencedTables = extractTablesFromSQL(node.sql);
    console.log(`[playbook-run:${runId}] Node ${node.id} referenced tables: [${referencedTables.join(", ")}]`);
    const missingTables = referencedTables.filter(
      (t) => !availableTableNames.includes(t.toLowerCase())
    );
    if (missingTables.length > 0) {
      console.warn(`[playbook-run:${runId}] Node ${node.id} skipped — missing tables: ${missingTables.join(", ")}`);
      skippedNodes.push(node);
    } else {
      validNodes.push(node);
    }
  }

  const skippedNote = skippedNodes.length > 0
    ? ` · ${skippedNodes.length} skipped (missing tables)`
    : "";

  send({
    type: "cell_result",
    cellId: "cell1_init",
    content: `Parameters validated · ${validNodes.length} queries ready${skippedNote}`,
    footer: "Done",
  });

  send({
    type: "cell_start",
    cellId: "cell2_group",
    label: `SQL Queries · ${validNodes.length} Parallel`,
  });

  for (const node of sqlNodes) {
    send({
      type: "node_start",
      cellId: "cell2_group",
      nodeId: node.id,
      label: node.label,
    });
  }

  for (const node of skippedNodes) {
    const referencedTables = node.sql ? extractTablesFromSQL(node.sql) : [];
    const missingTables = referencedTables.filter(
      (t) => !availableTableNames.includes(t.toLowerCase())
    );
    send({
      type: "node_result",
      cellId: "cell2_group",
      nodeId: node.id,
      label: node.label,
      rowCount: 0,
      timeMs: 0,
      columns: [],
      preview: [],
      error: node.sql
        ? `Missing table(s): ${missingTables.join(", ")}`
        : "No SQL query defined",
    });
  }

  const queryResults: NodeQueryResult[] = await Promise.all(
    validNodes.map(async (node) => {
      const unresolved = findUnresolvedPlaceholders(node.sql!, paramMap);
      if (unresolved.length > 0) {
        const error = `Unresolved placeholder(s): ${unresolved.map(p => `{{${p}}}`).join(", ")}`;
        console.warn(`[playbook-run:${runId}] Node ${node.id} ${error} (paramMap keys: ${Object.keys(paramMap).join(", ")})`);
        send({
          type: "node_result",
          cellId: "cell2_group",
          nodeId: node.id,
          label: node.label,
          rowCount: 0,
          timeMs: 0,
          columns: [],
          preview: [],
          error,
        });
        return { nodeId: node.id, label: node.label, result: { columns: [], rows: [], rowCount: 0, executionTimeMs: 0, error } as QueryResult };
      }
      const resolvedSql = substituteParams(node.sql!, paramMap);
      if (resolvedSql !== node.sql) {
        console.log(`[playbook-run:${runId}] Node ${node.id} resolved SQL:\n${resolvedSql}`);
      }
      const result = await executeSQL(resolvedSql, resolvedDatasetId);
      console.log(`[playbook-run:${runId}] Node ${node.id} result: ${result.error ? `ERROR — ${result.error}` : `${result.rowCount} rows · ${result.executionTimeMs}ms · cols=[${result.columns.join(", ")}]`}`);

      send({
        type: "node_result",
        cellId: "cell2_group",
        nodeId: node.id,
        label: node.label,
        rowCount: result.rowCount,
        timeMs: result.executionTimeMs,
        columns: result.columns,
        preview: sanitizeRows(result.rows.slice(0, 10)),
        error: result.error || undefined,
      });

      return { nodeId: node.id, label: node.label, result };
    })
  );

  for (const node of skippedNodes) {
    queryResults.push({
      nodeId: node.id,
      label: node.label,
      result: { columns: [], rows: [], rowCount: 0, executionTimeMs: 0, error: "Skipped — missing tables" },
    });
  }

  const successCount = queryResults.filter((r) => !r.result.error).length;
  send({
    type: "cell_result",
    cellId: "cell2_group",
    content: `${successCount}/${queryResults.length} queries completed`,
    footer: "Done",
  });

  send({ type: "cell_start", cellId: "cell3_compute", label: "Compute Scores" });

  const queryContext = queryResults
    .map((qr) => {
      if (qr.result.error) return `${qr.label}: FAILED — ${qr.result.error}`;
      return `${qr.label} (${qr.result.rowCount} rows, ${qr.result.executionTimeMs}ms):\n${JSON.stringify(qr.result.rows.slice(0, 20), (_k, v) => typeof v === "bigint" ? Number(v) : v, 2)}`;
    })
    .join("\n\n---\n\n");

  const queryLabels = queryResults.map((qr, i) => `${i + 1}. **${qr.label}**`).join("\n");

  const scoringText = await streamLLMCell(
    send,
    "cell3_compute",
    `${getSystemContext(resolvedDatasetId)}

You are the scoring engine for "${playbook.name}". You just received results from ${queryResults.length} SQL queries run against a real dataset.

Analysis parameters: ${JSON.stringify(paramMap)}

Evaluate across these dimensions based on the query results:

${queryLabels}

For each, assign a score from 1-10 and a PASS/FAIL verdict.
Format each as: "N. Dimension — Score: X/10 — PASS/FAIL — [one sentence reason]"

Then at the end, compute: Total Score = sum of all scores / (${queryResults.length} × 10) × 100 (as a percentage).

--- QUERY RESULTS ---
${queryContext}`,
    modelId,
    runId,
  );

  send({
    type: "cell_result",
    cellId: "cell3_compute",
    content: scoringText.includes("Total Score")
      ? scoringText.match(/Total Score[:\s]*[\d.]+/)?.[0] ?? "Scored"
      : "Scored",
    footer: "Done",
  });

  send({ type: "cell_start", cellId: "cell4_summary", label: "Summary" });

  const summaryInstructions = playbook.summaryPrompt?.trim() || `Based on the scoring assessment and raw query data below, provide:

1. **Overall Health Grade** (A/B+/B/C+/C/D/E) — Start with "Grade: X"
2. **3-5 Key Findings** — Specific findings with actual numbers from the data
3. **3-4 Recommendations** — Actionable improvements with specific targets

Keep the output concise (under 300 words). Use markdown formatting. Be specific — cite real numbers from the query results.`;

  const summaryText = await streamLLMCell(
    send,
    "cell4_summary",
    `${getSystemContext(resolvedDatasetId)}

You are generating the final summary for "${playbook.name}".

Analysis parameters: ${JSON.stringify(paramMap)}

${summaryInstructions}

--- SCORING ASSESSMENT ---
${scoringText}

--- RAW QUERY RESULTS ---
${queryContext}`,
    modelId,
    runId,
  );

  const gradeMatch = summaryText.match(/Grade:\s*([A-E][+\-]?)/i);
  send({
    type: "cell_result",
    cellId: "cell4_summary",
    content: gradeMatch
      ? `Grade ${gradeMatch[1]} · Health Check Complete`
      : "Health Check Complete",
    footer: "Done",
  });

  console.log(`[playbook-run:${runId}] === V1 END === ${queryResults.filter(r => !r.result.error).length}/${queryResults.length} queries succeeded`);
  send({ type: "done" });
}

// Re-export old name for backward compat
export const runPlaybook = runPlaybookV1;
export type { ModelId };
