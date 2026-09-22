import { findCall, getCampaign, upsertCallFollowUp } from "./voice-campaign-store";
import { sendSms } from "./twilio-sms-client";
import {
  resolveWhatsAppTemplatePayload,
  sendWhatsAppTemplate,
  type WhatsAppTemplateRuntime,
} from "./gupshup-whatsapp-client";
import { recordCustomerChannelEvent } from "./customer-channel-memory";
import type { VoiceFollowUp } from "./voice-campaign-types";
import type { CallConfig } from "./voice-call-state";
import type { VoiceFlowNode } from "./voice-campaign-flow";

interface MidCallActionContext {
  callId: string;
  role: "assistant" | "user";
  text: string;
  callConfig: CallConfig;
}

interface MidCallActionResult {
  disconnectCall: boolean;
  disconnectReason?: string;
}

function isEnabled(): boolean {
  return process.env.VOICE_MIDCALL_ACTIONS_ENABLED !== "0";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function renderTemplate(template: string, context: MidCallActionContext): string {
  const customerName = context.callConfig.customerContext?.displayName ||
    context.callConfig.customerContext?.firstName ||
    "there";
  return template
    .replace(/\{\{\s*customerName\s*\}\}/g, customerName)
    .replace(/\{\{\s*lastTurnText\s*\}\}/g, context.text)
    .trim();
}

function dateLabel(now = new Date()): string {
  return now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function timeLabel(now = new Date()): string {
  return now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function templateRuntime(context: MidCallActionContext, body: string): WhatsAppTemplateRuntime {
  const now = new Date();
  const customerName = context.callConfig.customerContext?.displayName ||
    context.callConfig.customerContext?.firstName ||
    "there";
  return {
    message: body,
    body,
    text: body,
    customerName,
    name: customerName,
    lastTurnText: context.text,
    date: dateLabel(now),
    time: timeLabel(now),
  };
}

function eligibleNodes(nodes: VoiceFlowNode[], context: MidCallActionContext): VoiceFlowNode[] {
  return nodes.filter((node) => {
    const action = node.data.midCallAction;
    if (!action?.enabled) return false;
    const triggerOn = action.triggerOn || "assistant_turn";
    if (triggerOn === "assistant_turn" && context.role !== "assistant") return false;
    if (triggerOn === "user_turn" && context.role !== "user") return false;
    if (!action.containsAny || action.containsAny.length === 0) return true;
    const text = normalize(context.text);
    return action.containsAny.some((token) => text.includes(normalize(token)));
  });
}

function resultContentSid(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("contentSid" in result)) return undefined;
  const contentSid = (result as { contentSid?: unknown }).contentSid;
  return typeof contentSid === "string" ? contentSid : undefined;
}

function resolveActionWhatsAppTemplatePayload(input: {
  userId?: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
  runtimeVariables: WhatsAppTemplateRuntime;
}) {
  try {
    return resolveWhatsAppTemplatePayload({
      userId: input.userId,
      contentSid: input.contentSid,
      configuredVariables: input.contentVariables,
      runtimeVariables: input.runtimeVariables,
    });
  } catch (error) {
    console.error("[voice/midcall-actions] WhatsApp template payload failed:", error);
    return undefined;
  }
}

async function deliverFollowUp(base: VoiceFollowUp, userId: string | undefined): Promise<VoiceFollowUp> {
  if (process.env.VOICE_MIDCALL_ACTIONS_DRY_RUN === "1") {
    return {
      ...base,
      status: "sent",
      providerSid: `dry-run-${base.id}`,
      providerStatus: "dry_run",
      sentAt: new Date().toISOString(),
    };
  }
  try {
    const result = base.type === "whatsapp"
      ? await sendWhatsAppTemplate(base.to, {
          userId,
          contentSid: base.contentSid,
          configuredVariables: base.contentVariables,
        })
      : await sendSms(base.to, base.body, { userId });
    return {
      ...base,
      status: "sent",
      providerSid: result.sid,
      providerStatus: result.status,
      contentSid: resultContentSid(result) ?? base.contentSid,
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      error: error instanceof Error ? error.message : "mid-call follow-up failed",
    };
  }
}

export async function maybeTriggerMidCallWorkflowActions(context: MidCallActionContext): Promise<MidCallActionResult> {
  if (!isEnabled()) return { disconnectCall: false };
  const campaign = getCampaign(context.callConfig.campaignId);
  if (!campaign) return { disconnectCall: false };
  const nodes = campaign.workflow?.nodes as VoiceFlowNode[] | undefined;
  if (!nodes || nodes.length === 0) return { disconnectCall: false };

  const triggeredNodes = eligibleNodes(nodes, context);
  let disconnectCall = false;
  let disconnectReason: string | undefined;
  for (const node of triggeredNodes) {
    const action = node.data.midCallAction;
    if (!action?.enabled) continue;
    const actionType = action.actionType ?? "send_message";
    if (actionType === "disconnect_call") {
      disconnectCall = true;
      disconnectReason = `workflow_disconnect_${node.id}`;
      continue;
    }
    const channel = action.channel || "whatsapp";
    const followUpId = buildMidCallFollowUpId(context.callId, node.id, channel);
    const already = findCall(context.callId)?.call.followUps?.find((item) => item.id === followUpId);
    if (already && (action.oncePerCall ?? true)) continue;
    const bodyTemplate = action.template?.trim() || node.data.body;
    const body = renderTemplate(bodyTemplate, context);
    const templatePayload = channel === "whatsapp"
      ? resolveActionWhatsAppTemplatePayload({
          userId: campaign.userId,
          contentSid: action.contentSid,
          contentVariables: action.contentVariables,
          runtimeVariables: templateRuntime(context, body),
        })
      : undefined;
    const followUp: VoiceFollowUp = {
      id: followUpId,
      type: channel,
      status: "pending",
      trigger: "mid_call_workflow",
      messageMode: channel === "whatsapp" ? "template" : "freeform",
      to: context.callConfig.toNumber,
      body,
      reason: `workflow_action_${node.id}`,
      provider: channel === "whatsapp" ? "gupshup" : "twilio",
      contentSid: templatePayload?.contentSid,
      contentVariables: templatePayload?.contentVariables,
      createdAt: new Date().toISOString(),
    };

    // Upsert before send to preserve audit trail and idempotency key.
    upsertCallFollowUp(context.callId, followUp);
    const delivered = await deliverFollowUp(followUp, campaign.userId);
    upsertCallFollowUp(context.callId, delivered);
    if (delivered.type === "whatsapp" && delivered.status === "sent") {
      recordCustomerChannelEvent({
        channel: "whatsapp",
        direction: "outbound",
        actor: "agent",
        phone: delivered.to,
        text: delivered.body,
        at: delivered.sentAt,
        provider: "gupshup",
        providerMessageId: delivered.providerSid,
        campaignId: campaign.id,
        callId: context.callId,
        userId: campaign.userId,
        datasetId: campaign.datasetId,
        templateId: delivered.contentSid,
        status: delivered.providerStatus,
        eventType: "whatsapp.template_sent",
        idempotencyKey: delivered.providerSid
          ? `gupshup:outbound:${delivered.providerSid}`
          : `whatsapp:midcall:${delivered.id}`,
      });
    }
  }
  return { disconnectCall, disconnectReason };
}

export function buildMidCallFollowUpId(callId: string, nodeId: string, channel: "sms" | "whatsapp"): string {
  return `mid-call-${callId}-${nodeId}-${channel}`;
}
