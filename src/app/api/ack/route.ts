import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const AckSchema = z.object({
  query: z.string().min(1),
  datasetId: z.string().optional(),
});

function fallback(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("revenue") || q.includes("sales")) return "I'll analyze your revenue data across daily trends, customer segments, and geographic patterns.";
  if (q.includes("retention") || q.includes("churn")) return "I'll examine retention and churn patterns across cohorts, segments, and time periods.";
  if (q.includes("user") || q.includes("customer")) return "I'll look into user behavior across segments, retention cohorts, and engagement patterns.";
  return "I'll run a deep analysis across multiple dimensions including trends, segments, and key metrics.";
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = AckSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query, datasetId: bodyDatasetId } = parsed.data;
  const headerDatasetId = req.headers.get("x-dataset-id");
  const datasetId = bodyDatasetId || headerDatasetId || DEFAULT_DATASET;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const ds = getDatasetForUser(datasetId, userId);
  if (!ds) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const text = await generateText(
      `You are an analytics assistant about to run a deep research analysis. The user asked:\n"${query}"\n\nThe dataset is: ${ds.label}.\n\nWrite a 1-2 sentence acknowledgment of what you will do. Be specific to their question — mention the actual analysis dimensions you'll explore. Do NOT use bullet points or markdown. Keep it natural and concise. Example: "I'll analyze your revenue data across daily trends, customer segments, and geographic patterns to identify the key drivers and opportunities."`,
      { modelId, timeoutMs: 10000, label: "ack" },
    );

    const cleaned = text.replace(/^["']|["']$/g, "").trim();
    return Response.json({ text: cleaned || fallback(query) });
  } catch {
    return Response.json({ text: fallback(query) });
  }
}
