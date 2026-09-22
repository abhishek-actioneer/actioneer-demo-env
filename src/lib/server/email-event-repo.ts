import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/meta-db";

export type EmailEventType =
  | "sent"
  | "open"
  | "click"
  | "unsubscribe"
  | "bounce";

export interface EmailEvent {
  id: string;
  campaign_id: string;
  user_id: string | null;
  variant_id: string;
  event_type: EmailEventType;
  url: string | null;
  ts: number;
  ip: string | null;
  user_agent: string | null;
  meta: string | null;
}

export interface RecordEmailEventInput {
  campaignId: string;
  userId?: string | null;
  variantId?: string;
  eventType: EmailEventType;
  url?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
}

export function recordEmailEvent(input: RecordEmailEventInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO email_events (id, campaign_id, user_id, variant_id, event_type, url, ts, ip, user_agent, meta)
     VALUES (@id, @campaign_id, @user_id, @variant_id, @event_type, @url, @ts, @ip, @user_agent, @meta)`,
  ).run({
    id: randomUUID(),
    campaign_id: input.campaignId,
    user_id: input.userId ?? null,
    variant_id: input.variantId ?? "default",
    event_type: input.eventType,
    url: input.url ?? null,
    ts: Date.now(),
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    meta: input.meta ? JSON.stringify(input.meta) : null,
  });
}

export interface VariantStats {
  sent: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
}

export interface CampaignStatsLocal {
  campaignId: string;
  sent: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  unsubscribes: number;
  bounces: number;
  byVariant: Record<string, VariantStats>;
  lastEventAt: number | null;
}

export function getCampaignStats(campaignId: string): CampaignStatsLocal {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT event_type, variant_id, user_id, ts, meta
       FROM email_events
       WHERE campaign_id = ?`,
    )
    .all(campaignId) as Array<{
      event_type: EmailEventType;
      variant_id: string;
      user_id: string | null;
      ts: number;
      meta: string | null;
    }>;

  const stats: CampaignStatsLocal = {
    campaignId,
    sent: 0,
    opens: 0,
    uniqueOpens: 0,
    clicks: 0,
    uniqueClicks: 0,
    unsubscribes: 0,
    bounces: 0,
    byVariant: {},
    lastEventAt: null,
  };

  const allOpeners = new Set<string>();
  const allClickers = new Set<string>();
  const variantOpeners = new Map<string, Set<string>>();
  const variantClickers = new Map<string, Set<string>>();

  for (const row of rows) {
    if (stats.lastEventAt === null || row.ts > stats.lastEventAt) {
      stats.lastEventAt = row.ts;
    }
    const v = row.variant_id;
    if (!stats.byVariant[v]) {
      stats.byVariant[v] = {
        sent: 0,
        opens: 0,
        uniqueOpens: 0,
        clicks: 0,
        uniqueClicks: 0,
      };
    }
    if (!variantOpeners.has(v)) variantOpeners.set(v, new Set());
    if (!variantClickers.has(v)) variantClickers.set(v, new Set());

    switch (row.event_type) {
      case "sent": {
        // We currently record one aggregate sent event per campaign with the
        // recipient count in meta.recipientCount (per-recipient sent rows
        // require ensureSyncedToCleverTap to expose identities — deferred).
        // Read recipientCount from meta when present; fall back to 1.
        let recipientCount = 1;
        if (row.meta) {
          try {
            const parsed = JSON.parse(row.meta) as { recipientCount?: number };
            if (typeof parsed.recipientCount === "number" && parsed.recipientCount > 0) {
              recipientCount = parsed.recipientCount;
            }
          } catch {
            // Ignore malformed meta
          }
        }
        stats.sent += recipientCount;
        stats.byVariant[v].sent += recipientCount;
        break;
      }
      case "open":
        stats.opens++;
        stats.byVariant[v].opens++;
        if (row.user_id) {
          allOpeners.add(row.user_id);
          variantOpeners.get(v)!.add(row.user_id);
        }
        break;
      case "click":
        stats.clicks++;
        stats.byVariant[v].clicks++;
        if (row.user_id) {
          allClickers.add(row.user_id);
          variantClickers.get(v)!.add(row.user_id);
        }
        break;
      case "unsubscribe":
        stats.unsubscribes++;
        break;
      case "bounce":
        stats.bounces++;
        break;
    }
  }

  stats.uniqueOpens = allOpeners.size;
  stats.uniqueClicks = allClickers.size;
  for (const [v, set] of variantOpeners) {
    if (stats.byVariant[v]) stats.byVariant[v].uniqueOpens = set.size;
  }
  for (const [v, set] of variantClickers) {
    if (stats.byVariant[v]) stats.byVariant[v].uniqueClicks = set.size;
  }

  return stats;
}

export interface UserEmailEvent {
  campaignId: string;
  variantId: string;
  eventType: EmailEventType;
  url: string | null;
  ts: number;
}

export function getEventsForUser(userId: string, limit = 200): UserEmailEvent[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT campaign_id AS campaignId,
              variant_id  AS variantId,
              event_type  AS eventType,
              url,
              ts
       FROM email_events
       WHERE user_id = ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(userId, limit) as UserEmailEvent[];
}
