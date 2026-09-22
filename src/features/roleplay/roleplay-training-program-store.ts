import type { SavedScenarioBundle, TraineeRole } from "./roleplay-scenario";
import { readRoleplayCollection, writeRoleplayCollection } from "./roleplay-store-persistence";

export type TrainingModuleReviewStatus = "needs_review" | "approved" | "changes_requested";

export interface TrainingProgramModule {
  id: string;
  role: TraineeRole;
  title: string;
  scenarioBundleId: string;
  objective: string;
  outcomes: string[];
  callFlow: string[];
  guardrails: string[];
  mandatoryDisclosures: string[];
  customerSituations: string[];
  reviewStatus?: TrainingModuleReviewStatus;
  reviewNote?: string;
  reviewedAt?: number;
}

export interface TrainingProgram {
  id: string;
  datasetId: string;
  productLabel: string;
  source: string;
  policyFacts: string;
  modules: TrainingProgramModule[];
  status: "draft" | "ready";
  createdAt: number;
  updatedAt: number;
}

const globalStore = globalThis as typeof globalThis & {
  __roleplayTrainingProgramStores?: Map<string, Map<string, TrainingProgram>>;
  __roleplayTrainingProgramInitialized?: Set<string>;
};
const stores: Map<string, Map<string, TrainingProgram>> =
  globalStore.__roleplayTrainingProgramStores ?? (globalStore.__roleplayTrainingProgramStores = new Map());
const initialized: Set<string> =
  globalStore.__roleplayTrainingProgramInitialized ?? (globalStore.__roleplayTrainingProgramInitialized = new Set());

function getStore(datasetId: string): Map<string, TrainingProgram> {
  let store = stores.get(datasetId);
  if (!store) {
    store = new Map<string, TrainingProgram>();
    stores.set(datasetId, store);
  }

  if (!initialized.has(datasetId)) {
    const memoryPrograms = Array.from(store.values());
    for (const program of readRoleplayCollection<TrainingProgram>(datasetId, "programs")) {
      store.set(program.id, program);
    }
    for (const program of memoryPrograms) {
      store.set(program.id, program);
    }
    initialized.add(datasetId);
  }

  return store;
}

function compactText(value: string, max = 140): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}...`;
}

function compactList(values: string[], maxItems: number, maxChars = 140): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = compactText(value, maxChars);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function defaultCallFlow(role: TraineeRole): string[] {
  if (role === "RO") {
    return [
      "Reset the branch context and ask permission to continue.",
      "Clarify the customer's product-fit and return expectations.",
      "Handle objections without changing approved product facts.",
      "Close with a concrete next step.",
    ];
  }

  return [
    "Open the branch conversation and discover the customer's goal.",
    "Explain the plan in plain language.",
    "State mandatory disclosures before lead entry.",
    "Capture explicit consent and set handoff expectations.",
  ];
}

export function buildTrainingModuleFromBundle(bundle: SavedScenarioBundle): TrainingProgramModule {
  const role = bundle.role;
  const requiredCoverage = (bundle.spine.coverage ?? []).filter((item) => item.required);
  const disclosures = requiredCoverage.filter((item) => item.kind === "disclosure");
  const competencies = bundle.roleModule.rubric.filter((item) => !item.gate);
  const gates = bundle.roleModule.rubric.filter((item) => item.gate);

  const objective =
    role === "RO"
      ? "Train ROs to handle warm follow-up calls, keep the branch explanation consistent, and earn the next step."
      : "Train SPs to explain the product from scratch, discover need, and capture consent before lead entry.";

  const outcomes = compactList(
    [
      ...requiredCoverage.map((item) => item.topic),
      ...competencies.map((item) => item.label),
      ...gates.map((item) => item.label),
    ],
    5,
    110,
  );

  const callFlow = compactList(
    [
      ...defaultCallFlow(role),
      ...requiredCoverage.filter((item) => item.kind !== "disclosure").map((item) => item.topic),
    ],
    5,
    120,
  );

  const guardrails = compactList(
    bundle.spine.traps.map((trap) => `${trap.label}: ${trap.fail}`),
    3,
    150,
  );

  const mandatoryDisclosures = compactList(
    disclosures.map((item) => item.topic),
    3,
    130,
  );

  const customerSituations = compactList(
    bundle.personas.map((persona) => `${persona.name}: ${persona.openingLine}`),
    3,
    150,
  );

  return {
    id: `${role.toLowerCase()}-module`,
    role,
    title: role === "RO" ? "RO warm lead follow-up" : "SP branch-first explanation",
    scenarioBundleId: bundle.id,
    objective,
    outcomes,
    callFlow,
    guardrails,
    mandatoryDisclosures,
    customerSituations,
    reviewStatus: "needs_review",
  };
}

export function saveTrainingProgram(datasetId: string, program: TrainingProgram): void {
  const store = getStore(datasetId);
  store.set(program.id, program);
  writeRoleplayCollection(datasetId, "programs", Array.from(store.values()));
}

export function getTrainingProgram(datasetId: string, id: string): TrainingProgram | undefined {
  return getStore(datasetId).get(id);
}

export function getAllTrainingPrograms(datasetId: string): TrainingProgram[] {
  return Array.from(getStore(datasetId).values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
