/**
 * Does the language block actually make the agent follow an English-speaking
 * caller on a Hindi-scripted campaign? Replays the exact failing turn from call
 * 4mpei against the exact system instruction that call ran with.
 *
 * Uses generateContent, not the Live socket (Live has no text modality), so
 * treat this as measuring the PROMPT's pull, not proving Live behaviour.
 */
import { readFileSync } from "fs";

const DUMP =
  "data/voice-callback-dumps/plivo-gemini-live-session/1785255503780-vc_gen_9d54204993abe4fd3900_vc-test-1785255498272-4mpei.json";
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY missing");

const dump = JSON.parse(readFileSync(DUMP, "utf8"));
const ev = (type: string) =>
  dump.events.find((e: { type: string }) => e.type === type).detail;

const liveSystemInstruction: string = ev("gemini.system_instruction").text;
const OPENING: string = ev("gemini.opening_requested").firstMessage;

// The turn that failed: agent greeted in Hindi, caller replied in English.
const USER_TURN = "Ma'am, can you like speak in short sentences, please?";
const INSTRUCTION =
  `The customer said: "${USER_TURN}". Answer that directly now, briefly and naturally. ` +
  `Use only facts and actions present in the Campaign script. If the request is outside that ` +
  `script, say so briefly and return to the current campaign step.`;

/** Devanagari present => it answered in Hindi. */
const isHindi = (text: string) => /[ऀ-ॿ]/.test(text);

async function once(systemInstruction: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [
          { role: "model", parts: [{ text: OPENING }] },
          { role: "user", parts: [{ text: USER_TURN }] },
          { role: "user", parts: [{ text: INSTRUCTION }] },
        ],
        generationConfig: { temperature: 0.55 },
      }),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: { text?: string }) => p.text ?? "").join(" ").trim().replace(/\s+/g, " ");
}

async function run(label: string, systemInstruction: string, trials = 6) {
  const samples: string[] = [];
  let english = 0;
  for (let i = 0; i < trials; i += 1) {
    const text = await once(systemInstruction);
    if (!isHindi(text)) english += 1;
    samples.push(text.slice(0, 100));
  }
  console.log(`\n=== ${label} ===`);
  console.log(`followed the caller into English: ${english}/${trials}`);
  samples.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

const ANCHOR =
  'A "Say:" line already in the language you are currently speaking is approved copy: deliver it as written rather than substituting a different script.';
const REPLACEMENT =
  "The authored wording is approved CONTENT, not an approved language. If the customer is speaking " +
  'English, say that same step in English even though it is written in Hindi. Deliver a "Say:" line ' +
  "exactly as written only when it is already in the language the customer is using.";

const patched = liveSystemInstruction.replace(ANCHOR, REPLACEMENT);
if (patched === liveSystemInstruction) throw new Error("anchor text not found — probe is stale");

async function main() {
  await run("CURRENT (as shipped on call 4mpei)", liveSystemInstruction);
  await run("PATCHED script contract", patched);
}

void main();
