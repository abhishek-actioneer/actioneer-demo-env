import { auth } from "@clerk/nextjs/server";
import { withConnection } from "@/lib/db";
import { ensureVoiceVerificationCallsSchema } from "@/lib/voice-verification-schema";
import type { VoiceForensicsResult } from "@/lib/voice-forensics";

export const dynamic = "force-dynamic";

export interface FraudCallAnalysis {
  call_id: string;
  alert_id: string;
  recommendation: string | null;
  duress_score: number | null;
  // Gender (audeering wav2vec2)
  detected_gender: string | null;
  /** Registered gender of the selected persona/cardholder the call impersonation is checked against. */
  cardholder_gender: string | null;
  gender_confidence: number | null;
  gender_mismatch: boolean | null;
  gender_female_prob: number | null;
  gender_male_prob: number | null;
  gender_audio_duration_s: number | null;
  gender_status: string | null;
  // Conversation signals
  voice_onset_ms: number | null;
  elaboration_ratio: number | null;
  echo_score: number | null;
  turn_count: number | null;
  // Acoustic signals
  jitter: number | null;
  shimmer: number | null;
  hnr: number | null;
  mean_f0: number | null;
  f0_variance: number | null;
  background_voice: boolean | null;
  // Stress model
  stress_class: number | null;
  stress_score: number | null;
  reasons: string[];
  called_at: string | null;
  // Voice forensics (user-side): gender / speaker verification / deepfake-LA / replay-PA.
  // Rolling scores accumulated over ~5s user-audio windows during the call.
  vf_gender: string | null;
  vf_gender_confidence: number | null;
  vf_gender_female_prob: number | null;
  vf_gender_male_prob: number | null;
  vf_speaker_similarity: number | null;
  vf_speaker_verified: boolean | null;
  vf_synthetic_prob: number | null;
  vf_is_synthetic: boolean | null;
  vf_replay_prob: number | null;
  vf_is_replay: boolean | null;
  vf_cumulative_ms: number | null;
  vf_user_audio_ms: number | null;
  vf_results: VoiceForensicsResult | null;
  vf_results_by_horizon: VoiceForensicsResult["horizons"] | null;
  // Human-review escalation (set via POST /api/fraud-alerts/escalate)
  escalation_status: string | null;
  escalated_at: string | null;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const callId = url.searchParams.get("callId") ?? "";
  const datasetId = url.searchParams.get("datasetId") ?? "hdfc-creditfraud";
  if (!callId) return Response.json({ error: "callId required" }, { status: 400 });

