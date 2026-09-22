import { getDataset } from "@/lib/datasets";
import { buildParamMap, substituteParams } from "@/lib/playbook-params";
import type { PlaybookCell, PlaybookCellV2, PlaybookNode, PlaybookParam } from "@/lib/playbook-types";
import { discoverSchema } from "@/lib/schema-discovery";
import { executeSQLInternal } from "@/lib/sql-executor";

export interface PlaybookSqlTarget {
  id: string;
  label?: string;
  role?: string;
  dependsOn: string[];
  outputs: string[];
  sql?: string;
}

export interface PlaybookSqlValidationResult {
  cellId: string;
  valid: boolean;
  error?: string;
}

export interface PlaybookSqlValidationResponse {
  valid: boolean;
  results: PlaybookSqlValidationResult[];
  sqlTargetCount: number;
}

export interface PreparedPlaybookSql {
  sql: string;
  tableOutputs: string[];
}

interface OutputProducer {
  cellId: string;
  role?: string;
}

interface PrepareSqlArgs {
  cell: PlaybookSqlTarget;
  paramMap: Record<string, string>;
  realTables: Set<string>;
  outputProducers: Map<string, OutputProducer | "ambiguous">;
  outputViewByName: Map<string, string>;
  fallbackScalarValue: string;
  allowScalarOutputFallback?: boolean;
}

const SYSTEM_SCHEMAS = new Set(["information_schema", "pg_catalog", "pg_class", "pg_stats", "duckdb_internal"]);

const TABLE_FUNCTIONS = new Set([
  "read_parquet", "read_csv", "read_csv_auto", "read_json", "read_json_auto",
  "generate_series", "range", "unnest", "values", "from_substrait", "glob",
  "parquet_scan", "json_scan", "csv_scan",
]);

function stripSQLComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

// In a handful of SQL functions, FROM is a keyword ARGUMENT, not a table source:
//   EXTRACT(month FROM order_ts), SUBSTRING(s FROM 1 FOR 3),
//   TRIM(BOTH ' ' FROM name), OVERLAY(s PLACING x FROM 2)
// The table extractor scans for "FROM <ident>", so without this it would read
// the column after such a FROM (e.g. order_ts) as a missing table. Blank those
// keyword FROMs in a copy used only for extraction (never for execution).
function neutralizeFunctionFromKeywords(sql: string): string {
  return sql.replace(
    /\b(EXTRACT|SUBSTRING|SUBSTR|TRIM|OVERLAY)\s*\(([\s\S]*?)\)/gi,
    (_full, fn: string, inner: string) => `${fn}(${inner.replace(/\bFROM\b/gi, " ").replace(/\bFOR\b/gi, " ")})`,
  );
}

function extractCTENames(sql: string): Set<string> {
  const cteNames = new Set<string>();
  const cteRegex = /(?:WITH\s+(?:RECURSIVE\s+)?|,\s*)(\w+)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = cteRegex.exec(sql)) !== null) {
    cteNames.add(match[1].toLowerCase());
  }
  return cteNames;
}

