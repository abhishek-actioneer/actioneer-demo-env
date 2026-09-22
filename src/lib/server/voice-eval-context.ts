import { getDb } from "@/lib/meta-db";
import { getVoiceCallStageFacts } from "@/lib/voice-campaign-analysis";
import type {
  VoiceCall,
  VoiceCallEvalContextSnapshot,
  VoiceCampaign,
  VoiceTranscriptTurn,
} from "@/lib/voice-campaign-types";
import type { VoiceCustomerContext } from "@/lib/voice-customer-context";
import {
  isVoiceEvalContextSourceId,
  normalizeVoiceEvalContextSources,
  type VoiceEvalContextSourceId,
} from "@/lib/voice-evals";

const MAX_BLOCK_CHARS = 24_000;
const MAX_TRANSCRIPT_CHARS = 36_000;
const MAX_STRING_CHARS = 6_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 7;

const SENSITIVE_KEY = /(?:password|secret|token|authorization|signature|api[_-]?key|cookie|storage[_-]?key|recording[_-]?(?:uri|url)|provider[_-]?url|webhook[_-]?secret)/i;

export type VoiceEvalEvidenceProvenance =
  | "call_record"
  | "call_time_snapshot"
  | "current_campaign_fallback"
  | "derived"
  | "event_store";

export interface VoiceEvalEvidenceBlock {
  source: VoiceEvalContextSourceId;
  available: boolean;
  provenance: VoiceEvalEvidenceProvenance;
  reason?: string;
  truncated?: boolean;
  data?: unknown;
}

export interface VoiceEvalCallContext {
  callId: string;
  campaignId: string;
  generatedAt: string;
  blocks: VoiceEvalEvidenceBlock[];
}

export interface StoredVoiceWebhookEvent {
  eventType: string;
  eventTs: string;
  provider: string | null;
  payload: unknown;
}

interface BuildVoiceEvalContextInput {
  userId: string;
  datasetId: string;
  campaign: VoiceCampaign;
  call: VoiceCall;
  selectedSources: string[];
  /** Test hook; undefined loads events from SQLite, while [] means no events. */
  storedWebhookEvents?: StoredVoiceWebhookEvent[];
}

