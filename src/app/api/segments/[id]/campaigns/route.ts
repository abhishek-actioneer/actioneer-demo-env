import { auth } from "@clerk/nextjs/server";
import { getSegment } from "@/lib/server/segment-repo";
import { listActivity, type SegmentActivity } from "@/lib/server/segment-activity-repo";
import { getCleverTapConnection } from "@/lib/integrations/connections";
import { fetchCampaignResult, type CampaignStats } from "@/lib/integrations/clevertap";
import { getOffer } from "@/lib/offer-store";
import { FUNDSINDIA_LIFECYCLE_DATASET_ID, type DecisionValue, type LifecycleCampaignListItem } from "@/lib/lifecycle-campaign-types";
import { listLifecycleCampaigns } from "@/lib/server/lifecycle-campaign-repo";

export type LifecycleState = "sent" | "running" | "completed" | "error" | "unknown";

export interface CampaignRow {
  id: string;
  source?: "legacy" | "lifecycle";
  targetId?: number;
  name: string;
  channel?: string;
  subject?: string;
  status?: string;             // activity row status: "success" | "error"
  lifecycle: LifecycleState;   // derived: running | completed | sent | error
  completedAt?: string;
  lastUpdated?: string;
  createdAt: string;
  detailUrl?: string;
  dashboardUrl?: string;
  offerName?: string;
  enrolled?: number;
  attempted?: number;
  conversionRate?: number | null;
  decision?: DecisionValue;
  sent?: number;
  clicked?: number;
  ctr?: number;
  statsOk?: boolean;
  statsError?: string;
}

interface CacheEntry {
  at: number;
  stats: CampaignStats;
}

// Module-level cache: targetId → stats. ~90s TTL aligns with CleverTap's
// recommended 1–5 min polling cadence and their 60 req/min per-campaign limit.
const CACHE_TTL_MS = 90_000;
const cache = new Map<number, CacheEntry>();

function datasetIdFromRequest(req: Request): string {
  const raw = req.headers.get("x-dataset-id") || FUNDSINDIA_LIFECYCLE_DATASET_ID;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : FUNDSINDIA_LIFECYCLE_DATASET_ID;
}

function cachedFetch(
  conn: Parameters<typeof fetchCampaignResult>[0],
  targetId: number,
): Promise<CampaignStats> {
  const hit = cache.get(targetId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.stats);
  return fetchCampaignResult(conn, targetId).then((stats) => {
    cache.set(targetId, { at: Date.now(), stats });
    return stats;
  });
}

function computeCtr(stats: CampaignStats): number | undefined {
  if (!stats.ok) return undefined;
  const { sent, clicked } = stats;
  if (!sent || sent <= 0 || clicked === undefined) return undefined;
  return Math.round((clicked / sent) * 1000) / 10;
}

function deriveLifecycle(
  act: SegmentActivity,
  stats: CampaignStats | null,
): LifecycleState {
  if (act.status === "error") return "error";
  if (!stats) return "sent";                      // haven't queried report yet
  if (!stats.ok) return "sent";                   // API call failed — fall back to local
  if (stats.httpStatus === 409) return "running"; // docs: 409 means report not finalized
  if (stats.completedAt) return "completed";      // metadata tells us it's done
  // 200 with no completed_at → CleverTap acknowledges but campaign is in-flight
  return "running";
}

function toRow(act: SegmentActivity, stats: CampaignStats | null): CampaignRow {
  const row: CampaignRow = {
    id: act.id,
    source: "legacy",
    targetId: act.campaignId,
    name: act.subject ?? act.channel ?? "Campaign",
    channel: act.channel,
    subject: act.subject,
    status: act.status,
    lifecycle: deriveLifecycle(act, stats),
    createdAt: act.createdAt,
    dashboardUrl: act.dashboardUrl,
  };
  if (stats) {
    row.sent = stats.sent;
    row.clicked = stats.clicked;
    row.ctr = computeCtr(stats);
    row.completedAt = stats.completedAt;
    row.lastUpdated = stats.lastUpdated;
    row.statsOk = stats.ok;
    if (!stats.ok) row.statsError = stats.error;
  }
  return row;
}

function lifecycleStateFromStatus(status: LifecycleCampaignListItem["status"]): LifecycleState {
  if (status === "completed") return "completed";
  if (status === "stopped") return "unknown";
  return "running";
}

function toLifecycleRow(item: LifecycleCampaignListItem): CampaignRow {
  return {
    id: item.id,
    source: "lifecycle",
    name: item.name,
    channel: "voice",
    status: item.status,
    lifecycle: lifecycleStateFromStatus(item.status),
    createdAt: item.createdAt,
    lastUpdated: item.updatedAt,
    detailUrl: `/campaigns/${item.id}`,
    offerName: getOffer(item.offerId, item.datasetId)?.name ?? item.offerName,
    enrolled: item.enrolledCount,
    attempted: item.attemptedCount,
    conversionRate: item.conversionRate,
    decision: item.latestDecision,
  };
}

function sortRows(rows: CampaignRow[]): CampaignRow[] {
  return rows.sort((a, b) => {
    const aTime = new Date(a.lastUpdated ?? a.createdAt).getTime();
    const bTime = new Date(b.lastUpdated ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const segment = getSegment(userId, id);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const activity = listActivity(userId, id).filter(
    (a) => a.type === "campaign" && a.status === "success",
  );
  const datasetId = datasetIdFromRequest(req);
  const lifecycleRows = listLifecycleCampaigns(userId, datasetId)
    .filter((item) => item.segmentId === id)
    .map(toLifecycleRow);

  const conn = await getCleverTapConnection(userId);
  if (!conn) {
    const rows = sortRows([...lifecycleRows, ...activity.map((a) => toRow(a, null))]);
    return Response.json({
      campaigns: rows,
      statsAvailable: false,
      reason: activity.length > 0 ? "not_connected" : undefined,
    });
  }

  const url = new URL(req.url);
  const forceFresh = url.searchParams.get("fresh") === "1";

  const uniqueTargetIds = Array.from(
    new Set(activity.map((a) => a.campaignId).filter((v): v is number => typeof v === "number")),
  );

  const statsMap = new Map<number, CampaignStats>();
  await Promise.all(
    uniqueTargetIds.map(async (tid) => {
      if (forceFresh) cache.delete(tid);
      const stats = await cachedFetch(conn, tid);
      statsMap.set(tid, stats);
    }),
  );

  let anyOk = false;
  let firstError: string | undefined;
  for (const s of statsMap.values()) {
    if (s.ok) anyOk = true;
    else if (!firstError) firstError = s.error;
  }

  const rows = activity.map((a) => {
    const stats = a.campaignId ? statsMap.get(a.campaignId) ?? null : null;
    return toRow(a, stats);
  });

  return Response.json({
    campaigns: sortRows([...lifecycleRows, ...rows]),
    statsAvailable: anyOk,
    reason: anyOk ? undefined : firstError ?? (statsMap.size === 0 ? "no_campaigns" : "stats_unavailable"),
  });
}
