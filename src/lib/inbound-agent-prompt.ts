import { listCampaigns } from "./voice-campaign-store";
import { normalizeCustomerPhone, appendCustomerChannelMemoryToSystemPrompt } from "./customer-channel-memory";
import { buildKnowledgeContext } from "./knowledge-context";
import { listPersistedKnowledge } from "./server/knowledge-repo";
import { isTestCall } from "./voice-campaign-analysis";
import type { InboundAgentConfig } from "./inbound-agent-config";

const RECENT_OUTBOUND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// A voice system prompt can't carry entire scraped web pages: a huge knowledge
// dump slows Gemini Live setup and buries the guardrails so the model follows
// them less reliably. Bound the digest to a compact, priority-ordered slice.
export const KB_TOTAL_BUDGET_CHARS = 12_000;
const KB_PER_ENTRY_CHARS = 700;
const KB_MAX_ENTRIES = 25;
// When the user hand-picks entries we trust the selection, so each may take more
// of the budget (no aggressive per-entry prefix trim) — only the total is capped.
export const KB_SELECTED_PER_ENTRY_CHARS = 4_000;
const KB_PRIORITY_ORDER: Record<string, number> = { Critical: 0, High: 1, "Good to have": 2 };

/** Warm, brand-light inbound opener spoken verbatim on answer. */
export function buildInboundGreeting(config: InboundAgentConfig): string {
  if (config.greetingOverride?.trim()) return config.greetingOverride.trim();
  const name = config.agentName;
  const co = config.companyName?.trim();
  if (co) {
    return `Namaste! Aapne ${co} ko call kiya hai. Main ${name} baat kar rahi hoon — bataiye, main aapki kaise madad kar sakti hoon?`;
  }
  return `Namaste! Main ${name} baat kar rahi hoon — bataiye, main aapki kaise madad kar sakti hoon?`;
}

/**
 * The single highest-value inbound behavior: if we recently dialed this caller,
 * surface it so the agent can handle "someone called me from this number".
 * Best-effort scan of the in-memory campaign store; silent on any miss.
 */
function findRecentOutboundCallHint(fromNumber: string | undefined): string {
  const target = normalizeCustomerPhone(fromNumber);
  if (!target) return "";

  let bestAt = 0;
  let best: { name: string; purpose?: string } | undefined;
  for (const campaign of listCampaigns()) {
    for (const call of campaign.calls ?? []) {
      if (isTestCall(call)) continue;
      if (normalizeCustomerPhone(call.toNumber) !== target) continue;
      const at = Date.parse(call.startedAt || "") || 0;
      if (at > bestAt) {
        bestAt = at;
        best = { name: campaign.name, purpose: campaign.purposeName };
      }
    }
  }

  if (!best || !bestAt || Date.now() - bestAt > RECENT_OUTBOUND_WINDOW_MS) return "";
  return (
    `\nLIKELY CONTEXT: We recently reached out to this caller from the "${best.name}" outreach` +
    `${best.purpose ? ` (${best.purpose})` : ""}. They may be returning that call — acknowledge it naturally if it comes up.\n`
  );
}

/**
 * Build a compact, prompt-ready knowledge digest for a persona: highest priority
 * first, each entry trimmed, capped to a total char budget so the grounding stays
 * voice-sized instead of dumping full web pages. Never throws.
 *
 * `knowledgeIds`: undefined = auto (priority-ordered digest of the whole KB),
 * `[]` = none, `[...]` = ground only on exactly these entry ids.
 *
 * Shared by inbound calls and the agent-editor live preview so both ground on the
 * KB the same way.
 */
export function buildKnowledgeDigest(input: {
  userId?: string;
  datasetId?: string;
  knowledgeIds?: string[];
}): string {
  const { userId, datasetId, knowledgeIds } = input;
  if (!userId || !datasetId) return "";
  try {
    const raw = listPersistedKnowledge(userId, datasetId);
    if (!raw.length) return "";

    // Curated selection: honor exactly what the user picked (empty = none).
    const custom = Array.isArray(knowledgeIds);
    let pool = raw;
    if (custom) {
      const want = new Set(knowledgeIds);
      pool = raw.filter((e) => want.has(e.id));
      if (!pool.length) return "";
    }

    const perEntryCap = custom ? KB_SELECTED_PER_ENTRY_CHARS : KB_PER_ENTRY_CHARS;
    const maxEntries = custom ? pool.length : KB_MAX_ENTRIES;
    const sorted = [...pool].sort(
      (a, b) => (KB_PRIORITY_ORDER[a.priority] ?? 9) - (KB_PRIORITY_ORDER[b.priority] ?? 9),
    );
    const trimmed: typeof raw = [];
    let budget = KB_TOTAL_BUDGET_CHARS;
    for (const entry of sorted) {
      if (trimmed.length >= maxEntries || budget <= 0) break;
      const content = (entry.content || "").replace(/\s+/g, " ").trim().slice(0, perEntryCap);
      if (!content) continue;
      budget -= content.length;
      trimmed.push({ ...entry, content });
    }
    return buildKnowledgeContext(trimmed);
  } catch {
    return "";
  }
}

