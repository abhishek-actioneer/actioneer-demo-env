import { createHash } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import { listSegments, upsertSegment } from "@/lib/server/segment-repo";
import { createVoiceCampaignDraftFromSegment } from "@/lib/server/voice-campaign-draft";
import type { Segment } from "@/lib/types";

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

const VoiceOpportunitySchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  segmentId: z.string().min(1).optional(),
  segmentName: z.string().min(1).max(200).optional(),
  segmentSql: z.string().min(1).optional(),
  segmentDescription: z.string().max(1000).optional(),
  sourceConversationId: z.string().optional(),
  purposeId: z.string().min(1).optional(),
  objective: z.string().max(1000).optional(),
  campaignName: z.string().max(200).optional(),
  language: z.string().min(1).max(80).optional(),
  voice: z.string().min(1).max(120).optional(),
  voiceName: z.string().min(1).max(120).optional(),
  phoneNumbers: z.array(z.string().min(1)).max(500).optional(),
  setupOnly: z.boolean().optional(),
});

function deterministicSegmentId(userId: string, datasetId: string, name: string, sql: string): string {
  const hash = createHash("sha1").update(`${userId}:${datasetId}:${name}:${sql}`).digest("hex").slice(0, 12);
  return `seg_${hash}`;
}

async function createOrReuseSegment(
  userId: string,
  datasetId: string,
  name: string,
  sql: string,
  description?: string,
  sourceConversationId?: string,
): Promise<Segment | { error: string }> {
  const cleanSql = sql.trim().replace(/;+\s*$/, "");
  const existing = listSegments(userId, datasetId).find((segment) =>
    segment.name.trim().toLowerCase() === name.trim().toLowerCase() || segment.sql.trim() === cleanSql
  );
  if (existing) return existing;

  const validationResult = await executeSQLInternal(`SELECT * FROM (${cleanSql}) __validate LIMIT 1`, datasetId);
  if (validationResult.error) return { error: `Invalid SQL: ${validationResult.error}` };

  const countResult = await executeSQLInternal(`SELECT COUNT(*) as cnt FROM (${cleanSql}) __count`, datasetId);
  if (countResult.error) return { error: `Failed to count segment users: ${countResult.error}` };

  const id = deterministicSegmentId(userId, datasetId, name, cleanSql);
  const now = new Date().toISOString();
  const userCount = Number(countResult.rows[0]?.cnt ?? 0);
  upsertSegment(userId, {
    id,
    name,
    sql: cleanSql,
    description,
    userCount,
    sourceConversationId,
    datasetId,
  });

  return {
    id,
    name,
    sql: cleanSql,
    description,
    userCount,
    sourceConversationId,
    createdAt: now,
    pushStatus: {},
  };
}

function voiceCampaignSetupUrl(segmentId: string, objective?: string): string {
  const params = new URLSearchParams({
    segmentId,
    step: "purpose",
  });
  const brief = objective?.trim();
  if (brief) params.set("brief", brief.slice(0, 1000));
  return `/voice-campaigns/new?${params.toString()}`;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = VoiceOpportunitySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  let segment: Segment | undefined;
  if (parsed.data.segmentId) {
    segment = listSegments(userId, datasetId).find((item) => item.id === parsed.data.segmentId);
    if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });
  } else {
    if (!parsed.data.segmentName || !parsed.data.segmentSql) {
      return Response.json({ error: "segmentId or segmentName + segmentSql is required" }, { status: 400 });
    }
    const result = await createOrReuseSegment(
      userId,
      datasetId,
      parsed.data.segmentName,
      parsed.data.segmentSql,
      parsed.data.segmentDescription,
      parsed.data.sourceConversationId,
    );
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    segment = result;
  }

  if (parsed.data.setupOnly) {
    return Response.json(
      {
        segment,
        openUrl: voiceCampaignSetupUrl(segment.id, parsed.data.objective),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { campaign, template } = await createVoiceCampaignDraftFromSegment({
      userId,
      datasetId,
      dataset,
      segment,
      purposeId: parsed.data.purposeId,
      objective: parsed.data.objective,
      campaignName: parsed.data.campaignName,
      language: parsed.data.language,
      voice: parsed.data.voice,
      voiceName: parsed.data.voiceName,
      phoneNumbers: parsed.data.phoneNumbers,
    });

    return Response.json(
      {
        segment,
        campaign,
        templateId: template.id,
        openUrl: `/voice-campaigns/new?campaignId=${encodeURIComponent(campaign.id)}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to create voice campaign draft" }, { status: 400 });
  }
}
