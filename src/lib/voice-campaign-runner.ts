import { storeCallConfig } from "./voice-call-state";
import { activeVoiceCallProvider } from "@/features/voice/server/call-provider";
import { resolveVoiceDialerProvider } from "@/features/voice/server/dialer-provider";
import { upsertCall } from "./voice-campaign-store";
import type { VoiceCall, VoiceCallProvider, VoiceCampaign } from "./voice-campaign-types";
import {
  appendVoiceCustomerContextToSystemPrompt,
  applyVoiceCustomerPlaceholders,
  isFundsIndiaDormantPortfolioCampaign,
  restoreCustomerNamePlaceholdersFromEditableScript,
  sanitizeFundsIndiaLiveTestPrompt,
  type VoiceCustomerContext,
} from "./voice-customer-context";
import { prepareOpeningAudio } from "@/features/voice/server/dialer";
import { geminiVoiceGender } from "./gemini-voices";
import { normalizeAgentGenderedPhrases, appendLinkToolHintToSystemPrompt } from "./voice-campaign-flow";
import { customerChannelMemoryBlock } from "./customer-channel-memory";
import { triggerBackgroundSummaryIfStale } from "./customer-channel-summarizer";
import { resolveLinkSuccessConfig } from "./voice-campaign-success";
import { resolveCampaignCanonicalOpening } from "./voice-campaign-opening";
import { buildVoiceCallEvalContextSnapshot } from "./server/voice-eval-context";

export interface PlannedVoiceCall {
  num: string;
  callConfigId: string;
  customerContext?: VoiceCustomerContext;
}

export interface VoiceCampaignLaunchContext {
  route: string;
  callTags?: string[];
}

function maskPhone(num: string): string {
  if (num.length < 7) return num;
  return `${num.slice(0, num.length - 6)}...${num.slice(-3)}`;
}

function logLaunchEvent(
  event: string,
  campaign: VoiceCampaign,
  provider: VoiceCallProvider,
  detail: Record<string, unknown> = {},
): void {
  console.info("[voice/campaigns]", {
    event,
    campaignId: campaign.id,
    callProvider: provider,
    ...detail,
  });
}

export function voiceCallRecordProvider(provider: VoiceCallProvider): NonNullable<VoiceCall["provider"]> {
  return provider === "mulberry-pipecat" ? "mulberry" : "plivo";
}

function recipientIdFromCustomerContext(context: VoiceCustomerContext | undefined): string | undefined {
  return context?.investorId;
}

export function ensureCampaignCallConfig(provider: VoiceCallProvider): void {
  resolveVoiceDialerProvider(provider).ensureConfig();
}

export function seedPlannedVoiceCalls(
  campaign: VoiceCampaign,
  plannedCalls: PlannedVoiceCall[],
  context?: VoiceCampaignLaunchContext,
): void {
  const provider = activeVoiceCallProvider(campaign.callProvider);
  logLaunchEvent("calls.seed", campaign, provider, {
    route: context?.route,
    calls: plannedCalls.length,
  });
  for (const { num, callConfigId, customerContext } of plannedCalls) {
    upsertCall(campaign.id, {
      id: callConfigId,
      callConfigId,
      provider: voiceCallRecordProvider(provider),
      toNumber: num,
      recipientId: recipientIdFromCustomerContext(customerContext),
      recipientContext: customerContext,
      status: "calling",
      engaged: false,
      tags: context?.callTags,
      startedAt: new Date().toISOString(),
    });
  }
}

export async function startPlannedVoiceCalls(
  campaign: VoiceCampaign,
  plannedCalls: PlannedVoiceCall[],
  context?: VoiceCampaignLaunchContext,
): Promise<void> {
  const provider = activeVoiceCallProvider(campaign.callProvider);
  const dialer = resolveVoiceDialerProvider(provider);
  logLaunchEvent("calls.start", campaign, provider, {
    route: context?.route,
    calls: plannedCalls.length,
  });

  for (const { num, callConfigId, customerContext } of plannedCalls) {
    logLaunchEvent(`call.route.${provider}`, campaign, provider, {
      route: context?.route,
      callId: callConfigId,
      toNumber: maskPhone(num),
    });
    const rawSystemPrompt = isFundsIndiaDormantPortfolioCampaign(campaign)
      ? sanitizeFundsIndiaLiveTestPrompt(campaign.systemPrompt)
      : campaign.systemPrompt;
    const baseSystemPrompt = restoreCustomerNamePlaceholdersFromEditableScript(rawSystemPrompt, campaign.editableScript);
    const agentGender = geminiVoiceGender(campaign.voiceName || campaign.voice || "");
    triggerBackgroundSummaryIfStale(campaign.userId, num);
    const contactMemory = customerChannelMemoryBlock(num, 12, campaign.userId);
    const runtimeSystemPrompt = appendLinkToolHintToSystemPrompt(
      appendVoiceCustomerContextToSystemPrompt(baseSystemPrompt, customerContext),
      campaign.successDefinition,
    );
    const runtimeFirstMessage = normalizeAgentGenderedPhrases(
      applyVoiceCustomerPlaceholders(resolveCampaignCanonicalOpening(campaign), customerContext),
      agentGender,
    );
    const evalContextSnapshot = buildVoiceCallEvalContextSnapshot({
      campaign,
      systemPrompt: baseSystemPrompt,
      firstMessage: runtimeFirstMessage,
      customerContext,
      contactMemory,
    });
    const sarvamOpeningAudio = await prepareOpeningAudio(runtimeFirstMessage, campaign.language, campaign.voice);
    const linkConfig = resolveLinkSuccessConfig(campaign.successDefinition);
    storeCallConfig(callConfigId, {
      campaignId: campaign.id,
      datasetId: campaign.datasetId,
      userId: campaign.userId,
      systemPrompt: runtimeSystemPrompt,
      firstMessage: runtimeFirstMessage,
      voice: campaign.voice,
      voiceName: campaign.voiceName,
      language: campaign.language,
      toNumber: num,
      customerContext,
      sarvamOpeningAudio,
      linkDest: linkConfig?.dest,
      linkWindowDays: linkConfig?.windowDays,
      linkTemplate: linkConfig?.template,
    });
    try {
      const result = await dialer.startCall({
        campaign,
        callConfigId,
        toNumber: num,
        customerContext,
        runtimeSystemPrompt,
      });
      upsertCall(campaign.id, {
        id: callConfigId,
        callConfigId,
        providerRequestId: result.providerRequestId,
        provider: result.provider,
        toNumber: num,
        recipientId: recipientIdFromCustomerContext(customerContext),
        recipientContext: customerContext,
        evalContextSnapshot,
        status: "calling",
        engaged: false,
        summary: result.summary,
      });
    } catch (err) {
      console.error("[voice/campaigns]", {
        event: `call.route.${provider}.failed`,
        campaignId: campaign.id,
        callProvider: provider,
        route: context?.route,
        callId: callConfigId,
        toNumber: maskPhone(num),
        error: (err as Error).message,
      });
      upsertCall(campaign.id, {
        id: callConfigId,
        callConfigId,
        provider: voiceCallRecordProvider(provider),
        toNumber: num,
        recipientId: recipientIdFromCustomerContext(customerContext),
        recipientContext: customerContext,
        evalContextSnapshot,
        status: "failed",
        engaged: false,
        summary: (err as Error).message,
        endedAt: new Date().toISOString(),
      });
    }
  }
}
