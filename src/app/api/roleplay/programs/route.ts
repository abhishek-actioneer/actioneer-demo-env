import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { generateRoleplayScenarios } from "@/features/roleplay/roleplay-generator";
import type { Difficulty, RoleplayLanguage, SavedScenarioBundle, TraineeRole } from "@/features/roleplay/roleplay-scenario";
import { saveScenarioBundle } from "@/features/roleplay/roleplay-scenario-store";
import {
  buildTrainingModuleFromBundle,
  getAllTrainingPrograms,
  saveTrainingProgram,
  type TrainingProgram,
} from "@/features/roleplay/roleplay-training-program-store";

export const runtime = "nodejs";
export const maxDuration = 180;

const ROLES: TraineeRole[] = ["SP", "RO"];
const DEFAULT_DIFFICULTY: Difficulty = "medium";
const DEFAULT_LANGUAGE: RoleplayLanguage = "Hinglish";
const DEFAULT_PERSONA_COUNT = 1;

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "policy";
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  return Response.json({ programs: getAllTrainingPrograms(datasetId) });
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
    return Response.json({ error: "Approved product facts are too short to build training modules." }, { status: 400 });
  }

  const productLabel = String(body.productLabel ?? "").trim() || "Policy";
  const source = String(body.source ?? "").slice(0, 500);
  const productId = slugify(productLabel);
  const now = Date.now();

  try {
    const generated = await Promise.all(
      ROLES.map((role) =>
        generateRoleplayScenarios({
          productId,
          productLabel,
          knowledgeDocId: `${productId}-doc`,
          policyFacts,
          role,
          difficulty: DEFAULT_DIFFICULTY,
          language: DEFAULT_LANGUAGE,
          personaCount: DEFAULT_PERSONA_COUNT,
          datasetId: datasetId as "absli-life",
        }),
      ),
    );

    const bundles: SavedScenarioBundle[] = generated.map((result, index) => {
      const role = ROLES[index];
      return {
        id: `${productId}-${role.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        datasetId,
        name: `${productLabel} ${role} module`,
        productId,
        productLabel,
        role,
        difficulty: DEFAULT_DIFFICULTY,
        language: DEFAULT_LANGUAGE,
        policyFacts,
        spine: result.spine,
        roleModule: result.roleModule,
        personas: result.personas,
        createdAt: now,
        updatedAt: now,
      };
    });

    bundles.forEach((bundle) => saveScenarioBundle(datasetId, bundle));

    const program: TrainingProgram = {
      id: `program-${productId}-${randomUUID().slice(0, 8)}`,
      datasetId,
      productLabel,
      source,
      policyFacts,
      modules: bundles.map(buildTrainingModuleFromBundle),
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };

    saveTrainingProgram(datasetId, program);
    return Response.json(program);
  } catch (err) {
    console.error("[roleplay/programs] generation failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not build the training program." },
      { status: 500 },
    );
  }
}
