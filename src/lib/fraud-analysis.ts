// Shared fraud call analysis - used by both plivo-status (phone calls) and
// voice-test-bridge (browser test calls).

import { existsSync, readFileSync } from "fs";
import { setTimeout as sleep } from "timers/promises";
import { withConnection } from "./db";
import { ensureVoiceVerificationCallsSchema } from "./voice-verification-schema";
import { DEFAULT_DATASET } from "./datasets/constants";
import { findCallByAnyIdentity } from "./voice-campaign-store";
import {
  recordingFilePath,
  recordingStorageKey,
  recordingStorageKeyCandidatesForScope,
} from "./voice-storage";
import { readRecordingBytes } from "./voice-recording-storage";
import type { VoiceTranscriptTurn } from "./voice-campaign-types";

export { runFraudAnalysis, runFraudAnalysisFromBytes } from "@/features/fraud/server/run-fraud-analysis";

const BRIDGE_RECORDING_WAIT_MS = 90_000;
const BRIDGE_RECORDING_POLL_MS = 1_000;

export interface TranscriptFeatures {
  voiceOnsetMs: number | null;
  elaborationRatio: number | null;
  echoScore: number | null;
}

export interface AcousticFeatures {
  jitter: number | null;
  shimmer: number | null;
  hnr: number | null;
  mean_f0: number | null;
  f0_variance: number | null;
  mfcc_1_13: number[] | null;
  speaking_rate: number | null;
  background_voice: boolean;
  stress_class: number;
  stress_score: number;
  rule_score: number;
  reasons: string[];
  detected_gender: string | null;
  gender_confidence: number | null;
  gender_signals: Record<string, unknown> | null;
}

export interface FraudAnalysisInput {
  callId: string;
  campaignId?: string;
  alertId: string;
  customerId: string;
  amountAtRisk: number;
  recommendation: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  cardholderGender: string | null;
  transcript: VoiceTranscriptTurn[];
  resolvedAt?: string;
  datasetId?: string;
}

export type GenderClassificationSkipReason =
  | "service_unavailable"
  | "invalid_call_identity"
  | "recording_missing"
  | "recording_timeout";

export type GenderClassificationResult =
  | {
    kind: "detected";
    detected_gender: string | null;
    gender_confidence: number | null;
    gender_signals: Record<string, unknown> | null;
  }
  | {
    kind: "skipped";
    reason: GenderClassificationSkipReason;
    detail?: string;
  }
  | {
    kind: "failed";
    reason: string;
  };

function analysisServiceUrl(): string {
  return (process.env.FRAUD_ANALYSIS_SERVICE_URL || process.env.ANALYSIS_SERVICE_URL || "http://localhost:8000").replace(/\/$/, "");
}

/** The external Python fraud-analysis service is optional. Treat it as enabled only when a URL is explicitly configured. */
function isAnalysisServiceConfigured(): boolean {
  return Boolean((process.env.FRAUD_ANALYSIS_SERVICE_URL || process.env.ANALYSIS_SERVICE_URL || "").trim());
}

let warnedAnalysisServiceDisabled = false;

export function computeTranscriptFeatures(turns: VoiceTranscriptTurn[]): TranscriptFeatures {
  const agentTurns = turns.filter((t) => t.role === "assistant");
  const customerTurns = turns.filter((t) => t.role === "user");

  const onsets: number[] = [];
  for (const agentTurn of agentTurns) {
    const agentAt = new Date(agentTurn.at).getTime();
    const nextCustomer = customerTurns.find((t) => new Date(t.at).getTime() > agentAt);
    if (nextCustomer) {
      const gap = new Date(nextCustomer.at).getTime() - agentAt;
      if (gap > 0 && gap < 10_000) onsets.push(gap);
    }
  }
  const voiceOnsetMs = onsets.length > 0 ? median(onsets) : null;

  const elaborationRatios: number[] = [];
  for (const agentTurn of agentTurns) {
    const agentAt = new Date(agentTurn.at).getTime();
    const response = customerTurns.find((t) => new Date(t.at).getTime() > agentAt);
    if (response) {
      const agentWords = wordCount(agentTurn.text);
      const customerWords = wordCount(response.text);
      if (agentWords > 0) elaborationRatios.push(customerWords / agentWords);
    }
  }
  const elaborationRatio = elaborationRatios.length > 0 ? mean(elaborationRatios) : null;

  const echoScores: number[] = [];
  for (const agentTurn of agentTurns) {
    const agentAt = new Date(agentTurn.at).getTime();
    const response = customerTurns.find((t) => new Date(t.at).getTime() > agentAt);
    if (response) {
      echoScores.push(wordOverlap(agentTurn.text, response.text));
    }
  }
  const echoScore = echoScores.length > 0 ? mean(echoScores) : null;

  return { voiceOnsetMs, elaborationRatio, echoScore };
}

