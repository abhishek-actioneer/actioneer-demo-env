import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import {
  getAllScenarioBundles,
  saveScenarioBundle,
} from "@/features/roleplay/roleplay-scenario-store";
import { coerceBundleInput } from "./coerce";

/** GET /api/roleplay/scenarios — list saved bundles for the active dataset. */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  return Response.json({ scenarios: getAllScenarioBundles(datasetId) });
}

/** POST /api/roleplay/scenarios — create a new saved bundle. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = coerceBundleInput(body);
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });

  const now = Date.now();
  const id = `${input.productId}-${input.role.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const bundle = { id, datasetId, ...input, createdAt: now, updatedAt: now };

  saveScenarioBundle(datasetId, bundle);
  return Response.json(bundle);
}
