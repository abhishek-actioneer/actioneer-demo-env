/**
 * voice-enrichment.ts — Layer 2 post-call qualitative enrichment (U7 + U8).
 *
 * One sample-gated pass per call produces a `call_id`-keyed `voice_call_enrichment`
 * record covering: per-turn sentiment trajectory (R10), user question/intent
 * types, spine-grounded interruption handling (R11), guardrail compliance (via
 * U6's {status, violations} contract), and live script-adherence scores (R9/U8).
 *
 * Runs entirely post-hangup — zero hot-path impact (R12). The spine is ground
 * truth: the interruption judge is handed the spine's `interrupted` turn indices
 * and never re-detects whether an interruption occurred (KTD7, AE3).
 *
 * Each judge runs EXACTLY ONCE (KTD8 — pass^k reliability is measured offline,
 * not by k-sampling every call). Every dimension is individually guarded so one
 * judge's failure never drops the whole record or affects call teardown.
 */

import { generateJson } from "@/lib/llm";
import { checkGuardrailCompliance } from "./voice-response-analysis";
import { evaluateScriptAdherenceCall } from "./voice-campaign-analysis";
import { selectDisplayTranscript } from "./voice-transcript-display";
import {
  emitVoiceEnrichment,
  VOICE_ENRICHMENT_SAMPLE_RATE,
  type JudgeStatus,
  type VoicePipeline,
  type VoiceEnrichmentRecord,
} from "./voice-events";
import type { VoiceCall, VoiceCampaign, VoiceTranscriptTurn } from "./voice-campaign-types";

export interface VoiceEnrichmentInput {
  /** MUST be the same call_id the spine (voice_turn) events use, so the
   *  enrichment record joins the latency rows by call_id (flagship cross-cut). */
  callId: string;
  campaign: VoiceCampaign;
  call: VoiceCall;
  /** Spine ground truth: turn indices flagged `interrupted` (KTD7, R11). */
  interruptedTurnIndices: number[];
  pipeline?: VoicePipeline;
  /** Test seams. */
  rng?: () => number;
  sampleRate?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/** Sample decision: enriched when rng() < rate (KTD5). */
export function rollEnrichmentSample(rate: number, rng: () => number = Math.random): boolean {
  return rng() < rate;
}

function transcriptForPrompt(turns: VoiceTranscriptTurn[]): string {
  return turns
    .filter((t) => t.role === "assistant" || t.role === "user")
    .map((t, i) => `${i + 1}. ${t.role === "assistant" ? "Agent" : "Customer"}: ${t.text}`)
    .join("\n")
    .slice(0, 12_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Judges — each runs once, each self-guards to a judge_status
// ─────────────────────────────────────────────────────────────────────────────

interface SentimentJudgeOut {
  trajectory: Array<{ turn_index: number; label: string }>;
}

async function judgeSentimentTrajectory(
  campaign: VoiceCampaign,
  turns: VoiceTranscriptTurn[],
): Promise<Array<{ turn_index: number; label: string }>> {
  if (turns.length === 0) return [];
  const res = await generateJson<SentimentJudgeOut>({
    messages: [
      {
        role: "system",
        content: `You track customer sentiment across a voice call, turn by turn.
For each customer turn where sentiment is discernible, return the 1-based turn_index and a single-word label
(one of: positive, neutral, negative, frustrated, confused). Only include turns where sentiment is clear.`,
      },
      { role: "user", content: `TRANSCRIPT:\n${transcriptForPrompt(turns)}` },
    ],
    jsonSchema: {
      name: "sentiment_trajectory",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          trajectory: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { turn_index: { type: "number" }, label: { type: "string" } },
              required: ["turn_index", "label"],
            },
          },
        },
        required: ["trajectory"],
      },
    },
    feature: "voice-enrichment.sentiment-trajectory",
    label: "voice enrichment sentiment trajectory",
    datasetId: campaign.datasetId ?? "",
    timeoutMs: 30_000,
    maxOutputTokens: 400,
  });
  return Array.isArray(res.trajectory) ? res.trajectory : [];
}

interface QuestionTypesJudgeOut {
  question_types: string[];
}

async function judgeQuestionTypes(
  campaign: VoiceCampaign,
  turns: VoiceTranscriptTurn[],
): Promise<string[]> {
  if (turns.length === 0) return [];
  const res = await generateJson<QuestionTypesJudgeOut>({
    messages: [
      {
        role: "system",
        content: `Classify the customer's questions/intents in this voice call into short snake_case type labels
(e.g. pricing, eligibility, process, objection, callback_request, complaint). Return the distinct types present.`,
      },
      { role: "user", content: `TRANSCRIPT:\n${transcriptForPrompt(turns)}` },
    ],
    jsonSchema: {
      name: "question_types",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { question_types: { type: "array", items: { type: "string" } } },
        required: ["question_types"],
      },
    },
    feature: "voice-enrichment.question-types",
    label: "voice enrichment question types",
    datasetId: campaign.datasetId ?? "",
    timeoutMs: 30_000,
    maxOutputTokens: 200,
  });
  return Array.isArray(res.question_types) ? res.question_types : [];
}

type InterruptionHandling = {
  judge_status: JudgeStatus;
  interrupted_turn_count: number;
  interrupted_turn_indices: number[];
  grade?: string;
  notes?: string;
};

interface InterruptionJudgeOut {
  grade: string;
  notes: string;
}

