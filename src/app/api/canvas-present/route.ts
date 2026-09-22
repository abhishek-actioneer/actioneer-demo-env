import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";

// ── Request schema ──

const InputCardSchema = z.object({
  type: z.string(),
  title: z.string(),
  sql: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  markdownContent: z.string().optional(),
  reportMarkdown: z.string().optional(),
});

const InputFrameSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
});

const InputConnectionSchema = z.object({
  fromCardId: z.string(),
  toCardId: z.string(),
});

const PresentRequestSchema = z.object({
  boardId: z.string().min(1),
  cards: z.array(InputCardSchema),
  frames: z.array(InputFrameSchema),
  connections: z.array(InputConnectionSchema),
});

// ── Response schema (validated) ──

const PresentCardSchema = z.object({
  type: z.string(),
  title: z.string(),
  markdownContent: z.string().optional(),
  sql: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
});

const PresentSectionSchema = z.object({
  frameTitle: z.string(),
  frameDescription: z.string().optional(),
  cards: z.array(PresentCardSchema),
});

const PresentResponseSchema = z.object({
  sections: z.array(PresentSectionSchema).min(1),
});

// ── Prompt builder ──

function buildPrompt(
  cards: z.infer<typeof InputCardSchema>[],
  frames: z.infer<typeof InputFrameSchema>[],
  connections: z.infer<typeof InputConnectionSchema>[]
): string {
  // Summarize the board content for the prompt
  const cardSummaries = cards
    .map((c, i) => {
      const parts = [`[${i}] type=${c.type} title="${c.title}"`];
      if (c.markdownContent) parts.push(`content="${c.markdownContent.slice(0, 200)}"`);
      if (c.reportMarkdown) parts.push(`report="${c.reportMarkdown.slice(0, 300)}"`);
      if (c.sql) parts.push(`sql="${c.sql.slice(0, 150)}"`);
      if (c.data && c.data.length > 0) {
        parts.push(`data_rows=${c.data.length} sample=${JSON.stringify(c.data[0]).slice(0, 120)}`);
      }
      return parts.join(" ");
    })
    .join("\n");

  const frameSummaries = frames
    .map((f) => `frame="${f.title}"${f.description ? ` desc="${f.description}"` : ""}`)
    .join("\n");

  const connectionSummary =
    connections.length > 0
      ? `${connections.length} connections between cards`
      : "no explicit connections";

  return `You are a data storytelling expert converting a messy investigation canvas into a clean presentation.

## Input board contents

### Cards (${cards.length} total)
${cardSummaries || "(no cards)"}

### Frames (${frames.length} total)
${frameSummaries || "(no frames)"}

### Connections
${connectionSummary}

## Your task

Transform these cards into a compelling narrative presentation. Follow these steps:

1. **Filter noise**: Skip cards that are empty stickies, SQL cards with no results, or placeholder text cards.
2. **Select key evidence**: Keep charts, tables, report cards, and text cards with real content.
3. **Order narratively**: Arrange evidence to tell a logical story — not chronologically but narratively (problem → finding → root cause → recommendation).
4. **Add connecting text**: Generate short text cards (type="text") to bridge sections and explain transitions.
5. **Create sections**: Group cards into 3-5 sections with clear narrative frame titles.

Frame titles must follow this narrative arc (adapt as needed for the content):
- "The Problem" or "Context" — what prompted the investigation
- "What We Found" or "Key Evidence" — data findings
- "Root Cause" or "Analysis" — deeper explanation (if enough evidence exists)
- "Recommendations" or "Next Steps" — actionable conclusions

Rules:
- Each section must have at least 1 card
- Connecting text cards you generate should be concise (1-3 sentences) and written in present tense
- Preserve original card titles; only create new titles for generated connector cards
- Include sql and data fields on cards that have them (they will be rendered visually)
- Return 3-5 sections total
- Return ONLY valid JSON, no explanation or markdown fences

Respond with:
{
  "sections": [
    {
      "frameTitle": "<narrative section title>",
      "frameDescription": "<optional 1-sentence description>",
      "cards": [
        {
          "type": "<card type>",
          "title": "<card title>",
          "markdownContent": "<optional markdown>",
          "sql": "<optional sql>",
          "data": [<optional data rows>]
        }
      ]
    }
  ]
}`;
}

// ── Route handler ──

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = PresentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const { cards, frames, connections } = parsed.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const prompt = buildPrompt(cards, frames, connections);

  try {
    const raw = await generateText(prompt, {
      modelId,
      timeoutMs: 30_000,
      label: "canvas-present",
      jsonMode: true,
    });

    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      return Response.json(
        { error: "LLM returned invalid JSON" },
        { status: 502 }
      );
    }

    const validated = PresentResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
      console.error("[canvas-present] schema mismatch:", validated.error.message);
      // Return partial result rather than failing
      const data = parsedJson as Record<string, unknown>;
      return Response.json({
        sections: (data.sections as unknown[]) ?? [],
      });
    }

    return Response.json(validated.data);
  } catch (err) {
    console.error("[canvas-present] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
