import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { buildSegmentSqlPrompt } from "@/lib/prompts/sql";
import { z } from "zod/v4";

const GenerateSegmentSqlSchema = z.object({
  description: z.string().min(1),
  datasetId: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = GenerateSegmentSqlSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { description, datasetId: bodyDatasetId } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  try {
    const systemPrompt = buildSegmentSqlPrompt(datasetId);

    // Segment SQL generation is harder than classify (window functions, multi-step
    // reasoning, fat schema context) — give the LLM 60s instead of the 30s default,
    // and retry once on timeout since transient slow responses are the dominant
    // failure mode. Total worst-case: ~120s.
    const SEGMENT_SQL_TIMEOUT_MS = 60_000;
    const isTimeout = (e: unknown): boolean =>
      e instanceof Error && /timed out after/i.test(e.message);

    let raw = "";
    try {
      raw = (await generateText(description, {
        modelId,
        systemPrompt,
        timeoutMs: SEGMENT_SQL_TIMEOUT_MS,
        feature: "segment_generate_sql",
        datasetId,
      })).trim();
    } catch (firstErr) {
      if (!isTimeout(firstErr)) throw firstErr;
      console.warn("[segments/generate-sql] first attempt timed out, retrying once");
      raw = (await generateText(description, {
        modelId,
        systemPrompt,
        timeoutMs: SEGMENT_SQL_TIMEOUT_MS,
        feature: "segment_generate_sql_retry",
        datasetId,
      })).trim();
    }

    // The prompt asks for JSON, but LLMs sometimes wrap it in code fences
    // or emits a bare SQL string. Handle both.
    const cleaned = raw
      .replace(/^```(?:json|sql)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    let name = "";
    let generatedDescription = "";
    let sql = "";
    try {
      const parsed = JSON.parse(cleaned) as { name?: unknown; description?: unknown; sql?: unknown };
      name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      generatedDescription = typeof parsed.description === "string" ? parsed.description.trim() : "";
      sql = typeof parsed.sql === "string" ? parsed.sql.trim() : "";
    } catch {
      // Fallback: model returned bare SQL. Leave name/description empty so the client
      // applies its own heuristic.
      sql = cleaned.replace(/^(--[^\n]*\n)+/g, "").trim();
    }

    if (!sql || sql === "UNSUPPORTED_QUERY") {
      return Response.json(
        { error: "Could not generate SQL for this description. Try being more specific." },
        { status: 422 }
      );
    }

    return Response.json({ sql, name, description: generatedDescription });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
