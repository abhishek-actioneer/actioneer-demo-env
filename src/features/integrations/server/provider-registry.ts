import { prewarmGeminiLiveCallSession } from "@/lib/plivo-gemini-live-bridge";
import { ensureGeminiLiveConfig } from "@/lib/voice-agent-provider";
import type { VoiceCallProvider } from "@/lib/voice-campaign-types";
import { ensurePlivoConfig, initiatePlivoCall } from "./providers/plivo/client";
import {
  ensureMulberryConfig,
  mulberryCallbackSecret,
  mulberryCallbackUrl,
  mulberryStartUrl,
  startMulberryCall,
} from "./providers/mulberry/client";
import { buildMulberryRuntimeContext } from "./providers/mulberry/payload";
import { getCallConfig } from "@/lib/voice-call-state";
import { resolveCampaignCanonicalOpening } from "@/lib/voice-campaign-opening";
import { buildVoiceSeedTurns } from "@/lib/voice-campaign-runtime-prompt";
import { seedTurnsEnabled } from "@/lib/plivo-gemini-live-config";
import { DEFAULT_SARVAM_TTS_PACE, ensureSarvamConfig, synthesizeSarvamMulaw } from "./providers/sarvam/tts-client";
import { ensureCartesiaConfig, synthesizeCartesiaMulaw } from "./providers/cartesia/tts-client";
import { sendSms } from "./providers/twilio/sms-client";
import { sendTwilioEmail } from "./providers/twilio/email-client";
import {
  sendWhatsApp,
  sendWhatsAppSessionMedia,
  sendWhatsAppTemplate,
  testGupshupWhatsAppConnection,
  validateGupshupWhatsAppConfig,
} from "./providers/gupshup/whatsapp-client";
import { validateConnection as validateCleverTapConnection } from "./providers/clevertap/client";
import {
  actioneerCdpConfigFromRecord,
  ActioneerCdpActivationProvider,
} from "@/lib/server/actioneer-cdp-activation-provider";
import type {
  CrmProvider,
  DialerProvider,
  EmailProvider,
  IntegrationCapability,
  IntegrationProviderAdapter,
  ProviderConfigValidation,
  ProviderTestResult,
  RealtimeAgentProvider,
  SmsProvider,
  TtsProvider,
  WhatsappProvider,
} from "./capabilities";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function validateRequired(names: string[], config: Record<string, string | undefined> = {}): ProviderConfigValidation {
  const missing = names.filter((name) => !(config[name]?.trim() || env(name)));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

function unsupportedTest(provider: string): Promise<ProviderTestResult> {
  return Promise.resolve({ ok: false, error: `${provider} does not support explicit connection tests yet` });
}

function validateActioneerCdpConfig(config: Record<string, string | undefined> = {}): ProviderConfigValidation {
  const normalized: Record<"profileServiceUrl" | "tenantId" | "appId", string | undefined> = {
    profileServiceUrl: config.profileServiceUrl ?? config.baseUrl,
    tenantId: config.tenantId ?? config.teamId,
    appId: config.appId,
  };
  const keys: Array<keyof typeof normalized> = ["profileServiceUrl", "tenantId", "appId"];
  const missing = keys.filter((key) => !normalized[key]?.trim());
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

async function testTwilioConfig(config: Record<string, string | undefined> = {}): Promise<ProviderTestResult> {
  const accountSid = config.accountSid?.trim() || env("TWILIO_ACCOUNT_SID");
  const authToken = config.authToken?.trim() || env("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return { ok: false, error: "Account SID and Auth Token are required" };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, status: res.status, error: body.message ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { friendly_name?: string };
    return { ok: true, status: res.status, label: body.friendly_name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Twilio test failed" };
  }
}

async function testPlivoConfig(config: Record<string, string | undefined> = {}): Promise<ProviderTestResult> {
  const authId = config.authId?.trim() || env("PLIVO_AUTH_ID");
  const authToken = config.authToken?.trim() || env("PLIVO_AUTH_TOKEN");
  if (!authId || !authToken) return { ok: false, error: "Auth ID and Auth token are required" };
  try {
    const res = await fetch(`https://api.plivo.com/v1/Account/${encodeURIComponent(authId)}/`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${authId}:${authToken}`).toString("base64"),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      return { ok: false, status: res.status, error: body.error ?? body.message ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { name?: string };
    return { ok: true, status: res.status, label: body.name ?? `Plivo ${authId}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Plivo test failed" };
  }
}

export const plivoDialerProvider: DialerProvider = {
  id: "plivo-gemini",
  label: "Gemini + Plivo",
  capabilities: ["dialer", "realtime-agent", "tts"],
  validateConfig: (config = {}) => validateRequired(
    ["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN", "PLIVO_PHONE_NUMBER"],
    {
      PLIVO_AUTH_ID: config.authId,
      PLIVO_AUTH_TOKEN: config.authToken,
      PLIVO_PHONE_NUMBER: config.from,
    },
  ),
  testConnection: testPlivoConfig,
  ensureConfig() {
    ensurePlivoConfig();
    ensureGeminiLiveConfig();
  },
  async startCall({ campaign, callConfigId, toNumber, customerContext, runtimeSystemPrompt }) {
    // Fire prewarm in background so dialing is never blocked on Gemini setup.
    void prewarmGeminiLiveCallSession(callConfigId, {
      campaignId: campaign.id,
      datasetId: campaign.datasetId,
      systemPrompt: runtimeSystemPrompt,
      firstMessage: resolveCampaignCanonicalOpening(campaign),
      voice: campaign.voice,
      voiceName: campaign.voiceName,
      language: campaign.language,
      toNumber,
      customerContext,
      ...(seedTurnsEnabled() ? { seedTurns: buildVoiceSeedTurns(campaign) } : {}),
    }).catch((error) => {
      console.error(`[voice/campaigns] Gemini prewarm failed for ${callConfigId}; dialing cold:`, error);
    });

    const providerRequestId = await initiatePlivoCall(toNumber, callConfigId);
    return {
      provider: "plivo",
      providerRequestId,
      summary: "Gemini + Plivo accepted by Plivo",
    };
  },
};

export const mulberryDialerProvider: DialerProvider = {
  id: "mulberry-pipecat",
  label: "Mulberry (Pipecat)",
  capabilities: ["dialer", "realtime-agent", "tts"],
  validateConfig: () => ({ ok: true }),
  async testConnection() {
    try {
      const base = mulberryStartUrl().replace(/\/start$/, "/");
      const res = await fetch(base, { method: "GET" });
      return res.ok
        ? { ok: true, status: res.status, label: "Mulberry runtime reachable" }
        : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Mulberry unreachable" };
    }
  },
  ensureConfig() {
    ensureMulberryConfig();
  },
  // SEPARATE RAIL: delegates the whole call to the external Mulberry/Pipecat
  // runtime. No Gemini prewarm, no Plivo answer_url/bridge — none of the
  // plivo-gemini-live pipeline runs on this path.
  async startCall({ campaign, callConfigId, toNumber, customerContext, runtimeSystemPrompt }) {
    const cfg = getCallConfig(callConfigId);
    const firstMessage = cfg?.firstMessage || campaign.firstMessage || "";
    const language = cfg?.language || campaign.language || "Hindi";
    const voiceName = cfg?.voiceName || campaign.voiceName || "Priya";
    const speaker = env("MULBERRY_SPEAKER") || "ira";
    const voiceDescription =
      env("MULBERRY_VOICE_DESCRIPTION") || "an indian accent and mostly speak hindi";
    // Mulberry dials on its own Plivo; this is informational and matches the
    // vendor's working sample payload unless overridden.
    const fromNumber = env("MULBERRY_FROM_NUMBER") || "+912269870900";

    void customerContext; // already folded into runtimeSystemPrompt upstream

    const context = buildMulberryRuntimeContext({
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
      callbackUrl: mulberryCallbackUrl(),
      callbackSecret: mulberryCallbackSecret(),
    });

    const providerRequestId = await startMulberryCall(context);
    return {
      provider: "mulberry",
      providerRequestId,
      summary: "Mulberry (Pipecat) accepted /start",
    };
  },
};

export const twilioProvider: SmsProvider & EmailProvider = {
  id: "twilio",
  label: "Twilio",
  capabilities: ["sms", "email"],
  validateConfig: (config = {}) => {
    const normalized = {
      TWILIO_ACCOUNT_SID: config.accountSid,
      TWILIO_AUTH_TOKEN: config.authToken,
      TWILIO_SMS_FROM: config.from,
    };
    return validateRequired(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], normalized);
  },
  testConnection: testTwilioConfig,
  sendSms,
  sendEmail: sendTwilioEmail,
};

export const gupshupWhatsAppProvider: WhatsappProvider = {
  id: "gupshup",
  label: "Gupshup WhatsApp",
  capabilities: ["whatsapp"],
  validateConfig: validateGupshupWhatsAppConfig,
  testConnection: testGupshupWhatsAppConnection,
  sendWhatsApp,
  sendWhatsAppTemplate,
  sendWhatsAppSessionMedia,
};

export const cleverTapProvider: CrmProvider = {
  id: "clevertap",
  label: "CleverTap",
  capabilities: ["crm", "cdp"],
  validateConfig: (config = {}) => {
    const missing = ["accountId", "passcode", "apiBase"].filter((key) => !config[key]?.trim());
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  },
  async testConnection(config = {}) {
    const result = await validateCleverTapConnection({
      accountId: config.accountId ?? "",
      passcode: config.passcode ?? "",
      apiBase: config.apiBase ?? "",
    });
    return {
      ok: result.ok,
      status: result.status,
      label: result.projectName,
      error: result.error,
    };
  },
};

export const actioneerCdpProvider: IntegrationProviderAdapter = {
  id: "actioneer-cdp",
  label: "Actioneer CDP",
  capabilities: ["cdp"],
  validateConfig: validateActioneerCdpConfig,
  async testConnection(config = {}) {
    const validation = validateActioneerCdpConfig(config);
    if (!validation.ok) {
      return { ok: false, error: `Missing ${validation.missing?.join(", ")}` };
    }
    const provider = new ActioneerCdpActivationProvider(actioneerCdpConfigFromRecord(config));
    const result = await provider.testConnection();
    return {
      ok: result.ok,
      label: result.ok ? `${result.audienceCount ?? 0} cohorts` : undefined,
      error: result.error,
    };
  },
};

export const sarvamTtsProvider: TtsProvider = {
  id: "sarvam",
  label: "Sarvam",
  capabilities: ["tts"],
  validateConfig: () => validateRequired(["SARVAM_API_KEY"]),
  testConnection: () => unsupportedTest("Sarvam"),
  ensureConfig: ensureSarvamConfig,
  synthesizeMulaw(text, language, speaker) {
    return synthesizeSarvamMulaw(text, language, speaker, { pace: DEFAULT_SARVAM_TTS_PACE });
  },
};

export const cartesiaTtsProvider: TtsProvider = {
  id: "cartesia",
  label: "Cartesia",
  capabilities: ["tts"],
  validateConfig: () => validateRequired(["CARTESIA_API_KEY"]),
  testConnection: () => unsupportedTest("Cartesia"),
  ensureConfig: ensureCartesiaConfig,
  synthesizeMulaw(text, language, speaker) {
    return synthesizeCartesiaMulaw(text, language, { voiceId: speaker });
  },
};

export const geminiRealtimeProvider: RealtimeAgentProvider = {
  id: "gemini-live",
  label: "Gemini Live",
  capabilities: ["realtime-agent"],
  validateConfig: () => {
    const ok = Boolean(env("GOOGLE_API_KEY") || env("GEMINI_API_KEY"));
    return ok ? { ok: true } : { ok: false, missing: ["GOOGLE_API_KEY or GEMINI_API_KEY"] };
  },
  testConnection: () => unsupportedTest("Gemini Live"),
  ensureConfig: ensureGeminiLiveConfig,
};

export const INTEGRATION_PROVIDERS = [
  plivoDialerProvider,
  mulberryDialerProvider,
  twilioProvider,
  gupshupWhatsAppProvider,
  actioneerCdpProvider,
  cleverTapProvider,
  sarvamTtsProvider,
  cartesiaTtsProvider,
  geminiRealtimeProvider,
] as const satisfies readonly IntegrationProviderAdapter[];

export function activeVoiceTtsProvider(): "sarvam" | "cartesia" {
  return process.env.VOICE_TTS_PROVIDER === "cartesia" ? "cartesia" : "sarvam";
}

export function resolveDialerProvider(provider: VoiceCallProvider): DialerProvider {
  return provider === "mulberry-pipecat" ? mulberryDialerProvider : plivoDialerProvider;
}

export function resolveTtsProvider(provider: "sarvam" | "cartesia" = activeVoiceTtsProvider()): TtsProvider {
  return provider === "cartesia" ? cartesiaTtsProvider : sarvamTtsProvider;
}

export function providersForCapability(capability: IntegrationCapability): IntegrationProviderAdapter[] {
  return INTEGRATION_PROVIDERS.filter((provider) => provider.capabilities.includes(capability));
}
