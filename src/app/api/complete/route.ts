import { auth } from "@clerk/nextjs/server";
import { generateText } from "@/lib/llm";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const CompleteSchema = z.object({
  prefix: z.string().min(1).max(500),
  datasetId: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ completions: [] }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { prefix, datasetId: bodyDatasetId } = parsed.data;
  const headerDatasetId = req.headers.get("x-dataset-id");
  const datasetId = bodyDatasetId || headerDatasetId || DEFAULT_DATASET;
  const ds = getDatasetForUser(datasetId, userId);
  if (!ds) return Response.json({ error: "Not found" }, { status: 404 });

  // Compact prompt — keep it short for speed
  const systemPrompt = `Autocomplete engine for "${ds.label}" analytics. Schema: ${ds.schemaContext.slice(0, 800)}
Return a JSON object: {"suggestions":["question1","question2",...]}. 3-5 diverse, complete analytics questions. No explanation.`;

  try {
    const text = await generateText(
      `User typed: "${prefix}". Suggest 3-5 complete analytics questions.`,
      { systemPrompt, timeoutMs: 8000, label: "autocomplete", jsonMode: true },
    );

    // Parse JSON — handle {"suggestions":[...]}, bare [...], or markdown fences
    const cleaned = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const result = JSON.parse(cleaned);

    const arr = Array.isArray(result)
      ? result
      : Array.isArray(result?.suggestions)
        ? result.suggestions
        : Array.isArray(result?.completions)
          ? result.completions
          : null;

    if (!arr) {
      console.warn("[autocomplete] LLM returned unexpected shape:", cleaned.slice(0, 200));
      return Response.json({ completions: [] });
    }

    const completions = arr
      .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, 5);

    return Response.json({ completions });
  } catch (err) {
    console.warn("[autocomplete] error:", err instanceof Error ? err.message : err);
    return Response.json({ completions: [] });
  }
}
