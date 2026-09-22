import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";

const CardSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  sql: z.string().optional(),
  markdownContent: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  reportMarkdown: z.string().optional(),
});

const CanvasCollectiveSchema = z.object({
  operation: z.enum(["summarize", "compare"]),
  cards: z.array(CardSummarySchema).min(2),
});

type CardSummary = z.infer<typeof CardSummarySchema>;

function buildCardDescription(card: CardSummary, index: number): string {
  const lines: string[] = [`${index + 1}. [${card.type}] "${card.title}"`];
  if (card.sql) lines.push(`   SQL: ${card.sql.slice(0, 300)}`);
  if (card.markdownContent) lines.push(`   Content: ${card.markdownContent.slice(0, 300)}`);
  if (card.reportMarkdown) lines.push(`   Report: ${card.reportMarkdown.slice(0, 300)}`);
  if (card.data && card.data.length > 0) {
    const sample = card.data.slice(0, 3);
    lines.push(`   Data sample: ${JSON.stringify(sample)}`);
  }
  return lines.join("\n");
}

function buildSummarizePrompt(cards: CardSummary[]): string {
  const cardList = cards.map((c, i) => buildCardDescription(c, i)).join("\n\n");

  return `You are an analytics assistant embedded in a data canvas. The user has selected multiple cards and wants a combined summary.

SELECTED CARDS:
${cardList}

Generate a concise synthesis that:
1. Identifies the common theme or narrative across all cards
2. Highlights the most important insights from the combined data
3. Notes any interesting relationships or contrasts between the cards

Respond with a JSON object only (no markdown fences):
{
  "title": "<5-8 word title for the summary>",
  "content": "<markdown content, 100-200 words, use bullet points for key insights>"
}

Rules:
- Be analytical and specific, reference actual data/metrics when available
- Don't just repeat card titles — synthesize meaningful insights
- Return ONLY valid JSON, no explanation`;
}

function buildComparePrompt(cards: CardSummary[]): string {
  const cardList = cards.map((c, i) => buildCardDescription(c, i)).join("\n\n");

  return `You are an analytics assistant embedded in a data canvas. The user wants a structured comparison of the selected cards.

SELECTED CARDS:
${cardList}

Generate a comparison that:
1. Identifies what each card measures or represents
2. Highlights key similarities and differences
3. Points out any notable patterns, anomalies, or relationships
4. Concludes with an actionable insight if one emerges

Respond with a JSON object only (no markdown fences):
{
  "title": "<5-8 word comparison title>",
  "content": "<markdown content, 150-250 words, use a comparison table or structured bullet points>"
}

Rules:
- Be specific and data-driven when possible
- Use markdown tables or bullet lists to make comparisons clear
- Return ONLY valid JSON, no explanation`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CanvasCollectiveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const { operation, cards } = parsed.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const prompt =
    operation === "summarize"
      ? buildSummarizePrompt(cards)
      : buildComparePrompt(cards);

  try {
    const raw = await generateText(prompt, {
      modelId,
      timeoutMs: 20_000,
      label: `canvas-collective-${operation}`,
      jsonMode: true,
    });

    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    let result: { title?: string; content?: string };
    try {
      result = JSON.parse(cleaned);
    } catch {
      return Response.json(
        { error: "Failed to parse LLM response" },
        { status: 500 }
      );
    }

    return Response.json({
      title: result.title?.trim() || (operation === "summarize" ? "Combined Summary" : "Comparison"),
      content: result.content?.trim() || "",
    });
  } catch (err) {
    console.error(`[canvas-collective/${operation}] error:`, err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
