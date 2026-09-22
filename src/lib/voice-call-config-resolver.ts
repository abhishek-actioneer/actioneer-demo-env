import { geminiVoiceGender } from "./gemini-voices";
import { normalizeAgentGenderedPhrases } from "./voice-campaign-flow";
import { findCallByAnyIdentity } from "./voice-campaign-store";
import { buildCampaignRuntimePrompt, buildVoiceSeedTurns } from "./voice-campaign-runtime-prompt";
import { getCallConfig, storeCallConfig, type CallConfig } from "./voice-call-state";
import { seedTurnsEnabled } from "./plivo-gemini-live-config";

/** Load per-call runtime config from memory/disk, or rebuild from the campaign store after a restart. */
export function resolveCallConfig(callId: string): CallConfig | undefined {
  const trimmed = callId.trim();
  if (!trimmed) return undefined;

  const cached = getCallConfig(trimmed);
  if (cached) return cached;

  const found = findCallByAnyIdentity([trimmed]);
  if (!found) return undefined;

  const { campaign, call } = found;
  // Rebuild through buildCampaignRuntimePrompt so restart-recovery honors the
  // same prompt-source contract as the outbound/inbound routes (compiled
  // systemPrompt when systemPromptSource === "compiled", editableScript-first
  // otherwise) — a raw campaign.systemPrompt read here would silently drift.
  const prompt = buildCampaignRuntimePrompt(campaign, call.recipientContext);
  const agentGender = geminiVoiceGender(campaign.voiceName || campaign.voice || "");
  const config: CallConfig = {
    campaignId: campaign.id,
    datasetId: campaign.datasetId,
    userId: campaign.userId,
    systemPrompt: prompt.systemPrompt,
    firstMessage: normalizeAgentGenderedPhrases(prompt.firstMessage, agentGender),
    voice: campaign.voice,
    voiceName: campaign.voiceName,
    language: campaign.language,
    toNumber: call.toNumber,
    customerContext: call.recipientContext,
    ...(seedTurnsEnabled() ? { seedTurns: buildVoiceSeedTurns(campaign) } : {}),
    linkDest: prompt.linkDest,
    linkWindowDays: prompt.linkWindowDays,
    linkTemplate: prompt.linkTemplate,
  };

  console.warn(
    `[voice/call-config] Rebuilt call config from campaign store callId=${trimmed} campaignId=${campaign.id}`,
  );
  storeCallConfig(trimmed, config);
  return config;
}
