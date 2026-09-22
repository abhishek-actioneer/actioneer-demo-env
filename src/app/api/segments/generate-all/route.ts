import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { loadSchemaMap } from "@/lib/datasets/schema-loader";
import { generateSegmentsForDataset } from "@/lib/server/segment-generator";
import { getSampleWorkspaceSeeder } from "@/lib/server/sample-workspace-registry";
import { z } from "zod/v4";

const BodySchema = z.object({ datasetId: z.string().min(1) });

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const datasetId =
    (BodySchema.safeParse(body).data?.datasetId) ||
    req.headers.get("x-dataset-id") ||
    "";

  if (!datasetId) {
    return Response.json({ error: "datasetId is required" }, { status: 400 });
  }
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const seeder = getSampleWorkspaceSeeder(datasetId);
    if (seeder) {
      const seeded = await seeder(userId);
      return Response.json({ generated: seeded.segments, failed: 0, total: seeded.segments });
    }

    const ds = getDataset(datasetId);
    const schemaMap = loadSchemaMap(datasetId);
    if (!schemaMap) {
      return Response.json(
        { error: "No schema data available. Enrich the dataset first." },
        { status: 404 },
      );
    }

    // userIdField from dataset config or schema map — optional, segments work without it
    const userIdField = ds.userIdField || schemaMap.userIdField;

    const result = await generateSegmentsForDataset(userId, datasetId, schemaMap, userIdField, ds.label);

    if (result.generated === 0 && result.failed > 0) {
      return Response.json(
        { error: "All generated segments failed SQL validation", failed: result.failed },
        { status: 422 },
      );
    }

    return Response.json({ generated: result.generated, failed: result.failed, total: result.generated + result.failed });
  } catch (err) {
    console.error(`[segments/generate-all] Error for ${datasetId}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
