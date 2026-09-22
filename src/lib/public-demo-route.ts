/**
 * Host-side public-demo routing: detect intent, mutate CallConfig for the
 * active campaign (WA/link binding), and build soft-swap OVERRIDE instructions.
 */

import { storeCallConfig, type CallConfig } from "./voice-call-state";
import {
  PUBLIC_DEMO_ROUTER_AGENT_NAME,
  PUBLIC_DEMO_CAMPAIGN_ID,
  PUBLIC_DEMO_PERSONAS,
  getPublicDemoPersona,
  type PublicDemoPersonaId,
} from "./public-demo-personas";
import {
  buildPublicDemoCampaignSystemPrompt,
  buildPublicDemoRouterSystemPrompt,
} from "./public-demo-inbound-prompt";
import { getCampaign } from "./voice-campaign-store";
import { buildCampaignRuntimePrompt } from "./voice-campaign-runtime-prompt";
import { adaptCampaignPromptForInbound } from "./inbound-campaign-script";
import { normalizeTranscriptText } from "./plivo-gemini-live-text-utils";

export type PublicDemoRouteTarget =
  | { kind: "router" }
  | { kind: "persona"; personaId: PublicDemoPersonaId };

export type PublicDemoRouteIntent =
  | { type: "route"; personaId: PublicDemoPersonaId }
  | { type: "menu" };

const MENU_RE =
  /\b(go back to the menu|main menu|back to menu|back to the menu|change scenario|change use case|different (scenario|use case)|another (scenario|use case)|dusra wala|doosra wala|दूसरा वाला|मेन मेनू|मेनू|switch (me )?back to (the )?menu)\b/i;

/** Explicit mid-call transfer / switch language (not just topic keywords). */
const TRANSFER_RE =
  /\b(transfer|switch|connect(?:\s+me)?|route|hand\s*off|handoff|someone who can help|back to|dusre (agent|wale)|दूसरे)\b/i;

const ORDINAL_TO_PERSONA: Array<{ re: RegExp; personaId: PublicDemoPersonaId }> = [
  { re: /\b(one|first|1|option\s*1|number\s*1|पहला|एक)\b/i, personaId: "collection" },
  { re: /\b(two|second|2|option\s*2|number\s*2|दूसरा|दो)\b/i, personaId: "lead-qualification" },
];


const DEFAULT_CAMPAIGN_IDS: Record<PublicDemoPersonaId, string> = {
  collection: "vc_tvs_collection_ananya",
  "lead-qualification": "vc_tvs_lead_qual_ananya",
};

/** Ambiguous short ordinal/menu cues — only match on short utterances. */
const WEAK_HINTS = new Set([
  "one",
  "first",
  "two",
  "second",
  "welcome",
  "finance",
  "sales",
]);

