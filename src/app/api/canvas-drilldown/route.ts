import { auth } from "@clerk/nextjs/server";
import { generateText } from "@/lib/llm";
import { getDataset, getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const DrilldownRequestSchema = z.object({
  parentSql: z.string().default(""),
  clickedColumn: z.string().min(1),
  clickedValue: z.string(),
  chartType: z.string(),
  datasetId: z.string().optional(),
});

function buildDrilldownPrompt(
  parentSql: string,
  clickedColumn: string,
  clickedValue: string,
  chartType: string,
  schemaContext: string
): string {
  return `You are an analytics drill-down advisor. Given a parent chart and what the user clicked, suggest 3-4 useful drill-down queries.

Schema:
${schemaContext}
${parentSql ? `\nParent SQL:\n${parentSql}` : ""}

Chart type: ${chartType}
User clicked: column="${clickedColumn}", value="${clickedValue}"

Generate 3-4 analytically useful drill-down suggestions that explore the clicked dimension/value deeper. Each suggestion should be a natural language question (not SQL).

Think about:
- Breaking down the clicked value by a secondary dimension
- Showing trends over time for the clicked value
- Comparing the clicked value against related values
- Investigating outliers or drivers behind the clicked value

Return ONLY a JSON array of objects with "label" (short, 5-8 words for UI button) and "query" (full natural language question to send to the analytics engine). No markdown fences. No explanation.

Example format:
[{"label":"Revenue by month","query":"Show monthly revenue trend for cleaning services over the last 12 months"},{"label":"Top customers","query":"Who are the top 10 customers by spend in the cleaning category?"}]`;
}

function parseSuggestions(
  text: string
): Array<{ label: string; query: string }> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (item: unknown): item is { label: string; query: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).label === "string" &&
          typeof (item as Record<string, unknown>).query === "string"
      )
      .slice(0, 4);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = DrilldownRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { parentSql, clickedColumn, clickedValue, chartType } = parsed.data;
  const datasetId =
    parsed.data.datasetId ||
    req.headers.get("x-dataset-id") ||
    DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const ds = getDataset(datasetId);
  const schemaContext = ds.schemaContext;

  const prompt = buildDrilldownPrompt(
    parentSql,
    clickedColumn,
    clickedValue,
    chartType,
    schemaContext
  );

  try {
    const text = await generateText(prompt, {
      timeoutMs: 10_000,
      label: "canvas-drilldown",
      maxOutputTokens: 512,
    });

    const suggestions = parseSuggestions(text);
    return Response.json({ suggestions });
  } catch (err) {
    console.error("[canvas-drilldown] error:", err);
    return Response.json({ suggestions: [] });
  }
}
