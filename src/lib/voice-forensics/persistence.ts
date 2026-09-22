import { withConnection } from "../db";
import { ensureVoiceVerificationCallsSchema } from "../voice-verification-schema";
import { VOICE_FORENSICS_HORIZONS_MS } from "./types";
import type { VoiceForensicsHorizonResult, VoiceForensicsModelRow, VoiceForensicsResult } from "./types";

interface LegacySignals {
  gender: string | null;
  genderConfidence: number | null;
  genderFemaleProb: number | null;
  genderMaleProb: number | null;
  speakerSimilarity: number | null;
  speakerVerified: boolean | null;
  syntheticProb: number | null;
  isSynthetic: boolean | null;
  replayProb: number | null;
  isReplay: boolean | null;
}

/**
 * Persists the latest horizon aggregate into `voice_verification_calls`.
 *
 * The full horizon payload is stored in `vf_results_json`; legacy aggregate
 * columns are still filled from the best available horizon so existing call-log
 * summaries and ad-hoc SQL keep working.
 */
export async function updateVoiceForensics(
  callId: string,
  datasetId: string,
  campaignId: string | undefined,
  result: VoiceForensicsResult,
): Promise<void> {
  await withConnection(datasetId, async (conn) => {
    await ensureVoiceVerificationCallsSchema(conn);

    const legacy = deriveLegacySignals(result);
    const analyzedAt = safeIso(result.analyzedAt);
    const resultJson = esc(JSON.stringify(result));
    const signals = esc(JSON.stringify({
      horizons: Object.fromEntries(Object.entries(result.horizons).map(([key, horizon]) => [
        key,
        {
          status: horizon.status,
          userAudioMs: horizon.userAudioMs,
          analyzedAudioMs: horizon.analyzedAudioMs,
          error: horizon.error ?? null,
          gender: horizon.gender.rows.map(rowSignal),
          la: horizon.la.rows.map(rowSignal),
          pa: horizon.pa.rows.map(rowSignal),
          biomarker: {
            embeddingSaved: horizon.biomarker.embeddingSaved,
            matches: horizon.biomarker.matches.length,
            detail: horizon.biomarker.detail ?? null,
          },
        },
      ])),
    }));

    const assignments = [
      `vf_analyzed_at = '${analyzedAt}'`,
      `vf_cumulative_ms = ${intNum(result.cumulativeMs)}`,
      `vf_user_audio_ms = ${intNum(result.userAudioMs)}`,
      `vf_gender = ${str(legacy.gender)}`,
      `vf_gender_confidence = ${num(legacy.genderConfidence)}`,
      `vf_gender_female_prob = ${num(legacy.genderFemaleProb)}`,
      `vf_gender_male_prob = ${num(legacy.genderMaleProb)}`,
      `vf_speaker_similarity = ${num(legacy.speakerSimilarity)}`,
      `vf_speaker_verified = ${bool(legacy.speakerVerified)}`,
      `vf_synthetic_prob = ${num(legacy.syntheticProb)}`,
      `vf_is_synthetic = ${bool(legacy.isSynthetic)}`,
      `vf_replay_prob = ${num(legacy.replayProb)}`,
      `vf_is_replay = ${bool(legacy.isReplay)}`,
      `vf_signals = '${signals}'`,
      `vf_results_json = '${resultJson}'`,
    ].join(", ");

    await upsertMinimalRow(conn, callId, datasetId, campaignId);
    await conn.run(`UPDATE voice_verification_calls SET ${assignments} WHERE call_id = '${esc(callId)}'`);
  });
}

/** Persist user-audio duration when the call never reaches the first horizon. */
export async function updateVoiceForensicsProgress(
  callId: string,
  datasetId: string,
  campaignId: string | undefined,
  userAudioMs: number,
): Promise<void> {
  await withConnection(datasetId, async (conn) => {
    await ensureVoiceVerificationCallsSchema(conn);
    await upsertMinimalRow(conn, callId, datasetId, campaignId);
    await conn.run(`
      UPDATE voice_verification_calls
      SET vf_analyzed_at = '${new Date().toISOString()}',
          vf_cumulative_ms = ${intNum(userAudioMs)},
          vf_user_audio_ms = ${intNum(userAudioMs)}
      WHERE call_id = '${esc(callId)}'
    `);
  });
}

async function upsertMinimalRow(
  conn: { run(sql: string): Promise<unknown> },
  callId: string,
  datasetId: string,
  campaignId: string | undefined,
): Promise<void> {
  await conn.run(`
    INSERT INTO voice_verification_calls (call_id, campaign_id, dataset_id)
    VALUES ('${esc(callId)}', ${str(campaignId ?? null)}, '${esc(datasetId)}')
    ON CONFLICT (call_id) DO UPDATE SET
      campaign_id = COALESCE(voice_verification_calls.campaign_id, EXCLUDED.campaign_id),
      dataset_id = COALESCE(voice_verification_calls.dataset_id, EXCLUDED.dataset_id)
  `);
}

function deriveLegacySignals(result: VoiceForensicsResult): LegacySignals {
  const horizon = bestAvailableHorizon(result);
  const genderRow = firstReadyRow(horizon?.gender.rows);
  const laRow = firstReadyRow(horizon?.la.rows);
  const paRow = firstReadyRow(horizon?.pa.rows);
  const topMatch = horizon?.biomarker.matches[0];
  const pMale = genderRow?.score ?? null;

  return {
    gender: pMale == null ? null : pMale >= 0.5 ? "male" : "female",
    genderConfidence: pMale == null ? null : Math.max(pMale, 1 - pMale),
    genderFemaleProb: pMale == null ? null : 1 - pMale,
    genderMaleProb: pMale,
    speakerSimilarity: topMatch?.score ?? null,
    speakerVerified: topMatch?.score == null ? null : topMatch.score >= 0.5,
    syntheticProb: laRow?.score ?? null,
    isSynthetic: laRow?.score == null ? null : laRow.score >= 0.5,
    replayProb: paRow?.score ?? null,
    isReplay: paRow?.score == null ? null : paRow.score >= 0.5,
  };
}

function bestAvailableHorizon(result: VoiceForensicsResult): VoiceForensicsHorizonResult | null {
  for (const horizonMs of [...VOICE_FORENSICS_HORIZONS_MS].reverse()) {
    const horizon = result.horizons[String(horizonMs)];
    if (horizon) return horizon;
  }
  return null;
}

function firstReadyRow(rows: VoiceForensicsModelRow[] | undefined): VoiceForensicsModelRow | null {
  return rows?.find((row) => row.status === "ready" && typeof row.score === "number") ?? null;
}

function rowSignal(row: VoiceForensicsModelRow): Record<string, unknown> {
  return {
    modelId: row.modelId,
    status: row.status,
    detail: row.detail ?? null,
  };
}

function safeIso(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function num(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "NULL";
}

function intNum(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n)) : "NULL";
}

function bool(b: boolean | null | undefined): string {
  return b === null || b === undefined ? "NULL" : b ? "TRUE" : "FALSE";
}

function str(s: string | null | undefined): string {
  return s === null || s === undefined ? "NULL" : `'${esc(s)}'`;
}
