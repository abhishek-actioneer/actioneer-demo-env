/**
 * Test Sarvam TTS multi-segment synthesis in isolation.
 *
 * Usage:
 *   npx tsx scripts/test-tts.ts "[fast]Haan.[/fast] [pause] [slow]8.5% rate hai.[/slow]"
 *   npx tsx scripts/test-tts.ts "plain text with no tags" Hinglish meera
 *
 * Args:
 *   $1  Tagged text (default: built-in example)
 *   $2  Language     (default: Hinglish)
 *   $3  Speaker      (default: meera)
 *
 * Output:
 *   tts-test-<timestamp>.wav  — open with afplay / VLC / any player
 *
 * Compare baseline vs tagged:
 *   npx tsx scripts/test-tts.ts "Haan. 8.5% rate hai." Hinglish meera
 *   npx tsx scripts/test-tts.ts "[fast]Haan.[/fast] [pause] [slow]8.5% rate hai.[/slow]" Hinglish meera
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { join } from "path";

// ── inline helpers ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — add it to .env.local`);
  return v;
}

function decodeMulaw(sample: number): number {
  const value = ~sample & 0xff;
  const sign = value & 0x80;
  const exp = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let decoded = ((mantissa << 3) + 0x84) << exp;
  decoded -= 0x84;
  return sign ? -decoded : decoded;
}

/** Wrap raw μ-law bytes in a standard PCM-16 WAV (universally playable). */
function mulawToWav(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    pcm.writeInt16LE(decodeMulaw(mulaw[i]), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);   // PCM
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── sarvam helpers (inline so script is self-contained) ──────────────────────

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

function sarvamLangCode(language: string): "en-IN" | "hi-IN" {
  const n = language.trim().toLowerCase();
  return n === "english" || n === "en" || n === "en-in" ? "en-IN" : "hi-IN";
}

async function sarvamCall(
  text: string,
  language: string,
  speaker: string,
  pace: number,
  temperature: number,
): Promise<Buffer> {
  const res = await fetch(SARVAM_TTS_URL, {
    method: "POST",
    headers: {
      "api-subscription-key": requireEnv("SARVAM_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: sarvamLangCode(language),
      model: "bulbul:v3",
      speaker,
      pace,
      temperature,
      speech_sample_rate: 8000,
      output_audio_codec: "mulaw",
    }),
  });

  if (!res.ok) throw new Error(`Sarvam (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { audios?: string[] };
  const audio = json.audios?.[0];
  if (typeof audio !== "string") throw new Error("Sarvam returned no audio");
  const raw = Buffer.from(audio, "base64");
  return trimSilence(raw);
}

/** Trim leading/trailing μ-law silence (0xFF = encoded silence). */
function trimSilence(buf: Buffer, threshold = 0xf2, paddingMs = 25): Buffer {
  const pad = Math.ceil(paddingMs * 8);
  let start = 0;
  while (start < buf.length && buf[start] >= threshold) start++;
  start = Math.max(0, start - pad);
  let end = buf.length - 1;
  while (end > start && buf[end] >= threshold) end--;
  end = Math.min(buf.length - 1, end + pad);
  const trimmed = buf.slice(start, end + 1);
  return trimmed;
}

// ── segment parser ────────────────────────────────────────────────────────────

const PACE_MAP: Record<string, number> = {
  fast: 2.0,   // acknowledgements — "Haan", "Samjha", "Bilkul"
  slow: 1.25,  // important facts — rates, amounts
  warm: 1.5,   // empathy moments
  default: 1.6, // normal conversational speed
};
const TEMP_MAP: Record<string, number> = {
  fast: 0.75, slow: 0.50, warm: 0.82, default: 0.70,
};

interface Seg {
  type: "text" | "pause";
  text?: string;
  tag: string;
  durationMs?: number;
}

function parseSegments(raw: string): Seg[] {
  const segs: Seg[] = [];
  const pat = /(\[pause(?::(\d+))?\]|\[(fast|slow|warm)\]|\[\/(fast|slow|warm)\])/g;
  let cursor = 0;
  let tag = "default";
  let m: RegExpExecArray | null;

  while ((m = pat.exec(raw)) !== null) {
    const before = raw.slice(cursor, m.index).trim();
    if (before) segs.push({ type: "text", text: before, tag });

    if (m[0].startsWith("[pause")) {
      segs.push({ type: "pause", tag: "pause", durationMs: m[2] ? parseInt(m[2]) : 280 });
    } else if (m[3]) {
      tag = m[3];
    } else {
      tag = "default";
    }
    cursor = m.index + m[0].length;
  }

  const tail = raw.slice(cursor).trim();
  if (tail) segs.push({ type: "text", text: tail, tag });
  return segs;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function mainSingle(text: string, language: string, speaker: string): Promise<string> {
  const res = await fetch(SARVAM_TTS_URL, {
    method: "POST",
    headers: {
      "api-subscription-key": requireEnv("SARVAM_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: sarvamLangCode(language),
      model: "bulbul:v3",
      speaker,
      pace: Number(process.env.SARVAM_TTS_PACE || 1.0),
      temperature: 0.7,
      speech_sample_rate: 8000,
      output_audio_codec: "mulaw",
    }),
  });
  if (!res.ok) throw new Error(`Sarvam (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { audios?: string[] };
  const raw = Buffer.from(json.audios![0], "base64");
  const wav = mulawToWav(trimSilence(raw));
  const outPath = join(process.cwd(), `tts-${speaker}-${Date.now()}.wav`);
  writeFileSync(outPath, wav);
  console.log(`  ${speaker.padEnd(12)} → ${(trimSilence(raw).length / 8000).toFixed(2)}s  ${outPath}`);
  return outPath;
}

async function main() {
  // speaker comparison mode: npx tsx scripts/test-tts.ts --speakers "text"
  if (process.argv[2] === "--speakers") {
    const text = process.argv[3] ?? "Haan, samjha. Aath point paanch percent rate hai. Market mein bahut competitive hai.";
    const language = process.argv[4] ?? "Hinglish";
    // Female speakers confirmed for bulbul:v3
    const speakers = ["priya", "neha", "simran", "kavya", "shruti", "suhani", "ishita", "tanya", "roopa", "rupali"];
    console.log(`\nText: "${text}"\n`);
    const paths: string[] = [];
    for (const sp of speakers) {
      const p = await mainSingle(text, language, sp);
      paths.push(p);
    }
    console.log("\nPlaying all in sequence...\n");
    for (const p of paths) {
      const sp = p.split("tts-")[1]?.split("-")[0] ?? "";
      console.log(`▶ ${sp}`);
      const { execSync } = await import("child_process");
      execSync(`afplay "${p}"`);
    }
    return;
  }

  const input    = process.argv[2] ?? "Haan, samjha. Aath point paanch percent rate hai. Market mein bahut competitive hai.";
  const language = process.argv[3] ?? "Hinglish";
  const speaker  = process.argv[4] ?? (process.env.SARVAM_TTS_SPEAKER || "priya");

  console.log("\nInput:   ", input);
  console.log("Language:", language, "  Speaker:", speaker);
  console.log();

  const segments = parseSegments(input);

  for (const seg of segments) {
    if (seg.type === "pause") {
      console.log(`  [pause ${seg.durationMs}ms]`);
    } else {
      console.log(`  [${seg.tag.padEnd(7)}] "${seg.text}"  pace=${PACE_MAP[seg.tag]} temp=${TEMP_MAP[seg.tag]}`);
    }
  }
  console.log();

  const textSegs = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.type === "text");

  console.log(`Synthesizing ${textSegs.length} text segment(s) in parallel...`);
  const t0 = Date.now();

  const synthesized = await Promise.all(
    textSegs.map(({ s, i }) =>
      sarvamCall(s.text!, language, speaker, PACE_MAP[s.tag] ?? PACE_MAP.default, TEMP_MAP[s.tag] ?? TEMP_MAP.default)
        .then((audio) => {
          console.log(`  segment[${i}] "${s.text}" → ${audio.length} bytes (${(audio.length / 8000).toFixed(2)}s) [after trim]`);
          return { i, audio };
        }),
    ),
  );

  const audioMap = new Map(synthesized.map(({ i, audio }) => [i, audio]));

  const chunks: Buffer[] = [];
  let textIdx = 0;
  for (const seg of segments) {
    if (seg.type === "pause") {
      const silence = Buffer.alloc(Math.ceil((seg.durationMs ?? 280) * 8), 0xff);
      chunks.push(silence);
      console.log(`  [pause] ${seg.durationMs}ms → ${silence.length} bytes`);
    } else {
      const audio = audioMap.get(textSegs[textIdx]?.i ?? -1);
      if (audio) chunks.push(audio);
      textIdx++;
    }
  }

  const mulaw = Buffer.concat(chunks);
  const wav = mulawToWav(mulaw);
  const durationSec = (mulaw.length / 8000).toFixed(2);

  const outPath = join(process.cwd(), `tts-test-${Date.now()}.wav`);
  writeFileSync(outPath, wav);

  console.log();
  console.log(`✓ Done in ${Date.now() - t0}ms`);
  console.log(`  Duration : ${durationSec}s`);
  console.log(`  Output   : ${outPath}`);
  console.log();
  console.log("Play:");
  console.log(`  afplay ${outPath}           # macOS`);
  console.log(`  aplay  ${outPath}           # Linux`);

  return outPath;
}

main().catch((err) => { console.error(err); process.exit(1); });
