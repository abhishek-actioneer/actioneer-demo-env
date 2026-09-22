import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getActivity, type SegmentActivity } from "@/lib/server/segment-activity-repo";
import { getSegment } from "@/lib/server/segment-repo";
import { getCleverTapConnection } from "@/lib/integrations/connections";
import { fetchCampaignResult, type CampaignStats } from "@/lib/integrations/clevertap";
import { getCampaignStats, type CampaignStatsLocal } from "@/lib/server/email-event-repo";
import { getOffer } from "@/lib/offer-store";
import {
  getLifecycleCampaignBundle,
  upsertLifecycleCampaignBundle,
} from "@/lib/server/lifecycle-campaign-repo";
import { campaignRunSummary, campaignResults } from "@/lib/server/lifecycle-campaign-service";
import { lifecycleSegmentLabel } from "@/lib/lifecycle/profiles/fundsindia-kyc-recovery";
import type {
  CampaignResults,
  CampaignRunSummary,
  LifecycleCampaignBundle,
} from "@/lib/lifecycle-campaign-types";

export interface LegacyCampaignDetail extends SegmentActivity {
  kind: "legacy";
  segmentName?: string;
  stats?: CampaignStats;
  localStats?: CampaignStatsLocal;
}

export interface LifecycleCampaignDetail {
  kind: "lifecycle";
  bundle: LifecycleCampaignBundle;
  segmentName?: string;
  offerName?: string;
  run: CampaignRunSummary;
  results: CampaignResults;
}

export type CampaignDetail = LegacyCampaignDetail | LifecycleCampaignDetail;

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["draft", "enrolling", "running", "completed", "stopped"]).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const lifecycle = getLifecycleCampaignBundle(userId, id);
  if (lifecycle) {
    const segment = lifecycle.campaign.segmentId.startsWith("profile:")
      ? undefined
      : getSegment(userId, lifecycle.campaign.segmentId);
    const detail: LifecycleCampaignDetail = {
      kind: "lifecycle",
      bundle: lifecycle,
      segmentName: lifecycleSegmentLabel(lifecycle.campaign.segmentId, segment?.name),
      offerName: getOffer(lifecycle.campaign.offerId, lifecycle.campaign.datasetId)?.name,
      run: campaignRunSummary(userId, id),
      results: await campaignResults(userId, id),
    };
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  }

  const activity = getActivity(userId, id);
  if (!activity) return Response.json({ error: "Not found" }, { status: 404 });

  const segment = getSegment(userId, activity.segmentId);
  let stats: CampaignStats | undefined;
  if (activity.campaignId) {
    const conn = await getCleverTapConnection(userId);
    if (conn) stats = await fetchCampaignResult(conn, activity.campaignId);
  }
  const detail: LegacyCampaignDetail = {
    kind: "legacy",
    ...activity,
    segmentName: segment?.name,
    stats,
    localStats: getCampaignStats(activity.id),
  };
  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const bundle = getLifecycleCampaignBundle(userId, id);
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const updated = {
    ...bundle.campaign,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    updatedAt: new Date().toISOString(),
  };
  const next = upsertLifecycleCampaignBundle({
    campaign: updated,
    experiment: bundle.experiment,
    arms: bundle.arms,
  });

  return Response.json({ kind: "lifecycle", bundle: next }, {
    headers: { "Cache-Control": "no-store" },
  });
}
