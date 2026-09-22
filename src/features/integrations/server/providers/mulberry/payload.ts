import type { VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceCustomerContext } from "@/lib/voice-customer-context";

/**
 * Mulberry (Pipecat) runtime context — the body of `POST {MULBERRY_START_URL}/start`.
 *
 * This is a SEPARATE RAIL from the Gemini + Plivo bridge: Mulberry's external
 * runtime owns the entire call (dials on its own Plivo, runs its own Pipecat
 * STT→LLM→TTS cascade). We only hand it a fully-resolved system prompt + opening
 * line and tell it where to POST the post-call result. Nothing here touches the
 * `plivo-gemini-live-*` pipeline.
 *
 * Schema version: voice-runtime-context.v1 (see docs / mulberry_call_curl sample).
 */
export interface MulberryRuntimeContext {
  version: "voice-runtime-context.v1";
  tts: "mulberry";
  call: {
    callId: string;
    campaignId: string;
    toNumber: string;
    fromNumber: string;
    idempotencyKey: string;
  };
  agent: {
    provider: "pipecat";
    language: string;
    voiceName: string;
    systemPrompt: string;
    speaker: string;
    voiceDescription: string;
  };
  opening: {
    firstMessage: string;
    instruction: string;
  };
  campaign: {
    name: string;
    companyName?: string;
    entityName?: string;
    datasetId?: string;
    segmentId?: string;
    segmentName?: string;
    offerId?: string;
    offerName?: string;
  };
  postCall: {
    returnTranscript: true;
    returnRecordingUrl: true;
    /** We own follow-ups on our side; keep Mulberry from double-sending. */
    followUpChannels: string[];
    /** Where Mulberry POSTs the post-call transcript + recording URL. */
    callbackUrl?: string;
    /** Shared secret Mulberry must echo back (header `x-mulberry-secret` or `?secret=`). */
    callbackSecret?: string;
  };
}

const OPENING_INSTRUCTION =
  "Say exactly `firstMessage` as the first assistant turn. Do not add anything before or after it. Then wait for the customer.";

export interface BuildMulberryRuntimeContextParams {
  campaign: VoiceCampaign;
  callConfigId: string;
  toNumber: string;
  fromNumber: string;
  /** Fully-resolved system prompt (customer context + hints already appended). */
  runtimeSystemPrompt: string;
  /** Fully-resolved opening line (placeholders already applied). */
  firstMessage: string;
  language: string;
  /** Persona display name spoken in the script (e.g. "Priya"). */
  voiceName: string;
  /** Mulberry TTS voice id (their `speaker`, e.g. "ira"). */
  speaker: string;
  voiceDescription: string;
  customerContext?: VoiceCustomerContext;
  callbackUrl?: string;
  callbackSecret?: string;
}

export function buildMulberryRuntimeContext(
  params: BuildMulberryRuntimeContextParams,
): MulberryRuntimeContext {
  const {
    campaign,
    callConfigId,
    toNumber,
    fromNumber,
    runtimeSystemPrompt,
    firstMessage,
    language,
    voiceName,
    speaker,
    voiceDescription,
    callbackUrl,
    callbackSecret,
  } = params;

  return {
    version: "voice-runtime-context.v1",
    tts: "mulberry",
    call: {
      callId: callConfigId,
      campaignId: campaign.id,
      toNumber,
      fromNumber,
      idempotencyKey: callConfigId,
    },
    agent: {
      provider: "pipecat",
      language,
      voiceName,
      systemPrompt: runtimeSystemPrompt,
      speaker,
      voiceDescription,
    },
    opening: {
      firstMessage,
      instruction: OPENING_INSTRUCTION,
    },
    campaign: {
      name: campaign.name,
      companyName: campaign.companyName,
      entityName: campaign.entityName,
      datasetId: campaign.datasetId,
      segmentId: campaign.segmentId,
      segmentName: campaign.segmentName,
    },
    postCall: {
      returnTranscript: true,
      returnRecordingUrl: true,
      followUpChannels: [],
      ...(callbackUrl ? { callbackUrl } : {}),
      ...(callbackSecret ? { callbackSecret } : {}),
    },
  };
}