export function computeDuressScore(f: TranscriptFeatures): number {
  let score = 0;
  if (f.voiceOnsetMs != null && f.voiceOnsetMs > 800) score += 0.30;
  if (f.echoScore != null && f.echoScore > 0.75) score += 0.30;
  if (f.elaborationRatio != null && f.elaborationRatio < 0.25) score += 0.25;
  if (f.voiceOnsetMs != null && f.voiceOnsetMs > 1200) score += 0.15;
  return Math.min(score, 1.0);
}

export async function runGenderClassification(callIdentityOrList: string | string[]): Promise<GenderClassificationResult> {
  if (!isAnalysisServiceConfigured()) {
    if (!warnedAnalysisServiceDisabled) {
      warnedAnalysisServiceDisabled = true;
      console.info("[fraud-analysis] gender classification disabled — set FRAUD_ANALYSIS_SERVICE_URL to enable. Skipping.");
    }
    return {
      kind: "skipped",
      reason: "service_unavailable",
      detail: "FRAUD_ANALYSIS_SERVICE_URL not configured",
    };
  }

  const identities = Array.isArray(callIdentityOrList)
    ? callIdentityOrList
    : [callIdentityOrList];
  if (identities.map((value) => value?.trim()).filter(Boolean).length === 0) {
    return {
      kind: "skipped",
      reason: "invalid_call_identity",
      detail: "no call identity provided for bridge WAV lookup",
    };
  }
  const wavLookup = await readBridgeWavBytes(identities);
  if (!wavLookup.bytes) {
    const reason = wavLookup.timedOut ? "recording_timeout" : "recording_missing";
    console.log(
      `[fraud-analysis] no bridge WAV for callIdentity=${identities.join(",") || "(missing)"} - skipping gender (${reason})`,
    );
    return {
      kind: "skipped",
      reason,
      detail: `bridge WAV unavailable for identities=${identities.join(",") || "(missing)"}`,
    };
  }

  try {
    const res = await fetch(`${analysisServiceUrl()}/classify-gender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_base64: wavLookup.bytes.toString("base64") }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const reason = `gender_service_http_${res.status}: ${text.slice(0, 200) || res.statusText}`;
      console.warn(`[fraud-analysis] ${reason}`);
      return {
        kind: "failed",
        reason,
      };
    }
    const parsed = await res.json() as {
      detected_gender: string | null;
      gender_confidence: number | null;
      gender_signals: Record<string, unknown> | null;
    };
    return {
      kind: "detected",
      detected_gender: parsed.detected_gender,
      gender_confidence: parsed.gender_confidence,
      gender_signals: parsed.gender_signals,
    };
  } catch (error) {
    const reason = `gender_service_request_failed: ${error instanceof Error ? error.message : String(error)}`;
    console.warn("[fraud-analysis] gender service request failed:", error instanceof Error ? error.message : error);
    return {
      kind: "failed",
      reason,
    };
  }
}

export type GenderStatus = "pending" | "completed" | "failed" | "skipped";

export async function writeGenderToDuckDB(
  callId: string,
  cardholderGender: string | null,
  gender: { detected_gender: string | null; gender_confidence: number | null; gender_signals: Record<string, unknown> | null },
  datasetId = DEFAULT_DATASET,
  options: { campaignId?: string } = {},
): Promise<void> {
  const { detected_gender, gender_confidence, gender_signals } = gender;
  const { femaleProb, maleProb } = genderProbabilities(gender_signals);
  const genderMismatch =
    detected_gender && cardholderGender && detected_gender !== "uncertain"
      ? detected_gender.toLowerCase() !== cardholderGender.toLowerCase()
      : null;

  await withConnection(datasetId, async (conn) => {
    await ensureVoiceVerificationCallsSchema(conn);
    await conn.run(`
      INSERT INTO voice_verification_calls (
        call_id, campaign_id, dataset_id, analyzed_at, recommendation,
        detected_gender, gender_confidence, gender_female_prob, gender_male_prob, gender_mismatch, gender_signals, gender_status,
        cardholder_gender
      ) VALUES (
        '${esc(callId)}',
        '${esc(options.campaignId ?? "")}',
        '${esc(datasetId)}',
        NOW(),
        'unknown',
        ${detected_gender ? `'${esc(detected_gender)}'` : "NULL"},
        ${gender_confidence ?? "NULL"},
        ${femaleProb ?? "NULL"},
        ${maleProb ?? "NULL"},
        ${genderMismatch !== null ? genderMismatch : "NULL"},
        '${esc(JSON.stringify(gender_signals ?? {}))}',
        'completed',
        ${cardholderGender ? `'${esc(cardholderGender)}'` : "NULL"}
      )
      ON CONFLICT (call_id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        dataset_id = EXCLUDED.dataset_id,
        analyzed_at = NOW(),
        detected_gender = EXCLUDED.detected_gender,
        gender_confidence = EXCLUDED.gender_confidence,
        gender_female_prob = EXCLUDED.gender_female_prob,
        gender_male_prob = EXCLUDED.gender_male_prob,
        gender_mismatch = EXCLUDED.gender_mismatch,
        gender_signals = EXCLUDED.gender_signals,
        gender_status = EXCLUDED.gender_status,
        cardholder_gender = EXCLUDED.cardholder_gender
    `);
    console.log(`[fraud-analysis] gender update written callId=${callId} detected=${detected_gender}`);
  });
}

/**
 * Marks the gender-classification attempt state for a call without touching detected_gender.
 * Written before the (potentially slow, potentially interrupted) classification attempt starts,
 * and again on skip/failure — so a dropped background task shows up as a stuck "pending" row
 * instead of being indistinguishable from "never attempted".
 */
export async function updateGenderStatus(
  callId: string,
  datasetId: string,
  status: GenderStatus,
  reason?: string,
): Promise<void> {
  await withConnection(datasetId, async (conn) => {
    await ensureVoiceVerificationCallsSchema(conn);
    const existing = await conn.run(`SELECT call_id FROM voice_verification_calls WHERE call_id = '${esc(callId)}'`);
    if ((await existing.getRows()).length === 0) return;
    await conn.run(`
      UPDATE voice_verification_calls
      SET gender_status = '${esc(status)}'${reason ? `, gender_signals = '${esc(JSON.stringify({ reason }))}'` : ""}
      WHERE call_id = '${esc(callId)}'
    `);
    console.log(`[fraud-analysis] gender_status=${status} callId=${callId}${reason ? ` reason=${reason}` : ""}`);
  });
}

export async function runAcousticAnalysis(
  callUuid: string,
  transcriptFeatures: TranscriptFeatures,
): Promise<AcousticFeatures | null> {
  const wavLookup = await readBridgeWavBytes([callUuid]);

  if (!wavLookup.bytes) {
    const reason = wavLookup.timedOut ? "recording_timeout" : "recording_missing";
    console.log(`[fraud-analysis] no bridge WAV for callUuid=${callUuid} - skipping acoustic (${reason})`);
    return null;
  }

  console.log(`[fraud-analysis] sending ${wavLookup.bytes.length}B WAV to analysis service`);

  const res = await fetch(`${analysisServiceUrl()}/analyze-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wav_base64: wavLookup.bytes.toString("base64"),
      transcript_features: {
        voice_onset_ms: transcriptFeatures.voiceOnsetMs,
        elaboration_ratio: transcriptFeatures.elaborationRatio,
        echo_score: transcriptFeatures.echoScore,
      },
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Analysis service ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<AcousticFeatures>;
}

export async function writeFraudAnalysisToDuckDB(
  input: FraudAnalysisInput,
  features: TranscriptFeatures,
  duressScore: number,
  acoustic: AcousticFeatures | null,
): Promise<void> {
  const dsId = input.datasetId ?? DEFAULT_DATASET;
  const detectedGender = acoustic?.detected_gender ?? null;
  const { femaleProb, maleProb } = genderProbabilities(acoustic?.gender_signals);
  const cardholderGender = input.cardholderGender;
  const genderMismatch =
    detectedGender && cardholderGender && detectedGender !== "uncertain"
      ? detectedGender.toLowerCase() !== cardholderGender.toLowerCase()
      : null;

  await withConnection(dsId, async (conn) => {
    await ensureVoiceVerificationCallsSchema(conn);

    const reasons = acoustic?.reasons ?? [];
    const reasonsLiteral = reasons.length > 0
      ? `['${reasons.map((reason) => esc(reason)).join("','")}']`
      : "[]";
    const sql = `
      INSERT INTO voice_verification_calls (
        call_id, campaign_id, dataset_id, analyzed_at,
        alert_id, customer_id, amount_at_risk_inr,
        recommendation, tool_name, tool_args,
        voice_onset_ms, elaboration_ratio, echo_score,
        duress_score, stress_class, stress_score, jitter, shimmer, hnr,
        mean_f0, f0_variance, background_voice, reasons, feature_importances,
        turn_count, transcript,
        detected_gender, gender_confidence, gender_female_prob, gender_male_prob, gender_mismatch, gender_signals,
        cardholder_gender, called_at, resolved_at
      ) VALUES (
        '${esc(input.callId)}',
        '${esc(input.campaignId ?? "")}',
        '${esc(dsId)}',
        NOW(),
        '${esc(input.alertId)}',
        '${esc(input.customerId)}',
        ${input.amountAtRisk},
        '${esc(input.recommendation)}',
        '${esc(input.toolName)}',
        '${esc(JSON.stringify(input.toolArgs))}',
        ${features.voiceOnsetMs ?? "NULL"},
        ${features.elaborationRatio ?? "NULL"},
        ${features.echoScore ?? "NULL"},
        ${duressScore},
        ${acoustic?.stress_class ?? "NULL"},
        ${acoustic?.stress_score ?? "NULL"},
        ${acoustic?.jitter ?? "NULL"},
        ${acoustic?.shimmer ?? "NULL"},
        ${acoustic?.hnr ?? "NULL"},
        ${acoustic?.mean_f0 ?? "NULL"},
        ${acoustic?.f0_variance ?? "NULL"},
        ${acoustic?.background_voice ?? "NULL"},
        ${reasonsLiteral},
        '${esc(JSON.stringify(acoustic ? { reasons: acoustic.reasons, stress_score: acoustic.stress_score } : {}))}',
        ${input.transcript.length},
        '${esc(JSON.stringify(input.transcript.map((t) => ({ role: t.role, text: t.text, at: t.at }))))}',
        ${detectedGender ? `'${esc(detectedGender)}'` : "NULL"},
        ${acoustic?.gender_confidence ?? "NULL"},
        ${femaleProb ?? "NULL"},
        ${maleProb ?? "NULL"},
        ${genderMismatch !== null ? genderMismatch : "NULL"},
        '${esc(JSON.stringify(acoustic?.gender_signals ?? {}))}',
        ${cardholderGender ? `'${esc(cardholderGender)}'` : "NULL"},
        '${new Date().toISOString()}',
        '${esc(input.resolvedAt ?? new Date().toISOString())}'
      )
      ON CONFLICT (call_id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        dataset_id = EXCLUDED.dataset_id,
        analyzed_at = NOW(),
        alert_id = EXCLUDED.alert_id,
        customer_id = EXCLUDED.customer_id,
        amount_at_risk_inr = EXCLUDED.amount_at_risk_inr,
        recommendation = EXCLUDED.recommendation,
        tool_name = EXCLUDED.tool_name,
        tool_args = EXCLUDED.tool_args,
        voice_onset_ms = EXCLUDED.voice_onset_ms,
        elaboration_ratio = EXCLUDED.elaboration_ratio,
        echo_score = EXCLUDED.echo_score,
        duress_score = EXCLUDED.duress_score,
        stress_class = EXCLUDED.stress_class,
        stress_score = EXCLUDED.stress_score,
        jitter = EXCLUDED.jitter,
        shimmer = EXCLUDED.shimmer,
        hnr = EXCLUDED.hnr,
        mean_f0 = EXCLUDED.mean_f0,
        f0_variance = EXCLUDED.f0_variance,
        background_voice = EXCLUDED.background_voice,
        reasons = EXCLUDED.reasons,
        feature_importances = EXCLUDED.feature_importances,
        turn_count = EXCLUDED.turn_count,
        transcript = EXCLUDED.transcript,
        detected_gender = EXCLUDED.detected_gender,
        gender_confidence = EXCLUDED.gender_confidence,
        gender_female_prob = EXCLUDED.gender_female_prob,
        gender_male_prob = EXCLUDED.gender_male_prob,
        gender_mismatch = EXCLUDED.gender_mismatch,
        gender_signals = EXCLUDED.gender_signals,
        cardholder_gender = EXCLUDED.cardholder_gender,
        resolved_at = EXCLUDED.resolved_at
    `;
    await conn.run(sql);
    console.log(`[fraud-analysis] wrote call_id=${input.callId} alertId=${input.alertId} duress=${duressScore.toFixed(2)} outcome=${input.recommendation}`);
  });
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function numericSignal(signals: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = signals?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function genderProbabilities(signals: Record<string, unknown> | null | undefined): {
  femaleProb: number | null;
  maleProb: number | null;
} {
  return {
    femaleProb: numericSignal(signals, "female_prob"),
    maleProb: numericSignal(signals, "male_prob"),
  };
}

async function readBridgeWavBytes(callIdentities: string[]): Promise<{ bytes: Buffer | null; timedOut: boolean }> {
  const identities = Array.from(new Set(callIdentities.map((value) => value?.trim()).filter(Boolean)));
  if (identities.length === 0) {
    return { bytes: null, timedOut: false };
  }
  const deadline = Date.now() + BRIDGE_RECORDING_WAIT_MS;
  let attempt = 0;

  while (true) {
    const bytes = await tryReadBridgeWavBytes(identities, attempt === 0);
    if (bytes) return { bytes, timedOut: false };

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { bytes: null, timedOut: true };

    await sleep(Math.min(BRIDGE_RECORDING_POLL_MS, remainingMs));
    attempt += 1;
  }
}

async function tryReadBridgeWavBytes(callIdentities: string[], logFirstFailure: boolean): Promise<Buffer | null> {
  const found = findCallByAnyIdentity(callIdentities);
  const bridgeStorageKey = found?.call.bridgeRecording?.storageKey;
  if (bridgeStorageKey) {
    try {
      const { bytes } = await readRecordingBytes(bridgeStorageKey, { quiet: !logFirstFailure });
      return bytes;
    } catch (error) {
      if (logFirstFailure) {
        console.warn(
          `[fraud-analysis] bridge recording read failed identities=${callIdentities.join(",")} storageKey=${bridgeStorageKey}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  const resolvedCallIds = Array.from(new Set([
    found?.call.id,
    ...callIdentities,
  ].filter(Boolean) as string[]));

  const candidateKeys = [
    ...(found
      ? resolvedCallIds.flatMap((callId) =>
        recordingStorageKeyCandidatesForScope({
          userId: found.campaign.userId,
          datasetId: found.campaign.datasetId,
          campaignId: found.campaign.id,
        }, callId, `bridge-${callId}`, "wav")
      )
      : []),
    ...resolvedCallIds.map((callId) => recordingStorageKey(callId, `bridge-${callId}`, "wav")),
  ];
  for (const key of Array.from(new Set(candidateKeys))) {
    const path = recordingFilePath(key);
    if (existsSync(path)) return readFileSync(path);
    try {
      const { bytes } = await readRecordingBytes(key, { quiet: true });
      return bytes;
    } catch {
      // Try the next historical key shape.
    }
  }
  return null;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function wordOverlap(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const bWords = b.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  return bWords.filter((w) => aWords.has(w)).length / bWords.length;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
