import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import { discoverWebsitePages } from "@/lib/server/knowledge-website-crawler";

export const maxDuration = 120;

const BodySchema = z.object({
  url: z.string().min(1).max(2_048),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!datasetId) return Response.json({ error: "x-dataset-id header required" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "A valid website URL is required" }, { status: 400 });

  try {
    const result = await discoverWebsitePages(parsed.data.url, parsed.data.limit);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website discovery failed.";
    console.error("[knowledge/discover-url] Discovery failed:", error);
    return Response.json({ error: message }, { status: 502 });
  }
}
