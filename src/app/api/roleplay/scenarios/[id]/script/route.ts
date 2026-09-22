import { auth } from "@clerk/nextjs/server";
import { generateText } from "@/lib/llm";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { getScenarioBundle } from "@/features/roleplay/roleplay-scenario-store";
import { getCallScript, saveCallScript } from "@/features/roleplay/roleplay-call-script-store";
import { buildCallScriptPrompt, type TrainingCallScript } from "@/features/roleplay/roleplay-call-script";
import { geminiVoiceGender } from "@/lib/gemini-voices";

export const runtime = "nodejs";
export const maxDuration = 120;

async function gate(req: Request) {
  const { userId } = await auth();
  if (!userId) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return { error: Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 }) };
  }
  return { datasetId };
}

/** GET /api/roleplay/scenarios/[id]/script — the saved training call script, or null. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const { id } = await params;
  return Response.json({ script: getCallScript(g.datasetId, id) ?? null });
}

/** POST /api/roleplay/scenarios/[id]/script — (re)generate the script from everything (+ optional brief). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const { id } = await params;

  const bundle = getScenarioBundle(g.datasetId, id);
  if (!bundle) return Response.json({ error: "Scenario not found. Save the scenario first." }, { status: 404 });

  let brief = "";
  let voice = "";
  try {
    const body = (await req.json()) as { brief?: unknown; voice?: unknown };
    if (typeof body.brief === "string") brief = body.brief;
    if (typeof body.voice === "string") voice = body.voice;
  } catch {
    /* no body / no brief is fine */
  }

  const { system, user } = buildCallScriptPrompt(bundle, brief, geminiVoiceGender(voice));

  let text: string;
  try {
    text = await generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      feature: "roleplay.generate-call-script",
      label: "training call script generation",
      timeoutMs: 120_000,
      datasetId: g.datasetId,
    });
  } catch (err) {
    console.error("[roleplay/scenarios/script] generation failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not generate the call script." },
      { status: 502 },
    );
  }

  const script: TrainingCallScript = {
    scenarioBundleId: bundle.id,
    datasetId: g.datasetId,
    role: bundle.role,
    language: bundle.language,
    script: text.trim().replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    generatedAt: Date.now(),
  };
  saveCallScript(g.datasetId, script);
  return Response.json({ script });
}

/** PUT /api/roleplay/scenarios/[id]/script — persist a trainer-edited script (no LLM). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const { id } = await params;

  const bundle = getScenarioBundle(g.datasetId, id);
  if (!bundle) return Response.json({ error: "Scenario not found." }, { status: 404 });

  let body: { script?: unknown };
  try {
    body = (await req.json()) as { script?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.script === "string" ? body.script : "";

  const script: TrainingCallScript = {
    scenarioBundleId: bundle.id,
    datasetId: g.datasetId,
    role: bundle.role,
    language: bundle.language,
    script: text,
    generatedAt: Date.now(),
  };
  saveCallScript(g.datasetId, script);
  return Response.json({ script });
}
