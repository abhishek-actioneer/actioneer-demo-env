/**
 * Does the agent come BACK to Hindi once it has switched to English?
 *
 * Reproduces call 5hgso (2026-07-28): the agent followed the caller into
 * English, the caller then spoke Hindi for three turns, and the agent stayed in
 * English until the caller hung up.
 *
 * Hypothesis: rule 3 ("switch to it and stay there for the rest of the call.
 * This overrides every other rule here") is a one-way latch that permanently
 * outranks rule 1 (follow the customer).
 *
 * generateContent, not the Live socket — measures the PROMPT's pull.
 */
import { readFileSync } from "fs";

const DUMP =
  "data/voice-callback-dumps/plivo-gemini-live-session/1785256650604-vc_gen_9d54204993abe4fd3900_vc-test-1785256646474-5hgso.json";
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY missing");

const dump = JSON.parse(readFileSync(DUMP, "utf8"));
const liveSystemInstruction: string = dump.events.find(
  (e: { type: string }) => e.type === "gemini.system_instruction",
).detail.text;

// State at the moment it broke: agent has just switched to English, caller
// answers in Hindi. Verbatim from the call.
const AGENT_IN_ENGLISH =
  "Oh, sure, no problem. I will speak in short sentences now. Was that amount received to you?";
const USER_HINDI = "हां, मिल गया मेरे को। लेकिन आप क्यों कॉल कर रहे हो?";
const INSTRUCTION =
  `The customer said: "${USER_HINDI}". Answer that directly now, briefly and naturally. ` +
  `Reply in the same language the customer just used. ` +
  `Use only facts and actions present in the Campaign script. If the request is outside that ` +
  `script, say so briefly and return to the current campaign step.`;

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
          { role: "model", parts: [{ text: AGENT_IN_ENGLISH }] },
          { role: "user", parts: [{ text: USER_HINDI }] },
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
  let hindi = 0;
  const samples: string[] = [];
  for (let i = 0; i < trials; i += 1) {
    const text = await once(systemInstruction);
    if (isHindi(text)) hindi += 1;
    samples.push(text.slice(0, 95));
  }
  console.log(`\n=== ${label} ===`);
  console.log(`came back to Hindi: ${hindi}/${trials}`);
  samples.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

const LATCH =
  "If the customer explicitly asks for a language, switch to it and stay there for the rest of the call. This overrides every other rule here.";
const UNLATCHED =
  "If the customer explicitly asks for a language, switch to it on your next sentence — this takes priority over the language you are speaking at that moment. It does not freeze the call: rule 1 still applies afterwards, so if they later speak a different permitted language, follow them there too.";

const unlatched = liveSystemInstruction.replace(LATCH, UNLATCHED);
if (unlatched === liveSystemInstruction) throw new Error("latch text not found — probe is stale");

async function main() {
  await run("CURRENT (latching rule 3, as shipped on 5hgso)", liveSystemInstruction);
  await run("UNLATCHED rule 3", unlatched);
}

void main();
