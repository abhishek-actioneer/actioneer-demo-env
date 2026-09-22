import { selectDisplayTranscript } from "@/lib/voice-transcript-display";
import { canonicalTurnTimingMs } from "@/lib/voice-transcript-sort";
import type {
  VoiceCall,
  VoiceCallOutcome,
  VoiceCampaign,
  VoiceCampaignSimulationLatencyPoint,
  VoiceCampaignSimulationPoint,
  VoiceCampaignSimulationRetentionPoint,
  VoiceCampaignSuccessCallOutcome,
  VoiceCampaignSuccessDefinition,
  VoiceCampaignSuccessMetric,
  VoiceTranscriptTurn,
} from "@/lib/voice-campaign-types";

// ---------------------------------------------------------------------------
// Constants and config
// ---------------------------------------------------------------------------

export const OUTCOME_LABELS: Record<VoiceCallOutcome, string> = {
  positive: "Positive",
  callback_scheduled: "Callback scheduled",
  neutral: "Neutral",
  negative: "Negative",
  busy: "Busy",
  wrong_number: "Wrong number",
  no_answer: "No answer",
  failed: "Failed",
  unknown: "Unknown",
};

export const SUCCESS_OUTCOME_LABELS = OUTCOME_LABELS;

export const CRM_CONNECTOR_PATTERN = /\b(salesforce|hubspot|zoho crm|freshsales|activecampaign|crm)\b/i;

export const OUTCOME_ORDER: VoiceCallOutcome[] = [
  "positive",
  "callback_scheduled",
  "negative",
  "busy",
  "neutral",
  "no_answer",
  "wrong_number",
  "failed",
  "unknown",
];

export const GEMINI_LIVE_INPUT_AUDIO_PER_MINUTE_USD = 0.005;
export const GEMINI_LIVE_OUTPUT_AUDIO_PER_MINUTE_USD = 0.018;
export const ESTIMATED_AGENT_TALK_SHARE = 0.45;
export const DEFAULT_PLIVO_CONCURRENT_CALLS = 50;
export const DEFAULT_PLIVO_OUTBOUND_CPS = 2;
export const DEFAULT_GEMINI_LIVE_CONCURRENT_SESSIONS = 1000;
export const CAPACITY_UTILIZATION = 0.82;

export type SimulationCapacity = NonNullable<NonNullable<VoiceCampaign["simulation"]>["capacity"]>;

// ---------------------------------------------------------------------------
// VoiceCampaignMetrics interface
// ---------------------------------------------------------------------------

export interface VoiceCampaignMetrics {
  attempted: number;
  rang: number;
  pickedUp: number;
  aiConnected: number;
  engaged20s: number;
  positive: number;
  outcomes: Record<VoiceCallOutcome, number>;
}

// ---------------------------------------------------------------------------
// Call text / display helpers
// ---------------------------------------------------------------------------

function callText(call: VoiceCall): string {
  const customerTranscript = (call.transcript ?? [])
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text)
    .join(" ");
  const transcript = customerTranscript || (call.transcript ?? [])
    .map((turn) => turn.text)
    .join(" ");
  const summary = meaningfulCallSummary(call) ?? "";
  return `${summary} ${transcript}`.toLowerCase();
}

