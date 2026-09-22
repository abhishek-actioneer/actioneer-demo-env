/**
 * Smoke test for the fraud post-call analysis pipeline.
 * Uses the real KYC call transcript from railway logs as a stand-in.
 * Registers a fake fraud call, runs transcript feature computation,
 * optionally calls the Python analysis service, writes to DuckDB.
 *
 * Usage: npx tsx scripts/test-fraud-pipeline.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

async function main() {

// ── Inline the helpers we're testing ──────────────────────────────────────────

interface Turn {
  role: "assistant" | "user";
  text: string;
  at: string;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function wordOverlap(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const bWords = b.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  const overlap = bWords.filter((w) => aWords.has(w)).length;
  return overlap / bWords.length;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function computeTranscriptFeatures(turns: Turn[]) {
  const agentTurns = turns.filter((t) => t.role === "assistant");
  const customerTurns = turns.filter((t) => t.role === "user");

  const onsets: number[] = [];
  for (const agent of agentTurns) {
    const agentAt = new Date(agent.at).getTime();
    const next = customerTurns.find((t) => new Date(t.at).getTime() > agentAt);
    if (next) {
      const gap = new Date(next.at).getTime() - agentAt;
      if (gap > 0 && gap < 10_000) onsets.push(gap);
    }
  }

  const elaborations: number[] = [];
  for (const agent of agentTurns) {
    const agentAt = new Date(agent.at).getTime();
    const resp = customerTurns.find((t) => new Date(t.at).getTime() > agentAt);
    if (resp) {
      const aw = wordCount(agent.text);
      const cw = wordCount(resp.text);
      if (aw > 0) elaborations.push(cw / aw);
    }
  }

  const echoes: number[] = [];
  for (const agent of agentTurns) {
    const agentAt = new Date(agent.at).getTime();
    const resp = customerTurns.find((t) => new Date(t.at).getTime() > agentAt);
    if (resp) echoes.push(wordOverlap(agent.text, resp.text));
  }

  return {
    voiceOnsetMs: onsets.length > 0 ? median(onsets) : null,
    elaborationRatio: elaborations.length > 0 ? mean(elaborations) : null,
    echoScore: echoes.length > 0 ? mean(echoes) : null,
  };
}

function computeDuressScore(f: ReturnType<typeof computeTranscriptFeatures>): number {
  let score = 0;
  if (f.voiceOnsetMs != null && f.voiceOnsetMs > 800) score += 0.30;
  if (f.echoScore != null && f.echoScore > 0.75) score += 0.30;
  if (f.elaborationRatio != null && f.elaborationRatio < 0.25) score += 0.25;
  if (f.voiceOnsetMs != null && f.voiceOnsetMs > 1200) score += 0.15;
  return Math.min(score, 1.0);
}

// ── Load transcript from railway logs ─────────────────────────────────────────

const rawLog = JSON.parse(
  readFileSync(
    join(process.cwd(), "data/railway-call-logs/20260615T084542Z/kyc-1147-live-session-timeline.json"),
    "utf8"
  )
) as Array<{ time: string; type: string; text: string }>;

// Build synthetic turns with 5s gaps (real timestamps not available)
let t = new Date("2026-06-15T06:17:58.000Z").getTime();
const turns: Turn[] = [];
for (const entry of rawLog) {
  if (!entry.text || entry.text.trim() === "") continue;
  if (entry.type === "transcript.assistant") {
    turns.push({ role: "assistant", text: entry.text, at: new Date(t).toISOString() });
    t += 8000; // agent speaks for ~8s
  } else if (entry.type === "transcript.user") {
    t += 1200; // customer onset ~1.2s
    turns.push({ role: "user", text: entry.text, at: new Date(t).toISOString() });
    t += 4000; // customer speaks for ~4s
  }
}

console.log(`\n── Transcript: ${turns.length} turns ──`);
for (const turn of turns.slice(0, 6)) {
  console.log(`[${turn.role.padEnd(9)}] ${turn.text.slice(0, 80)}`);
}
console.log("...");

// ── Compute transcript features ────────────────────────────────────────────────

const features = computeTranscriptFeatures(turns);
const duressScore = computeDuressScore(features);

console.log("\n── Transcript Features ──");
console.log(`  voiceOnsetMs:     ${features.voiceOnsetMs?.toFixed(0) ?? "null"}`);
console.log(`  elaborationRatio: ${features.elaborationRatio?.toFixed(3) ?? "null"}`);
console.log(`  echoScore:        ${features.echoScore?.toFixed(3) ?? "null"}`);
console.log(`  duressScore:      ${duressScore.toFixed(3)}`);

// ── Try acoustic analysis service ──────────────────────────────────────────────

const ANALYSIS_URL = process.env.ANALYSIS_SERVICE_URL ?? "http://localhost:8000";

console.log(`\n── Acoustic Analysis (${ANALYSIS_URL}) ──`);
let acoustic: Record<string, unknown> | null = null;

try {
  const healthRes = await fetch(`${ANALYSIS_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (healthRes.ok) {
    console.log("  Service reachable — sending synthetic 1s silent WAV");

    // Build a minimal valid stereo WAV: 1 second, 8kHz, 16-bit, 2 channels (silence)
    const sr = 8000;
    const nSamples = sr; // 1 second
    const nChannels = 2;
    const bytesPerSample = 2;
    const dataSize = nSamples * nChannels * bytesPerSample;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(nChannels, 22);
    header.writeUInt32LE(sr, 24);
    header.writeUInt32LE(sr * nChannels * bytesPerSample, 28);
    header.writeUInt16LE(nChannels * bytesPerSample, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    const silenceWav = Buffer.concat([header, Buffer.alloc(dataSize, 0)]);

    const res = await fetch(`${ANALYSIS_URL}/analyze-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wav_base64: silenceWav.toString("base64"),
        transcript_features: {
          voice_onset_ms: features.voiceOnsetMs,
          elaboration_ratio: features.elaborationRatio,
          echo_score: features.echoScore,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      acoustic = await res.json() as Record<string, unknown>;
      console.log(`  stress_class:     ${acoustic.stress_class}`);
      console.log(`  stress_score:     ${acoustic.stress_score}`);
      console.log(`  jitter:           ${acoustic.jitter}`);
      console.log(`  shimmer:          ${acoustic.shimmer}`);
      console.log(`  hnr:              ${acoustic.hnr}`);
      console.log(`  background_voice: ${acoustic.background_voice}`);
      console.log(`  reasons:          ${JSON.stringify(acoustic.reasons)}`);
    } else {
      const body = await res.text();
      console.log(`  Service returned ${res.status}: ${body.slice(0, 200)}`);
    }
  }
} catch {
  console.log("  Service not reachable — skipping acoustic analysis (expected locally)");
}

// ── Write to DuckDB ────────────────────────────────────────────────────────────

console.log("\n── DuckDB Write ──");

const { DuckDBInstance } = await import("@duckdb/node-api");
const inst = await DuckDBInstance.create("data/datasets/hdfc-creditfraud/hdfc-creditfraud.duckdb");
const conn = await inst.connect();

function esc(s: string): string { return s.replace(/'/g, "''"); }

const testCallId = `test-pipeline-${Date.now()}`;
const testAlertId = "ALRT_d5e9ac7b86"; // H6 Devang (genuine traveller)

const sql = `
  INSERT INTO voice_verification_calls (
    call_id, alert_id, customer_id, amount_at_risk_inr,
    recommendation, tool_name, tool_args,
    voice_onset_ms, elaboration_ratio, echo_score,
    duress_score, stress_class, jitter, shimmer, hnr,
    mean_f0, f0_variance, background_voice, feature_importances,
    turn_count, transcript,
    called_at, resolved_at
  ) VALUES (
    '${esc(testCallId)}',
    '${esc(testAlertId)}',
    'CUST_c44c32e3ea',
    210000,
    'clear',
    'clear_transaction',
    '{"verification_method":"city","customer_statement":"haan main Singapore mein tha"}',
    ${features.voiceOnsetMs ?? "NULL"},
    ${features.elaborationRatio ?? "NULL"},
    ${features.echoScore ?? "NULL"},
    ${duressScore},
    ${acoustic?.stress_class ?? "NULL"},
    ${acoustic?.jitter ?? "NULL"},
    ${acoustic?.shimmer ?? "NULL"},
    ${acoustic?.hnr ?? "NULL"},
    ${acoustic?.mean_f0 ?? "NULL"},
    ${acoustic?.f0_variance ?? "NULL"},
    ${acoustic?.background_voice ?? "NULL"},
    '${esc(JSON.stringify(acoustic ? { reasons: acoustic.reasons, stress_score: acoustic.stress_score } : {}))}',
    ${turns.length},
    '${esc(JSON.stringify(turns.map((t) => ({ role: t.role, text: t.text, at: t.at })).slice(0, 20)))}',
    '${new Date().toISOString()}',
    '${new Date().toISOString()}'
  )
  ON CONFLICT (call_id) DO UPDATE SET recommendation = EXCLUDED.recommendation
`;

try {
  await conn.run(sql);
  console.log(`  ✓ Inserted test row  call_id=${testCallId}`);

  const verify = await conn.run(
    `SELECT call_id, alert_id, recommendation, duress_score, stress_class, voice_onset_ms, elaboration_ratio, echo_score
     FROM voice_verification_calls WHERE call_id = '${esc(testCallId)}'`
  );
  const rows = await verify.getRows();
  if (rows.length > 0) {
    const [cid, aid, rec, duress, cls, onset, elab, echo] = rows[0]!;
    console.log(`  call_id=${cid}`);
    console.log(`  alert_id=${aid}  recommendation=${rec}`);
    console.log(`  duress_score=${Number(duress).toFixed(3)}  stress_class=${cls ?? "n/a"}`);
    console.log(`  voice_onset_ms=${onset}  elaboration=${Number(elab).toFixed(3)}  echo=${Number(echo).toFixed(3)}`);
  }
} catch (err) {
  console.error("  DuckDB write failed:", err);
}

conn.closeSync();
console.log("\n✓ Pipeline smoke test complete\n");
}

main().catch(console.error);
