import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";

const CanvasFrameTitleSchema = z.object({
  cards: z.array(
    z.object({
      type: z.string(),
      title: z.string(),
      sql: z.string().optional(),
    })
  ).min(1),
});

function buildPrompt(cards: { type: string; title: string; sql?: string }[]): string {
  const cardList = cards
    .map((c, i) => {
      const parts = [`${i + 1}. [${c.type}] "${c.title}"`];
      if (c.sql) parts.push(`   SQL: ${c.sql.slice(0, 200)}`);
      return parts.join("\n");
    })
    .join("\n");

  return `You are helping organize a data analysis canvas. The user has grouped these cards into a frame:

${cardList}

Generate a concise group title (3-5 words) and a one-line description (max 12 words) that captures the common theme or purpose of these cards.

Respond with a JSON object only (no markdown fences):
{
  "title": "<3-5 word group title>",
  "description": "<one-line description, max 12 words>"
}

Rules:
- Title should be specific, not generic (avoid "Data Analysis" or "Overview")
- Description should hint at what insight or question the group addresses
- Return ONLY valid JSON, no explanation`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CanvasFrameTitleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const { cards } = parsed.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const prompt = buildPrompt(cards);

  try {
    const raw = await generateText(prompt, {
      modelId,
      timeoutMs: 10_000,
      label: "canvas-frame-title",
      jsonMode: true,
    });

    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    let result: { title?: string; description?: string };
    try {
      result = JSON.parse(cleaned);
    } catch {
      return Response.json({ title: "Untitled Group", description: "" });
    }

    return Response.json({
      title: result.title?.trim() || "Untitled Group",
      description: result.description?.trim() || "",
    });
  } catch (err) {
    console.error("[canvas-frame-title] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
