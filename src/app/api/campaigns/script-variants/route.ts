import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import { generateText, parseJsonResponse, type ModelId } from "@/lib/llm";
import { getOffer } from "@/lib/offer-store";
import { FUNDSINDIA_LIFECYCLE_DATASET_ID, PROFILE_ONLY_SEGMENT_ID } from "@/lib/lifecycle-campaign-types";
import { listSegments } from "@/lib/server/segment-repo";
import type { Offer } from "@/lib/offer-types";
import type { Segment } from "@/lib/types";

const ExperimentTypeSchema = z.enum(["message_framing", "offer", "timing", "audience"]);

const ScriptVariantRequestSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  segmentId: z.string().min(1).max(200),
  offerId: z.string().min(1).max(120),
  campaignName: z.string().trim().min(1).max(200),
  hypothesis: z.string().trim().min(1).max(1000),
  oecMetric: z.enum(["account_activated", "kyc_completed", "bank_verified"]),
  experimentType: ExperimentTypeSchema,
});

const ScriptVariantResponseSchema = {
  type: "object",
  properties: {
    variantLogic: { type: "string" },
    scriptA: {
      type: "object",
      properties: {
        title: { type: "string" },
        strategy: { type: "string" },
        firstMessage: { type: "string" },
        scriptSummary: { type: "string" },
        systemPrompt: { type: "string" },
      },
      required: ["title", "strategy", "firstMessage", "scriptSummary", "systemPrompt"],
      additionalProperties: false,
    },
    scriptB: {
      type: "object",
      properties: {
        title: { type: "string" },
        strategy: { type: "string" },
        firstMessage: { type: "string" },
        scriptSummary: { type: "string" },
        systemPrompt: { type: "string" },
      },
      required: ["title", "strategy", "firstMessage", "scriptSummary", "systemPrompt"],
      additionalProperties: false,
    },
  },
  required: ["variantLogic", "scriptA", "scriptB"],
  additionalProperties: false,
};

interface ScriptVariant {
  title: string;
  strategy: string;
  firstMessage: string;
  scriptSummary: string;
  systemPrompt: string;
}

interface ScriptVariantResponse {
  variantLogic: string;
  scriptA: ScriptVariant;
  scriptB: ScriptVariant;
}

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || req.headers.get("x-dataset-id") || FUNDSINDIA_LIFECYCLE_DATASET_ID;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : FUNDSINDIA_LIFECYCLE_DATASET_ID;
}

function compact(value: string | undefined, max = 1200): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text.length <= max ? text : `${text.slice(0, max - 3).trim()}...`;
}

function clean(value: unknown, fallback: string, max = 3000): string {
  const text = typeof value === "string" ? value.trim() : "";
  const result = text || fallback;
  return result.length <= max ? result : `${result.slice(0, max - 3).trim()}...`;
}

function profileSegment(): Pick<Segment, "id" | "name" | "description" | "userCount" | "sql"> {
  return {
    id: PROFILE_ONLY_SEGMENT_ID,
    name: "FundsIndia KYC recovery profile",
    description: "Investors with recent fund or SIP intent who have not completed KYC, bank verification, or account activation.",
    userCount: 0,
    sql: "",
  };
}

function fallbackVariants(input: {
  segment: Pick<Segment, "name" | "description" | "userCount" | "sql">;
  offer: Offer;
  hypothesis: string;
  oecMetric: string;
}): ScriptVariantResponse {
  const baseRules = `You are a FundsIndia service caller helping investors who showed fund or SIP intent but did not complete KYC/account activation.

Audience:
- ${input.segment.name}
- ${input.segment.description || "Selected lifecycle audience"}

Offer:
- ${input.offer.name}: ${input.offer.valueProp || input.offer.tagline}

Experiment:
- Hypothesis: ${input.hypothesis}
- Primary outcome: ${input.oecMetric.replace(/_/g, " ")}

Hard rules:
- Do not promise returns, recommend a fund, mention experiment assignment, or reveal internal segmentation.
- Ask permission before continuing.
- Stop politely on opt-out, complaint, wrong number, distress, or conduct concern.
- Keep the call concise and route interested investors to the right support or advisor follow-up.`;

  return {
    variantLogic: "A tests service-led activation help. B tests recent SIP/fund intent recovery.",
    scriptA: {
      title: "Activation unblock",
      strategy: "Lead with account activation help and diagnose the missing step before mentioning the offer.",
      firstMessage: "Hi, this is Aanya calling from FundsIndia. Am I speaking with you for a quick account activation help call?",
      scriptSummary: "KYC unblock help with a calm service-led pitch.",
      systemPrompt: `${baseRules}

Variant A strategy:
- Lead with help completing KYC/account activation.
- Diagnose whether KYC, bank verification, or account activation is blocking the investor.
- Offer ${input.offer.name} only after the activation blocker is understood.
- Capture whether the investor accepts help, rejects, needs time, says wrong number, or raises a concern.`,
    },
    scriptB: {
      title: "Intent recovery",
      strategy: "Lead with the investor's recent SIP/fund exploration context and offer help continuing safely.",
      firstMessage: "Hi, this is Aanya from FundsIndia. I noticed you had started exploring mutual funds; may I help with the next activation step?",
      scriptSummary: "SIP intent recovery with a short advisory follow-up offer.",
      systemPrompt: `${baseRules}

Variant B strategy:
- Lead with recent SIP or fund exploration context.
- Reassure the investor that activation must be completed before investing.
- Offer ${input.offer.name} as a helpful follow-up path, not as investment advice.
- Capture whether the investor accepts help, rejects, needs time, says wrong number, or raises a concern.`,
    },
  };
}

