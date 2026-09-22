import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import {
  deleteScenarioBundle,
  getScenarioBundle,
  saveScenarioBundle,
} from "@/features/roleplay/roleplay-scenario-store";
import { coerceBundleInput } from "../coerce";

async function gate(req: Request) {
  const { userId } = await auth();
  if (!userId) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return { error: Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 }) };
  }
  return { datasetId };
}

/** GET /api/roleplay/scenarios/[id] */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const { id } = await params;
  const bundle = getScenarioBundle(g.datasetId, id);
  if (!bundle) return Response.json({ error: "Scenario not found" }, { status: 404 });
  return Response.json(bundle);
}

/** PUT /api/roleplay/scenarios/[id] — update an existing bundle (create-on-miss). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = coerceBundleInput(body);
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });

  const existing = getScenarioBundle(g.datasetId, id);
  const now = Date.now();
  const bundle = {
    id,
    datasetId: g.datasetId,
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  saveScenarioBundle(g.datasetId, bundle);
  return Response.json(bundle);
}

/** DELETE /api/roleplay/scenarios/[id] */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const { id } = await params;
  deleteScenarioBundle(g.datasetId, id);
  return Response.json({ ok: true });
}
