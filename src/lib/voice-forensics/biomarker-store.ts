import type { DuckDBConnection } from "@duckdb/node-api";
import { getOrCreateInstance, enqueue } from "../db";
import { resolveRepoDataPath } from "../data-dir";
import type { BiomarkerKeySource, ForensicContext, VoiceForensicsBiomarkerMatch } from "./types";

/**
 * Voice-biomarker gallery (speaker embeddings) in a single DuckDB file.
 *
 * The Modal/TitaNet model is a pure embedder — it returns the raw 192-d
 * L2-normalized vector and stores nothing. Enrollment + cosine matching happen
 * HERE, locally, so we own the gallery and can inspect/clean it.
 *
 * Collision-proof design (2026-08-03, gallery rebuilt from scratch):
 *   - Identity key is (dataset_id, biomarker_id, horizon_key): identities are
 *     TENANT-SCOPED — matching never crosses datasets.
 *   - Matching is bucketed by `horizon_key` (500/1000/2000/5000/full-raw/
 *     full-processed) so comparisons are apples-to-apples. The query never
 *     matches itself. Embeddings are L2-normalized, so cosine == dot product
 *     (DuckDB `list_cosine_similarity`).
 *   - Enrollment policy depends on the identity's key provenance (`key_source`):
 *       customer-id      verify-then-refresh: first call enrolls (TOFU); later
 *                        calls refresh only when the voice matches the stored
 *                        reference (>= REFRESH_MIN_SELF_SIMILARITY). A different
 *                        voice can never overwrite the reference.
 *       pinned-subject   frozen whole-subject: the first call to enroll ANY
 *                        horizon owns the subject; other calls never write —
 *                        not even into missing horizon buckets.
 *       phone            verification-only: matched against the gallery but
 *                        NEVER enrolled, so an unidentified caller can't mint a
 *                        second bucket for someone who may already have one.
 *   - Duplicate-voice detection: when this call's embedding scores >=
 *     DUPLICATE_VOICE_THRESHOLD against a DIFFERENT enrolled identity, the
 *     result carries `duplicateVoiceOf` — one voice operating multiple
 *     identities is itself a fraud signal, not a silent doppelganger.
 */

const DB_FILE = "data/voice-biomarkers.duckdb";
const QUEUE_KEY = "voice-biomarkers";

/** Minimum self-similarity for a later call to refresh a customer-id reference. */
const REFRESH_MIN_SELF_SIMILARITY = 0.75;
/** Best other-identity score at/above which the caller is flagged as a duplicate voice. */
const DUPLICATE_VOICE_THRESHOLD = 0.85;

let schemaReady = false;

async function ensureSchema(conn: DuckDBConnection): Promise<void> {
  if (schemaReady) return;
  // Gallery rebuilt from scratch on 2026-08-03: any pre-existing table without
  // the dataset-scoped key is legacy demo data — drop it rather than migrate.
  const legacy = await conn.run(`
    SELECT count(*) FROM information_schema.tables t
    WHERE t.table_name = 'voice_biomarker_embeddings'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_name = t.table_name AND c.column_name = 'dataset_id'
      )
  `);
  const legacyRows = await legacy.getRows();
  if (Number(legacyRows[0]?.[0] ?? 0) > 0) {
    console.warn("[voice-biomarkers] dropping legacy (pre-dataset-scoped) gallery table");
    await conn.run("DROP TABLE voice_biomarker_embeddings");
  }
  await conn.run(`
    CREATE TABLE IF NOT EXISTS voice_biomarker_embeddings (
      dataset_id VARCHAR,
      biomarker_id VARCHAR,
      horizon_key VARCHAR,
      key_source VARCHAR,
      embedding FLOAT[],
      call_id VARCHAR,
      name VARCHAR,
      phone VARCHAR,
      user_id VARCHAR,
      campaign_id VARCHAR,
      updated_at TIMESTAMP,
      PRIMARY KEY (dataset_id, biomarker_id, horizon_key)
    )
  `);
  await conn.run("CHECKPOINT");
  schemaReady = true;
}

/** Run `fn` against the global biomarker DuckDB, serialized on one queue. */
async function withBiomarkerConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const dbPath = resolveRepoDataPath(DB_FILE);
  return enqueue(QUEUE_KEY, async () => {
    const instance = await getOrCreateInstance(dbPath);
    const conn = await instance.connect();
    try {
      await ensureSchema(conn);
      return await fn(conn);
    } finally {
      conn.closeSync();
    }
  });
}

