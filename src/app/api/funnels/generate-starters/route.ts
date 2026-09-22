import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { generateFunnelsForDataset } from "@/lib/server/funnel-generator";
import { getSampleWorkspaceSeeder } from "@/lib/server/sample-workspace-registry";
import { listFunnels, deleteFunnel } from "@/lib/server/funnel-repo";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const datasetId =
    (body as { datasetId?: string }).datasetId ||
    req.headers.get("x-dataset-id") ||
    "";

  if (!datasetId) {
    return Response.json({ error: "datasetId is required" }, { status: 400 });
  }
  if (!getDatasetForUser(datasetId, userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const seeder = getSampleWorkspaceSeeder(datasetId);
    if (seeder) {
      // Clear prior auto-generated funnels so stale/LLM-generated ones (which
      // could carry unrealistic 0%/100% numbers) don't linger beside the
      // handcrafted, validated seeded set.
      for (const f of listFunnels(userId, datasetId)) {
        if (f.source === "auto") deleteFunnel(userId, f.id);
      }
      const seeded = await seeder(userId);
      return Response.json({ generated: seeded.funnels, failed: 0, total: seeded.funnels });
    }

    const dataset = getDataset(datasetId);
    if (!dataset.events || dataset.events.length < 2) {
      return Response.json(
        { error: "Dataset needs at least 2 events to generate funnels" },
        { status: 422 },
      );
    }

    const result = await generateFunnelsForDataset(userId, datasetId, dataset);

    if (result.generated === 0 && result.failed > 0) {
      return Response.json(
        { error: "All generated funnels failed validation", failed: result.failed },
        { status: 422 },
      );
    }

    return Response.json({
      generated: result.generated,
      failed: result.failed,
      total: result.generated + result.failed,
    });
  } catch (err) {
    console.error(`[funnels/generate-starters] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
