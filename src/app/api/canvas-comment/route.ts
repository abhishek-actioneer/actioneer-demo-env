import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";
import type { BoardCard } from "@/lib/board-types";

const CanvasCommentSchema = z.object({
  cardId: z.string().min(1),
  boardId: z.string().min(1),
  comment: z.string().min(1).max(2000),
  cardContext: z
    .object({
      type: z.string().optional(),
      title: z.string().optional(),
      sql: z.string().optional(),
      data: z.array(z.record(z.string(), z.unknown())).optional(),
      markdownContent: z.string().optional(),
    })
    .optional(),
  datasetId: z.string().optional(),
});

function buildPrompt(
  comment: string,
  cardContext: {
    type?: string;
    title?: string;
    sql?: string;
    data?: Record<string, unknown>[];
    markdownContent?: string;
  } | undefined,
): string {
  const cardDesc = cardContext
    ? [
        `Card type: ${cardContext.type ?? "unknown"}`,
        cardContext.title ? `Card title: "${cardContext.title}"` : null,
        cardContext.sql ? `SQL: ${cardContext.sql}` : null,
        cardContext.markdownContent
          ? `Content preview: ${cardContext.markdownContent.slice(0, 300)}`
          : null,
        cardContext.data && cardContext.data.length > 0
          ? `Data sample (first 5 rows): ${JSON.stringify(cardContext.data.slice(0, 5))}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "No card context available.";

  return `You are an analytics assistant embedded in a data canvas. A user has left a comment on a data card.

CARD CONTEXT:
${cardDesc}

USER COMMENT: "${comment}"

Your task:
1. Classify the comment intent as one of: "question", "instruction", "note"
   - question: asks about the data, requests analysis or explanation
   - instruction: asks you to modify or update the card (title, content, etc.)
   - note: a remark, annotation, or observation that doesn't need a response

2. Based on the intent, respond with a JSON object (no markdown fences):

For "question":
{
  "intent": "question",
  "text": "<concise answer, max 150 words, cite specific data if available>",
  "newCard": null
}
If the answer would benefit from a new card (e.g. a follow-up analysis), include:
  "newCard": { "type": "text", "title": "<title>", "markdownContent": "<content>" }

For "instruction":
{
  "intent": "instruction",
  "updatedFields": { <only the fields to change, e.g. "title": "New Title"> }
}

For "note":
{
  "intent": "note"
}

3. Optionally, if you notice data caveats, statistical issues, or connections to other cards that are worth surfacing as sticky notes, include an "annotations" array:
  "annotations": [
    { "text": "<short annotation text, max 80 chars>", "relatedCardId": "<same cardId as this card>", "severity": "info" | "warning" }
  ]
   - Only include annotations when genuinely useful (e.g. small sample size, potential data quality issue, noteworthy pattern).
   - Omit the field entirely if there are no meaningful annotations.

Rules:
- Be concise. Don't fabricate data you don't have.
- For instructions, only return fields that should actually change.
- Return ONLY valid JSON. No explanation, no markdown.`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CanvasCommentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { comment, cardContext, datasetId: bodyDatasetId } = parsed.data;
  const headerDatasetId = req.headers.get("x-dataset-id");
  const datasetId = bodyDatasetId || headerDatasetId || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  void datasetId; // available for future use (e.g. SQL execution)
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const prompt = buildPrompt(comment, cardContext);

  try {
    const raw = await generateText(prompt, {
      modelId,
      timeoutMs: 20_000,
      label: "canvas-comment",
    });

    // Strip markdown fences if present
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    let parsed: {
      intent: "question" | "instruction" | "note";
      text?: string;
      newCard?: Partial<BoardCard> | null;
      updatedFields?: Partial<BoardCard>;
      annotations?: Array<{
        text: string;
        relatedCardId: string;
        severity?: "info" | "warning";
      }>;
    };

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: treat as a plain response to a question
      return Response.json({
        type: "response",
        text: raw.trim().slice(0, 500),
      });
    }

    const intent = parsed.intent;
    const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : undefined;

    if (intent === "question") {
      return Response.json({
        type: "response",
        text: parsed.text ?? "",
        newCard: parsed.newCard ?? undefined,
        annotations,
      });
    }

    if (intent === "instruction") {
      return Response.json({
        type: "update",
        updatedFields: parsed.updatedFields ?? {},
        annotations,
      });
    }

    // intent === "note" (or unknown)
    return Response.json({ type: "note", annotations });
  } catch (err) {
    console.error("[canvas-comment] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
