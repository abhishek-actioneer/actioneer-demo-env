export interface VoiceCampaignCallDetail {
  callId: string;
  primarySignal: string;
  observableSummary: string;
  customerPosition: string;
  evidenceQuotes: string[];
  confidence: number;
  outcome: string;
  durationSeconds: number;
  turnCount: number;
  userTurnCount: number;
}

export interface VoiceCampaignInsightLane {
  id: string;
  label: string;
  /** Chip text (≤ 2 words). */
  compactLabel: string;
  /** One-sentence diagnostic claim. */
  claim: string;
  /** Recommended intervention copy. */
  action: string;
  clusterIds: string[];
  count: number;
  share: number;
  /** 0-based position in the pipeline-recommended intervention sequence. */
  triageRank: number;
}

export interface VoiceCampaignInsightCluster {
  id: string;
  /** Lane (level-0 grouping) this cluster belongs to; "" if unassigned. */
  laneId: string;
  title: string;
  description: string;
  customerLanguagePattern: string;
  count: number;
  share: number;
  outcomeMix: Record<string, number>;
  avgDurationSeconds: number;
  medianTurns: number;
  evidenceQuotes: string[];
  recommendedChange: string;
  confidence: number;
  sampleCallIds: string[];
  /** Every call grouped into this cluster (one swarm dot each in the focused map). */
  callIds: string[];
}

export interface VoiceCampaignTopInsight {
  title: string;
  readout: string;
  whyItMatters: string;
  suggestedChange: string;
  evidenceQuotes: string[];
  confidence: number;
}

export interface VoiceCampaignWorkflowChange {
  title: string;
  targetMoment: string;
  change: string;
  measurement: string;
}

export interface VoiceCampaignInsightsPayload {
  runId: string;
  source: "analysis-run";
  calls: number;
  signals: number;
  clusterCount: number;
  headline: string;
  executiveReadout: string;
  clusters: VoiceCampaignInsightCluster[];
  /** Run-derived lanes (centroid clustering + LLM naming), sorted by triageRank. */
  lanes: VoiceCampaignInsightLane[];
  /** One-line reading guide for the lane map, from the lane-naming LLM call. */
  mapCaption: string;
  topInsights: VoiceCampaignTopInsight[];
  workflowChanges: VoiceCampaignWorkflowChange[];
  openQuestions: string[];
  /** callId → call-level analytics, for the focused map dots and detail panel. */
  callDetails: Record<string, VoiceCampaignCallDetail>;
  /** callId → normalized 2D embedding positions (global + lane-local UMAP). */
  callMap: Record<
    string,
    { x: number; y: number; zoneId: string | null; laneX: number | null; laneY: number | null }
  >;
  /** Embedding-discovered sub-zones within LLM clusters (silhouette-gated k-means). */
  callZones: VoiceCampaignCallZone[];
}

export interface VoiceCampaignCallZone {
  id: string;
  clusterId: string;
  title: string;
  count: number;
}
