import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { getSchemaContext } from "@/lib/schema";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
    const body = (await req.json()) as { description: string; datasetId?: string };
    const { description } = body;
    const datasetId = body.datasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;

    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!description?.trim()) {
      return NextResponse.json({ error: "No description provided" }, { status: 400 });
    }

    const schema = getSchemaContext(datasetId);

    const prompt = `You are a DuckDB SQL expert. Given a natural-language metric description, generate a SQL query that returns weekly time-series data.

Schema:
${schema}

Requirements:
- The query MUST return exactly two columns: \`week\` (DATE_TRUNC'd to week) and \`value\` (aggregated metric)
- Use DATE_TRUNC('week', ...) AS week for the time column
- GROUP BY 1 ORDER BY 1
- Cast date columns to TIMESTAMP if needed: date_column::TIMESTAMP
- Use whatever date column exists in the table (check the schema above)

Also infer:
- A short label (2-4 words) for this metric
- The best format: "currency" (monetary values), "percent" (ratios/rates), or "number" (counts)

Metric description: "${description}"

Respond in JSON format only, no markdown fences:
{"sql": "SELECT ...", "label": "Short Label", "format": "currency|percent|number"}`;

    const text = (await generateText(prompt, { modelId })).trim();

    if (!text) {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    const parsed = JSON.parse(cleaned) as { sql: string; label: string; format: string };

    // Validate format
    const format = ["currency", "percent", "number"].includes(parsed.format)
      ? (parsed.format as "currency" | "percent" | "number")
      : "number";

    return NextResponse.json({
      sql: parsed.sql,
      label: parsed.label,
      format,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate SQL" },
      { status: 500 },
    );
  }
}