  try {
    const row = await withConnection(datasetId, async (conn) => {
      const safeId = callId.replace(/'/g, "''");
      // Guarantee the table exists with the full column set (creates it if
      // absent, adds any missing columns to older/partial tables) so the read
      // below never hits a binder error regardless of which writer ran first.
      await ensureVoiceVerificationCallsSchema(conn);
      const result = await conn.run(`
        SELECT call_id, alert_id, recommendation, duress_score,
               detected_gender, cardholder_gender, gender_confidence, gender_mismatch, gender_signals, gender_status,
               voice_onset_ms, elaboration_ratio, echo_score, turn_count,
               jitter, shimmer, hnr, mean_f0, f0_variance,
               background_voice, stress_class, feature_importances, called_at,
               vf_gender, vf_gender_confidence, vf_gender_female_prob, vf_gender_male_prob,
               vf_speaker_similarity, vf_speaker_verified, vf_synthetic_prob, vf_is_synthetic,
               vf_replay_prob, vf_is_replay, vf_cumulative_ms, vf_user_audio_ms, vf_results_json,
               escalation_status, escalated_at
        FROM voice_verification_calls
        WHERE call_id = '${safeId}'
        LIMIT 1
      `);
      const cols = Array.from(result.columnNames()).map(String);
      const rows = await result.getRows();
      if (rows.length === 0) return null;
      const r: Record<string, unknown> = {};
      cols.forEach((col, i) => { r[col] = rows[0]![i]; });

      // Parse JSON blobs
      let genderSignals: Record<string, unknown> = {};
      let featureImportances: { reasons?: string[]; stress_score?: number } = {};
      let vfResults: VoiceForensicsResult | null = null;
      try { genderSignals = JSON.parse(String(r.gender_signals ?? "{}")) as Record<string, unknown>; } catch { /* */ }
      try { featureImportances = JSON.parse(String(r.feature_importances ?? "{}")) as typeof featureImportances; } catch { /* */ }
      try {
        const parsed = JSON.parse(String(r.vf_results_json ?? "null")) as unknown;
        vfResults = isVoiceForensicsResult(parsed) ? parsed : null;
      } catch { /* */ }

      return {
        call_id: String(r.call_id ?? ""),
        alert_id: String(r.alert_id ?? ""),
        recommendation: r.recommendation != null ? String(r.recommendation) : null,
        duress_score: r.duress_score != null ? Number(r.duress_score) : null,
        detected_gender: r.detected_gender != null ? String(r.detected_gender) : null,
        cardholder_gender: r.cardholder_gender != null ? String(r.cardholder_gender) : null,
        gender_confidence: r.gender_confidence != null ? Number(r.gender_confidence) : null,
        gender_mismatch: r.gender_mismatch != null ? Boolean(r.gender_mismatch) : null,
        gender_female_prob: genderSignals.female_prob != null ? Number(genderSignals.female_prob) : null,
        gender_male_prob: genderSignals.male_prob != null ? Number(genderSignals.male_prob) : null,
        gender_audio_duration_s: genderSignals.audio_duration_s != null ? Number(genderSignals.audio_duration_s) : null,
        gender_status: r.gender_status != null ? String(r.gender_status) : null,
        voice_onset_ms: r.voice_onset_ms != null ? Number(r.voice_onset_ms) : null,
        elaboration_ratio: r.elaboration_ratio != null ? Number(r.elaboration_ratio) : null,
        echo_score: r.echo_score != null ? Number(r.echo_score) : null,
        turn_count: r.turn_count != null ? Number(r.turn_count) : null,
        jitter: r.jitter != null ? Number(r.jitter) : null,
        shimmer: r.shimmer != null ? Number(r.shimmer) : null,
        hnr: r.hnr != null ? Number(r.hnr) : null,
        mean_f0: r.mean_f0 != null ? Number(r.mean_f0) : null,
        f0_variance: r.f0_variance != null ? Number(r.f0_variance) : null,
        background_voice: r.background_voice != null ? Boolean(r.background_voice) : null,
        stress_class: r.stress_class != null ? Number(r.stress_class) : null,
        stress_score: featureImportances.stress_score != null ? Number(featureImportances.stress_score) : null,
        reasons: Array.isArray(featureImportances.reasons) ? featureImportances.reasons : [],
        called_at: r.called_at != null ? String(r.called_at) : null,
        vf_gender: r.vf_gender != null ? String(r.vf_gender) : null,
        vf_gender_confidence: r.vf_gender_confidence != null ? Number(r.vf_gender_confidence) : null,
        vf_gender_female_prob: r.vf_gender_female_prob != null ? Number(r.vf_gender_female_prob) : null,
        vf_gender_male_prob: r.vf_gender_male_prob != null ? Number(r.vf_gender_male_prob) : null,
        vf_speaker_similarity: r.vf_speaker_similarity != null ? Number(r.vf_speaker_similarity) : null,
        vf_speaker_verified: r.vf_speaker_verified != null ? Boolean(r.vf_speaker_verified) : null,
        vf_synthetic_prob: r.vf_synthetic_prob != null ? Number(r.vf_synthetic_prob) : null,
        vf_is_synthetic: r.vf_is_synthetic != null ? Boolean(r.vf_is_synthetic) : null,
        vf_replay_prob: r.vf_replay_prob != null ? Number(r.vf_replay_prob) : null,
        vf_is_replay: r.vf_is_replay != null ? Boolean(r.vf_is_replay) : null,
        vf_cumulative_ms: r.vf_cumulative_ms != null ? Number(r.vf_cumulative_ms) : null,
        vf_user_audio_ms: r.vf_user_audio_ms != null ? Number(r.vf_user_audio_ms) : null,
        vf_results: vfResults,
        vf_results_by_horizon: vfResults?.horizons ?? null,
        escalation_status: r.escalation_status != null ? String(r.escalation_status) : null,
        escalated_at: r.escalated_at != null ? String(r.escalated_at) : null,
      } satisfies FraudCallAnalysis;
    });

    if (!row) return Response.json(null);
    return Response.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Query failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

function isVoiceForensicsResult(value: unknown): value is VoiceForensicsResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    "horizons" in value &&
    value.horizons &&
    typeof value.horizons === "object",
  );
}
