import type { VoiceFlowEdge, VoiceFlowNode, VoiceUniversalRoute } from "./voice-campaign-flow";
import type { VoiceCustomerContext } from "./voice-customer-context";

export type VoiceCallStatus =
  | "queued"
  | "calling"
  | "connected"
  | "completed"
  | "failed"
  | "no_answer";

export type VoiceCampaignStatus = "draft" | "launching" | "in_progress" | "completed";
export type VoiceCallProvider = "plivo-gemini" | "mulberry-pipecat";
export type VoiceCallOutcome =
  | "positive"
  | "neutral"
  | "negative"
  | "busy"
  | "wrong_number"
  | "no_answer"
  | "failed"
  | "callback_scheduled"
  | "unknown";
export type VoiceCampaignSuccessMetricType = "call_outcome" | "link" | "dataset_event" | "sql";
export type VoiceCampaignSuccessCallOutcome = VoiceCallOutcome;
export type VoiceCampaignSuccessBaselineSource =
  | "historical_crm"
  | "holdout"
  | "previous_campaign"
  | "dataset_average"
  | "manual"
  | "unavailable";

export interface VoiceCampaignSuccessMetric {
  id: string;
  label: string;
  type: VoiceCampaignSuccessMetricType;
  criterion?: string;
  destinationUrl?: string;
  followUpTemplate?: string;
  outcome?: VoiceCampaignSuccessCallOutcome;
  eventName?: string;
  sql?: string;
  windowDays?: number;
  description?: string;
}

export interface VoiceCampaignSuccessBaseline {
  source: VoiceCampaignSuccessBaselineSource;
  rate?: number;
  label?: string;
  description?: string;
}

export interface VoiceCampaignSuccessDefinition {
  primary: VoiceCampaignSuccessMetric;
  secondary: VoiceCampaignSuccessMetric[];
  guardrails: string[];
  guardrailsConfig?: import("@/lib/voice-campaign-guardrails").GuardrailsConfig;
  baseline: VoiceCampaignSuccessBaseline;
  attributionWindowDays: number;
}

export type VoiceCampaignExperimentRandomizationUnit = "recipient" | "phone_number";

export interface VoiceCampaignExperimentSplit {
  enabled: boolean;
  testPercent: number;
  controlPercent: number;
  randomizationUnit: VoiceCampaignExperimentRandomizationUnit;
  testLabel: string;
  controlLabel: string;
  notes?: string;
}

export interface VoiceTranscriptTurn {
  id: string;
  role: "assistant" | "user" | "recording";
  text: string;
  at: string;
  itemId?: string;
  responseId?: string;
  sequence?: number;
  /** Milliseconds from media stream start when this turn began (Gemini Live realtime). */
  startMs?: number;
  /** Milliseconds from media stream start when this turn ended (Gemini Live realtime). */
  endMs?: number;
}

export interface VoiceRecording {
  sid: string;
  status: "in_progress" | "completed" | "absent" | "failed";
  source?: "plivo" | "twilio" | "bridge" | "mulberry";
  storageKey?: string;
  recordingUri?: string;
  twilioUrl?: string;
  durationSeconds?: number;
  channels?: number;
  contentType?: string;
  sizeBytes?: number;
  startedAt?: string;
  storedAt?: string;
}

export interface VoiceFollowUp {
  id: string;
  type: "sms" | "whatsapp";
  status: "pending" | "sent" | "failed";
  trigger: "post_call_transcript" | "mid_call_workflow";
  messageMode?: "freeform" | "template";
  to: string;
  body: string;
  reason?: string;
  provider?: "twilio" | "gupshup";
  providerSid?: string;
  providerStatus?: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
  sourceRecordingSid?: string;
  /**
   * Optional media attachment (WhatsApp only). Public URL — Gupshup fetches it
   * server-side. Free-form media needs an open 24h session; on a cold send the
   * approved template must declare a matching media header.
   */
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "file" | "sticker";
  mediaFilename?: string;
  createdAt: string;
  sentAt?: string;
  error?: string;
}

export interface GuardrailViolation {
  rule: string;
  turn: number;
  quote: string;
}

export interface VoiceCallAnalysis {
  outcome: VoiceCallOutcome;
  summary: string;
  reason: string;
  customerNeed?: string;
  nextStep?: string;
  callbackPreference?: string;
  confidence: number;
  source: "llm" | "heuristic" | "status";
  inputHash: string;
  analyzedAt: string;
  guardrailViolations?: GuardrailViolation[];
  /** Compliance-judge status. "error" ⇒ the judge threw/timed out — treat as
   *  unknown, never as "no violations" (R14). Absent on legacy records. */
  complianceStatus?: "ok" | "error";
  criterionMet?: boolean;
  criterionReason?: string;
}

