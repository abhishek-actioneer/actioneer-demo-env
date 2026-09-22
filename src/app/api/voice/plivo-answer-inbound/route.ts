import { resolvePlivoStreamBaseUrl, resolvePublicBaseUrl, toWebSocketUrl } from "@/lib/public-base-url";
import { dumpVoiceRequestMetadata, readAndDumpVoiceForm, updateVoiceDump } from "@/lib/voice-debug-dump";
import { verifyPlivoWebhookSignature } from "@/lib/voice-webhook-auth";
import { formDataToParamMap } from "@/lib/plivo-webhook-signature";
import { upsertCall } from "@/lib/voice-campaign-store";
import { storeCallConfig, type CallConfig } from "@/lib/voice-call-state";
import { geminiVoiceGender } from "@/lib/gemini-voices";
import { normalizeAgentGenderedPhrases } from "@/lib/voice-campaign-flow";
import { emitVoiceLifecycle } from "@/lib/voice-events";
import { resolveInboundAgentConfig } from "@/lib/inbound-agent-config";
import { buildInboundAgentSystemPrompt, buildInboundGreeting } from "@/lib/inbound-agent-prompt";
import { buildCampaignRuntimePrompt } from "@/lib/voice-campaign-runtime-prompt";
import { adaptCampaignPromptForInbound, buildCampaignInboundOpening } from "@/lib/inbound-campaign-script";
import {
  PUBLIC_DEMO_CAMPAIGN_ID,
  PUBLIC_DEMO_DATASET_ID,
  PUBLIC_DEMO_ROUTER_AGENT_NAME,
} from "@/lib/public-demo-personas";
import {
  buildPublicDemoInboundGreeting,
  buildPublicDemoRouterSystemPrompt,
} from "@/lib/public-demo-inbound-prompt";
import {
  PUBLIC_DEMO_STANDBY_CALL_ID,
  shouldUsePublicDemoRouter,
} from "@/lib/public-demo-config";
import {
  refreshGeminiPrewarmOnAnswer,
  rekeyWarmGeminiSession,
} from "@/lib/plivo-gemini-live-bridge";
import { inboundVoicePersonaForCampaign } from "@/lib/inbound-voice-personas";
import { lookupVoiceCustomerByPhone } from "@/lib/server/voice-customer-context-repo";
import {
  shouldUseVoiceBiometricDemo,
  voiceBiometricDemoGreeting,
  voiceBiometricDemoPrompt,
} from "@/lib/voice-biometric/config";
/**
 * Inbound answer webhook. Unlike the outbound `plivo-answer` route, no callId is
 * pre-created — the caller dialed us cold. We mint a callId here, resolve the
 * inbound agent (persona from a campaign; behavior + grounding from the inbound
 * engine), build its CallConfig, store it, and return the same <Stream> XML the
 * outbound path returns. Everything downstream (media stream, Gemini bridge,
 * barge-in, language, recording) is unchanged — it is entirely callId-driven.
 *
 * When PUBLIC_DEMO_INBOUND_ENABLED is on for this DID, the call runs the
 * public demo router (router-only system prompt; host soft-swaps a single
 * campaign mid-call) with injection defense and answer-time Gemini prewarm.
 */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function inboundXmlResponse(
  req: Request,
  formData: FormData,
  dumpStorageKey: string,
): Promise<Response> {
  if (!(await verifyPlivoWebhookSignature(req, formDataToParamMap(formData)))) {
    console.warn("[voice/plivo-answer-inbound] rejected — Plivo signature verification failed");
    return new Response("Forbidden", { status: 403 });
  }

  const fromNumber = (formData.get("From") as string) || "";
  const toNumber = (formData.get("To") as string) || "";
  const plivoCallUuid = (formData.get("CallUUID") as string) || "";

  const demoRouter = shouldUsePublicDemoRouter(toNumber);
  const biometricDemo = shouldUseVoiceBiometricDemo(toNumber);
  const agent = resolveInboundAgentConfig(toNumber);

  // Demo router can answer even without a campaign binding (uses fixed ids).
  // Ordinary inbound still requires a resolved agent.
  if (!demoRouter && !biometricDemo && !agent) {
    console.error("[voice/plivo-answer-inbound] no inbound agent configured (campaign not found)");
    updateVoiceDump({
      dumpStorageKey,
      patch: {
        response: { generatedAt: new Date().toISOString(), status: 500, error: "inbound agent not configured" },
      },
    });
    return new Response("Inbound agent not configured", { status: 500 });
  }

  let baseUrl: string | undefined;
  let streamBaseUrl: string | undefined;
  try {
    baseUrl = resolvePublicBaseUrl(req);
    streamBaseUrl = resolvePlivoStreamBaseUrl(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Public base URL is invalid";
    console.error(`[voice/plivo-answer-inbound] ${message}`);
    return new Response(message, { status: 500 });
  }
  if (!baseUrl || !streamBaseUrl) {
    return new Response("Public base URL is not configured", { status: 500 });
  }

  // Mint a callId (mirrors the outbound call-user route pattern).
  const callId = `vc-in-${(fromNumber || "unknown").slice(-6)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let systemPrompt: string;
  let firstMessage: string;
  let linkFields: Pick<CallConfig, "linkDest" | "linkWindowDays" | "linkTemplate"> = {};
  let isPublicDemo = false;
  let campaignId = biometricDemo
    ? process.env.VOICE_BIOMETRIC_CAMPAIGN_ID?.trim() || "voice-biometric-demo"
    : agent?.campaignId || PUBLIC_DEMO_CAMPAIGN_ID;
  let datasetId = biometricDemo
    ? process.env.VOICE_BIOMETRIC_DATASET_ID?.trim() || "hdfc-creditfraud"
    : agent?.datasetId || PUBLIC_DEMO_DATASET_ID;
  const userId = biometricDemo
    ? process.env.VOICE_BIOMETRIC_OWNER_USER_ID?.trim()
    : agent?.userId;
  let voice = agent?.voice || "Aoede";
  let voiceName = agent?.voiceName || agent?.agentName;
  let language = agent?.language || "Hinglish";

  if (biometricDemo) {
    if (!userId) return new Response("VOICE_BIOMETRIC_OWNER_USER_ID is not configured", { status: 500 });
    voice = agent?.voice || "Aoede";
    voiceName = agent?.voiceName || "Asha";
    language = "Hindi, English, or Hinglish";
    systemPrompt = voiceBiometricDemoPrompt();
    firstMessage = voiceBiometricDemoGreeting();
  } else if (demoRouter) {
    isPublicDemo = true;
    // Router attribution until host soft-routes to a persona campaign.
    campaignId = PUBLIC_DEMO_CAMPAIGN_ID;
    datasetId = agent?.datasetId || PUBLIC_DEMO_DATASET_ID;
    voice = agent?.voice || "Aoede";
    voiceName = PUBLIC_DEMO_ROUTER_AGENT_NAME;
    language = agent?.language || "Hinglish";
    systemPrompt = buildPublicDemoRouterSystemPrompt({
      agentName: voiceName,
      companyName: agent?.companyName || "Actioneer",
      language,
    });
    firstMessage = buildPublicDemoInboundGreeting({
      agentName: voiceName,
      companyName: agent?.companyName || "Actioneer",
      language,
    });
  } else if (agent!.mode === "campaign-script" && agent!.campaign) {
    const runtime = buildCampaignRuntimePrompt(agent!.campaign);
    systemPrompt = adaptCampaignPromptForInbound(runtime.systemPrompt, agent!.campaign, fromNumber);
    firstMessage = buildCampaignInboundOpening(agent!.campaign, agent!.greetingOverride);
    linkFields = {
      linkDest: runtime.linkDest,
      linkWindowDays: runtime.linkWindowDays,
      linkTemplate: runtime.linkTemplate,
    };
  } else {
    systemPrompt = buildInboundAgentSystemPrompt(agent!, fromNumber);
    firstMessage = buildInboundGreeting(agent!);
  }

  const agentGender = geminiVoiceGender(voiceName || voice || "");
  firstMessage = normalizeAgentGenderedPhrases(firstMessage, agentGender);

  // Voice forensics: some inbound scripts always address one named person
  // (e.g. "Am I speaking with Rahul Awasthi?"). Pin verificationSubjectId so
  // every call to this script enrolls/matches against THAT identity's voice,
  // not the caller's raw phone number — see voiceForensicsUserId().
  const voicePersona = biometricDemo ? null : inboundVoicePersonaForCampaign(campaignId);

  // No pinned persona: identify the caller by phone against the dataset's
  // entity table so their biomarker enrolls/matches under their own customer
  // identity. Identity-only context — the system prompt above is already built
  // and stays untouched. Null on no/ambiguous match (falls back to the caller's
  // phone number as the biomarker key).
  const callerContext = !biometricDemo && !voicePersona && !isPublicDemo
    ? await lookupVoiceCustomerByPhone(datasetId, fromNumber)
    : null;

  const config: CallConfig = {
    campaignId,
    datasetId,
    userId,
    systemPrompt,
    firstMessage,
    voice,
    voiceName,
    language,
    toNumber: fromNumber, // for inbound, the "other party" is the caller
    triggeredAtMs: Date.now(),
    isPublicDemo: isPublicDemo || undefined,
    isVoiceBiometricDemo: biometricDemo || undefined,
    activePersonaId: isPublicDemo ? null : undefined,
    verificationSubjectId: voicePersona?.subjectId,
    customerContext: voicePersona
      ? {
          source: "generic",
          datasetId,
          firstName: voicePersona.firstName,
          displayName: voicePersona.displayName,
          gender: voicePersona.gender,
        }
      : callerContext ?? undefined,
    ...linkFields,
  };
  storeCallConfig(callId, config);

  // Register the inbound call so it appears in logs and post-call analysis fires.
  if (plivoCallUuid) {
    // Inbound calls are distinguishable by the `vc-in-` callConfigId prefix and
    // the direction tag on the voice_call_triggered lifecycle event below.
    upsertCall(campaignId, {
      id: plivoCallUuid,
      callConfigId: callId,
      provider: "plivo",
      direction: "inbound",
      toNumber: fromNumber,
      status: "connected",
      engaged: false,
      startedAt: new Date().toISOString(),
      triggeredAtMs: config.triggeredAtMs,
    });
  }

  emitVoiceLifecycle(
    "voice_call_triggered",
    { campaign_id: campaignId, direction: "inbound", public_demo: isPublicDemo },
    callId,
    "gemini_live",
  );

  // Answer-time prewarm: inbound has no ring window, but the gap between this
  // webhook returning XML and Plivo opening the media WS is still useful.
  // For the public demo, also try to claim a DID-level standby session.
  if (isPublicDemo) {
    rekeyWarmGeminiSession(PUBLIC_DEMO_STANDBY_CALL_ID, callId);
  }
  refreshGeminiPrewarmOnAnswer(callId);

  const streamUrl = toWebSocketUrl(streamBaseUrl, `/plivo-media-stream/${encodeURIComponent(callId)}`);
  const statusCallbackUrl = `${baseUrl}/api/voice/plivo-stream-status`;
  console.log(
    `[voice/plivo-answer-inbound] from=${fromNumber || "(missing)"} to=${toNumber || "(missing)"} ` +
      `callUuid=${plivoCallUuid || "(missing)"} callId=${callId} agent=${campaignId}` +
      ` demoRouter=${isPublicDemo ? "1" : "0"} mode=${agent?.mode ?? "(none)"} streamUrl=${streamUrl}`,
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" statusCallbackUrl="${xmlEscape(statusCallbackUrl)}" statusCallbackMethod="POST">${xmlEscape(streamUrl)}</Stream>
</Response>`;

  updateVoiceDump({
    dumpStorageKey,
    patch: {
      response: {
        generatedAt: new Date().toISOString(),
        status: 200,
        callId,
        campaignId,
        fromNumber,
        toNumber,
        streamUrl,
        statusCallbackUrl,
        contentType: "text/xml",
        publicDemo: isPublicDemo,
      },
    },
  });

  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

/**
 * Keep a Gemini Live session warm for the public demo DID so the next inbound
 * call can rekey it instead of cold-starting. Safe to call repeatedly.
 * Re-exported from the lib module for callers that already import this route.
 */
export { ensurePublicDemoStandbyPrewarm } from "@/lib/public-demo-prewarm";

export async function POST(req: Request) {
  const { formData, dumpStorageKey } = await readAndDumpVoiceForm(req, "plivo-answer-inbound");
  return inboundXmlResponse(req, formData, dumpStorageKey);
}

export async function GET(req: Request) {
  // Plivo Applications default to POST; support GET only for manual smoke tests
  // (browser / curl). A GET has no form body, so synthesize FormData from the
  // query string instead of reading the body (which would throw).
  const formData = new FormData();
  for (const [key, value] of new URL(req.url).searchParams.entries()) formData.set(key, value);
  const dumpStorageKey = dumpVoiceRequestMetadata({ req, endpoint: "plivo-answer-inbound" });
  return inboundXmlResponse(req, formData, dumpStorageKey);
}
