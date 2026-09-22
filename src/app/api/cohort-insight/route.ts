import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { generateText, type ModelId } from "@/lib/llm";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";

const CohortInsightSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  userQuery: z.string().min(1).max(2000),
  segmentName: z.string().min(1).max(200),
  segmentDescription: z.string().max(2000).optional(),
  segmentSql: z.string().min(1).max(20000),
  userCount: z.number().nullable().optional(),
});

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function fallbackInsight(segmentName: string, userQuery: string, userCount: number | null, entityName?: string): string {
  const entity = entityName || "members";
  const countText = userCount === null ? "a reusable cohort" : `**${userCount.toLocaleString()} ${entity}**`;
  return [
    `### ${segmentName}`,
    "",
    `${countText} match this cohort.`,
    "",
    `**Why it matters:** ${userQuery.replace(/^(find|show|list)\s+/i, "").trim() || userQuery}`,
    "",
    "**Next step:** Save it as a segment for campaign or voice outreach.",
  ].join("\n");
}

export async function POST(req: Request) {
  const parsed = CohortInsightSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const cleanSql = parsed.data.segmentSql.trim().replace(/;+\s*$/, "");
  const validation = validateSQL(cleanSql);
  if (!validation.valid) return Response.json({ error: validation.error || "Invalid SQL" }, { status: 400 });

  let userCount = parsed.data.userCount ?? null;
  if (userCount === null) {
    const countResult = await executeSQLInternal(`SELECT COUNT(*) as cnt FROM (${cleanSql}) __cohort_count`, datasetId);
    if (!countResult.error) userCount = Number(countResult.rows[0]?.cnt ?? 0);
  }

  const columnsResult = await executeSQLInternal(`SELECT * FROM (${cleanSql}) __cohort_columns LIMIT 0`, datasetId);
  const selectedColumns = columnsResult.error ? [] : columnsResult.columns;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const systemPrompt = `You write concise, grounded cohort insights for an analytics product.

Dataset:
- Label: ${dataset.label}
- Company: ${dataset.companyName || dataset.label}
- Entity name: ${dataset.entityName || "members"}
- Date range: ${dataset.reportMeta?.dateRangeLabel || "available data"}

Dataset context:
${dataset.systemContext}

Rules:
- Do not invent numbers beyond the provided cohort count.
- Do not list sample IDs or sample rows.
- Do not ask the user for table or column names; the SQL has already been generated.
- Keep it tight. No generic strategy language. No long paragraphs.
- Output exactly this markdown shape:
  ### <cohort name>
  **<count> <entity>** match this cohort. <one plain-English sentence defining the cohort.>

  **Why it matters:** <one sentence with the business gap or risk.>

  **Next step:** <one concrete action.>
- Maximum 90 words total.`;

  const userPrompt = JSON.stringify({
    userQuery: parsed.data.userQuery,
    segmentName: parsed.data.segmentName,
    segmentDescription: parsed.data.segmentDescription || parsed.data.userQuery,
    userCount,
    selectedColumns,
    segmentSql: cleanSql,
  });

  try {
    const insight = await generateText(userPrompt, {
      modelId,
      systemPrompt,
      timeoutMs: 20_000,
      feature: "cohort_insight",
      datasetId,
      maxOutputTokens: 500,
    });
    const cleaned = insight.trim();
    return Response.json({
      insight: cleaned || fallbackInsight(parsed.data.segmentName, parsed.data.userQuery, userCount, dataset.entityName),
      userCount,
      selectedColumns,
    });
  } catch {
    return Response.json({
      insight: fallbackInsight(parsed.data.segmentName, parsed.data.userQuery, userCount, dataset.entityName),
      userCount,
      selectedColumns,
    });
  }
}
