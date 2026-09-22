import type { VoiceUniversalRoute, VoiceUniversalRouteKind } from "@/lib/voice-campaign-flow";

export function isVoiceAgentGenerationRequest(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const hasVoiceArtifact = /\b(voice agent|voice campaign|voice workflow|calling agent|phone agent|call agent)\b/.test(normalized);
  const hasCreationIntent = /\b(create|build|make|generate|draft|set up|setup|refine|regenerate)\b/.test(normalized);
  return hasVoiceArtifact && hasCreationIntent;
}

export interface VoiceAgentPromptContext {
  datasetId: string;
  segmentId?: string;
  segmentName?: string;
  segmentUserCount?: number;
}

export interface VoiceAgentPrompt {
  text: string;
  goal: string;
  context: VoiceAgentPromptContext;
}

export interface VoiceAgentGenerationResult {
  campaignId: string;
  openUrl: string;
  agentName: string;
  segment: {
    id: string;
    name: string;
    userCount: number;
  };
  workflow: {
    nodeCount: number;
    routeCount: number;
    universalRouteCount: number;
  };
  language: string;
  voice: string;
  voiceName?: string;
  summary: string;
  universalRoutes: VoiceUniversalRoute[];
}

export interface VoiceAgentGenerationStatus {
  id: string;
  title: string;
  detail?: string;
}

export interface VoiceAgentBuildPlanNode {
  id: string;
  title: string;
  kind: string;
  summary: string;
}

export interface VoiceAgentBuildPlanEvent {
  type: "plan";
  id: "workflow-plan";
  summary: string;
  nodes: VoiceAgentBuildPlanNode[];
}

export interface VoiceAgentBuildActivityEvent {
  type: "activity";
  id: string;
  label: string;
  status: "running" | "completed";
}

export type VoiceAgentArtifactKind =
  | "global_prompt"
  | "node"
  | "condition"
  | "edge"
  | "universal_route"
  | "success_criteria"
  | "guardrails";

export interface VoiceAgentBuildArtifactEvent {
  type: "artifact";
  id: string;
  kind: VoiceAgentArtifactKind;
  path: string;
  title: string;
  content: string;
  change: "added" | "updated";
  additions: number;
}

export interface VoiceAgentBuildValidationEvent {
  type: "validation";
  id: string;
  status: "checking" | "repairing" | "passed" | "failed";
  issues: string[];
}

export interface VoiceAgentBuildReviewEvent {
  type: "review";
  id: string;
  label: string;
  description: string;
  severity: "required" | "recommended";
}

export interface VoiceAgentBuildNarrativeEvent {
  type: "narrative";
  id: string;
  content: string;
}

export type VoiceAgentBuildEvent =
  | VoiceAgentBuildNarrativeEvent
  | VoiceAgentBuildPlanEvent
  | VoiceAgentBuildActivityEvent
  | VoiceAgentBuildArtifactEvent
  | VoiceAgentBuildValidationEvent
  | VoiceAgentBuildReviewEvent;

export type VoiceAgentGenerationEvent =
  | { type: "status"; status: VoiceAgentGenerationStatus }
  | { type: "build"; event: VoiceAgentBuildEvent }
  | { type: "result"; result: VoiceAgentGenerationResult }
  | { type: "error"; error: string };

export interface VoiceAgentGenerationCardData {
  status: "generating" | "created" | "error";
  currentStatus?: VoiceAgentGenerationStatus;
  requestId: string;
  goal: string;
  datasetId: string;
  segmentId?: string;
  segmentName?: string;
  segmentUserCount?: number;
  buildEvents: VoiceAgentBuildEvent[];
  result?: VoiceAgentGenerationResult;
  error?: string;
}

export interface ChatSendOptions {
  forceMode?: "quick" | "deep";
  voiceAgentContext?: VoiceAgentPromptContext;
  /** Keep follow-up messages inside the dedicated voice-agent builder. */
  voiceAgentMode?: boolean;
}

export const REQUIRED_UNIVERSAL_ROUTE_KINDS: readonly VoiceUniversalRouteKind[] = [
  "end_call",
  "do_not_call",
  "not_interested",
  "busy_callback",
  "wrong_person",
  "change_language",
  "question_confusion",
  "escalation",
  "silence_unclear",
  "voicemail_screening",
] as const;
