export type {
  DialerProvider as VoiceDialerProvider,
  DialerStartParams as VoiceDialerStartParams,
  DialerStartResult as VoiceDialerStartResult,
} from "@/features/integrations/server/capabilities";
export { resolveDialerProvider as resolveVoiceDialerProvider } from "@/features/integrations/server/provider-registry";
