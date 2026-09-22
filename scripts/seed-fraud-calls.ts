/**
 * Seed voice_verification_calls with pre-recorded demo results for H3, H2, H8.
 * H6 (Devang) is live — not seeded.
 *
 * Run ONLY when the dev server is stopped:
 *   pkill -f "next dev" && npx tsx scripts/seed-fraud-calls.ts
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { join } from "path";

const DB_PATH = join(process.cwd(), "data/datasets/hdfc-creditfraud/hdfc-creditfraud.duckdb");

interface SeedRow {
  call_id: string;
  alert_id: string;
  customer_id: string;
  amount_at_risk_inr: number;
  recommendation: string;
  tool_name: string;
  voice_onset_ms: number;
  elaboration_ratio: number;
  echo_score: number;
  duress_score: number;
  stress_class: number;
  mean_f0: number;
  background_voice: boolean;
  turn_count: number;
  detected_gender: string;
  gender_confidence: number;
  gender_mismatch: boolean | null;
  gender_signals: string;
  transcript: string;
  called_at: string;
  resolved_at: string;
}

// H3 — Sachin Bhatia — OTP social engineering — coached victim
// Signals: long pauses, short answers, verbatim echo, duress detected → ESCALATE
// Gender: male cardholder, male voice (he answered, was coached) → no mismatch
const H3: SeedRow = {
  call_id: "fraud-demo-h3-seeded",
  alert_id: "ALRT_9de8aa7f8f",
  customer_id: "CUST_ae491c0cfa",
  amount_at_risk_inr: 74999,
  recommendation: "escalate",
  tool_name: "escalate_to_specialist",
  voice_onset_ms: 1340,
  elaboration_ratio: 0.18,
  echo_score: 0.81,
  duress_score: 0.83,
  stress_class: 2,
  mean_f0: 118.4,
  background_voice: true,
  turn_count: 9,
  detected_gender: "male",
  gender_confidence: 0.91,
  gender_mismatch: false,
  gender_signals: JSON.stringify({ female_prob: 0.09, male_prob: 0.91, model: "audeering/wav2vec2-large-robust-6-ft-age-gender", audio_duration_s: 134.2 }),
  transcript: JSON.stringify([
    { role: "assistant", text: "Sachin ji, HDFC Bank fraud team se Priya bol rahi hoon. Aapke card par ₹74,999 ka transaction CROMA — Mumbai mein hua hai — yeh aapke aam spend se 11 guna zyada hai. Kya aapne yeh purchase kiya?", at: "2026-06-18T14:01:00Z" },
    { role: "user", text: "Haan.", at: "2026-06-18T14:01:02.340Z" },
    { role: "assistant", text: "CROMA mein aapne kya purchase kiya tha?", at: "2026-06-18T14:01:08Z" },
    { role: "user", text: "Purchase kiya tha.", at: "2026-06-18T14:01:11.210Z" },
    { role: "assistant", text: "Sachin ji, kya aap abhi CROMA store par hain ya online order tha?", at: "2026-06-18T14:01:17Z" },
    { role: "user", text: "Online.", at: "2026-06-18T14:01:19.890Z" },
    { role: "assistant", text: "Acha, yeh transaction Mumbai IP address se hua — aap abhi Mumbai mein hain?", at: "2026-06-18T14:01:25Z" },
    { role: "user", text: "Haan Mumbai mein hoon.", at: "2026-06-18T14:01:28.150Z" },
    { role: "assistant", text: "Samajh gaye. Main aapka case ek specialist ko transfer kar rahi hoon — woh 2 minute mein aapko call karenge.", at: "2026-06-18T14:01:35Z" },
  ]),
  called_at: "2026-06-18T14:00:55Z",
  resolved_at: "2026-06-18T14:01:40Z",
};

// H2 — Ananya Nair — Geo-impossible (Mumbai → Dubai 22 min) — clear denial
// Signals: fast response, high elaboration, clear denial → BLOCK
// Gender: female cardholder, female voice → no mismatch
const H2: SeedRow = {
  call_id: "fraud-demo-h2-seeded",
  alert_id: "ALRT_36b27a1d18",
  customer_id: "CUST_aff442bd32",
  amount_at_risk_inr: 120000,
  recommendation: "block",
  tool_name: "block_card",
  voice_onset_ms: 210,
  elaboration_ratio: 0.92,
  echo_score: 0.11,
  duress_score: 0.04,
  stress_class: 0,
  mean_f0: 198.7,
  background_voice: false,
  turn_count: 7,
  detected_gender: "female",
  gender_confidence: 0.94,
  gender_mismatch: false,
  gender_signals: JSON.stringify({ female_prob: 0.94, male_prob: 0.06, model: "audeering/wav2vec2-large-robust-6-ft-age-gender", audio_duration_s: 98.5 }),
  transcript: JSON.stringify([
    { role: "assistant", text: "Ananya ji, HDFC Bank fraud team se Priya bol rahi hoon. Aapke card par ₹1,20,000 ka transaction Dubai mein electronics store mein hua hai. Kya aapne yeh purchase kiya?", at: "2026-06-18T14:30:00Z" },
    { role: "user", text: "Nahi nahi, bilkul nahi! Main toh aaj subah se Mumbai mein hoon. Main Dubai gayi hi nahi!", at: "2026-06-18T14:30:01.210Z" },
    { role: "assistant", text: "Samajh gayi. Aap confirm kar rahi hain ki yeh transaction aapne nahi kiya?", at: "2026-06-18T14:30:08Z" },
    { role: "user", text: "Haan bilkul nahi kiya! Mera card chori hua hoga, please immediately block kar dijiye!", at: "2026-06-18T14:30:09.890Z" },
    { role: "assistant", text: "Main abhi aapka card block kar rahi hoon. Kya aapka physical card abhi aapke paas hai?", at: "2026-06-18T14:30:15Z" },
    { role: "user", text: "Haan card mere purse mein hai, lekin ye transaction kaise hua? Main samajh nahi pa rahi.", at: "2026-06-18T14:30:17.200Z" },
    { role: "assistant", text: "Aapka card block ho gaya hai. Yeh card cloning ka case lag raha hai. Ek naya card 3-5 din mein aapke address par pahunch jayega.", at: "2026-06-18T14:30:22Z" },
  ]),
  called_at: "2026-06-18T14:29:55Z",
  resolved_at: "2026-06-18T14:30:28Z",
};

// H8 — Meera Krishnan — Jewellery purchase — husband answered wife's phone
// Signals: clear confident responses (no duress) BUT gender mismatch → ESCALATE
// Gender: female cardholder (F), male voice detected → MISMATCH
const H8: SeedRow = {
  call_id: "fraud-demo-h8-seeded",
  alert_id: "ALRT_7f2c1e9d44",
  customer_id: "CUST_b7e3f291aa",
  amount_at_risk_inr: 38000,
  recommendation: "escalate",
  tool_name: "escalate_to_specialist",
  voice_onset_ms: 320,
  elaboration_ratio: 0.71,
  echo_score: 0.14,
  duress_score: 0.12,
  stress_class: 0,
  mean_f0: 122.1,
  background_voice: false,
  turn_count: 6,
  detected_gender: "male",
  gender_confidence: 0.89,
  gender_mismatch: true,
  gender_signals: JSON.stringify({ female_prob: 0.11, male_prob: 0.89, model: "audeering/wav2vec2-large-robust-6-ft-age-gender", audio_duration_s: 76.3 }),
  transcript: JSON.stringify([
    { role: "assistant", text: "Meera ji, HDFC Bank fraud team se Priya bol rahi hoon. Aapke card par ₹38,000 ka transaction Tanishq jewellery — Bandra mein hua hai. Kya aapne yeh purchase kiya?", at: "2026-06-18T15:15:00Z" },
    { role: "user", text: "Haan haan, unhone kiya tha. Main bol deta hoon — meri wife ka phone hai, woh abhi available nahi hain.", at: "2026-06-18T15:15:01.320Z" },
    { role: "assistant", text: "Sir, main cardholder Meera ji se baat karna chahti hoon. Kya woh available ho sakti hain?", at: "2026-06-18T15:15:08Z" },
    { role: "user", text: "Woh bahar gayi hain abhi, main unka husband hoon. Aap mujhe batao kya baat hai.", at: "2026-06-18T15:15:10.450Z" },
    { role: "assistant", text: "Sir, security ke liye main cardholder se hi baat kar sakti hoon. Main is call ko specialist ke paas transfer kar rahi hoon jo Meera ji se directly contact karenge.", at: "2026-06-18T15:15:16Z" },
    { role: "user", text: "Theek hai, koi baat nahi.", at: "2026-06-18T15:15:18.210Z" },
  ]),
  called_at: "2026-06-18T15:14:55Z",
  resolved_at: "2026-06-18T15:15:24Z",
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function toSql(row: SeedRow): string {
  return `
    INSERT INTO voice_verification_calls (
      call_id, alert_id, customer_id, amount_at_risk_inr,
      recommendation, tool_name, tool_args,
      voice_onset_ms, elaboration_ratio, echo_score,
      duress_score, stress_class, jitter, shimmer, hnr,
      mean_f0, f0_variance, background_voice, feature_importances,
      turn_count, transcript,
      detected_gender, gender_confidence, gender_mismatch, gender_signals,
      called_at, resolved_at
    ) VALUES (
      '${esc(row.call_id)}',
      '${esc(row.alert_id)}',
      '${esc(row.customer_id)}',
      ${row.amount_at_risk_inr},
      '${esc(row.recommendation)}',
      '${esc(row.tool_name)}',
      '{}',
      ${row.voice_onset_ms},
      ${row.elaboration_ratio},
      ${row.echo_score},
      ${row.duress_score},
      ${row.stress_class},
      NULL, NULL, NULL,
      ${row.mean_f0},
      NULL,
      ${row.background_voice},
      '${esc(JSON.stringify({ stress_score: row.stress_class }))}',
      ${row.turn_count},
      '${esc(row.transcript)}',
      '${esc(row.detected_gender)}',
      ${row.gender_confidence},
      ${row.gender_mismatch !== null ? row.gender_mismatch : "NULL"},
      '${esc(row.gender_signals)}',
      '${row.called_at}',
      '${row.resolved_at}'
    )
    ON CONFLICT (call_id) DO UPDATE SET
      recommendation = EXCLUDED.recommendation,
      duress_score = EXCLUDED.duress_score,
      detected_gender = EXCLUDED.detected_gender,
      gender_confidence = EXCLUDED.gender_confidence,
      gender_mismatch = EXCLUDED.gender_mismatch,
      gender_signals = EXCLUDED.gender_signals,
      resolved_at = EXCLUDED.resolved_at
  `;
}

async function run() {
  console.log("Connecting to", DB_PATH);
  const inst = await DuckDBInstance.create(DB_PATH);
  const conn = await inst.connect();

  for (const row of [H3, H2, H8]) {
    try {
      await conn.run(toSql(row));
      console.log(`Seeded ${row.call_id} (alert=${row.alert_id}, outcome=${row.recommendation}, gender_mismatch=${row.gender_mismatch})`);
    } catch (err) {
      console.error(`FAILED ${row.call_id}:`, err);
    }
  }

  // Verify
  const result = await conn.run("SELECT call_id, alert_id, recommendation, duress_score, detected_gender, gender_mismatch FROM voice_verification_calls ORDER BY called_at DESC LIMIT 10");
  const cols = Array.from(result.columnNames()).map(String);
  const rows = await result.getRows();
  console.log("\nvoice_verification_calls (last 10):");
  console.log(cols.join(" | "));
  rows.forEach(r => console.log(r.map(String).join(" | ")));

  await conn.close();
  await inst.close();
  console.log("\nDone.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
