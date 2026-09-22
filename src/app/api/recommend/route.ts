import { auth } from "@clerk/nextjs/server";
import { generateRecommendations } from "@/lib/action-recommender";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import type { ModelId } from "@/lib/llm";
import { z } from "zod/v4";

const RecommendSchema = z.object({
  query: z.string().min(1),
  responseText: z.string(),
  mode: z.enum(["quick", "deep", "direct"]),
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
    const datasetId = req.headers.get("x-dataset-id") ?? DEFAULT_DATASET;
    const ds = getDatasetForUser(datasetId, userId);
    if (!ds) return Response.json({ error: "Not found" }, { status: 404 });
    const parsed = RecommendSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ actions: [] });
    }
    const { query, responseText, mode } = parsed.data;

    const recommendations = await generateRecommendations({
      userQuery: query,
      responseText: responseText || "",
      mode: mode || "direct",
      modelId,
      domain: ds.label,
    });

    return Response.json(recommendations);
  } catch (err) {
    console.error("[/api/recommend] error:", err);
    return Response.json({ actions: [] });
  }
}
