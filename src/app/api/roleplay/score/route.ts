import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { scoreRoleplay, type TranscriptTurn } from "@/features/roleplay/roleplay-scorer";
import type { RoleplayScenario } from "@/features/roleplay/roleplay-scenario";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json(
      { error: "Roleplay training is not available for this dataset" },
      { status: 403 },
    );
  }

  let body: { scenario?: RoleplayScenario; transcript?: TranscriptTurn[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const scenario = body.scenario;
  if (!scenario?.spine || !scenario.roleModule || !scenario.persona) {
    return Response.json({ error: "Missing or malformed scenario." }, { status: 400 });
  }

  const transcript = (body.transcript ?? []).filter(
    (t): t is TranscriptTurn =>
      !!t && (t.speaker === "trainee" || t.speaker === "customer") && typeof t.text === "string" && t.text.trim().length > 0,
  );
  const traineeTurns = transcript.filter((t) => t.speaker === "trainee").length;
  if (transcript.length < 2 || traineeTurns < 1) {
    return Response.json(
      { error: "Not enough conversation to score. Run a longer assessment call first." },
      { status: 400 },
    );
  }

  try {
    const scorecard = await scoreRoleplay(scenario, transcript);
    return Response.json(scorecard);
  } catch (err) {
    console.error("[roleplay/score] failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Scoring failed" },
      { status: 500 },
    );
  }
}
