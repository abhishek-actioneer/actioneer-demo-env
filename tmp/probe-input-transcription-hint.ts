/**
 * PROBE — can we hint the language of INPUT transcription?
 *
 * Distinct from tmp/probe-language-code-behavior.ts, which showed
 * generationConfig.speechConfig.languageCode is inert for the model's OUTPUT.
 * This asks about the other direction: the ASR that produces
 * serverContent.inputTranscription.
 *
 * Why it matters more than anything else in the language stack: measured over
 * the recorded corpus, 37.5% of customer turns on REGIONAL campaigns come back
 * as Romance/Korean hallucination, against 2.8% on Hindi campaigns. That garble
 * rate — not our permitted-set logic — is the dominant failure on Tamil calls.
 * If the ASR can be told "expect Tamil", it is the single highest-leverage fix
 * available. If it cannot, 8kHz telephony Tamil is simply the ceiling.
 *
 * STAGE 1 (this file): is the field even parsed? A server that accepts
 * "xx-XX" without complaint is ignoring the field, exactly as speechConfig
 * .languageCode turned out to. Rejection of garbage is the ONLY positive signal.
 *
 * Run: npx tsx tmp/probe-input-transcription-hint.ts
 */
import { readFileSync } from "fs";

import WebSocket from "ws";

const HOST =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function apiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("GEMINI_API_KEY not found");
}

const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const KEY = apiKey();

function trySetup(label: string, setup: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${HOST}?key=${KEY}`);
    let settled = false;
    const done = (verdict: string, detail: string) => {
      if (settled) return;
      settled = true;
      console.log(`  ${verdict.padEnd(9)} ${label}`);
      if (detail) console.log(`            ${detail.slice(0, 200)}`);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    const timer = setTimeout(() => done("TIMEOUT", ""), 15_000);
    timer.unref?.();

    ws.on("open", () => ws.send(JSON.stringify({ setup })));
    ws.on("message", (raw) => {
      clearTimeout(timer);
      const text = raw.toString();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return done("ODD", text);
      }
      if (msg.setupComplete !== undefined) return done("ACCEPTED", "");
      done("ODD", text);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      done("REJECTED", String(err));
    });
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      done("REJECTED", `close ${code}: ${reason.toString()}`);
    });
  });
}

function setup(inputTranscription: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
    },
    systemInstruction: { parts: [{ text: "You are a phone agent." }] },
    inputAudioTranscription: inputTranscription,
    outputAudioTranscription: {},
    ...extra,
  };
}

async function main(): Promise<void> {
  console.log(`model: ${MODEL}\n`);
  console.log("=== inputAudioTranscription shapes ===\n");

  await trySetup("inputAudioTranscription: {} (control)", setup({}));
  await trySetup("  + languageCode: ta-IN", setup({ languageCode: "ta-IN" }));
  await trySetup("  + languageCode: xx-XX (garbage)", setup({ languageCode: "xx-XX" }));
  await trySetup("  + language: ta-IN", setup({ language: "ta-IN" }));
  await trySetup("  + languageCodes: [ta-IN, en-IN]", setup({ languageCodes: ["ta-IN", "en-IN"] }));
  await trySetup("  + totalNonsenseField: 1", setup({ totalNonsenseField: 1 }));

  console.log("\n=== other places a hint might live ===\n");
  await trySetup(
    "setup.languageCode: ta-IN",
    setup({}, { languageCode: "ta-IN" }),
  );
  await trySetup(
    "setup.languageCode: xx-XX (garbage)",
    setup({}, { languageCode: "xx-XX" }),
  );
  await trySetup(
    "generationConfig.speechConfig.languageCode already known inert — skipping",
    setup({}),
  );

  console.log(
    `\nREADING THIS: the server rejects unknown fields on this API — "totalNonsenseField"\n` +
      `is the control for that. If nonsense is REJECTED but xx-XX is ACCEPTED, the field\n` +
      `name is recognised while its VALUE is unvalidated, which usually means accepted-\n` +
      `and-ignored. If nonsense is ACCEPTED too, the whole object is unvalidated and\n` +
      `nothing here can be concluded from acceptance alone.`,
  );
}

void main();