/** Persona knowledge digest for a live inbound call (respects `knowledgeEnabled`). */
function loadKnowledgeDigest(config: InboundAgentConfig): string {
  if (!config.knowledgeEnabled) return "";
  return buildKnowledgeDigest({
    userId: config.userId,
    datasetId: config.datasetId,
    knowledgeIds: config.knowledgeIds,
  });
}

/**
 * Build the inbound agent system prompt: inbound behavior (greet → discover →
 * route) grounded on the knowledge base, with lender-grade identity/account
 * guardrails and per-caller context — deliberately NOT the outbound talk-track.
 */
export function buildInboundAgentSystemPrompt(config: InboundAgentConfig, fromNumber?: string): string {
  const name = config.agentName;
  const co = config.companyName?.trim();
  const lang = config.language;
  const knowledge = loadKnowledgeDigest(config);
  const recent = findRecentOutboundCallHint(fromNumber);

  const script = config.scriptOverride?.trim();

  // A scripted DID (welcome line, collections line) swaps ONLY the framing and
  // behaviour block. Everything below — grounding, identity safety, routing —
  // is appended either way, so a script cannot talk the agent past a rail.
  const framing = script
    ? `CRITICAL FRAMING: The caller dialed YOU. You did NOT call them — never imply you placed this call. You are answering this line to run the specific workflow below.\n\n` +
      `YOUR WORKFLOW ON THIS LINE:\n${script}\n\n` +
      `HOW TO BEHAVE:\n` +
      `- Speak a short greeting first, then listen.\n` +
      `- Work through the workflow above, but let the caller redirect you — they dialed in, they may want something else entirely. Handle that first, then return to the workflow if it still fits.\n` +
      `- Keep every reply short and natural for a phone call. One idea per turn.\n` +
      `- Speak ${lang} by default, but switch to the caller's language if they clearly use another.\n\n`
    : `CRITICAL FRAMING: The caller dialed YOU. You did NOT call them. Never open with an outbound pitch or a scripted campaign message. Greet briefly, then find out how you can help and let the caller lead.\n\n` +
      `HOW TO BEHAVE:\n` +
      `- Speak a short greeting first, then listen.\n` +
      `- Discover the caller's intent before doing anything else. Ask one brief clarifying question if it's unclear.\n` +
      `- The caller may be returning a missed call from us — be ready for "someone called me from this number".\n` +
      `- Keep every reply short and natural for a phone call. One idea per turn.\n` +
      `- Speak ${lang} by default, but switch to the caller's language if they clearly use another.\n\n`;

  let prompt =
    `You are ${name}, a warm and helpful voice assistant answering an INBOUND phone call${co ? ` for ${co}` : ""}.\n\n` +
    framing +
    `GROUNDING (do not improvise):\n` +
    `- Answer ONLY using the KNOWLEDGE BASE below and what the caller tells you.\n` +
    `- NEVER invent interest rates, eligibility, EMI amounts, offers, timelines, or policies.\n` +
    `- If the answer is not in the knowledge base, say you'll have a representative follow up — do not guess.\n` +
    `- Do not give personalized financial advice.\n\n` +
    `IDENTITY & ACCOUNT SAFETY:\n` +
    `- You do NOT know who is calling. The phone number is NOT proof of identity.\n` +
    `- Never reveal or confirm any account-specific detail (loan balance, EMI, dues, personal data).` +
    `${config.verificationRequiredForAccount ? " Anything account-specific requires identity verification you cannot complete on this call — offer a callback from a verified representative instead." : ""}\n\n` +
    `ROUTING (no live transfer available):\n` +
    `- If you can answer from the knowledge base, do it.\n` +
    `- If the caller needs account help, a human, or something outside the knowledge base: acknowledge it, briefly capture what they need and their name, and tell them a representative will call them back. Do not promise a live transfer.\n` +
    `- If it's a wrong number or spam callback, be polite and let them go quickly.\n` +
    `${recent}`;

  if (knowledge) {
    prompt +=
      `\n\n===== KNOWLEDGE BASE (authoritative — answer only from here) =====\n` +
      `${knowledge}\n` +
      `===== END KNOWLEDGE BASE =====`;
  }

  // Reuse the outbound helper to append any prior WhatsApp/SMS/call memory for this caller.
  return appendCustomerChannelMemoryToSystemPrompt(prompt, fromNumber, config.userId);
}
