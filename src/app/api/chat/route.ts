import { auth } from "@clerk/nextjs/server";
import { generateTextStream, type ModelId } from "@/lib/llm";
import { getSystemContext } from "@/lib/schema";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const ChatSchema = z.object({
  query: z.string().min(1).max(8000),
  datasetId: z.string().optional(),
  knowledgeContext: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = ChatSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query, datasetId: bodyDatasetId, knowledgeContext: clientKnowledgeCtx } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const knowledgeContext = clientKnowledgeCtx || "";
  const systemCtx = getSystemContext(datasetId);

  const systemPromptText = systemCtx + knowledgeContext + `

Keep the response conversational and concise. Use proper markdown formatting:
- Use ## or ### for section headings (each on its own line)
- Use bullet points (* or -) for lists (each on its own line)
- Use **bold** for key numbers and metric names
- Use blank lines between paragraphs and before/after headings
- Keep paragraphs short (2-3 sentences max)
If the user asks what you can do, explain that you can analyze data including trends, retention, segmentation, revenue analysis, operational metrics, and more.`;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await generateTextStream(query, { modelId, systemPrompt: systemPromptText });
        for await (const text of stream) {
          controller.enqueue(new TextEncoder().encode(text));
        }
      } catch (err) {
        console.error("LLM stream error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
