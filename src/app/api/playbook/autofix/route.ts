import { auth } from "@clerk/nextjs/server";
import { generateText } from "@/lib/llm";
import { getDataset, getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { discoverSchema, formatSchemaForLLM } from "@/lib/schema-discovery";
import type { PlaybookCellV2, PlaybookParam } from "@/lib/playbook-types";

interface PlaybookRepairContext {
  name?: string;
  description?: string;
  params?: PlaybookParam[];
  cells?: Array<Pick<PlaybookCellV2, "id" | "label" | "description" | "type" | "role" | "dependsOn" | "outputs" | "sql">>;
}

function stripSQLComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function extractTablePlaceholders(sql: string): string[] {
  const placeholders = new Set<string>();
  const re = /\b(?:FROM|JOIN)\s+\{\{(\w+)\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripSQLComments(sql))) !== null) {
    placeholders.add(match[1].toLowerCase());
  }
  return Array.from(placeholders);
}

function extractReferencedTables(sql: string): string[] {
  const stripped = stripSQLComments(sql);
  const cteNames = new Set<string>();
  const cteRegex = /(?:WITH\s+(?:RECURSIVE\s+)?|,\s*)(\w+)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = cteRegex.exec(stripped)) !== null) cteNames.add(match[1].toLowerCase());

  const tables = new Set<string>();
  const tableRegex = /\b(?:FROM|JOIN)\s+["']?((?:\w+\.)?\w+)["']?(?!\s*\()/gi;
  while ((match = tableRegex.exec(stripped)) !== null) {
    const full = match[1].toLowerCase();
    const name = full.includes(".") ? full.split(".")[1] : full;
    if (!cteNames.has(name)) tables.add(name);
  }
  return Array.from(tables);
}

function hasSelfOutputReference(cell: PlaybookCellV2, sql: string): string | null {
  const outputs = new Set((cell.outputs ?? []).map((output) => output.toLowerCase()));
  if (outputs.size === 0) return null;
  return (
    extractReferencedTables(sql).find((name) => outputs.has(name)) ??
    extractTablePlaceholders(sql).find((name) => outputs.has(name)) ??
    null
  );
}