/**
 * R11/AE3: grade only whether the agent stopped, acknowledged, and addressed
 * each barge-in. The set of interrupted turns is GIVEN by the spine — the judge
 * never decides *whether* an interruption occurred.
 */
async function judgeInterruptionHandling(
  campaign: VoiceCampaign,
  turns: VoiceTranscriptTurn[],
  interruptedTurnIndices: number[],
): Promise<InterruptionHandling> {
  const indices = [...interruptedTurnIndices];
  if (indices.length === 0) {
    return { judge_status: "ok", interrupted_turn_count: 0, interrupted_turn_indices: [], grade: "none" };
  }
  try {
    const res = await generateJson<InterruptionJudgeOut>({
      messages: [
        {
          role: "system",
          content: `You grade how well a voice agent HANDLED customer interruptions (barge-ins).
The interrupted turns have ALREADY been identified for you — do not decide whether an interruption occurred.
Grade only: did the agent stop talking, acknowledge the interjection, and address it? Return an overall grade
(good | partial | poor) and a one-line note.`,
        },
        {
          role: "user",
          content: `INTERRUPTED TURN INDICES (spine ground truth): ${JSON.stringify(indices)}\n\nTRANSCRIPT:\n${transcriptForPrompt(turns)}`,
        },
      ],
      jsonSchema: {
        name: "interruption_handling",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { grade: { type: "string" }, notes: { type: "string" } },
          required: ["grade", "notes"],
        },
      },
      feature: "voice-enrichment.interruption-handling",
      label: "voice enrichment interruption handling",
      datasetId: campaign.datasetId ?? "",
      timeoutMs: 30_000,
      maxOutputTokens: 200,
    });
    return {
      judge_status: "ok",
      interrupted_turn_count: indices.length,
      interrupted_turn_indices: indices,
      grade: res.grade,
      notes: res.notes,
    };
  } catch {
    return { judge_status: "error", interrupted_turn_count: indices.length, interrupted_turn_indices: indices };
  }
}

type ComplianceDimension = {
  judge_status: JudgeStatus;
  violations: Array<{ rule: string; turn: number; quote: string }>;
};

async function judgeCompliance(
  campaign: VoiceCampaign,
  turns: VoiceTranscriptTurn[],
): Promise<ComplianceDimension> {
  const guardrails: string[] = campaign.successDefinition?.guardrails ?? [];
  const r = await checkGuardrailCompliance(guardrails, turns, campaign.datasetId ?? "");
  return { judge_status: r.status, violations: r.violations };
}

/** U8/R9: route the ALREADY-LIVE six-check script-adherence score into the record.
 *  Single source — reuses evaluateScriptAdherenceCall, never a new rubric copy. */
export function scriptAdherenceScores(
  campaign: VoiceCampaign,
  call: VoiceCall,
): Record<string, unknown> {
  try {
    const evalResult = evaluateScriptAdherenceCall(campaign, call);
    if (!evalResult) return { score: 0, failed_keys: [], checks: {} };
    return { score: evalResult.score, failed_keys: evalResult.failedKeys, checks: evalResult.checks };
  } catch {
    return { score: 0, failed_keys: [], checks: {}, judge_status: "error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function guarded<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Run the post-call enrichment pass and emit exactly one `voice_call_enrichment`
 * event. Never throws — the whole pass is guarded so call teardown is unaffected.
 */
export async function runVoiceEnrichment(input: VoiceEnrichmentInput): Promise<void> {
  const { callId, campaign, call, interruptedTurnIndices, pipeline = "gemini_live" } = input;
  const rate = input.sampleRate ?? VOICE_ENRICHMENT_SAMPLE_RATE;
  const rng = input.rng ?? Math.random;

  try {
    // Sample roll made once per call and recorded — a rate change never touches
    // the emit schema; every call still produces one weightable event (KTD5).
    if (!rollEnrichmentSample(rate, rng)) {
      const skipped: VoiceEnrichmentRecord = {
        sentiment_trajectory: [],
        question_types: [],
        script_adherence_scores: null,
        interruption_handling: null,
        compliance_violations: null,
        enriched: false,
        sample_rate: rate,
      };
      emitVoiceEnrichment(skipped, callId, pipeline);
      return;
    }

    const turns = selectDisplayTranscript(call);

    // Each judge runs once, concurrently; each self-guards so a single failure
    // marks only its dimension (partial record still emits).
    const [sentiment, questionTypes, interruption, compliance] = await Promise.all([
      guarded(() => judgeSentimentTrajectory(campaign, turns), []),
      guarded(() => judgeQuestionTypes(campaign, turns), []),
      judgeInterruptionHandling(campaign, turns, interruptedTurnIndices), // self-guards
      guarded<ComplianceDimension>(() => judgeCompliance(campaign, turns), {
        judge_status: "error",
        violations: [],
      }),
    ]);

    const record: VoiceEnrichmentRecord = {
      sentiment_trajectory: sentiment,
      question_types: questionTypes,
      script_adherence_scores: scriptAdherenceScores(campaign, call),
      interruption_handling: interruption,
      compliance_violations: compliance,
      enriched: true,
      sample_rate: rate,
    };
    emitVoiceEnrichment(record, callId, pipeline);
  } catch (err) {
    // Last-resort guard: enrichment failure must never affect call teardown.
    console.error("[voice/enrichment] enrichment pass failed:", err);
  }
}
