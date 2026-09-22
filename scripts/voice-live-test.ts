/**
 * voice-live-test.ts — local end-to-end exerciser for the voice observability
 * spine, WITHOUT Plivo/PSTN.
 *
 * It speaks the Plivo media-stream WS protocol directly to the running dev
 * server's bridge (handlePlivoGeminiLiveMediaStream) and feeds OpenAI-TTS speech
 * as the "caller", so a real Gemini Live turn happens and the full event set
 * (voice_ws_connected → voice_setup_complete → voice_turn → voice_transcript_finalized
 * → voice_call_enrichment) is emitted — to PostHog if POSTHOG_API_KEY is set, and
 * always to the `[voice/latency]` console sink.
 *
 * Prereqs (all in .env / .env.local):
 *   VOICE_LATENCY_METRICS=1, GEMINI_API_KEY, OPENAI_API_KEY
 *   (optional) POSTHOG_API_KEY + POSTHOG_HOST to land events in PostHog.
 *
 * Run (env-files needed because this is a standalone process, not Next):
 *   npx tsx --env-file=.env --env-file=.env.local scripts/voice-live-test.ts
 *
 * Every event is tagged with a `synthetic-test-…` call_id so it is trivially
 * filterable / deletable in PostHog (filter: call_id starts with "synthetic-test-").
 */
import { WebSocket } from "ws";
import { storeCallConfig } from "../src/lib/voice-call-state";
import { saveCampaign } from "../src/lib/voice-campaign-store";
import { pcm16ToMulaw, resamplePcm16Mono } from "../src/lib/telephony-audio";
import { getOpenAI } from "../src/lib/openai-client";
import type { VoiceCampaign } from "../src/lib/voice-campaign-types";

const stamp = Date.now();
const campaignId = `synthetic-test-camp-${stamp}`;
const callId = `synthetic-test-${stamp}`;
const plivoCallUuid = `synthetic-test-uuid-${stamp}`;

const campaign: VoiceCampaign = {
  id: campaignId,
  name: "SYNTHETIC TEST — Vastu Home Loan",
  datasetId: "vastu-hfc",
  datasetLabel: "Banking & Lending",
  segmentId: "seg-synthetic",
  segmentName: "Synthetic test leads",
  purposeId: "loan-preapproval",
  purposeName: "Home loan pre-approval",
  systemPrompt: "You are Priya, a warm loan advisor at Vastu Housing Finance. Keep replies to one short sentence.",
  firstMessage: "Hello! This is Priya from Vastu Housing Finance about your home loan. Is now a good time?",
  scriptReasoning: "synthetic local test",
  agentId: "gemini-live",
  voice: process.env.GEMINI_LIVE_VOICE || "Charon",
  voiceName: "Priya",
  language: "English",
  phoneNumbers: ["+10000000000"],
  status: "live" as VoiceCampaign["status"],
  calls: [],
  createdAt: new Date().toISOString(),
  successDefinition: {
    primary: { criterion: "Customer agrees to a follow-up or advisor call" },
    guardrails: ["Do not promise guaranteed loan approval", "Do not quote a specific interest rate"],
  } as VoiceCampaign["successDefinition"],
};
saveCampaign(campaign);

storeCallConfig(callId, {
  campaignId,
  datasetId: "vastu-hfc",
  systemPrompt: campaign.systemPrompt,
  firstMessage: campaign.firstMessage,
  voice: campaign.voice,
  voiceName: "Priya",
  language: "English",
  toNumber: "+10000000000",
  triggeredAtMs: Date.now(),
});

const SILENCE = Buffer.alloc(160, 0xff).toString("base64");

async function callerFrames(text: string): Promise<string[]> {
  const res = await getOpenAI().audio.speech.create({ model: "tts-1", voice: "onyx", input: text, response_format: "pcm" });
  const pcm8k = resamplePcm16Mono(Buffer.from(await res.arrayBuffer()), 24000, 8000);
  const mulaw = pcm16ToMulaw(pcm8k);
  const frames: string[] = [];
  for (let i = 0; i + 160 <= mulaw.length; i += 160) frames.push(mulaw.subarray(i, i + 160).toString("base64"));
  console.log(`[driver] synthesized ${frames.length} caller speech frames`);
  return frames;
}

async function main() {
  console.log(`[driver] callId=${callId} (filter PostHog by this)`);
  const speech = await callerFrames("Yes now is fine. Can you help me understand my home loan eligibility?");
  const ws = new WebSocket(`ws://localhost:3000/plivo-media-stream/${encodeURIComponent(callId)}`);
  let playAudio = 0;
  let ts = 0;
  const media = (p: string) => { ts += 20; ws.send(JSON.stringify({ event: "media", media: { timestamp: String(ts), payload: p } })); };

  ws.on("open", () => {
    console.log("[driver] WS open → start");
    ws.send(JSON.stringify({ event: "start", start: { streamId: "s-synthetic", callId: plivoCallUuid, mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 } } }));
    let phase = "sil1", left = 350, idx = 0;
    const t = setInterval(() => {
      if (phase === "sil1") { media(SILENCE); if (--left <= 0) { console.log("[driver] caller SPEAKING"); phase = "spk"; } }
      else if (phase === "spk") { if (idx < speech.length) media(speech[idx++]); else { console.log("[driver] caller done → awaiting agent reply"); phase = "sil2"; left = 500; } }
      else { media(SILENCE); if (--left <= 0) { clearInterval(t); console.log("[driver] hangup"); try { ws.send(JSON.stringify({ event: "stop" })); } catch { /* */ } setTimeout(() => ws.close(), 500); } }
    }, 20);
  });
  ws.on("message", (d) => { try { if (JSON.parse(d.toString()).event === "playAudio") playAudio += 1; } catch { /* */ } });
  ws.on("close", () => console.log(`[driver] closed. agent audio frames=${playAudio}`));
  ws.on("error", (e) => console.error("[driver] err", (e as Error).message));
  setTimeout(() => { console.log(`[driver] DONE. call_id=${callId}`); process.exit(0); }, 32000);
}
main().catch((e) => { console.error(e); process.exit(1); });