function sqlStr(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Build a safe DuckDB FLOAT[] literal from a numeric vector. */
function embeddingLiteral(embedding: number[]): string {
  const nums = embedding.filter((n) => Number.isFinite(n)).map((n) => String(n));
  return `[${nums.join(",")}]::FLOAT[]`;
}

export interface BiomarkerMatchResult {
  matches: VoiceForensicsBiomarkerMatch[];
  /** Cosine vs this identity's own previously enrolled embedding (pre-upsert). */
  selfSimilarity: number | null;
  /** Whether this call's embedding was written as the identity's reference. */
  enrolled: boolean;
  /** Why enrollment did not happen, when it didn't. */
  enrollmentSkippedReason: string | null;
  /** Set when the caller's voice matches a DIFFERENT enrolled identity. */
  duplicateVoiceOf: { biomarkerId: string; name: string | null; score: number } | null;
}

const EMPTY_RESULT: BiomarkerMatchResult = {
  matches: [],
  selfSimilarity: null,
  enrolled: false,
  enrollmentSkippedReason: null,
  duplicateVoiceOf: null,
};

/**
 * Match a horizon's embedding against OTHER enrolled identities in the same
 * (dataset, horizon) bucket, compute similarity vs this identity's OWN previous
 * enrollment (same-person check), then apply the enrollment policy for the
 * identity's key source. Returns the top-5 matches in the exact shape the UI
 * expects. Cold start (no other enrollments) returns [].
 */
export async function matchAndEnroll(
  context: ForensicContext,
  horizonKey: string,
  embedding: number[],
): Promise<BiomarkerMatchResult> {
  const clean = embedding.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return { ...EMPTY_RESULT };

  const datasetId = context.datasetId?.trim() || "";
  const self = context.biomarkerId?.trim() || "";
  if (!datasetId) return { ...EMPTY_RESULT, enrollmentSkippedReason: "no-dataset" };

  const keySource: BiomarkerKeySource = context.keySource ?? "customer-id";
  const literal = embeddingLiteral(clean);

  return withBiomarkerConnection(async (conn) => {
    // 0) Same-person check: similarity vs this identity's previous embedding,
    //    BEFORE any upsert this call might perform.
    let selfSimilarity: number | null = null;
    if (self) {
      const selfResult = await conn.run(`
        SELECT list_cosine_similarity(embedding, ${literal}) AS score
        FROM voice_biomarker_embeddings
        WHERE dataset_id = ${sqlStr(datasetId)}
          AND horizon_key = ${sqlStr(horizonKey)}
          AND biomarker_id = ${sqlStr(self)}
        LIMIT 1
      `);
      const selfRows = await selfResult.getRows();
      if (selfRows.length > 0 && selfRows[0][0] != null) {
        const score = Number(selfRows[0][0]);
        if (Number.isFinite(score)) selfSimilarity = score;
      }
    }

    // 1) Match against everyone else in this dataset's horizon bucket.
    const selfPredicate = self ? `AND biomarker_id <> ${sqlStr(self)}` : "";
    const result = await conn.run(`
      SELECT biomarker_id, name, phone, user_id,
             list_cosine_similarity(embedding, ${literal}) AS score
      FROM voice_biomarker_embeddings
      WHERE dataset_id = ${sqlStr(datasetId)}
        AND horizon_key = ${sqlStr(horizonKey)} ${selfPredicate}
      ORDER BY score DESC NULLS LAST
      LIMIT 5
    `);
    const rows = await result.getRows();
    const matches: VoiceForensicsBiomarkerMatch[] = rows.map((r, i) => ({
      rank: i + 1,
      score: Number(r[4] ?? 0),
      phone: r[2] != null ? String(r[2]) : null,
      name: r[1] != null ? String(r[1]) : null,
      userId: r[0] != null ? String(r[0]) : (r[3] != null ? String(r[3]) : null),
    }));

    // 2) One voice under two identities is a fraud signal, not noise.
    const top = matches[0];
    const duplicateVoiceOf = top && top.score >= DUPLICATE_VOICE_THRESHOLD
      ? { biomarkerId: top.userId ?? "", name: top.name, score: top.score }
      : null;

    // 3) Enrollment policy by key provenance.
    let enrolled = false;
    let enrollmentSkippedReason: string | null = null;
    if (!self) {
      enrollmentSkippedReason = "no-identity";
    } else if (keySource === "phone") {
      // Unidentified callers are observed, never enrolled — prevents a second
      // bucket for a person who may already exist under a customer id.
      enrollmentSkippedReason = "phone-identity-verification-only";
    } else if (keySource === "unverified-customer") {
      // Claimed customer identity, but the dialed number did not match their
      // registered phone — bench against their reference, never enroll.
      enrollmentSkippedReason = "phone-mismatch-verification-only";
    } else if (keySource === "pinned-subject" || context.enrollOnce === true) {
      // Whole-subject freeze: the enrolling CALL owns the subject. A later call
      // may not write any horizon — not even one the first call never filled.
      const ownerResult = await conn.run(`
        SELECT 1 FROM voice_biomarker_embeddings
        WHERE dataset_id = ${sqlStr(datasetId)}
          AND biomarker_id = ${sqlStr(self)}
          AND call_id IS DISTINCT FROM ${sqlStr(context.callId)}
        LIMIT 1
      `);
      if ((await ownerResult.getRows()).length > 0) {
        enrollmentSkippedReason = "subject-frozen";
      } else {
        enrolled = true;
      }
    } else if (selfSimilarity !== null && selfSimilarity < REFRESH_MIN_SELF_SIMILARITY) {
      // Verify-then-refresh: a voice that fails the same-person check must not
      // become the new reference.
      enrollmentSkippedReason = "voice-mismatch";
    } else {
      enrolled = true;
    }

    if (enrolled) {
      await conn.run(`
        INSERT INTO voice_biomarker_embeddings
          (dataset_id, biomarker_id, horizon_key, key_source, embedding, call_id, name, phone, user_id, campaign_id, updated_at)
        VALUES (
          ${sqlStr(datasetId)}, ${sqlStr(self)}, ${sqlStr(horizonKey)}, ${sqlStr(keySource)}, ${literal},
          ${sqlStr(context.callId)}, ${sqlStr(context.name)}, ${sqlStr(context.phone)},
          ${sqlStr(context.userId)}, ${sqlStr(context.campaignId)}, NOW()
        )
        ON CONFLICT (dataset_id, biomarker_id, horizon_key) DO UPDATE SET
          key_source = EXCLUDED.key_source,
          embedding = EXCLUDED.embedding,
          call_id = EXCLUDED.call_id,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          user_id = EXCLUDED.user_id,
          campaign_id = EXCLUDED.campaign_id,
          updated_at = NOW()
      `);
      await conn.run("CHECKPOINT");
    }

    return { matches, selfSimilarity, enrolled, enrollmentSkippedReason, duplicateVoiceOf };
  });
}
