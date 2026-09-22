import { auth } from "@clerk/nextjs/server";
import { getDatasetForUser } from "@/lib/datasets";
import { getSampleWorkspaceSeeder } from "@/lib/server/sample-workspace-registry";

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

  const seeder = getSampleWorkspaceSeeder(datasetId);
  if (!seeder) {
    return Response.json({ ok: true, datasetId, skipped: true });
  }

  try {
    const seeded = await seeder(userId);
    return Response.json({ ok: true, datasetId, seeded });
  } catch (err) {
    console.error(`[sample-workspace/setup] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Setup failed: ${message}` }, { status: 500 });
  }
}
