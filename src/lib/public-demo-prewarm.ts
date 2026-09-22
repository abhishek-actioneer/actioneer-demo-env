/**
 * DID-level Gemini Live standby for the public inbound demo.
 * Kept out of the answer route so activate/admin paths can call it cleanly.
 */

import { storeCallConfig, type CallConfig } from "./voice-call-state";
import {
  PUBLIC_DEMO_CAMPAIGN_ID,
  PUBLIC_DEMO_DATASET_ID,
  PUBLIC_DEMO_ROUTER_AGENT_NAME,
} from "./public-demo-personas";
import {
  buildPublicDemoInboundGreeting,
  buildPublicDemoRouterSystemPrompt,
} from "./public-demo-inbound-prompt";
import {
  isPublicDemoInboundEnabled,
  PUBLIC_DEMO_STANDBY_CALL_ID,
} from "./public-demo-config";
import { prewarmGeminiLiveCallSession } from "./plivo-gemini-live-prewarm";

/**
 * Keep a Gemini Live session warm for the public demo DID so the next inbound
 * call can rekey it instead of cold-starting. Safe to call repeatedly.
 * Standby uses router-only systemInstruction (no campaign scripts).
 */
export function ensurePublicDemoStandbyPrewarm(partial?: Partial<CallConfig>): void {
  if (!isPublicDemoInboundEnabled()) return;
  const language = partial?.language || "Hinglish";
  const voiceName = PUBLIC_DEMO_ROUTER_AGENT_NAME;
  const config: CallConfig = {
    campaignId: partial?.campaignId || PUBLIC_DEMO_CAMPAIGN_ID,
    datasetId: partial?.datasetId || PUBLIC_DEMO_DATASET_ID,
    userId: partial?.userId,
    systemPrompt: buildPublicDemoRouterSystemPrompt({
      agentName: voiceName,
      language,
    }),
    firstMessage: buildPublicDemoInboundGreeting({
      agentName: voiceName,
      language,
    }),
    voice: partial?.voice || "Aoede",
    voiceName,
    language,
    toNumber: "",
    isPublicDemo: true,
    activePersonaId: null,
  };
  storeCallConfig(PUBLIC_DEMO_STANDBY_CALL_ID, config);
  void prewarmGeminiLiveCallSession(PUBLIC_DEMO_STANDBY_CALL_ID, config).catch((err) => {
    console.error("[public-demo] standby prewarm failed:", err);
  });
}
