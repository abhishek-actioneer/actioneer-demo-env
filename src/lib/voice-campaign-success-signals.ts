import { getCallAttribution } from "./attribution-store";
import { getEventsForCampaign } from "./inbound-event-store";
import type { VoiceCall } from "./voice-campaign-types";

/**
 * Attaches per-call success signals (link click, matched webhook event) that
 * live in separate file-backed stores, computed fresh on every read and never
 * persisted onto the campaign record itself.
 */
export function enrichCallsWithSuccessSignals(campaignId: string, calls: VoiceCall[]): VoiceCall[] {
  if (calls.length === 0) return calls;

  const matchedCallIds = new Set(
    getEventsForCampaign(campaignId, 1000)
      .filter((event) => event.matchedCallId)
      .map((event) => event.matchedCallId as string),
  );

  return calls.map((call) => ({
    ...call,
    linkClicked: getCallAttribution(call.id).attributed,
    systemEventMatched: matchedCallIds.has(call.id),
  }));
}

export function enrichCampaignWithSuccessSignals<T extends { id: string; calls?: VoiceCall[] }>(campaign: T): T {
  if (!Array.isArray(campaign.calls) || campaign.calls.length === 0) return campaign;
  return { ...campaign, calls: enrichCallsWithSuccessSignals(campaign.id, campaign.calls) };
}