function normalizeVariants(value: unknown, fallback: ScriptVariantResponse): ScriptVariantResponse {
  const source = typeof value === "object" && value !== null ? value as Partial<ScriptVariantResponse> : {};
  const normalizeVariant = (raw: unknown, base: ScriptVariant): ScriptVariant => {
    const item = typeof raw === "object" && raw !== null ? raw as Partial<ScriptVariant> : {};
    return {
      title: clean(item.title, base.title, 120),
      strategy: clean(item.strategy, base.strategy, 500),
      firstMessage: clean(item.firstMessage, base.firstMessage, 500),
      scriptSummary: clean(item.scriptSummary, base.scriptSummary, 500),
      systemPrompt: clean(item.systemPrompt, base.systemPrompt, 12_000),
    };
  };

  return {
    variantLogic: clean(source.variantLogic, fallback.variantLogic, 700),
    scriptA: normalizeVariant(source.scriptA, fallback.scriptA),
    scriptB: normalizeVariant(source.scriptB, fallback.scriptB),
  };
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ScriptVariantRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  if (datasetId !== FUNDSINDIA_LIFECYCLE_DATASET_ID) {
    return Response.json({ error: "Lifecycle script generation supports the fundsindia dataset only." }, { status: 400 });
  }

  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segment = parsed.data.segmentId === PROFILE_ONLY_SEGMENT_ID
    ? profileSegment()
    : listSegments(userId, datasetId).find((item) => item.id === parsed.data.segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const offer = getOffer(parsed.data.offerId, datasetId);
  if (!offer) return Response.json({ error: "Offer not found" }, { status: 404 });

  if (parsed.data.experimentType !== "message_framing") {
    return Response.json({ error: "AI script generation currently supports message framing experiments." }, { status: 400 });
  }

  const fallback = fallbackVariants({
    segment,
    offer,
    hypothesis: parsed.data.hypothesis,
    oecMetric: parsed.data.oecMetric,
  });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const systemPrompt = `You generate safe A/B voice script variants for a lifecycle campaign experiment.

Return JSON only. Create exactly two treatment variants.

Rules:
- The variants must test different message framing, not different compliance rules.
- Both variants must use the same selected offer.
- Variant A and B must be meaningfully different and easy for a marketer to understand.
- Keep calls service-led. Do not promise returns or give personalized investment advice.
- Do not reveal internal segment names, model scores, experiment assignment, randomization, or control/treatment language to the customer.
- Stop conditions must include opt-out, complaint, wrong number, distress, and conduct concern.
- systemPrompt must be ready to pass to a realtime voice agent.
- firstMessage must be a short opening line the agent can say verbatim.`;

  const userPrompt = JSON.stringify({
    dataset: {
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
      context: compact(dataset.systemContext, 1200),
      hints: compact(dataset.domainHints, 800),
    },
    campaign: {
      name: parsed.data.campaignName,
      hypothesis: parsed.data.hypothesis,
      oecMetric: parsed.data.oecMetric,
      experimentType: parsed.data.experimentType,
    },
    audience: {
      name: segment.name,
      description: segment.description,
      userCount: segment.userCount,
      sql: compact(segment.sql, 1000),
    },
    offer,
  });

  try {
    const raw = await generateText({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      jsonSchema: { name: "lifecycle_script_variants", schema: ScriptVariantResponseSchema, strict: true },
      modelId,
      datasetId,
      feature: "campaigns.script-variants",
      timeoutMs: 60_000,
      maxOutputTokens: 5000,
    });
    const result = parseJsonResponse<ScriptVariantResponse>(raw);
    return Response.json(normalizeVariants(result, fallback));
  } catch {
    return Response.json(fallback);
  }
}
