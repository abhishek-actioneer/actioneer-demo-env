import type { VoiceCampaign } from "./voice-campaign-types";
import type { VoiceFlowNode } from "./voice-campaign-flow";

/** Hard closings — safe to match anywhere in a short wrap-up turn. */
const HARD_CLOSING_PHRASE_PATTERNS = [
  /\bthank you for (?:your )?time\b/i,
  /\bthanks for (?:your )?time\b/i,
  /\bhave a (?:good|nice|great) day\b/i,
  /\bgoodbye\b/i,
  /\bbye[\s,.!-]/i,
  /\bshubh din\b/i,
  /शुभ दिन/,
  /\btheek hai[,.\s]+(?:dhanyavaad|thank)/i,
  /ठीक है[,.\s]+धन्यवाद/,
  /\bnoted (?:this|that)\b.*\b(?:thank|dhanyavaad|close)\b/i,
  /\bapologize\b.*\bend\b/i,
  /\bsorry\b.*\b(?:not interested|do not call|stop calling)\b/i,
];

/**
 * Soft thanks often open a mid-call pitch ("धन्यवाद! कॉल रिकॉर्ड होगी… क्या मैं…?").
 * Only treat them as hangup signals when they appear near the end of the turn.
 */
const SOFT_THANKS_PATTERNS = [
  /\bdhanyavaad\b/i,
  /धन्यवाद/,
];

const TERMINAL_QUESTION_PATTERNS = [
  /[?？]/,
  /\bkya\b/i,
  /क्या/,
  /\bchahte\b/i,
  /\bchahenge\b/i,
  /\bwould you\b/i,
  /\bdo you\b/i,
  /\bcan i\b/i,
  /\bshould i\b/i,
];

/** Soft thanks must land in this trailing window to count as a close. */
const SOFT_THANKS_TAIL_CHARS = 80;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function asksFollowUpQuestion(value: string): boolean {
  return TERMINAL_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

function hasSoftThanksNearEnd(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Short wrap-ups: soft thanks anywhere is fine ("धन्यवाद।")
  if (trimmed.length <= SOFT_THANKS_TAIL_CHARS) {
    return SOFT_THANKS_PATTERNS.some((pattern) => pattern.test(trimmed));
  }
  const tail = trimmed.slice(-SOFT_THANKS_TAIL_CHARS);
  return SOFT_THANKS_PATTERNS.some((pattern) => pattern.test(tail));
}

function matchesClosingPhrase(text: string): boolean {
  if (HARD_CLOSING_PHRASE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return hasSoftThanksNearEnd(text);
}

function quotedPhrases(body: string): string[] {
  const phrases: string[] = [];
  const patterns = [
    /"([^"]+)"/g,
    /'([^']+)'/g,
    /“([^”]+)”/g,
    /‘([^’]+)’/g,
    /कहें:\s*([^\n.]+)/gi,
    /say:\s*([^\n.]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const phrase = match[1]?.trim();
      if (phrase && phrase.length >= 8) phrases.push(phrase);
    }
  }
  return phrases;
}

function matchesEndNodeClosing(text: string, endNodeBody: string): boolean {
  // Still seeking a customer reply — never hang up on a question turn.
  if (asksFollowUpQuestion(text)) {
    return false;
  }

  const normalizedText = normalize(text);

  for (const phrase of quotedPhrases(endNodeBody)) {
    const normalizedPhrase = normalize(phrase);
    if (normalizedPhrase.length >= 12 && normalizedText.includes(normalizedPhrase.slice(0, Math.min(48, normalizedPhrase.length)))) {
      return true;
    }
  }

  const closingHints = [
    "thank",
    "dhanyavaad",
    "धन्यवाद",
    "close",
    "end",
    "goodbye",
    "not interested",
    "do not call",
    "stop calling",
    "apologize",
    "sorry",
    "शुभ",
    "ठीक है",
  ];
  const body = normalize(endNodeBody);
  const bodyWantsClose = closingHints.some((hint) => body.includes(hint));
  if (!bodyWantsClose) return false;

  return matchesClosingPhrase(text);
}

function endWorkflowNodes(campaign: VoiceCampaign | null | undefined): VoiceFlowNode[] {
  const nodes = campaign?.workflow?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node) => node.data?.kind === "end");
}

export function shouldEndCallAfterAssistantTurn(
  text: string,
  campaign?: VoiceCampaign | null,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Agent is still asking the customer something — do not auto-hangup.
  // Fixes false positives where a mid-call pitch opens with "धन्यवाद!" then asks
  // "क्या मैं सही व्यक्ति से बात कर रही हूँ?"
  if (asksFollowUpQuestion(trimmed)) return false;

  for (const node of endWorkflowNodes(campaign)) {
    if (matchesEndNodeClosing(trimmed, node.data.body || node.data.title || "")) {
      return true;
    }
  }

  return matchesClosingPhrase(trimmed);
}
