import type { VoiceCallProvider, VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceCustomerContext } from "@/lib/voice-customer-context";

export type IntegrationCapability =
  | "dialer"
  | "sms"
  | "whatsapp"
  | "email"
  | "crm"
  | "cdp"
  | "tts"
  | "realtime-agent";

export interface ProviderConfigValidation {
  ok: boolean;
  missing?: string[];
  error?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  status?: number;
  label?: string;
  error?: string;
}

export interface IntegrationProviderAdapter {
  id: string;
  label: string;
  capabilities: readonly IntegrationCapability[];
  validateConfig(config?: Record<string, string | undefined>): ProviderConfigValidation;
  testConnection(config?: Record<string, string | undefined>): Promise<ProviderTestResult>;
}

export interface DialerStartParams {
  campaign: VoiceCampaign;
  callConfigId: string;
  toNumber: string;
  customerContext?: VoiceCustomerContext;
  runtimeSystemPrompt: string;
}

export interface DialerStartResult {
  provider: "plivo" | "mulberry";
  providerRequestId?: string;
  summary: string;
}

export interface DialerProvider extends IntegrationProviderAdapter {
  id: VoiceCallProvider;
  capabilities: readonly IntegrationCapability[];
  ensureConfig(): void;
  startCall(params: DialerStartParams): Promise<DialerStartResult>;
}

export interface SmsProvider extends IntegrationProviderAdapter {
  capabilities: readonly IntegrationCapability[];
  sendSms(to: string, body: string, options?: { userId?: string }): Promise<unknown>;
}

export interface WhatsappProvider extends IntegrationProviderAdapter {
  capabilities: readonly IntegrationCapability[];
  sendWhatsApp(to: string, body: string, options?: { userId?: string }): Promise<unknown>;
  sendWhatsAppTemplate(to: string, input?: unknown): Promise<unknown>;
  /** Free-form media. Requires an open 24h session — see hasOpenWhatsAppSession. */
  sendWhatsAppSessionMedia?(to: string, media: unknown, options?: { userId?: string }): Promise<unknown>;
}

export interface EmailProvider extends IntegrationProviderAdapter {
  capabilities: readonly IntegrationCapability[];
  sendEmail(input: unknown): Promise<unknown>;
}

export interface CrmProvider extends IntegrationProviderAdapter {
  capabilities: readonly IntegrationCapability[];
}

export interface TtsProvider extends IntegrationProviderAdapter {
  capabilities: readonly IntegrationCapability[];
  ensureConfig(): void;
  synthesizeMulaw(text: string, language: string, speaker?: string): Promise<string>;
}

export interface RealtimeAgentProvider extends IntegrationProviderAdapter {
  capabilities: readonly IntegrationCapability[];
  ensureConfig(): void;
}
