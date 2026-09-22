// Per-call config keyed by the callId we generate before initiating a Plivo call.
// Stored on `global` for the common single-process path, and mirrored to disk so
// Next.js route workers and the custom WebSocket server can share call metadata.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { VoiceCustomerContext } from "./voice-customer-context";
import { getVoiceStorageRoot } from "./voice-storage";
import type { PublicDemoPersonaId } from "./public-demo-personas";

export interface CallConfig {
  campaignId: string;
  datasetId?: string;
  systemPrompt: string;
  firstMessage: string;
  voice: string;
  voiceName?: string;
  language: string;
  toNumber: string;
  userId?: string;
  customerContext?: VoiceCustomerContext;
  sarvamOpeningAudio?: string;
  verificationId?: string;
  verificationSubjectId?: string;
  verificationAmountAtRisk?: number;
  /** Few-shot style demonstration turns sent as initial Gemini client content
   *  right after setupComplete (before the opening instruction). Populated at
   *  CallConfig assembly (prewarm literal + resolveCallConfig rebuild) only
   *  when GEMINI_LIVE_SEED_TURNS=1; the outbound cold path gets seedTurns only
   *  via the resolveCallConfig rebuild until call-user assembly is wired. */
  seedTurns?: Array<{ role: "user" | "model"; text: string }>;
  // Link tool: populated when campaign.successDefinition.primary.type === "link"
  linkDest?: string;
  linkWindowDays?: number;
  linkTemplate?: string;
  /** Wall-clock (ms) at which the call was triggered from the API process.
   *  Persisted deterministically so the post-call transcript-finalize (U5) and
   *  the gemini_inline finalize (U2) can compute trigger_to_transcript_ms. */
  triggeredAtMs?: number;
  /**
   * Public zero-signup demo call (inbound router or outbound demo dial).
   * Gates demo-only defenses (injection pre-filter) so production campaigns
   * never inherit them.
   */
  isPublicDemo?: boolean;
  /**
   * Live-test call: customerContext is a MOCK identity sampled for prompt
   * personalization; the voice on the line is the tester, not that customer.
   * Voice forensics must not key the biomarker on the mock identity — test
   * calls are matched against the gallery but never enrolled.
   */
  isTestCall?: boolean;
  /**
   * Whether the dialed number matches the customerContext identity's registered
   * phone in the dataset's entity table. Set (true/false) only by call paths
   * that let the caller type an arbitrary number; undefined on paths that dial
   * the registered number by construction. `false` → voice forensics benches
   * the call against the customer's reference but never enrolls.
   */
  voiceIdentityPhoneVerified?: boolean;
  /** Inbound voice-only mock banking demo. Identity starts unknown and is set only by the biometric sidecar. */
  isVoiceBiometricDemo?: boolean;
  /**
   * Public-demo soft route: null/undefined while in IVR; set after host routes
   * to a persona. WhatsApp / link attribution follows campaignId for this persona.
   */
  activePersonaId?: PublicDemoPersonaId | null;
  /** Epoch ms of last public-demo soft route/menu OVERRIDE (race guard). */
  publicDemoRouteAppliedAtMs?: number;
  /**
   * While Date.now() < this, suppress barge-in empty/unclear recovery
   * instructions so they do not stack on top of a deferred route OVERRIDE
   * (Gemini Live 1007 on second soft-route).
   */
  publicDemoSwitchQuietUntilMs?: number;
}

type Store = Map<string, CallConfig>;
type SerializedStore = Record<string, CallConfig>;

declare global {
  var __voiceCallState: Store | undefined;
}

function storePath(): string {
  return join(getVoiceStorageRoot(), "voice-call-state.json");
}

function getStore(): Store {
  if (!global.__voiceCallState) global.__voiceCallState = new Map();
  return global.__voiceCallState;
}

function loadFileStore(): SerializedStore {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SerializedStore;
  } catch {
    return {};
  }
}

function writeFileStore(store: SerializedStore): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export function storeCallConfig(callId: string, config: CallConfig): void {
  getStore().set(callId, config);
  writeFileStore({ ...loadFileStore(), [callId]: config });
}

export function getCallConfig(callId: string): CallConfig | undefined {
  const memoryConfig = getStore().get(callId);
  if (memoryConfig) return memoryConfig;
  const fileConfig = loadFileStore()[callId];
  if (fileConfig) getStore().set(callId, fileConfig);
  return fileConfig;
}

/** Read the persisted trigger wall-clock for a call (U3), or undefined. */
export function getCallTriggeredAtMs(callId: string): number | undefined {
  return getCallConfig(callId)?.triggeredAtMs;
}

export function removeCallConfig(callId: string): void {
  getStore().delete(callId);
  const store = loadFileStore();
  if (store[callId]) {
    delete store[callId];
    writeFileStore(store);
  }
}
