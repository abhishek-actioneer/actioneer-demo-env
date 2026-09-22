import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  gupshupV2StatusUpdates,
  metaV3StatusUpdates,
  recordWhatsAppMessageStatus,
} from "@/lib/whatsapp-message-status-store";
import {
  gupshupV2InboundWhatsAppEvents,
  metaV3InboundWhatsAppEvents,
  recordCustomerChannelEventWithResult,
} from "@/lib/customer-channel-memory";
import { maybeReplyToInboundWhatsAppMessage } from "@/lib/whatsapp-inbound-replier";
import { getVoiceStorageRoot } from "@/lib/voice-storage";

export const runtime = "nodejs";

function dumpWebhookBody(body: unknown): void {
  try {
    const root = getVoiceStorageRoot();
    mkdirSync(root, { recursive: true });
    appendFileSync(
      join(root, "gupshup-whatsapp-webhooks.jsonl"),
      JSON.stringify({ receivedAt: new Date().toISOString(), body }) + "\n",
      "utf-8",
    );
  } catch (error) {
    console.error("[gupshup/whatsapp-webhook] raw dump failed:", error);
  }
}

function webhookSecretFromRequest(req: Request): string | undefined {
  const url = new URL(req.url);
  return req.headers.get("x-actioneer-webhook-secret")?.trim() ||
    url.searchParams.get("secret")?.trim() ||
    undefined;
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.GUPSHUP_WHATSAPP_WEBHOOK_SECRET?.trim();
  if (!expected) return true;
  return webhookSecretFromRequest(req) === expected;
}

export async function GET() {
  return Response.json(
    {
      ok: true,
      provider: "gupshup",
      message: "POST Gupshup WhatsApp webhook events here.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => undefined);
  dumpWebhookBody(body);
  const updates = [
    ...gupshupV2StatusUpdates(body),
    ...metaV3StatusUpdates(body),
  ];
  const inboundEvents = [
    ...gupshupV2InboundWhatsAppEvents(body),
    ...metaV3InboundWhatsAppEvents(body),
  ];

  for (const update of updates) {
    recordWhatsAppMessageStatus(update);
  }
  const recordedInboundEvents = [];
  for (const event of inboundEvents) {
    const result = recordCustomerChannelEventWithResult(event);
    if (result?.created) recordedInboundEvents.push(result.event);
  }

  const autoReplies = await Promise.all(
    recordedInboundEvents.map((event) => maybeReplyToInboundWhatsAppMessage(event)),
  );
  console.info("[gupshup/whatsapp-webhook] processed", {
    updates: updates.length,
    inboundEvents: inboundEvents.length,
    recordedInboundEvents: recordedInboundEvents.length,
    autoReplies: autoReplies.filter((reply) => reply.sent).length,
    autoReplyErrors: autoReplies.filter((reply) => reply.error).map((reply) => reply.error),
  });

  return Response.json(
    {
      ok: true,
      received: true,
      updates: updates.length,
      inboundEvents: inboundEvents.length,
      autoReplies: autoReplies.filter((reply) => reply.sent).length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
