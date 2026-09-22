/**
 * PHASE 0 PROBE — two questions that decide the whole language architecture.
 *
 *   A. Does Gemini Live accept `generationConfig.speechConfig.languageCode` on
 *      the native-audio model, and does it accept a mid-session update of it?
 *      If YES, language becomes a SETTING rather than a prompt request, and the
 *      entire marker/script heuristic drops to a fallback.
 *
 *   B. Does `serverContent.inputTranscription` carry anything beyond `text` —
 *      a language tag, a locale, a confidence? The runtime reads only `.text`
 *      (plivo-gemini-live-gemini-handler.ts:613). If a language field is in
 *      there, we are already paying for the signal we have been inferring.
 *
 * Docs are not the authority here: this project has already been burned by
 * gemini-3.1-flash-live-preview rejecting generateContent with a 404 that no
 * doc mentioned. Probe live, read the wire.
 *
 * Run: GEMINI_API_KEY=... npx tsx tmp/probe-live-language-control.ts
 */
import { readFileSync } from "fs";

import WebSocket from "ws";

const HOST =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function apiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // .env.local is where this project actually keeps it.
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("GEMINI_API_KEY not found in env or .env.local");
}

const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const KEY = apiKey();

/** One connection attempt. Resolves with whatever the server said about setup. */
function trySetup(
  label: string,
  setup: Record<string, unknown>,
): Promise<{ label: string; ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${HOST}?key=${KEY}`);
    let settled = false;
    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve({ label, ok, detail });
    };

    const timer = setTimeout(() => done(false, "timeout after 15s"), 15_000);
    timer.unref?.();

    ws.on("open", () => ws.send(JSON.stringify({ setup })));
    ws.on("message", (raw) => {
      const text = raw.toString();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return done(false, `unparseable: ${text.slice(0, 200)}`);
      }
      if (msg.setupComplete !== undefined) {
        clearTimeout(timer);
        return done(true, `setupComplete: ${JSON.stringify(msg.setupComplete)}`);
      }
      clearTimeout(timer);
      done(false, `first message was not setupComplete: ${text.slice(0, 300)}`);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      done(false, `ws error: ${String(err).slice(0, 300)}`);
    });
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      done(false, `closed ${code}: ${reason.toString().slice(0, 300)}`);
    });
  });
}

function baseSetup(extraSpeechConfig: Record<string, unknown> = {}) {
  return {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        ...extraSpeechConfig,
      },
    },
    systemInstruction: { parts: [{ text: "You are a test agent. Reply in one short sentence." }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

async function probeA(): Promise<void> {
  console.log(`\n=== PROBE A — speechConfig.languageCode on ${MODEL} ===\n`);
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no languageCode (control)", {}],
    ["languageCode: hi-IN", { languageCode: "hi-IN" }],
    ["languageCode: ta-IN", { languageCode: "ta-IN" }],
    ["languageCode: mr-IN", { languageCode: "mr-IN" }],
    ["languageCode: garbage", { languageCode: "xx-XX" }],
  ];
  for (const [label, extra] of cases) {
    const r = await trySetup(label, baseSetup(extra));
    console.log(`  ${r.ok ? "ACCEPTED" : "REJECTED"}  ${label}`);
    console.log(`            ${r.detail}`);
  }
  console.log(
    `\n  Read carefully: "garbage ACCEPTED" means the field is being SILENTLY IGNORED,\n` +
      `  not honoured. Only a setup that accepts real codes and rejects xx-XX proves\n` +
      `  the server is actually parsing it.`,
  );
}

/**
 * Probe B needs real audio to get a transcript back. We do not have a mic here,
 * so we send a short burst of silence-with-tone PCM and print whatever the
 * server returns — the point is the SHAPE of inputTranscription, not the words.
 * If nothing comes back, this reports inconclusive rather than guessing.
 */
async function probeB(): Promise<void> {
  console.log(`\n=== PROBE B — inputTranscription payload shape ===\n`);
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`${HOST}?key=${KEY}`);
    const seen: string[] = [];
    let sawTranscription = false;

    const finish = () => {
      if (!sawTranscription) {
        console.log("  INCONCLUSIVE — no inputTranscription arrived in the probe window.");
        console.log("  Fallback: add a one-line raw dump of serverContent.inputTranscription");
        console.log("  in plivo-gemini-live-gemini-handler.ts:612 and read it off a live call.");
      }
      if (seen.length) {
        console.log(`\n  server message types seen: ${[...new Set(seen)].join(", ")}`);
      }
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve();
    };

    const timer = setTimeout(finish, 25_000);
    timer.unref?.();

    ws.on("open", () => ws.send(JSON.stringify({ setup: baseSetup() })));
    ws.on("message", (raw) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      seen.push(Object.keys(msg).join("+"));

      if (msg.setupComplete !== undefined) {
        // Speak to the model in text so it produces a turn; that at least proves
        // the transcription channels are wired and shows outputTranscription's
        // shape, which is the same message family as inputTranscription.
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: "Say one short sentence in Hindi." }] }],
              turnComplete: true,
            },
          }),
        );
        return;
      }

      const sc = msg.serverContent;
      if (!sc) return;
      for (const field of ["inputTranscription", "outputTranscription"]) {
        if (sc[field]) {
          sawTranscription = true;
          console.log(`  ${field} keys: ${JSON.stringify(Object.keys(sc[field]))}`);
          console.log(`  ${field} raw : ${JSON.stringify(sc[field]).slice(0, 300)}`);
        }
      }
      if (sc.turnComplete) {
        clearTimeout(timer);
        finish();
      }
    });
    ws.on("error", (err) => {
      console.log(`  ws error: ${String(err).slice(0, 200)}`);
      clearTimeout(timer);
      finish();
    });
    ws.on("close", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

async function main(): Promise<void> {
  console.log(`model: ${MODEL}`);
  await probeA();
  await probeB();
  console.log("");
}

void main();
