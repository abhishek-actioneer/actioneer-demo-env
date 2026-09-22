import { withConnection } from "@/lib/db";
import { ensureVoiceVerificationCallsSchema } from "@/lib/voice-verification-schema";
import type { AcousticAnalysisResult, TranscriptFeatures } from "./analysis-service-client";

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlNullable(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${esc(String(value))}'`;
}

export async function persistFraudAnalysisResult(
  callId: string,
  campaignId: string,
  datasetId: string,
  result: AcousticAnalysisResult,
  transcriptFeatures: TranscriptFeatures,
): Promise<void> {
  await withConnection(datasetId, async (conn) => {
    await ensureVoiceVerificationCallsSchema(conn);

    const reasons = result.reasons ?? [];
    const reasonsLiteral = `['${reasons.map((reason) => esc(reason)).join("','")}']`;
    const duressScore = result.duress_score ?? result.fraud_score ?? null;

    await conn.run(`
      INSERT INTO voice_verification_calls (
        call_id, campaign_id, dataset_id, analyzed_at,
        recommendation, duress_score, stress_class, stress_score,
        background_voice, reasons,
        detected_gender, gender_confidence, gender_female_prob, gender_male_prob, gender_mismatch,
        voice_onset_ms, elaboration_ratio, echo_score,
        jitter, shimmer, hnr, mean_f0, f0_variance
      ) VALUES (
        '${esc(callId)}',
        '${esc(campaignId)}',
        '${esc(datasetId)}',
        NOW(),
        ${sqlNullable(result.recommendation ?? "unknown")},
        ${sqlNullable(duressScore)},
        ${sqlNullable(result.stress_class)},
        ${sqlNullable(result.stress_score)},
        ${sqlNullable(result.background_voice)},
        ${reasonsLiteral},
        ${sqlNullable(result.detected_gender)},
        ${sqlNullable(result.gender_confidence)},
        ${sqlNullable(result.gender_female_prob)},
        ${sqlNullable(result.gender_male_prob)},
        ${sqlNullable(result.gender_mismatch)},
        ${sqlNullable(transcriptFeatures.voice_onset_ms)},
        ${sqlNullable(transcriptFeatures.elaboration_ratio)},
        ${sqlNullable(transcriptFeatures.echo_score)},
        ${sqlNullable(result.jitter)},
        ${sqlNullable(result.shimmer)},
        ${sqlNullable(result.hnr)},
        ${sqlNullable(result.mean_f0)},
        ${sqlNullable(result.f0_variance)}
      )
      ON CONFLICT (call_id) DO UPDATE SET
        analyzed_at = NOW(),
        recommendation = EXCLUDED.recommendation,
        duress_score = EXCLUDED.duress_score,
        stress_class = EXCLUDED.stress_class,
        stress_score = EXCLUDED.stress_score,
        background_voice = EXCLUDED.background_voice,
        reasons = EXCLUDED.reasons,
        detected_gender = EXCLUDED.detected_gender,
        gender_confidence = EXCLUDED.gender_confidence,
        gender_female_prob = EXCLUDED.gender_female_prob,
        gender_male_prob = EXCLUDED.gender_male_prob,
        gender_mismatch = EXCLUDED.gender_mismatch,
        voice_onset_ms = EXCLUDED.voice_onset_ms,
        elaboration_ratio = EXCLUDED.elaboration_ratio,
        echo_score = EXCLUDED.echo_score,
        jitter = EXCLUDED.jitter,
        shimmer = EXCLUDED.shimmer,
        hnr = EXCLUDED.hnr,
        mean_f0 = EXCLUDED.mean_f0,
        f0_variance = EXCLUDED.f0_variance
    `);
  });
}
