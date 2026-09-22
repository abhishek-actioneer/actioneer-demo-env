import { sendWhatsAppSessionText } from "./gupshup-whatsapp-client";
import {
  recordCustomerChannelEvent,
  type CustomerChannelEvent,
} from "./customer-channel-memory";
import { triggerBackgroundSummaryIfStale } from "./customer-channel-summarizer";
import { findWhatsAppCredentialsForWebhook } from "./tenant-connections-store";
import { generateWhatsAppReply } from "./whatsapp-tool-reply";

export interface WhatsAppAutoReplyResult {
  attempted: boolean;
  sent: boolean;
  replyText?: string;
  providerMessageId?: string;
  error?: string;
}

function isEnabled(): boolean {
  return process.env.WHATSAPP_INBOUND_AUTO_REPLY_ENABLED !== "0";
}

async function buildReply(event: CustomerChannelEvent, userId?: string): Promise<string> {
  return generateWhatsAppReply(event, userId);
}

export async function maybeReplyToInboundWhatsAppMessage(
  event: CustomerChannelEvent,
): Promise<WhatsAppAutoReplyResult> {
  if (!isEnabled()) return { attempted: false, sent: false };
  if (event.channel !== "whatsapp" || event.direction !== "inbound" || event.actor !== "customer") {
    return { attempted: false, sent: false };
  }
  if (!event.text?.trim()) return { attempted: false, sent: false };

  const owner = findWhatsAppCredentialsForWebhook({
    appName: event.appName,
    source: event.destination,
  });

  const replyText = await buildReply(event, owner?.userId);

  try {
    const result = await sendWhatsAppSessionText(event.phone, replyText, {
      userId: owner?.userId,
      credentials: owner?.credentials,
    });
    recordCustomerChannelEvent({
      channel: "whatsapp",
      direction: "outbound",
      actor: "agent",
      phone: event.phone,
      text: replyText,
      at: new Date().toISOString(),
      provider: "gupshup",
      providerMessageId: result.sid,
      whatsappMessageId: result.sid,
      userId: owner?.userId,
      eventType: "whatsapp.auto_reply",
      status: result.status,
      appName: event.appName,
      source: result.from,
      destination: result.to,
      idempotencyKey: result.sid
        ? `gupshup:auto-reply:${result.sid}`
        : `whatsapp:auto-reply:${event.id}`,
    });
    triggerBackgroundSummaryIfStale(owner?.userId, event.phone);
    return {
      attempted: true,
      sent: true,
      replyText,
      providerMessageId: result.sid,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhatsApp auto-reply failed";
    console.error("[whatsapp/inbound-replier] send failed:", message);
    return {
      attempted: true,
      sent: false,
      replyText,
      error: message,
    };
  }
}
