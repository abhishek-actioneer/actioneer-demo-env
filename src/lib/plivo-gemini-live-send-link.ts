/**
 * Host-side WhatsApp link send for Gemini Live mid-call.
 * Used by the send_link tool handler and by the turn planner when the
 * customer asks for WhatsApp details (model often skips the tool call).
 */

import { randomUUID } from "crypto";
import type { CallConfig } from "./voice-call-state";
import { resolvePublicBaseUrl } from "./public-base-url";
import { createAttributionToken } from "./attribution-store";
import { upsertCallFollowUp } from "./voice-campaign-store";
import { recordCustomerChannelEvent } from "./customer-channel-memory";
import {
  sendWhatsAppTemplate,
} from "../features/integrations/server/providers/gupshup/whatsapp-client";

export interface HostSendLinkDeps {
  callId: string;
  callConfig: CallConfig;
  sessionDump: { event(name: string, payload?: Record<string, unknown>): void };
  sendClientInstruction: (
    text: string,
    reason?: string,
    options?: { deferUntilIdle?: boolean },
  ) => void;
}

export type HostSendLinkStartResult =
  | { ok: true; followUpId: string; token: string }
  | { ok: false; message: string };

// No destination URL is required — many campaigns want the WhatsApp send
// wired up without a "success metric" link configured. Falls back to this
// generic line so the approved template always has a non-empty body to fill.
const DEFAULT_MIDCALL_WHATSAPP_TEXT = "Thanks for the call — this is a message from your call today.";

// At most one mid-call WhatsApp send per call. The model's direct send_link
// tool call and the turn planner's own-initiative trigger (for when the model
// skips the tool call) both independently detect the same customer request —
// without this guard a single "please WhatsApp me" can fire the send on every
// subsequent turn the planner re-evaluates, submitting one message each time.
const sentForCall = new Set<string>();

/**
 * Start a mid-call WhatsApp link send. Returns immediately after seeding the
 * pending follow-up; Gupshup delivery runs in the background and nudges the
 * model only after success/failure (same as the send_link tool path).
 */
