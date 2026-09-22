/**
 * Capability probe: which expressiveness-related setup fields does
 * gemini-3.1-flash-live-preview actually accept?
 *
 * Signal: setupComplete = accepted. Close 1007 = rejected/invalid value.
 * (Precedent for the 1007 signature: plivo-gemini-live-config.ts:430.)
 */
import { WebSocket } from "ws";
import fs from "fs";

// .env.local is not auto-loaded here — parse it directly.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!KEY) throw new Error("no API key");
const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";

function url(version: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(KEY!)}`;
}

const base = () => ({
  model: `models/${MODEL}`,
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } },
  },
  systemInstruction: { parts: [{ text: "You are a phone agent." }] },
});

interface Case { name: string; version: string; setup: Record<string, unknown>; }

const cases: Case[] = [
  { name: "CONTROL (baseline)", version: "v1beta", setup: base() },
  { name: "CONTROL (baseline)", version: "v1alpha", setup: base() },

  { name: "enableAffectiveDialog", version: "v1beta", setup: { ...base(), enableAffectiveDialog: true } },
  { name: "enableAffectiveDialog", version: "v1alpha", setup: { ...base(), enableAffectiveDialog: true } },

  { name: "proactivity.proactiveAudio", version: "v1beta", setup: { ...base(), proactivity: { proactiveAudio: true } } },
  { name: "proactivity.proactiveAudio", version: "v1alpha", setup: { ...base(), proactivity: { proactiveAudio: true } } },

  {
    name: "speechConfig.languageCode=hi-IN",
    version: "v1beta",
    setup: {
      ...base(),
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: "hi-IN",
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } },
        },
      },
    },
  },
  {
    name: "speechConfig.speakingRate=1.15",
    version: "v1beta",
    setup: {
      ...base(),
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          speakingRate: 1.15,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } },
        },
      },
    },
  },
  {
    name: "temperature=1.4 (above nominal max)",
    version: "v1beta",
    setup: {
      ...base(),
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: 1.4,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } },
      },
    },
  },
  {
    name: "BOGUS field (negative control)",
    version: "v1beta",
    setup: { ...base(), thisFieldDoesNotExist: true },
  },
];

function probe(c: Case): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url(c.version), {
      perMessageDeflate: false,
      headers: { "x-goog-api-key": KEY! },
    });
    let settled = false;
    const done = (verdict: string) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closing */ }
      resolve(verdict);
    };
    const timer = setTimeout(() => done("TIMEOUT (no setupComplete, no close)"), 12_000);
    ws.on("open", () => ws.send(JSON.stringify({ setup: c.setup })));
    ws.on("message", (data) => {
      const text = data.toString();
      if (text.includes("setupComplete")) { clearTimeout(timer); done("ACCEPTED"); }
    });
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      done(`CLOSED ${code} ${reason.toString().slice(0, 160)}`);
    });
    ws.on("error", (err) => { clearTimeout(timer); done(`ERROR ${err.message.slice(0, 120)}`); });
  });
}

(async () => {
  console.log(`model=${MODEL}\n`);
  for (const c of cases) {
    const verdict = await probe(c);
    console.log(`${c.version.padEnd(8)} ${c.name.padEnd(34)} → ${verdict}`);
  }
})();
