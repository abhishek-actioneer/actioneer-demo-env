"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, BarChart3, ChevronRight, CircleDot, Link2, ListChecks, MessageSquare, MessageSquareText, Sparkles, Workflow, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChartCore } from "@/components/chart/chart-core";
import { CallRecordingWaveform } from "@/components/voice-campaigns/call-recording-waveform";
import { VoiceCampaignClusterVisualization } from "@/components/voice-campaigns/voice-campaign-cluster-visualization";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { VoiceCampaignInsightCluster, VoiceCampaignInsightsPayload } from "@/lib/voice-campaign-insights-types";
import { ACTIVE_CONNECTIONS } from "@/lib/active-connections";
import { cn } from "@/lib/utils";
import type { ChartSpec } from "@/lib/chart-types";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";
import type {
  VoiceCall,
  VoiceCallOutcome,
  VoiceCampaign,
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessDefinition,
  VoiceCampaignSimulationLatencyPoint,
  VoiceCampaignSimulationPoint,
  VoiceCampaignSimulationRetentionPoint,
  VoiceTranscriptTurn,
} from "@/lib/voice-campaign-types";
import { selectDisplayTranscript } from "@/lib/voice-transcript-display";
import { canonicalTurnTimingMs } from "@/lib/voice-transcript-sort";
import {
  classifyVoiceCallOutcome,
  getVoiceCallStageFacts,
  formatVoicePercent,
  productionCalls,
  metricsForCalls,
  simulationCapacity,
  simulationProgressRatio,
  scaleSimulationMetrics,
  visibleSimulationTimeline,
  simulationPaceLabel,
  type VoiceCampaignMetrics,
  OUTCOME_LABELS,
  OUTCOME_ORDER,
  CRM_CONNECTOR_PATTERN,
  hasCallbackScheduledSignal,
  metricTracksCallback,
  callbackMetric,
  successMetricReadout,
  genderStatusMessage,
} from "@/lib/voice-campaign-analysis";
import { VoiceOutcomePill } from "@/components/voice-campaigns/voice-campaign-studio";
import type { VoiceOverviewDrilldown } from "@/components/voice-campaigns/voice-campaign-studio";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_LIVE_INPUT_AUDIO_PER_MINUTE_USD = 0.005;
const GEMINI_LIVE_OUTPUT_AUDIO_PER_MINUTE_USD = 0.018;
const ESTIMATED_AGENT_TALK_SHARE = 0.45;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface PropertyBreakdown {
  property: string;
  displayName: string;
  values: { name: string; count: number }[];
}