interface BuildVoiceCallEvalSnapshotInput {
  campaign: VoiceCampaign;
  systemPrompt: string;
  firstMessage: string;
  customerContext?: VoiceCustomerContext;
  contactMemory?: string;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Captures configuration before a call starts so later edits cannot change its evaluation evidence. */
export function buildVoiceCallEvalContextSnapshot(
  input: BuildVoiceCallEvalSnapshotInput,
): VoiceCallEvalContextSnapshot {
  const { campaign } = input;
  return cloneJson({
    capturedAt: new Date().toISOString(),
    workflowConfig: campaign.workflow,
    agentConfig: {
      systemPrompt: input.systemPrompt,
      firstMessage: input.firstMessage,
      purposeId: campaign.purposeId,
      purposeName: campaign.purposeName,
      guardrails: campaign.successDefinition?.guardrails ?? [],
    },
    personaConfig: {
      agentId: campaign.agentId,
      voice: campaign.voice,
      voiceName: campaign.voiceName,
      voiceProvider: campaign.voiceProvider,
      language: campaign.language,
    },
    callConfig: {
      provider: campaign.callProvider,
      datasetId: campaign.datasetId,
      segmentId: campaign.segmentId,
      segmentName: campaign.segmentName,
    },
    variables: input.customerContext,
    contactMemory: input.contactMemory,
  });
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

function redactText(value: string): string {
  const withoutSecrets = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:secret|token|signature|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, "[REDACTED]@$1");
  return withoutSecrets.replace(/\+?\d[\d\s().-]{8,}\d/g, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 16 ? maskPhone(digits) : candidate;
  });
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return "[TRUNCATED: maximum depth]";
  if (typeof value === "string") {
    const redacted = redactText(value);
    return redacted.length > MAX_STRING_CHARS
      ? `${redacted.slice(0, MAX_STRING_CHARS)}…[truncated]`
      : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, key, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[TRUNCATED: ${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of entries) {
      result[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    if (Object.keys(value as Record<string, unknown>).length > MAX_OBJECT_KEYS) {
      result._truncated = "Additional fields omitted";
    }
    return result;
  }
  return String(value);
}

function availableBlock(
  source: VoiceEvalContextSourceId,
  provenance: VoiceEvalEvidenceProvenance,
  data: unknown,
  maxChars = MAX_BLOCK_CHARS,
): VoiceEvalEvidenceBlock {
  const sanitized = sanitizeValue(data);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= maxChars) {
    return { source, available: true, provenance, data: sanitized };
  }
  return {
    source,
    available: true,
    provenance,
    truncated: true,
    data: {
      preview: serialized.slice(0, maxChars),
      truncationReason: `Evidence exceeded ${maxChars} serialized characters.`,
    },
  };
}

function unavailableBlock(
  source: VoiceEvalContextSourceId,
  reason: string,
  provenance: VoiceEvalEvidenceProvenance = "call_record",
): VoiceEvalEvidenceBlock {
  return { source, available: false, provenance, reason };
}

function transcriptBlock(call: VoiceCall): VoiceEvalEvidenceBlock {
  const turns = (call.transcript ?? []).filter((turn) => turn.text.trim());
  if (turns.length === 0) return unavailableBlock("transcript", "No transcript turns were stored for this call.");

  const selected: Array<{
    turnIndex: number;
    speaker: "agent" | "customer" | "recording";
    text: string;
    at: string;
    startMs?: number;
    endMs?: number;
  }> = [];
  let usedChars = 0;
  let truncated = false;
  for (const [index, turn] of turns.entries()) {
    const text = redactText(turn.text.trim());
    if (selected.length > 0 && usedChars + text.length > MAX_TRANSCRIPT_CHARS) {
      truncated = true;
      break;
    }
    selected.push({
      turnIndex: index + 1,
      speaker: turn.role === "assistant" ? "agent" : turn.role === "user" ? "customer" : "recording",
      text: text.slice(0, MAX_STRING_CHARS),
      at: turn.at,
      startMs: turn.startMs,
      endMs: turn.endMs,
    });
    usedChars += text.length;
  }
  return {
    source: "transcript",
    available: true,
    provenance: "call_record",
    truncated,
    data: {
      totalTurns: turns.length,
      includedTurns: selected.length,
      turns: selected,
    },
  };
}

function workflowConfig(campaign: VoiceCampaign, call: VoiceCall) {
  return {
    value: call.evalContextSnapshot?.workflowConfig ?? campaign.workflow,
    provenance: call.evalContextSnapshot?.workflowConfig
      ? "call_time_snapshot" as const
      : "current_campaign_fallback" as const,
  };
}

function workflowSemanticsBlock(campaign: VoiceCampaign, call: VoiceCall): VoiceEvalEvidenceBlock {
  const config = workflowConfig(campaign, call);
  if (!config.value) return unavailableBlock("workflow-semantics", "No workflow configuration was available.");
  const nodes = config.value.nodes ?? [];
  const edges = config.value.edges ?? [];
  const routes = config.value.universalRoutes ?? [];
  return availableBlock("workflow-semantics", config.provenance, {
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      title: node.data.title,
      required: node.data.required,
      intendedBehavior: node.data.body,
      helper: node.data.helper,
      midCallAction: node.data.midCallAction,
    })),
    transitions: edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      label: typeof edge.label === "string" ? edge.label : undefined,
    })),
    universalRoutes: routes.map((route) => ({
      kind: route.kind,
      label: route.label,
      trigger: route.trigger,
      behavior: route.behavior,
      targetNodeId: route.targetNodeId,
      terminal: route.terminal,
    })),
  });
}

