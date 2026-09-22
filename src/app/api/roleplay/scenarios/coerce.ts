/**
 * Shared request-body coercion for the scenario-bundle routes.
 * Normalises an untrusted JSON body (from the trainer editor) into the editable
 * slice of a `SavedScenarioBundle` — everything except id/datasetId/timestamps,
 * which the routes own. Trusts the nested spine/roleModule/persona shapes (they
 * originate from our own generator + typed editor) but enforces the scalars and
 * guarantees arrays exist so the store never holds a half-formed bundle.
 */

import type {
  Difficulty,
  Persona,
  RoleModule,
  RoleplayLanguage,
  ScenarioSpine,
  TraineeRole,
} from "@/features/roleplay/roleplay-scenario";

export interface BundleInput {
  name: string;
  productId: string;
  productLabel: string;
  role: TraineeRole;
  difficulty: Difficulty;
  language: RoleplayLanguage;
  policyFacts: string;
  spine: ScenarioSpine;
  roleModule: RoleModule;
  personas: Persona[];
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "policy";
}

export function coerceBundleInput(body: Record<string, unknown>): BundleInput | { error: string } {
  const spine = body.spine as ScenarioSpine | undefined;
  const roleModule = body.roleModule as RoleModule | undefined;
  const personas = body.personas as Persona[] | undefined;

  if (!spine || typeof spine !== "object" || !Array.isArray(spine.traps)) {
    return { error: "Missing or invalid spine." };
  }
  if (!roleModule || typeof roleModule !== "object" || !Array.isArray(roleModule.rubric)) {
    return { error: "Missing or invalid roleModule." };
  }
  if (!Array.isArray(personas) || personas.length === 0) {
    return { error: "At least one persona is required." };
  }

  const productLabel = String(body.productLabel ?? "").trim() || "Policy";
  const role: TraineeRole = body.role === "RO" ? "RO" : "SP";
  const difficulty: Difficulty = DIFFICULTIES.includes(body.difficulty as Difficulty)
    ? (body.difficulty as Difficulty)
    : "medium";

  return {
    name: String(body.name ?? "").trim() || productLabel,
    productId: String(body.productId ?? "").trim() || slugify(productLabel),
    productLabel,
    role,
    difficulty,
    language: (String(body.language ?? "Hinglish") || "Hinglish") as RoleplayLanguage,
    policyFacts: String(body.policyFacts ?? ""),
    spine,
    roleModule: { ...roleModule, role },
    personas: personas.map((p) => ({ ...p, role })),
  };
}