export function maskPhone(num: string): string {
  if (num.length < 7) return num;
  return `${num.slice(0, num.length - 6)}...${num.slice(-3)}`;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "-";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function callStartedAt(call: VoiceCall): string {
  if (!call.startedAt) return "-";
  return new Date(call.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function callStatusLabel(call: VoiceCall): string {
  if (call.status === "no_answer") return "No answer";
  return call.status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function callRuntimeLabel(call: VoiceCall): string {
  if (call.provider === "plivo") return "Gemini";
  return "-";
}

export function hasCallTag(call: VoiceCall, tag: string): boolean {
  return (call.tags ?? []).some((value) => value.toLowerCase() === tag);
}

export function isLiveTestCall(call: VoiceCall): boolean {
  return hasCallTag(call, "live test");
}

export function isTestCall(call: VoiceCall): boolean {
  return isLiveTestCall(call) || hasCallTag(call, "test call");
}

export function isCampaignCall(call: VoiceCall): boolean {
  return hasCallTag(call, "campaign");
}

export function callDisplayName(call: VoiceCall): string {
  if (isLiveTestCall(call)) return "Live test";
  if (isTestCall(call)) return "Test call";
  return maskPhone(call.toNumber);
}

export function hasPlayableRecording(recording: VoiceCall["recording"] | VoiceCall["bridgeRecording"]): boolean {
  return Boolean(recording?.storageKey || recording?.twilioUrl);
}

export function primaryRecording(call: VoiceCall) {
  if (isLiveTestCall(call) && hasPlayableRecording(call.bridgeRecording)) {
    return call.bridgeRecording;
  }
  if (hasPlayableRecording(call.bridgeRecording)) return call.bridgeRecording;
  return call.recording;
}

export function isProviderOnlySummary(summary: string | undefined): boolean {
  const text = summary?.trim() ?? "";
  return !text ||
    /^Gemini\b.*\baccepted\b/i.test(text) ||
    /^Browser live test\b/i.test(text);
}

export function meaningfulCallSummary(call: VoiceCall): string | undefined {
  if (call.analysis?.summary) return call.analysis.summary;
  if (!isProviderOnlySummary(call.summary)) return call.summary;
  return undefined;
}

export function callResponseSummary(call: VoiceCall): string {
  const summary = meaningfulCallSummary(call);
  if (summary) return summary;
  if ((call.transcript?.length ?? 0) === 0) return "No customer response captured yet.";
  return "Transcript captured; response analysis pending.";
}

// ---------------------------------------------------------------------------
// Response aggregate
// ---------------------------------------------------------------------------

export interface VoiceResponseAggregate {
  totalCalls: number;
  analyzedCount: number;
  classifiedCount: number;
  pendingAnalysisCount: number;
  campaignCallCount: number;
  testCallCount: number;
  liveTestCount: number;
  customerRespondedCount: number;
  outcomeCounts: Record<VoiceCallOutcome, number>;
  topOutcomes: VoiceCallOutcome[];
  topOutcomeCount: number;
  customerNeeds: string[];
  nextSteps: string[];
}

export interface PropertyBreakdown {
  property: string;
  displayName: string;
  values: { name: string; count: number }[];
}

export interface SegmentOverviewPayload {
  id: string;
  sql: string;
  userCount: number;
}

export function formatResponsePercent(count: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

export function uniqueNonEmpty(values: Array<string | undefined>, max = 3): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const text = value?.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    result.push(text);
  });
  return result.slice(0, max);
}

export function isResponseAnalysisPending(call: VoiceCall): boolean {
  if (!call.analysis) return true;
  const transcriptCount = call.transcript?.length ?? 0;
  const text = `${call.analysis.summary} ${call.analysis.reason} ${call.analysis.nextStep ?? ""}`;
  return call.analysis.outcome === "unknown" &&
    transcriptCount === 0 &&
    /\b(awaiting|wait for|callback|transcript)\b/i.test(text);
}

export function defaultAggregateNextSteps(aggregate: VoiceResponseAggregate): string[] {
  if (aggregate.pendingAnalysisCount > 0 && aggregate.classifiedCount === 0) {
    return ["Wait for provider callback or transcript before making a campaign decision."];
  }
  if (aggregate.topOutcomes.includes("positive")) return ["Prioritize immediate follow-up for interested customers."];
  if (aggregate.topOutcomes.includes("negative")) return ["Avoid repeated pressure; use a softer re-engagement path later."];
  if (aggregate.topOutcomes.includes("no_answer")) return ["Retry at a different time or use another channel before changing the pitch."];
  if (aggregate.topOutcomes.includes("busy")) return ["Schedule callbacks for customers who asked to continue later."];
  if (aggregate.topOutcomes.includes("wrong_number")) return ["Verify or suppress wrong-number contacts before retrying."];
  if (aggregate.topOutcomes.includes("failed")) return ["Check provider delivery and runtime failures before relaunching."];
  return ["Review transcripts before deciding the next campaign action."];
}

export function aggregateReadout(aggregate: VoiceResponseAggregate): string {
  if (aggregate.totalCalls === 0) return "No responses have been captured yet.";
  if (aggregate.classifiedCount === 0) {
    return "No usable customer response has arrived yet. Analysis is waiting on provider callbacks, transcripts, or completed calls.";
  }
  const topLabels = aggregate.topOutcomes.map((outcome) => OUTCOME_LABELS[outcome]).join(" + ");
  const pending = aggregate.pendingAnalysisCount > 0
    ? ` ${aggregate.pendingAnalysisCount} call${aggregate.pendingAnalysisCount === 1 ? " is" : "s are"} still pending.`
    : "";
  return `${topLabels} is the leading signal across ${aggregate.classifiedCount} classified call${aggregate.classifiedCount === 1 ? "" : "s"}.${pending}`;
}

export function buildResponseAggregate(calls: VoiceCall[]): VoiceResponseAggregate {
  const outcomeCounts: Record<VoiceCallOutcome, number> = {
    positive: 0,
    callback_scheduled: 0,
    neutral: 0,
    negative: 0,
    busy: 0,
    wrong_number: 0,
    no_answer: 0,
    failed: 0,
    unknown: 0,
  };
  let pendingAnalysisCount = 0;
  let customerRespondedCount = 0;

  calls.forEach((call) => {
    if (isResponseAnalysisPending(call)) {
      pendingAnalysisCount += 1;
      return;
    }
    const outcome = classifyVoiceCallOutcome(call);
    outcomeCounts[outcome] += 1;
    if (!["no_answer", "failed", "unknown"].includes(outcome)) {
      customerRespondedCount += 1;
    }
  });

  const classifiedCount = calls.length - pendingAnalysisCount;
  const topOutcomeCount = Math.max(...OUTCOME_ORDER.map((outcome) => outcomeCounts[outcome]), 0);
  const topOutcomes = topOutcomeCount > 0
    ? OUTCOME_ORDER.filter((outcome) => outcomeCounts[outcome] === topOutcomeCount)
    : [];

  return {
    totalCalls: calls.length,
    analyzedCount: calls.filter((call) => Boolean(call.analysis)).length,
    classifiedCount,
    pendingAnalysisCount,
    campaignCallCount: calls.filter(isCampaignCall).length,
    testCallCount: calls.filter((call) => hasCallTag(call, "test call")).length,
    liveTestCount: calls.filter(isLiveTestCall).length,
    customerRespondedCount,
    outcomeCounts,
    topOutcomes,
    topOutcomeCount,
    customerNeeds: uniqueNonEmpty(calls.map((call) => call.analysis?.customerNeed)),
    nextSteps: uniqueNonEmpty(calls.map((call) => call.analysis?.nextStep)),
  };
}

// ---------------------------------------------------------------------------
// Script adherence
// ---------------------------------------------------------------------------

export const SCRIPT_ADHERENCE_CHECKS = [
  {
    key: "permission",
    label: "Permission gate",
    detail: "Introduced the caller and asked before continuing.",
  },
  {
    key: "discovery",
    label: "Discovery question",
    detail: "Asked the campaign's main diagnostic question.",
  },
  {
    key: "offer_discipline",
    label: "Offer discipline",
    detail: "Did not push callback or offer before customer context.",
  },
  {
    key: "concern_handling",
    label: "Concern handling",
    detail: "Handled busy, refusal, opt-out, or blocker before proceeding.",
  },
  {
    key: "guardrails",
    label: "Guardrails",
    detail: "No unsafe ask, unsupported claim, or pressure language.",
  },
  {
    key: "turn_discipline",
    label: "Turn discipline",
    detail: "Kept turns focused and avoided stacked questions.",
  },
] as const;

export type ScriptAdherenceCheckKey = typeof SCRIPT_ADHERENCE_CHECKS[number]["key"];

export interface ScriptAdherenceCallEval {
  callId: string;
  label: string;
  outcome: VoiceCallOutcome;
  score: number;
  failedKeys: ScriptAdherenceCheckKey[];
  checks: Record<ScriptAdherenceCheckKey, boolean>;
}

export function percentOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

export function normalizedScriptEvalText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/["""'.:,;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function transcriptText(call: VoiceCall, role?: "assistant" | "user"): string {
  return displayTranscript(call)
    .filter((turn) => !role || turn.role === role)
    .map((turn) => turn.text)
    .join(" ");
}

export function assistantTurns(call: VoiceCall) {
  return displayTranscript(call).filter((turn) => turn.role === "assistant");
}

export function hasPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function hasPermissionAsk(campaign: VoiceCampaign, call: VoiceCall): boolean {
  const text = normalizedScriptEvalText(`${campaign.firstMessage} ${transcriptText(call, "assistant")}`);
  return hasPattern(text, [
    /\b(permission|minute|moment|speak|talk|time)\b/,
    /\b(baat|bol|bolna|karna|theek|abhi)\b/,
    /मिनट|बात|बोल|समय|ठीक|अनुमति|करना/,
  ]);
}

export function workflowTextForKinds(campaign: VoiceCampaign, kinds: string[]): string {
  const nodes = campaign.workflow?.nodes ?? [];
  return nodes
    .filter((node) => kinds.includes(node.data.kind))
    .map((node) => `${node.data.title} ${node.data.body}`)
    .join(" ");
}

export function meaningfulEvalTokens(value: string): string[] {
  const stopWords = new Set([
    "this",
    "that",
    "with",
    "your",
    "from",
    "after",
    "before",
    "customer",
    "private",
    "guidance",
    "sample",
    "line",
    "निजी",
    "मार्गदर्शन",
    "नमूना",
    "पंक्ति",
  ]);
  return normalizedScriptEvalText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token))
    .slice(0, 24);
}

export function tokenOverlapCount(sourceText: string, targetText: string): number {
  const source = new Set(meaningfulEvalTokens(sourceText));
  if (source.size === 0) return 0;
  const target = normalizedScriptEvalText(targetText);
  let count = 0;
  source.forEach((token) => {
    if (target.includes(token)) count += 1;
  });
  return count;
}

export function hasDiscoveryQuestion(campaign: VoiceCampaign, call: VoiceCall): boolean {
  const assistantText = transcriptText(call, "assistant");
  const normalized = normalizedScriptEvalText(assistantText);
  const questionText = workflowTextForKinds(campaign, ["question"]);
  const workflowOverlap = questionText ? tokenOverlapCount(questionText, assistantText) : 0;

  return workflowOverlap >= 2 || hasPattern(normalized, [
    /\b(reason|why|diagnostic|follow[-\s]?up|plan|portfolio|holdings|booking|callback)\b/,
    /\b(kya|kyun|kaaran|wajah|ruk|samajhna|check)\b/,
    /क्या|क्यों|वजह|कारण|रुक|समझ|बुकिंग|होल्डिंग|पोर्टफोलियो|सवाल|पूछ/,
  ]);
}

export function mentionsCallbackOrOffer(text: string, campaign: VoiceCampaign): boolean {
  const normalized = normalizedScriptEvalText(text);
  const purpose = normalizedScriptEvalText(`${campaign.purposeName} ${campaign.purposeId}`);
  const offerTokens = meaningfulEvalTokens(purpose);
  return hasPattern(normalized, [
    /\b(callback|call back|advisor|adviser|specialist|review|offer|team|consultation|portfolio)\b/,
    /कॉलबैक|कॉल\s*बैक|सलाहकार|रिव्यू|ऑफर|टीम|समीक्षा/,
  ]) || offerTokens.some((token) => normalized.includes(token));
}

export function hasEarlyOfferPitch(campaign: VoiceCampaign, call: VoiceCall): boolean {
  const turns = displayTranscript(call).filter((turn) => turn.role === "assistant" || turn.role === "user");
  let userContextTurns = 0;

  for (const turn of turns) {
    if (turn.role === "user" && turn.text.trim().length > 8) {
      userContextTurns += 1;
      continue;
    }

    if (turn.role === "assistant" && userContextTurns === 0 && mentionsCallbackOrOffer(turn.text, campaign)) {
      return true;
    }
  }

  return false;
}

export function userHasConcern(call: VoiceCall): boolean {
  const text = normalizedScriptEvalText(transcriptText(call, "user"));
  return hasPattern(text, [
    /\b(busy|later|not interested|wrong person|wrong number|stop|remove|complaint|problem|issue|confused|price|expensive|charges?)\b/,
    /\b(baad|busy|nahi|nahin|mat|ruk|problem|issue|price|charge)\b/,
    /व्यस्त|बाद|नहीं|गलत|बंद|मत|समस्या|शिकायत|महंगा|कीमत|चार्ज/,
  ]);
}

export function concernHandled(call: VoiceCall): boolean {
  if (!userHasConcern(call)) return true;
  const assistant = normalizedScriptEvalText(transcriptText(call, "assistant"));
  return hasPattern(assistant, [
    /\b(sorry|apolog|later|better time|callback time|remove|stop|noted|understand|check|help)\b/,
    /\b(theek|samjha|maaf|baad|samay|note|madad|check)\b/,
    /ठीक|समझ|माफ|बाद|समय|नोट|मदद|चेक|धन्यवाद/,
  ]);
}

export function guardrailsPassed(call: VoiceCall): boolean {
  // If the post-call compliance audit has run, use its result.
  if (call.analysis?.guardrailViolations !== undefined) {
    return call.analysis.guardrailViolations.length === 0;
  }
  // Audit not yet run — treat as not evaluated (optimistic pass).
  return true;
}

export function turnDisciplinePassed(call: VoiceCall): boolean {
  const turns = assistantTurns(call);
  if (turns.length === 0) return false;
  return turns.every((turn) => {
    const questionMarks = (turn.text.match(/[?？]/g) ?? []).length;
    const conversationalQuestionCount = (turn.text.match(/\b(kya|why|when|which|how|can you|would you)\b/gi) ?? []).length +
      (turn.text.match(/क्या|क्यों|कब|कैसे|कौन|किस/g) ?? []).length;
    const words = normalizedScriptEvalText(turn.text).split(/\s+/).filter(Boolean).length;
    return questionMarks <= 1 && conversationalQuestionCount <= 2 && words <= 80;
  });
}

export function evaluateScriptAdherenceCall(campaign: VoiceCampaign, call: VoiceCall): ScriptAdherenceCallEval | null {
  const turns = displayTranscript(call).filter((turn) => turn.role === "assistant" || turn.role === "user");
  if (turns.length === 0 || assistantTurns(call).length === 0) return null;

  const checks: Record<ScriptAdherenceCheckKey, boolean> = {
    permission: hasPermissionAsk(campaign, call),
    discovery: hasDiscoveryQuestion(campaign, call),
    offer_discipline: !hasEarlyOfferPitch(campaign, call),
    concern_handling: concernHandled(call),
    guardrails: guardrailsPassed(call),
    turn_discipline: turnDisciplinePassed(call),
  };
  const failedKeys = SCRIPT_ADHERENCE_CHECKS
    .map((check) => check.key)
    .filter((key) => !checks[key]);
  const passed = SCRIPT_ADHERENCE_CHECKS.length - failedKeys.length;

  return {
    callId: call.id,
    label: callDisplayName(call),
    outcome: classifyVoiceCallOutcome(call),
    score: Math.round((passed / SCRIPT_ADHERENCE_CHECKS.length) * 100),
    failedKeys,
    checks,
  };
}

export function isScriptAdherenceCheckKey(value: string): value is ScriptAdherenceCheckKey {
  return SCRIPT_ADHERENCE_CHECKS.some((check) => check.key === value);
}

// ---------------------------------------------------------------------------
// Transcript display / recording helpers
// ---------------------------------------------------------------------------

export function transcriptTurnTimeLabel(turn: VoiceTranscriptTurn, callStartedAtValue?: string): string {
  const timing = canonicalTurnTimingMs(turn, { callStartedAt: callStartedAtValue });
  if (timing.startMs !== undefined) {
    const totalSeconds = Math.floor(timing.startMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  return new Date(turn.at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function displayTranscript(call: VoiceCall) {
  return selectDisplayTranscript(call);
}

export function recordingHref(call: VoiceCall, campaign: VoiceCampaign | null) {
  const recording = primaryRecording(call);
  if (!recording) return null;
  if (recording.storageKey) {
    return `/api/voice/recordings/${encodeURIComponent(call.id)}/${encodeURIComponent(recording.sid)}${campaign?.datasetId ? `?datasetId=${encodeURIComponent(campaign.datasetId)}` : ""}`;
  }
  return recording.twilioUrl ?? null;
}

// ---------------------------------------------------------------------------
// classifyVoiceCallOutcome (exported)
// ---------------------------------------------------------------------------

export function classifyVoiceCallOutcome(call: VoiceCall): VoiceCallOutcome {
  if (call.analysis?.outcome) return call.analysis.outcome;
  if (call.status === "failed") return "failed";
  if (call.status === "no_answer") return "no_answer";

  const text = callText(call);
  if (!text.trim()) {
    if (call.status === "completed" && (call.transcript?.length ?? 0) === 0) return "no_answer";
    return "unknown";
  }

  if (/\b(wrong number|incorrect number|not my number)\b|गलत नंबर/.test(text)) return "wrong_number";
  if (/\b(not interested|no need|don't call|do not call|stop calling|refuse|declined)\b|जरूरत नहीं|नहीं चाहिए|मत करो|नहीं है/.test(text)) {
    return "negative";
  }
  if (/\b(interested|yes|send details|whatsapp|call back|callback|advisor|want|need|promise|pay today)\b|हाँ|ठीक|भेज|शेड्यूल|बुक|पेमेंट|कॉल/.test(text)) {
    return "positive";
  }
  if (/\b(busy|call later|later|not a good time)\b|बाद में|कल|शाम/.test(text)) return "busy";
  return "neutral";
}

// ---------------------------------------------------------------------------
// getVoiceCallStageFacts (exported)
// ---------------------------------------------------------------------------

export function getVoiceCallStageFacts(call: VoiceCall) {
  const completed = call.status === "completed";
  const connected = call.status === "connected" || completed;
  const hasDuration = (call.durationSeconds ?? 0) > 0;
  const hasTranscript = (call.transcript?.length ?? 0) > 0;

  return {
    attempted: true,
    rang: call.status !== "failed",
    pickedUp: connected || hasDuration || hasTranscript,
    aiConnected: connected || hasTranscript,
    engaged20s: call.engaged || (call.durationSeconds ?? 0) >= 20,
  };
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

export function productionCalls(campaign: VoiceCampaign | null | undefined): VoiceCall[] {
  return (Array.isArray(campaign?.calls) ? campaign.calls : []).filter(isCampaignCall);
}

export function emptyOutcomeCounts(): Record<VoiceCallOutcome, number> {
  return {
    positive: 0,
    callback_scheduled: 0,
    neutral: 0,
    negative: 0,
    busy: 0,
    wrong_number: 0,
    no_answer: 0,
    failed: 0,
    unknown: 0,
  };
}

export function metricsForCalls(calls: VoiceCall[]): VoiceCampaignMetrics {
  const outcomes = emptyOutcomeCounts();

  const metrics: VoiceCampaignMetrics = {
    attempted: calls.length,
    rang: 0,
    pickedUp: 0,
    aiConnected: 0,
    engaged20s: 0,
    positive: 0,
    outcomes,
  };

  for (const call of calls) {
    const facts = getVoiceCallStageFacts(call);
    const outcome = classifyVoiceCallOutcome(call);
    if (facts.rang) metrics.rang += 1;
    if (facts.pickedUp) metrics.pickedUp += 1;
    if (facts.aiConnected) metrics.aiConnected += 1;
    if (facts.engaged20s) metrics.engaged20s += 1;
    if (outcome === "positive") metrics.positive += 1;
    metrics.outcomes[outcome] += 1;
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Simulation helpers
// ---------------------------------------------------------------------------

export function averageSimulationCallSeconds(metrics: VoiceCampaignMetrics): number {
  const noAnswerSeconds = metrics.outcomes.no_answer * 10;
  const shortOutcomeSeconds = (metrics.outcomes.failed + metrics.outcomes.wrong_number) * 13;
  const connectedSeconds = metrics.pickedUp * 135;
  const totalSeconds = noAnswerSeconds + shortOutcomeSeconds + connectedSeconds;
  return Math.max(18, totalSeconds / Math.max(metrics.attempted, 1));
}

export function simulationCapacity(simulation: NonNullable<VoiceCampaign["simulation"]>): SimulationCapacity {
  const existing = (simulation as { capacity?: SimulationCapacity }).capacity;
  if (existing && Number.isFinite(existing.effectiveCallsPerHour) && existing.effectiveCallsPerHour > 0) {
    return existing;
  }

  const averageCallSeconds = averageSimulationCallSeconds(simulation.metrics);
  const plivoConcurrencyCallsPerHour = (DEFAULT_PLIVO_CONCURRENT_CALLS * CAPACITY_UTILIZATION * 3600) / averageCallSeconds;
  const plivoCpsCallsPerHour = DEFAULT_PLIVO_OUTBOUND_CPS * CAPACITY_UTILIZATION * 3600;
  const geminiCallsPerHour = (DEFAULT_GEMINI_LIVE_CONCURRENT_SESSIONS * CAPACITY_UTILIZATION * 3600) / averageCallSeconds;
  const plivoCallsPerHour = Math.min(plivoConcurrencyCallsPerHour, plivoCpsCallsPerHour);

  return {
    plivoConcurrentCalls: DEFAULT_PLIVO_CONCURRENT_CALLS,
    plivoOutboundCps: DEFAULT_PLIVO_OUTBOUND_CPS,
    geminiConcurrentSessions: DEFAULT_GEMINI_LIVE_CONCURRENT_SESSIONS,
    limitingProvider: plivoCallsPerHour <= geminiCallsPerHour ? "plivo" : "gemini",
    utilization: CAPACITY_UTILIZATION,
    averageCallSeconds: Math.round(averageCallSeconds),
    effectiveCallsPerHour: Math.max(1, Math.floor(Math.min(plivoCallsPerHour, geminiCallsPerHour))),
  };
}

export function simulationDurationMs(simulation: VoiceCampaign["simulation"]): number {
  const durationHours = simulation?.durationHours ??
    (simulation ? simulation.audienceSize / simulationCapacity(simulation).effectiveCallsPerHour : 8);
  return Math.max(durationHours, 0.01) * 3_600_000;
}

export function simulationProgressRatio(simulation: VoiceCampaign["simulation"]): number {
  if (!simulation) return 0;
  const startedAt = new Date(simulation.generatedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  const elapsed = Date.now() - startedAt;
  return Math.max(0, Math.min(1, elapsed / simulationDurationMs(simulation)));
}

export function scaleSimulationCount(value: number, ratio: number): number {
  if (ratio >= 1) return value;
  return Math.max(0, Math.min(value, Math.floor(value * ratio)));
}

export function scaleSimulationMetrics(
  metrics: VoiceCampaignMetrics,
  ratio: number,
): VoiceCampaignMetrics {
  if (ratio >= 1) return metrics;

  const outcomes = emptyOutcomeCounts();
  const attempted = scaleSimulationCount(metrics.attempted, ratio);
  OUTCOME_ORDER.forEach((outcome) => {
    outcomes[outcome] = scaleSimulationCount(metrics.outcomes[outcome], ratio);
  });
  const assigned = OUTCOME_ORDER.reduce((sum, outcome) => sum + outcomes[outcome], 0);
  outcomes.unknown += Math.max(0, attempted - assigned);

  return {
    attempted,
    rang: Math.min(attempted, scaleSimulationCount(metrics.rang, ratio)),
    pickedUp: Math.min(attempted, scaleSimulationCount(metrics.pickedUp, ratio)),
    aiConnected: Math.min(attempted, scaleSimulationCount(metrics.aiConnected, ratio)),
    engaged20s: Math.min(attempted, scaleSimulationCount(metrics.engaged20s, ratio)),
    positive: outcomes.positive,
    outcomes,
  };
}

export function visibleSimulationTimeline(
  simulation: NonNullable<VoiceCampaign["simulation"]>,
  metrics: VoiceCampaignMetrics,
  modelCostUsd: number,
  ratio: number,
): VoiceCampaignSimulationPoint[] {
  if (ratio >= 1) return simulation.timeline;

  const points = simulation.timeline.filter((_, index) => ((index + 1) / simulation.timeline.length) < ratio);
  const currentPoint: VoiceCampaignSimulationPoint = {
    label: ratio <= 0 ? "Start" : "Now",
    attempted: metrics.attempted,
    connected: metrics.pickedUp,
    engaged: metrics.engaged20s,
    positive: metrics.positive,
    cost: Number(modelCostUsd.toFixed(2)),
  };

  if (metrics.attempted <= 0) return [currentPoint];
  return [
    { label: "Start", attempted: 0, connected: 0, engaged: 0, positive: 0, cost: 0 },
    ...points,
    currentPoint,
  ];
}

export function simulationPaceLabel(simulation: NonNullable<VoiceCampaign["simulation"]>): string {
  const capacity = simulationCapacity(simulation);
  const provider = capacity.limitingProvider === "plivo" ? "Plivo" : "Gemini";
  return `${formatCompactNumber(capacity.effectiveCallsPerHour)}/hr ${provider} cap`;
}

// ---------------------------------------------------------------------------
// getVoiceCampaignMetrics (exported)
// ---------------------------------------------------------------------------

export function getVoiceCampaignMetrics(campaign: VoiceCampaign | null | undefined): VoiceCampaignMetrics {
  const calls = productionCalls(campaign);
  if (calls.length === 0 && campaign?.simulation) {
    return scaleSimulationMetrics(campaign.simulation.metrics, simulationProgressRatio(campaign.simulation));
  }
  return metricsForCalls(calls);
}

// ---------------------------------------------------------------------------
// formatVoicePercent (exported)
// ---------------------------------------------------------------------------

export function formatVoicePercent(value: number, denominator: number): string {
  if (denominator <= 0) return "-";
  return `${Math.round((value / denominator) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Shared number/format utilities (used by panels that can't import from studio)
// ---------------------------------------------------------------------------

export function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}M`;
  }
  if (absolute >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}k`;
  }
  return value.toLocaleString();
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatStatusLabel(status: VoiceCampaign["status"] | undefined): string {
  if (!status) return "Draft";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

// ---------------------------------------------------------------------------
// Simulation retention / latency builders (needed by overview panel)
// ---------------------------------------------------------------------------

export function buildRetentionFromMetrics(metrics: VoiceCampaignMetrics): VoiceCampaignSimulationRetentionPoint[] {
  const pickedUp = Math.max(0, metrics.pickedUp);
  const conversational = metrics.outcomes.positive + metrics.outcomes.neutral + metrics.outcomes.negative;
  const retained45 = Math.min(
    metrics.engaged20s,
    Math.round(conversational + metrics.outcomes.busy * 0.35),
  );
  const retained90 = Math.min(
    retained45,
    Math.round(metrics.outcomes.positive + metrics.outcomes.neutral * 0.48 + metrics.outcomes.negative * 0.22),
  );
  const retained120 = Math.min(
    retained90,
    Math.round(metrics.outcomes.positive * 0.78 + metrics.outcomes.neutral * 0.18),
  );
  const retained180 = Math.min(retained120, Math.round(metrics.outcomes.positive * 0.42));
  const rows = [
    { label: "Pickup", elapsedSeconds: 0, retained: pickedUp },
    { label: "20s", elapsedSeconds: 20, retained: metrics.engaged20s },
    { label: "45s", elapsedSeconds: 45, retained: retained45 },
    { label: "90s", elapsedSeconds: 90, retained: retained90 },
    { label: "2m", elapsedSeconds: 120, retained: retained120 },
    { label: "3m", elapsedSeconds: 180, retained: retained180 },
  ];

  return rows.map((row) => ({
    ...row,
    percent: percentOf(row.retained, pickedUp),
  }));
}

export function buildRetentionFromCalls(calls: VoiceCall[]): VoiceCampaignSimulationRetentionPoint[] {
  const pickedUpCalls = calls.filter((call) => getVoiceCallStageFacts(call).pickedUp);
  const pickedUp = pickedUpCalls.length;
  const rows = [
    { label: "Pickup", elapsedSeconds: 0, retained: pickedUp },
    { label: "20s", elapsedSeconds: 20, retained: pickedUpCalls.filter((call) => (call.durationSeconds ?? 0) >= 20 || call.engaged).length },
    { label: "45s", elapsedSeconds: 45, retained: pickedUpCalls.filter((call) => (call.durationSeconds ?? 0) >= 45).length },
    { label: "90s", elapsedSeconds: 90, retained: pickedUpCalls.filter((call) => (call.durationSeconds ?? 0) >= 90).length },
    { label: "2m", elapsedSeconds: 120, retained: pickedUpCalls.filter((call) => (call.durationSeconds ?? 0) >= 120).length },
    { label: "3m", elapsedSeconds: 180, retained: pickedUpCalls.filter((call) => (call.durationSeconds ?? 0) >= 180).length },
  ];

  return rows.map((row) => ({
    ...row,
    percent: percentOf(row.retained, pickedUp),
  }));
}

export function scaleSimulationRetention(
  rows: VoiceCampaignSimulationRetentionPoint[] | undefined,
  metrics: VoiceCampaignMetrics,
): VoiceCampaignSimulationRetentionPoint[] {
  if (!rows || rows.length === 0) return buildRetentionFromMetrics(metrics);
  const pickedUp = Math.max(0, metrics.pickedUp);
  let previous = pickedUp;

  return rows.map((row, index) => {
    const retained = index === 0
      ? pickedUp
      : Math.min(previous, Math.round((pickedUp * row.percent) / 100));
    previous = retained;
    return {
      ...row,
      retained,
      percent: percentOf(retained, pickedUp),
    };
  });
}

// ---------------------------------------------------------------------------
// Latency helpers
// ---------------------------------------------------------------------------

function timestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1));
  return sorted[index];
}

export function callTimestamp(call: VoiceCall): number {
  const values = [call.analysis?.analyzedAt, call.endedAt, call.startedAt]
    .map((value) => value ? new Date(value).getTime() : 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : 0;
}

function callChartLabel(call: VoiceCall, index: number): string {
  const timestamp = callTimestamp(call);
  if (timestamp <= 0) return `Call ${index + 1}`;
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function turnLatencySamples(call: VoiceCall): number[] {
  const turns = displayTranscript(call);
  const samples: number[] = [];

  turns.forEach((turn, index) => {
    if (turn.role !== "user") return;
    const nextAssistant = turns.slice(index + 1).find((candidate) => candidate.role === "assistant");
    if (!nextAssistant) return;
    const userStart = turn.startMs ?? timestampMs(turn.at);
    const assistantStart = nextAssistant.startMs ?? timestampMs(nextAssistant.at);
    if (userStart === null || assistantStart === null) return;
    const delta = assistantStart - userStart;
    if (delta >= 200 && delta <= 20_000) samples.push(delta);
  });

  return samples;
}

export function buildLatencyFromCalls(calls: VoiceCall[]): VoiceCampaignSimulationLatencyPoint[] {
  const rows = [...calls]
    .sort((a, b) => callTimestamp(a) - callTimestamp(b))
    .map((call, index) => {
      const samples = turnLatencySamples(call);
      if (samples.length === 0) return null;
      return {
        label: callChartLabel(call, index),
        p50Ms: percentile(samples, 50),
        p90Ms: percentile(samples, 90),
        sampleSize: samples.length,
      };
    })
    .filter((row): row is VoiceCampaignSimulationLatencyPoint => Boolean(row));

  return rows.slice(-12);
}

export function buildFallbackSimulationLatency(
  simulation: NonNullable<VoiceCampaign["simulation"]>,
  metrics: VoiceCampaignMetrics,
): VoiceCampaignSimulationLatencyPoint[] {
  if (metrics.pickedUp <= 0) return [];

  const pressure = simulationCapacity(simulation).limitingProvider === "gemini" ? 170 : 80;
  const timeline = simulation.timeline.length > 0
    ? simulation.timeline
    : visibleSimulationTimeline(simulation, metrics, simulation.modelSpendUsd, 1);
  return timeline.map((point, index) => {
    const ratio = (index + 1) / Math.max(timeline.length, 1);
    const wave = Math.sin(ratio * Math.PI * 1.35) * 85;
    const p50Ms = Math.round(Math.max(520, 860 + pressure + wave));
    return {
      label: point.label,
      p50Ms,
      p90Ms: Math.round(p50Ms + 580 + pressure * 0.5),
      sampleSize: Math.max(1, Math.round(Math.max(metrics.pickedUp, 1) * ratio)),
    };
  });
}

export function scaleSimulationLatency(
  rows: VoiceCampaignSimulationLatencyPoint[] | undefined,
  simulation: NonNullable<VoiceCampaign["simulation"]>,
  metrics: VoiceCampaignMetrics,
): VoiceCampaignSimulationLatencyPoint[] {
  if (metrics.pickedUp <= 0) return [];

  const sourceRows = rows && rows.length > 0
    ? rows
    : buildFallbackSimulationLatency(simulation, metrics);
  return sourceRows.map((row, index) => ({
    ...row,
    sampleSize: Math.max(1, Math.round(Math.max(metrics.pickedUp, 1) * ((index + 1) / sourceRows.length))),
  }));
}

// ---------------------------------------------------------------------------
// Overview timeline builder
// ---------------------------------------------------------------------------

export function estimateGeminiLiveAudioCost(calls: VoiceCall[]) {
  const inputMinutes = calls.reduce((sum, call) => {
    const seconds = call.durationSeconds ?? primaryRecording(call)?.durationSeconds ?? 0;
    return sum + Math.max(seconds, 0);
  }, 0) / 60;
  const outputMinutes = inputMinutes * ESTIMATED_AGENT_TALK_SHARE;
  return {
    inputMinutes,
    outputMinutes,
    totalUsd: (inputMinutes * GEMINI_LIVE_INPUT_AUDIO_PER_MINUTE_USD) +
      (outputMinutes * GEMINI_LIVE_OUTPUT_AUDIO_PER_MINUTE_USD),
  };
}

export function buildOverviewTimeline(calls: VoiceCall[]) {
  const sorted = [...calls].sort((a, b) => callTimestamp(a) - callTimestamp(b));
  let attempted = 0;
  let connected = 0;
  let engaged = 0;
  let positive = 0;
  let cost = 0;

  const points = sorted.map((call, index) => {
    const facts = getVoiceCallStageFacts(call);
    const outcome = classifyVoiceCallOutcome(call);
    attempted += 1;
    if (facts.pickedUp) connected += 1;
    if (facts.engaged20s) engaged += 1;
    if (outcome === "positive") positive += 1;
    cost += estimateGeminiLiveAudioCost([call]).totalUsd;

    return {
      label: callChartLabel(call, index),
      attempted,
      connected,
      engaged,
      positive,
      cost: Number(cost.toFixed(4)),
    };
  });

  if (points.length === 1) {
    return [{ label: "Start", attempted: 0, connected: 0, engaged: 0, positive: 0, cost: 0 }, ...points];
  }

  return points;
}

// ---------------------------------------------------------------------------
// Cohort / audience breakdown helpers
// ---------------------------------------------------------------------------

export const COHORT_BREAKDOWN_PRIORITY = [
  "gender",
  "investor_type",
  "city_tier",
  "state",
  "city",
  "risk_profile",
  "kyc_status",
  "bank_link_method",
  "kyc_method",
  "bank",
  "annual_income",
  "occupation",
  "acquisition_channel",
  "source_medium",
  "goal_type",
  "fund_category",
  "subcategory",
  "amc",
  "fund_risk_level",
  "fi_select",
  "campaign_type",
  "calculator_type",
  "platform",
];

export function normalizedBreakdownProperty(property: string): string {
  return property.trim().toLowerCase();
}

export function isAudienceBreakdown(property: string): boolean {
  return COHORT_BREAKDOWN_PRIORITY.includes(normalizedBreakdownProperty(property));
}

export function breakdownPriority(property: string): number {
  const index = COHORT_BREAKDOWN_PRIORITY.indexOf(normalizedBreakdownProperty(property));
  return index === -1 ? COHORT_BREAKDOWN_PRIORITY.length : index;
}

export function preferredBreakdowns(breakdowns: PropertyBreakdown[]): PropertyBreakdown[] {
  return [...breakdowns]
    .filter((breakdown) => breakdown.values.length > 1 && isAudienceBreakdown(breakdown.property))
    .sort((a, b) => {
      const priority = breakdownPriority(a.property) - breakdownPriority(b.property);
      if (priority !== 0) return priority;
      return b.values.reduce((sum, value) => sum + value.count, 0) -
        a.values.reduce((sum, value) => sum + value.count, 0);
    })
    .slice(0, 3);
}

export function cohortSliceMetrics(
  count: number,
  metrics: VoiceCampaignMetrics,
  totalRecipients: number,
) {
  const share = totalRecipients > 0 ? count / totalRecipients : 0;
  const attempted = Math.min(count, Math.round(metrics.attempted * share));
  const pickedUp = Math.min(attempted, Math.round(metrics.pickedUp * share));
  const positive = Math.min(pickedUp, Math.round(metrics.positive * share));
  const noAnswer = Math.min(attempted, Math.round(metrics.outcomes.no_answer * share));

  return {
    attempted,
    pickedUp,
    positive,
    noAnswer,
    contactRate: attempted > 0 ? Math.round((pickedUp / attempted) * 100) : 0,
    positiveRate: attempted > 0 ? Math.round((positive / attempted) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Campaign pace label
// ---------------------------------------------------------------------------

export function campaignPaceLabel(campaign: VoiceCampaign | null, attempted: number): string {
  if (!campaign?.launchedAt || attempted <= 0) return "-";
  const launchedAt = new Date(campaign.launchedAt).getTime();
  if (!Number.isFinite(launchedAt)) return "-";
  const hours = Math.max((Date.now() - launchedAt) / 3_600_000, 0.1);
  const rate = attempted / hours;
  if (rate >= 10) return `${Math.round(rate).toLocaleString()}/hr`;
  return `${rate.toFixed(1)}/hr`;
}

// ---------------------------------------------------------------------------
// Success definition helpers
// ---------------------------------------------------------------------------

export interface SuccessMetricReadout {
  metric: VoiceCampaignSuccessMetric;
  available: boolean;
  count: number;
  denominator: number;
  rate?: number;
  note: string;
}

export function hasCallbackScheduledSignal(call: VoiceCall): boolean {
  if ((call.followUps ?? []).length > 0) return true;
  const text = `${call.analysis?.nextStep ?? ""} ${call.analysis?.summary ?? ""} ${call.analysis?.reason ?? ""} ${callText(call)}`;
  return /\b(callback|call back|advisor|adviser|specialist|appointment|schedule|scheduled|whatsapp follow[-\s]?up)\b/i.test(text);
}

export function metricTracksCallback(metric: VoiceCampaignSuccessMetric): boolean {
  if (metric.type === "call_outcome" && metric.outcome === "callback_scheduled") return true;
  return /\b(callback|call back|advisor follow[-\s]?up|sales follow[-\s]?up)\b/i.test(metric.label);
}

export function callbackMetric(definition: VoiceCampaignSuccessDefinition): VoiceCampaignSuccessMetric {
  return [definition.primary, ...definition.secondary].find(metricTracksCallback) ?? {
    id: "callback-scheduled",
    label: "Callback scheduled",
    type: "call_outcome",
    outcome: "callback_scheduled",
    windowDays: 0,
  };
}

/**
 * A call counts toward success if it satisfies ANY signal the campaign has
 * actually configured on "Success Metrics" — on-call criterion, link click,
 * or a matched "In your system" webhook event — combined with OR, not
 * gated behind a single "selected" detection method. If nothing has been
 * configured at all, falls back to the LLM's default "positive" outcome
 * classification so untouched campaigns keep showing a sensible number.
 */
function describeConfiguredSignals(
  hasCriterion: boolean,
  hasLink: boolean,
  fallbackOutcome: VoiceCallOutcome | undefined,
  anyConfigured: boolean,
): string {
  const parts: string[] = [];
  if (fallbackOutcome) {
    parts.push(anyConfigured
      ? `${SUCCESS_OUTCOME_LABELS[fallbackOutcome]} outcome`
      : `${SUCCESS_OUTCOME_LABELS[fallbackOutcome]} outcome (default — no signal configured yet)`);
  }
  if (hasCriterion) parts.push("on-call criterion met");
  if (hasLink) parts.push("link click");
  parts.push("matched webhook event"); // always live once a campaign exists — see enrichCallsWithSuccessSignals
  return `Counts calls matching: ${parts.join(", ")}.`;
}

export function successMetricReadout(
  metric: VoiceCampaignSuccessMetric,
  calls: VoiceCall[],
  metrics: VoiceCampaignMetrics,
): SuccessMetricReadout {
  const denominator = metrics.attempted;
  if (metric.type === "sql") {
    return {
      metric,
      available: false,
      count: 0,
      denominator,
      note: "Defined as SQL; attribution needs a post-call recipient query.",
    };
  }

  const hasCriterion = Boolean(metric.criterion?.trim());
  const hasLink = Boolean(metric.destinationUrl?.trim());
  const configuredOutcome = metric.type === "call_outcome" ? metric.outcome : undefined;
  const anyConfigured = hasCriterion || hasLink || Boolean(configuredOutcome);
  // Nothing configured yet (brand-new campaign) — fall back to "positive" so the
  // card still shows a meaningful number instead of always reading zero.
  const fallbackOutcome: VoiceCallOutcome | undefined = anyConfigured ? configuredOutcome : "positive";

  function callSucceeds(call: VoiceCall): boolean {
    if (hasCriterion && call.analysis?.criterionMet === true) return true;
    if (hasLink && call.linkClicked === true) return true;
    if (call.systemEventMatched === true) return true;
    if (fallbackOutcome && classifyVoiceCallOutcome(call) === fallbackOutcome) return true;
    return false;
  }

  const count = calls.filter(callSucceeds).length;
  return {
    metric,
    available: denominator > 0,
    count,
    denominator,
    rate: denominator > 0 ? count / denominator : undefined,
    note: describeConfiguredSignals(hasCriterion, hasLink, fallbackOutcome, anyConfigured),
  };
}

// ---------------------------------------------------------------------------
// Rate / lift formatters (used by overview and experiment panels)
// ---------------------------------------------------------------------------

export function formatRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  const percent = value * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1).replace(/\.0$/, "")}%`;
}

export function formatLift(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 10) return `${Math.round(value)}x`;
  return `${value.toFixed(1).replace(/\.0$/, "")}x`;
}

export function genderStatusMessage(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "Voice gender check is still running.";
    case "failed":
      return "Voice gender check failed — see server logs for the call.";
    case "skipped":
      return "Voice gender check was skipped (no recording or analysis service unavailable).";
    default:
      return "Voice gender not detected for this call.";
  }
}
