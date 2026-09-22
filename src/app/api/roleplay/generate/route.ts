import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { generateRoleplayScenarios } from "@/features/roleplay/roleplay-generator";
import type { Difficulty, RoleplayLanguage, TraineeRole } from "@/features/roleplay/roleplay-scenario";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function slugify(label: string): string {
  return (
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "policy"
  );
}

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

  const policyFacts = String(body.policyFacts ?? "").trim();
  if (policyFacts.length < 40) {
    return Response.json(
      { error: "Provide the policy text / document (at least a short paragraph of facts)." },
      { status: 400 },
    );
  }

  const productLabel = String(body.productLabel ?? "").trim() || "Policy";
  const role: TraineeRole = body.role === "RO" ? "RO" : "SP";
  const difficulty: Difficulty = DIFFICULTIES.includes(body.difficulty as Difficulty)
    ? (body.difficulty as Difficulty)
    : "medium";
  const language = (String(body.language ?? "Hinglish") || "Hinglish") as RoleplayLanguage;
  const personaCount = Math.min(Math.max(Number(body.personaCount) || 2, 1), 4);
  const productId = slugify(productLabel);

  try {
    const result = await generateRoleplayScenarios({
      productId,
      productLabel,
      knowledgeDocId: `${productId}-doc`,
      policyFacts,
      role,
      difficulty,
      language,
      personaCount,
      datasetId: datasetId as "absli-life",
    });
    return Response.json(result);
  } catch (err) {
    console.error("[roleplay/generate] failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 },
    );
  }
}
