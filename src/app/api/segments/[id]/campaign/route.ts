import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getSegment } from "@/lib/server/segment-repo";
import { getCleverTapConnection } from "@/lib/integrations/connections";
import { createCampaign, segmentAttributeKey } from "@/lib/integrations/clevertap";
import { ensureSyncedToCleverTap } from "@/lib/server/clevertap-sync";
import { recordActivity } from "@/lib/server/segment-activity-repo";
import { rewriteForTracking, trackingBaseUrl } from "@/lib/email-tracking";
import { recordEmailEvent } from "@/lib/server/email-event-repo";

const CampaignSchema = z.object({
  channel: z.enum(["email", "push", "sms", "webpush", "whatsapp"]),
  subject: z.string().trim().optional(),
  body: z.string().trim().min(1, "body is required"),
  senderName: z.string().trim().optional(),
  senderEmailId: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  replyTo: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  title: z.string().trim().optional(),
  name: z.string().trim().optional(),
  templateId: z.string().trim().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = CampaignSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    const segment = getSegment(userId, id);
    if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

    const conn = await getCleverTapConnection(userId);
    if (!conn) {
      return Response.json({ error: "CleverTap not connected", code: "not_connected" }, { status: 400 });
    }

    // Auto-sync: ensure segment members exist in CleverTap with the filter attribute.
    // Skipped if already synced. User never sees "push" as a separate step.
    const syncResult = await ensureSyncedToCleverTap(
      userId,
      segment,
      conn,
      req.headers.get("x-dataset-id"),
    );
    if (!syncResult.synced) {
      recordActivity(userId, id, {
        type: "push",
        status: "error",
        destination: "clevertap",
        userCount: syncResult.identityCount,
        error: syncResult.error,
      });
      return Response.json(
        { error: `Sync failed: ${syncResult.error ?? "unknown"}`, code: "sync_failed" },
        { status: 400 },
      );
    }
    // Only record a new "push" activity if a sync actually ran (not if already-synced short-circuit).
    if (!syncResult.skipped) {
      recordActivity(userId, id, {
        type: "push",
        status: "success",
        destination: "clevertap",
        userCount: syncResult.identityCount,
      });
    }

    // Pre-generate the activity id so we can use it as the tracking campaign id
    // BEFORE rewriting the email body. Click/open events tie back to this id.
    const trackingCampaignId = randomUUID();
    const variantId = "default"; // experimentation will populate this later

    // Rewrite outbound HTML for first-party tracking (no-op when
    // TRACKING_BASE_URL is not configured — local dev, etc.).
    const trackingEnabled = Boolean(trackingBaseUrl()) && parsed.data.channel === "email";
    const sendBody = trackingEnabled
      ? rewriteForTracking(parsed.data.body, { campaignId: trackingCampaignId, variantId })
      : parsed.data.body;

    const attrKey = segmentAttributeKey(segment.name);
    const result = await createCampaign(conn, {
      name: parsed.data.name ?? `${segment.name} ${new Date().toISOString().slice(0, 10)}`,
      targetMode: parsed.data.channel,
      filterAttribute: attrKey,
      content: {
        subject: parsed.data.subject,
        body: sendBody,
        senderName: parsed.data.senderName,
        senderEmailId: parsed.data.senderEmailId,
        replyTo: parsed.data.replyTo,
        title: parsed.data.title,
      },
    });

    if (!result.ok) {
      recordActivity(userId, id, {
        type: "campaign",
        status: "error",
        channel: parsed.data.channel,
        subject: parsed.data.subject,
        error: result.error,
      });
      return Response.json(
        { error: result.error ?? "Campaign creation failed", status: result.status },
        { status: 400 },
      );
    }

    recordActivity(userId, id, {
      id: trackingCampaignId,
      type: "campaign",
      status: "success",
      channel: parsed.data.channel,
      subject: parsed.data.subject,
      userCount: syncResult.identityCount,
      campaignId: result.campaignId,
      dashboardUrl: result.dashboardUrl,
      bodyHtml: parsed.data.body, // store the *original* body for preview rendering
      templateId: parsed.data.templateId,
    });

    // Aggregate sent event so local stats reflect what was dispatched. Per-user
    // sent rows would require ensureSyncedToCleverTap to expose the identity
    // list — defer until variant audience-splitting lands.
    if (trackingEnabled) {
      recordEmailEvent({
        campaignId: trackingCampaignId,
        variantId,
        eventType: "sent",
        meta: {
          recipientCount: syncResult.identityCount,
          cleverTapCampaignId: result.campaignId,
        },
      });
    }

    return Response.json({
      campaignId: result.campaignId,
      dashboardUrl: result.dashboardUrl,
      estimates: result.estimates,
      attributeKey: attrKey,
    });
  } catch (err) {
    console.error("[campaign] uncaught error:", err);
    return Response.json(
      { error: (err as Error).message || "Internal error", stack: (err as Error).stack?.split("\n").slice(0, 5).join("\n") },
      { status: 500 },
    );
  }
}
