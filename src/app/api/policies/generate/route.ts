import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { executeSQLInternal } from "@/lib/sql-executor";
import { getSchemaContext } from "@/lib/schema";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  tableNames: z.array(z.string()).min(1),
  mode: z.enum(["generate", "clarify"]).default("generate"),
  conversationContext: z.string().optional(),
});

async function getTableColumns(tableName: string, datasetId: string) {
  const result = await executeSQLInternal(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${tableName}' ORDER BY ordinal_position`,
    datasetId,
  );
  if (result.error) return [];
  return result.rows.map((r) => ({
    name: r.column_name as string,
    type: r.data_type as string,
  }));
}

function buildMultiTablePrompt(
  schemaInfo: string,
  tables: { name: string; columns: { name: string; type: string }[] }[],
): string {
  const tableBlocks = tables.map((t) => {
    const colList = t.columns.map((c) => `    - ${c.name} (${c.type})`).join("\n");
    return `  TABLE: ${t.name}\n  COLUMNS:\n${colList}`;
  }).join("\n\n");

  return `You are a data access policy generator. Given a user's description of what access they want to grant, generate a structured policy JSON covering ALL specified tables.

SCHEMA CONTEXT:
${schemaInfo}

TARGET TABLES:
${tableBlocks}

OUTPUT FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
  "name": "kebab-case-policy-name",
  "description": "One-line description of what this policy grants",
  "tableAccess": [
    {
      "tableName": "table1",
      "allowSelectStar": false,
      "allowAllColumns": false,
      "allowedColumns": ["col1", "col2"],
      "rowFilter": "optional SQL WHERE expression or null",
      "rowFilterDescription": "plain English explanation or null"
    },
    {
      "tableName": "table2",
      "allowSelectStar": false,
      "allowAllColumns": true,
      "allowedColumns": [],
      "rowFilter": null,
      "rowFilterDescription": null
    }
  ]
}

RULES:
1. Generate one tableAccess entry per table listed above.
2. Only include columns that exist in each table's COLUMNS list.
3. If the user wants "all columns" for a table, set allowAllColumns=true and allowedColumns=[].
4. If the user mentions PII/sensitive data to exclude, list only the safe columns.
5. rowFilter must be a valid SQL WHERE expression using only columns from that table.
6. If no row filter is needed, set rowFilter=null and rowFilterDescription=null.
7. allowSelectStar should be false unless explicitly requested.
8. Generate a descriptive kebab-case name that reflects the overall access level.
9. The description should summarize what access is granted across all tables.`;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = GenerateSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { prompt, tableNames, mode, conversationContext } = parsed.data;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  // Fetch columns for all tables in parallel
  const tableColumnsPromises = tableNames.map(async (name) => ({
    name,
    columns: await getTableColumns(name, datasetId),
  }));
  const tables = await Promise.all(tableColumnsPromises);
  const validTables = tables.filter((t) => t.columns.length > 0);

  if (validTables.length === 0) {
    return Response.json({ error: "No valid tables found" }, { status: 400 });
  }

  if (mode === "clarify") {
    const colSummary = validTables.map((t) =>
      `${t.name}: ${t.columns.map((c) => c.name).join(", ")}`
    ).join("\n");

    const systemPrompt = `You are helping an admin create a data access policy. A policy defines what a user role CAN access — it's a whitelist, not a blocklist. If the admin says "restrict access to X", they mean members should NOT see X.

TABLES AND COLUMNS:
${colSummary}

Your job: Ask ONE focused clarifying question to nail down the exact restrictions. Your question should help determine:
- Which columns should be VISIBLE vs HIDDEN in each table
- What row-level filter to apply (e.g., only a specific hub, region, date range)
- Whether entire tables should be blocked (not included in the policy)

IMPORTANT interpretation rules:
- "restrict access to revenue tables" = members should NOT see revenue tables
- "only access to Sarjapur hub" = row filter: hub = 'Sarjapur' on relevant tables
- "no access to KPIs" = KPI tables excluded from the policy entirely
- "restrict PII" = hide columns like email, phone, address

Format your response as:
1. A brief summary of what you understood from their request (1-2 sentences)
2. ONE clarifying question with 2-3 numbered options

Keep it concise. Do not generate the policy yet.`;

    const fullPrompt = conversationContext
      ? `Previous context:\n${conversationContext}\n\nLatest message: ${prompt}`
      : prompt;
    try {
      const text = await generateText(fullPrompt, { modelId, systemPrompt, timeoutMs: 30_000, label: "policy clarification" });
      return Response.json({ type: "clarify", message: text });
    } catch (err) {
      console.error("[policy-clarify] LLM call failed:", err instanceof Error ? err.message : err);
      return Response.json({ error: err instanceof Error ? err.message : "Clarification failed" }, { status: 500 });
    }
  }

  // Generate mode
  const schemaInfo = getSchemaContext(datasetId);
  const systemPrompt = buildMultiTablePrompt(schemaInfo, validTables);
  const fullPrompt = conversationContext
    ? `Previous context:\n${conversationContext}\n\nFinal request: ${prompt}`
    : prompt;

  try {
    const text = await generateText(fullPrompt, { modelId, systemPrompt, jsonMode: true, timeoutMs: 60_000, label: "policy generation" });
    const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");

    try {
      const policy = JSON.parse(cleaned);
      return Response.json({ type: "policy", policy });
    } catch {
      console.error("[policy-generate] JSON parse failed. Raw LLM output:", cleaned.slice(0, 500));
      return Response.json({ error: "Failed to parse generated policy", raw: cleaned.slice(0, 200) }, { status: 500 });
    }
  } catch (err) {
    console.error("[policy-generate] LLM call failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: err instanceof Error ? err.message : "Policy generation failed" }, { status: 500 });
  }
}