export function resolvePublicDemoCampaignId(personaId: PublicDemoPersonaId): string {
  const persona = getPublicDemoPersona(personaId);
  const fromEnv = process.env[persona.campaignIdEnv]?.trim();
  return fromEnv || DEFAULT_CAMPAIGN_IDS[personaId];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeWordCount(normalized: string): number {
  return normalized.split(/\s+/).filter(Boolean).length;
}

function hintMatches(
  normalized: string,
  raw: string,
  hint: string,
  transferContext = false,
): boolean {
  const h = hint.trim().toLowerCase();
  if (!h) return false;
  if (h.includes(" ") || /[^\x00-\x7f]/.test(h)) {
    return normalized.includes(h) || raw.toLowerCase().includes(h);
  }
  if (WEAK_HINTS.has(h)) {
    const words = normalized.split(/\s+/).filter(Boolean);
    // Mid-call "switch back to one" is long — allow weak ordinals when transfer
    // language is present.
    if (words.length > 6 && !transferContext) return false;
    return new RegExp(`(?:^|\\s)${escapeRegExp(h)}(?:\\s|$)`, "i").test(normalized);
  }
  return new RegExp(`(?:^|\\s)${escapeRegExp(h)}(?:\\s|$)`, "i").test(normalized);
}

/**
 * Detect menu return or a persona route/switch from free-form speech.
 * Returns null when unclear. Same-persona re-match while already active → null.
 */
export function detectPublicDemoRouteIntent(
  text: string,
  activePersonaId?: PublicDemoPersonaId | null,
): PublicDemoRouteIntent | null {
  const raw = text.trim();
  if (!raw) return null;
  const normalized = normalizeTranscriptText(raw).toLowerCase();
  if (!normalized) return null;

  if (MENU_RE.test(normalized) || MENU_RE.test(raw)) {
    if (!activePersonaId) return null;
    return { type: "menu" };
  }

  const wantsTransfer = TRANSFER_RE.test(normalized) || TRANSFER_RE.test(raw);

  // "switch back to one / option 2" — ordinals with transfer language, or short utterances.
  if (wantsTransfer || tokenizeWordCount(normalized) <= 6) {
    for (const { re, personaId } of ORDINAL_TO_PERSONA) {
      if (!re.test(normalized) && !re.test(raw)) continue;
      if (personaId === activePersonaId) return null;
      return { type: "route", personaId };
    }
  }

  let best: { personaId: PublicDemoPersonaId; score: number } | null = null;
  for (const persona of PUBLIC_DEMO_PERSONAS) {
    for (const hint of persona.selectionHints) {
      if (!hintMatches(normalized, raw, hint, wantsTransfer)) continue;
      const score = hint.trim().length + (wantsTransfer ? 20 : 0);
      if (!best || score > best.score) {
        best = { personaId: persona.id, score };
      }
    }
  }

  if (!best) return null;
  if (best.personaId === activePersonaId) return null;
  return { type: "route", personaId: best.personaId };
}

const AFFIRM_RE =
  /^(yes|yeah|yep|yup|haan|han|ha|ji|jee|हाँ|हां|जी|ok|okay|sahi|theek|correct|confirm(?:ed)?)([.!, ]|$)/i;

function isAffirmativeChoice(text: string): boolean {
  const normalized = normalizeTranscriptText(text).toLowerCase().trim();
  if (!normalized) return false;
  if (AFFIRM_RE.test(normalized)) return true;
  if (tokenizeWordCount(normalized) <= 4 && /\b(yes|haan|han|ji|confirm(?:ed)?|हाँ|हां|जी)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

/** Distinctive (non-weak) cues that an assistant turn mentioned a persona. */
function personasMentionedInAssistant(assistantText: string): PublicDemoPersonaId[] {
  const a = assistantText.toLowerCase();
  if (!a.trim()) return [];
  const found: PublicDemoPersonaId[] = [];
  for (const persona of PUBLIC_DEMO_PERSONAS) {
    if (a.includes(persona.label.toLowerCase()) || a.includes(persona.id)) {
      found.push(persona.id);
      continue;
    }
    for (const hint of persona.selectionHints) {
      const h = hint.trim().toLowerCase();
      if (!h || WEAK_HINTS.has(h) || h.length < 4) continue;
      if (a.includes(h)) {
        found.push(persona.id);
        break;
      }
    }
  }
  return [...new Set(found)];
}

/**
 * When the IVR already named a use case and the caller only affirms / confirms,
 * keyword detect alone misses the route (call fbs4j: "Ji, confirmed" after
 * Home loan). Also catch ASR near-misses once the assistant locked one option.
 */
export function inferPublicDemoRouteFromContext(
  userText: string,
  lastAssistantText: string | undefined,
  activePersonaId?: PublicDemoPersonaId | null,
): PublicDemoRouteIntent | null {
  if (activePersonaId) return null;
  const assistant = (lastAssistantText || "").trim();
  if (!assistant) return null;

  const mentioned = personasMentionedInAssistant(assistant);
  if (mentioned.length !== 1) return null;
  const personaId = mentioned[0]!;

  if (isAffirmativeChoice(userText)) {
    return { type: "route", personaId };
  }

  // Host catch-up: Vani free-wheeled a fake "connecting you" line — next
  // substantive caller turn should still soft-route to that persona.
  const fakeTransfer =
    /\b(connect|transfer|please wait|section mein|wale section)\b/i.test(assistant);
  if (fakeTransfer) {
    const raw = userText.trim();
    if (!raw) return null;
    if (/\b(kaun|who are you|aap kaun|कौन)\b/i.test(raw)) return null;
    if (MENU_RE.test(raw)) return null;
    return { type: "route", personaId };
  }

  return null;
}

/** Keyword detect, then assistant-offer / fake-transfer catch-up. */
export function resolvePublicDemoRouteIntent(
  userText: string,
  activePersonaId?: PublicDemoPersonaId | null,
  lastAssistantText?: string,
): PublicDemoRouteIntent | null {
  return (
    detectPublicDemoRouteIntent(userText, activePersonaId) ||
    inferPublicDemoRouteFromContext(userText, lastAssistantText, activePersonaId)
  );
}

function clearLinkFields(callConfig: CallConfig): void {
  delete callConfig.linkDest;
  delete callConfig.linkWindowDays;
  delete callConfig.linkTemplate;
}

/**
 * Mutate the live CallConfig in place (stream closes over the same object) and
 * persist via storeCallConfig so WA/link attribution follows the active route.
 */
export function applyPublicDemoRoute(
  callId: string,
  callConfig: CallConfig,
  target: PublicDemoRouteTarget,
): void {
  if (target.kind === "router") {
    callConfig.activePersonaId = null;
    callConfig.campaignId = PUBLIC_DEMO_CAMPAIGN_ID;
    callConfig.voiceName = PUBLIC_DEMO_ROUTER_AGENT_NAME;
    callConfig.systemPrompt = buildPublicDemoRouterSystemPrompt({
      agentName: PUBLIC_DEMO_ROUTER_AGENT_NAME,
      language: callConfig.language || "Hinglish",
    });
    callConfig.publicDemoRouteAppliedAtMs = Date.now();
    callConfig.publicDemoSwitchQuietUntilMs = Date.now() + 3500;
    clearLinkFields(callConfig);
    storeCallConfig(callId, callConfig);
    return;
  }

  const persona = getPublicDemoPersona(target.personaId);
  const campaignId = resolvePublicDemoCampaignId(target.personaId);
  const campaign = getCampaign(campaignId);
  let runtimePrompt: string | undefined;
  let linkDest: string | undefined;
  let linkWindowDays: number | undefined;
  let linkTemplate: string | undefined;

  if (campaign) {
    const runtime = buildCampaignRuntimePrompt(campaign, callConfig.customerContext);
    runtimePrompt = adaptCampaignPromptForInbound(
      runtime.systemPrompt,
      campaign,
      callConfig.toNumber,
    );
    linkDest = runtime.linkDest;
    linkWindowDays = runtime.linkWindowDays;
    linkTemplate = runtime.linkTemplate;
  }

  callConfig.activePersonaId = target.personaId;
  callConfig.campaignId = campaignId;
  // Campaign agent identity (Ananya) — not the IVR host (Vani).
  callConfig.voiceName = persona.voiceName;
  callConfig.systemPrompt = buildPublicDemoCampaignSystemPrompt(
    target.personaId,
    {
      agentName: persona.voiceName,
      language: callConfig.language || "Hinglish",
    },
    runtimePrompt,
  );
  callConfig.publicDemoRouteAppliedAtMs = Date.now();
  // Ambient (~1s) + OVERRIDE send + brief TTS ramp — keep recoveries quiet.
  callConfig.publicDemoSwitchQuietUntilMs = Date.now() + 3500;
  if (linkDest) callConfig.linkDest = linkDest;
  else delete callConfig.linkDest;
  if (linkWindowDays !== undefined) callConfig.linkWindowDays = linkWindowDays;
  else delete callConfig.linkWindowDays;
  if (linkTemplate) callConfig.linkTemplate = linkTemplate;
  else delete callConfig.linkTemplate;

  storeCallConfig(callId, callConfig);
}

/**
 * Compact mid-call OVERRIDE for Gemini Live realtimeInput.
 * Full campaign system prompts (~15k) triggered WS close 1007
 * ("Precondition check failed") — keep this short and speakable.
 */
export const MAX_ROUTE_OVERRIDE_CHARS = 3500;

/** When header+script would exceed this fraction of max, summarise the script. */
const ROUTE_OVERRIDE_SUMMARIZE_RATIO = 0.8;

/**
 * Deterministic mid-call script compression (no LLM round-trip — voice path
 * cannot wait). Drops private Note/Routing lines, prefers Say:/step lines.
 */
export function summarizeCampaignScriptForOverride(
  script: string,
  maxChars: number,
): string {
  const lines = script
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      if (/^note:/i.test(l)) return false;
      if (/^routing\b/i.test(l)) return false;
      if (/^#+\s*routing/i.test(l)) return false;
      if (/^\(.*\bprivate\b/i.test(l)) return false;
      return true;
    });

  const footer = "…[summarised — stay on current step; one short turn at a time]";
  const room = Math.max(120, maxChars - footer.length - 40);

  let compact = lines.join("\n");
  if (compact.length <= room) {
    return `${compact}\n${footer}`;
  }

  const priority = lines.filter((l) =>
    /^(say:|\d+[.)]|step\s+\d+|#+\s)/i.test(l),
  );
  const source = priority.length >= 3 ? priority : lines;
  const out: string[] = ["[summarised campaign steps]"];
  for (const line of source) {
    const candidate = `${out.join("\n")}\n${line}`;
    if (candidate.length > room) break;
    out.push(line);
  }
  out.push(footer);
  const joined = out.join("\n");
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars);
}

/** Short spoken catalog for when the caller asks what is available. */
export function publicDemoUseCaseCatalogSpoken(): string {
  return PUBLIC_DEMO_PERSONAS.map((p) => p.label).join("; ");
}

export function buildPublicDemoRouteOverrideInstruction(
  personaId: PublicDemoPersonaId,
): string {
  const persona = getPublicDemoPersona(personaId);
  const opening = persona.firstMessage.trim();
  const script = persona.editableScript.trim();
  const otherLabels = PUBLIC_DEMO_PERSONAS.filter((p) => p.id !== personaId)
    .map((p) => p.label)
    .join("; ");
  const header = [
    "SYSTEM OVERRIDE — PUBLIC DEMO ROUTE:",
    "Abandon IVR / router mode (Vani) immediately.",
    "CRITICAL: Do not go silent. Speak in this turn.",
    `1. First sentence ONLY: short transfer, e.g. "Theek hai — main aapko ab ${persona.voiceName} se connect kar rahi hoon. Please stay on the call."`,
    `2. Then YOU ARE ${persona.voiceName} from ${persona.companyName} for "${persona.campaignName}" — not Vani anymore.`,
    opening ? `3. After the transfer line, deliver this opening (or the next script step if already past it): ${opening}` : "",
    "Do not hang up or dial another number. Ignore earlier router instructions.",
    otherLabels
      ? `Mid-call: if they ask to switch / transfer / main menu / another use case (${otherLabels}), acknowledge briefly — host will inject new instructions.`
      : "",
    "",
    "CAMPAIGN SCRIPT (follow steps; speak one short turn at a time):",
  ]
    .filter(Boolean)
    .join("\n");

  const softLimit = Math.floor(MAX_ROUTE_OVERRIDE_CHARS * ROUTE_OVERRIDE_SUMMARIZE_RATIO);
  const hardBudget = Math.max(400, MAX_ROUTE_OVERRIDE_CHARS - header.length - 40);
  const rawTotal = header.length + 1 + script.length;

  const body =
    rawTotal <= softLimit
      ? script.length <= hardBudget
        ? script
        : summarizeCampaignScriptForOverride(script, hardBudget)
      : summarizeCampaignScriptForOverride(script, hardBudget);

  const full = `${header}\n${body}`;
  if (full.length <= MAX_ROUTE_OVERRIDE_CHARS) return full;
  return `${full.slice(0, MAX_ROUTE_OVERRIDE_CHARS - 24)}\n…[hard trim]`;
}

export function buildPublicDemoMenuOverrideInstruction(): string {
  const catalog = publicDemoUseCaseCatalogSpoken();
  return [
    "SYSTEM OVERRIDE — PUBLIC DEMO MENU:",
    "Leave the active campaign immediately.",
    "You are Vani again — the Actioneer IVR / welcome host.",
    'Ask once, open-ended: "Main aapki madad kaise kar sakti hoon?"',
    `If they ask what is available / kya kya kar sakti ho / options: briefly name these use cases only — ${catalog} — then ask which they want. Do not dump unprompted.`,
    "Do NOT speak a transfer line unless a later host OVERRIDE says so. Do not go silent.",
  ].join("\n");
}

/** True when public-demo WhatsApp may fire for the current CallConfig. */
export function publicDemoWhatsAppAllowed(callConfig: CallConfig): boolean {
  if (!callConfig.isPublicDemo) return true;
  return Boolean(callConfig.activePersonaId);
}