function cleanGeneratedSql(sql: string): string {
  return sql
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function formatCellSqlContext(
  cell: Pick<PlaybookCellV2, "id" | "label" | "type" | "role" | "dependsOn" | "outputs" | "sql">,
): string {
  const header = `- ${cell.id} [${cell.type}/${cell.role}] ${cell.label}; dependsOn=[${cell.dependsOn?.join(",") ?? ""}]; outputs=[${cell.outputs?.join(",") ?? ""}]`;
  if (cell.type !== "sql" || !cell.sql?.trim()) return `${header}; hasSql=false`;
  return `${header}\nSQL:\n\`\`\`sql\n${cell.sql.trim()}\n\`\`\``;
}

function parseMissingDependencyError(error: string): { outputName: string; producerId: string } | null {
  const outputMatch = error.match(/Output "([^"]+)" is produced by ([\w-]+), but this cell does not list \2 in dependsOn/i);
  if (outputMatch) {
    return { outputName: outputMatch[1], producerId: outputMatch[2] };
  }

  const placeholderMatch = error.match(/Placeholder "\{\{([^}]+)\}\}" is produced by ([\w-]+), but this cell does not list \2 in dependsOn/i);
  if (placeholderMatch) {
    return { outputName: placeholderMatch[1], producerId: placeholderMatch[2] };
  }

  return null;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const bodyDatasetId = typeof body.datasetId === "string" ? body.datasetId : undefined;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const cell: PlaybookCellV2 = body.cell;
  const errorMessage: string = body.error;
  const playbookContext: PlaybookRepairContext | undefined =
    body.playbookContext && typeof body.playbookContext === "object"
      ? body.playbookContext
      : undefined;

  if (!cell || !errorMessage) {
    return Response.json({ error: "cell and error are required" }, { status: 400 });
  }

  if (cell.type !== "sql") {
    return Response.json({ error: "Only SQL cells can be auto-fixed" }, { status: 400 });
  }

  const dataset = getDataset(datasetId);
  const originalSql = cell.sql?.trim() ?? "";
  const allCells = playbookContext?.cells ?? [];

  const missingDependency = parseMissingDependencyError(errorMessage);
  if (missingDependency && originalSql) {
    const producer = allCells.find((candidate) => candidate.id === missingDependency.producerId);
    if (!producer) {
      return Response.json({ error: `Could not find producing cell ${missingDependency.producerId}` }, { status: 422 });
    }
    if (producer.id === cell.id) {
      return Response.json({ error: `Cell cannot depend on itself for output "${missingDependency.outputName}"` }, { status: 422 });
    }

    const nextDependsOn = Array.from(new Set([...(cell.dependsOn ?? []), producer.id]));
    return Response.json({
      fixedSql: originalSql,
      dependsOn: nextDependsOn,
      explanation: `Added ${producer.id} as a dependency so this cell can read "${missingDependency.outputName}".`,
    });
  }

  const needsRegeneration =
    !originalSql ||
    /No SQL query defined|Generation likely stalled|references its own output|infinite recursion/i.test(errorMessage) ||
    (!!originalSql && !!hasSelfOutputReference(cell, originalSql));

  // ── Fast-path fixes (no LLM needed) ──
  if (!needsRegeneration && originalSql) {

    // 1. Unquoted date literal: "Table with name 2022-04-01 does not exist"
    const dateAsTableMatch = errorMessage.match(/Table with name (\d{4}-\d{2}-\d{2})/i);
    if (dateAsTableMatch) {
      const bareDate = dateAsTableMatch[1];
      const fixedSql = originalSql.replace(
        new RegExp(`(?<=[>=<\\s])${bareDate.replace(/-/g, "\\-")}(?=[\\s;)'^]|$)`, "g"),
        `'${bareDate}'`
      );
      if (fixedSql !== originalSql) {
        return Response.json({
          fixedSql,
          explanation: `Quoted bare date literal ${bareDate} — DuckDB requires date strings to be quoted`,
        });
      }
    }

    // 2. Wrong table name with DuckDB suggestion: 'Did you mean "correct_table"?'
    const didYouMeanMatch = errorMessage.match(/Table with name (\w+) does not exist!.*Did you mean "(\w+)"/i);
    if (didYouMeanMatch) {
      const wrongTable = didYouMeanMatch[1];
      const suggestedTable = didYouMeanMatch[2];
      const fixedSql = originalSql.replace(
        new RegExp(`\\b${wrongTable}\\b`, "gi"),
        suggestedTable
      );
      if (fixedSql !== originalSql) {
        return Response.json({
          fixedSql,
          explanation: `Replaced non-existent table "${wrongTable}" with "${suggestedTable}"`,
        });
      }
    }

    // 3. Wrong column name with DuckDB suggestion: 'Did you mean "correct_col"?'
    const colDidYouMeanMatch = errorMessage.match(/column[:\s]+"?(\w+)"?.*does not exist.*Did you mean "(\w+)"/i)
      ?? errorMessage.match(/Referenced column "(\w+)" not found.*Did you mean "(\w+)"/i);
    if (colDidYouMeanMatch) {
      const wrongCol = colDidYouMeanMatch[1];
      const suggestedCol = colDidYouMeanMatch[2];
      const fixedSql = originalSql.replace(
        new RegExp(`\\b${wrongCol}\\b`, "g"),
        suggestedCol
      );
      if (fixedSql !== originalSql) {
        return Response.json({
          fixedSql,
          explanation: `Replaced non-existent column "${wrongCol}" with "${suggestedCol}"`,
        });
      }
    }
  }

  // Discover actual schema so the LLM knows what tables/columns exist
  let schemaSection = "";
  try {
    const schema = await discoverSchema(datasetId);
    const schemaText = formatSchemaForLLM(schema);
    schemaSection = `\nAvailable tables (ONLY these exist): ${schema.tableNames.join(", ")}\n\n${schemaText}\n`;
  } catch {
    schemaSection = `\nDataset: ${dataset.label}. This is a DuckDB database.\n`;
  }

  const upstreamCells = allCells.filter((candidate) => cell.dependsOn?.includes(candidate.id));
  const upstreamOutputs = upstreamCells.flatMap((candidate) => candidate.outputs ?? []);
  const upstreamSqlSection = upstreamCells
    .filter((candidate) => candidate.type === "sql" && candidate.sql?.trim())
    .map(formatCellSqlContext)
    .join("\n\n");
  const dateGuidanceSection = dataset.dateRange
    ? `\nDataset relative-date guidance: use DATE '${dataset.dateRange.end}' as the fixed as-of date for relative windows like "last 90 days". Do not use CURRENT_DATE or MAX(date) as the as-of date unless the user explicitly asks for data coverage.\n`
    : "";
  const siblingOutputs = allCells
    .filter((candidate) => candidate.id !== cell.id)
    .flatMap((candidate) => candidate.outputs ?? []);
  const playbookSection = playbookContext
    ? `\nPlaybook: "${playbookContext.name ?? "Untitled"}"\nPlaybook description: "${playbookContext.description ?? ""}"\nParams: ${JSON.stringify(playbookContext.params ?? [])}\nAll cells:\n${allCells.map((c) => `- ${c.id} [${c.type}/${c.role}] ${c.label}: ${c.description}; dependsOn=[${c.dependsOn?.join(",") ?? ""}]; outputs=[${c.outputs?.join(",") ?? ""}]; hasSql=${!!c.sql}`).join("\n")}\n`
    : "";

  const prompt = `You are a DuckDB SQL expert. ${needsRegeneration ? "Generate a replacement SQL query for a broken/missing playbook SQL cell." : "Fix the following SQL query that failed with an error."}

Dataset: ${dataset.label} (DuckDB)
${schemaSection}
${dateGuidanceSection}
${playbookSection}
Cell: "${cell.label}"
Description: "${cell.description}"
Role: "${cell.role}"
Depends on cell IDs: ${(cell.dependsOn ?? []).join(", ") || "(none)"}
This cell should produce outputs: ${(cell.outputs ?? []).join(", ") || "(none)"}
Available upstream outputs for FROM/JOIN references: ${upstreamOutputs.join(", ") || "(none)"}
Other sibling outputs that may exist later but are NOT safe to read here: ${siblingOutputs.filter((output) => !upstreamOutputs.includes(output)).join(", ") || "(none)"}

Upstream SQL definitions:
${upstreamSqlSection || "(none)"}

Original SQL:
\`\`\`sql
${originalSql || "-- missing SQL"}
\`\`\`

Error message:
${errorMessage}

Common DuckDB patterns:
- Date arithmetic: CURRENT_DATE - INTERVAL '30' DAY
- Date literals must be quoted: WHERE col >= '2025-01-01' (not bare 2025-01-01)
- String to date: CAST('2024-01-01' AS DATE)
- Use NULLIF to avoid division by zero: x / NULLIF(y, 0)
- Window functions: ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)
- "Table not found" errors often mean the query references a non-existent table — use only tables from the schema above
- If the error says a date like "2025-02-01" is a table name, the SQL has an unquoted date literal
- A SQL cell must NEVER read from its own outputs. For this cell, do NOT use these names in FROM/JOIN: ${(cell.outputs ?? []).join(", ") || "(none)"}
- If you need an upstream output, reference it by its output name only when it is listed under "Available upstream outputs".
- If a DuckDB binder error says an upstream alias/table does not have a column, inspect the upstream SQL definition and use only columns that the upstream SELECT actually projects.
- If no upstream output exists, query real dataset tables from the schema directly.

IMPORTANT: Only use tables that exist in the schema above. Do NOT invent table names.
IMPORTANT: Return one valid DuckDB SELECT or WITH query. No DDL/DML, no CREATE VIEW, no INSERT/UPDATE/DELETE.

Return a JSON object with exactly these fields:
{
  "fixedSql": "the corrected SQL query",
  "explanation": "one sentence explaining what was wrong and what was fixed"
}

Return ONLY the JSON object, no markdown, no code fences.`;

  try {
    const response = await generateText(prompt, {
      jsonMode: true,
      label: "autofix SQL",
      timeoutMs: 45000,
    });

    let parsed: { fixedSql?: string; explanation?: string };
    try {
      parsed = JSON.parse(response);
    } catch {
      // Try to extract JSON from response
      const match = response.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    if (!parsed.fixedSql) {
      return Response.json({ error: "Could not generate a fix for this error" }, { status: 422 });
    }
    const fixedSql = cleanGeneratedSql(parsed.fixedSql);
    if (!/^(SELECT|WITH)\b/i.test(fixedSql)) {
      return Response.json({ error: "Generated fix was not a SELECT/WITH query" }, { status: 422 });
    }
    const selfRef = hasSelfOutputReference(cell, fixedSql);
    if (selfRef) {
      return Response.json({ error: `Generated SQL still references its own output "${selfRef}"` }, { status: 422 });
    }

    return Response.json({
      fixedSql,
      explanation: parsed.explanation ?? (needsRegeneration ? "Regenerated missing or invalid SQL" : "Fixed SQL error"),
    });
  } catch (err) {
    console.error("[autofix] Error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate fix" },
      { status: 500 },
    );
  }
}
