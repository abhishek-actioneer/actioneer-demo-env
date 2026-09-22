import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { executeSQL } from "@/lib/sql-executor";
import { getSchemaContext } from "@/lib/schema";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";

/** Get Monday (ISO date) for a given date. */
function toMondayKey(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(mon.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

/** Parse a date value from a query result row. */
function parseDate(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Convert query rows to weekly aggregated data keyed by Monday YYYY-MM-DD. */
function toWeeklyData(
  rows: Record<string, unknown>[],
  dateCol: string,
  valueCol: string,
  aggregation: "sum" | "avg" = "sum",
): Record<string, number> {
  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    const d = parseDate(row[dateCol]);
    if (!d) continue;
    const val = Number(row[valueCol]);
    if (isNaN(val)) continue;
    const key = toMondayKey(d);
    const arr = buckets.get(key) ?? [];
    arr.push(val);
    buckets.set(key, arr);
  }

  const result: Record<string, number> = {};
  for (const [key, vals] of buckets) {
    result[key] = aggregation === "avg"
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : vals.reduce((a, b) => a + b, 0);
  }
  return result;
}

/** Detect date and value columns from query result. */
function detectColumns(columns: string[]): { dateCol: string; valueCol: string } | null {
  const dateCandidates = ["week", "date", "month", "day"];
  const valueCandidates = ["value", "val", "total", "count", "sum", "amount"];

  let dateCol = columns.find((c) => dateCandidates.includes(c.toLowerCase()));
  if (!dateCol) dateCol = columns[0]; // fallback: first column

  let valueCol = columns.find((c) => valueCandidates.includes(c.toLowerCase()));
  if (!valueCol) {
    // Find first non-date numeric-looking column
    valueCol = columns.find((c) => c !== dateCol);
  }
  if (!dateCol || !valueCol) return null;
  return { dateCol, valueCol };
}

/** Ask the LLM to fix a broken SQL query. */
async function llmFixSQL(sql: string, error: string, modelId?: ModelId, datasetId?: string): Promise<string | null> {
  const schema = getSchemaContext(datasetId);

  const prompt = `You are a DuckDB SQL expert. A query failed with the error below. Fix it and return ONLY the corrected SQL, no explanation.

Schema:
${schema}

Original SQL:
${sql}

Error:
${error}

Return only the corrected SQL query.`;

  try {
    const text = (await generateText(prompt, { modelId })).trim();
    if (!text) return null;
    // Strip markdown code fences if present
    return text.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "").trim();
  } catch {
    return null;
  }
}

/** Ask the LLM to explain a SQL error in plain English. */
async function llmExplainError(sql: string, error: string, modelId?: ModelId): Promise<string> {
  const prompt = `Explain this SQL error in one sentence for a non-technical user:

SQL: ${sql}
Error: ${error}

Be brief and helpful.`;

  try {
    return (await generateText(prompt, { modelId })).trim() || error;
  } catch {
    return error;
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
    const body = (await req.json()) as {
      sql: string;
      aggregation?: "sum" | "avg";
      datasetId?: string;
    };
    const { sql, aggregation = "sum" } = body;
    const datasetId = body.datasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;

    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!sql?.trim()) {
      return NextResponse.json({ data: {}, error: "No SQL provided" }, { status: 400 });
    }

    // First attempt
    let result = await executeSQL(sql, datasetId);

    // On failure: try LLM auto-fix once
    if (result.error) {
      const fixedSQL = await llmFixSQL(sql, result.error, modelId, datasetId);
      if (fixedSQL && fixedSQL !== sql) {
        result = await executeSQL(fixedSQL, datasetId);
      }

      // Still failing — return friendly error
      if (result.error) {
        const explanation = await llmExplainError(sql, result.error, modelId);
        return NextResponse.json({ data: {}, error: explanation });
      }
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ data: {}, error: "Query returned no rows" });
    }

    const detected = detectColumns(result.columns);
    if (!detected) {
      return NextResponse.json({ data: {}, error: "Could not detect date and value columns" });
    }

    // Check if data is already weekly (keys all align to Mondays)
    const firstDate = parseDate(result.rows[0][detected.dateCol]);
    const isWeekly = firstDate && firstDate.getUTCDay() === 1; // Monday

    const data = isWeekly
      ? (() => {
          const out: Record<string, number> = {};
          for (const row of result.rows) {
            const d = parseDate(row[detected.dateCol]);
            if (!d) continue;
            out[d.toISOString().slice(0, 10)] = Number(row[detected.valueCol]);
          }
          return out;
        })()
      : toWeeklyData(result.rows, detected.dateCol, detected.valueCol, aggregation);

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { data: {}, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
