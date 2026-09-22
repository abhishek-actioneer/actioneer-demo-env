import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import { listAllActivity, type SegmentActivity } from "@/lib/server/segment-activity-repo";
import { getSegment, listSegments } from "@/lib/server/segment-repo";
import { getOffer } from "@/lib/offer-store";
import {
  defaultFundsIndiaKycRecoveryArms,
  FUNDSINDIA_CAMPAIGN_AS_OF_DATE,
  FUNDSINDIA_KYC_RECOVERY_CONTACT_POLICY,
  FUNDSINDIA_KYC_RECOVERY_GUARDRAILS,
  lifecycleSegmentLabel,
} from "@/lib/lifecycle/profiles/fundsindia-kyc-recovery";
import {
  lifecycleId,
  listLifecycleCampaigns,
  upsertLifecycleCampaignBundle,
} from "@/lib/server/lifecycle-campaign-repo";
import {
  FUNDSINDIA_KYC_RECOVERY_PROFILE_ID,
  FUNDSINDIA_LIFECYCLE_DATASET_ID,
  PROFILE_ONLY_SEGMENT_ID,
  type CampaignExperiment,
  type ExperimentArm,
  type LifecycleCampaign,
  type LifecycleCampaignListItem,
  type OecMetric,
} from "@/lib/lifecycle-campaign-types";

export interface CampaignListItem extends SegmentActivity {
  segmentName?: string;
}

export interface CampaignsResponse {
  items: LifecycleCampaignListItem[];
  legacyItems: CampaignListItem[];
}

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || req.headers.get("x-dataset-id") || FUNDSINDIA_LIFECYCLE_DATASET_ID;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : FUNDSINDIA_LIFECYCLE_DATASET_ID;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "arm";
}

const ArmSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  type: z.enum(["control", "treatment"]),
  name: z.string().trim().min(1).max(120),
  allocationPct: z.number().min(0).max(100),
  scriptVariantId: z.string().trim().max(120).optional(),
  systemPrompt: z.string().trim().max(20_000).optional(),
  firstMessage: z.string().trim().max(800).optional(),
  scriptSummary: z.string().trim().max(1000).optional(),
  voice: z.string().trim().max(120).optional(),
  voiceName: z.string().trim().max(120).optional(),
  language: z.string().trim().max(80).optional(),
});

const CreateCampaignSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200),
  segmentId: z.string().trim().max(200).optional(),
  offerId: z.string().trim().min(1).max(120).default("FI_SIP_STARTER"),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(FUNDSINDIA_CAMPAIGN_AS_OF_DATE),
  attributionWindowDays: z.number().int().min(1).max(90).default(21),
  hypothesis: z.string().trim().min(1).max(1000),
  oecMetric: z.enum(["account_activated", "kyc_completed", "bank_verified"]).default("account_activated"),
  guardrailMetrics: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  arms: z.array(ArmSchema).min(2).max(6).optional(),
});

function buildArms(experimentId: string, rawArms?: z.infer<typeof ArmSchema>[]): ExperimentArm[] {
  if (!rawArms?.length) return defaultFundsIndiaKycRecoveryArms(experimentId);
  return rawArms.map((arm) => ({
    id: arm.id ?? `${experimentId}_${slug(arm.name)}`,
    experimentId,
    type: arm.type,
    name: arm.name,
    allocationPct: arm.allocationPct,
    scriptVariantId: arm.scriptVariantId ?? slug(arm.name),
    voiceConfig: arm.type === "treatment"
      ? {
          provider: "plivo-gemini",
          voice: arm.voice || "Aoede",
          voiceName: arm.voiceName || "Aanya",
          language: arm.language || "English",
        }
      : undefined,
    metadata: arm.type === "treatment"
      ? {
          systemPrompt: arm.systemPrompt,
          firstMessage: arm.firstMessage,
          scriptSummary: arm.scriptSummary,
        }
      : undefined,
  }));
}

export async function GET(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = datasetIdFromRequest(req);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segments = listSegments(userId, datasetId);
  const segmentNameById = new Map(segments.map((segment) => [segment.id, segment.name]));
  const items = listLifecycleCampaigns(userId, datasetId).map((item) => ({
    ...item,
    segmentName: lifecycleSegmentLabel(item.segmentId, segmentNameById.get(item.segmentId)),
    offerName: getOffer(item.offerId, datasetId)?.name,
  }));

  const all = listAllActivity(userId, 500);
  const campaigns = all.filter((activity) => activity.type === "campaign");
  const uniqueSegmentIds = Array.from(new Set(campaigns.map((campaign) => campaign.segmentId)));
  const legacyNameById = new Map<string, string>();
  for (const id of uniqueSegmentIds) {
    const segment = getSegment(userId, id);
    if (segment) legacyNameById.set(id, segment.name);
  }
  const legacyItems: CampaignListItem[] = campaigns.map((campaign) => ({
    ...campaign,
    segmentName: legacyNameById.get(campaign.segmentId),
  }));

  return Response.json({ items, legacyItems } satisfies CampaignsResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  if (datasetId !== FUNDSINDIA_LIFECYCLE_DATASET_ID) {
    return Response.json({ error: "Lifecycle campaign V1 supports the fundsindia dataset only." }, { status: 400 });
  }
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segmentId = parsed.data.segmentId?.trim() || PROFILE_ONLY_SEGMENT_ID;
  if (segmentId !== PROFILE_ONLY_SEGMENT_ID && !listSegments(userId, datasetId).some((segment) => segment.id === segmentId)) {
    return Response.json({ error: "Segment not found" }, { status: 404 });
  }
  if (!getOffer(parsed.data.offerId, datasetId)) {
    return Response.json({ error: "Offer not found" }, { status: 404 });
  }

  const current = new Date().toISOString();
  const campaignId = lifecycleId("lc");
  const experimentId = lifecycleId("exp");
  const campaign: LifecycleCampaign = {
    id: campaignId,
    userId,
    datasetId,
    name: parsed.data.name,
    status: "draft",
    lifecycleProfileId: FUNDSINDIA_KYC_RECOVERY_PROFILE_ID,
    segmentId,
    offerId: parsed.data.offerId,
    asOfDate: parsed.data.asOfDate,
    attributionWindowDays: parsed.data.attributionWindowDays,
    contactPolicy: FUNDSINDIA_KYC_RECOVERY_CONTACT_POLICY,
    createdAt: current,
    updatedAt: current,
  };
  const experiment: CampaignExperiment = {
    id: experimentId,
    campaignId,
    hypothesis: parsed.data.hypothesis,
    oecMetric: parsed.data.oecMetric as OecMetric,
    guardrailMetrics: parsed.data.guardrailMetrics ?? FUNDSINDIA_KYC_RECOVERY_GUARDRAILS,
    randomizationUnit: "investor_id",
    salt: randomSalt(),
    status: "draft",
    createdAt: current,
    updatedAt: current,
  };
  const arms = buildArms(experimentId, parsed.data.arms);
  const allocation = arms.reduce((sum, arm) => sum + arm.allocationPct, 0);
  if (allocation <= 0) return Response.json({ error: "Arm allocation must be positive." }, { status: 400 });
  if (!arms.some((arm) => arm.type === "control")) {
    return Response.json({ error: "At least one control arm is required." }, { status: 400 });
  }
  if (!arms.some((arm) => arm.type === "treatment")) {
    return Response.json({ error: "At least one treatment arm is required." }, { status: 400 });
  }

  const bundle = upsertLifecycleCampaignBundle({ campaign, experiment, arms });
  return Response.json({ id: campaign.id, bundle }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

function randomSalt(): string {
  return lifecycleId("salt");
}