export function hostSendWhatsAppLink(deps: HostSendLinkDeps): HostSendLinkStartResult {
  const { callId, callConfig } = deps;

  // Public demo: only the currently routed campaign may send WhatsApp.
  if (callConfig.isPublicDemo && !callConfig.activePersonaId) {
    return {
      ok: false,
      message: "Public demo WhatsApp is blocked until a campaign is routed.",
    };
  }

  const sendKey = `${callId}:${callConfig.campaignId}`;
  if (sentForCall.has(sendKey)) {
    return { ok: false, message: "A WhatsApp message has already been sent for this campaign on this call." };
  }
  sentForCall.add(sendKey);

  // A destination URL (from the campaign's "Via our link" success metric) is
  // optional — this send works campaign-wide off the tenant's approved
  // WhatsApp template alone. When a destination IS configured, we still mint
  // a trackable link for attribution; otherwise we just send the fallback text.
  let trackingUrl: string | undefined;
  if (callConfig.linkDest) {
    const baseUrl = resolvePublicBaseUrl();
    if (!baseUrl) {
      sentForCall.delete(sendKey);
      return { ok: false, message: "Base URL not configured." };
    }
    const attrToken = createAttributionToken({
      callId,
      campaignId: callConfig.campaignId,
      dest: callConfig.linkDest,
      channel: "whatsapp",
      windowDays: callConfig.linkWindowDays ?? 7,
    });
    trackingUrl = `${baseUrl}/api/t/${attrToken.token}`;
  }
  const msgBody = callConfig.linkTemplate
    ? callConfig.linkTemplate.replace(/\{link\}/g, trackingUrl ?? "")
    : trackingUrl ?? DEFAULT_MIDCALL_WHATSAPP_TEXT;
  const token = trackingUrl ? trackingUrl.split("/").pop()! : randomUUID();
  const followUpId = `mid-call-link:${callId}:${token}`;
  const createdAt = new Date().toISOString();

  upsertCallFollowUp(callId, {
    id: followUpId,
    type: "whatsapp",
    status: "pending",
    trigger: "mid_call_workflow",
    messageMode: "template",
    to: callConfig.toNumber,
    body: msgBody,
    reason: "send_link_tool",
    provider: "gupshup",
    createdAt,
  });

  void (async () => {
    try {
      // Voice calls do not open a WhatsApp customer-service window. Always use
      // the configured Meta-approved template; never fall back to free-form
      // session text or media for this path.
      const now = new Date();
      const sendResult = await sendWhatsAppTemplate(callConfig.toNumber, {
        userId: callConfig.userId,
        runtimeVariables: {
          message: msgBody,
          body: msgBody,
          text: msgBody,
          ...(trackingUrl ? { link: trackingUrl, url: trackingUrl } : {}),
          date: now.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          }),
          time: now.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
          customerName:
            callConfig.customerContext?.displayName ||
            callConfig.customerContext?.firstName ||
            "there",
        },
      });
      upsertCallFollowUp(callId, {
        id: followUpId,
        type: "whatsapp",
        status: "sent",
        trigger: "mid_call_workflow",
        messageMode: "template",
        to: callConfig.toNumber,
        body: msgBody,
        reason: "send_link_tool",
        provider: "gupshup",
        providerSid: sendResult.sid,
        providerStatus: sendResult.status,
        contentSid: sendResult.contentSid,
        createdAt,
        sentAt: new Date().toISOString(),
      });
      recordCustomerChannelEvent({
        channel: "whatsapp",
        direction: "outbound",
        actor: "agent",
        phone: callConfig.toNumber,
        userId: callConfig.userId,
        campaignId: callConfig.campaignId,
        callId,
        eventType: "whatsapp.template_sent",
        text: msgBody,
        provider: "gupshup",
        providerMessageId: sendResult.sid,
        templateId: sendResult.contentSid,
        status: sendResult.status,
        idempotencyKey: followUpId,
      });
      deps.sessionDump.event("tool.send_link", {
        token,
        sent: true,
        sid: sendResult.sid,
        providerStatus: sendResult.status,
        source: "host",
        campaignId: callConfig.campaignId,
        activePersonaId: callConfig.activePersonaId ?? null,
      });
      console.log(
        `[voice/gemini-live] send_link: sent to ${callConfig.toNumber} token=${token} sid=${sendResult.sid} status=${sendResult.status} campaign=${callConfig.campaignId}`,
      );
      deps.sendClientInstruction(
        [
          "System notice: the approved WhatsApp template was accepted by the provider for delivery.",
          "At the next natural moment — without interrupting the customer — briefly mention the message has been sent to their WhatsApp. Do not claim it was delivered or read. Then continue the conversation where it left off.",
        ].join(" "),
        "tool_send_link_success",
        { deferUntilIdle: true },
      );
    } catch (err) {
      console.error("[voice/gemini-live] send_link failed:", err);
      upsertCallFollowUp(callId, {
        id: followUpId,
        type: "whatsapp",
        status: "failed",
        trigger: "mid_call_workflow",
        messageMode: "template",
        to: callConfig.toNumber,
        body: msgBody,
        reason: "send_link_tool",
        provider: "gupshup",
        createdAt,
        error: (err as Error).message,
      });
      deps.sessionDump.event("tool.send_link", {
        token,
        sent: false,
        error: (err as Error).message,
        source: "host",
        campaignId: callConfig.campaignId,
      });
      deps.sendClientInstruction(
        [
          "System notice: the WhatsApp link could not be sent.",
          "At the next natural moment — without interrupting the customer — briefly apologize and say you will arrange for the link to reach them after the call, then continue the conversation. Do not retry the send_link tool.",
        ].join(" "),
        "tool_send_link_failure",
        { deferUntilIdle: true },
      );
    }
  })();

  return { ok: true, followUpId, token };
}
