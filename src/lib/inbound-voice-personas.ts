import type { VoiceCustomerContext } from "./voice-customer-context";

/**
 * Fixed voice-verification identity for inbound campaign-script lines that
 * always address one named person (e.g. a collections script that opens with
 * "Am I speaking with Rahul Awasthi?"). Keyed by campaignId so every call that
 * lands on this script's inbound DIDs — regardless of the caller's phone
 * number — enrolls/matches against the SAME biomarker bucket. This lets voice
 * forensics answer "is this really him?" instead of just "have we seen this
 * phone number before?".
 */
interface InboundVoicePersona {
  subjectId: string;
  firstName: string;
  displayName: string;
  gender: VoiceCustomerContext["gender"];
}

const RAHUL_AWASTHI: InboundVoicePersona = {
  subjectId: "rahul-awasthi",
  firstName: "Rahul",
  displayName: "Rahul Awasthi",
  gender: "male",
};

const INBOUND_VOICE_PERSONAS: Record<string, InboundVoicePersona> = {
  // Local dev: "Collection Call" (EMI collections script).
  vc_1784792639964_nnqpn: RAHUL_AWASTHI,
  // Staging: "TVS Credit SALES" — same persona, different script.
  vc_1785241495018_hldny: RAHUL_AWASTHI,
  // Staging: "HDFC SCRIPT" — same persona.
  vc_1785749802958_a526z: RAHUL_AWASTHI,
};

export function inboundVoicePersonaForCampaign(campaignId: string | undefined): InboundVoicePersona | null {
  if (!campaignId) return null;
  return INBOUND_VOICE_PERSONAS[campaignId] ?? null;
}