export function quotePlaybookIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function makePlaybookViewName(prefix: string, cellId: string, output: string): string {
  const safe = `${prefix}_${cellId}_${output}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^([^a-zA-Z_])/, "_$1");
  return safe.slice(0, 60);
}

export function isPlaybookIdentifier(value: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(value);
}

export function extractTablesFromPlaybookSQL(sql: string): string[] {
  const stripped = neutralizeFunctionFromKeywords(stripSQLComments(sql));
  const cteNames = extractCTENames(stripped);
  const tables = new Set<string>();
  // \b after the name prevents greedy \w+ from backtracking into a partial word
  // (e.g. matching "generate_serie" out of "generate_series(") to satisfy the
  // (?!\s*\() table-function guard — that truncation produced bogus "missing table" errors.
  const regex = /(?:FROM|JOIN)\s+["']?((?:\w+\.)?\w+)\b["']?(?!\s*\()/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const full = match[1].toLowerCase();
    const schema = full.includes(".") ? full.split(".")[0] : null;
    if (schema && SYSTEM_SCHEMAS.has(schema)) continue;
    const name = full.includes(".") ? full.split(".")[1] : full;
    if (
      !["select", "where", "group", "order", "having", "limit", "union", "lateral"].includes(name) &&
      !cteNames.has(name) &&
      !TABLE_FUNCTIONS.has(name)
    ) {
      tables.add(name);
    }
  }
  return Array.from(tables);
}

export function extractTablePlaceholders(sql: string): string[] {
  const placeholders = new Set<string>();
  const re = /\b(?:FROM|JOIN)\s+\{\{(\w+)\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripSQLComments(sql))) !== null) {
    placeholders.add(match[1].toLowerCase());
  }
  return Array.from(placeholders);
}

function findPlaceholders(sql: string): string[] {
  const placeholders = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    placeholders.add(match[1]);
  }
  return Array.from(placeholders);
}

function normalizeOutputs(outputs: unknown): string[] {
  return Array.isArray(outputs)
    ? outputs.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function flattenPlaybookSqlTargets(cells: Array<PlaybookCellV2 | PlaybookCell>): {
  targets: PlaybookSqlTarget[];
  sqlCellCount: number;
  missingBodies: PlaybookSqlValidationResult[];
} {
  const targets: PlaybookSqlTarget[] = [];
  const missingBodies: PlaybookSqlValidationResult[] = [];
  let sqlCellCount = 0;

  for (const cell of cells) {
    if (cell.type === "sql") {
      sqlCellCount++;
      const v2 = cell as PlaybookCellV2;
      const sql = v2.sql?.trim();
      if (!sql) {
        missingBodies.push({
          cellId: v2.id,
          valid: false,
          error: "No SQL query defined. Generation likely stalled for this cell.",
        });
        continue;
      }
      targets.push({
        id: v2.id,
        label: v2.label,
        role: v2.role,
        dependsOn: Array.isArray(v2.dependsOn) ? v2.dependsOn : [],
        outputs: normalizeOutputs(v2.outputs),
        sql,
      });
    } else if (cell.type === "sql-group") {
      sqlCellCount++;
      const nodes = ((cell as PlaybookCell).nodes ?? []) as PlaybookNode[];
      for (const node of nodes) {
        const sql = node.sql?.trim();
        if (!sql) {
          missingBodies.push({ cellId: node.id, valid: false, error: "No SQL query defined." });
          continue;
        }
        targets.push({
          id: node.id,
          label: node.label,
          role: "query",
          dependsOn: [],
          outputs: [`result_${node.id}`],
          sql,
        });
      }
    }
  }

  return { targets, sqlCellCount, missingBodies };
}

export function buildOutputProducers(cells: PlaybookSqlTarget[]): Map<string, OutputProducer | "ambiguous"> {
  const producers = new Map<string, OutputProducer | "ambiguous">();
  for (const cell of cells) {
    for (const output of cell.outputs) {
      const key = output.toLowerCase();
      const existing = producers.get(key);
      if (existing && existing !== "ambiguous" && existing.cellId !== cell.id) {
        producers.set(key, "ambiguous");
      } else if (!existing) {
        producers.set(key, { cellId: cell.id, role: cell.role });
      }
    }
  }
  return producers;
}

/**
 * Infer missing `dependsOn` edges for SQL cells that read another cell's output
 * via FROM/JOIN but forgot to declare the dependency. Pure — returns the
 * reconciled cells plus a list of inferred edges for logging/streaming.
 *
 * Shared by the create route (validate time) and the executor (run time) so a
 * playbook always runs with the same dependency graph it was validated against.
 */
export function reconcilePlaybookCellDependencies(
  cells: PlaybookCellV2[],
  tableNames: string[],
): { cells: PlaybookCellV2[]; inferred: Array<{ cellId: string; added: string[]; dependsOn: string[] }> } {
  const realTables = new Set(tableNames.map((table) => table.toLowerCase()));
  const producerByOutput = new Map<string, string | "ambiguous">();
  const cellIndex = new Map(cells.map((cell, index) => [cell.id, index]));

  for (const cell of cells) {
    if (cell.type !== "sql") continue;
    for (const output of cell.outputs) {
      const key = output.toLowerCase();
      const existing = producerByOutput.get(key);
      if (existing && existing !== cell.id) producerByOutput.set(key, "ambiguous");
      else producerByOutput.set(key, cell.id);
    }
  }

  const inferred: Array<{ cellId: string; added: string[]; dependsOn: string[] }> = [];
  const reconciled = cells.map((cell) => {
    if (cell.type !== "sql" || !cell.sql) return cell;
    const deps = new Set(cell.dependsOn);
    const added: string[] = [];

    for (const tableRef of extractTablesFromPlaybookSQL(cell.sql)) {
      const key = tableRef.toLowerCase();
      if (realTables.has(key)) continue;
      const producerId = producerByOutput.get(key);
      if (!producerId || producerId === "ambiguous" || producerId === cell.id) continue;

      const producerIndex = cellIndex.get(producerId);
      const currentIndex = cellIndex.get(cell.id);
      if (producerIndex == null || currentIndex == null || producerIndex >= currentIndex) continue;
      if (deps.has(producerId)) continue;

      deps.add(producerId);
      added.push(producerId);
    }

    if (added.length === 0) return cell;
    const next = { ...cell, dependsOn: Array.from(deps) };
    inferred.push({ cellId: cell.id, added, dependsOn: next.dependsOn });
    return next;
  });

  return { cells: reconciled, inferred };
}

function topologicalOrder(cells: PlaybookSqlTarget[]): PlaybookSqlTarget[] {
  const cellMap = new Map(cells.map((cell) => [cell.id, cell]));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const cell of cells) {
    const deps = cell.dependsOn.filter((dep) => cellMap.has(dep));
    inDegree.set(cell.id, deps.length);
    for (const dep of deps) {
      const list = children.get(dep) ?? [];
      list.push(cell.id);
      children.set(dep, list);
    }
  }

  const ordered: PlaybookSqlTarget[] = [];
  const queue = cells.filter((cell) => (inDegree.get(cell.id) ?? 0) === 0);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    ordered.push(cell);
    for (const childId of children.get(cell.id) ?? []) {
      const next = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, next);
      if (next === 0) queue.push(cellMap.get(childId)!);
    }
  }

  if (ordered.length !== cells.length) {
    const seen = new Set(ordered.map((cell) => cell.id));
    ordered.push(...cells.filter((cell) => !seen.has(cell.id)));
  }
  return ordered;
}

function resolveOutputTableReference(
  name: string,
  cell: PlaybookSqlTarget,
  outputProducers: Map<string, OutputProducer | "ambiguous">,
  outputViewByName: Map<string, string>,
): { replacement?: string; error?: string } {
  const key = name.toLowerCase();
  const producer = outputProducers.get(key);
  if (!producer) return {};
  if (producer === "ambiguous") {
    return { error: `Output reference "${name}" is ambiguous because multiple cells produce it. Use unique output names.` };
  }
  if (producer.cellId === cell.id) {
    return { error: `SQL references its own output "${name}". Regenerate or edit this cell so it reads from a real table or an upstream output.` };
  }
  if (!cell.dependsOn.includes(producer.cellId)) {
    return { error: `Output "${name}" is produced by ${producer.cellId}, but this cell does not list ${producer.cellId} in dependsOn.` };
  }
  const viewName = outputViewByName.get(key);
  if (!viewName) {
    return { error: `Output "${name}" is not available because its producing cell did not validate successfully.` };
  }
  return { replacement: quotePlaybookIdent(viewName) };
}

export function preparePlaybookSqlCell({
  cell,
  paramMap,
  realTables,
  outputProducers,
  outputViewByName,
  fallbackScalarValue,
  allowScalarOutputFallback = false,
}: PrepareSqlArgs): PreparedPlaybookSql | { error: string } {
  const rawSql = cell.sql?.trim();
  if (!rawSql) return { error: "No SQL query defined" };

  const outputNames = new Set(cell.outputs.map((output) => output.toLowerCase()));
  const ownDirectRef = extractTablesFromPlaybookSQL(rawSql).find((name) => outputNames.has(name));
  const ownPlaceholderRef = extractTablePlaceholders(rawSql).find((name) => outputNames.has(name));
  if (ownDirectRef || ownPlaceholderRef) {
    const outputName = ownDirectRef ?? ownPlaceholderRef;
    return {
      error: `SQL references its own output "${outputName}". Regenerate or edit this cell so it reads from a real table or an upstream output.`,
    };
  }

  const errors: string[] = [];
  const localCtes = extractCTENames(stripSQLComments(rawSql));
  let resolvedSql = rawSql.replace(
    /\b(FROM|JOIN)\s+\{\{(\w+)\}\}/gi,
    (match, keyword: string, name: string) => {
      const resolved = resolveOutputTableReference(name, cell, outputProducers, outputViewByName);
      if (resolved.error) errors.push(resolved.error);
      if (!resolved.replacement) return match;
      return `${keyword} ${resolved.replacement}`;
    },
  );

  resolvedSql = resolvedSql.replace(
    /\b(FROM|JOIN)\s+["']?(\w+)\b["']?(?!\s*\()/gi,
    (match, keyword: string, name: string) => {
      if (localCtes.has(name.toLowerCase())) return match;
      const resolved = resolveOutputTableReference(name, cell, outputProducers, outputViewByName);
      if (resolved.error) errors.push(resolved.error);
      if (!resolved.replacement) return match;
      return `${keyword} ${resolved.replacement}`;
    },
  );

  if (errors.length > 0) return { error: errors[0] };

  resolvedSql = resolvedSql.replace(
    /\{\{(\w+)\.(\w+)\}\}/g,
    (match, outputName: string, columnName: string) => {
      const resolved = resolveOutputTableReference(outputName, cell, outputProducers, outputViewByName);
      if (resolved.error) errors.push(resolved.error);
      if (!resolved.replacement) return match;
      return `(SELECT ${quotePlaybookIdent(columnName)} FROM ${resolved.replacement} LIMIT 1)`;
    },
  );

  if (errors.length > 0) return { error: errors[0] };

  const tablePlaceholders = extractTablePlaceholders(resolvedSql);
  if (tablePlaceholders.length > 0) {
    return {
      error: `Unresolved table output reference(s): ${tablePlaceholders.map((name) => `{{${name}}}`).join(", ")}. Add the producing cell as a dependency or query a real dataset table.`,
    };
  }

  const availableTables = new Set(realTables);
  for (const viewName of outputViewByName.values()) {
    availableTables.add(viewName.toLowerCase());
  }

  const missingTables = extractTablesFromPlaybookSQL(resolvedSql)
    .filter((name) => !availableTables.has(name.toLowerCase()));
  if (missingTables.length > 0) {
    return { error: `Missing table(s): ${missingTables.join(", ")}. Use only dataset tables or upstream playbook outputs.` };
  }

  const effectiveParamMap = { ...paramMap };
  const unresolved: string[] = [];
  for (const placeholder of findPlaceholders(resolvedSql)) {
    if (placeholder in effectiveParamMap) continue;
    const producer = outputProducers.get(placeholder.toLowerCase());
    if (!producer) {
      unresolved.push(placeholder);
      continue;
    }
    if (producer === "ambiguous") {
      return { error: `Placeholder "{{${placeholder}}}" is ambiguous because multiple cells produce it. Use unique output names.` };
    }
    if (producer.cellId === cell.id) {
      return { error: `SQL references its own output "{{${placeholder}}}".` };
    }
    if (!cell.dependsOn.includes(producer.cellId)) {
      return { error: `Placeholder "{{${placeholder}}}" is produced by ${producer.cellId}, but this cell does not list ${producer.cellId} in dependsOn.` };
    }
    if (producer.role !== "parameter") {
      return { error: `Output "{{${placeholder}}}" is a table output. Use it in FROM/JOIN, not as a scalar placeholder.` };
    }
    if (!allowScalarOutputFallback) {
      unresolved.push(placeholder);
      continue;
    }
    effectiveParamMap[placeholder] = fallbackScalarValue;
  }

  if (unresolved.length > 0) {
    return {
      error: `Unresolved placeholder(s): ${unresolved.map((name) => `{{${name}}}`).join(", ")}. Define them as params or have an upstream parameter cell output that scalar.`,
    };
  }

  return {
    sql: substituteParams(resolvedSql, effectiveParamMap).trim().replace(/;+\s*$/, ""),
    tableOutputs: cell.outputs.filter(isPlaybookIdentifier),
  };
}

export async function validatePlaybookSqlCells(args: {
  cells: Array<PlaybookCellV2 | PlaybookCell>;
  params?: PlaybookParam[];
  paramOverrides?: Record<string, string>;
  datasetId: string;
}): Promise<PlaybookSqlValidationResponse> {
  const { targets, sqlCellCount, missingBodies } = flattenPlaybookSqlTargets(args.cells);
  const results: PlaybookSqlValidationResult[] = [...missingBodies];
  const validationId = Math.random().toString(36).slice(2, 8);
  console.log("[playbook-sql-validator]", validationId, "start", {
    datasetId: args.datasetId,
    sqlCellCount,
    targetCount: targets.length,
    missingBodies: missingBodies.map((result) => result.cellId),
  });

  if (targets.length === 0) {
    console.log("[playbook-sql-validator]", validationId, "no_targets", {
      valid: results.length === 0,
      resultCount: results.length,
    });
    return {
      valid: results.length === 0,
      results,
      sqlTargetCount: sqlCellCount,
    };
  }

  const dataset = getDataset(args.datasetId);
  const fallbackDate = dataset.dateRange?.start ?? new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
  const paramMap = buildParamMap(args.params ?? [], args.paramOverrides);
  const schema = await discoverSchema(args.datasetId);
  const realTables = new Set(schema.tableNames.map((name) => name.toLowerCase()));
  const outputProducers = buildOutputProducers(targets);
  const outputViewByName = new Map<string, string>();
  const createdValidationViews: string[] = [];
  const validationPrefix = `__pb_validate_${Math.random().toString(36).slice(2, 8)}`;

  try {
    for (const target of topologicalOrder(targets)) {
      console.log("[playbook-sql-validator]", validationId, "target:start", {
        cellId: target.id,
        role: target.role,
        dependsOn: target.dependsOn,
        outputs: target.outputs,
        sqlLength: target.sql?.length ?? 0,
      });
      const prepared = preparePlaybookSqlCell({
        cell: target,
        paramMap,
        realTables,
        outputProducers,
        outputViewByName,
        fallbackScalarValue: `'${fallbackDate}'`,
        allowScalarOutputFallback: true,
      });

      if ("error" in prepared) {
        console.log("[playbook-sql-validator]", validationId, "target:prepare_error", {
          cellId: target.id,
          error: prepared.error,
        });
        results.push({ cellId: target.id, valid: false, error: prepared.error });
        continue;
      }

      const explainRes = await executeSQLInternal(`EXPLAIN ${prepared.sql}`, args.datasetId);
      if (explainRes.error) {
        console.log("[playbook-sql-validator]", validationId, "target:explain_error", {
          cellId: target.id,
          error: explainRes.error,
          preparedSqlLength: prepared.sql.length,
        });
        results.push({ cellId: target.id, valid: false, error: explainRes.error });
        continue;
      }

      let outputError: string | undefined;
      for (const output of prepared.tableOutputs) {
        const viewName = makePlaybookViewName(validationPrefix, target.id, output);
        const viewRes = await executeSQLInternal(`CREATE OR REPLACE VIEW ${quotePlaybookIdent(viewName)} AS ${prepared.sql}`, args.datasetId);
        if (viewRes.error) {
          console.log("[playbook-sql-validator]", validationId, "target:view_error", {
            cellId: target.id,
            output,
            viewName,
            error: viewRes.error,
          });
          outputError = viewRes.error;
          break;
        }
        createdValidationViews.push(viewName);
        outputViewByName.set(output.toLowerCase(), viewName);
      }

      results.push(outputError
        ? { cellId: target.id, valid: false, error: outputError }
        : { cellId: target.id, valid: true });
      console.log("[playbook-sql-validator]", validationId, "target:done", {
        cellId: target.id,
        valid: !outputError,
        tableOutputs: prepared.tableOutputs,
      });
    }
  } finally {
    for (const viewName of createdValidationViews.reverse()) {
      await executeSQLInternal(`DROP VIEW IF EXISTS ${quotePlaybookIdent(viewName)}`, args.datasetId);
    }
  }

  console.log("[playbook-sql-validator]", validationId, "done", {
    valid: results.every((result) => result.valid),
    resultCount: results.length,
    failed: results.filter((result) => !result.valid).map((result) => ({
      cellId: result.cellId,
      error: result.error,
    })),
  });
  return {
    valid: results.every((result) => result.valid),
    results,
    sqlTargetCount: sqlCellCount,
  };
}
