/**
 * Single source of truth for the `voice_verification_calls` table schema.
 *
 * Two independent subsystems write to this one table:
 *   - Fraud analysis  (recommendation, duress/stress, biomarkers, gender)
 *   - Voice forensics (vf_* — deepfake/replay/speaker/gender via the models)
 *
 * They used to each create the table with their own column list via
 * `CREATE TABLE IF NOT EXISTS`, so whichever ran first "won" and the other's
 * columns never existed — causing binder errors on both write and read.
 *
 * This module owns the union of every column. It creates the table with just
 * the primary key, then `ALTER … ADD COLUMN IF NOT EXISTS` for every column, so
 * it both provisions fresh databases AND repairs existing tables that were
 * created with a partial schema. Every read/write path must call
 * `ensureVoiceVerificationCallsSchema(conn)` before touching the table.
 */

type Conn = { run(sql: string): Promise<unknown> };

/** Fraud-analysis columns (superset of results-repo + fraud-analysis writers). */
const FRAUD_COLUMNS: Array<[string, string]> = [
  ["campaign_id", "VARCHAR"],
  ["dataset_id", "VARCHAR"],
  ["analyzed_at", "TIMESTAMP"],
  ["alert_id", "VARCHAR"],
  ["customer_id", "VARCHAR"],
  ["amount_at_risk_inr", "DOUBLE"],
  ["recommendation", "VARCHAR"],
  ["tool_name", "VARCHAR"],
  ["tool_args", "VARCHAR"],
  ["voice_onset_ms", "DOUBLE"],
  ["elaboration_ratio", "DOUBLE"],
  ["echo_score", "DOUBLE"],
  ["duress_score", "DOUBLE"],
  ["stress_class", "INTEGER"],
  ["stress_score", "DOUBLE"],
  ["jitter", "DOUBLE"],
  ["shimmer", "DOUBLE"],
  ["hnr", "DOUBLE"],
  ["mean_f0", "DOUBLE"],
  ["f0_variance", "DOUBLE"],
  ["background_voice", "BOOLEAN"],
  ["reasons", "VARCHAR[]"],
  ["feature_importances", "VARCHAR"],
  ["turn_count", "INTEGER"],
  ["transcript", "VARCHAR"],
  ["detected_gender", "VARCHAR"],
  ["gender_confidence", "DOUBLE"],
  ["gender_female_prob", "DOUBLE"],
  ["gender_male_prob", "DOUBLE"],
  ["gender_mismatch", "BOOLEAN"],
  ["gender_signals", "VARCHAR"],
  ["gender_status", "VARCHAR"],
  ["cardholder_gender", "VARCHAR"],
  ["called_at", "TIMESTAMP"],
  ["resolved_at", "TIMESTAMP"],
  ["escalation_status", "VARCHAR"],
  ["escalated_at", "TIMESTAMP"],
  ["escalation_reason", "VARCHAR"],
];

/** Voice-forensics columns (the vf_* models: gender/deepfake/replay/speaker). */
const FORENSICS_COLUMNS: Array<[string, string]> = [
  ["vf_analyzed_at", "TIMESTAMP"],
  ["vf_cumulative_ms", "INTEGER"],
  ["vf_user_audio_ms", "INTEGER"],
  ["vf_gender", "VARCHAR"],
  ["vf_gender_confidence", "DOUBLE"],
  ["vf_gender_female_prob", "DOUBLE"],
  ["vf_gender_male_prob", "DOUBLE"],
  ["vf_speaker_similarity", "DOUBLE"],
  ["vf_speaker_verified", "BOOLEAN"],
  ["vf_synthetic_prob", "DOUBLE"],
  ["vf_is_synthetic", "BOOLEAN"],
  ["vf_replay_prob", "DOUBLE"],
  ["vf_is_replay", "BOOLEAN"],
  ["vf_signals", "VARCHAR"],
  ["vf_results_json", "VARCHAR"],
];

const ALL_COLUMNS: Array<[string, string]> = [...FRAUD_COLUMNS, ...FORENSICS_COLUMNS];

/**
 * Ensure `voice_verification_calls` exists with the full column set.
 *
 * Idempotent and safe to call on every read/write. Creates the table (keyed by
 * `call_id`) if absent, then adds any missing column — repairing tables built
 * by an older/partial writer without dropping data.
 */
export async function ensureVoiceVerificationCallsSchema(conn: Conn): Promise<void> {
  await conn.run(
    `CREATE TABLE IF NOT EXISTS voice_verification_calls (call_id VARCHAR PRIMARY KEY)`,
  );
  for (const [name, type] of ALL_COLUMNS) {
    await conn.run(`ALTER TABLE voice_verification_calls ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }
}
