/**
 * Audition all Gemini Live prebuilt voices.
 *
 * Usage:
 *   npx tsx scripts/test-gemini-voices.ts
 *   npx tsx scripts/test-gemini-voices.ts "custom phrase to speak"
 *
 * Generates one WAV per voice, plays them in sequence via afplay.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const VOICES = [
  "Aoede",
  "Charon",
  "Fenrir",
  "Kore",
  "Leda",
  "Orus",
  "Puck",
  "Schedar",
  "Sulafat",
  "Zephyr",
];

const DEFAULT_TEXT =
  "haan, main Arushi bol rahi hoon, Vastu Housing Finance se. Ek minute baat kar sakte hain?";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — add it to .env.local`);
  return v;
}

function pcm16ToWav(pcmBase64: string, sampleRate = 24000): Buffer {
  const pcm = Buffer.from(pcmBase64, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function generateVoice(voice: string, text: string, apiKey: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini TTS (${res.status}) for ${voice}: ${err}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };

  const part = json.candidates?.[0]?.content?.parts?.[0];
  const data = part?.inlineData?.data;
  const mime = part?.inlineData?.mimeType ?? "";

  if (!data) throw new Error(`No audio data returned for voice ${voice}`);

  const rateMatch = mime.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;

  return pcm16ToWav(data, sampleRate);
}

async function main() {
  const text = process.argv[2] ?? DEFAULT_TEXT;
  const apiKey = requireEnv("GEMINI_API_KEY");

  mkdirSync(join(process.cwd(), "voice-samples"), { recursive: true });

  console.log(`\nText: "${text}"\n`);
  console.log(`Generating ${VOICES.length} voices...\n`);

  const paths: { voice: string; path: string }[] = [];

  for (const voice of VOICES) {
    process.stdout.write(`  ${voice.padEnd(10)} ... `);
    const t0 = Date.now();
    try {
      const wav = await generateVoice(voice, text, apiKey);
      const outPath = join(process.cwd(), "voice-samples", `gemini-${voice.toLowerCase()}.wav`);
      writeFileSync(outPath, wav);
      const durationSec = ((wav.length - 44) / 2 / 24000).toFixed(2);
      console.log(`${durationSec}s  ${Date.now() - t0}ms`);
      paths.push({ voice, path: outPath });
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
    }
  }

  console.log("\nPlaying all voices in sequence. Press Ctrl+C to skip/stop.\n");

  for (const { voice, path } of paths) {
    console.log(`▶ ${voice}`);
    try {
      execSync(`afplay "${path}"`);
    } catch {
      // user skipped with Ctrl+C — continue
    }
  }

  console.log("\nDone. WAV files saved in ./voice-samples/\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
