/**
 * PHASE 0 PROBE A2 — does speechConfig.languageCode actually DO anything?
 *
 * Probe A showed the server accepts languageCode: "xx-XX" without complaint,
 * which strongly suggests the field is unparsed on the native-audio model. That
 * is an inference. This measures it instead: give the model a language-neutral
 * instruction under different languageCode values and read back which script
 * the output transcription lands in.
 *
 * If ta-IN produces Tamil and hi-IN produces Hindi, the field is honoured and
 * language becomes a setting. If every case produces the same language, it is
 * decoration and the heuristic layer is the only lever we have.
 *
 * Run: npx tsx tmp/probe-language-code-behavior.ts
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

const SCRIPTS: Array<[string, RegExp]> = [
  ["Devanagari", /[ऀ-ॿ]/],
  ["Tamil", /[஀-௿]/],
  ["Telugu", /[ఀ-౿]/],
  ["Kannada", /[ಀ-೿]/],
  ["Bengali", /[ঀ-৿]/],
  ["Latin", /[A-Za-z]/],
];

function classify(text: string): string {
  const hits = SCRIPTS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return hits.length ? hits.join("+") : "none";
}

/**
 * The prompt is deliberately language-NEUTRAL: it names no language, so the only
 * thing that could steer the output is languageCode itself.
 */
const PROMPT = "Greet the customer and ask if now is a good time to talk. One sentence.";

function run(languageCode: string | null): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${HOST}?key=${KEY}`);
    let transcript = "";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(transcript.trim());
    };
    const timer = setTimeout(done, 25_000);
    timer.unref?.();

    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${MODEL}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
                ...(languageCode ? { languageCode } : {}),
              },
            },
            systemInstruction: {
              parts: [{ text: "You are a phone agent for a loan company." }],
            },
            outputAudioTranscription: {},
          },
        }),
      ),
    );

    ws.on("message", (raw) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.setupComplete !== undefined) {
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: PROMPT }] }],
              turnComplete: true,
            },
          }),
        );
        return;
      }
      const sc = msg.serverContent;
      if (sc?.outputTranscription?.text) transcript += sc.outputTranscription.text;
      if (sc?.turnComplete) {
        clearTimeout(timer);
        done();
      }
    });
    ws.on("error", () => {
      clearTimeout(timer);
      done();
    });
    ws.on("close", () => {
      clearTimeout(timer);
      done();
    });
  });
}

async function main(): Promise<void> {
  console.log(`model: ${MODEL}`);
  console.log(`prompt (names no language): "${PROMPT}"\n`);

  // Two runs per case: the model is sampled, so a single run cannot separate
  // "languageCode did nothing" from "the model happened to pick that language".
  const CASES = [null, "hi-IN", "ta-IN", "te-IN", "mr-IN", "en-IN", "xx-XX"];
  const results: Record<string, string[]> = {};

  for (const code of CASES) {
    const label = code ?? "(unset)";
    results[label] = [];
    for (let i = 0; i < 2; i++) {
      const text = await run(code);
      results[label].push(classify(text));
      console.log(`  ${label.padEnd(8)} run${i + 1}  ${classify(text).padEnd(14)} ${text.slice(0, 60)}`);
    }
  }

  console.log(`\n--- verdict ---`);
  const tamil = results["ta-IN"]?.some((s) => s.includes("Tamil"));
  const telugu = results["te-IN"]?.some((s) => s.includes("Telugu"));
  if (tamil || telugu) {
    console.log("  languageCode IS honoured — at least one regional code produced its script.");
    console.log("  => language can become a SETTING; the heuristic drops to a fallback.");
  } else {
    console.log("  languageCode appears INERT on this model — no regional code produced its script,");
    console.log("  and xx-XX was accepted without error. Deterministic language control is NOT");
    console.log("  available via native audio config. The heuristic layer is the only lever,");
    console.log("  short of moving TTS out of the model (half-cascade).");
  }
}

void main();