function derivedMetrics(call: VoiceCall) {
  const turns = call.transcript ?? [];
  const speakingMs = (role: VoiceTranscriptTurn["role"]) => turns
    .filter((turn) => turn.role === role && turn.startMs !== undefined && turn.endMs !== undefined)
    .reduce((sum, turn) => sum + Math.max(0, (turn.endMs ?? 0) - (turn.startMs ?? 0)), 0);
  const recording = call.bridgeRecording ?? call.recording;
  return {
    ...getVoiceCallStageFacts(call),
    durationSeconds: call.durationSeconds ?? null,
    agentTurns: turns.filter((turn) => turn.role === "assistant").length,
    customerTurns: turns.filter((turn) => turn.role === "user").length,
    agentSpeakingMs: speakingMs("assistant") || null,
    customerSpeakingMs: speakingMs("user") || null,
    recording: recording ? {
      status: recording.status,
      source: recording.source,
      durationSeconds: recording.durationSeconds,
      channels: recording.channels,
      contentType: recording.contentType,
      sizeBytes: recording.sizeBytes,
    } : null,
    unavailableMeasurements: ["response latency", "silence intervals", "interruptions", "audio quality"],
  };
}

function loadStoredWebhookEvents(input: BuildVoiceEvalContextInput): StoredVoiceWebhookEvent[] {
  const identities = Array.from(new Set([
    input.call.id,
    input.call.callConfigId,
    input.call.providerRequestId,
  ].filter((value): value is string => Boolean(value))));
  if (identities.length === 0) return [];
  const placeholders = identities.map(() => "?").join(", ");
  try {
    const rows = getDb().prepare(`
      SELECT event_type, event_ts, provider, payload_json
      FROM call_event_outbox
      WHERE user_id = ? AND dataset_id = ? AND campaign_id = ?
        AND call_id IN (${placeholders})
      ORDER BY event_ts ASC
      LIMIT 100
    `).all(input.userId, input.datasetId, input.campaign.id, ...identities) as Array<{
      event_type: string;
      event_ts: string;
      provider: string | null;
      payload_json: string;
    }>;
    return rows.map((row) => ({
      eventType: row.event_type,
      eventTs: row.event_ts,
      provider: row.provider,
      payload: (() => {
        try { return JSON.parse(row.payload_json) as unknown; } catch { return {}; }
      })(),
    }));
  } catch (error) {
    console.warn("[voice-evals] could not load webhook evidence", error);
    return [];
  }
}