/** Immutable evaluator inputs captured when the call is started. */
export interface VoiceCallEvalContextSnapshot {
  capturedAt: string;
  workflowConfig?: {
    templateId?: string;
    templateTitle?: string;
    nodes?: VoiceFlowNode[];
    edges?: VoiceFlowEdge[];
    universalRoutes?: VoiceUniversalRoute[];
  };
  agentConfig: {
    systemPrompt: string;
    firstMessage: string;
    purposeId: string;
    purposeName: string;
    guardrails: string[];
  };
  personaConfig: {
    agentId: string;
    voice: string;
    voiceName?: string;
    voiceProvider?: VoiceCampaign["voiceProvider"];
    language: string;
  };
  callConfig: {
    provider?: VoiceCallProvider;
    datasetId?: string;
    segmentId: string;
    segmentName: string;
  };
  variables?: VoiceCustomerContext;
  contactMemory?: string;
}

/**
 * One conversational turn's latency, persisted from the live voice spine.
 * All values are milliseconds, measured as offsets from media-stream start.
 * A value is `null` (not `0`) when the turn was interrupted before the agent
 * produced audio — the split is genuinely unknown, not instantaneous.
 */
export interface VoiceTurnLatency {
  turnIndex: number;
  /** End-of-user-speech PROXY: the last inbound frame our VAD tagged as speech
   *  before the model began replying. Gemini Live emits no explicit "user
   *  stopped" event, so this is the honest best signal, not a mic-level truth. */
  eouProxyMs: number | null;
  eouSource: "gemini_vad_proxy" | "raw_frame_proxy";
  /** Headline metric: the silence the caller heard between finishing their
   *  sentence and hearing the agent's first audio (firstAudioOut − eou). */
  voiceToVoiceMs: number | null;
  /** Gemini VAD endpointing + think + first-token, i.e. model/API side
   *  (modelAudioArrived − eou). Mostly outside our control. */
  detectionThinkMs: number | null;
  /** Our bridge's forwarding/gating delay (firstAudioOut − modelAudioArrived) —
   *  the component we can actually optimize. */
  responseLagMs: number | null;
  /** Whole turn incl. the agent speaking to completion (turnComplete − eou). */
  totalTurnMs: number | null;
  interrupted: boolean;
}

/** Per-call latency summary + per-turn detail, written at hangup. */
export interface VoiceCallLatency {
  /** Total turns observed, including interrupted ones. */
  turnCount: number;
  /** Turns with a measurable voiceToVoiceMs (non-interrupted, both anchors seen). */
  measuredCount: number;
  /** Aggregates over the measurable voiceToVoiceMs values (ms). */
  v2vP50Ms: number | null;
  v2vP90Ms: number | null;
  v2vMaxMs: number | null;
  v2vAvgMs: number | null;
  eouSource: "gemini_vad_proxy" | "raw_frame_proxy";
  turns: VoiceTurnLatency[];
}

export interface VoiceCall {
  id: string;               // Plivo CallUUID once known; generated call config id before stream start
  toNumber: string;         // stored as-is; masked in UI. For inbound this is the CALLER's number.
  /** Absent on calls recorded before inbound existed → treated as outbound. */
  direction?: "outbound" | "inbound";
  provider?: "plivo" | "mulberry";
  tags?: string[];
  callConfigId?: string;    // id we generate and pass through Plivo answer_url
  providerRequestId?: string; // Plivo request_uuid returned by call initiation
  recipientId?: string;     // Dataset entity/customer id used for post-call attribution
  recipientContext?: VoiceCustomerContext;
  status: VoiceCallStatus;
  durationSeconds?: number;
  engaged: boolean;         // durationSeconds >= 20
  summary?: string;
  analysis?: VoiceCallAnalysis;
  evalContextSnapshot?: VoiceCallEvalContextSnapshot;
  recording?: VoiceRecording;
  bridgeRecording?: VoiceRecording;
  transcript?: VoiceTranscriptTurn[];
  followUps?: VoiceFollowUp[];
  startedAt?: string;
  endedAt?: string;
  /** Wall-clock (ms) the call was triggered from the API process (U3). Persisted
   *  on the durable call record so the post-call transcript-finalize (U5) can
   *  compute trigger_to_transcript_ms after the call-config store is cleared. */
  triggeredAtMs?: number;
  zohoSyncStatus?: "pending" | "synced" | "failed";
  /** Per-turn voice-to-voice latency, written at hangup from the live spine.
   *  Absent on calls that predate this instrumentation and cannot be backfilled
   *  (the frame-level timing only ever went to PostHog/stdout, never to disk). */
  latency?: VoiceCallLatency;
  // Derived at API-response time (not persisted) — see voice-campaign-success-signals.ts
  linkClicked?: boolean;
  systemEventMatched?: boolean;
}

