import { auth } from "@clerk/nextjs/server";
import { getCampaign } from "@/lib/voice-campaign-store";
import { storeCallConfig } from "@/lib/voice-call-state";
import { emitVoiceLifecycle } from "@/lib/voice-events";
import { activeVoiceCallProvider } from "@/features/voice/server/call-provider";
import { resolveVoiceDialerProvider } from "@/features/voice/server/dialer-provider";
import { type VoiceCustomerContext } from "@/lib/voice-customer-context";
import {
  buildFundsIndiaVoiceCustomerContext,
  lookupVoiceCustomerByPhone,
} from "@/lib/server/voice-customer-context-repo";
import { buildCampaignRuntimePrompt } from "@/lib/voice-campaign-runtime-prompt";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (!raw.startsWith("+")) return `+${digits}`;
  return raw;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: campaignId } = await params;
  const campaign = getCampaign(campaignId, { userId });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  let body: { userId?: unknown; phone?: unknown; customerContext?: unknown; isTest?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const investorId = typeof body.userId === "string" ? body.userId.trim() : undefined;
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!rawPhone) return Response.json({ error: "phone is required" }, { status: 400 });

  const phone = normalizePhone(rawPhone);

  // ---------------------------------------------------------------------------
  // Customer context — injected from modal takes priority; fallback to DB lookup
  // ---------------------------------------------------------------------------
  let customerContext: VoiceCustomerContext | undefined =
    body.customerContext && typeof body.customerContext === "object"
      ? (body.customerContext as VoiceCustomerContext)
      : undefined;

  if (!customerContext && campaign.datasetId === "fundsindia" && investorId) {
    customerContext = await buildFundsIndiaVoiceCustomerContext(campaign.datasetId, investorId).catch(() => undefined);
  }

  // This route lets the caller type an arbitrary destination number, so a real
  // customer's context can be dialed to someone who is not that customer. Check
  // the number against the customer's registered phone; on mismatch (or when
  // the lookup can't confirm), forensics benches the voice against the
  // customer's reference but never enrolls it.
  let voiceIdentityPhoneVerified: boolean | undefined;
  if (customerContext?.investorId && campaign.datasetId && body.isTest !== true) {
    const registered = await lookupVoiceCustomerByPhone(campaign.datasetId, phone);
    voiceIdentityPhoneVerified = registered?.investorId === customerContext.investorId;
  }

  // Inject customer context into system prompt so Gemini sees it. Shared with the
  // inbound answer route so both directions compile the campaign identically.
  const runtime = buildCampaignRuntimePrompt(campaign, customerContext);
  const systemPrompt = runtime.systemPrompt;

  const callId = `vc-${(investorId || "test").slice(-6)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // U3: stamp + persist the trigger wall-clock BEFORE dial so it deterministically
  // precedes every bridge event for this call_id, then emit voice_call_triggered.
  const triggeredAtMs = Date.now();

  const config = {
    campaignId: campaign.id,
    datasetId: campaign.datasetId,
    userId,
    systemPrompt,
    firstMessage: runtime.firstMessage,
    voice: campaign.voice || process.env.GEMINI_LIVE_VOICE || "Charon",
    voiceName: campaign.voiceName || "Priya",
    language: campaign.language || "Hinglish",
    toNumber: phone,
    triggeredAtMs,
    ...(customerContext && { customerContext }),
    ...(body.isTest === true && { isTestCall: true }),
    ...(voiceIdentityPhoneVerified !== undefined && { voiceIdentityPhoneVerified }),
    linkDest: runtime.linkDest,
    linkWindowDays: runtime.linkWindowDays,
    linkTemplate: runtime.linkTemplate,
  };

  storeCallConfig(callId, config);
  emitVoiceLifecycle("voice_call_triggered", { campaign_id: campaign.id }, callId, "gemini_live");

  const provider = activeVoiceCallProvider(campaign.callProvider);
  const dialer = resolveVoiceDialerProvider(provider);
  let result;
  try {
    result = await dialer.startCall({
      campaign,
      callConfigId: callId,
      toNumber: phone,
      customerContext,
      runtimeSystemPrompt: systemPrompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start call";
    console.error("[voice-campaigns/call-user] dialer.startCall failed:", message);
    return Response.json({ error: `Could not start call: ${message}` }, { status: 502 });
  }

  return Response.json({ callId, toNumber: phone, status: "calling", provider, providerRequestId: result.providerRequestId });
}
