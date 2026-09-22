import type { VoiceCallProvider } from "./voice-campaign-types";

/**
 * A reusable voice Agent — the persona/behavior/knowledge bundle that inbound
 * numbers and outbound campaigns both reference by id, instead of each embedding
 * its own copy. Phase 1 promotes this from a read-only projection over campaigns
 * (`campaignsToAgents`) into a real persisted entity.
 *
 * Direction-agnostic on purpose: the same agent answers inbound and drives
 * outbound. Inbound/outbound differ only in a thin behavior overlay + the
 * binding that puts the agent on a phone line — never a separate agent type.
 */
export interface Agent {
  id: string;
  userId?: string;
  datasetId?: string;

  // ── Identity (voice + brand) ──
  name: string;
  /** Seed string for the generated voxel avatar; empty/absent = default (name+voice). */
  avatarSeed?: string;
  role?: string;                 // purpose/label, e.g. "Active Borrower Welcome"
  voice: string;                 // TTS/agent voice id
  voiceName?: string;            // persona display name used in the script
  voiceProvider?: "sarvam" | "cartesia" | "gemini-live";
  language: string;
  modelId?: string;              // realtime model id (campaign.agentId)
  callProvider?: VoiceCallProvider;

  // ── Behavior ──
  systemPrompt: string;          // instructions (outbound talk-track origin)
  firstMessage: string;          // outbound opening line
  guardrails?: string[];

  // ── Grounding ──
  /** Curated context: undefined = auto (whole KB), [] = none, [...] = these ids. */
  knowledgeIds?: string[];

  // ── Provenance ──
  source: "campaign-backfill" | "custom" | "manual";
  /** Representative campaign this persona came from — used for attribution. */
  primaryCampaignId?: string;
  /** Every campaign that folded into this agent (name::voice grouping). */
  sourceCampaignIds?: string[];
  campaignCount?: number;

  createdAt: string;
  updatedAt: string;
}