export interface VoiceCampaignSimulationMetrics {
  attempted: number;
  rang: number;
  pickedUp: number;
  aiConnected: number;
  engaged20s: number;
  positive: number;
  outcomes: Record<VoiceCallOutcome, number>;
}

export interface VoiceCampaignSimulationPoint {
  label: string;
  attempted: number;
  connected: number;
  engaged: number;
  positive: number;
  cost: number;
}

export interface VoiceCampaignSimulationRetentionPoint {
  label: string;
  elapsedSeconds: number;
  retained: number;
  percent: number;
}

export interface VoiceCampaignSimulationLatencyPoint {
  label: string;
  p50Ms: number;
  p90Ms: number;
  sampleSize: number;
}

export interface VoiceCampaignSimulationScriptAdherenceCheck {
  key: string;
  label: string;
  detail: string;
  passed: number;
  total: number;
  percent: number;
}

export interface VoiceCampaignSimulationScriptAdherenceReviewRow {
  callId: string;
  label: string;
  outcome: VoiceCallOutcome;
  score: number;
  failedKeys: string[];
}

export interface VoiceCampaignSimulationScriptAdherence {
  evaluatedCalls: number;
  averageScore: number;
  strictPassCalls: number;
  guardrailIssues: number;
  checkRows: VoiceCampaignSimulationScriptAdherenceCheck[];
  reviewRows: VoiceCampaignSimulationScriptAdherenceReviewRow[];
}

export interface VoiceCampaignSimulationActivity {
  id: string;
  label: string;
  outcome: VoiceCallOutcome;
  summary: string;
  durationSeconds?: number;
  at: string;
}

export interface VoiceCampaignSimulationCapacity {
  plivoConcurrentCalls: number;
  plivoOutboundCps: number;
  geminiConcurrentSessions: number;
  limitingProvider: "plivo" | "gemini";
  utilization: number;
  averageCallSeconds: number;
  effectiveCallsPerHour: number;
}

export interface VoiceCampaignSimulation {
  generatedAt: string;
  source: "audience-no-phone-export";
  audienceSize: number;
  modelSpendUsd: number;
  durationHours: number;
  capacity: VoiceCampaignSimulationCapacity;
  metrics: VoiceCampaignSimulationMetrics;
  timeline: VoiceCampaignSimulationPoint[];
  retention?: VoiceCampaignSimulationRetentionPoint[];
  latency?: VoiceCampaignSimulationLatencyPoint[];
  scriptAdherence?: VoiceCampaignSimulationScriptAdherence;
  recentActivity: VoiceCampaignSimulationActivity[];
}

export interface VoiceCampaign {
  id: string;
  userId?: string;           // owner; legacy local records may not have this
  name: string;             // Editable campaign display name
  datasetId?: string;
  datasetLabel?: string;
  companyName?: string;
  entityName?: string;
  segmentId: string;
  segmentName: string;
  purposeId: string;
  purposeName: string;
  systemPrompt: string;     // conversational AI system prompt for Realtime
  /**
   * How systemPrompt was produced. "compiled" = server ran
   * compileVoiceCampaignScript over the current workflow/editableScript, so
   * the runtime may trust systemPrompt directly. Absent/"legacy" = older
   * persistence where only editableScript was reliably fresh — the runtime
   * falls back to compiling from editableScript at call time.
   */
  systemPromptSource?: "compiled" | "legacy";
  firstMessage: string;     // agent opening line
  scriptReasoning: string;
  editableScript?: string;  // raw operator-edited script shown in the UI
  /** Editable Context persona block injected at the top of the live system prompt. */
  personaPrompt?: string;
  agentId: string;          // Realtime model id
  voice: string;            // TTS/agent provider voice id
  voiceName?: string;       // Agent persona/display name used in the script
  callProvider?: VoiceCallProvider;
  voiceProvider?: "sarvam" | "cartesia" | "gemini-live";
  language: string;
  languageExplicit?: boolean; // true once the UI has saved the user's spoken-language intent
  /** Language-specific spoken copy, keyed by language name. Workflow remains canonical. */
  workflow?: {
    templateId?: string;
    templateTitle?: string;
    nodes?: VoiceFlowNode[];
    edges?: VoiceFlowEdge[];
    universalRoutes?: VoiceUniversalRoute[];
  };
  generationRequestId?: string;
  phoneNumbers: string[];   // raw numbers as entered
  status: VoiceCampaignStatus;
  calls: VoiceCall[];
  createdAt: string;
  launchedAt?: string;
  audienceLaunchedAt?: string;
  successDefinition?: VoiceCampaignSuccessDefinition;
  webhookSecret?: string;
  experimentSplit?: VoiceCampaignExperimentSplit;
  simulation?: VoiceCampaignSimulation;
}
