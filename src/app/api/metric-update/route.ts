import { auth } from "@clerk/nextjs/server";
import { generateText } from "@/lib/llm";
import { getSystemContext } from "@/lib/schema";
import { executeSQLInternal } from "@/lib/sql-executor";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";

const RelationshipSchema = z.object({
  metricId: z.string().max(100),
  metricName: z.string().max(200),
  direction: z.string().max(50),
});

const MetricUpdateSchema = z.object({
  metricName: z.string().min(1).max(200),
  currentSql: z.string().max(8000).optional().default(""),
  currentFormula: z.string().max(1000).optional().default(""),
  table: z.string().max(200).optional().default(""),
  column: z.string().max(200).optional().default(""),
  timeColumn: z.string().max(200).optional().default(""),
  description: z.string().max(1000).optional().default(""),
  relationships: z.array(RelationshipSchema).max(50).optional().default([]),
  userRequest: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = MetricUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
  }

  const { metricName, currentSql, currentFormula, table, column, timeColumn, description, relationships, userRequest } = parsed.data;
  console.log("[api/metric-update] Request:", { metricName, table, description: description?.slice(0, 80), userRequest: userRequest?.slice(0, 80) });

  try {
    const systemContext = getSystemContext(datasetId);
    const isCreation = !currentSql && !currentFormula;

    // Fetch the actual column schema + sample data for the selected table
    let tableSchema = "";
    if (table) {
      const descResult = await executeSQLInternal(`DESCRIBE "${table}"`, datasetId);
      if (!descResult.error && descResult.rows.length > 0) {
        const cols = descResult.rows.map((r) => `  - ${r.column_name} (${r.column_type})`).join("\n");
        tableSchema = `\nColumns in "${table}":\n${cols}\n`;
        console.log("[api/metric-update] Table schema loaded:", descResult.rows.length, "columns");
      }

      // Get sample rows so LLM sees actual values (case, format, enums)
      const sampleResult = await executeSQLInternal(`SELECT * FROM "${table}" LIMIT 3`, datasetId);
      if (!sampleResult.error && sampleResult.rows.length > 0) {
        const sampleStr = sampleResult.rows.map((row) => JSON.stringify(row)).join("\n");
        tableSchema += `\nSample rows from "${table}":\n${sampleStr}\n`;
      }

      // Get distinct values for VARCHAR columns that look like status/type/category fields
      if (!descResult.error) {
        const enumCols = descResult.rows.filter((r) => {
          const name = String(r.column_name).toLowerCase();
          const type = String(r.column_type).toLowerCase();
          return type.includes("varchar") && (name.includes("status") || name.includes("type") || name.includes("category") || name.includes("tier"));
        });
        for (const col of enumCols.slice(0, 5)) {
          const distinctResult = await executeSQLInternal(`SELECT DISTINCT "${col.column_name}" AS val, COUNT(*) AS cnt FROM "${table}" GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, datasetId);
          if (!distinctResult.error && distinctResult.rows.length > 0) {
            const vals = distinctResult.rows.map((r) => `${r.val} (${r.cnt})`).join(", ");
            tableSchema += `\nDistinct values for "${col.column_name}": ${vals}\n`;
          }
        }
      }
    }

    const prompt = `You are a data analytics expert. ${isCreation ? `Create a new metric "${metricName}".` : `Update the definition of the metric "${metricName}".`}

${!isCreation ? `Current metric definition:
- Description: ${description}
- Table: ${table}
- Column: ${column}
- Time Column: ${timeColumn}
- Current Formula: ${currentFormula}
- Current SQL (time series): ${currentSql}
` : `Metric request:
- Name: ${metricName}
- Description: ${description}
- Table: ${table}
`}
${tableSchema}
${systemContext}

The user's request: "${userRequest}"

${!isCreation ? `Current relationships:
${relationships.map((r) => `- ${r.direction}: ${r.metricName}`).join("\n")}` : ""}

You MUST generate TWO separate SQL queries:

1. "valueSql" — returns a SINGLE ROW with a column named exactly "value". This is the current aggregate metric value. Example: SELECT COUNT(*) AS value FROM bookings
2. "timeSeriesSql" — returns MULTIPLE ROWS with columns named exactly "date" and "value". This is the metric over time. Must be grouped by date and ordered by date ascending. Example: SELECT booking_date AS date, COUNT(*) AS value FROM bookings GROUP BY 1 ORDER BY 1

CRITICAL RULES:
- Output columns MUST be aliased as "value" (and "date" for time series). Do NOT use any other alias name.
- You MUST ONLY use column names that exist in the table schema above. Do NOT invent or guess column names.
- For date grouping, use the actual date/timestamp column from the schema (e.g. booking_date, shift_date, sent_at). NEVER assume a column called "date" exists unless the schema lists it.
- The SQL must be valid DuckDB SQL.
- For percentage metrics, multiply by 100.0 so the value is a percentage (e.g. 12.5 not 0.125).

Generate the updated SQL query and formula. Respond in this exact JSON format:
{
  "valueSql": "SELECT ... AS value FROM ...",
  "timeSeriesSql": "SELECT actual_date_column AS date, ... AS value FROM ... GROUP BY 1 ORDER BY 1",
  "newFormula": "the formula expression",
  "newDescription": "one SHORT sentence — max 10 words — describing what this metric measures",
  "explanation": "one SHORT sentence — max 8 words — what was generated or changed (e.g. 'Cancellation rate from bookings table')",
  "affectedMetrics": ["list of downstream metric names affected by this change"]
}`;

    // Try up to 2 attempts — LLM sometimes truncates output
    let resultParsed: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await generateText(prompt, {
        jsonMode: true,
        label: "metric_update_sql_generation",
        maxOutputTokens: 4096,
      });

      const cleaned = result.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
      try {
        resultParsed = JSON.parse(cleaned);
        break;
      } catch {
        // Try salvage by truncating to last complete brace
        const lastBrace = cleaned.lastIndexOf("}");
        if (lastBrace > 0) {
          try {
            resultParsed = JSON.parse(cleaned.slice(0, lastBrace + 1));
            break;
          } catch { /* retry */ }
        }
        console.warn(`[api/metric-update] Malformed JSON (attempt ${attempt + 1}):`, cleaned.slice(0, 200));
      }
    }

    if (!resultParsed) {
      return Response.json(
        { error: "Failed to generate metric. Please try again." },
        { status: 500 },
      );
    }
    const valueSql = String(resultParsed.valueSql || "");
    const timeSeriesSql = String(resultParsed.timeSeriesSql || "");
    console.log("[api/metric-update] LLM generated:", { valueSql: valueSql.slice(0, 100), timeSeriesSql: timeSeriesSql.slice(0, 100) });

    // ── Validate by executing both SQLs against DuckDB ──
    let computedValue: number | null = null;
    let valueSqlError: string | null = null;
    let timeSeries: { date: string; value: number }[] = [];
    let timeSeriesSqlError: string | null = null;

    if (valueSql) {
      const valueResult = await executeSQLInternal(valueSql, datasetId);
      if (valueResult.error) {
        valueSqlError = valueResult.error;
        console.warn("[api/metric-update] valueSql failed:", valueSqlError);
      } else if (valueResult.rows.length > 0) {
        const raw = valueResult.rows[0].value;
        computedValue = typeof raw === "number" ? raw : Number(raw) || 0;
        console.log("[api/metric-update] valueSql result:", computedValue);
      }
    }

    if (timeSeriesSql) {
      const tsResult = await executeSQLInternal(timeSeriesSql, datasetId);
      if (tsResult.error) {
        timeSeriesSqlError = tsResult.error;
        console.warn("[api/metric-update] timeSeriesSql failed:", timeSeriesSqlError);
      } else {
        timeSeries = tsResult.rows.map((row) => ({
          date: String(row.date),
          value: typeof row.value === "number" ? row.value : Number(row.value) || 0,
        }));
        console.log("[api/metric-update] timeSeriesSql returned", timeSeries.length, "rows");
        // Derive value from latest time series point if valueSql failed
        if (computedValue === null && timeSeries.length > 0) {
          computedValue = timeSeries[timeSeries.length - 1].value;
        }
      }
    }

    const sqlValid = !valueSqlError && !timeSeriesSqlError;

    return Response.json({
      success: true,
      valueSql,
      timeSeriesSql,
      newFormula: String(resultParsed.newFormula || currentFormula),
      newDescription: String(resultParsed.newDescription || description),
      explanation: String(resultParsed.explanation || "Metric definition updated"),
      affectedMetrics: Array.isArray(resultParsed.affectedMetrics) ? resultParsed.affectedMetrics : [],
      // Computed results from executing the SQL
      computedValue,
      timeSeries,
      sqlValid,
      sqlErrors: {
        valueSql: valueSqlError,
        timeSeriesSql: timeSeriesSqlError,
      },
    });
  } catch (error) {
    console.error("[api/metric-update] Error:", error instanceof Error ? error.message : error);
    return Response.json(
      { error: "Failed to generate metric update. Please try again." },
      { status: 500 },
    );
  }
}