function evidenceBlockForSource(
  source: VoiceEvalContextSourceId,
  input: BuildVoiceEvalContextInput,
): VoiceEvalEvidenceBlock {
  const { campaign, call } = input;
  const snapshot = call.evalContextSnapshot;
  switch (source) {
    case "transcript":
      return transcriptBlock(call);
    case "call-metadata":
      return availableBlock(source, "call_record", {
        callId: call.id,
        callConfigId: call.callConfigId,
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignGoal: campaign.purposeName,
        provider: call.provider ?? campaign.callProvider,
        status: call.status,
        durationSeconds: call.durationSeconds,
        engaged: call.engaged,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        toNumberMasked: maskPhone(call.toNumber),
      });
    case "workflow-logs":
      return unavailableBlock(source, "Runtime workflow node traversal is not currently persisted.");
    case "workflow-semantics":
      return workflowSemanticsBlock(campaign, call);
    case "transfer-context": {
      const config = workflowConfig(campaign, call);
      const transferNodes = (config.value?.nodes ?? []).filter((node) => node.data.kind === "transfer");
      if (transferNodes.length === 0) {
        return unavailableBlock(source, "No configured transfer steps or persisted runtime transfer outcome were found.");
      }
      return availableBlock(source, config.provenance, {
        configuredTransferSteps: transferNodes.map((node) => ({ id: node.id, title: node.data.title, behavior: node.data.body })),
        runtimeOutcomeAvailable: false,
        limitation: "Transfer attempts and outcomes are not currently persisted.",
      });
    }
    case "disposition-results":
      return availableBlock(source, "call_record", call.analysis ? {
        status: call.status,
        outcome: call.analysis.outcome,
        reason: call.analysis.reason,
        nextStep: call.analysis.nextStep,
        callbackPreference: call.analysis.callbackPreference,
        criterionMet: call.analysis.criterionMet,
        criterionReason: call.analysis.criterionReason,
        confidence: call.analysis.confidence,
      } : {
        status: call.status,
        outcome: call.status === "failed" || call.status === "no_answer" ? call.status : "not_analyzed",
      });
    case "citation-variables": {
      const citations = call.analysis?.guardrailViolations ?? [];
      return citations.length
        ? availableBlock(source, "call_record", citations)
        : unavailableBlock(source, "No structured citation variables were stored for this call.");
    }
    case "webhook-payloads": {
      const events = input.storedWebhookEvents ?? loadStoredWebhookEvents(input);
      return events.length
        ? availableBlock(source, "event_store", events)
        : unavailableBlock(source, "No stored provider webhook events matched this call.", "event_store");
    }
    case "tool-logs":
      return unavailableBlock(source, "General runtime tool calls and responses are not currently persisted.");
    case "variables": {
      const variables = snapshot?.variables ?? call.recipientContext;
      return variables
        ? availableBlock(source, snapshot?.variables ? "call_time_snapshot" : "call_record", variables)
        : unavailableBlock(source, "No runtime variables were stored for this call.");
    }
    case "analysis":
      return call.analysis
        ? availableBlock(source, "call_record", {
          ...call.analysis,
          warning: "Secondary model-generated evidence; do not treat it as ground truth.",
        })
        : unavailableBlock(source, "No post-call analysis was stored.");
    case "call-metrics":
      return availableBlock(source, "derived", derivedMetrics(call));
    case "call-config":
      return availableBlock(source, snapshot ? "call_time_snapshot" : "current_campaign_fallback",
        snapshot?.callConfig ?? {
          provider: campaign.callProvider,
          datasetId: campaign.datasetId,
          segmentId: campaign.segmentId,
          segmentName: campaign.segmentName,
        });
    case "agent-config":
      return availableBlock(source, snapshot ? "call_time_snapshot" : "current_campaign_fallback",
        snapshot?.agentConfig ?? {
          systemPrompt: campaign.systemPrompt,
          firstMessage: campaign.firstMessage,
          purposeId: campaign.purposeId,
          purposeName: campaign.purposeName,
          guardrails: campaign.successDefinition?.guardrails ?? [],
        });
    case "workflow-config": {
      const config = workflowConfig(campaign, call);
      return config.value
        ? availableBlock(source, config.provenance, config.value)
        : unavailableBlock(source, "No workflow configuration was available.");
    }
    case "persona-config":
      return availableBlock(source, snapshot ? "call_time_snapshot" : "current_campaign_fallback",
        snapshot?.personaConfig ?? {
          agentId: campaign.agentId,
          voice: campaign.voice,
          voiceName: campaign.voiceName,
          voiceProvider: campaign.voiceProvider,
          language: campaign.language,
        });
    case "contact-memory":
      return snapshot?.contactMemory
        ? availableBlock(source, "call_time_snapshot", { memory: snapshot.contactMemory })
        : unavailableBlock(source, "No call-time contact-memory snapshot was stored.");
    case "call-notes":
      return call.summary || (call.tags?.length ?? 0) > 0
        ? availableBlock(source, "call_record", { summary: call.summary, tags: call.tags ?? [] })
        : unavailableBlock(source, "No call notes were stored.");
  }
}

export function buildVoiceEvalCallContext(input: BuildVoiceEvalContextInput): VoiceEvalCallContext {
  const normalized = normalizeVoiceEvalContextSources(input.selectedSources) ?? [];
  const selectedSources = Array.from(new Set(normalized.filter(isVoiceEvalContextSourceId)));
  return {
    callId: input.call.id,
    campaignId: input.campaign.id,
    generatedAt: new Date().toISOString(),
    blocks: selectedSources.map((source) => evidenceBlockForSource(source, input)),
  };
}

export function serializeVoiceEvalCallContext(context: VoiceEvalCallContext): string {
  return JSON.stringify(context, null, 2);
}
