import { getCampaign } from "./voice-campaign-store";
import type { VoiceCampaign } from "./voice-campaign-types";
import { getInboundBinding, type InboundMode } from "./inbound-agent-store";
import { getAgent } from "./agent-store";

/**
 * Inbound-agent configuration seam. Today it resolves a single default agent
 * (env-overridable) from an existing campaign's persona. It is deliberately the
 * one place the future "Inbound" section on the Agent detail page will write to
 * — swap the body for a per-number lookup without touching the answer route.
 *
 * An inbound agent reuses a campaign's *persona* (voice, language, brand) but
 * NOT its outbound talk-track — inbound behavior (greet → discover → route) is
 * authored in inbound-agent-prompt.ts.
 */

export interface InboundAgentConfig {
  campaignId: string;
  /** Which brain answers: the generic inbound engine, or the campaign's own
   *  talk-track. Defaults to "inbound-agent" for bindings that predate the flag. */
  mode: InboundMode;
  userId?: string;
  datasetId?: string;
  /** Spoken agent name (from the persona's voiceName). */
  agentName: string;
  /** Brand the agent answers for; when absent the agent identifies from the KB. */
  companyName?: string;
  language: string;
  voice: string;
  voiceName?: string;
  /** Verbatim opening line; when absent one is generated from agentName/companyName. */
  greetingOverride?: string;
  /** Ground answers on the persona's knowledge base. */
  knowledgeEnabled: boolean;
  /**
   * Curated context: when defined, the agent grounds ONLY on these knowledge
   * entry ids. Undefined = auto (priority-ordered digest of the whole KB).
   */
  knowledgeIds?: string[];
  /**
   * Per-number talk-track from the binding. When present the agent runs this
   * script instead of the default greet → discover → route framing; the
   * grounding and no-invention rails still apply on top.
   */
  scriptOverride?: string;
  /** Require identity before anything account-specific (lender default). */
  verificationRequiredForAccount: boolean;
  /** Source campaign, when the persona came from one (attribution/telemetry). */
  campaign?: VoiceCampaign;
}

/**
 * Resolve the inbound agent for a dialed number. v1 ignores `toNumber` and
 * returns one env-configurable default; the parameter is the seam for
 * per-number routing when multiple inbound lines exist.
 */
export function resolveInboundAgentConfig(toNumber?: string): InboundAgentConfig | undefined {
  // Inbound routing must be exact. Falling back to "any live binding" made a
  // call to one DID run another DID's campaign whenever Plivo omitted/mangled
  // To or the binding had not propagated yet.
  const binding = toNumber ? getInboundBinding(toNumber) : undefined;
  const mode: InboundMode = binding?.mode ?? "inbound-agent";

  // Phase 1: prefer a real Agent entity when the binding references one. Persona
  // AND knowledge selection come from the agent, not the campaign. In
  // campaign-script mode the campaign IS the brain, so the agent is skipped.
  if (binding?.agentId && mode !== "campaign-script") {
    const agent = getAgent(binding.agentId);
    if (agent) {
      return {
        mode,
        campaignId: agent.primaryCampaignId || binding.campaignId || "",
        userId: agent.userId,
        datasetId: agent.datasetId,
        agentName: agent.name?.trim() || agent.voiceName?.trim() || "the assistant",
        companyName: binding.companyName || process.env.INBOUND_COMPANY_NAME?.trim() || undefined,
        language: agent.language,
        voice: agent.voice,
        voiceName: agent.voiceName || agent.name,
        greetingOverride: binding.greeting || process.env.INBOUND_GREETING?.trim() || undefined,
        knowledgeEnabled: true,
        knowledgeIds: agent.knowledgeIds,
        scriptOverride: binding.script?.trim() || undefined,
        // Default ON: a missing flag must never silently disable the rail.
        verificationRequiredForAccount: binding.verificationRequired !== false,
        campaign: agent.primaryCampaignId ? getCampaign(agent.primaryCampaignId) : undefined,
      };
    }
    // agentId set but the row is missing — fall through to the campaign persona.
  }

  // No binding and no env override → nothing answers. Better a clear failure in
  // the answer route than silently running whatever campaign was hardcoded here.
  const campaignId = binding?.campaignId || process.env.INBOUND_VOICE_CAMPAIGN_ID;
  const campaign = campaignId ? getCampaign(campaignId) : undefined;
  if (!campaign) return undefined;

  return {
    mode,
    campaignId: campaign.id,
    userId: campaign.userId,
    datasetId: campaign.datasetId,
    agentName: campaign.voiceName?.trim() || "the assistant",
    companyName: binding?.companyName || process.env.INBOUND_COMPANY_NAME?.trim() || undefined,
    language: campaign.language,
    voice: campaign.voice,
    voiceName: campaign.voiceName,
    greetingOverride: binding?.greeting || process.env.INBOUND_GREETING?.trim() || undefined,
    knowledgeEnabled: true,
    knowledgeIds: binding?.knowledgeIds,
    scriptOverride: binding?.script?.trim() || undefined,
    // Default ON: a missing flag must never silently disable the rail.
    verificationRequiredForAccount: binding?.verificationRequired !== false,
    campaign,
  };
}
