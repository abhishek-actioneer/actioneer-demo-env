import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import {
  getTrainingProgram,
  saveTrainingProgram,
  type TrainingProgram,
  type TrainingProgramModule,
  type TrainingModuleReviewStatus,
} from "@/features/roleplay/roleplay-training-program-store";

export const runtime = "nodejs";

async function gate(req: Request, id: string) {
  const { userId } = await auth();
  if (!userId) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return { error: Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 }) };
  }

  const program = getTrainingProgram(datasetId, id);
  if (!program) return { error: Response.json({ error: "Training program not found" }, { status: 404 }) };

  return { datasetId, program };
}

function coerceStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function coerceReviewStatus(value: unknown, fallback: TrainingProgramModule["reviewStatus"]): TrainingModuleReviewStatus {
  if (value === "approved" || value === "changes_requested" || value === "needs_review") return value;
  return fallback ?? "needs_review";
}

function coerceTimestamp(value: unknown, fallback: number | undefined): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function coerceModule(value: unknown, fallback: TrainingProgramModule): TrainingProgramModule {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...fallback,
    title: String(body.title ?? fallback.title).trim() || fallback.title,
    objective: String(body.objective ?? fallback.objective).trim() || fallback.objective,
    outcomes: coerceStringArray(body.outcomes, fallback.outcomes),
    callFlow: coerceStringArray(body.callFlow, fallback.callFlow),
    guardrails: coerceStringArray(body.guardrails, fallback.guardrails),
    mandatoryDisclosures: coerceStringArray(body.mandatoryDisclosures, fallback.mandatoryDisclosures),
    customerSituations: coerceStringArray(body.customerSituations, fallback.customerSituations),
    reviewStatus: coerceReviewStatus(body.reviewStatus, fallback.reviewStatus),
    reviewNote: String(body.reviewNote ?? fallback.reviewNote ?? "").slice(0, 2000),
    reviewedAt: coerceTimestamp(body.reviewedAt, fallback.reviewedAt),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id);
  if ("error" in g) return g.error;

  return Response.json(g.program);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id);
  if ("error" in g) return g.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incomingModules = Array.isArray(body.modules) ? body.modules : [];
  const modules = g.program.modules.map((module) => {
    const input = incomingModules.find((item) => {
      return item && typeof item === "object" && (item as { id?: unknown }).id === module.id;
    });
    return coerceModule(input, module);
  });

  const nextProgram: TrainingProgram = {
    ...g.program,
    productLabel: String(body.productLabel ?? g.program.productLabel).trim() || g.program.productLabel,
    source: String(body.source ?? g.program.source).slice(0, 500),
    policyFacts: String(body.policyFacts ?? g.program.policyFacts),
    status: body.status === "draft" ? "draft" : g.program.status,
    modules,
    updatedAt: Date.now(),
  };

  saveTrainingProgram(g.datasetId, nextProgram);
  return Response.json(nextProgram);
}
