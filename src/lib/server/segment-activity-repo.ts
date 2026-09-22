import { stmts } from "@/lib/meta-db";
import { randomUUID } from "crypto";

export type SegmentActivityType = "push" | "campaign";
export type SegmentActivityStatus = "success" | "error";
export type CampaignChannel = "email" | "sms" | "push" | "webpush" | "whatsapp";
export type SyncDestination = "clevertap" | "firebase" | "bigquery";

export interface SegmentActivity {
  id: string;
  userId: string;
  segmentId: string;
  type: SegmentActivityType;
  status: SegmentActivityStatus;
  destination?: SyncDestination;
  channel?: CampaignChannel;
  subject?: string;
  userCount?: number;
  campaignId?: number;
  dashboardUrl?: string;
  error?: string;
  createdAt: string;
  bodyHtml?: string;
  templateId?: string;
}

interface Row {
  id: string;
  user_id: string;
  segment_id: string;
  type: string;
  status: string;
  destination: string | null;
  channel: string | null;
  subject: string | null;
  user_count: number | null;
  campaign_id: number | null;
  dashboard_url: string | null;
  error: string | null;
  created_at: string;
  body_html: string | null;
  template_id: string | null;
}

function rowToActivity(r: Row): SegmentActivity {
  return {
    id: r.id,
    userId: r.user_id,
    segmentId: r.segment_id,
    type: r.type as SegmentActivityType,
    status: r.status as SegmentActivityStatus,
    destination: (r.destination as SyncDestination | null) ?? undefined,
    channel: (r.channel as CampaignChannel | null) ?? undefined,
    subject: r.subject ?? undefined,
    userCount: r.user_count ?? undefined,
    campaignId: r.campaign_id ?? undefined,
    dashboardUrl: r.dashboard_url ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    bodyHtml: r.body_html ?? undefined,
    templateId: r.template_id ?? undefined,
  };
}

const MAX_PER_SEGMENT = 50;

export interface RecordActivityInput {
  /**
   * Optional pre-generated id. Useful when the caller needs to reference the
   * activity from other systems (e.g. first-party email tracking, where this
   * id is embedded into the email body before send so click/open events can
   * tie back to the activity).
   */
  id?: string;
  type: SegmentActivityType;
  status: SegmentActivityStatus;
  destination?: SyncDestination;
  channel?: CampaignChannel;
  subject?: string;
  userCount?: number;
  campaignId?: number;
  dashboardUrl?: string;
  error?: string;
  bodyHtml?: string;
  templateId?: string;
}

export function recordActivity(
  userId: string,
  segmentId: string,
  input: RecordActivityInput,
): SegmentActivity {
  const s = stmts();
  const activity: SegmentActivity = {
    id: input.id ?? randomUUID(),
    userId,
    segmentId,
    type: input.type,
    status: input.status,
    destination: input.destination,
    channel: input.channel,
    subject: input.subject,
    userCount: input.userCount,
    campaignId: input.campaignId,
    dashboardUrl: input.dashboardUrl,
    error: input.error,
    createdAt: new Date().toISOString(),
  };
  activity.bodyHtml = input.bodyHtml;
  activity.templateId = input.templateId;
  s.segmentActivityInsert.run({
    id: activity.id,
    user_id: userId,
    segment_id: segmentId,
    type: activity.type,
    status: activity.status,
    destination: activity.destination ?? null,
    channel: activity.channel ?? null,
    subject: activity.subject ?? null,
    user_count: activity.userCount ?? null,
    campaign_id: activity.campaignId ?? null,
    dashboard_url: activity.dashboardUrl ?? null,
    error: activity.error ?? null,
    created_at: activity.createdAt,
    body_html: activity.bodyHtml ?? null,
    template_id: activity.templateId ?? null,
  });
  // Keep only the most recent N per segment.
  s.segmentActivityTrimPerSegment.run({
    user_id: userId,
    segment_id: segmentId,
    keep: MAX_PER_SEGMENT,
  });
  return activity;
}

export function listActivity(userId: string, segmentId: string, limit = MAX_PER_SEGMENT): SegmentActivity[] {
  const s = stmts();
  const rows = s.segmentActivityListBySegment.all(userId, segmentId, limit) as Row[];
  return rows.map(rowToActivity);
}

/** Return all activities (push + campaign) across every segment for this user,
 *  newest first. Used by the global Campaigns hub. */
export function listAllActivity(userId: string, limit = 500): SegmentActivity[] {
  const s = stmts();
  const rows = s.segmentActivityListByUser.all(userId, limit) as Row[];
  return rows.map(rowToActivity);
}

export function getActivity(userId: string, id: string): SegmentActivity | null {
  const s = stmts();
  const row = s.segmentActivityGetById.get(userId, id) as Row | undefined;
  return row ? rowToActivity(row) : null;
}

export function deleteActivityForSegment(userId: string, segmentId: string): void {
  const s = stmts();
  s.segmentActivityDeleteBySegment.run(userId, segmentId);
}
