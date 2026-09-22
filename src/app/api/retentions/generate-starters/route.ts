import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { generateRetentionsForDataset } from "@/lib/server/retention-generator";
import { getSampleWorkspaceSeeder } from "@/lib/server/sample-workspace-registry";
import { listRetentions, deleteRetention } from "@/lib/server/retention-repo";

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
      // Clear prior auto-generated retentions so stale/LLM-generated ones don't
      // linger beside the handcrafted, validated seeded set.
      for (const r of listRetentions(userId, datasetId)) {
        if (r.source === "auto") deleteRetention(userId, r.id);
      }
      const seeded = await seeder(userId);
      return Response.json({ generated: seeded.retentions, failed: 0, total: seeded.retentions });
    }

    const dataset = getDataset(datasetId);
    if (!dataset.events || dataset.events.length < 1) {
      return Response.json(
        { error: "Dataset needs at least 1 event to generate retentions" },
        { status: 422 },
      );
    }

    const result = await generateRetentionsForDataset(userId, datasetId, dataset);

    if (result.generated === 0 && result.failed > 0) {
      return Response.json(
        { error: "All generated retentions failed validation", failed: result.failed },
        { status: 422 },
      );
    }

    return Response.json({
      generated: result.generated,
      failed: result.failed,
      total: result.generated + result.failed,
    });
  } catch (err) {
    console.error(`[retentions/generate-starters] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