interface SegmentOverviewPayload {
  id: string;
  sql: string;
  userCount: number;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function maskPhone(num: string): string {
  if (num.length < 7) return num;
  return `${num.slice(0, num.length - 6)}...${num.slice(-3)}`;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "-";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function callStartedAt(call: VoiceCall): string {
  if (!call.startedAt) return "-";
  return new Date(call.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function callStatusLabel(call: VoiceCall): string {
  if (call.status === "no_answer") return "No answer";
  return call.status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function callRuntimeLabel(call: VoiceCall): string {
  if (call.provider === "plivo") return "Gemini";
  return "-";
}

function hasCallTag(call: VoiceCall, tag: string): boolean {
  return (call.tags ?? []).some((value) => value.toLowerCase() === tag);
}

function isLiveTestCall(call: VoiceCall): boolean {
  return hasCallTag(call, "live test");
}

function isTestCall(call: VoiceCall): boolean {
  return isLiveTestCall(call) || hasCallTag(call, "test call");
}

function callDisplayName(call: VoiceCall): string {
  if (isLiveTestCall(call)) return "Live test";
  if (isTestCall(call)) return "Test call";
  return maskPhone(call.toNumber);
}

function hasPlayableRecording(recording: VoiceCall["recording"] | VoiceCall["bridgeRecording"]): boolean {
  return Boolean(recording?.storageKey || recording?.twilioUrl);
}

function primaryRecording(call: VoiceCall) {
  if (isLiveTestCall(call) && hasPlayableRecording(call.bridgeRecording)) {
    return call.bridgeRecording;
  }
  if (hasPlayableRecording(call.bridgeRecording)) return call.bridgeRecording;
  return call.recording;
}

function isProviderOnlySummary(summary: string | undefined): boolean {
  const text = summary?.trim() ?? "";
  return !text ||
    /^Gemini\b.*\baccepted\b/i.test(text) ||
    /^Browser live test\b/i.test(text);
}

function meaningfulCallSummary(call: VoiceCall): string | undefined {
  if (call.analysis?.summary) return call.analysis.summary;
  if (!isProviderOnlySummary(call.summary)) return call.summary;
  return undefined;
}

function callResponseSummary(call: VoiceCall): string {
  const summary = meaningfulCallSummary(call);
  if (summary) return summary;
  if ((call.transcript?.length ?? 0) === 0) return "No customer response captured yet.";
  return "Transcript captured; response analysis pending.";
}

function uniqueNonEmpty(values: Array<string | undefined>, max = 3): string[] {
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

const SCRIPT_ADHERENCE_CHECKS = [
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

type ScriptAdherenceCheckKey = typeof SCRIPT_ADHERENCE_CHECKS[number]["key"];

interface ScriptAdherenceCallEval {
  callId: string;
  label: string;
  outcome: VoiceCallOutcome;
  score: number;
  failedKeys: ScriptAdherenceCheckKey[];
  checks: Record<ScriptAdherenceCheckKey, boolean>;
}

function percentOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function normalizedScriptEvalText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/["""'.:,;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptText(call: VoiceCall, role?: "assistant" | "user"): string {
  return displayTranscript(call)
    .filter((turn) => !role || turn.role === role)
    .map((turn) => turn.text)
    .join(" ");
}

function assistantTurns(call: VoiceCall) {
  return displayTranscript(call).filter((turn) => turn.role === "assistant");
}

function hasPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasPermissionAsk(campaign: VoiceCampaign, call: VoiceCall): boolean {
  const text = normalizedScriptEvalText(`${campaign.firstMessage} ${transcriptText(call, "assistant")}`);
  return hasPattern(text, [
    /\b(permission|minute|moment|speak|talk|time)\b/,
    /\b(baat|bol|bolna|karna|theek|abhi)\b/,
    /मिनट|बात|बोल|समय|ठीक|अनुमति|करना/,
  ]);
}

function workflowTextForKinds(campaign: VoiceCampaign, kinds: string[]): string {
  const nodes = campaign.workflow?.nodes ?? [];
  return nodes
    .filter((node) => kinds.includes(node.data.kind))
    .map((node) => `${node.data.title} ${node.data.body}`)
    .join(" ");
}

function meaningfulEvalTokens(value: string): string[] {
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

function tokenOverlapCount(sourceText: string, targetText: string): number {
  const source = new Set(meaningfulEvalTokens(sourceText));
  if (source.size === 0) return 0;
  const target = normalizedScriptEvalText(targetText);
  let count = 0;
  source.forEach((token) => {
    if (target.includes(token)) count += 1;
  });
  return count;
}

function hasDiscoveryQuestion(campaign: VoiceCampaign, call: VoiceCall): boolean {
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

function mentionsCallbackOrOffer(text: string, campaign: VoiceCampaign): boolean {
  const normalized = normalizedScriptEvalText(text);
  const offer = normalizedScriptEvalText(`${campaign.purposeName} ${campaign.purposeId}`);
  const offerTokens = meaningfulEvalTokens(offer);
  return hasPattern(normalized, [
    /\b(callback|call back|advisor|adviser|specialist|review|offer|team|consultation|portfolio)\b/,
    /कॉलबैक|कॉल\s*बैक|सलाहकार|रिव्यू|ऑफर|टीम|समीक्षा/,
  ]) || offerTokens.some((token) => normalized.includes(token));
}

function hasEarlyOfferPitch(campaign: VoiceCampaign, call: VoiceCall): boolean {
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

function userHasConcern(call: VoiceCall): boolean {
  const text = normalizedScriptEvalText(transcriptText(call, "user"));
  return hasPattern(text, [
    /\b(busy|later|not interested|wrong person|wrong number|stop|remove|complaint|problem|issue|confused|price|expensive|charges?)\b/,
    /\b(baad|busy|nahi|nahin|mat|ruk|problem|issue|price|charge)\b/,
    /व्यस्त|बाद|नहीं|गलत|बंद|मत|समस्या|शिकायत|महंगा|कीमत|चार्ज/,
  ]);
}

function concernHandled(call: VoiceCall): boolean {
  if (!userHasConcern(call)) return true;
  const assistant = normalizedScriptEvalText(transcriptText(call, "assistant"));
  return hasPattern(assistant, [
    /\b(sorry|apolog|later|better time|callback time|remove|stop|noted|understand|check|help)\b/,
    /\b(theek|samjha|maaf|baad|samay|note|madad|check)\b/,
    /ठीक|समझ|माफ|बाद|समय|नोट|मदद|चेक|धन्यवाद/,
  ]);
}

function guardrailsPassed(call: VoiceCall): boolean {
  const assistant = normalizedScriptEvalText(transcriptText(call, "assistant"));
  return !hasPattern(assistant, [
    /\b(otp|password|card number|cvv|aadhaar|aadhar|pan number|guaranteed|guarantee|assured return|profit guaranteed)\b/,
    /ओटीपी|पासवर्ड|कार्ड|सीवीवी|आधार|पैन|गारंटी|पक्का\s*रिटर्न|लाभ\s*पक्का/,
  ]);
}

function turnDisciplinePassed(call: VoiceCall): boolean {
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

function evaluateScriptAdherenceCall(campaign: VoiceCampaign, call: VoiceCall): ScriptAdherenceCallEval | null {
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

function transcriptTurnTimeLabel(turn: VoiceTranscriptTurn, callStartedAt?: string): string {
  const timing = canonicalTurnTimingMs(turn, { callStartedAt });
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

function displayTranscript(call: VoiceCall) {
  return selectDisplayTranscript(call);
}

function recordingHref(call: VoiceCall, campaign: VoiceCampaign | null) {
  const recording = primaryRecording(call);
  if (!recording) return null;
  if (recording.storageKey) {
    return `/api/voice/recordings/${encodeURIComponent(call.id)}/${encodeURIComponent(recording.sid)}${campaign?.datasetId ? `?datasetId=${encodeURIComponent(campaign.datasetId)}` : ""}`;
  }
  return recording.twilioUrl ?? null;
}

function formatRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  const percent = value * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatLift(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 10) return `${Math.round(value)}x`;
  return `${value.toFixed(1).replace(/\.0$/, "")}x`;
}

function experimentAudienceCounts(
  totalRecipients: number,
  split: VoiceCampaignExperimentSplit,
): { testCount: number; controlCount: number; callableCount: number } {
  const total = Math.max(0, Math.round(totalRecipients));
  if (!split.enabled) {
    return { testCount: total, controlCount: 0, callableCount: total };
  }
  const testCount = Math.max(0, Math.round((total * split.testPercent) / 100));
  const controlCount = Math.max(total - testCount, 0);
  return { testCount, controlCount, callableCount: testCount };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatCompactNumber(value: number): string {
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

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

function formatStatusLabel(status: VoiceCampaign["status"] | undefined): string {
  if (!status) return "Draft";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function callTimestamp(call: VoiceCall): number {
  const values = [call.analysis?.analyzedAt, call.endedAt, call.startedAt]
    .map((value) => value ? new Date(value).getTime() : 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : 0;
}

function campaignPaceLabel(campaign: VoiceCampaign | null, attempted: number): string {
  if (!campaign?.launchedAt || attempted <= 0) return "-";
  const launchedAt = new Date(campaign.launchedAt).getTime();
  if (!Number.isFinite(launchedAt)) return "-";
  const hours = Math.max((Date.now() - launchedAt) / 3_600_000, 0.1);
  const rate = attempted / hours;
  if (rate >= 10) return `${Math.round(rate).toLocaleString()}/hr`;
  return `${rate.toFixed(1)}/hr`;
}

function estimateGeminiLiveAudioCost(calls: VoiceCall[]) {
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

function buildOverviewTimeline(calls: VoiceCall[]) {
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

function buildRetentionFromMetrics(metrics: VoiceCampaignMetrics): VoiceCampaignSimulationRetentionPoint[] {
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

function buildRetentionFromCalls(calls: VoiceCall[]): VoiceCampaignSimulationRetentionPoint[] {
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

function scaleSimulationRetention(
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

function turnLatencySamples(call: VoiceCall): number[] {
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

function buildLatencyFromCalls(calls: VoiceCall[]): VoiceCampaignSimulationLatencyPoint[] {
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

function buildFallbackSimulationLatency(
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

function scaleSimulationLatency(
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

const COHORT_BREAKDOWN_PRIORITY = [
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

function normalizedBreakdownProperty(property: string): string {
  return property.trim().toLowerCase();
}

function isAudienceBreakdown(property: string): boolean {
  return COHORT_BREAKDOWN_PRIORITY.includes(normalizedBreakdownProperty(property));
}

function breakdownPriority(property: string): number {
  const index = COHORT_BREAKDOWN_PRIORITY.indexOf(normalizedBreakdownProperty(property));
  return index === -1 ? COHORT_BREAKDOWN_PRIORITY.length : index;
}

function preferredBreakdowns(breakdowns: PropertyBreakdown[]): PropertyBreakdown[] {
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

function cohortSliceMetrics(
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

function scriptCheckLabel(key: ScriptAdherenceCheckKey): string {
  return SCRIPT_ADHERENCE_CHECKS.find((check) => check.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function CohortBehaviorTable({
  breakdowns,
  loading,
  metrics,
  totalRecipients,
}: {
  breakdowns: PropertyBreakdown[];
  loading: boolean;
  metrics: VoiceCampaignMetrics;
  totalRecipients: number;
}) {
  const selectedBreakdowns = preferredBreakdowns(breakdowns);

  if (loading) {
    return <EmptyChartState label="Loading segment slices..." />;
  }

  if (selectedBreakdowns.length === 0) {
    return <EmptyChartState label="No audience profile slices are available for this segment yet." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] border-separate border-spacing-0 bg-white text-sm">
        <thead className="bg-neutral-50">
          <tr className="text-left text-[9.9px] uppercase tracking-[0.08em] text-muted-foreground">
            <th className="border-b border-border px-3 py-2 font-medium">Slice</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">Audience</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">Est. attempted</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">Est. contact</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">Est. positive</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">Est. no answer</th>
          </tr>
        </thead>
        {selectedBreakdowns.map((breakdown) => (
          <tbody key={breakdown.property}>
            <tr>
              <td colSpan={6} className="px-3 pb-1 pt-4 text-[9.9px] font-medium uppercase text-muted-foreground">
                {breakdown.displayName}
              </td>
            </tr>
            {breakdown.values.slice(0, 4).map((value) => {
              const slice = cohortSliceMetrics(value.count, metrics, totalRecipients);
              const audienceShare = clampPercent((value.count / Math.max(totalRecipients, 1)) * 100);
              return (
                <tr key={`${breakdown.property}-${value.name}`} className="bg-white align-middle hover:bg-neutral-50/80">
                  <td className="border-b border-border/60 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{value.name || "(empty)"}</p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground/70"
                          style={{ width: `${audienceShare}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">
                    <p className="font-medium">{formatCompactNumber(value.count)}</p>
                    <p className="text-xs text-muted-foreground">{Math.round(audienceShare)}%</p>
                  </td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">{formatCompactNumber(slice.attempted)}</td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">
                    <p>{formatCompactNumber(slice.pickedUp)}</p>
                    <p className="text-xs text-muted-foreground">{slice.contactRate}%</p>
                  </td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">
                    <p>{formatCompactNumber(slice.positive)}</p>
                    <p className="text-xs text-muted-foreground">{slice.positiveRate}%</p>
                  </td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">{formatCompactNumber(slice.noAnswer)}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function OverviewMetricTile({
  label,
  value,
  detail,
  wide,
}: {
  label: string;
  value: string;
  detail: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-background p-4 shadow-[0_0_0_1px_var(--color-border)]", wide && "md:col-span-2 xl:col-span-1")}>
      <p className="text-[9.9px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function DashboardCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg bg-background shadow-[0_0_0_1px_var(--color-border)]", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn("p-5", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

function DrilldownButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListChecks className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

function hasCrmConnectorConnected(): boolean {
  return ACTIVE_CONNECTIONS.some((connection) => CRM_CONNECTOR_PATTERN.test(connection.name));
}

function CallbackRoutingPrompt({
  callbackRequests,
  callbackRate,
  attempted,
  crmConnected,
}: {
  callbackRequests: number;
  callbackRate?: number;
  attempted: number;
  crmConnected: boolean;
}) {
  const callbackLabel = callbackRequests === 1 ? "callback scheduled" : "callbacks scheduled";
  return (
    <div className="relative h-full overflow-hidden rounded-md border border-border bg-muted/20 p-4 text-sm">
      <div className="flex h-full min-h-[240px] flex-col justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">Callback routing</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-5xl font-semibold leading-none tabular-nums">{formatCompactNumber(callbackRequests)}</span>
            <span className="text-base font-semibold leading-tight">{callbackLabel}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {formatRate(callbackRate)} of {formatCompactNumber(attempted)} test calls
          </p>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            {crmConnected
              ? "Create advisor tasks with call summaries and follow-up context."
              : "Connect CRM to turn callback demand into advisor tasks."}
          </p>
        </div>
        <a
          href="/integrations"
          className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Link2 className="size-4" />
          {crmConnected ? "Send to CRM" : "Connect CRM and send"}
        </a>
      </div>
    </div>
  );
}

function SuccessDefinitionPanel({
  definition,
  calls,
  metrics,
  split,
  totalRecipients,
}: {
  definition: VoiceCampaignSuccessDefinition;
  calls: VoiceCall[];
  metrics: VoiceCampaignMetrics;
  split: VoiceCampaignExperimentSplit;
  totalRecipients: number;
}) {
  const primary = successMetricReadout(definition.primary, calls, metrics);
  const callbackReadout = successMetricReadout(callbackMetric(definition), calls, metrics);
  const audienceCounts = experimentAudienceCounts(totalRecipients, split);
  const usesHoldout = split.enabled && definition.baseline.source === "holdout";
  const baselineRate = definition.baseline.rate;
  const lift = primary.rate !== undefined && baselineRate !== undefined && baselineRate > 0
    ? primary.rate / baselineRate
    : undefined;
  const linkedRecipients = calls.filter((call) => call.recipientId).length;
  const primaryIsCallbackSignal = primary.metric.outcome === "callback_scheduled";
  const callbackRequests = callbackReadout.count;
  const tracksCallback = [definition.primary, ...definition.secondary].some(metricTracksCallback);
  const showCallbackRouting = tracksCallback || callbackRequests > 0;
  const crmConnected = hasCrmConnectorConnected();
  const percentValue = (count: number) => metrics.attempted > 0 ? Number(((count / metrics.attempted) * 100).toFixed(1)) : 0;
  const signalRows = [
    { label: "Callback", rate: percentValue(callbackReadout.count), count: callbackReadout.count },
    { label: "Positive", rate: percentValue(metrics.positive), count: metrics.positive },
    { label: "Engaged", rate: percentValue(metrics.engaged20s), count: metrics.engaged20s },
    { label: "Picked up", rate: percentValue(metrics.pickedUp), count: metrics.pickedUp },
  ];
  const signalChartSpec: ChartSpec = {
    type: "bar",
    title: "Call signals",
    data: signalRows,
    xKey: "label",
    yKeys: ["rate"],
    yLabels: ["Share"],
    format: { rate: "percent" },
    yAxisLabel: "Share of test calls",
  };

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-4", showCallbackRouting ? "2xl:grid-cols-[minmax(0,1fr)_320px]" : "")}>
        <div className="min-w-0">
          <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:pr-5">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-muted-foreground">Call signals</p>
              <p className="mt-1 text-sm text-muted-foreground">Response signals across called test users.</p>
            </div>
            <p className="whitespace-nowrap text-sm font-medium leading-5 tabular-nums sm:text-right">{formatCompactNumber(metrics.attempted)} test calls</p>
          </div>
          <ChartCore spec={signalChartSpec} height={250} />
        </div>

        {showCallbackRouting && (
          <CallbackRoutingPrompt
            callbackRequests={callbackRequests}
            callbackRate={callbackReadout.rate}
            attempted={metrics.attempted}
            crmConnected={crmConnected}
          />
        )}
      </div>

      <div className="grid gap-4 border-t border-border pt-4 text-sm md:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Primary business outcome</p>
          <p className="mt-1 font-medium">{primary.metric.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {primaryIsCallbackSignal
              ? "Callback is demand generated by the test call. Use CRM routing to turn it into advisor follow-up."
              : "Lift uses this outcome once test and control attribution are available."}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Experiment split</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="font-medium tabular-nums">{formatCompactNumber(audienceCounts.testCount)}</span> test</span>
            <span><span className="font-medium tabular-nums">{formatCompactNumber(audienceCounts.controlCount)}</span> control</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{usesHoldout ? "Control is protected for downstream conversion measurement." : "No holdout baseline configured."}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Downstream lift</p>
          <p className="mt-1 font-medium">{lift === undefined ? "Pending outcome data" : formatLift(lift)}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {lift !== undefined
              ? `${formatRate(primary.rate)} test / ${formatRate(baselineRate)} control.`
              : primaryIsCallbackSignal
                ? `Lift needs a downstream event for both arms. ${formatCompactNumber(linkedRecipients)} linked outcomes in the ${definition.attributionWindowDays}-day window.`
                : usesHoldout
                  ? `Lift = test success rate / control success rate. Waiting for outcomes in the ${definition.attributionWindowDays}-day window.`
                  : "Set a holdout or baseline to calculate lift."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SegmentBaselinePanel({
  campaign,
  split,
  breakdowns,
  loading,
  totalRecipients,
  linkedRecipients,
}: {
  campaign: VoiceCampaign | null;
  split: VoiceCampaignExperimentSplit;
  breakdowns: PropertyBreakdown[];
  loading: boolean;
  totalRecipients: number;
  linkedRecipients: number;
}) {
  const { testCount, controlCount } = experimentAudienceCounts(totalRecipients, split);
  const rows = preferredBreakdowns(breakdowns)
    .flatMap((breakdown) => breakdown.values.slice(0, 3).map((value) => ({
      property: breakdown.displayName,
      name: value.name || "(empty)",
      count: value.count,
      share: value.count / Math.max(totalRecipients, 1),
    })))
    .slice(0, 6);

  if (loading) return <EmptyChartState label="Loading pre-campaign segment slices..." />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Segment</p>
          <p className="mt-1 truncate font-medium">{campaign?.segmentName ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Purpose</p>
          <p className="mt-1 truncate font-medium">{campaign?.purposeName ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{split.enabled ? "Linked test calls" : "Linked calls"}</p>
          <p className="mt-1 font-medium tabular-nums">{formatCompactNumber(linkedRecipients)}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{split.testLabel}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCompactNumber(testCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {split.enabled ? `${split.testPercent}% receives campaign` : "Full audience receives campaign"}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{split.controlLabel}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCompactNumber(controlCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {split.enabled ? `${split.controlPercent}% held out as baseline` : "No holdout configured"}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyChartState label="No baseline profile slices are available for this segment yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 bg-white text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left text-[9.9px] uppercase tracking-[0.08em] text-muted-foreground">
                <th className="border-b border-border px-3 py-2 font-medium">Slice</th>
                <th className="border-b border-border px-3 py-2 font-medium">Property</th>
                <th className="border-b border-border px-3 py-2 text-right font-medium">Audience</th>
                <th className="border-b border-border px-3 py-2 text-right font-medium">Share</th>
                <th className="border-b border-border px-3 py-2 font-medium">Outcome state</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.property}-${row.name}`} className="bg-white hover:bg-neutral-50/80">
                  <td className="border-b border-border/60 px-3 py-3 font-medium">{row.name}</td>
                  <td className="border-b border-border/60 px-3 py-3 text-muted-foreground">{row.property}</td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">{formatCompactNumber(row.count)}</td>
                  <td className="border-b border-border/60 px-3 py-3 text-right tabular-nums">{formatRate(row.share)}</td>
                  <td className="border-b border-border/60 px-3 py-3 text-muted-foreground">Pre-campaign baseline</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VoiceTimelineChart({ data }: { data: VoiceCampaignSimulationPoint[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="Call volume will appear here after launch." />;
  }

  const chartSpec: ChartSpec = {
    type: "line",
    title: "Campaign pace",
    data: data.map((row) => ({ ...row })),
    xKey: "label",
    yKeys: ["attempted", "connected", "engaged", "positive"],
    yLabels: ["Attempted", "Connected", "Engaged", "Positive"],
    yAxisLabel: "Calls",
    format: {
      attempted: "number",
      connected: "number",
      engaged: "number",
      positive: "number",
    },
    tone: "monochrome",
  };

  return (
    <div className="h-[400px]">
      <ChartCore spec={chartSpec} height="100%" />
    </div>
  );
}

function FunnelColumnChart({
  data,
}: {
  data: Array<{ label: string; count: number; percent: number }>;
}) {
  if (data.length === 0) {
    return <EmptyChartState label="Launch production calls to populate the funnel." />;
  }

  const chartSpec: ChartSpec = {
    type: "funnel",
    title: "Conversion funnel",
    data: data.map((row) => ({
      label: row.label,
      percent: row.percent,
      users: row.count,
    })),
    xKey: "label",
    yKeys: ["percent"],
    yLabels: ["Conversion"],
    format: { percent: "percent" },
    tone: "monochrome",
  };

  return (
    <div className="h-[300px]">
      <ChartCore spec={chartSpec} height="100%" />
    </div>
  );
}

function OutcomeMixChart({
  data,
}: {
  data: Array<{ label: string; count: number; percent: number }>;
}) {
  if (data.length === 0) {
    return <EmptyChartState label="No outcomes classified yet." />;
  }

  const chartSpec: ChartSpec = {
    type: "bar",
    title: "Outcome mix",
    data,
    xKey: "label",
    yKeys: ["count"],
    yLabels: ["Calls"],
    yAxisLabel: "Calls",
    format: { count: "number" },
    highlight: data[0]?.label,
    tone: "monochrome",
  };

  return (
    <div className="h-[340px]">
      <ChartCore spec={chartSpec} height="100%" />
    </div>
  );
}

function CostTrendChart({ data }: { data: VoiceCampaignSimulationPoint[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="Model spend will appear after calls complete." />;
  }

  const chartSpec: ChartSpec = {
    type: "area",
    title: "Model spend",
    data: data.map((row) => ({ ...row })),
    xKey: "label",
    yKeys: ["cost"],
    yLabels: ["Estimated spend"],
    yAxisLabel: "Spend",
    format: { cost: "currency" },
    currency: "$",
    tone: "monochrome",
  };

  return (
    <div className="h-[260px]">
      <ChartCore spec={chartSpec} height="100%" />
    </div>
  );
}

function CallRetentionChart({ data }: { data: VoiceCampaignSimulationRetentionPoint[] }) {
  if (data.length === 0 || data.every((row) => row.retained === 0)) {
    return <EmptyChartState label="Call retention will appear once customers pick up." />;
  }

  const chartSpec: ChartSpec = {
    type: "line",
    title: "Call retention",
    data: data.map((row) => ({ ...row })),
    xKey: "label",
    yKeys: ["percent"],
    yLabels: ["Retained"],
    yAxisLabel: "Retained",
    format: { percent: "percent" },
    tone: "monochrome",
  };

  return (
    <div className="h-[260px]">
      <ChartCore spec={chartSpec} height="100%" />
    </div>
  );
}

function GeminiLatencyChart({ data }: { data: VoiceCampaignSimulationLatencyPoint[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="Latency will appear once transcripts include user and agent turns." />;
  }

  const chartSpec: ChartSpec = {
    type: "line",
    title: "Model response latency",
    data: data.map((row) => ({ ...row })),
    xKey: "label",
    yKeys: ["p50Ms", "p90Ms"],
    yLabels: ["p50 response", "p90 response"],
    yAxisLabel: "Latency ms",
    format: {
      p50Ms: "number",
      p90Ms: "number",
    },
    tone: "monochrome",
  };

  return (
    <div className="h-[260px]">
      <ChartCore spec={chartSpec} height="100%" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CallLogDetailPanel (local copy from voice-campaign-studio.tsx line 3494-3869)
// ---------------------------------------------------------------------------

function CallLogDetailPanel({
  call,
  campaign,
  onClose,
}: {
  call: VoiceCall;
  campaign: VoiceCampaign | null;
  onClose: () => void;
}) {
  const outcome = classifyVoiceCallOutcome(call);
  const facts = getVoiceCallStageFacts(call);
  const transcript = displayTranscript(call);
  const href = recordingHref(call, campaign);
  const recording = primaryRecording(call);
  const messageFollowUps = (call.followUps ?? []).filter((followUp) =>
    followUp.type === "sms" || followUp.type === "whatsapp"
  );
  const stats = [
    { label: "Runtime", value: callRuntimeLabel(call) },
    { label: "Status", value: callStatusLabel(call) },
    { label: "Outcome", value: OUTCOME_LABELS[outcome] },
    { label: "Duration", value: formatDuration(call.durationSeconds) },
    { label: "Started", value: callStartedAt(call) },
    { label: "Picked up", value: facts.pickedUp ? "Yes" : "No" },
    { label: "20s engaged", value: facts.engaged20s ? "Yes" : "No" },
    { label: "Recording", value: href ? "Available" : "Missing" },
    { label: "Transcript turns", value: transcript.length },
    { label: "Call id", value: call.callConfigId ?? call.id },
    { label: "Provider request", value: call.providerRequestId ?? "-" },
  ];

  const [fraudAnalysis, setFraudAnalysis] = useState<
    import("@/app/api/fraud-alerts/by-call/route").FraudCallAnalysis | null
  >(null);
  const [fraudState, setFraudState] = useState<"loading" | "ready" | "error">("loading");
  const isFraudCall = call.status === "completed" && Boolean(campaign?.datasetId);

  useEffect(() => {
    const id = call.callConfigId || call.id;
    if (!id || !isFraudCall) return;
    let cancelled = false;
    let attempts = 0;
    setFraudAnalysis(null);
    setFraudState("loading");
    const dsParam = campaign?.datasetId
      ? `&datasetId=${encodeURIComponent(campaign.datasetId)}`
      : "";
    const url = `/api/fraud-alerts/by-call?callId=${encodeURIComponent(id)}${dsParam}`;
    const opts = { skipDataset: true, skipModel: true } as const;
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setInterval>;

    async function poll(): Promise<void> {
      attempts += 1;
      try {
        const data = await apiFetch<
          import("@/app/api/fraud-alerts/by-call/route").FraudCallAnalysis
        >(url, opts);
        if (!cancelled) {
          setFraudAnalysis(data);
          setFraudState("ready");
          clearInterval(timer);
        }
      } catch {
        if (!cancelled && attempts >= 45) setFraudState("error");
      }
    }

    void poll();
    timer = setInterval(() => void poll(), 4000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callConfigId, call.id, call.status, campaign?.datasetId]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="truncate font-mono text-sm font-semibold">{callDisplayName(call)}</SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {callStatusLabel(call)} · {formatDuration(call.durationSeconds)}
          </p>
          {isLiveTestCall(call) && (
            <span className="mt-2 inline-flex rounded-md px-1.5 py-0.5 text-[9.9px] text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
              Live test
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close call details"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b border-border p-5">
          {href ? (
            <div>
              <CallRecordingWaveform
                src={href}
                durationSeconds={recording?.durationSeconds ?? call.durationSeconds}
                contentType={recording?.contentType}
                channels={recording?.channels}
                downloadName={`${call.id}-${recording?.sid ?? "recording"}.${recording?.contentType?.includes("wav") ? "wav" : "mp3"}`}
              />
              {recording?.durationSeconds !== undefined && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatDuration(recording.durationSeconds)} · {recording.contentType ?? "audio"}
                </p>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-xs font-medium uppercase text-muted-foreground">Recording</h3>
              <p className="mt-3 text-sm text-muted-foreground">No recording available.</p>
            </>
          )}
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Transcript</h3>
          {transcript.length > 0 ? (
            <div className="mt-3 space-y-3">
              {transcript.map((turn) => {
                const isUser = turn.role === "user";
                const roleLabel = isUser ? "User" : "Agent";

                return (
                  <div
                    key={turn.id}
                    className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[84%] rounded-lg px-3 py-2.5",
                        isUser ? "bg-muted" : "bg-muted/25",
                      )}
                    >
                      <div className={cn("mb-1 flex items-center gap-3", isUser && "justify-end")}>
                        <p className="text-[9.9px] font-medium uppercase text-muted-foreground">{roleLabel}</p>
                        <p className="text-[9.9px] text-muted-foreground">
                          {transcriptTurnTimeLabel(turn, call.startedAt)}
                        </p>
                      </div>
                      <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", isUser && "text-right")}>
                        {turn.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No transcript captured yet.</p>
          )}
        </section>

        {isFraudCall && (
          <section className="border-b border-border p-5">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Voice analysis</h3>
            {fraudState === "loading" && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <svg className="size-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                </svg>
                Acoustic analysis in progress…
              </div>
            )}
            {fraudState === "error" && (
              <p className="mt-3 text-sm text-muted-foreground">
                Analysis unavailable — the service did not respond in time.
              </p>
            )}
            {fraudState === "ready" && fraudAnalysis && (
            <TooltipProvider delayDuration={200}>
            <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {fraudAnalysis.recommendation && fraudAnalysis.recommendation !== "unknown" && (
                <UiTooltip><TooltipTrigger asChild>
                  <span className="cursor-default rounded-md border border-border px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide">{fraudAnalysis.recommendation}</span>
                </TooltipTrigger><TooltipContent className="max-w-[220px]">Recommended action based on combined acoustic, transcript, and transaction signals</TooltipContent></UiTooltip>
              )}
              {fraudAnalysis.duress_score != null && (
                <span className="flex items-center gap-1 text-sm">
                  Coercion <span className="font-semibold tabular-nums">{(fraudAnalysis.duress_score * 100).toFixed(0)}%</span>
                  <UiTooltip><TooltipTrigger asChild><span className="cursor-default text-[9.9px] text-muted-foreground">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Composite score from voice onset delay, verbatim echo, and low elaboration — signals the caller may be under coaching or coercion</TooltipContent></UiTooltip>
                </span>
              )}
              {fraudAnalysis.stress_class != null && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  Stress class <span className="font-semibold tabular-nums text-foreground">{fraudAnalysis.stress_class}</span>
                  <UiTooltip><TooltipTrigger asChild><span className="cursor-default text-[9.9px] text-muted-foreground">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Acoustic stress level: 0 = calm, 1 = mild, 2 = elevated, 3 = high. Derived from jitter, shimmer, HNR, and pitch variance</TooltipContent></UiTooltip>
                </span>
              )}
              {fraudAnalysis.stress_score != null && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  Score <span className="font-semibold tabular-nums text-foreground">{fraudAnalysis.stress_score.toFixed(2)}</span>
                  <UiTooltip><TooltipTrigger asChild><span className="cursor-default text-[9.9px] text-muted-foreground">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Count of acoustic stress rules triggered — jitter, shimmer, HNR, pitch variance, speaking rate</TooltipContent></UiTooltip>
                </span>
              )}
              {fraudAnalysis.background_voice === true && (
                <UiTooltip><TooltipTrigger asChild>
                  <span className="cursor-default rounded-md border border-border px-1.5 py-0.5 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">background voice</span>
                </TooltipTrigger><TooltipContent className="max-w-[220px]">A second voice was detected — possible coaching or third-party presence during the call</TooltipContent></UiTooltip>
              )}
            </div>
            {fraudAnalysis.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {fraudAnalysis.reasons.map((r) => {
                  const REASON_TIPS: Record<string, string> = {
                    hnr_degraded: "Harmonics-to-Noise Ratio is low — voice sounds breathy or hoarse, common under stress",
                    shimmer_high: "High amplitude variation between vocal cycles — indicates voice instability",
                    jitter_high: "High pitch frequency variation — vocal tremor associated with anxiety",
                    spectral_entropy_high: "Chaotic frequency distribution in the voice signal — elevated in stressed or unnatural speech",
                    speaking_rate_slow: "Speaking rate is slower than normal — can indicate hesitation, coaching, or reading from a script",
                    speaking_rate_fast: "Speaking rate is faster than normal — can indicate rehearsed or coached delivery",
                    f0_variance_high: "High pitch variance — exaggerated intonation, sometimes scripted",
                    f0_variance_low: "Flat, monotone delivery — consistent with scripted or coached speech",
                    cpp_low: "Low Cepstral Peak Prominence — reduced voice clarity, elevated in stressed speech",
                  };
                  const [ruleName, score] = r.split(" (");
                  const tip = REASON_TIPS[ruleName ?? ""];
                  const display = (ruleName ?? r).replace(/_/g, " ");
                  const scoreStr = score ? ` (${score}` : "";
                  return tip ? (
                    <UiTooltip key={r}><TooltipTrigger asChild>
                      <span className="flex cursor-default items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[9.9px] text-muted-foreground">
                        {display}{scoreStr}
                        <span className="text-[9px]">ⓘ</span>
                      </span>
                    </TooltipTrigger><TooltipContent className="max-w-[220px]">{tip}</TooltipContent></UiTooltip>
                  ) : (
                    <span key={r} className="rounded-md border border-border px-2 py-0.5 text-[9.9px] text-muted-foreground">{display}{scoreStr}</span>
                  );
                })}
              </div>
            )}
            {fraudAnalysis.detected_gender && (
              <div className="mt-3">
                <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Voice gender</p>
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
                  <div className="bg-background px-3 py-2.5">
                    <p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Detected</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-medium capitalize">
                      {fraudAnalysis.detected_gender}
                      {fraudAnalysis.gender_mismatch === true && (
                        <UiTooltip><TooltipTrigger asChild>
                          <span className="cursor-default rounded border border-red-500/40 bg-red-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-red-500">mismatch</span>
                        </TooltipTrigger><TooltipContent>Detected voice gender does not match the cardholder&apos;s registered gender — a potential fraud signal indicating someone else may be on the call</TooltipContent></UiTooltip>
                      )}
                    </p>
                  </div>
                  {fraudAnalysis.gender_confidence != null && (
                    <UiTooltip><TooltipTrigger asChild>
                      <div className="cursor-default bg-background px-3 py-2.5">
                        <p className="text-[9.9px] text-muted-foreground">Confidence</p>
                        <p className="mt-1 text-sm font-medium tabular-nums">{(fraudAnalysis.gender_confidence * 100).toFixed(0)}%</p>
                      </div>
                    </TooltipTrigger><TooltipContent>Model confidence in the gender classification. Below 60% is unreliable</TooltipContent></UiTooltip>
                  )}
                  {fraudAnalysis.gender_female_prob != null && fraudAnalysis.gender_male_prob != null && (
                    <UiTooltip><TooltipTrigger asChild>
                      <div className="cursor-default bg-background px-3 py-2.5">
                        <p className="text-[9.9px] text-muted-foreground">F / M prob</p>
                        <p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.gender_female_prob.toFixed(2)} / {fraudAnalysis.gender_male_prob.toFixed(2)}</p>
                      </div>
                    </TooltipTrigger><TooltipContent>Raw female and male probability scores from the gender model</TooltipContent></UiTooltip>
                  )}
                </div>
              </div>
            )}
            {!fraudAnalysis.detected_gender && fraudAnalysis.gender_status && (
              <p className="mt-3 text-sm text-muted-foreground">{genderStatusMessage(fraudAnalysis.gender_status)}</p>
            )}
            {(fraudAnalysis.voice_onset_ms != null || fraudAnalysis.elaboration_ratio != null || fraudAnalysis.echo_score != null) && (
              <div className="mt-3">
                <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Conversation signals</p>
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
                  {fraudAnalysis.voice_onset_ms != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Voice onset <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Median delay between agent finishing a question and the caller responding</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{Math.round(fraudAnalysis.voice_onset_ms)}ms</p></div>}
                  {fraudAnalysis.elaboration_ratio != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Elaboration <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Ratio of caller words to agent words</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.elaboration_ratio.toFixed(2)}</p></div>}
                  {fraudAnalysis.echo_score != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Echo score <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Word overlap between agent questions and caller responses</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.echo_score.toFixed(2)}</p></div>}
                </div>
              </div>
            )}
            {(fraudAnalysis.jitter != null || fraudAnalysis.shimmer != null || fraudAnalysis.hnr != null || fraudAnalysis.mean_f0 != null) && (
              <div className="mt-3">
                <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Acoustic signals</p>
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
                  {fraudAnalysis.jitter != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Jitter <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Cycle-to-cycle pitch variation</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.jitter.toFixed(4)}</p></div>}
                  {fraudAnalysis.shimmer != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Shimmer <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Cycle-to-cycle amplitude variation</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.shimmer.toFixed(4)}</p></div>}
                  {fraudAnalysis.hnr != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">HNR <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Harmonics-to-Noise Ratio (dB)</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.hnr.toFixed(2)}</p></div>}
                  {fraudAnalysis.mean_f0 != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">Mean F0 <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Average voice pitch. Stress raises pitch</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.mean_f0.toFixed(1)} Hz</p></div>}
                  {fraudAnalysis.f0_variance != null && <div className="bg-background px-3 py-2.5"><p className="flex items-center gap-1 text-[9.9px] text-muted-foreground">F0 variance <UiTooltip><TooltipTrigger asChild><span className="cursor-default">ⓘ</span></TooltipTrigger><TooltipContent className="max-w-[220px]">Pitch variance across the call</TooltipContent></UiTooltip></p><p className="mt-1 text-sm font-medium tabular-nums">{fraudAnalysis.f0_variance.toFixed(1)}</p></div>}
                </div>
              </div>
            )}
            </>
            </TooltipProvider>
            )}
          </section>
        )}

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Follow-ups</h3>
          {messageFollowUps.length > 0 ? (
            <div className="mt-3 space-y-2">
              {messageFollowUps.map((followUp) => (
                <div key={followUp.id} className="rounded-lg bg-muted/25 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <MessageSquare className="size-3.5 text-muted-foreground" />
                        {followUp.type === "whatsapp" ? "WhatsApp" : "SMS"} to {maskPhone(followUp.to)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {followUp.sentAt
                          ? new Date(followUp.sentAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "Queued after transcript"}
                        {followUp.providerStatus ? ` · ${followUp.providerStatus}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                      {followUp.status}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                    {followUp.body}
                  </p>
                  {followUp.error && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Error: {followUp.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No follow-up message triggered yet.</p>
          )}
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Stats</h3>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
            {stats.map((item) => (
              <div key={item.label} className="bg-background px-3 py-2.5">
                <p className="text-[9.9px] text-muted-foreground">{item.label}</p>
                <p className="mt-1 truncate text-sm font-medium tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Summary</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {callResponseSummary(call)}
          </p>
          {call.analysis?.reason && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {call.analysis.reason}
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// MockReviewTranscriptTurn / VoiceCallReviewSuggestion
// ---------------------------------------------------------------------------

interface MockReviewTranscriptTurn {
  id: string;
  role: "assistant" | "user";
  text: string;
  at: string;
}

interface VoiceCallReviewSuggestion {
  id: string;
  call?: VoiceCall;
  callLabel: string;
  title: string;
  detail: string;
  score: number;
  outcome: VoiceCallOutcome;
  transcriptTurns: number;
  hasRecording: boolean;
  evidence: string[];
  mocked?: boolean;
  durationSeconds?: number;
  startedAtLabel?: string;
  runtimeLabel?: string;
  statusLabel?: string;
  callIdLabel?: string;
  transcript?: MockReviewTranscriptTurn[];
  summary?: string;
}

function truncateReviewText(value: string | undefined, maxLength = 150): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "Open the recording and transcript to inspect the conversation.";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function firstCustomerSnippet(call: VoiceCall): string | undefined {
  return displayTranscript(call).find((turn) => turn.role === "user" && turn.text.trim())?.text;
}

function buildCallReviewSuggestions(
  campaign: VoiceCampaign | null,
  calls: VoiceCall[],
): VoiceCallReviewSuggestion[] {
  const suggestions = calls
    .map((call): VoiceCallReviewSuggestion | null => {
      const transcriptTurns = displayTranscript(call).length;
      const hasRecording = Boolean(recordingHref(call, campaign));
      if (!hasRecording && transcriptTurns === 0) return null;

      const outcome = classifyVoiceCallOutcome(call);
      const duration = call.durationSeconds ?? 0;
      const latencySamples = turnLatencySamples(call);
      const maxLatency = Math.max(0, ...latencySamples);
      const scriptEvaluation = campaign ? evaluateScriptAdherenceCall(campaign, call) : null;
      const failedChecks = scriptEvaluation?.failedKeys ?? [];
      const hasCallback = hasCallbackScheduledSignal(call);
      const evidence: string[] = [];
      let score = 0;
      let title = "Representative call to inspect";

      if (hasCallback) {
        score += 85;
        title = "Callback handoff signal";
        evidence.push("Callback or advisor follow-up detected");
      }

      if (outcome === "wrong_number") {
        score += 75;
        title = "Bad contact surfaced";
        evidence.push("Wrong-number signal");
      } else if (outcome === "negative") {
        score += 68;
        title = "Decline or pressure risk";
        evidence.push("Negative response");
      } else if (outcome === "failed") {
        score += 62;
        title = "Failed call path";
        evidence.push("Provider or runtime failure");
      } else if (outcome === "busy") {
        score += 50;
        title = "Call-later request";
        evidence.push("Busy or asked to continue later");
      } else if (outcome === "positive") {
        score += 44;
        if (!hasCallback) title = "Positive response to learn from";
        evidence.push("Positive customer intent");
      } else if (outcome === "neutral") {
        score += 34;
        title = "Undecided conversation";
        evidence.push("Neutral or undecided outcome");
      } else if (outcome === "unknown") {
        score += 28;
        title = "Unclear transcript";
        evidence.push("Unknown classification");
      }

      if (failedChecks.length > 0) {
        score += 22 + Math.min(24, failedChecks.length * 8);
        title = "Script drift to review";
        evidence.push(`Failed script check${failedChecks.length === 1 ? "" : "s"}: ${failedChecks.map(scriptCheckLabel).join(", ")}`);
      }

      if (duration >= 120 && outcome !== "positive") {
        score += 30;
        title = outcome === "neutral" ? "Long undecided conversation" : title;
        evidence.push(`Long ${formatDuration(duration)} call without positive outcome`);
      } else if (duration > 0 && duration <= 12 && transcriptTurns > 0) {
        score += 24;
        title = "Abrupt completed call";
        evidence.push(`Very short ${formatDuration(duration)} conversation`);
      }

      if (maxLatency >= 5_000) {
        score += 30;
        title = "Latency spike in conversation";
        evidence.push(`Slowest model response ${Math.round(maxLatency / 1000)}s`);
      } else if (maxLatency >= 3_000) {
        score += 14;
        evidence.push(`Model response crossed ${Math.round(maxLatency / 1000)}s`);
      }

      if (transcriptTurns >= 16) {
        score += 12;
        evidence.push(`${transcriptTurns} transcript turns`);
      }
      if (hasRecording && transcriptTurns > 0) {
        score += 8;
        evidence.push("Recording and transcript available");
      }
      if (!call.analysis && transcriptTurns > 0) {
        score += 18;
        title = "Transcript needs analysis";
        evidence.push("Transcript captured before response analysis");
      }
      if ((call.analysis?.confidence ?? 1) < 0.55) {
        score += 12;
        evidence.push("Low-confidence classification");
      }

      const detail = truncateReviewText(
        meaningfulCallSummary(call) ?? call.analysis?.reason ?? firstCustomerSnippet(call),
      );

      return {
        id: call.id,
        call,
        callLabel: callDisplayName(call),
        title,
        detail,
        score,
        outcome,
        transcriptTurns,
        hasRecording,
        evidence: uniqueNonEmpty(evidence, 4),
      };
    })
    .filter((suggestion): suggestion is VoiceCallReviewSuggestion => Boolean(suggestion));

  return suggestions
    .sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return callTimestamp(b.call!) - callTimestamp(a.call!);
    })
    .slice(0, 5);
}

function mockCallReviewSuggestions(): VoiceCallReviewSuggestion[] {
  return [
    {
      id: "mock-callback-handoff",
      callLabel: "+91 98...421",
      title: "Callback handoff signal",
      detail: "Customer asked for an advisor callback after initially saying they were busy. Review whether the agent captured a usable follow-up request.",
      score: 100,
      outcome: "positive",
      transcriptTurns: 18,
      hasRecording: true,
      mocked: true,
      durationSeconds: 168,
      startedAtLabel: "Today, 11:42 AM",
      runtimeLabel: "Gemini",
      statusLabel: "Completed",
      callIdLabel: "vc_call_78a4",
      summary: "Busy customer converted into a callback request after the agent clarified the portfolio review value.",
      evidence: ["Callback request", "Busy-to-positive turn", "Recording and transcript available"],
      transcript: [
        { id: "callback-1", role: "assistant", at: "11:42 AM", text: "Hi, this is Ananya calling from your investment support team. Is this a good time for a quick portfolio review update?" },
        { id: "callback-2", role: "user", at: "11:42 AM", text: "I am busy right now. What is this about?" },
        { id: "callback-3", role: "assistant", at: "11:43 AM", text: "Understood. I am calling because your SIP restart flow was left incomplete, and an advisor can help check if the portfolio still matches your goal." },
        { id: "callback-4", role: "user", at: "11:43 AM", text: "Okay, have someone call me after 6 PM. I can talk then." },
        { id: "callback-5", role: "assistant", at: "11:44 AM", text: "Noted. I will mark a callback request for after 6 PM so the advisor can follow up with context." },
      ],
    },
    {
      id: "mock-script-drift",
      callLabel: "+91 77...906",
      title: "Script drift to review",
      detail: "Agent moved into the offer before confirming the customer context. This is the type of call that can inflate interest but hurt downstream conversion.",
      score: 96,
      outcome: "neutral",
      transcriptTurns: 21,
      hasRecording: true,
      mocked: true,
      durationSeconds: 214,
      startedAtLabel: "Today, 12:05 PM",
      runtimeLabel: "Gemini",
      statusLabel: "Completed",
      callIdLabel: "vc_call_13f9",
      summary: "The agent pitched the consultation before confirming why the customer stopped the flow, creating an unclear neutral outcome.",
      evidence: ["Offer discipline risk", "Long unresolved conversation", "Transcript available"],
      transcript: [
        { id: "drift-1", role: "assistant", at: "12:05 PM", text: "We can arrange a portfolio consultation for you today and help restart the SIP." },
        { id: "drift-2", role: "user", at: "12:05 PM", text: "But I did not say I wanted to restart. I was just checking returns." },
        { id: "drift-3", role: "assistant", at: "12:06 PM", text: "Yes, the consultation will help with returns and the restart process." },
        { id: "drift-4", role: "user", at: "12:07 PM", text: "I need to understand first. I am not committing now." },
        { id: "drift-5", role: "assistant", at: "12:08 PM", text: "I understand. I should first confirm what you were trying to compare before suggesting the next step." },
      ],
    },
    {
      id: "mock-latency-spike",
      callLabel: "+91 90...318",
      title: "Latency spike in conversation",
      detail: "Customer answered a question, then the agent response stalled long enough to create a handoff risk. Review pacing and interruption handling.",
      score: 92,
      outcome: "busy",
      transcriptTurns: 14,
      hasRecording: true,
      mocked: true,
      durationSeconds: 96,
      startedAtLabel: "Today, 12:31 PM",
      runtimeLabel: "Gemini",
      statusLabel: "Completed",
      callIdLabel: "vc_call_52bd",
      summary: "A slow response after the customer answered caused impatience and a call-later request.",
      evidence: ["Slowest model response 7s", "Customer impatience", "Audio available"],
      transcript: [
        { id: "latency-1", role: "assistant", at: "12:31 PM", text: "Can you tell me whether you paused the SIP because of returns, payment setup, or something else?" },
        { id: "latency-2", role: "user", at: "12:31 PM", text: "Payment setup. The bank verification did not work." },
        { id: "latency-3", role: "assistant", at: "12:31 PM", text: "..." },
        { id: "latency-4", role: "user", at: "12:32 PM", text: "Hello? I have to go." },
        { id: "latency-5", role: "assistant", at: "12:32 PM", text: "Sorry about that. I can schedule a callback for the bank verification issue if that is easier." },
      ],
    },
    {
      id: "mock-bad-contact",
      callLabel: "+91 86...744",
      title: "Bad contact surfaced",
      detail: "Recipient indicated this was the wrong number. Review whether the agent exited cleanly and whether the segment/contact source needs suppression.",
      score: 88,
      outcome: "wrong_number",
      transcriptTurns: 7,
      hasRecording: true,
      mocked: true,
      durationSeconds: 22,
      startedAtLabel: "Today, 1:14 PM",
      runtimeLabel: "Gemini",
      statusLabel: "Completed",
      callIdLabel: "vc_call_91c2",
      summary: "Recipient said the number does not belong to the intended customer; suppressing this contact should be considered.",
      evidence: ["Wrong-number signal", "Contact hygiene issue", "Short transcript"],
      transcript: [
        { id: "wrong-1", role: "assistant", at: "1:14 PM", text: "Hi, am I speaking with Rahul about the SIP restart request?" },
        { id: "wrong-2", role: "user", at: "1:14 PM", text: "No, this is not Rahul. You have the wrong number." },
        { id: "wrong-3", role: "assistant", at: "1:14 PM", text: "Sorry for the disturbance. I will mark this number so it is not contacted for this request." },
      ],
    },
    {
      id: "mock-decline-pressure",
      callLabel: "+91 63...209",
      title: "Decline or pressure risk",
      detail: "Customer declined twice, but the agent continued one more turn. Review this before scaling because it affects guardrails and retry policy.",
      score: 84,
      outcome: "negative",
      transcriptTurns: 12,
      hasRecording: true,
      mocked: true,
      durationSeconds: 74,
      startedAtLabel: "Today, 2:02 PM",
      runtimeLabel: "Gemini",
      statusLabel: "Completed",
      callIdLabel: "vc_call_37e5",
      summary: "Customer declined clearly, but the agent continued with another benefit statement instead of closing the call.",
      evidence: ["Repeated decline", "Concern handling risk", "Transcript available"],
      transcript: [
        { id: "decline-1", role: "assistant", at: "2:02 PM", text: "Would you like help reviewing the SIP restart options?" },
        { id: "decline-2", role: "user", at: "2:02 PM", text: "No, I am not interested right now." },
        { id: "decline-3", role: "assistant", at: "2:03 PM", text: "I understand. It may still help because the advisor can explain what changed in your portfolio." },
        { id: "decline-4", role: "user", at: "2:03 PM", text: "No, please do not call me for this." },
        { id: "decline-5", role: "assistant", at: "2:03 PM", text: "Understood. I will mark that you are not interested in this follow-up." },
      ],
    },
  ];
}

function reviewSuggestionsWithMocks(
  campaign: VoiceCampaign | null,
  calls: VoiceCall[],
): VoiceCallReviewSuggestion[] {
  const realSuggestions = buildCallReviewSuggestions(campaign, calls);
  if (realSuggestions.length >= 5) return realSuggestions;
  const existingTitles = new Set(realSuggestions.map((suggestion) => suggestion.title));
  const mocked = mockCallReviewSuggestions()
    .filter((suggestion) => !existingTitles.has(suggestion.title))
    .slice(0, 5 - realSuggestions.length);
  return [...realSuggestions, ...mocked];
}

function CallReviewQueuePanel({
  suggestions,
  campaign,
}: {
  suggestions: VoiceCallReviewSuggestion[];
  campaign: VoiceCampaign | null;
}) {
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const selectedSuggestion = suggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ?? null;

  return (
    <>
      <div className="divide-y divide-border">
        {suggestions.map((suggestion, index) => (
          <div
            key={suggestion.id}
            className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[2rem_minmax(0,1fr)_180px_128px] lg:items-center"
          >
            <div className="flex size-8 items-center justify-center rounded-md text-xs font-medium tabular-nums shadow-[0_0_0_1px_var(--color-border)]">
              {index + 1}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="font-medium">{suggestion.title}</p>
                <span className="font-mono text-xs text-muted-foreground">{suggestion.callLabel}</span>
                <VoiceOutcomePill outcome={suggestion.outcome} />
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{suggestion.detail}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {suggestion.evidence.join(" · ")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:max-w-xs lg:max-w-none">
              <div>
                <p>Recording</p>
                <p className="mt-1 font-medium text-foreground">{suggestion.hasRecording ? "Available" : "Missing"}</p>
              </div>
              <div>
                <p>Transcript</p>
                <p className="mt-1 font-medium text-foreground tabular-nums">{suggestion.transcriptTurns} turns</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSuggestionId(suggestion.id)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <MessageSquareText className="size-4" />
              Review
            </button>
          </div>
        ))}
      </div>

      <Sheet
        open={Boolean(selectedSuggestion)}
        onOpenChange={(open) => {
          if (!open) setSelectedSuggestionId(null);
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[540px] max-w-[calc(100vw-1rem)] gap-0 p-0 sm:max-w-[540px]"
        >
          {selectedSuggestion?.call ? (
            <CallLogDetailPanel
              call={selectedSuggestion.call}
              campaign={campaign}
              onClose={() => setSelectedSuggestionId(null)}
            />
          ) : selectedSuggestion ? (
            <MockCallReviewDetailPanel
              suggestion={selectedSuggestion}
              onClose={() => setSelectedSuggestionId(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function MockCallReviewDetailPanel({
  suggestion,
  onClose,
}: {
  suggestion: VoiceCallReviewSuggestion;
  onClose: () => void;
}) {
  const transcript = suggestion.transcript ?? [];
  const durationSeconds = suggestion.durationSeconds ?? 90;
  const stats = [
    { label: "Runtime", value: suggestion.runtimeLabel ?? "Gemini" },
    { label: "Status", value: suggestion.statusLabel ?? "Completed" },
    { label: "Outcome", value: OUTCOME_LABELS[suggestion.outcome] },
    { label: "Duration", value: formatDuration(durationSeconds) },
    { label: "Started", value: suggestion.startedAtLabel ?? "Today" },
    { label: "Picked up", value: "Yes" },
    { label: "20s engaged", value: durationSeconds >= 20 ? "Yes" : "No" },
    { label: "Recording", value: suggestion.hasRecording ? "Available" : "Missing" },
    { label: "Transcript turns", value: suggestion.transcriptTurns },
    { label: "Call id", value: suggestion.callIdLabel ?? suggestion.id.replace(/^mock-/, "vc_call_") },
  ];

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="truncate font-mono text-sm font-semibold">{suggestion.callLabel}</SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {suggestion.statusLabel ?? "Completed"} · {formatDuration(durationSeconds)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close call details"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Summary</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {suggestion.summary ?? suggestion.detail}
          </p>
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Recording</h3>
          <div className="mt-3 rounded-lg bg-muted/25 p-4 shadow-[0_0_0_1px_var(--color-border)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Conversation audio</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDuration(durationSeconds)} · stereo capture
                </p>
              </div>
              <span className="rounded-md px-2 py-1 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                Available
              </span>
            </div>
            <div className="mt-4 flex h-16 items-center gap-1" aria-hidden="true">
              {Array.from({ length: 42 }).map((_, index) => {
                const height = 18 + ((index * 17) % 44);
                return (
                  <span
                    key={index}
                    className="w-1 flex-1 rounded-full bg-foreground/60"
                    style={{ height: `${height}%`, opacity: index % 5 === 0 ? 0.9 : 0.45 }}
                  />
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Transcript</h3>
          <div className="mt-3 space-y-3">
            {transcript.map((turn) => {
              const isUser = turn.role === "user";
              return (
                <div
                  key={turn.id}
                  className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[84%] rounded-lg px-3 py-2.5",
                      isUser ? "bg-muted" : "bg-muted/25",
                    )}
                  >
                    <div className={cn("mb-1 flex items-center gap-3", isUser && "justify-end")}>
                      <p className="text-[9.9px] font-medium uppercase text-muted-foreground">
                        {isUser ? "User" : "Agent"}
                      </p>
                      <p className="text-[9.9px] text-muted-foreground">{turn.at}</p>
                    </div>
                    <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", isUser && "text-right")}>
                      {turn.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Review reason</h3>
          <div className="mt-3 rounded-lg bg-muted/25 px-3 py-2.5">
            <p className="text-sm font-medium">{suggestion.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{suggestion.detail}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {suggestion.evidence.join(" · ")}
            </p>
          </div>
        </section>

        <section className="border-b border-border p-5">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Stats</h3>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
            {stats.map((item) => (
              <div key={item.label} className="bg-background px-3 py-2.5">
                <p className="text-[9.9px] text-muted-foreground">{item.label}</p>
                <p className="mt-1 truncate text-sm font-medium tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </aside>
  );
}

function formatInsightPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const percent = value <= 1 ? value * 100 : value;
  if (percent >= 10) return `${Math.round(percent)}%`;
  return `${Number(percent.toFixed(1))}%`;
}

function compactInsightText(value: string | undefined, max = 140): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function strongestOutcomeLabel(cluster: VoiceCampaignInsightCluster): string {
  const [outcome, count] = Object.entries(cluster.outcomeMix ?? {})
    .sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!outcome || !count) return "-";
  const label = OUTCOME_LABELS[outcome as VoiceCallOutcome] ?? outcome.replace(/_/g, " ");
  return `${label} ${formatInsightPercent(count / Math.max(cluster.count, 1))}`;
}

function InsightMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-[120px] flex-1 border-l border-border px-4 first:border-l-0 first:pl-0">
      <p className="text-[9.9px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function VoiceInsightsSkeleton() {
  return (
    <section className="overflow-hidden rounded-xl bg-background shadow-[0_0_0_1px_var(--color-border)]">
      <div className="grid min-h-[360px] gap-px bg-border lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bg-background p-6">
          <div className="h-4 w-36 rounded bg-muted" />
          <div className="mt-5 h-8 w-3/4 rounded bg-muted" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="h-12 rounded-md bg-muted/70" />
            ))}
          </div>
        </div>
        <div className="bg-background p-6">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="mt-6 h-28 rounded-md bg-muted/70" />
          <div className="mt-4 h-20 rounded-md bg-muted/70" />
        </div>
      </div>
    </section>
  );
}

function ClusterOutcomeTicks({ cluster }: { cluster: VoiceCampaignInsightCluster }) {
  const entries = Object.entries(cluster.outcomeMix ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  if (entries.length === 0) return null;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {entries.map(([outcome, count], index) => (
        <span
          key={outcome}
          className="h-full bg-foreground"
          style={{
            width: `${Math.max(6, (count / Math.max(cluster.count, 1)) * 100)}%`,
            opacity: 0.28 + index * 0.16,
          }}
        />
      ))}
    </div>
  );
}

function InsightClusterRow({
  cluster,
  maxCount,
  selected,
  onSelect,
}: {
  cluster: VoiceCampaignInsightCluster;
  maxCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const width = `${Math.max(7, (cluster.count / Math.max(maxCount, 1)) * 100)}%`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-full rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-muted",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{cluster.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{strongestOutcomeLabel(cluster)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{formatCompactNumber(cluster.count)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{formatInsightPercent(cluster.share)}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_var(--color-border)]">
        <span className="block h-full rounded-full bg-foreground" style={{ width }} />
      </div>
    </button>
  );
}

function SelectedClusterPanel({ cluster }: { cluster: VoiceCampaignInsightCluster }) {
  const outcomeRows = Object.entries(cluster.outcomeMix ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <aside className="flex min-h-0 flex-col bg-background p-5 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Selected cluster</p>
        <span className="rounded-md px-2 py-1 text-xs tabular-nums text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
          {formatInsightPercent(cluster.share)}
        </span>
      </div>

      <div className="mt-4">
        <h3 className="text-lg font-semibold leading-tight">{cluster.title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {compactInsightText(cluster.customerLanguagePattern || cluster.description, 180)}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border shadow-[0_0_0_1px_var(--color-border)]">
        <div className="bg-background px-3 py-3">
          <p className="text-[9.9px] text-muted-foreground">Calls</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCompactNumber(cluster.count)}</p>
        </div>
        <div className="bg-background px-3 py-3">
          <p className="text-[9.9px] text-muted-foreground">Avg</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatDuration(cluster.avgDurationSeconds)}</p>
        </div>
        <div className="bg-background px-3 py-3">
          <p className="text-[9.9px] text-muted-foreground">Turns</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{cluster.medianTurns}</p>
        </div>
      </div>

      {outcomeRows.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Outcome mix</p>
            <p className="text-xs text-muted-foreground">{strongestOutcomeLabel(cluster)}</p>
          </div>
          <ClusterOutcomeTicks cluster={cluster} />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {outcomeRows.map(([outcome, count]) => (
              <div key={outcome} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{OUTCOME_LABELS[outcome as VoiceCallOutcome] ?? outcome}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="size-4 text-muted-foreground" />
          <p className="text-xs font-medium uppercase text-muted-foreground">Next change</p>
        </div>
        <p className="mt-2 text-sm leading-relaxed">
          {compactInsightText(cluster.recommendedChange, 210)}
        </p>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-medium uppercase text-muted-foreground">Evidence</p>
        <div className="mt-3 space-y-2">
          {cluster.evidenceQuotes.slice(0, 3).map((quote, index) => (
            <p key={`${quote}-${index}`} className="rounded-md bg-muted/45 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {quote.replace(/^"+|"+$/g, "")}
            </p>
          ))}
        </div>
      </div>
    </aside>
  );
}

function VoiceCampaignInsightsDashboard({
  insights,
  loading,
  showSummary = false,
}: {
  insights: VoiceCampaignInsightsPayload | null;
  loading: boolean;
  showSummary?: boolean;
}) {
  const visibleClusters = useMemo(
    () => (insights?.clusters ?? []).slice().sort((a, b) => b.count - a.count),
    [insights],
  );
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const selectedCluster = visibleClusters.find((cluster) => cluster.id === selectedClusterId) ?? visibleClusters[0] ?? null;
  const maxCount = Math.max(...visibleClusters.map((cluster) => cluster.count), 1);
  const topCluster = visibleClusters[0];

  useEffect(() => {
    if (!selectedClusterId && visibleClusters[0]) {
      setSelectedClusterId(visibleClusters[0].id);
      return;
    }
    if (selectedClusterId && !visibleClusters.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(visibleClusters[0]?.id ?? null);
    }
  }, [selectedClusterId, visibleClusters]);

  if (loading && !insights) return <VoiceInsightsSkeleton />;
  if (!insights || !selectedCluster) return null;
  if (!showSummary) return <VoiceCampaignClusterVisualization insights={insights} tableOnly />;

  const topThreeClusterCount = visibleClusters
    .slice(0, 3)
    .reduce((sum, cluster) => sum + cluster.count, 0);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl bg-background shadow-[0_0_0_1px_var(--color-border)]">
        <div className="grid gap-px bg-border lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 bg-background">
            <div className="px-5 py-5 lg:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium shadow-[0_0_0_1px_var(--color-border)]">
                  <Sparkles className="size-3.5" />
                  Spotlight intelligence
                </span>
                <span className="text-xs text-muted-foreground">Run {insights.runId}</span>
              </div>
              <h2 className="mt-4 max-w-4xl text-balance text-2xl font-semibold leading-tight">
                {insights.headline}
              </h2>

              <div className="mt-6 flex flex-wrap gap-y-4 border-y border-border py-4">
                <InsightMetric
                  label="Analyzed"
                  value={formatCompactNumber(insights.calls)}
                  detail={`${formatCompactNumber(insights.signals)} signals`}
                />
                <InsightMetric
                  label="Clusters"
                  value={formatCompactNumber(insights.clusterCount)}
                  detail="Derived from transcripts"
                />
                <InsightMetric
                  label="Top cluster"
                  value={topCluster ? formatInsightPercent(topCluster.share) : "0%"}
                  detail={topCluster?.title ?? "-"}
                />
                <InsightMetric
                  label="Top 3"
                  value={formatInsightPercent(topThreeClusterCount / Math.max(insights.calls, 1))}
                  detail="Concentration of calls"
                />
              </div>
            </div>

            <div className="grid gap-px border-t border-border bg-border xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="bg-background p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <div>
                    <p className="text-sm font-semibold">Cluster field</p>
                    <p className="mt-1 text-xs text-muted-foreground">Transcript-derived issues by volume</p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{visibleClusters.length} groups</span>
                </div>
                <div className="space-y-1">
                  {visibleClusters.slice(0, 10).map((cluster) => (
                    <InsightClusterRow
                      key={cluster.id}
                      cluster={cluster}
                      maxCount={maxCount}
                      selected={selectedCluster.id === cluster.id}
                      onSelect={() => setSelectedClusterId(cluster.id)}
                    />
                  ))}
                </div>
              </div>

              <div className="bg-background p-4">
                <div className="flex items-center gap-2">
                  <Workflow className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Tests to run</p>
                </div>
                <div className="mt-4 divide-y divide-border">
                  {insights.workflowChanges.slice(0, 5).map((change, index) => (
                    <div key={`${change.title}-${index}`} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium shadow-[0_0_0_1px_var(--color-border)]">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug">{change.title}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {compactInsightText(change.targetMoment, 78)}
                          </p>
                          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <CircleDot className="size-3" />
                            {compactInsightText(change.measurement, 72)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <SelectedClusterPanel cluster={selectedCluster} />
        </div>

        {insights.topInsights.length > 0 && (
          <div className="border-t border-border bg-background px-5 py-4 lg:px-6">
            <div className="grid gap-3 lg:grid-cols-3">
              {insights.topInsights.slice(0, 3).map((insight, index) => (
                <div key={`${insight.title}-${index}`} className="min-w-0 border-l border-border pl-4 first:border-l-0 first:pl-0">
                  <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <ChevronRight className="size-3.5" />
                    Insight {index + 1}
                  </p>
                  <p className="mt-2 text-sm font-medium leading-snug">{insight.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {compactInsightText(insight.readout, 135)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-label="Cohort intelligence">
        <VoiceCampaignClusterVisualization insights={insights} />
      </section>
    </div>
  );
}

export function VoiceOverviewPanel({
  campaign,
  onDrilldown,
}: {
  campaign: VoiceCampaign | null;
  onDrilldown?: (drilldown: VoiceOverviewDrilldown) => void;
}) {
  const [composition, setComposition] = useState<PropertyBreakdown[]>([]);
  const [compositionLoading, setCompositionLoading] = useState(false);
  const [postCampaignInsights, setPostCampaignInsights] = useState<VoiceCampaignInsightsPayload | null>(null);
  const [postCampaignInsightsLoading, setPostCampaignInsightsLoading] = useState(false);
  const segmentId = campaign?.segmentId;
  const campaignId = campaign?.id;
  const calls = productionCalls(campaign);
  const simulation = calls.length === 0 ? campaign?.simulation : undefined;
  const simulationProgress = simulation ? simulationProgressRatio(simulation) : 1;
  const simulationDone = Boolean(simulation && simulationProgress >= 1);
  const metrics = simulation
    ? scaleSimulationMetrics(simulation.metrics, simulationProgress)
    : metricsForCalls(calls);
  const attempted = Math.max(metrics.attempted, 1);
  const modelCostUsd = simulation
    ? simulation.modelSpendUsd * simulationProgress
    : estimateGeminiLiveAudioCost(calls).totalUsd;
  const timeline = simulation
    ? visibleSimulationTimeline(simulation, metrics, modelCostUsd, simulationProgress)
    : buildOverviewTimeline(calls);
  const retentionRows = simulation
    ? scaleSimulationRetention(simulation.retention, metrics)
    : buildRetentionFromCalls(calls);
  const latencyRows = simulation
    ? scaleSimulationLatency(simulation.latency, simulation, metrics)
    : buildLatencyFromCalls(calls);
  const riskCount = metrics.outcomes.failed + metrics.outcomes.wrong_number + metrics.outcomes.negative;
  const totalRecipients = simulation?.audienceSize ?? campaign?.phoneNumbers.length ?? metrics.attempted;
  const experimentSplit = normalizeVoiceCampaignExperimentSplit(campaign?.experimentSplit);
  const audienceCounts = experimentAudienceCounts(totalRecipients, experimentSplit);
  const callableRecipients = Math.max(audienceCounts.callableCount, 1);
  const funnelRows = [
    { label: "Attempted", count: metrics.attempted, percent: metrics.attempted > 0 ? 100 : 0 },
    { label: "Rang", count: metrics.rang, percent: Math.round((metrics.rang / attempted) * 100) },
    { label: "Picked up", count: metrics.pickedUp, percent: Math.round((metrics.pickedUp / attempted) * 100) },
    { label: "AI connected", count: metrics.aiConnected, percent: Math.round((metrics.aiConnected / attempted) * 100) },
    { label: "20s engaged", count: metrics.engaged20s, percent: Math.round((metrics.engaged20s / attempted) * 100) },
    { label: "Positive", count: metrics.positive, percent: Math.round((metrics.positive / attempted) * 100) },
  ];
  const outcomeRows = OUTCOME_ORDER.map((outcome) => ({
    key: outcome,
    label: OUTCOME_LABELS[outcome],
    count: metrics.outcomes[outcome],
    percent: Math.round((metrics.outcomes[outcome] / attempted) * 100),
  })).filter((row) => row.count > 0);
  const reviewSuggestions = reviewSuggestionsWithMocks(campaign, calls);
  const successDefinition = successDefinitionWithExperimentBaseline(campaign?.successDefinition, experimentSplit);
  const linkedRecipients = calls.filter((call) => call.recipientId).length;
  const productionDrilldown = calls.length > 0 ? onDrilldown : undefined;
  const dashboardLabel = simulation
    ? simulationDone ? "Completed" : "In progress"
    : formatStatusLabel(campaign?.status);
  const targetLabel = simulation
    ? experimentSplit.enabled
      ? `${formatCompactNumber(metrics.attempted)} of ${formatCompactNumber(audienceCounts.testCount)} test recipients attempted · ${formatCompactNumber(audienceCounts.controlCount)} control held out`
      : `${formatCompactNumber(metrics.attempted)} of ${formatCompactNumber(simulation.audienceSize)} recipients attempted`
    : experimentSplit.enabled
      ? `${formatCompactNumber(metrics.attempted)} of ${formatCompactNumber(audienceCounts.testCount)} test calls tracked · ${formatCompactNumber(audienceCounts.controlCount)} control held out`
      : `${formatCompactNumber(metrics.attempted)} campaign call${metrics.attempted === 1 ? "" : "s"} tracked`;
  const launchProgressPercent = clampPercent((metrics.attempted / callableRecipients) * 100);
  const launchProgressLabel = `${Math.round(launchProgressPercent)}%`;

  useEffect(() => {
    if (!segmentId) {
      setComposition([]);
      setCompositionLoading(false);
      return;
    }

    let cancelled = false;
    setCompositionLoading(true);
    apiFetch<SegmentOverviewPayload>(`/api/segments/${encodeURIComponent(segmentId)}`, {
      skipModel: true,
    })
      .then((segment) => apiFetch<{ breakdowns: PropertyBreakdown[] }>(
        `/api/segments/${encodeURIComponent(segmentId)}/composition`,
        {
          method: "POST",
          body: { sql: segment.sql },
          skipModel: true,
        },
      ))
      .then((result) => {
        if (!cancelled) setComposition(result.breakdowns ?? []);
      })
      .catch(() => {
        if (!cancelled) setComposition([]);
      })
      .finally(() => {
        if (!cancelled) setCompositionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [segmentId]);

  useEffect(() => {
    if (!campaignId) {
      setPostCampaignInsights(null);
      setPostCampaignInsightsLoading(false);
      return;
    }
    let cancelled = false;
    setPostCampaignInsightsLoading(true);
    apiFetch<VoiceCampaignInsightsPayload>(
      `/api/voice-campaigns/${encodeURIComponent(campaignId)}/insights`,
      { skipModel: true }
    )
      .then((payload) => { if (!cancelled) setPostCampaignInsights(payload); })
      .catch(async (error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          try {
            const fallback = await apiFetch<VoiceCampaignInsightsPayload>(
              "/api/voice-campaigns/insights",
              { skipModel: true }
            );
            if (!cancelled) setPostCampaignInsights(fallback);
          } catch { /* silent */ }
        }
      })
      .finally(() => { if (!cancelled) setPostCampaignInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [campaignId]);

  if (calls.length === 0 && !simulation && (postCampaignInsights || postCampaignInsightsLoading)) {
    return (
      <div className="mx-auto w-full max-w-[1600px]">
        <VoiceCampaignInsightsDashboard
          insights={postCampaignInsights}
          loading={postCampaignInsightsLoading}
        />
      </div>
    );
  }

  if (calls.length === 0 && !simulation) {
    return (
      <div className="mx-auto flex min-h-[520px] w-full max-w-[1600px] items-center justify-center">
        <section className="w-full max-w-xl rounded-lg bg-background p-8 text-center shadow-[0_0_0_1px_var(--color-border)]">
          <BarChart3 className="mx-auto mb-4 size-10 text-muted-foreground" />
          <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Campaign spotlight</p>
          <h2 className="mt-2 text-xl font-semibold">No campaign data yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Spotlight only includes audience campaign calls. Test calls and live tests are kept out of these metrics.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9.9px] font-medium uppercase text-muted-foreground">Campaign spotlight</p>
          <h2 className="mt-1 text-2xl font-semibold">{dashboardLabel}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{targetLabel}</p>
        </div>
      </div>

      <div className="rounded-lg bg-background px-5 py-4 shadow-[0_0_0_1px_var(--color-border)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Launch progress</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCompactNumber(metrics.attempted)} attempted · {formatCompactNumber(Math.max(callableRecipients - metrics.attempted, 0))} remaining
              {experimentSplit.enabled ? ` in ${experimentSplit.testLabel.toLowerCase()}` : ""}
            </p>
          </div>
          <span className="text-sm font-medium tabular-nums">{launchProgressLabel}</span>
        </div>
        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_var(--color-border)]"
          role="progressbar"
          aria-label="Launch progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(launchProgressPercent)}
        >
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-500 ease-out"
            style={{ width: `${launchProgressPercent}%` }}
          />
        </div>
      </div>

      <VoiceCampaignInsightsDashboard
        insights={postCampaignInsights}
        loading={postCampaignInsightsLoading}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <OverviewMetricTile
          label="Campaign calls"
          value={formatCompactNumber(metrics.attempted)}
          detail={simulation ? simulationPaceLabel(simulation) : `${campaignPaceLabel(campaign, metrics.attempted)} current pace`}
        />
        <OverviewMetricTile
          label="Contact rate"
          value={formatVoicePercent(metrics.pickedUp, metrics.attempted)}
          detail={`${formatCompactNumber(metrics.pickedUp)} picked up`}
        />
        <OverviewMetricTile
          label="Engaged calls"
          value={formatVoicePercent(metrics.engaged20s, metrics.attempted)}
          detail={`${formatCompactNumber(metrics.engaged20s)} 20s+ calls`}
        />
        <OverviewMetricTile
          label="Positive intent"
          value={formatVoicePercent(metrics.positive, metrics.attempted)}
          detail={`${formatCompactNumber(metrics.positive)} positive responses`}
        />
        <OverviewMetricTile
          label="Gemini model spend"
          value={formatMoney(modelCostUsd)}
          detail={simulation ? simulationDone ? "Campaign-run estimate" : "Spend so far" : "Observed model estimate"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <DashboardCard
          title={experimentSplit.enabled ? "Campaign response" : "Success definition"}
          description={experimentSplit.enabled
            ? "Callback demand, call signals, and handoff readiness for the test arm."
            : "User-defined outcome, baseline, and lift for this campaign."}
          className="xl:col-span-7"
        >
          <SuccessDefinitionPanel
            definition={successDefinition}
            calls={calls}
            metrics={metrics}
            split={experimentSplit}
            totalRecipients={totalRecipients}
          />
        </DashboardCard>

        <DashboardCard
          title="Segment baseline"
          description={experimentSplit.enabled
            ? "Base segment split into a callable test arm and an untouched control holdout."
            : "Pre-campaign segment context. Slice outcomes require recipient-level attribution."}
          className="xl:col-span-5"
        >
          <SegmentBaselinePanel
            campaign={campaign}
            split={experimentSplit}
            breakdowns={composition}
            loading={compositionLoading}
            totalRecipients={totalRecipients}
            linkedRecipients={linkedRecipients}
          />
        </DashboardCard>

        <DashboardCard
          title="Campaign pace"
          className="xl:col-span-7"
          contentClassName="px-4 pb-4 pt-3"
        >
          <VoiceTimelineChart data={timeline} />
        </DashboardCard>

        <DashboardCard
          title="Outcome mix"
          className="xl:col-span-5"
          contentClassName="px-4 pb-4 pt-3"
        >
          <OutcomeMixChart data={outcomeRows} />
          <div className="mt-2 grid grid-cols-2 gap-4 border-t border-border pt-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Risk flags</p>
              <p className="mt-1 font-medium tabular-nums">{formatCompactNumber(riskCount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">No answer</p>
              <p className="mt-1 font-medium tabular-nums">{formatCompactNumber(metrics.outcomes.no_answer)}</p>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard
          title="Recordings to review"
          description="Five unusual calls worth opening before changing the script or routing."
          className="xl:col-span-12"
        >
          <CallReviewQueuePanel suggestions={reviewSuggestions} campaign={campaign} />
        </DashboardCard>

        <DashboardCard
          title="Audience profile"
          description="Estimated slice metrics from aggregate campaign outcomes and segment composition."
          className="xl:col-span-12"
        >
          <CohortBehaviorTable
            breakdowns={composition}
            loading={compositionLoading}
            metrics={metrics}
            totalRecipients={totalRecipients}
          />
        </DashboardCard>

        <DashboardCard
          title="Conversion funnel"
          className="xl:col-span-6"
        >
          <FunnelColumnChart data={funnelRows} />
        </DashboardCard>

        <DashboardCard
          title="Model spend"
          className="xl:col-span-6"
        >
          <CostTrendChart data={timeline} />
        </DashboardCard>

        <DashboardCard
          title="Call retention"
          className="xl:col-span-6"
          action={productionDrilldown && metrics.engaged20s > 0 ? (
            <DrilldownButton
              label="Open retained calls"
              onClick={() => productionDrilldown({ filter: { kind: "retention", minSeconds: 20 } })}
            />
          ) : undefined}
        >
          <CallRetentionChart data={retentionRows} />
        </DashboardCard>

        <DashboardCard
          title="Model response latency"
          className="xl:col-span-6"
          action={productionDrilldown && latencyRows.length > 0 ? (
            <DrilldownButton
              label="Open latency calls"
              onClick={() => productionDrilldown({ filter: { kind: "latency" } })}
            />
          ) : undefined}
        >
          <GeminiLatencyChart data={latencyRows} />
        </DashboardCard>

      </div>
    </div>
  );
}

export const VoicePerformancePanel = VoiceOverviewPanel;
