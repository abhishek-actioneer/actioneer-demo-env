import { listCampaigns, type VoiceCampaignScope } from "./voice-campaign-store";
import { defaultAgentName } from "./voice-campaign-flow";
import { getAgent, saveAgent } from "./agent-store";
import type { Agent } from "./agent-types";
import type { VoiceCampaign } from "./voice-campaign-types";

/**
 * Derives real Agent rows from the existing campaign god-objects and keeps them
 * in sync. This is the Phase-1 bridge: `/agents` used to be a *read-only*
 * projection (`campaignsToAgents` grouping campaigns by name::voice); this makes
 * the same grouping mint persisted entities that inbound bindings (and, later,
 * campaigns) can reference by id — without mutating any campaign record.
 *
 * The sync is idempotent and never clobbers user edits: persona fields are
 * refreshed from the newest campaign, but a user's knowledge selection and the
 * agent's original createdAt are preserved.
 */

/** Persona display name — identical logic to the client-side projection. */
function campaignAgentName(campaign: VoiceCampaign): string {
  return campaign.voiceName?.trim() || defaultAgentName(campaign.voice);
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = ((result << 5) - result + value.charCodeAt(i)) | 0;
  }
  return Math.abs(result);
}

/**
 * Stable id for a persona so re-syncs upsert instead of duplicating. Scoped by
 * dataset: the same voice+name in two datasets is two agents (different domain
 * and knowledge base), never one collapsed record.
 */
export function agentIdFor(
  userId: string | undefined,
  datasetId: string | undefined,
  name: string,
  voice: string,
): string {
  const key = `${userId ?? "_"}::${datasetId ?? "_"}::${name.toLowerCase()}::${voice.toLowerCase()}`;
  return `agt_${hash(key).toString(36)}`;
}

/** The agent id a given campaign's persona folds into. */
export function agentIdForCampaign(campaign: VoiceCampaign): string {
  return agentIdFor(campaign.userId, campaign.datasetId, campaignAgentName(campaign), campaign.voice);
}

function campaignRecency(campaign: VoiceCampaign): number {
  return new Date(campaign.launchedAt ?? campaign.createdAt).getTime() || 0;
}

/**
 * Group campaigns by persona (name::voice) and fold each group into one Agent,
 * taking persona/behavior from the most recently updated campaign in the group.
 */
export function deriveAgentsFromCampaigns(campaigns: VoiceCampaign[]): Agent[] {
  const byKey = new Map<string, { canonical: VoiceCampaign; sourceIds: string[] }>();

  for (const campaign of campaigns) {
    const key = agentIdForCampaign(campaign);
    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, { canonical: campaign, sourceIds: [campaign.id] });
      continue;
    }
    entry.sourceIds.push(campaign.id);
    if (campaignRecency(campaign) > campaignRecency(entry.canonical)) entry.canonical = campaign;
  }

  const now = new Date().toISOString();
  return [...byKey.entries()].map(([id, { canonical, sourceIds }]) => ({
    id,
    userId: canonical.userId,
    datasetId: canonical.datasetId,
    name: campaignAgentName(canonical),
    role: canonical.purposeName || "Voice Agent",
    voice: canonical.voice,
    voiceName: canonical.voiceName,
    voiceProvider: canonical.voiceProvider,
    language: canonical.language,
    modelId: canonical.agentId,
    callProvider: canonical.callProvider,
    systemPrompt: canonical.systemPrompt,
    firstMessage: canonical.firstMessage,
    guardrails: canonical.successDefinition?.guardrails,
    source: "campaign-backfill" as const,
    primaryCampaignId: canonical.id,
    sourceCampaignIds: sourceIds,
    campaignCount: sourceIds.length,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Sync persisted agents from campaigns. Idempotent: refreshes persona from the
 * newest campaign per persona while preserving each agent's knowledge selection
 * and original creation time. Returns the up-to-date agents.
 */
export function syncAgentsFromCampaigns(scope?: VoiceCampaignScope): Agent[] {
  const derived = deriveAgentsFromCampaigns(listCampaigns(scope));
  return derived.map((next) => {
    const existing = getAgent(next.id);
    const merged: Agent = {
      ...next,
      createdAt: existing?.createdAt ?? next.createdAt,
      // Preserve user edits the backfill doesn't own.
      knowledgeIds: existing?.knowledgeIds ?? next.knowledgeIds,
    };
    saveAgent(merged);
    return merged;
  });
}
